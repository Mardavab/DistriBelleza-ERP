'use client'

import React, { useEffect, useState } from 'react';
import { Calendar, FileText, Download, AlertCircle, TrendingUp, DollarSign, Wallet, ArrowDownCircle, ArrowUpCircle, Award, CreditCard, RefreshCcw, ShieldCheck, PieChart } from 'lucide-react';
import { getFinancialReport, FinancialReport } from '../../app/actions/reports';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// SKELETON COMPONENTS
const SkeletonBox = ({ width, height, margin }: { width: string, height: string, margin?: string }) => (
  <div className="skeleton-box" style={{ width, height, margin, borderRadius: '12px' }}></div>
);

const SkeletonReport = () => (
  <div className="reports-view animate-fade-in">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
      <div>
        <SkeletonBox width="200px" height="28px" margin="0 0 8px" />
        <SkeletonBox width="300px" height="16px" />
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <SkeletonBox width="150px" height="44px" />
        <SkeletonBox width="130px" height="44px" />
      </div>
    </div>
    <div className="report-grid" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ background: 'white', padding: '32px', borderRadius: '24px', border: '1px solid #e2e8f0' }}>
        <SkeletonBox width="250px" height="24px" margin="0 0 24px" />
        {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
            <SkeletonBox width="150px" height="18px" />
            <SkeletonBox width="80px" height="18px" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default function ReportsView({ userProfile }: { userProfile?: any }) {
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [date, setDate] = useState(() => {
    const now = new Date();
    const colTime = new Date(now.getTime() - (5 * 60 * 60 * 1000));
    return colTime.toISOString().split('T')[0];
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadReport();
  }, [date]);

  async function loadReport() {
    setLoading(true);
    const data = await getFinancialReport(date);
    setReport(data);
    setLoading(false);
  }

  const exportPDF = () => {
    if (!report || !report.success) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // BACKGROUND & BRANDING
    doc.setFillColor(248, 250, 252); // slate-50
    doc.rect(0, 0, pageWidth, 40, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.setTextColor(99, 102, 241); // Indigo-500
    doc.text('GLOW COSMETICS', 14, 25);

    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text('REPORTE FINANCIERO DIARIO', 14, 32);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    doc.text(`Fecha: ${report.date}`, pageWidth - 14, 25, { align: 'right' });
    doc.text(`ID Reporte: #${report.date.replace(/-/g, '')}`, pageWidth - 14, 32, { align: 'right' });

    // CARDS SECTION (Simulated with Rectangles)
    const cardWidth = (pageWidth - 40) / 2;

    // Total Sales Card
    doc.setFillColor(239, 246, 255); // blue-50
    doc.roundedRect(14, 50, cardWidth, 30, 3, 3, 'F');
    doc.setFontSize(9);
    doc.setTextColor(59, 130, 246);
    doc.text('TOTAL VENTAS (BRUTO)', 20, 60);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`$${report.kpis.totalCompletedSales.toLocaleString()}`, 20, 72);

    // Commission Card
    doc.setFillColor(report.kpis.commissionApplied ? 240 : 241, report.kpis.commissionApplied ? 253 : 245, report.kpis.commissionApplied ? 244 : 249);
    doc.roundedRect(pageWidth - 14 - cardWidth, 50, cardWidth, 30, 3, 3, 'F');
    doc.setFontSize(9);
    doc.setTextColor(report.kpis.commissionApplied ? 21 : 100, report.kpis.commissionApplied ? 128 : 116, report.kpis.commissionApplied ? 61 : 139);
    doc.text('COMISIÓN ESTIMADA (1.2%)', pageWidth - cardWidth - 8, 60);
    doc.setFontSize(16);
    doc.text(`$${report.kpis.commissionEarned.toLocaleString()}`, pageWidth - cardWidth - 8, 72);

    // TABLE: DESGLOSE DE VENTAS
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text('Detalle de Ingresos por Método', 14, 95);

    autoTable(doc, {
      startY: 100,
      head: [['Método de Pago', 'Concepto', 'Total']],
      body: [
        ['Efectivo', 'Ventas Directas', `$${report.summary.cashFromSales.toLocaleString()}`],
        ['Tarjeta', 'Datafono / Crédito Debit', `$${report.summary.cardSales.toLocaleString()}`],
        ['Transferencia', 'Nequi / Daviplata / Bancolombia', `$${report.summary.transferSales.toLocaleString()}`],
        ['Crédito', 'Ventas Fiadas', `$${report.summary.creditSales.toLocaleString()}`],
      ],
      headStyles: { fillColor: [99, 102, 241] },
      margin: { left: 14, right: 14 },
    });

    // TABLE: MOVIMIENTOS DE CAJA
    const nextY = (doc as any).lastAutoTable.finalY + 15;
    doc.text('Movimientos de Efectivo y Auditoría', 14, nextY);

    autoTable(doc, {
      startY: nextY + 5,
      head: [['Tipo', 'Descripción', 'Monto']],
      body: [
        ['ENTRADA', 'Fondo Inicial de Apertura', `$${report.summary.initialFund.toLocaleString()}`],
        ['ENTRADA', 'Recaudo Cobros a Clientes', `$${report.summary.cashFromCustomers.toLocaleString()}`],
        ['SALIDA', 'Gastos Operativos Registrados', `-$${report.summary.cashExpenses.toLocaleString()}`],
        ['SALIDA', 'Pagos realizados a Proveedores', `-$${report.summary.cashToSuppliers.toLocaleString()}`],
      ],
      headStyles: { fillColor: [15, 23, 42] },
      columnStyles: {
        2: { fontStyle: 'bold' }
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 2) {
          if (data.cell.text[0].startsWith('-')) data.cell.styles.textColor = [220, 38, 38];
          else if (data.cell.text[0].startsWith('$')) data.cell.styles.textColor = [22, 163, 74];
        }
      }
    });

    // FINAL SUMMARY BOX
    const lastY = (doc as any).lastAutoTable.finalY + 15;
    doc.setFillColor(15, 23, 42);
    doc.roundedRect(14, lastY, pageWidth - 28, 25, 4, 4, 'F');

    doc.setTextColor(148, 163, 184);
    doc.setFontSize(9);
    doc.text('EFECTIVO TOTAL ESPERADO EN CAJA', 24, lastY + 10);

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.text(`$${report.summary.expectedCash.toLocaleString()}`, 24, lastY + 20);

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('Distri Belleza ERP - Reporte generado automáticamente.', pageWidth / 2, 285, { align: 'center' });

    doc.save(`Reporte_Distri_Belleza_${report.date}.pdf`);
  };

  if (loading) return <SkeletonReport />;

  return (
    <div className="reports-view animate-fade-in">
      <div className="reports-header">
        <div className="header-info">
          <div className="icon-badge">
            <FileText size={24} color="#6366f1" />
          </div>
          <div>
            <h2>Panel de Reportes</h2>
            <p>Resumen consolidado y auditoría de operaciones</p>
          </div>
        </div>
        <div className="header-actions">
          {userProfile?.role === 'owner' && (
            <div className="date-picker-wrapper">
              <Calendar size={18} className="calendar-icon" />
              <input
                type="date"
                className="date-input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          )}
          <button className="btn-export" onClick={exportPDF} disabled={!report?.success}>
            <Download size={18} /> Descargar Reporte
          </button>
        </div>
      </div>

      {!report?.success ? (
        <div className="error-card">
          <AlertCircle size={24} />
          <div>
            <h3>Error al cargar reporte</h3>
            <p>{report?.error || 'No se pudo obtener la información del servidor.'}</p>
          </div>
        </div>
      ) : (
        <div className="report-grid center">
          {/* TOP KPI ROW */}
          <div className="kpi-row">
            <div className="kpi-card sales">
              <div className="kpi-icon"><TrendingUp size={24} /></div>
              <div className="kpi-info">
                <span className="label">Ventas Totales (Bruto)</span>
                <p className="val">${report.kpis.totalCompletedSales.toLocaleString()}</p>
                <span className="sub">Todos los métodos de pago</span>
              </div>
            </div>
            <div className={`kpi-card commission ${report.kpis.commissionApplied ? 'active' : ''}`}>
              <div className="kpi-icon"><Award size={24} /></div>
              <div className="kpi-info">
                <span className="label">Comisión Lograda</span>
                <p className="val">${report.kpis.commissionEarned.toLocaleString()}</p>
                <div className="goal-indicator">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${Math.min((report.kpis.totalCompletedSales / 1800000) * 100, 100)}%` }}
                    ></div>
                  </div>
                  <span className="goal-text">
                    {report.kpis.commissionApplied ? '✓ Meta de $1.8M superada' : `Meta: $1.8M (Faltan $${(1800000 - report.kpis.totalCompletedSales).toLocaleString()})`}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="main-report-content">
            <div className="cash-audit-card">
              <div className="card-header">
                <PieChart size={20} color="#6366f1" />
                <h3>Desglose de Operaciones</h3>
              </div>

              <div className="audit-items">
                <div className="audit-divider">Ventas por Método (Ingresos Totales)</div>
                <div className="method-grid">
                  <div className="method-item">
                    <div className="m-info"><DollarSign size={14} /><span>Efectivo</span></div>
                    <span className="m-val">${report.summary.cashFromSales.toLocaleString()}</span>
                  </div>
                  <div className="method-item">
                    <div className="m-info"><CreditCard size={14} /><span>Tarjeta</span></div>
                    <span className="m-val">${report.summary.cardSales.toLocaleString()}</span>
                  </div>
                  <div className="method-item">
                    <div className="m-info"><RefreshCcw size={14} /><span>Transferencia</span></div>
                    <span className="m-val">${report.summary.transferSales.toLocaleString()}</span>
                  </div>
                  <div className="method-item">
                    <div className="m-info"><ShieldCheck size={14} /><span>Crédito</span></div>
                    <span className="m-val">${report.summary.creditSales.toLocaleString()}</span>
                  </div>
                </div>

                <div className="audit-divider">Flujo de Caja (Efectivo Físico)</div>
                <div className="audit-item">
                  <span className="label">Fondo Inicial (Apertura)</span>
                  <span className="val">${report.summary.initialFund.toLocaleString()}</span>
                </div>
                <div className="audit-item success">
                  <div className="label-group"><ArrowUpCircle size={16} /><span>Ventas Efectivo</span></div>
                  <span className="val">+${(report.summary.cashFromSales + report.summary.cashFromCustomers).toLocaleString()}</span>
                </div>
                <div className="audit-item danger">
                  <div className="label-group"><ArrowDownCircle size={16} /><span>Gastos</span></div>
                  <span className="val">-${(report.summary.cashExpenses + report.summary.cashToSuppliers).toLocaleString()}</span>
                </div>

                <div className="audit-footer">
                  <div className="total-label">
                    <p>EFECTIVO ESPERADO EN CAJA</p>
                    <span>Balance final para entrega de turno</span>
                  </div>
                  <span className="total-val">${report.summary.expectedCash.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .reports-view { padding: 0; }
        .reports-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
        .header-info { display: flex; align-items: center; gap: 16px; }
        .icon-badge { background: #f5f3ff; padding: 12px; border-radius: 16px; }
        .header-info h2 { font-size: 1.5rem; font-weight: 700; color: #1e293b; margin: 0; }
        .header-info p { font-size: 0.9rem; color: #64748b; margin: 2px 0 0; }

        .header-actions { display: flex; gap: 16px; align-items: center; }
        .date-picker-wrapper { position: relative; display: flex; align-items: center; background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 0 16px; height: 44px; transition: all 0.2s; }
        .date-picker-wrapper:hover { border-color: #6366f1; }
        .calendar-icon { color: #94a3b8; margin-right: 10px; }
        .date-input { border: none; outline: none; font-size: 0.9rem; color: #1e293b; font-weight: 600; cursor: pointer; background: transparent; }
        
        .btn-export { background: #6366f1; color: white; border: none; padding: 0 20px; border-radius: 12px; height: 44px; display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 0.9rem; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 6px -1px rgba(99, 102, 241, 0.2); }
        .btn-export:hover:not(:disabled) { background: #4f46e5; transform: translateY(-2px); box-shadow: 0 10px 15px -3px rgba(99, 102, 241, 0.3); }
        .btn-export:disabled { opacity: 0.5; cursor: not-allowed; }

        .report-grid { display: flex; flex-direction: column; gap: 24px; max-width: 1000px; margin: 0 auto; }
        
        .kpi-row { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
        .kpi-card { background: white; padding: 24px; border-radius: 24px; border: 1px solid #e2e8f0; display: flex; gap: 16px; }
        .kpi-icon { width: 48px; height: 48px; border-radius: 16px; display: flex; align-items: center; justify-content: center; background: #f8fafc; }
        .kpi-card.sales { border-left: 4px solid #3b82f6; background: #eff6ff; }
        .kpi-card.commission { border-left: 4px solid #94a3b8; }
        .kpi-card.commission.active { border-left-color: #10b981; background: #f0fdf4; }
        .kpi-info .label { font-size: 0.75rem; font-weight: 700; color: #64748b; text-transform: uppercase; }
        .kpi-info .val { font-size: 1.75rem; font-weight: 800; margin: 4px 0; color: #1e293b; }
        
        .cash-audit-card { background: white; padding: 32px; border-radius: 24px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .card-header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
        .card-header h3 { font-size: 1.1rem; font-weight: 700; color: #1e293b; margin: 0; }
        
        .audit-divider { font-size: 0.7rem; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin: 16px 0 12px; }
        
        .method-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
        .method-item { background: #f8fafc; padding: 16px; border-radius: 16px; border: 1px solid #f1f5f9; display: flex; flex-direction: column; gap: 4px; }
        .m-info { display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: #64748b; font-weight: 600; }
        .m-val { font-size: 1.1rem; font-weight: 800; color: #1e293b; }

        .audit-items { display: flex; flex-direction: column; gap: 8px; }
        .audit-item { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-radius: 12px; background: #f8fafc; }
        .audit-item .label { color: #64748b; font-size: 0.9rem; font-weight: 500; }
        .audit-item .val { font-weight: 700; color: #1e293b; font-size: 1rem; }
        .audit-item.success { background: #f0fdf4; color: #15803d; }
        .audit-item.danger { background: #fef2f2; color: #b91c1c; }
        .label-group { display: flex; align-items: center; gap: 10px; font-weight: 600; }

        .audit-footer { margin-top: 24px; padding: 24px; background: #0f172a; border-radius: 20px; display: flex; justify-content: space-between; align-items: center; color: white; }
        .total-label p { margin: 0; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.05em; color: #94a3b8; }
        .total-val { font-size: 1.75rem; font-weight: 800; color: white; }

        .goal-indicator { margin-top: 8px; }
        .progress-bar { width: 100%; height: 6px; background: #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 4px; }
        .progress-fill { height: 100%; background: #6366f1; transition: width 0.5s ease-out; }
        .active .progress-fill { background: #10b981; }
        .goal-text { font-size: 0.65rem; color: #64748b; font-weight: 600; }

        .skeleton-box { background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { from { background-position: 200% 0; } to { background-position: -200% 0; } }
        .animate-fade-in { animation: fadeIn 0.3s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
