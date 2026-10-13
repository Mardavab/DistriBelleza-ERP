'use client';

import React, { useState } from 'react';
import { X, AlertCircle, RefreshCw, Edit2, Plus } from 'lucide-react';
import { isFailure } from '../../lib/errors';
import { formatCurrencyInput, parseCurrencyInput } from '../../lib/format';
import { createSupplierInvoice, updateSupplierInvoice, type Supplier, type SupplierInvoice } from '../../app/actions/suppliers';

type InvoiceModalProps = {
  initial?: SupplierInvoice | null;
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: () => void;
  billedToOptions?: string[];
};

/**
 * Modal para crear o editar una factura de proveedor.
 * Acepta FormData con los campos y un archivo opcional.
 */
export default function InvoiceModal({
  initial,
  suppliers,
  onClose,
  onSaved,
  billedToOptions = ['Norby', 'Marlon', 'Otros'],
}: InvoiceModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    supplier_id: initial?.supplier_id ?? '',
    invoice_number: initial?.invoice_number ?? '',
    issue_date: initial?.issue_date ?? today,
    due_date: initial?.due_date ?? '',
    amount: initial?.amount ? formatCurrencyInput(initial.amount) : '',
    description: initial?.description ?? '',
    billed_to: initial?.billed_to ?? '',
    invoice_type: initial?.invoice_type ?? 'remision',
  });
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set =
    (k: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const fd = new FormData();
    fd.append('supplier_id', form.supplier_id);
    fd.append('invoice_number', form.invoice_number);
    fd.append('issue_date', form.issue_date);
    fd.append('due_date', form.due_date);
    fd.append(
      'amount',
      parseFloat(form.amount.replace(/\./g, '').replace(',', '.')).toString(),
    );
    fd.append('description', form.description);
    fd.append('billed_to', form.billed_to);
    fd.append('invoice_type', form.invoice_type);

    if (file) {
      fd.append('invoice_file', file);
    }

    const res = initial
      ? await updateSupplierInvoice(initial.id, fd)
      : await createSupplierInvoice(fd);
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
      <div className="sup-modal">
        <div className="sup-modal-header">
          <div>
            <h2>{initial ? 'Editar Factura' : 'Nueva Factura de Proveedor'}</h2>
            <p>Registra los detalles de la factura</p>
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
          <div className="form-row">
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="inv-supplier">Proveedor *</label>
              <select
                id="inv-supplier"
                value={form.supplier_id}
                onChange={set('supplier_id')}
                required
              >
                <option value="">— Seleccionar proveedor —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="inv-number">N° Factura</label>
              <input
                id="inv-number"
                value={form.invoice_number}
                onChange={set('invoice_number')}
                placeholder="Ej: FAC-0001"
              />
            </div>
            <div className="form-group">
              <label htmlFor="inv-amount">Valor *</label>
              <input
                id="inv-amount"
                value={form.amount}
                onChange={(e) => {
                  const val = parseCurrencyInput(e.target.value);
                  const formatted = formatCurrencyInput(val);
                  setForm((prev) => ({ ...prev, amount: formatted }));
                }}
                placeholder="Ej: 350.000"
                required
                type="text"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="inv-issue">Fecha de Expedición *</label>
              <input
                id="inv-issue"
                type="date"
                value={form.issue_date}
                onChange={set('issue_date')}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="inv-due">Fecha de Vencimiento *</label>
              <input
                id="inv-due"
                type="date"
                value={form.due_date}
                onChange={set('due_date')}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="inv-billed-to">A nombre de quién</label>
              <select
                id="inv-billed-to"
                value={form.billed_to}
                onChange={set('billed_to')}
              >
                <option value="">Seleccionar...</option>
                {billedToOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="inv-type">Tipo de Factura</label>
              <select
                id="inv-type"
                value={form.invoice_type}
                onChange={set('invoice_type')}
              >
                <option value="remision">Remisión</option>
                <option value="electronica">Electrónica</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="inv-desc">
              Descripción{' '}
              <span style={{ color: 'var(--color-text-light)', fontWeight: 400 }}>
                (opcional)
              </span>
            </label>
            <textarea
              id="inv-desc"
              value={form.description}
              onChange={set('description')}
              placeholder="Ej: Compra de productos capilares - lote junio"
              rows={2}
            />
          </div>

          <div className="form-group">
            <label htmlFor="inv-file">
              Foto / Archivo de Factura{' '}
              <span style={{ color: 'var(--color-text-light)', fontWeight: 400 }}>
                (opcional)
              </span>
            </label>
            <input
              type="file"
              id="inv-file"
              accept="image/*,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="file-input"
            />
          </div>

          <div className="sup-modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? (
                <RefreshCw size={16} className="spin" />
              ) : initial ? (
                <Edit2 size={16} />
              ) : (
                <Plus size={16} />
              )}
              {loading
                ? 'Guardando…'
                : initial
                ? 'Actualizar factura'
                : 'Registrar factura'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}