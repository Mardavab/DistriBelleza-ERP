'use client'

import React, { useState, useEffect, useMemo } from 'react';
import {
  Truck, FileText, Plus, Search, Edit2, Trash2, CheckCircle,
  AlertCircle, Clock, XCircle, X, Building2, RefreshCw,
  DollarSign, AlertTriangle, CheckCheck, CreditCard
} from 'lucide-react';
import {
  getSuppliers, createSupplier, updateSupplier, deleteSupplier,
  getSupplierInvoices, createSupplierInvoice, updateSupplierInvoice, updateInvoiceStatus,
  deleteSupplierInvoice, addInvoicePayment, markInvoiceAsPaid,
  type Supplier, type SupplierInvoice
} from '../../app/actions/suppliers';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import './Suppliers.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

const isOverdue = (due: string, status: string) =>
  status === 'pending' && new Date(due + 'T23:59:59') < new Date();

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente', paid: 'Pagada', overdue: 'Vencida', cancelled: 'Cancelada',
};

const StatusBadge = ({ status, dueDate }: { status: string; dueDate?: string }) => {
  const effective = dueDate && isOverdue(dueDate, status) ? 'overdue' : status;
  const icons: Record<string, React.ReactNode> = {
    pending: <Clock size={11} />, paid: <CheckCircle size={11} />,
    overdue: <AlertTriangle size={11} />, cancelled: <XCircle size={11} />,
  };
  return (
    <span className={`status-badge ${effective}`}>
      {icons[effective]} {STATUS_LABELS[effective] ?? effective}
    </span>
  );
};

// ─── ConfirmModal ─────────────────────────────────────────────────────────────

