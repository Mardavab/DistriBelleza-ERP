'use client';

import React, { useEffect, useState } from 'react';
import { X, FileText } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { warnSilently } from '../../lib/errors';
import { getPdfBrandingAction } from '../../app/actions/company';
import { formatCurrency, formatDate } from '../../lib/format';
import type { SupplierInvoice } from '../../app/actions/suppliers';
import { STATUS_LABELS } from './utils';

type ReportModalProps = {
  invoices: SupplierInvoice[];
  onClose: () => void;
};

/**
 * Modal para generar un reporte PDF agrupado por "A nombre de quién"
 * (Norby, Marlon, Otros) con totales por grupo y un gran total final.
 */
export default function ReportModal({ invoices, onClose }: ReportModalProps) {
  const today = new Date();
  const [reportType, setReportType] = useState<'month' | 'year'>('month');
  const [selectedMonth, setSelectedMonth] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`,
  );
  const [selectedYear, setSelectedYear] = useState(today.getFullYear().toString());
  const [branding, setBranding] = useState<{ header: string; footer: string }>({
    header: 'ERP',
    footer: 'ERP - Reporte generado automáticamente.',
  });

  // Cargar branding del tenant al montar el modal
  useEffect(() => {
    getPdfBrandingAction()
      .then((b) => setBranding({ header: b.header, footer: b.footer }))
      .catch((e) => warnSilently('ReportModal.branding', e));
  }, []);

  const handleGeneratePDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // ── BACKGROUND & BRANDING ──
    doc.setFillColor(248, 250, 252);
    doc.rect(0, 0, pageWidth, 40, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.setTextColor(99, 102, 241);
    doc.text(branding.header, 14, 25);

    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text('REPORTE DE PROVEEDORES Y FACTURAS', 14, 32);

    const titleDate = reportType === 'month' ? selectedMonth : selectedYear;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    doc.text(`Periodo: ${titleDate}`, pageWidth - 14, 25, { align: 'right' });
    doc.text(
      `Generado: ${new Date().toLocaleDateString('es-CO')}`,
      pageWidth - 14,
      32,
      { align: 'right' },
    );

    // ── Filtrar facturas por periodo ──
    const filtered = invoices.filter((inv) => {
      if (!inv.issue_date) return false;
      if (reportType === 'month') {
        return inv.issue_date.startsWith(selectedMonth);
      }
      return inv.issue_date.startsWith(selectedYear);
    });

    // ── Agrupar por "A nombre de" ──
    const norby: SupplierInvoice[] = [];
    const marlon: SupplierInvoice[] = [];
    const otros: SupplierInvoice[] = [];

    filtered.forEach((inv) => {
      const b = (inv.billed_to || '').toLowerCase();
      if (b.includes('norby')) norby.push(inv);
      else if (b.includes('marlon')) marlon.push(inv);
      else otros.push(inv);
    });

    const totalNorby = norby.reduce((s, i) => s + Number(i.amount), 0);
    const totalMarlon = marlon.reduce((s, i) => s + Number(i.amount), 0);
    const totalOtros = otros.reduce((s, i) => s + Number(i.amount), 0);
    const grandTotal = totalNorby + totalMarlon + totalOtros;

    // ── 3 CARDS: Norby / Marlon / Otros ──
    const cardWidth = (pageWidth - 40) / 3;

    // Card 1 - Norby
    doc.setFillColor(239, 246, 255);
    doc.roundedRect(14, 50, cardWidth, 25, 3, 3, 'F');
    doc.setFontSize(8);
    doc.setTextColor(59, 130, 246);
    doc.setFont('helvetica', 'bold');
    doc.text('TOTAL NORBY', 18, 58);
    doc.setFontSize(14);
    doc.text(formatCurrency(totalNorby), 18, 68);

    // Card 2 - Marlon
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(14 + cardWidth + 6, 50, cardWidth, 25, 3, 3, 'F');
    doc.setFontSize(8);
    doc.setTextColor(22, 163, 74);
    doc.text('TOTAL MARLON', 18 + cardWidth + 6, 58);
    doc.setFontSize(14);
    doc.text(formatCurrency(totalMarlon), 18 + cardWidth + 6, 68);

    // Card 3 - Otros
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14 + cardWidth * 2 + 12, 50, cardWidth, 25, 3, 3, 'F');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('TOTAL OTROS', 18 + cardWidth * 2 + 12, 58);
    doc.setFontSize(14);
    doc.text(formatCurrency(totalOtros), 18 + cardWidth * 2 + 12, 68);

    let startY = 85;

    // ── Tablas por grupo ──
    const renderGroup = (title: string, data: SupplierInvoice[]) => {
      if (data.length === 0) return;
      doc.setFontSize(12);
      doc.setTextColor(30, 41, 59);
      doc.setFont('helvetica', 'bold');
      doc.text(title, 14, startY);

      autoTable(doc, {
        startY: startY + 5,
        head: [['Proveedor', 'N° Factura', 'Expedición', 'Valor', 'Estado']],
        body: data.map((i) => [
          i.supplier_name ?? '-',
          i.invoice_number || '-',
          formatDate(i.issue_date),
          formatCurrency(Number(i.amount)),
          STATUS_LABELS[i.status] ?? i.status,
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

    // ── TOTAL GENERAL ──
    const lastY = startY;
    if (lastY > 260) {
      doc.addPage();
      startY = 20;
    }

    doc.setFillColor(15, 23, 42);
    doc.roundedRect(14, lastY, pageWidth - 28, 25, 4, 4, 'F');

    doc.setTextColor(148, 163, 184);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('TOTAL GENERAL ACUMULADO (TODAS LAS FACTURAS)', 24, lastY + 10);

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(formatCurrency(grandTotal), 24, lastY + 20);

    // Footer
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(branding.footer, pageWidth / 2, 285, { align: 'center' });

    doc.save(`Reporte_Proveedores_${titleDate}.pdf`);
    onClose();
  };

  return (
    <div
      className="sup-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sup-modal" style={{ maxWidth: 400 }}>
        <div className="sup-modal-header">
          <div>
            <h2>Generar Reporte PDF</h2>
            <p>Agrupado por Norby, Marlon y Otros</p>
          </div>
          <button className="btn-close" onClick={onClose}>
            <X size={20} />
          </button>
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
              >
                Mes
              </button>
              <button
                type="button"
                onClick={() => setReportType('year')}
                className={reportType === 'year' ? 'btn-primary' : 'btn-secondary'}
                style={{ flex: 1 }}
              >
                Año
              </button>
            </div>
          </div>

          {reportType === 'month' ? (
            <div className="form-group">
              <label htmlFor="rep-month">Día del Mes Deseado</label>
              <input
                id="rep-month"
                type="date"
                value={selectedMonth ? `${selectedMonth}-01` : ''}
                onChange={(e) => {
                  if (e.target.value) setSelectedMonth(e.target.value.substring(0, 7));
                }}
              />
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--color-text-mute)',
                  marginTop: 4,
                  display: 'block',
                }}
              >
                Selecciona cualquier fecha para indicar el mes.
              </span>
            </div>
          ) : (
            <div className="form-group">
              <label htmlFor="rep-year">Año</label>
              <select
                id="rep-year"
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
              >
                {Array.from(
                  { length: 11 },
                  (_, i) => new Date().getFullYear() - 5 + i,
                ).map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="sup-modal-actions" style={{ marginTop: 16 }}>
            <button className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn-primary" onClick={handleGeneratePDF}>
              <FileText size={16} /> Descargar PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}