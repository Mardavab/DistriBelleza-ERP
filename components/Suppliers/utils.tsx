/**
 * Helpers compartidos entre los componentes del módulo de Proveedores.
 */

import React from 'react';
import { Clock, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

export const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  paid: 'Pagada',
  overdue: 'Vencida',
  cancelled: 'Cancelada',
};

/**
 * Determina si una factura está vencida (fecha de vencimiento pasada y estado pending).
 */
export const isOverdue = (due: string, status: string): boolean =>
  status === 'pending' && new Date(due + 'T23:59:59') < new Date();

/**
 * Badge visual de estado de factura.
 * Si está vencida, marca como 'overdue' aunque el status original sea 'pending'.
 */
export function StatusBadge({ status, dueDate }: { status: string; dueDate?: string }) {
  const effective = dueDate && isOverdue(dueDate, status) ? 'overdue' : status;
  const icons: Record<string, React.ReactNode> = {
    pending: <Clock size={11} />,
    paid: <CheckCircle size={11} />,
    overdue: <AlertTriangle size={11} />,
    cancelled: <XCircle size={11} />,
  };
  return (
    <span className={`status-badge ${effective}`}>
      {icons[effective]} {STATUS_LABELS[effective] ?? effective}
    </span>
  );
}