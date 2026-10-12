'use client';

import React, { useState } from 'react';
import { X, AlertCircle, RefreshCw, CheckCircle } from 'lucide-react';
import { isFailure } from '../../lib/errors';
import { formatCurrency } from '../../lib/format';
import { markInvoiceAsPaid } from '../../app/actions/suppliers';
import type { SupplierInvoice } from '../../app/actions/suppliers';

type PayConfirmModalProps = {
  invoice: SupplierInvoice;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Modal para confirmar el pago total de una factura.
 * Acepta opcionalmente un comprobante de pago (imagen/PDF).
 */
export default function PayConfirmModal({
  invoice,
  onClose,
  onSaved,
}: PayConfirmModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData();
    if (file) fd.append('receipt_file', file);

    const res = await markInvoiceAsPaid(invoice.id, fd);
    setLoading(false);
    if (isFailure(res)) {
      setError(res.error);
      return;
    }
    onSaved();
  };

  return (
    <div
      className="sup-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sup-modal" style={{ maxWidth: 450 }}>
        <div className="sup-modal-header">
          <div>
            <h2>Confirmar Pago</h2>
            <p>Factura de {invoice.supplier_name}</p>
          </div>
          <button className="btn-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="sup-alert error" style={{ marginBottom: 16 }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}

        <form className="sup-form" onSubmit={handleSubmit}>
          <div
            style={{
              background: 'var(--color-bg-soft)',
              padding: 16,
              borderRadius: 'var(--radius-base)',
              marginBottom: 8,
              border: '1px solid var(--color-border)',
            }}
          >
            <p
              style={{
                margin: '0 0 8px 0',
                fontSize: 'var(--font-base)',
                color: 'var(--color-text-mute)',
              }}
            >
              Vas a marcar como pagada esta factura:
            </p>
            <h3
              style={{
                margin: '0 0 4px 0',
                color: 'var(--color-text)',
                fontSize: '1.2rem',
              }}
            >
              {formatCurrency(Number(invoice.amount))}
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: 'var(--font-base)',
                color: 'var(--color-text-mid)',
              }}
            >
              N°: {invoice.invoice_number || 'Sin número'}
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="rcpt-file">
              Comprobante de Pago{' '}
              <span style={{ color: 'var(--color-text-light)', fontWeight: 400 }}>
                (opcional)
              </span>
            </label>
            <input
              type="file"
              id="rcpt-file"
              accept="image/*,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="file-input"
            />
          </div>

          <div className="sup-modal-actions" style={{ marginTop: 'var(--space-4)' }}>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="ui-btn ui-btn-success" disabled={loading}>
              {loading ? (
                <RefreshCw size={16} className="spin" />
              ) : (
                <CheckCircle size={16} />
              )}
              {loading ? 'Procesando…' : 'Marcar como pagada'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}