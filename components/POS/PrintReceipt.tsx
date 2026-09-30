'use client'

import React, { useState } from 'react';
import { Printer, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { PRINT_SERVICE_URL } from '../../lib/constants';

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
}

interface PrintReceiptProps {
  saleData: ReceiptData;
  onDone?: () => void;
}

type PrintStatus = 'idle' | 'printing' | 'success' | 'error';

export default function PrintReceipt({ saleData, onDone }: PrintReceiptProps) {
  const [status, setStatus] = useState<PrintStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handlePrint = async () => {
    setStatus('printing');
    setErrorMsg('');

    try {
      const response = await fetch(`${PRINT_SERVICE_URL}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saleData),
      });

      const result = await response.json();

      if (result.success) {
        setStatus('success');
        setTimeout(() => {
          setStatus('idle');
          onDone?.();
        }, 2000);
      } else {
        setStatus('error');
        setErrorMsg(result.error || 'Error al imprimir.');
      }
    } catch {
      setStatus('error');
      setErrorMsg(
        'No se pudo conectar con el servicio de impresión. ' +
        'Asegúrese de que print-service está corriendo (node server.js).'
      );
    }
  };

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
      `}</style>

      {status === 'idle' && (
        <button className="btn-print" onClick={handlePrint}>
          <Printer size={20} /> IMPRIMIR RECIBO
        </button>
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
