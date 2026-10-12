'use client';

/**
 * Cliente WebUSB para impresoras térmicas ESC/POS.
 *
 * Maneja el ciclo de vida del dispositivo USB: conectar, encontrar el
 * endpoint bulk-OUT, transferir bytes y desconectar.
 *
 * Notas:
 * - WebUSB solo está disponible en navegadores Chromium (Chrome, Edge, Brave, Opera).
 * - Algunas impresoras genéricas baratas (CH340/CH341) aparecen como puerto serie y
 *   NO son accesibles por WebUSB. En ese caso hay que usar Web Serial API o un
 *   servicio local.
 * - El usuario debe conceder permiso una vez por dispositivo. Luego el navegador
 *   recuerda la授权.
 */

import { makeError, PrintError, PrinterInfo, PrinterStatus } from './types';

interface PrinterEndpoint {
  interfaceNumber: number;
  endpointNumber: number;
}

export class WebUsbPrinter {
  private device: USBDevice | null = null;
  private endpoint: PrinterEndpoint | null = null;
  private deviceInfo: { productName?: string; manufacturerName?: string } = {};

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'usb' in navigator;
  }

  getStatus(): PrinterStatus {
    if (!this.isSupported()) return 'unsupported';
    if (!this.device) return 'disconnected';
    return 'ready';
  }

  getDeviceInfo() {
    return this.deviceInfo;
  }

  /**
   * Pide al usuario que seleccione una impresora y abre el dispositivo.
   * Lanza PrintError si falla.
   */
  async connect(): Promise<PrinterInfo> {
    if (!this.isSupported()) {
      throw makeError(
        'unsupported',
        'Tu navegador no soporta impresión USB directa. Usá Chrome o Edge sobre HTTPS.',
      );
    }

    let device: USBDevice;
    try {
      // Filters vacíos = mostrar todo dispositivo. El usuario elige.
      // En producción podemos acotar por clase 0x07 (Printer).
      device = await navigator.usb.requestDevice({
        filters: [{ classCode: 0x07 }],
      });
    } catch (e) {
      throw makeError(
        'permission-denied',
        'No se seleccionó ninguna impresora. Hacé clic en "Conectar impresora" y elegí tu JAL58M de la lista.',
        e,
      );
    }

    try {
      await device.open();
    } catch (e) {
      const name = (e as { name?: string })?.name ?? '';
      // SecurityError en Windows = driver de la impresora ya tiene reclamado el
      // dispositivo. Es la causa #1 cuando el dispositivo aparece en el picker
      // pero no se puede abrir.
      if (name === 'SecurityError') {
        throw makeError(
          'driver-conflict',
          'Windows está bloqueando el acceso a la impresora porque su driver ya tiene reclamado el puerto USB.',
          e,
        );
      }
      if (name === 'NotFoundError') {
        throw makeError(
          'device-lost',
          'La impresora se desconectó mientras se configuraba. Reintentá.',
          e,
        );
      }
      throw makeError(
        'permission-denied',
        'El navegador no pudo abrir el dispositivo USB (' + (name || 'error') + '). ' +
          'Verificá que no esté siendo usada por otra aplicación.',
        e,
      );
    }

    if (!device.configuration) {
      try {
        await device.selectConfiguration(1);
      } catch (e) {
        await device.close().catch(() => {});
        throw makeError(
          'unsupported-device',
          'El dispositivo seleccionado no expone una configuración USB válida.',
          e,
        );
      }
    }

    const ep = this.findBulkOutEndpoint(device);
    if (!ep) {
      await device.close().catch(() => {});
      throw makeError(
        'unsupported-device',
        'El dispositivo seleccionado no parece ser una impresora térmica (no tiene endpoint bulk OUT). ' +
          'Si usás una JAL58M con conversor CH340/CH341, WebUSB no es compatible: instalá el driver y probá desde el diálogo de impresión de Windows.',
      );
    }

    try {
      await device.claimInterface(ep.interfaceNumber);
    } catch (e) {
      await device.close().catch(() => {});
      throw makeError(
        'permission-denied',
        'No se pudo tomar el control del dispositivo. Cerrá otros programas que puedan estar usándolo.',
        e,
      );
    }

    this.device = device;
    this.endpoint = ep;
    this.deviceInfo = {
      productName: device.productName ?? undefined,
      manufacturerName: device.manufacturerName ?? undefined,
    };

    return {
      status: 'ready',
      productName: device.productName ?? undefined,
      manufacturerName: device.manufacturerName ?? undefined,
    };
  }

  async disconnect(): Promise<void> {
    const d = this.device;
    this.device = null;
    this.endpoint = null;
    this.deviceInfo = {};
    if (!d) return;
    try {
      if (d.configuration) {
        for (const iface of d.configuration.interfaces) {
          try {
            await d.releaseInterface(iface.interfaceNumber);
          } catch {
            // ignorar
          }
        }
      }
      await d.close();
    } catch {
      // ignorar
    }
  }

  /**
   * Olvida TODOS los dispositivos USB que el navegador tiene recordados
   * para este origen. Útil cuando un dispositivo previamente授权ado
   * no se puede abrir por conflicto de drivers.
   */
  async forgetAll(): Promise<void> {
    if (!this.isSupported()) return;
    const devices = await navigator.usb.getDevices();
    for (const d of devices) {
      try { await d.forget(); } catch { /* ignore */ }
    }
    await this.disconnect();
  }

  /**
   * Envía bytes a la impresora.
   */
  async print(data: Uint8Array): Promise<void> {
    if (!this.device || !this.endpoint) {
      throw makeError('no-device', 'No hay impresora conectada.');
    }
    try {
      const buffer: ArrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      const result = await this.device.transferOut(this.endpoint.endpointNumber, buffer);
      if (result.status !== 'ok') {
        throw makeError(
          'transfer-failed',
          `La impresora rechazó los datos (status=${result.status}). Verificá que esté encendida y con tinta/papel.`,
        );
      }
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e) throw e as PrintError;
      throw makeError(
        'transfer-failed',
        'No se pudo comunicar con la impresora. Verificá el cable USB y que la impresora esté encendida.',
        e,
      );
    }
  }

  private findBulkOutEndpoint(device: USBDevice): PrinterEndpoint | null {
    if (!device.configuration) return null;
    for (const iface of device.configuration.interfaces) {
      for (const alt of iface.alternates) {
        for (const ep of alt.endpoints) {
          if (ep.direction === 'out' && ep.type === 'bulk') {
            return { interfaceNumber: iface.interfaceNumber, endpointNumber: ep.endpointNumber };
          }
        }
      }
    }
    return null;
  }
}