'use client'

import React from 'react';
import { Unlock, Lock, User as UserIcon, DollarSign, TrendingUp, History, LogOut } from 'lucide-react';
import { formatCurrency } from '../../lib/format';

interface ActiveSession {
    initial_fund: number;
    totalSold?: number;
}

/**
 * Status bar superior del POS.
 *
 * Subcomponente del POS. Muestra:
 *   - Estado de caja (abierta/cerrada)
 *   - Usuario logueado
 *   - Fondo base y ventas del día (si la caja está abierta)
 *   - Botones de acción: Historial, Cierre
 */
interface PosStatusBarProps {
    isLoading: boolean;
    userProfile: { full_name?: string } | null;
    activeSession: ActiveSession | null;
    onLoadHistory: () => void;
    onRequestClose: () => void;
}

function SkeletonStatus() {
    return (
        <div className="status-item">
            <div className="skeleton-box" style={{ width: '120px', height: '16px', borderRadius: '4px' }} />
        </div>
    );
}

export default function PosStatusBar({
    isLoading,
    userProfile,
    activeSession,
    onLoadHistory,
    onRequestClose,
}: PosStatusBarProps) {
    return (
        <header className="pos-status-bar">
            {isLoading && !userProfile ? (
                <>
                    <SkeletonStatus />
                    <SkeletonStatus />
                    <SkeletonStatus />
                </>
            ) : (
                <>
                    <div className="status-item">
                        {activeSession
                            ? <Unlock size={16} className="text-success" />
                            : <Lock size={16} className="text-danger" />}
                        <span>Caja: <strong>{activeSession ? 'ABIERTA' : 'CERRADA'}</strong></span>
                    </div>
                    <div className="status-item">
                        <UserIcon size={16} />
                        <span>Usuario: <strong>{userProfile?.full_name}</strong></span>
                    </div>
                    {activeSession && (
                        <>
                            <div className="status-item highlight">
                                <DollarSign size={16} />
                                <span>Fondo Base: <strong>{formatCurrency(activeSession.initial_fund)}</strong></span>
                            </div>
                            <div className="status-item highlight sales">
                                <TrendingUp size={16} />
                                <span>Vendido Hoy: <strong>{formatCurrency(activeSession.totalSold || 0)}</strong></span>
                            </div>
                        </>
                    )}
                </>
            )}
            <div className="status-actions">
                <button className="btn-history-trigger" onClick={onLoadHistory} disabled={isLoading}>
                    <History size={16} /> Historial
                </button>
                {activeSession && (
                    <button className="btn-close-session" onClick={onRequestClose} disabled={isLoading}>
                        <LogOut size={16} /> Cierre
                    </button>
                )}
            </div>
        </header>
    );
}