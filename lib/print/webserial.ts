'use client';

/**
 * Cliente Web Serial para impresoras térmicas ESC/POS.
 *
 * Web Serial funciona bien en Windows con impresoras que usan un puente
 * USB-serial (CH340/CH341/PL2303) — caso típico de impresoras genéricas
 * de 58mm como la JAL58M. Windows ya las expone como COMx y el navegador
 * puede abrir el puerto sin conflicto de drivers.
 *
 * Disponible en Chrome/Edge desde v89.
 */

import { makeError, PrintError, PrinterInfo, PrinterStatus } from './types';

const DEFAULT_BAUD = 9600;

export class WebSerialPrinter {
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private deviceInfo: { productName?: string; manufacturerName?: string } = {};

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  getStatus(): PrinterStatus {
    if (!this.isSupported()) return 'unsupported';
    if (!this.port) return 'disconnected';
    return 'ready';
  }

  getDeviceInfo() {
    return this.deviceInfo;
  }

  async connect(): Promise<PrinterInfo> {
    if (!this.isSupported()) {
      throw makeError(
        'unsupported',
        'Tu navegador no soporta Web Serial. Actualizá Chrome o Edge.',
      );
    }

    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort({});
    } catch (e) {
      throw makeError(
        'permission-denied',
        'No se seleccionó ningún puerto serie. Tocá "Conectar" y elegí el COM de tu impresora.',
        e,
      );
    }

    try {
      await port.open({ baudRate: DEFAULT_BAUD, dataBits: 8, stopBits: 1, parity: 'none' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/in use|busy|being used/i.test(msg)) {
        throw makeError(
          'permission-denied',
          'El puerto serie está siendo usado por otra aplicación. Cerrá el software de la impresora y reintentá.',
          e,
        );
      }
      throw makeError(
        'transfer-failed',
        `No se pudo abrir el puerto serie: ${msg}. Verificá que la impresora esté conectada y sin otro programa usándola.`,
        e,
      );
    }

    this.port = port;
    const info = port.getInfo();
    this.deviceInfo = {
      productName: info.usbProductId !== undefined ? `COM (PID ${info.usbProductId.toString(16)})` : 'Puerto serie',
      manufacturerName: info.usbVendorId !== undefined ? `VID ${info.usbVendorId.toString(16)}` : undefined,
    };

    return {
      status: 'ready',
      productName: this.deviceInfo.productName,
      manufacturerName: this.deviceInfo.manufacturerName,
    };
  }

  async disconnect(): Promise<void> {
    const port = this.port;
    this.port = null;
    this.writer = null;
    this.deviceInfo = {};
    if (!port) return;
    try {
      if (this.writer) {
        try { await this.writer.close(); } catch { /* ignore */ }
      }
      await port.close();
    } catch {
      // ignore
    }
  }

  async forgetAll(): Promise<void> {
    // Serial API no expone forget(); el usuario debe limpiar permisos en
    // edge://settings/content/serial. Acá solo cerramos el puerto actual.
    await this.disconnect();
  }

  async print(data: Uint8Array): Promise<void> {
    if (!this.port || !this.port.writable) {
      throw makeError('no-device', 'No hay impresora conectada.');
    }
    try {
      const writer = this.port.writable.getWriter();
      try {
        await writer.write(data);
      } finally {
        try { writer.releaseLock(); } catch { /* ignore */ }
      }
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e) throw e as PrintError;
      throw makeError(
        'transfer-failed',
        'No se pudo escribir al puerto serie. Verificá que la impresora esté encendida y conectada.',
        e,
      );
    }
  }
}