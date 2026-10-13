'use client';

import React, { useState } from 'react';
import { X, AlertCircle, RefreshCw, DollarSign } from 'lucide-react';
import { isFailure } from '../../lib/errors';
import { formatCurrency, formatCurrencyInput, parseCurrencyInput } from '../../lib/format';
import { addInvoicePayment, type SupplierInvoice } from '../../app/actions/suppliers';

type AbonoModalProps = {
  invoice: SupplierInvoice;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Modal para registrar un abono (pago parcial) sobre una factura.
 * Muestra el progreso de pago actual y permite agregar más.
 */
export default function AbonoModal({ invoice, onClose, onSaved }: AbonoModalProps) {
  const paid = Number(invoice.paid_amount ?? 0);
  const total = Number(invoice.amount);
  const pending = total - paid;
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount.replace(/\./g, ''));
    if (!val || val <= 0) {
      setError('Ingresa un valor mayor a cero.');
      return;
    }
    setLoading(true);
    setError(null);
    const res = await addInvoicePayment(invoice.id, val);
    setLoading(false);
    if (isFailure(res)) {
      setError(res.error);
      return;
    }
    onSaved();
  };

  const pct = Math.min(100, (paid / total) * 100);

  return (
    <div
      className="sup-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sup-modal" style={{ maxWidth: 420 }}>
        <div className="sup-modal-header">
          <div>
            <h2>Registrar Abono</h2>
            <p>
              {invoice.supplier_name} · {invoice.invoice_number ?? 'Sin N°'}
            </p>
          </div>
          <button className="btn-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Progreso de pago */}
        <div
          style={{
            background: 'var(--color-bg-soft)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
            marginBottom: 20,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 'var(--font-sm)',
              color: 'var(--color-text-mute)',
              marginBottom: 8,
            }}
          >
            <span>
              Abonado:{' '}
              <strong style={{ color: 'var(--color-primary)' }}>{formatCurrency(paid)}</strong>
            </span>
            <span>
              Total:{' '}
              <strong style={{ color: 'var(--color-text)' }}>{formatCurrency(total)}</strong>
            </span>
          </div>
          <div className="abono-bar-wrap">
            <div className="abono-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="abono-info" style={{ textAlign: 'right', marginTop: 6 }}>
            Saldo pendiente:{' '}
            <strong
              style={{
                color: pending > 0
                  ? 'var(--color-warning-dark)'
                  : 'var(--color-success-dark)',
              }}
            >
              {formatCurrency(pending)}
            </strong>
          </p>
        </div>

        {error && (
          <div className="sup-alert error" style={{ marginBottom: 16 }}>
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        <form className="sup-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="abono-amount">Valor del abono *</label>
            <input
              id="abono-amount"
              type="text"
              value={amount}
              onChange={(e) => {
                const val = parseCurrencyInput(e.target.value);
                setAmount(formatCurrencyInput(val));
              }}
              placeholder={`Máx. ${formatCurrency(pending)}`}
              required
              autoFocus
            />
          </div>
          <div className="sup-modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? <RefreshCw size={16} className="spin" /> : <DollarSign size={16} />}
              {loading ? 'Guardando…' : 'Registrar abono'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}