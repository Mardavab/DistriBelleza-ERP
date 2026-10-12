'use client';

import React, { useState } from 'react';
import { Printer, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { printer, type PrintError } from '../../lib/print';

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
    case 'permission-denied':
      return 'No se autorizó la impresora. Hacé clic en "Conectar impresora" arriba y elegí tu JAL58M de la lista.';
    case 'unsupported-device':
      return err.message;
    case 'no-device':
      return 'No hay impresora conectada. Conectá tu impresora por USB y tocá "Conectar impresora" arriba.';
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

  const handlePrint = async () => {
    setStatus('printing');
    setErrorMsg('');

    try {
      if (!printer.isSupported()) {
        throw {
          code: 'unsupported',
          message: 'Navegador no soporta WebUSB.',
        } as PrintError;
      }

      // Si todavía no hay dispositivo autorizado, pedimos permiso.
      if (printer.getStatus() !== 'ready') {
        await printer.connect();
      }

      await printer.printReceipt(saleData);

      setStatus('success');
      setTimeout(() => {
        setStatus('idle');
        onDone?.();
      }, 2000);
    } catch (e) {
      const err = e as PrintError;
      setStatus('error');
      setErrorMsg(describeError(err));
    }
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
        .print-msg { font-size: 0.8rem; text-align: center; padding: 8px; border-radius: 8px; }
        .print-msg.error { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
        .print-msg.success { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
        .spinner { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .hint { font-size: 0.75rem; color: #6b7280; text-align: center; }
      `}</style>

      {status === 'idle' && (
        <>
          <button className="btn-print" onClick={handlePrint}>
            <Printer size={20} /> {ready ? 'IMPRIMIR RECIBO' : 'CONECTAR E IMPRIMIR'}
          </button>
          {!ready && printer.isSupported() && (
            <div className="hint">Se te va a pedir permiso para usar la impresora USB.</div>
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
            <AlertTriangle size={20} /> REINTENTAR
          </button>
          <div className="print-msg error">{errorMsg}</div>
        </>
      )}
    </div>
  );
}