type ConfirmModalProps = {
  title: string;
  message: string;
  confirmLabel: string;
  variant?: 'danger' | 'warning';
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

function ConfirmModal({ title, message, confirmLabel, variant = 'danger', loading = false, onConfirm, onClose }: ConfirmModalProps) {
  const icon = variant === 'danger' ? <Trash2 size={26} /> : <AlertTriangle size={26} />;
  return (
    <div className="sup-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sup-modal confirm-modal">
        <div className="confirm-body">
          <div className={`confirm-icon-wrap ${variant}`}>{icon}</div>
          <h2>{title}</h2>
          <p>{message}</p>
        </div>
        <div className="confirm-actions">
          <button className="btn-secondary" onClick={onClose} disabled={loading}>Cancelar</button>
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

// ─── Modal: Proveedor ─────────────────────────────────────────────────────────

type SupplierModalProps = {
  initial?: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
};

function SupplierModal({ initial, onClose, onSaved }: SupplierModalProps) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    address: initial?.address ?? '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const capitalizedName = form.name.trim().charAt(0).toUpperCase() + form.name.trim().slice(1);
    const dataToSubmit = { ...form, name: capitalizedName || form.name };

    const res = initial
      ? await updateSupplier(initial.id, dataToSubmit)
      : await createSupplier(dataToSubmit);
    setLoading(false);
    if (!res.success) { setError(res.error ?? 'Error desconocido'); return; }
    onSaved();
  };

  return (
    <div className="sup-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sup-modal">
        <div className="sup-modal-header">
          <div>
            <h2>{initial ? 'Editar Proveedor' : 'Nuevo Proveedor'}</h2>
            <p>Registra los datos del proveedor</p>
          </div>
          <button className="btn-close" onClick={onClose}><X size={20} /></button>
        </div>

        {error && <div className="sup-alert error" style={{ marginBottom: 16 }}><AlertCircle size={16} /> {error}</div>}

        <form className="sup-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="sup-name">Nombre del proveedor *</label>
            <input id="sup-name" value={form.name} onChange={set('name')} placeholder="Ej: Distribuidora Belleza S.A." required />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="sup-phone">Teléfono</label>
              <input id="sup-phone" value={form.phone} onChange={set('phone')} placeholder="Ej: 310 000 0000" />
            </div>
            <div className="form-group">
              <label htmlFor="sup-email">Correo</label>
              <input id="sup-email" type="email" value={form.email} onChange={set('email')} placeholder="correo@proveedor.com" />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="sup-address">Dirección</label>
            <input id="sup-address" value={form.address} onChange={set('address')} placeholder="Ej: Calle 45 # 23-10, Bogotá" />
          </div>

          <div className="sup-modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? <RefreshCw size={16} className="spin" /> : <CheckCheck size={16} />}
              {loading ? 'Guardando…' : initial ? 'Actualizar' : 'Guardar proveedor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal: Factura ───────────────────────────────────────────────────────────

type InvoiceModalProps = {
  initial?: SupplierInvoice | null;
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: () => void;
};

function InvoiceModal({ initial, suppliers, onClose, onSaved }: InvoiceModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    supplier_id: initial?.supplier_id ?? '',
    invoice_number: initial?.invoice_number ?? '',
    issue_date: initial?.issue_date ?? today,
    due_date: initial?.due_date ?? '',
    amount: initial?.amount ? new Intl.NumberFormat('es-CO').format(initial.amount) : '',
    description: initial?.description ?? '',
    billed_to: initial?.billed_to ?? '',
    invoice_type: initial?.invoice_type ?? 'remision',
  });
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const fd = new FormData();
    fd.append('supplier_id', form.supplier_id);
    fd.append('invoice_number', form.invoice_number);
    fd.append('issue_date', form.issue_date);
    fd.append('due_date', form.due_date);
    fd.append('amount', parseFloat(form.amount.replace(/\./g, '').replace(',', '.')).toString());
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
    if (!res.success) { setError(res.error ?? 'Error desconocido'); return; }
    onSaved();
  };

  return (
    <div className="sup-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sup-modal">
        <div className="sup-modal-header">
          <div>
            <h2>{initial ? 'Editar Factura' : 'Nueva Factura de Proveedor'}</h2>
            <p>Registra los detalles de la factura</p>
          </div>
          <button className="btn-close" onClick={onClose}><X size={20} /></button>
        </div>

        {error && <div className="sup-alert error" style={{ marginBottom: 16 }}><AlertCircle size={16} /> {error}</div>}

        <form className="sup-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="inv-supplier">Proveedor *</label>
              <select id="inv-supplier" value={form.supplier_id} onChange={set('supplier_id')} required>
                <option value="">— Seleccionar proveedor —</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="inv-number">N° Factura</label>
              <input id="inv-number" value={form.invoice_number} onChange={set('invoice_number')} placeholder="Ej: FAC-0001" />
            </div>
            <div className="form-group">
              <label htmlFor="inv-amount">Valor *</label>
              <input
                id="inv-amount"
                value={form.amount}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  const formatted = val ? new Intl.NumberFormat('es-CO').format(parseInt(val, 10)) : '';
                  setForm(prev => ({ ...prev, amount: formatted }));
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
              <input id="inv-issue" type="date" value={form.issue_date} onChange={set('issue_date')} required />
            </div>
            <div className="form-group">
              <label htmlFor="inv-due">Fecha de Vencimiento *</label>
              <input id="inv-due" type="date" value={form.due_date} onChange={set('due_date')} required />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="inv-billed-to">A nombre de quién</label>
              <select id="inv-billed-to" value={form.billed_to} onChange={set('billed_to')}>
                <option value="">— Seleccionar —</option>
                <option value="Norby">Norby</option>
                <option value="Marlon">Marlon</option>
                <option value="Otros">Otros</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="inv-type">Tipo de Factura</label>
              <select id="inv-type" value={form.invoice_type} onChange={set('invoice_type')}>
                <option value="remision">Remisión</option>
                <option value="electronica">Electrónica</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="inv-desc">Descripción <span style={{ color: '#94a3b8', fontWeight: 400 }}>(opcional)</span></label>
            <textarea
              id="inv-desc"
              value={form.description}
              onChange={set('description')}
              placeholder="Ej: Compra de productos capilares - lote junio"
              rows={2}
            />
          </div>

          <div className="form-group">
            <label htmlFor="inv-file">Foto / Archivo de Factura <span style={{ color: '#94a3b8', fontWeight: 400 }}>(opcional)</span></label>
            <input 
              type="file" 
              id="inv-file" 
              accept="image/*,.pdf" 
              onChange={e => setFile(e.target.files?.[0] || null)} 
              className="file-input"
            />
          </div>

          <div className="sup-modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? <RefreshCw size={16} className="spin" /> : (initial ? <Edit2 size={16} /> : <Plus size={16} />)}
              {loading ? 'Guardando…' : (initial ? 'Actualizar factura' : 'Registrar factura')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal: Abono ────────────────────────────────────────────────────────────

type AbonoModalProps = {
  invoice: SupplierInvoice;
  onClose: () => void;
  onSaved: () => void;
};

function AbonoModal({ invoice, onClose, onSaved }: AbonoModalProps) {
  const paid    = Number(invoice.paid_amount ?? 0);
  const total   = Number(invoice.amount);
  const pending = total - paid;
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount.replace(/\./g, ''));
    if (!val || val <= 0) { setError('Ingresa un valor mayor a cero.'); return; }
    setLoading(true); setError(null);
    const res = await addInvoicePayment(invoice.id, val);
    setLoading(false);
    if (!res.success) { setError(res.error ?? 'Error desconocido'); return; }
    onSaved();
  };

  const pct = Math.min(100, (paid / total) * 100);

  return (
    <div className="sup-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sup-modal" style={{ maxWidth: 420 }}>
        <div className="sup-modal-header">
          <div>
            <h2>Registrar Abono</h2>
            <p>{invoice.supplier_name} · {invoice.invoice_number ?? 'Sin N°'}</p>
          </div>
          <button className="btn-close" onClick={onClose}><X size={20} /></button>
        </div>

        {/* Progress */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#64748b', marginBottom: 8 }}>
            <span>Abonado: <strong style={{ color: '#6366f1' }}>{fmt(paid)}</strong></span>
            <span>Total: <strong style={{ color: '#0f172a' }}>{fmt(total)}</strong></span>
          </div>
          <div className="abono-bar-wrap">
            <div className="abono-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="abono-info" style={{ textAlign: 'right', marginTop: 6 }}>
            Saldo pendiente: <strong style={{ color: pending > 0 ? '#b45309' : '#15803d' }}>{fmt(pending)}</strong>
          </p>
        </div>

        {error && <div className="sup-alert error" style={{ marginBottom: 16 }}><AlertCircle size={16} />{error}</div>}

        <form className="sup-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="abono-amount">Valor del abono *</label>
            <input
              id="abono-amount"
              type="text"
              value={amount}
              onChange={e => {
                const val = e.target.value.replace(/\D/g, '');
                const formatted = val ? new Intl.NumberFormat('es-CO').format(parseInt(val, 10)) : '';
                setAmount(formatted);
              }}
              placeholder={`Máx. ${fmt(pending)}`}
              required
              autoFocus
            />
          </div>
          <div className="sup-modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
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

// ─── Modal: Confirmar Pago ────────────────────────────────────────────────────

type PayConfirmModalProps = {
  invoice: SupplierInvoice;
  onClose: () => void;
  onSaved: () => void;
};

function PayConfirmModal({ invoice, onClose, onSaved }: PayConfirmModalProps) {
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
    if (!res.success) { setError(res.error ?? 'Error desconocido'); return; }
    onSaved();
  };

  return (
    <div className="sup-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sup-modal" style={{ maxWidth: 450 }}>
        <div className="sup-modal-header">
          <div>
            <h2>Confirmar Pago</h2>
            <p>Factura de {invoice.supplier_name}</p>
          </div>
          <button className="btn-close" onClick={onClose}><X size={20} /></button>
        </div>

        {error && <div className="sup-alert error" style={{ marginBottom: 16 }}><AlertCircle size={16} /> {error}</div>}

        <form className="sup-form" onSubmit={handleSubmit}>
          <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '12px', marginBottom: '8px', border: '1px solid #e2e8f0' }}>
             <p style={{ margin: '0 0 8px 0', fontSize: '0.875rem', color: '#64748b' }}>Vas a marcar como pagada esta factura:</p>
             <h3 style={{ margin: '0 0 4px 0', color: '#0f172a', fontSize: '1.2rem' }}>{fmt(Number(invoice.amount))}</h3>
             <p style={{ margin: 0, fontSize: '0.875rem', color: '#334155' }}>N°: {invoice.invoice_number || 'Sin número'}</p>
          </div>

          <div className="form-group">
            <label htmlFor="rcpt-file">Comprobante de Pago <span style={{ color: '#94a3b8', fontWeight: 400 }}>(opcional)</span></label>
            <input 
              type="file" 
              id="rcpt-file" 
              accept="image/*,.pdf" 
              onChange={e => setFile(e.target.files?.[0] || null)} 
              className="file-input"
            />
          </div>

          <div className="sup-modal-actions" style={{ marginTop: '16px' }}>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={loading} style={{ background: '#16a34a' }}>
              {loading ? <RefreshCw size={16} className="spin" /> : <CheckCircle size={16} />}
              {loading ? 'Procesando…' : 'Marcar como pagada'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal: Reporte PDF ───────────────────────────────────────────────────────

type ReportModalProps = {
  invoices: SupplierInvoice[];
  onClose: () => void;
};

function ReportModal({ invoices, onClose }: ReportModalProps) {
  const today = new Date();
  const [reportType, setReportType] = useState<'month' | 'year'>('month');
  const [selectedMonth, setSelectedMonth] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);
  const [selectedYear, setSelectedYear] = useState(today.getFullYear().toString());

  const handleGeneratePDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // BACKGROUND & BRANDING
    doc.setFillColor(248, 250, 252); // slate-50
    doc.rect(0, 0, pageWidth, 40, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.setTextColor(99, 102, 241); // Indigo-500
    doc.text('DISTRIBELLEZA', 14, 25);

    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text('REPORTE DE PROVEEDORES Y FACTURAS', 14, 32);

    const titleDate = reportType === 'month' ? selectedMonth : selectedYear;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    doc.text(`Periodo: ${titleDate}`, pageWidth - 14, 25, { align: 'right' });
    doc.text(`Generado: ${new Date().toLocaleDateString('es-CO')}`, pageWidth - 14, 32, { align: 'right' });

    // Filter invoices by simple string matching (YYYY-MM or YYYY)
    const filtered = invoices.filter(inv => {
      if (!inv.issue_date) return false;
      if (reportType === 'month') {
        return inv.issue_date.startsWith(selectedMonth);
      } else {
        return inv.issue_date.startsWith(selectedYear);
      }
    });

    const norby: SupplierInvoice[] = [];
    const marlon: SupplierInvoice[] = [];
    const otros: SupplierInvoice[] = [];

    filtered.forEach(inv => {
      const b = (inv.billed_to || '').toLowerCase();
      if (b.includes('norby')) norby.push(inv);
      else if (b.includes('marlon')) marlon.push(inv);
      else otros.push(inv);
    });

    const totalNorby = norby.reduce((s, i) => s + Number(i.amount), 0);
    const totalMarlon = marlon.reduce((s, i) => s + Number(i.amount), 0);
    const totalOtros = otros.reduce((s, i) => s + Number(i.amount), 0);
    const grandTotal = totalNorby + totalMarlon + totalOtros;

    // CARDS SECTION
    const cardWidth = (pageWidth - 40) / 3;

    // Card 1
    doc.setFillColor(239, 246, 255);
    doc.roundedRect(14, 50, cardWidth, 25, 3, 3, 'F');
    doc.setFontSize(8); doc.setTextColor(59, 130, 246); doc.setFont('helvetica', 'bold');
    doc.text('TOTAL NORBY', 18, 58);
    doc.setFontSize(14); doc.text(`$${totalNorby.toLocaleString('es-CO')}`, 18, 68);

    // Card 2
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(14 + cardWidth + 6, 50, cardWidth, 25, 3, 3, 'F');
    doc.setFontSize(8); doc.setTextColor(22, 163, 74); 
    doc.text('TOTAL MARLON', 18 + cardWidth + 6, 58);
    doc.setFontSize(14); doc.text(`$${totalMarlon.toLocaleString('es-CO')}`, 18 + cardWidth + 6, 68);

    // Card 3
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14 + (cardWidth * 2) + 12, 50, cardWidth, 25, 3, 3, 'F');
    doc.setFontSize(8); doc.setTextColor(100, 116, 139); 
    doc.text('TOTAL OTROS', 18 + (cardWidth * 2) + 12, 58);
    doc.setFontSize(14); doc.text(`$${totalOtros.toLocaleString('es-CO')}`, 18 + (cardWidth * 2) + 12, 68);

    let startY = 85;

    const renderGroup = (title: string, data: SupplierInvoice[]) => {
      if (data.length === 0) return;
      doc.setFontSize(12);
      doc.setTextColor(30, 41, 59);
      doc.setFont('helvetica', 'bold');
      doc.text(title, 14, startY);
      
      autoTable(doc, {
        startY: startY + 5,
        head: [['Proveedor', 'N° Factura', 'Expedición', 'Valor', 'Estado']],
        body: data.map(i => [
          i.supplier_name ?? '-',
          i.invoice_number || '-',
          fmtDate(i.issue_date),
          `$${Number(i.amount).toLocaleString('es-CO')}`,
          STATUS_LABELS[i.status] ?? i.status
        ]),
        headStyles: { fillColor: [99, 102, 241] },
        margin: { left: 14, right: 14 },
      });
      startY = (doc as any).lastAutoTable.finalY + 15;
      
      if (startY > 250) {
        doc.addPage();
        startY = 20;
      }
    };

    renderGroup('Detalle Facturas: Norby', norby);
    renderGroup('Detalle Facturas: Marlon', marlon);
    renderGroup('Detalle Facturas: Otros', otros);

    // FINAL SUMMARY BOX
    const lastY = startY;
    if (lastY > 260) { doc.addPage(); startY = 20; }
    
    doc.setFillColor(15, 23, 42);
    doc.roundedRect(14, lastY, pageWidth - 28, 25, 4, 4, 'F');

    doc.setTextColor(148, 163, 184);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('TOTAL GENERAL ACUMULADO (TODAS LAS FACTURAS)', 24, lastY + 10);

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(`$${grandTotal.toLocaleString('es-CO')}`, 24, lastY + 20);

    // Footer
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text('Distri Belleza ERP - Reporte generado automáticamente.', pageWidth / 2, 285, { align: 'center' });

    doc.save(`Reporte_Proveedores_${titleDate}.pdf`);
    onClose();
  };

  return (
    <div className="sup-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sup-modal" style={{ maxWidth: 400 }}>
        <div className="sup-modal-header">
          <div>
            <h2>Generar Reporte PDF</h2>
            <p>Agrupado por Norby, Marlon y Otros</p>
          </div>
          <button className="btn-close" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="sup-form">
          <div className="form-group">
            <label>Tipo de Reporte</label>
            <div style={{ display: 'flex', gap: 10 }}>
              <button 
                type="button"
                onClick={() => setReportType('month')}
                className={reportType === 'month' ? 'btn-primary' : 'btn-secondary'}
                style={{ flex: 1 }}
              >Mes</button>
              <button 
                type="button"
                onClick={() => setReportType('year')}
                className={reportType === 'year' ? 'btn-primary' : 'btn-secondary'}
                style={{ flex: 1 }}
              >Año</button>
            </div>
          </div>

          {reportType === 'month' ? (
            <div className="form-group">
              <label htmlFor="rep-month">Día del Mes Deseado</label>
              <input 
                id="rep-month" 
                type="date" 
                value={selectedMonth ? `${selectedMonth}-01` : ''} 
                onChange={e => {
                  if (e.target.value) setSelectedMonth(e.target.value.substring(0, 7));
                }} 
              />
              <span style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 4, display: 'block' }}>Selecciona cualquier fecha para indicar el mes.</span>
            </div>
          ) : (
            <div className="form-group">
              <label htmlFor="rep-year">Año</label>
              <select 
                id="rep-year" 
                value={selectedYear} 
                onChange={e => setSelectedYear(e.target.value)} 
              >
                {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}

          <div className="sup-modal-actions" style={{ marginTop: 16 }}>
            <button className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button className="btn-primary" onClick={handleGeneratePDF}>
              <FileText size={16} /> Descargar PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Proveedores ─────────────────────────────────────────────────────────

function SuppliersTab({ suppliers, loading, onRefresh }: { suppliers: Supplier[]; loading: boolean; onRefresh: () => void }) {
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<null | 'new' | Supplier>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<Supplier | null>(null);

  const filtered = useMemo(() =>
    suppliers.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.phone ?? '').includes(search) || (s.email ?? '').toLowerCase().includes(search.toLowerCase())),
    [suppliers, search]);

  const handleDeleteConfirmed = async () => {
    if (!confirmTarget) return;
    setDeleting(true);
    await deleteSupplier(confirmTarget.id);
    setDeleting(false);
    setConfirmTarget(null);
    onRefresh();
  };

  return (
    <>
      <div className="sup-toolbar">
        <div className="sup-search-wrap">
          <Search size={16} />
          <input
            id="suppliers-search"
            className="sup-search-input"
            placeholder="Buscar proveedor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button className="btn-primary" id="btn-new-supplier" onClick={() => setModal('new')}>
          <Plus size={16} /> Nuevo Proveedor
        </button>
      </div>

      <div className="sup-table-wrap">
        {loading ? (
          <div className="sup-empty"><RefreshCw size={32} className="spin" /><p>Cargando proveedores…</p></div>
        ) : filtered.length === 0 ? (
          <div className="sup-empty">
            <Building2 size={48} strokeWidth={1.2} />
            <p><strong>No hay proveedores</strong></p>
            <p>Agrega tu primer proveedor con el botón de arriba.</p>
          </div>
        ) : (
          <table className="sup-table">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>Teléfono</th>
                <th>Correo</th>
                <th>Dirección</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Truck size={16} color="#7c3aed" />
                      </div>
                      <span style={{ fontWeight: 600, color: '#0f172a' }}>{s.name}</span>
                    </div>
                  </td>
                  <td>{s.phone ?? <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                  <td>{s.email ?? <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.address ?? <span style={{ color: '#cbd5e1' }}>—</span>}
                  </td>
                  <td>
                    <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                      <button className="icon-btn" title="Editar" onClick={() => setModal(s)}>
                        <Edit2 size={14} />
                      </button>
                      <button className="icon-btn danger" title="Desactivar" onClick={() => setConfirmTarget(s)}>
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
        <SupplierModal
          initial={modal === 'new' ? null : modal as Supplier}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); onRefresh(); }}
        />
      )}
      {confirmTarget && (
        <ConfirmModal
          title="¿Desactivar proveedor?"
          message={`"${confirmTarget.name}" desaparecerá de la lista. Sus facturas asociadas se conservan.`}
          confirmLabel="Sí, desactivar"
          variant="warning"
          loading={deleting}
          onConfirm={handleDeleteConfirmed}
          onClose={() => setConfirmTarget(null)}
        />
      )}
    </>
  );
}

// ─── Tab: Facturas ────────────────────────────────────────────────────────────

function InvoicesTab({ invoices, suppliers, loading, onRefresh }: { invoices: SupplierInvoice[]; suppliers: Supplier[]; loading: boolean; onRefresh: () => void }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modal, setModal] = useState<null | 'new' | SupplierInvoice>(null);
  const [sortDueDate, setSortDueDate] = useState<'asc' | 'desc' | null>(null);

  const filtered = useMemo(() => {
    let list = invoices.map(inv => ({
      ...inv,
      effectiveStatus: isOverdue(inv.due_date, inv.status) ? 'overdue' : inv.status,
    }));
    if (statusFilter !== 'all') list = list.filter(i => i.effectiveStatus === statusFilter);
    if (search) list = list.filter(i =>
      i.supplier_name?.toLowerCase().includes(search.toLowerCase()) ||
      (i.invoice_number ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (i.description ?? '').toLowerCase().includes(search.toLowerCase())
    );
    if (sortDueDate) {
      list.sort((a, b) => {
        const da = new Date(a.due_date).getTime();
        const db = new Date(b.due_date).getTime();
        return sortDueDate === 'asc' ? da - db : db - da;
      });
    }
    return list;
  }, [invoices, statusFilter, search, sortDueDate]);

  const [abonoInvoice, setAbonoInvoice] = useState<SupplierInvoice | null>(null);
  const [payInvoice, setPayInvoice] = useState<SupplierInvoice | null>(null);
  const [confirmInvoice, setConfirmInvoice] = useState<SupplierInvoice | null>(null);
  const [deletingInv, setDeletingInv] = useState(false);

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
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="sup-filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">Todos los estados</option>
          <option value="pending">Pendientes</option>
          <option value="paid">Pagadas</option>
          <option value="overdue">Vencidas</option>
          <option value="cancelled">Canceladas</option>
        </select>
        <button className="btn-primary" id="btn-new-invoice" onClick={() => setModal('new')}>
          <Plus size={16} /> Nueva Factura
        </button>
      </div>

      <div className="sup-table-wrap">
        {loading ? (
          <div className="sup-empty"><RefreshCw size={32} className="spin" /><p>Cargando facturas…</p></div>
        ) : filtered.length === 0 ? (
          <div className="sup-empty">
            <FileText size={48} strokeWidth={1.2} />
            <p><strong>Sin facturas</strong></p>
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
                  onClick={() => setSortDueDate(prev => prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc')}
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
              {filtered.map(inv => (
                <tr key={inv.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 30, height: 30, borderRadius: 6, background: '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Truck size={14} color="#7c3aed" />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 500 }}>{inv.supplier_name}</span>
                        {inv.billed_to && <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Para: {inv.billed_to}</span>}
                      </div>
                    </div>
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#6366f1' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span>{inv.invoice_number ?? <span style={{ color: '#cbd5e1' }}>—</span>}</span>
                      <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4, background: inv.invoice_type === 'electronica' ? '#dbeafe' : '#f1f5f9', color: inv.invoice_type === 'electronica' ? '#1d4ed8' : '#475569', width: 'fit-content' }}>
                        {inv.invoice_type === 'electronica' ? 'Electrónica' : 'Remisión'}
                      </span>
                    </div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(inv.issue_date)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ color: isOverdue(inv.due_date, inv.status) ? '#dc2626' : 'inherit', fontWeight: isOverdue(inv.due_date, inv.status) ? 600 : 400 }}>
                      {fmtDate(inv.due_date)}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{fmt(inv.amount)}</div>
                    {Number(inv.paid_amount ?? 0) > 0 && inv.status !== 'paid' && (
                      <>
                        <div className="abono-bar-wrap">
                          <div className="abono-bar-fill" style={{ width: `${Math.min(100,(Number(inv.paid_amount)/Number(inv.amount))*100)}%` }} />
                        </div>
                        <div className="abono-info">Abonado: {fmt(Number(inv.paid_amount ?? 0))}</div>
                      </>
                    )}
                  </td>
                  <td><StatusBadge status={inv.status} dueDate={inv.due_date} /></td>
                  <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#64748b', fontSize: '0.8rem' }}>
                    {inv.description ?? <span style={{ color: '#cbd5e1' }}>—</span>}
                    {(inv.invoice_file_url || inv.receipt_file_url) && (
                      <div style={{ marginTop: '6px', display: 'flex', gap: '8px', fontSize: '0.75rem' }}>
                        {inv.invoice_file_url && <a href={inv.invoice_file_url} target="_blank" rel="noreferrer" style={{ color: '#6366f1', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><FileText size={12}/> Factura</a>}
                        {inv.receipt_file_url && <a href={inv.receipt_file_url} target="_blank" rel="noreferrer" style={{ color: '#16a34a', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><FileText size={12}/> Comprobante</a>}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                      <button className="icon-btn" title="Editar" onClick={() => setModal(inv)}>
                        <Edit2 size={14} />
                      </button>
                      {inv.effectiveStatus !== 'paid' && inv.effectiveStatus !== 'cancelled' && (
                        <>
                          <button className="icon-btn abono" title="Registrar abono" onClick={() => setAbonoInvoice(inv)}>
                            <CreditCard size={14} />
                          </button>
                          <button className="icon-btn success" title="Marcar como pagada completa" onClick={() => setPayInvoice(inv)}>
                            <CheckCircle size={14} />
                          </button>
                        </>
                      )}
                      <button className="icon-btn danger" title="Eliminar" onClick={() => setConfirmInvoice(inv)}>
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
          initial={modal === 'new' ? null : modal as SupplierInvoice}
          suppliers={suppliers}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); onRefresh(); }}
        />
      )}
      {abonoInvoice && (
        <AbonoModal
          invoice={abonoInvoice}
          onClose={() => setAbonoInvoice(null)}
          onSaved={() => { setAbonoInvoice(null); onRefresh(); }}
        />
      )}
      {payInvoice && (
        <PayConfirmModal
          invoice={payInvoice}
          onClose={() => setPayInvoice(null)}
          onSaved={() => { setPayInvoice(null); onRefresh(); }}
        />
      )}
      {confirmInvoice && (
        <ConfirmModal
          title="¿Eliminar factura?"
          message={`Se eliminará la factura de "${confirmInvoice.supplier_name}" por ${fmt(confirmInvoice.amount)}. Esta acción no se puede deshacer.`}
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

// ─── Root Component ───────────────────────────────────────────────────────────

export default function SuppliersView() {
  const [tab, setTab] = useState<'suppliers' | 'invoices'>('suppliers');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invoices, setInvoices]   = useState<SupplierInvoice[]>([]);
  const [loadingS, setLoadingS]   = useState(true);
  const [loadingI, setLoadingI]   = useState(true);
  const [showReportModal, setShowReportModal] = useState(false);

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

  useEffect(() => { loadSuppliers(); loadInvoices(); }, []);

  // ── KPIs ──
  const pendingInvoices  = invoices.filter(i => i.status === 'pending' && !isOverdue(i.due_date, i.status));
  const overdueInvoices  = invoices.filter(i => isOverdue(i.due_date, i.status));
  const totalPending     = pendingInvoices.reduce((s, i) => s + (Number(i.amount) - Number(i.paid_amount ?? 0)), 0);
  const totalOverdue     = overdueInvoices.reduce((s, i) => s + (Number(i.amount) - Number(i.paid_amount ?? 0)), 0);

  return (
    <div className="suppliers-root">
      {/* Header */}
      <div className="suppliers-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="suppliers-title-block">
          <h1>Proveedores</h1>
          <p>Gestiona tus proveedores y el seguimiento de facturas</p>
        </div>
        <button 
          className="btn-secondary" 
          onClick={() => setShowReportModal(true)} 
          style={{ color: '#0f172a', background: '#fff', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', height: 40 }}
        >
          <FileText size={16} color="#6366f1" /> Generar Reporte
        </button>
      </div>

      {/* KPIs */}
      <div className="suppliers-kpi-row">
        <div className="sup-kpi-card">
          <div className="sup-kpi-icon purple"><Truck size={22} /></div>
          <div>
            <p className="sup-kpi-label">Proveedores activos</p>
            <p className="sup-kpi-value">{suppliers.length}</p>
          </div>
        </div>
        <div className="sup-kpi-card">
          <div className="sup-kpi-icon amber"><Clock size={22} /></div>
          <div>
            <p className="sup-kpi-label">Por pagar</p>
            <p className="sup-kpi-value">{fmt(totalPending)}</p>
          </div>
        </div>
        <div className="sup-kpi-card">
          <div className="sup-kpi-icon red"><AlertTriangle size={22} /></div>
          <div>
            <p className="sup-kpi-label">Facturas vencidas</p>
            <p className="sup-kpi-value" style={{ color: overdueInvoices.length > 0 ? '#dc2626' : undefined }}>
              {fmt(totalOverdue)}
            </p>
          </div>
        </div>
        <div className="sup-kpi-card">
          <div className="sup-kpi-icon green"><FileText size={22} /></div>
          <div>
            <p className="sup-kpi-label">Total facturas</p>
            <p className="sup-kpi-value">{invoices.length}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
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
            <span style={{ background: '#dc2626', color: '#fff', fontSize: '0.65rem', fontWeight: 700, borderRadius: 99, padding: '1px 6px', marginLeft: 2 }}>
              {overdueInvoices.length}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      {tab === 'suppliers' ? (
        <SuppliersTab suppliers={suppliers} loading={loadingS} onRefresh={loadSuppliers} />
      ) : (
        <InvoicesTab invoices={invoices} suppliers={suppliers} loading={loadingI} onRefresh={loadInvoices} />
      )}

      {showReportModal && (
        <ReportModal invoices={invoices} onClose={() => setShowReportModal(false)} />
      )}
    </div>
  );
}
