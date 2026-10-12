'use client';

/**
 * Fachada de impresión para el POS.
 *
 * Estrategia de conexión:
 *   1) Web Serial (preferida): cubre impresoras con puente USB-serial
 *      (CH340/CH341/PL2303), caso típico de impresoras térmicas genéricas
 *      de 58mm como la JAL58M. El driver serie de Windows no entra en
 *      conflicto con el navegador.
 *   2) Web USB (fallback): impresoras con descriptores USB nativos (p.ej.
 *      Epson, Star). Falla si Windows ya reclamó el dispositivo con su
 *      driver de impresora.
 *
 * Si ambos están disponibles y el primero falla, probamos el segundo
 * automáticamente. El estado (`resultado`) refleja qué tecnología quedó
 * activa.
 */

import type { ReceiptData } from '../../components/POS/PrintReceipt';
import { EscPosBuilder, escpos } from './escpos';
import {
  makeError,
  PrintError,
  PrinterInfo,
  PrinterStatus,
} from './types';
import { WebSerialPrinter } from './webserial';
import { WebUsbPrinter } from './webusb';

export type Transport = 'serial' | 'usb' | null;

type Listener = (status: PrinterStatus, info: PrinterInfo, transport: Transport) => void;

class PrinterFacade {
  private serial = new WebSerialPrinter();
  private usb = new WebUsbPrinter();
  private listeners = new Set<Listener>();
  private status: PrinterStatus;
  private info: PrinterInfo = { status: 'disconnected' };
  private transport: Transport = null;
  private builder = new EscPosBuilder();

  constructor() {
    const supported = this.serial.isSupported() || this.usb.isSupported();
    this.status = supported ? 'disconnected' : 'unsupported';
  }

  isSupported(): boolean {
    return this.serial.isSupported() || this.usb.isSupported();
  }

  getStatus(): PrinterStatus {
    return this.status;
  }

  getInfo(): PrinterInfo {
    return this.info;
  }

  getTransport(): Transport {
    return this.transport;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.status, this.info, this.transport);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const fn of Array.from(this.listeners)) {
      try {
        fn(this.status, this.info, this.transport);
      } catch {
        // ignore
      }
    }
  }

  private setStatus(status: PrinterStatus, info?: PrinterInfo, transport?: Transport): void {
    this.status = status;
    this.info = info ?? { ...this.info, status };
    this.transport = transport ?? this.transport;
    this.emit();
  }

  /**
   * Pide al usuario que seleccione un dispositivo.
   *
   * Orden de intento:
   *   1) Web USB primero: impresoras térmicas con USB nativo (Jaltech,
   *      Epson, Star, etc.) suelen aparecer acá. Si Windows ya cargó un
   *      driver que reclama la interfaz, este paso puede fallar con
   *      "permiso denegado" y caemos al siguiente.
   *   2) Web Serial: impresoras con puente USB-serial (CH340/CH341) que
   *      aparecen como COMx. No se pelea con el driver de Windows.
   */
  async connect(): Promise<PrinterInfo> {
    if (!this.isSupported()) {
      this.setStatus('unsupported');
      throw makeError(
        'unsupported',
        'Tu navegador no soporta impresión USB directa ni Web Serial. Usá Chrome o Edge actualizado.',
      );
    }

    this.setStatus('disconnected');

    const errors: PrintError[] = [];

    // 1) Web USB primero (caso típico: impresoras con USB nativo).
    if (this.usb.isSupported()) {
      try {
        const info = await this.usb.connect();
        this.setStatus('ready', info, 'usb');
        return info;
      } catch (e) {
        const err = e as PrintError;
        errors.push(err);
        // Si el dispositivo no es compatible (CH340 o no-printer),
        // seguimos a Web Serial.
        if (err.code === 'unsupported-device' || err.code === 'unsupported') {
          // continuar
        } else {
          // permission-denied o transfer-failed: también probamos serial
        }
      }
    }

    // 2) Web Serial (CH340/CH341/PL2303).
    if (this.serial.isSupported()) {
      try {
        const info = await this.serial.connect();
        this.setStatus('ready', info, 'serial');
        return info;
      } catch (e) {
        const err = e as PrintError;
        errors.push(err);
      }
    }

    // Ambos fallaron: reportamos el último error con un mensaje unificado.
    const last = errors[errors.length - 1];
    const bothFailed = errors.length === 2;
    if (last?.code === 'permission-denied' && bothFailed) {
      this.setStatus('denied');
      throw makeError(
        'permission-denied',
        'No se pudo abrir ni el USB ni el puerto serie. Esto casi siempre pasa cuando Windows ' +
          'ya cargó un driver de la impresora que bloquea el acceso del navegador. ' +
          'Ver guía al final del mensaje.',
      );
    }
    if (last?.code === 'unsupported') {
      this.setStatus('unsupported');
    } else {
      this.setStatus('denied');
    }
    throw last ?? makeError('unknown', 'No se pudo conectar con la impresora.');
  }

  async disconnect(): Promise<void> {
    await Promise.allSettled([this.serial.disconnect(), this.usb.disconnect()]);
    this.transport = null;
    this.setStatus('disconnected', { status: 'disconnected' });
  }

  /**
   * Olvida todos los dispositivos授权ados por el navegador (USB + serie).
   * Útil cuando un dispositivo previamente授权ado no se puede abrir
   * por conflicto de drivers.
   */
  async forgetAll(): Promise<void> {
    await Promise.allSettled([this.usb.forgetAll(), this.serial.forgetAll()]);
    this.transport = null;
    this.setStatus('disconnected', { status: 'disconnected' });
  }

  async printReceipt(receipt: ReceiptData): Promise<void> {
    const bytes = this.builder.buildReceipt(receipt);
    await this.printBytes(bytes);
  }

  async openDrawer(): Promise<void> {
    const bytes = escpos.buildOpenDrawer();
    await this.printBytes(bytes);
  }

  private async printBytes(bytes: Uint8Array): Promise<void> {
    if (this.transport === 'serial') {
      await this.serial.print(bytes);
    } else if (this.transport === 'usb') {
      await this.usb.print(bytes);
    } else {
      throw makeError('no-device', 'No hay impresora conectada.');
    }
  }
}

export const printer = new PrinterFacade();
export type { PrintError, PrinterStatus, PrinterInfo } from './types';