'use client';

import React, { useEffect, useState } from 'react';
import { Truck, FileText, Building2 } from 'lucide-react';
import {
  getSuppliers,
  getSupplierInvoices,
  type Supplier,
  type SupplierInvoice,
} from '../../app/actions/suppliers';
import { getBilledToOptions } from '../../app/actions/settings';
import { warnSilently } from '../../lib/errors';
import KpiCards from './KpiCards';
import SuppliersTab from './SuppliersTab';
import InvoicesTab from './InvoicesTab';
import ReportModal from './ReportModal';
import { isOverdue } from './utils';
import './Suppliers.css';

/**
 * Vista principal del módulo de Proveedores.
 *
 * Layout:
 *   - Header unificado (page-header)
 *   - 4 KPI cards
 *   - Tabs: Proveedores / Facturas (con badge de vencidas)
 *   - Contenido del tab activo
 *   - Modal de generación de reporte PDF
 */
export default function SuppliersView() {
  const [tab, setTab] = useState<'suppliers' | 'invoices'>('suppliers');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [loadingS, setLoadingS] = useState(true);
  const [loadingI, setLoadingI] = useState(true);
  const [showReportModal, setShowReportModal] = useState(false);
  const [billedToOptions, setBilledToOptions] = useState<string[]>([
    'Norby',
    'Marlon',
    'Otros',
  ]);

  const loadSuppliers = async () => {
    setLoadingS(true);
    const res = await getSuppliers();
    if (res.success) setSuppliers(res.data ?? []);
    setLoadingS(false);
  };

  const loadInvoices = async () => {
    setLoadingI(true);
    const res = await getSupplierInvoices();
    if (res.success) setInvoices(res.data ?? []);
    setLoadingI(false);
  };

  useEffect(() => {
    loadSuppliers();
    loadInvoices();
  }, []);

  useEffect(() => {
    getBilledToOptions()
      .then(setBilledToOptions)
      .catch((e) => warnSilently('SuppliersView.billedTo', e));
  }, []);

  const overdueInvoices = invoices.filter((i) => isOverdue(i.due_date, i.status));

  return (
    <div className="suppliers-root">
      <header className="page-header">
        <div className="page-header-group">
          <div className="page-title-icon">
            <Truck size={28} />
          </div>
          <div className="page-title-block">
            <h1>Proveedores</h1>
            <p>Gestiona tus proveedores y el seguimiento de facturas</p>
          </div>
        </div>
        <button
          className="btn-secondary"
          onClick={() => setShowReportModal(true)}
          style={{
            color: 'var(--color-text)',
            background: 'var(--bg-card)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-xs)',
            height: 42,
          }}
        >
          <FileText size={16} color="var(--color-primary)" /> Generar Reporte
        </button>
      </header>

      <KpiCards suppliers={suppliers} invoices={invoices} />

      <div className="suppliers-tabs">
        <button
          id="tab-suppliers"
          className={`sup-tab-btn ${tab === 'suppliers' ? 'active' : ''}`}
          onClick={() => setTab('suppliers')}
        >
          <Building2 size={16} /> Proveedores
        </button>
        <button
          id="tab-invoices"
          className={`sup-tab-btn ${tab === 'invoices' ? 'active' : ''}`}
          onClick={() => setTab('invoices')}
        >
          <FileText size={16} /> Facturas
          {overdueInvoices.length > 0 && (
            <span
              style={{
                background: '#dc2626',
                color: '#fff',
                fontSize: '0.65rem',
                fontWeight: 700,
                borderRadius: 99,
                padding: '1px 6px',
                marginLeft: 2,
              }}
            >
              {overdueInvoices.length}
            </span>
          )}
        </button>
      </div>

      {tab === 'suppliers' ? (
        <SuppliersTab suppliers={suppliers} loading={loadingS} onRefresh={loadSuppliers} />
      ) : (
        <InvoicesTab
          invoices={invoices}
          suppliers={suppliers}
          loading={loadingI}
          onRefresh={loadInvoices}
          billedToOptions={billedToOptions}
        />
      )}

      {showReportModal && (
        <ReportModal
          invoices={invoices}
          onClose={() => setShowReportModal(false)}
        />
      )}
    </div>
  );
}