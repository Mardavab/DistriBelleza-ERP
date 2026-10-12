'use client';

import React, { useEffect, useState } from 'react';
import { Printer, CheckCircle2, AlertTriangle, XCircle, Cable, Loader2 } from 'lucide-react';
import { printer, type PrinterInfo, type PrinterStatus, type Transport } from '../../lib/print';

const STATUS_LABELS: Record<PrinterStatus, string> = {
  ready: 'Impresora lista',
  disconnected: 'Impresora no conectada',
  denied: 'Permiso denegado',
  unsupported: 'Navegador no compatible',
};

const STATUS_CLASS: Record<PrinterStatus, string> = {
  ready: 'badge-ready',
  disconnected: 'badge-neutral',
  denied: 'badge-warn',
  unsupported: 'badge-bad',
};

function StatusIcon({ status, busy }: { status: PrinterStatus; busy: boolean }) {
  if (busy) return <Loader2 size={14} className="spin" />;
  switch (status) {
    case 'ready':
      return <CheckCircle2 size={14} />;
    case 'denied':
      return <AlertTriangle size={14} />;
    case 'unsupported':
      return <XCircle size={14} />;
    default:
      return <Printer size={14} />;
  }
}

export default function PrintStatusBadge() {
  const [status, setStatus] = useState<PrinterStatus>(printer.getStatus());
  const [info, setInfo] = useState<PrinterInfo>(printer.getInfo());
  const [transport, setTransport] = useState<Transport>(printer.getTransport());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return printer.subscribe((s, i, t) => {
      setStatus(s);
      setInfo(i);
      setTransport(t);
    });
  }, []);

  async function handleConnect() {
    setBusy(true);
    try {
      await printer.connect();
    } catch {
      // El error ya lo refleja el badge (estado 'denied' / 'unsupported').
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await printer.disconnect();
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    setBusy(true);
    try {
      await printer.forgetAll();
    } finally {
      setBusy(false);
    }
  }

  const transportLabel = transport === 'serial' ? 'Serie' : transport === 'usb' ? 'USB' : null;

  return (
    <div className={`print-status-badge ${STATUS_CLASS[status]}`}>
      <style jsx>{`
        .print-status-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 0.72rem;
          font-weight: 600;
          cursor: default;
          border: 1px solid transparent;
          white-space: nowrap;
        }
        .print-status-badge .label { display: inline-flex; align-items: center; gap: 6px; }
        .print-status-badge button { all: unset; cursor: pointer; font-weight: 700; padding: 2px 6px; border-radius: 6px; }
        .print-status-badge button:hover { filter: brightness(0.95); }
        .badge-ready { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
        .badge-ready button { background: #10b981; color: white; }
        .badge-neutral { background: #f3f4f6; color: #374151; border-color: #e5e7eb; }
        .badge-neutral button { background: #111827; color: white; }
        .badge-warn { background: #fffbeb; color: #92400e; border-color: #fde68a; }
        .badge-warn button { background: #d97706; color: white; }
        .badge-bad { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
        .spin { animation: spin 1s linear infinite; }
        .reset-link { font-size: 0.7rem; text-decoration: underline; opacity: 0.7; cursor: pointer; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .product-tip { font-weight: 500; opacity: 0.85; }
      `}</style>

      <span className="label">
        <StatusIcon status={status} busy={busy} />
        <span>{STATUS_LABELS[status]}</span>
        {status === 'ready' && transportLabel && (
          <span className="product-tip">· {transportLabel}</span>
        )}
      </span>

      {status === 'unsupported' ? null : status === 'ready' ? (
        <button onClick={handleDisconnect} disabled={busy} title="Desconectar impresora">
          <Cable size={12} /> Desconectar
        </button>
      ) : (
        <button onClick={handleConnect} disabled={busy} title="Conectar impresora">
          {busy ? '…' : 'Conectar'}
        </button>
      )}

      {(status === 'denied' || status === 'disconnected') && (
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); handleReset(); }}
          title="Borrar dispositivos autorizados por Edge y empezar de cero"
          className="reset-link"
        >
          Reset
        </a>
      )}
    </div>
  );
}