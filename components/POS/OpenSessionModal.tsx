'use client'

import React, { useState, useEffect } from 'react';
import { Lock, User as UserIcon, Calendar, Clock } from 'lucide-react';
import { openCashSession } from '../../app/actions/cash_actions';
import { formatCurrencyInput, parseCurrencyInput } from '../../lib/format';

/**
 * Modal de apertura de caja.
 *
 * Subcomponente del POS. Permite al cajero abrir una sesión de caja
 * con un fondo inicial. Una vez abierta, las ventas se habilitan.
 */
interface OpenSessionModalProps {
    userProfile: { full_name?: string } | null;
    onOpened: () => void;
    onClose: () => void;
}

export default function OpenSessionModal({ userProfile, onOpened, onClose }: OpenSessionModalProps) {
    const [initialFund, setInitialFund] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentTime, setCurrentTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const handleOpen = async () => {
        setError(null);
        setIsLoading(true);

        const fundValue = parseCurrencyInput(initialFund);
        const result = await openCashSession(fundValue);

        setIsLoading(false);

        if (result.success) {
            onOpened();
        } else {
            setError(result.error || 'Error al abrir caja.');
        }
    };

    return (
        <div className="modal-overlay dark-blur">
            <div className="modal-session animate-slide-up">
                <div className="session-header">
                    <div className="icon-wrap"><Lock size={24} /></div>
                    <h2>Apertura de Caja</h2>
                    <p>Complete la información para habilitar las ventas</p>
                </div>

                <div className="session-body">
                    <div className="info-grid">
                        <div className="info-item">
                            <label><UserIcon size={14} /> Responsable</label>
                            <div className="val">{userProfile?.full_name || 'Cargando...'}</div>
                        </div>
                        <div className="info-item">
                            <label><Calendar size={14} /> Fecha</label>
                            <div className="val">{currentTime.toLocaleDateString()}</div>
                        </div>
                        <div className="info-item">
                            <label><Clock size={14} /> Hora</label>
                            <div className="val">{currentTime.toLocaleTimeString()}</div>
                        </div>
                    </div>

                    <div className="fund-input-area">
                        <label>Efectivo Inicial en Caja</label>
                        <div className="fund-input-wrapper">
                            <span className="currency">$</span>
                            <input
                                type="text"
                                placeholder="0"
                                value={initialFund}
                                onChange={(e) => {
                                    const raw = parseCurrencyInput(e.target.value);
                                    setInitialFund(raw ? formatCurrencyInput(raw) : '');
                                }}
                                onFocus={() => {
                                    const raw = parseCurrencyInput(initialFund);
                                    setInitialFund(raw === 0 ? '' : formatCurrencyInput(raw));
                                }}
                                autoFocus
                            />
                        </div>
                        <p className="help-text">Ingrese la base con la que inicia su turno</p>
                    </div>

                    {error && <div className="error-box-alt">{error}</div>}
                </div>

                <div className="session-footer">
                    <button className="btn-session-confirm" disabled={isLoading} onClick={handleOpen}>
                        {isLoading ? 'Abriendo...' : 'ACEPTAR Y COMENZAR'}
                    </button>
                </div>
            </div>
        </div>
    );
}