'use client';

import React from 'react';
import { Trash2, AlertTriangle, RefreshCw, X } from 'lucide-react';

/**
 * Modal de confirmación reutilizable para acciones destructivas o de cuidado.
 * Usado en:
 * - Desactivar proveedor
 * - Eliminar factura
 */
type ConfirmModalProps = {
  title: string;
  message: string;
  confirmLabel: string;
  variant?: 'danger' | 'warning';
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export default function ConfirmModal({
  title,
  message,
  confirmLabel,
  variant = 'danger',
  loading = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const icon = variant === 'danger' ? <Trash2 size={26} /> : <AlertTriangle size={26} />;
  return (
    <div
      className="sup-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sup-modal confirm-modal">
        <div className="confirm-body">
          <div className={`confirm-icon-wrap ${variant}`}>{icon}</div>
          <h2>{title}</h2>
          <p>{message}</p>
        </div>
        <div className="confirm-actions">
          <button className="btn-secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button
            className={variant === 'danger' ? 'btn-danger' : 'btn-warning'}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? <RefreshCw size={15} className="spin" /> : icon}
            {loading ? 'Procesando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}