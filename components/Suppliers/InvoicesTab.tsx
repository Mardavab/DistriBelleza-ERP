'use client';

import React, { useMemo, useState } from 'react';
import {
  Search,
  Plus,
  Edit2,
  Trash2,
  FileText,
  Truck,
  CreditCard,
  CheckCircle,
  RefreshCw,
} from 'lucide-react';
import type { Supplier, SupplierInvoice } from '../../app/actions/suppliers';
import { deleteSupplierInvoice } from '../../app/actions/suppliers';
import { formatCurrency, formatDate } from '../../lib/format';
import { StatusBadge, isOverdue } from './utils';
import InvoiceModal from './InvoiceModal';
import AbonoModal from './AbonoModal';
import PayConfirmModal from './PayConfirmModal';
import ConfirmModal from './ConfirmModal';

type InvoicesTabProps = {
  invoices: SupplierInvoice[];
  suppliers: Supplier[];
  loading: boolean;
  onRefresh: () => void;
  billedToOptions?: string[];
};

/**
 * Tab "Facturas": listado con búsqueda, filtro por estado y orden por
 * vencimiento. Acciones: editar / registrar abono / marcar pagada / eliminar.
 */
export default function InvoicesTab({
  invoices,
  suppliers,
  loading,
  onRefresh,
  billedToOptions = ['Norby', 'Marlon', 'Otros'],
}: InvoicesTabProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modal, setModal] = useState<null | 'new' | SupplierInvoice>(null);
  const [sortDueDate, setSortDueDate] = useState<'asc' | 'desc' | null>(null);

  const [abonoInvoice, setAbonoInvoice] = useState<SupplierInvoice | null>(null);
  const [payInvoice, setPayInvoice] = useState<SupplierInvoice | null>(null);
  const [confirmInvoice, setConfirmInvoice] = useState<SupplierInvoice | null>(null);
  const [deletingInv, setDeletingInv] = useState(false);

  const filtered = useMemo(() => {
    let list = invoices.map((inv) => ({
      ...inv,
      effectiveStatus: isOverdue(inv.due_date, inv.status) ? 'overdue' : inv.status,
    }));
    if (statusFilter !== 'all') {
      list = list.filter((i) => i.effectiveStatus === statusFilter);
    }
    if (search) {
      const term = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.supplier_name?.toLowerCase().includes(term) ||
          (i.invoice_number ?? '').toLowerCase().includes(term) ||
          (i.description ?? '').toLowerCase().includes(term),
      );
    }
    if (sortDueDate) {
      list.sort((a, b) => {
        const da = new Date(a.due_date).getTime();
        const db = new Date(b.due_date).getTime();
        return sortDueDate === 'asc' ? da - db : db - da;
      });
    }
    return list;
  }, [invoices, statusFilter, search, sortDueDate]);

  const handleDeleteConfirmed = async () => {
    if (!confirmInvoice) return;
    setDeletingInv(true);
    await deleteSupplierInvoice(confirmInvoice.id);
    setDeletingInv(false);
    setConfirmInvoice(null);
    onRefresh();
  };

  return (
    <>
      <div className="sup-toolbar">
        <div className="sup-search-wrap">
          <Search size={16} />
          <input
            id="invoices-search"
            className="sup-search-input"
            placeholder="Buscar factura o proveedor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="sup-filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">Todos los estados</option>
          <option value="pending">Pendientes</option>
          <option value="paid">Pagadas</option>
          <option value="overdue">Vencidas</option>
          <option value="cancelled">Canceladas</option>
        </select>
        <button
          className="btn-primary"
          id="btn-new-invoice"
          onClick={() => setModal('new')}
        >
          <Plus size={16} /> Nueva Factura
        </button>
      </div>

      <div className="sup-table-wrap">
        {loading ? (
          <div className="sup-empty">
            <RefreshCw size={32} className="spin" />
            <p>Cargando facturas…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="sup-empty">
            <FileText size={48} strokeWidth={1.2} />
            <p>
              <strong>Sin facturas</strong>
            </p>
            <p>Registra facturas de proveedores para hacer seguimiento.</p>
          </div>
        ) : (
          <table className="sup-table">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>N° Factura</th>
                <th>Expedición</th>
                <th
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() =>
                    setSortDueDate((prev) =>
                      prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc',
                    )
                  }
                >
                  Vencimiento {sortDueDate === 'asc' ? '↑' : sortDueDate === 'desc' ? '↓' : ''}
                </th>
                <th>Valor</th>
                <th>Estado</th>
                <th>Descripción</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 6,
                          background: '#ede9fe',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <Truck size={14} color="#7c3aed" />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 500 }}>{inv.supplier_name}</span>
                        {inv.billed_to && (
                          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                            Para: {inv.billed_to}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '0.8rem',
                      color: '#6366f1',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span>
                        {inv.invoice_number ?? <span style={{ color: '#cbd5e1' }}>—</span>}
                      </span>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          padding: '2px 6px',
                          borderRadius: 4,
                          background:
                            inv.invoice_type === 'electronica' ? '#dbeafe' : '#f1f5f9',
                          color: inv.invoice_type === 'electronica' ? '#1d4ed8' : '#475569',
                          width: 'fit-content',
                        }}
                      >
                        {inv.invoice_type === 'electronica' ? 'Electrónica' : 'Remisión'}
                      </span>
                    </div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDate(inv.issue_date)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span
                      style={{
                        color: isOverdue(inv.due_date, inv.status) ? '#dc2626' : 'inherit',
                        fontWeight: isOverdue(inv.due_date, inv.status) ? 600 : 400,
                      }}
                    >
                      {formatDate(inv.due_date)}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>
                      {formatCurrency(inv.amount)}
                    </div>
                    {Number(inv.paid_amount ?? 0) > 0 && inv.status !== 'paid' && (
                      <>
                        <div className="abono-bar-wrap">
                          <div
                            className="abono-bar-fill"
                            style={{
                              width: `${Math.min(
                                100,
                                (Number(inv.paid_amount) / Number(inv.amount)) * 100,
                              )}%`,
                            }}
                          />
                        </div>
                        <div className="abono-info">
                          Abonado: {formatCurrency(Number(inv.paid_amount ?? 0))}
                        </div>
                      </>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={inv.status} dueDate={inv.due_date} />
                  </td>
                  <td
                    style={{
                      maxWidth: 180,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: '#64748b',
                      fontSize: '0.8rem',
                    }}
                  >
                    {inv.description ?? <span style={{ color: '#cbd5e1' }}>—</span>}
                    {(inv.invoice_file_url || inv.receipt_file_url) && (
                      <div
                        style={{
                          marginTop: '6px',
                          display: 'flex',
                          gap: '8px',
                          fontSize: '0.75rem',
                        }}
                      >
                        {inv.invoice_file_url && (
                          <a
                            href={inv.invoice_file_url}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              color: '#6366f1',
                              textDecoration: 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <FileText size={12} /> Factura
                          </a>
                        )}
                        {inv.receipt_file_url && (
                          <a
                            href={inv.receipt_file_url}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              color: '#16a34a',
                              textDecoration: 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <FileText size={12} /> Comprobante
                          </a>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                      <button
                        className="icon-btn"
                        title="Editar"
                        onClick={() => setModal(inv)}
                      >
                        <Edit2 size={14} />
                      </button>
                      {inv.effectiveStatus !== 'paid' && inv.effectiveStatus !== 'cancelled' && (
                        <>
                          <button
                            className="icon-btn abono"
                            title="Registrar abono"
                            onClick={() => setAbonoInvoice(inv)}
                          >
                            <CreditCard size={14} />
                          </button>
                          <button
                            className="icon-btn success"
                            title="Marcar como pagada completa"
                            onClick={() => setPayInvoice(inv)}
                          >
                            <CheckCircle size={14} />
                          </button>
                        </>
                      )}
                      <button
                        className="icon-btn danger"
                        title="Eliminar"
                        onClick={() => setConfirmInvoice(inv)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <InvoiceModal
          initial={modal === 'new' ? null : (modal as SupplierInvoice)}
          suppliers={suppliers}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            onRefresh();
          }}
          billedToOptions={billedToOptions}
        />
      )}
      {abonoInvoice && (
        <AbonoModal
          invoice={abonoInvoice}
          onClose={() => setAbonoInvoice(null)}
          onSaved={() => {
            setAbonoInvoice(null);
            onRefresh();
          }}
        />
      )}
      {payInvoice && (
        <PayConfirmModal
          invoice={payInvoice}
          onClose={() => setPayInvoice(null)}
          onSaved={() => {
            setPayInvoice(null);
            onRefresh();
          }}
        />
      )}
      {confirmInvoice && (
        <ConfirmModal
          title="¿Eliminar factura?"
          message={`Se eliminará la factura de "${confirmInvoice.supplier_name}" por ${formatCurrency(
            confirmInvoice.amount,
          )}. Esta acción no se puede deshacer.`}
          confirmLabel="Sí, eliminar"
          variant="danger"
          loading={deletingInv}
          onConfirm={handleDeleteConfirmed}
          onClose={() => setConfirmInvoice(null)}
        />
      )}
    </>
  );
}