'use client';

import React, { useState } from 'react';
import { X, AlertCircle, RefreshCw, CheckCheck } from 'lucide-react';
import { isFailure } from '../../lib/errors';
import { createSupplier, updateSupplier, type Supplier } from '../../app/actions/suppliers';

type SupplierModalProps = {
  initial?: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Modal para crear o editar un proveedor.
 * Si `initial` está presente, edita; si no, crea.
 */
export default function SupplierModal({ initial, onClose, onSaved }: SupplierModalProps) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    address: initial?.address ?? '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set =
    (k: string) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    // Capitalizamos primera letra para consistencia visual.
    const trimmed = form.name.trim();
    const capitalizedName = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    const dataToSubmit = { ...form, name: capitalizedName || form.name };

    const res = initial
      ? await updateSupplier(initial.id, dataToSubmit)
      : await createSupplier(dataToSubmit);
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
            <h2>{initial ? 'Editar Proveedor' : 'Nuevo Proveedor'}</h2>
            <p>Registra los datos del proveedor</p>
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
          <div className="form-group">
            <label htmlFor="sup-name">Nombre del proveedor *</label>
            <input
              id="sup-name"
              value={form.name}
              onChange={set('name')}
              placeholder="Ej: Distribuidora Belleza S.A."
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="sup-phone">Teléfono</label>
              <input
                id="sup-phone"
                value={form.phone}
                onChange={set('phone')}
                placeholder="Ej: 310 000 0000"
              />
            </div>
            <div className="form-group">
              <label htmlFor="sup-email">Correo</label>
              <input
                id="sup-email"
                type="email"
                value={form.email}
                onChange={set('email')}
                placeholder="correo@proveedor.com"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="sup-address">Dirección</label>
            <input
              id="sup-address"
              value={form.address}
              onChange={set('address')}
              placeholder="Ej: Calle 45 # 23-10, Bogotá"
            />
          </div>

          <div className="sup-modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? (
                <RefreshCw size={16} className="spin" />
              ) : (
                <CheckCheck size={16} />
              )}
              {loading
                ? 'Guardando…'
                : initial
                ? 'Actualizar'
                : 'Guardar proveedor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}