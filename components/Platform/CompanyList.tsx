'use client'

import React, { useEffect, useState, useCallback } from 'react';
import { Ban, RotateCcw, Globe } from 'lucide-react';
import { getAllCompanies, setCompanyActive, type CompanyActivity } from '../../app/actions/platform';
import ModalBase, { ModalHeader, ModalBody, ModalFooter, ModalButton } from '../UI/ModalBase';
import { formatCurrency } from '../../lib/format';
import { isIdleCompany, formatLastSale } from '../../lib/tenant-usage';
import './Platform.css';

interface Props {
    /**
     * Datos ya cargados por el padre. Si se pasan, la lista NO hace su propia
     * consulta (evita duplicar el escaneo de ventas). Si se omiten, la lista
     * se carga sola — es lo que usa CompaniesPanel.
     */
    companies?: CompanyActivity[] | null;
    loading?: boolean;
    error?: string;
    onRefresh?: () => Promise<void>;
    /** Al cambiar, la lista no controlada se recarga. Tras crear una empresa. */
    reloadToken?: number;
}

/**
 * Lista de todas las empresas de la plataforma con su actividad reciente,
 * y control para desactivar / reactivar.
 *
 * No usa filtro `created_by`: el administrador de plataforma ve todos los tenants.
 */
export default function CompanyList({
    companies, loading, error, onRefresh, reloadToken = 0,
}: Props = {}) {
    const isControlled = companies !== undefined;

    const [ownCompanies, setOwnCompanies] = useState<CompanyActivity[] | null>(null);
    const [ownLoading, setOwnLoading] = useState(true);
    const [ownError, setOwnError] = useState('');
    const [rowBusy, setRowBusy] = useState<string | null>(null);
    const [pendingDeactivate, setPendingDeactivate] = useState<CompanyActivity | null>(null);
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);

    const rows = isControlled ? companies : ownCompanies;
    const isLoading = isControlled ? (loading ?? false) : ownLoading;
    const listError = isControlled ? (error ?? '') : ownError;

    const load = useCallback(async () => {
        setOwnLoading(true);
        setOwnError('');
        const res = await getAllCompanies();
        if (res.success && res.data) {
            setOwnCompanies(res.data);
        } else {
            setOwnError(res.error || 'No se pudieron cargar las empresas');
        }
        setOwnLoading(false);
    }, []);

    // Solo carga por su cuenta cuando no es controlada por el padre.
    useEffect(() => {
        if (!isControlled) load();
    }, [load, isControlled, reloadToken]);

    const refresh = async () => {
        if (isControlled) {
            await onRefresh?.();
        } else {
            await load();
        }
    };

    const handleActivate = async (company: CompanyActivity) => {
        setRowBusy(company.id);
        const res = await setCompanyActive(company.id, true);
        if (res.success) {
            await refresh();
        } else {
            if (isControlled) await onRefresh?.();
            else setOwnError(res.error || 'No se pudo activar la empresa');
        }
        setRowBusy(null);
    };

    const handleDeactivate = async () => {
        if (!pendingDeactivate) return;
        setSaving(true);
        const res = await setCompanyActive(pendingDeactivate.id, false, reason);
        setSaving(false);
        if (res.success) {
            setPendingDeactivate(null);
            setReason('');
            await refresh();
        } else {
            if (isControlled) await onRefresh?.();
            else setOwnError(res.error || 'No se pudo desactivar la empresa');
        }
    };

    if (!isLoading && rows?.length === 0) {
        return (
            <div className="ui-empty-state">
                <Globe size={48} color="var(--color-text-faint)" />
                <p>No hay empresas registradas en la plataforma</p>
            </div>
        );
    }

    return (
        <>
            {listError && (
                <div className="ui-alert ui-alert-danger pd-list-alert">
                    {listError}
                </div>
            )}

            <div className="pd-companies">
                {isLoading && !rows
                    ? [0, 1, 2].map(i => <div key={i} className="ui-card sh-skeleton pd-company-skeleton" />)
                    : rows?.map(company => {
                        const isIdle = company.active && isIdleCompany(company.last_sale_at);

                        return (
                            <div
                                key={company.id}
                                className={`ui-card pd-company ${company.active ? '' : 'inactive'}`}
                            >
                                <div className="pd-company-top">
                                    <div className={`pd-company-logo ${company.active ? '' : 'inactive'}`}>
                                        {(company.trade_name || company.legal_name).charAt(0).toUpperCase()}
                                    </div>

                                    <div className="pd-company-info">
                                        <p className="pd-company-name">
                                            {company.trade_name || company.legal_name}
                                        </p>
                                        <p className="pd-company-slug">{company.slug}</p>
                                    </div>

                                    <span className={`sh-badge pd-badge ${company.active ? 'is-active' : 'is-inactive'}`}>
                                        {company.active ? 'Activa' : 'Desactivada'}
                                    </span>

                                    <div className="pd-actions">
                                        {company.active ? (
                                            <button
                                                className="pd-toggle-btn deactivate"
                                                onClick={() => { setPendingDeactivate(company); setReason(''); }}
                                                disabled={rowBusy === company.id}
                                            >
                                                <Ban size={15} /> Desactivar
                                            </button>
                                        ) : (
                                            <button
                                                className="pd-toggle-btn activate"
                                                onClick={() => handleActivate(company)}
                                                disabled={rowBusy === company.id}
                                            >
                                                <RotateCcw size={15} />
                                                {rowBusy === company.id ? 'Activando...' : 'Reactivar'}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="pd-company-stats">
                                    <div className="pd-stat">
                                        <span className="pd-stat-label">Usuarios</span>
                                        <span className="pd-stat-value">{company.user_count}</span>
                                    </div>
                                    <div className="pd-stat">
                                        <span className="pd-stat-label">Ventas totales</span>
                                        <span className="pd-stat-value">{formatCurrency(company.sales_total)}</span>
                                    </div>
                                    <div className="pd-stat">
                                        <span className="pd-stat-label">Última venta</span>
                                        <span className={`pd-stat-value ${isIdle ? 'idle' : ''}`}>
                                            {formatLastSale(company.last_sale_at)}
                                        </span>
                                    </div>
                                    <div className="pd-stat">
                                        <span className="pd-stat-label">Alta</span>
                                        <span className="pd-stat-value">
                                            {new Date(company.created_at).toLocaleDateString('es-CO')}
                                        </span>
                                    </div>
                                </div>

                                {!company.active && (
                                    <div className="pd-inactive-reason">
                                        <Ban size={16} className="pd-inactive-icon" />
                                        <div>
                                            <strong>Desactivada</strong>
                                            {company.deactivated_at && ` el ${new Date(company.deactivated_at).toLocaleDateString('es-CO')}`}
                                            {company.deactivation_reason && ` — ${company.deactivation_reason}`}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })
                }
            </div>

            {pendingDeactivate && (
                <ModalBase onClose={() => setPendingDeactivate(null)} size="sm">
                    <ModalHeader title="Desactivar empresa" onClose={() => setPendingDeactivate(null)} />
                    <ModalBody>
                        <p className="pd-deactivate-summary">
                            Se va a impedir el inicio de sesión de los{' '}
                            <strong>{pendingDeactivate.user_count}</strong>{' '}
                            usuario{pendingDeactivate.user_count === 1 ? '' : 's'} de{' '}
                            <strong>{pendingDeactivate.trade_name || pendingDeactivate.legal_name}</strong>.
                        </p>

                        <div className="ui-alert ui-alert-warning pd-deactivate-note">
                            No se borra ningún dato. Puedes reactivarla cuando quieras.
                        </div>

                        <label className="ui-label" htmlFor="deactivate-reason">
                            Motivo de la desactivación
                        </label>
                        <textarea
                            id="deactivate-reason"
                            className="pd-deactivate-reason"
                            placeholder="Ej: no renovó el plan, empresa se retiró, suspendida por impago..."
                            value={reason}
                            maxLength={500}
                            onChange={(e) => setReason(e.target.value)}
                            autoFocus
                        />
                        <span className="pd-deactivate-counter">
                            {reason.length}/500
                        </span>
                    </ModalBody>
                    <ModalFooter>
                        <ModalButton variant="secondary" onClick={() => setPendingDeactivate(null)} disabled={saving}>
                            Cancelar
                        </ModalButton>
                        <ModalButton variant="danger" onClick={handleDeactivate} loading={saving}>
                            Desactivar empresa
                        </ModalButton>
                    </ModalFooter>
                </ModalBase>
            )}
        </>
    );
}