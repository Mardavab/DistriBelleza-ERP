'use client';

/**
 * Fachada de impresión para el POS.
 *
 * Encapsula la lógica de WebUSB + ESC/POS y expone:
 *   - Estado de la impresora (sin conectar / lista / denegada / no soportada).
 *   - `connect()`: pide permiso al usuario para elegir dispositivo.
 *   - `printReceipt(receipt)`: arma y manda el ticket.
 *   - `openDrawer()`: pulso de cajón sin imprimir.
 *
 * Los componentes se suscriben a `subscribe(fn)` para reflejar el estado en UI.
 */

import type { ReceiptData } from '../../components/POS/PrintReceipt';
import { EscPosBuilder, escpos } from './escpos';
import {
  makeError,
  PrintError,
  PrinterInfo,
  PrinterStatus,
} from './types';
import { WebUsbPrinter } from './webusb';

type Listener = (status: PrinterStatus, info: PrinterInfo) => void;

class PrinterFacade {
  private webusb = new WebUsbPrinter();
  private listeners = new Set<Listener>();
  private status: PrinterStatus;
  private info: PrinterInfo = { status: 'disconnected' };
  private builder = new EscPosBuilder();

  constructor() {
    this.status = this.webusb.isSupported() ? 'disconnected' : 'unsupported';
  }

  isSupported(): boolean {
    return this.webusb.isSupported();
  }

  getStatus(): PrinterStatus {
    return this.status;
  }

  getInfo(): PrinterInfo {
    return this.info;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    // emitir estado actual inmediatamente
    fn(this.status, this.info);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const fn of Array.from(this.listeners)) {
      try {
        fn(this.status, this.info);
      } catch {
        // no romper a otros listeners
      }
    }
  }

  private setStatus(status: PrinterStatus, info?: PrinterInfo): void {
    this.status = status;
    this.info = info ?? { ...this.info, status };
    this.emit();
  }

  async connect(): Promise<PrinterInfo> {
    if (!this.webusb.isSupported()) {
      this.setStatus('unsupported');
      throw makeError(
        'unsupported',
        'Tu navegador no soporta impresión USB directa. Usá Chrome o Edge.',
      );
    }
    this.setStatus('disconnected');
    try {
      const info = await this.webusb.connect();
      this.setStatus('ready', info);
      return info;
    } catch (e) {
      const err = e as PrintError;
      if (err.code === 'unsupported') this.setStatus('unsupported');
      else if (err.code === 'permission-denied') this.setStatus('denied');
      else if (err.code === 'unsupported-device') this.setStatus('denied');
      else this.setStatus('disconnected');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await this.webusb.disconnect();
    this.setStatus('disconnected', { status: 'disconnected' });
  }

  async printReceipt(receipt: ReceiptData): Promise<void> {
    const bytes = this.builder.buildReceipt(receipt);
    await this.webusb.print(bytes);
  }

  async openDrawer(): Promise<void> {
    const bytes = escpos.buildOpenDrawer();
    await this.webusb.print(bytes);
  }
}

export const printer = new PrinterFacade();
export type { PrintError, PrinterStatus, PrinterInfo } from './types';