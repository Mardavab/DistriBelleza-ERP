'use client'

import React, { useState } from 'react';
import { AlertTriangle, X, Award } from 'lucide-react';
import { closeCashSession } from '../../app/actions/cash_actions';
import { formatCurrency } from '../../lib/format';

/**
 * Modal de cierre de caja. Muestra el resumen de la sesión y permite
 * confirmar el cierre definitivo.
 *
 * Subcomponente del POS. Encargado de:
 * - Renderizar totales (facturado, gastos, efectivo esperado)
 * - Llamar a closeCashSessionAction
 * - Cerrar modal o reabrir apertura si fue exitoso
 */
interface CloseSessionModalProps {
    sessionId: string;
    sessionSummary: {
        totalAmount: number;
        cashSales: number;
        otherSales: number;
        expenseCount: number;
        totalExpenses: number;
        cashExpenses: number;
        commissionEarned: number;
        isCommissionEligible: boolean;
    };
    initialFund: number;
    commissionGoalFormatted: string;
    onClose: () => void;
    onSuccess: () => void;
}

export default function CloseSessionModal({
    sessionId,
    sessionSummary,
    initialFund,
    commissionGoalFormatted,
    onClose,
    onSuccess,
}: CloseSessionModalProps) {
    const [isClosing, setIsClosing] = useState(false);

    const handleConfirm = async () => {
        setIsClosing(true);
        const res = await closeCashSession(sessionId);
        setIsClosing(false);

        if (res.success) {
            onSuccess();
        }
    };

    const expectedCash = initialFund + sessionSummary.cashSales - sessionSummary.cashExpenses;

    return (
        <div className="modal-overlay dark-blur">
            <div className="modal-summary animate-pop">
                <button className="btn-close-summary" onClick={onClose}><X size={20} /></button>
                <div className="summary-header">
                    <AlertTriangle size={32} className="text-warning" />
                    <h2>Confirmar Cierre</h2>
                    <p>Revise los totales antes de finalizar</p>
                </div>

                <div className="summary-content">
                    <div className="stat-card">
                        <span className="label">Total Facturado</span>
                        <span className="val">{formatCurrency(sessionSummary.totalAmount)}</span>
                    </div>

                    <div className="stat-row">
                        <span>Efectivo en Ventas:</span>
                        <span className="val-sm">{formatCurrency(sessionSummary.cashSales)}</span>
                    </div>
                    <div className="stat-row">
                        <span>Otros Medios:</span>
                        <span className="val-sm">{formatCurrency(sessionSummary.otherSales)}</span>
                    </div>

                    {sessionSummary.expenseCount > 0 && (
                        <div className="stat-row expense-row">
                            <span>Gastos ({sessionSummary.expenseCount}):</span>
                            <span className="val-sm danger">-{formatCurrency(sessionSummary.totalExpenses)}</span>
                        </div>
                    )}

                    <div className="final-cash-box">
                        <label>Efectivo Esperado en Caja</label>
                        <h3>{formatCurrency(expectedCash)}</h3>
                        {sessionSummary.cashExpenses > 0 && (
                            <p className="cash-expense-note">
                                Fondo inicial + ventas en efectivo − gastos en efectivo
                            </p>
                        )}
                    </div>

                    <div className={`commission-box ${sessionSummary.isCommissionEligible ? 'eligible' : ''}`}>
                        <div className="comm-icon"><Award size={24} /></div>
                        <div className="comm-info">
                            <span className="label">Comisión Estimada (1.2%)</span>
                            <span className="val">
                                {sessionSummary.isCommissionEligible
                                    ? formatCurrency(sessionSummary.commissionEarned)
                                    : '$0'}
                            </span>
                        </div>
                        {!sessionSummary.isCommissionEligible && (
                            <p className="comm-hint">Meta mínima: {commissionGoalFormatted}</p>
                        )}
                    </div>
                </div>

                <div className="modal-actions-horizontal">
                    <button className="btn-cancel-close" onClick={onClose}>CANCELAR</button>
                    <button className="btn-confirm-close-final" disabled={isClosing} onClick={handleConfirm}>
                        {isClosing ? 'CERRANDO...' : 'SÍ, CERRAR CAJA'}
                    </button>
                </div>
            </div>
        </div>
    );
}