'use client';

import React from 'react';
import { Truck, Clock, AlertTriangle, FileText } from 'lucide-react';
import { formatCurrency } from '../../lib/format';
import { isOverdue } from './utils';
import type { SupplierInvoice } from '../../app/actions/suppliers';

type KpiCardsProps = {
  suppliers: { id: string }[];
  invoices: SupplierInvoice[];
};

/**
 * Cards de KPI (Proveedores activos, Por pagar, Vencidas, Total facturas).
 */
export default function KpiCards({ suppliers, invoices }: KpiCardsProps) {
  const pendingInvoices = invoices.filter(
    (i) => i.status === 'pending' && !isOverdue(i.due_date, i.status),
  );
  const overdueInvoices = invoices.filter((i) => isOverdue(i.due_date, i.status));
  const totalPending = pendingInvoices.reduce(
    (s, i) => s + (Number(i.amount) - Number(i.paid_amount ?? 0)),
    0,
  );
  const totalOverdue = overdueInvoices.reduce(
    (s, i) => s + (Number(i.amount) - Number(i.paid_amount ?? 0)),
    0,
  );

  return (
    <div className="suppliers-kpi-row">
      <div className="sup-kpi-card">
        <div className="sup-kpi-icon purple">
          <Truck size={22} />
        </div>
        <div>
          <p className="sup-kpi-label">Proveedores activos</p>
          <p className="sup-kpi-value">{suppliers.length}</p>
        </div>
      </div>
      <div className="sup-kpi-card">
        <div className="sup-kpi-icon amber">
          <Clock size={22} />
        </div>
        <div>
          <p className="sup-kpi-label">Por pagar</p>
          <p className="sup-kpi-value">{formatCurrency(totalPending)}</p>
        </div>
      </div>
      <div className="sup-kpi-card">
        <div className="sup-kpi-icon red">
          <AlertTriangle size={22} />
        </div>
        <div>
          <p className="sup-kpi-label">Facturas vencidas</p>
          <p
            className="sup-kpi-value"
            style={{ color: overdueInvoices.length > 0 ? '#dc2626' : undefined }}
          >
            {formatCurrency(totalOverdue)}
          </p>
        </div>
      </div>
      <div className="sup-kpi-card">
        <div className="sup-kpi-icon green">
          <FileText size={22} />
        </div>
        <div>
          <p className="sup-kpi-label">Total facturas</p>
          <p className="sup-kpi-value">{invoices.length}</p>
        </div>
      </div>
    </div>
  );
}