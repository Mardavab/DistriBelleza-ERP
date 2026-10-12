'use client';

import React, { useState } from 'react';
import { Printer, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { printer, type PrintError } from '../../lib/print';
import SetupGuide from './SetupGuide';

export interface ReceiptData {
  saleId: string;
  createdAt: string;
  cashier?: string;
  items: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
    discount?: number;
  }>;
  subtotal: number;
  totalDiscount: number;
  total: number;
  paymentMethod: string;
  transferType?: string;
  cashReceived?: number;
  openDrawer: boolean;
  companyId?: string;
  branding?: { header?: string; footer?: string };
}

interface PrintReceiptProps {
  saleData: ReceiptData;
  onDone?: () => void;
}

type PrintStatus = 'idle' | 'printing' | 'success' | 'error';

function describeError(err: PrintError): string {
  switch (err.code) {
    case 'unsupported':
      return 'Tu navegador no soporta impresión USB directa. Usá Chrome o Edge actualizado.';
    case 'driver-conflict':
      return 'Windows tiene un driver de la impresora que bloquea el acceso del navegador. Seguí la guía de abajo para solucionarlo (Zadig + WinUSB).';
    case 'permission-denied':
      return err.message ||
        'No se autorizó la impresora. Tocá "Conectar" arriba y elegí tu impresora de la lista.';
    case 'unsupported-device':
      return err.message;
    case 'no-device':
      return 'No hay impresora conectada. Conectá tu impresora por USB y tocá "Conectar" arriba.';
    case 'device-lost':
      return 'La impresora se desconectó. Verificá el cable USB y reintentá.';
    case 'transfer-failed':
      return 'No se pudo comunicar con la impresora. Verificá que esté encendida, con papel y conectada por USB.';
    default:
      return err.message || 'Error desconocido al imprimir.';
  }
}

export default function PrintReceipt({ saleData, onDone }: PrintReceiptProps) {
  const [status, setStatus] = useState<PrintStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [errorCode, setErrorCode] = useState<string>('');
  const [allowBrowserFallback, setAllowBrowserFallback] = useState(true);

  const printDirect = async (): Promise<boolean> => {
    try {
      if (!printer.isSupported()) {
        throw {
          code: 'unsupported',
          message: 'Navegador no soporta WebUSB ni Web Serial.',
        } as PrintError;
      }

      if (printer.getStatus() !== 'ready') {
        await printer.connect();
      }

      await printer.printReceipt(saleData);
      return true;
    } catch (e) {
      throw e;
    }
  };

  const handlePrint = async () => {
    setStatus('printing');
    setErrorMsg('');
    setErrorCode('');

    // Primer intento: WebUSB / Web Serial (impresión directa con cajón).
    try {
      await printDirect();
      setStatus('success');
      setTimeout(() => {
        setStatus('idle');
        onDone?.();
      }, 2000);
      return;
    } catch (e) {
      const err = e as PrintError;
      // Si el problema es de driver en Windows, mostramos la guía y damos
      // la opción de imprimir por el diálogo nativo de Windows.
      setErrorCode(err.code);
      setErrorMsg(describeError(err));
      setStatus('error');
    }
  };

  const handleBrowserPrint = async () => {
    setStatus('printing');
    setErrorMsg('');
    setErrorCode('');
    try {
      const { printed } = await printer.printReceiptBrowser(saleData);
      if (printed) {
        setStatus('success');
      } else {
        // El usuario canceló el diálogo. Lo dejamos en idle, no en error.
        setStatus('idle');
      }
    } catch (e) {
      setStatus('error');
      setErrorCode('unknown');
      setErrorMsg(
        'No se pudo abrir el diálogo de impresión del navegador. ' +
          'Verificá que el navegador no esté bloqueando ventanas emergentes.',
      );
    }
  };

  const handleReset = async () => {
    await printer.forgetAll();
  };

  const ready = printer.getStatus() === 'ready';

  return (
    <div className="print-receipt-area">
      <style jsx>{`
        .print-receipt-area { display: flex; flex-direction: column; gap: 10px; width: 100%; }
        .btn-print { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 14px; background: #10b981; color: white; border: none; border-radius: 12px; font-weight: 700; font-size: 0.95rem; cursor: pointer; transition: all 0.2s; }
        .btn-print:hover:not(:disabled) { background: #059669; transform: translateY(-1px); box-shadow: 0 6px 12px rgba(16,185,129,0.3); }
        .btn-print:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-print.success { background: #10b981; }
        .btn-print.error { background: #ef4444; }
        .btn-print.secondary { background: #4b5563; }
        .btn-print.secondary:hover { background: #374151; }
        .print-msg { font-size: 0.8rem; text-align: center; padding: 8px; border-radius: 8px; }
        .print-msg.error { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
        .print-msg.success { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
        .print-msg.hint { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
        .spinner { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .hint { font-size: 0.75rem; color: #6b7280; text-align: center; }
        .reset-link { font-size: 0.7rem; color: #6b7280; text-decoration: underline; cursor: pointer; background: none; border: none; padding: 4px; }
        .reset-link:hover { color: #374151; }
        .fallback-info {
          background: #f3f4f6;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 10px;
          font-size: 0.78rem;
          color: #374151;
          margin-top: 4px;
        }
      `}</style>

      {status === 'idle' && (
        <>
          <button className="btn-print" onClick={handlePrint}>
            <Printer size={20} /> {ready ? 'IMPRIMIR RECIBO' : 'IMPRIMIR RECIBO'}
          </button>
          {!ready && printer.isSupported() && (
            <div className="hint">La primera vez te va a pedir permiso USB.</div>
          )}
        </>
      )}

      {status === 'printing' && (
        <button className="btn-print" disabled>
          <Loader2 size={20} className="spinner" /> IMPRIMIENDO...
        </button>
      )}

      {status === 'success' && (
        <button className="btn-print success" disabled>
          <CheckCircle size={20} /> RECIBO IMPRESO
        </button>
      )}

      {status === 'error' && (
        <>
          <button className="btn-print error" onClick={handlePrint}>
            <AlertTriangle size={20} /> REINTENTAR (USB directo)
          </button>

          {allowBrowserFallback && (
            <>
              <button
                className="btn-print secondary"
                onClick={handleBrowserPrint}
              >
                <Printer size={20} /> IMPRIMIR CON DIÁLOGO DE WINDOWS
              </button>
              <div className="fallback-info">
                <strong>¿Qué hace este botón?</strong> Abre el diálogo normal
                de impresión de Windows (igual que apretar <kbd>Ctrl + P</kbd>).
                Funciona con cualquier impresora que Windows reconozca,
                incluyendo tu JAL58M. El cajero confirma y se imprime.
                <br />
                <strong>Limitación:</strong> no abre el cajón de dinero
                automáticamente — el cajero tiene que abrirlo manualmente
                con la llave o el pulsador.
              </div>
            </>
          )}

          <div className="print-msg error">{errorMsg}</div>

          {errorCode === 'driver-conflict' && (
            <div style={{ marginTop: '12px' }}>
              <SetupGuide />
            </div>
          )}

          <div style={{ textAlign: 'center' }}>
            <button className="reset-link" onClick={handleReset}>
              Olvidar dispositivos autorizados (Reset)
            </button>
          </div>
        </>
      )}
    </div>
  );
}