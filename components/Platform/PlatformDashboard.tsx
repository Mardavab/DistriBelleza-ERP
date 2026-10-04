'use client'

import React, { useEffect, useState, useCallback } from 'react';
import {
    Activity, Globe, HeartPulse, AlertTriangle, Users, RefreshCw, Building2,
} from 'lucide-react';
import { getAllCompanies, getSystemHealth, type CompanyActivity } from '../../app/actions/platform';
import CompanyList from './CompanyList';
import { IDLE_DAYS_THRESHOLD, isIdleCompany } from '../../lib/tenant-usage';
import './Platform.css';

/**
 * Consola del administrador de plataforma.
 *
 * Muestra el estado de la aplicación y la actividad de cada empresa.
 * No ejecuta consultas de negocio: los módulos de POS, Inventario,
 * Proveedores y Reportes son datos privados de cada empresa.
 */
export default function PlatformDashboard() {
    const [companies, setCompanies] = useState<CompanyActivity[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [healthSummary, setHealthSummary] = useState<{
        ok: number; warn: number; error: number; total: number;
    } | null>(null);

    const loadStats = useCallback(async () => {
        setLoading(true);
        setError('');
        const [companiesRes, healthRes] = await Promise.all([
            getAllCompanies(),
            getSystemHealth(),
        ]);

        if (companiesRes.success && companiesRes.data) {
            setCompanies(companiesRes.data);
        } else {
            setError(companiesRes.error || 'No se pudieron cargar las empresas');
        }

        if (healthRes.success && healthRes.checks) {
            setHealthSummary({
                ok: healthRes.checks.filter(c => c.status === 'ok').length,
                warn: healthRes.checks.filter(c => c.status === 'warn').length,
                error: healthRes.checks.filter(c => c.status === 'error').length,
                total: healthRes.checks.length,
            });
        }

        setLoading(false);
    }, []);

    useEffect(() => { loadStats(); }, [loadStats]);

    const active = companies?.filter(c => c.active) ?? [];
    const inactive = companies?.filter(c => !c.active) ?? [];
    const idleCompanies = active.filter(c => isIdleCompany(c.last_sale_at));
    const totalUsers = companies?.reduce((s, c) => s + c.user_count, 0) ?? 0;

    const healthTone = !healthSummary ? 'neutral'
        : healthSummary.error > 0 ? 'error'
            : healthSummary.warn > 0 ? 'warning'
                : 'ok';

    return (
        <div className="page-container">
            <header className="page-header">
                <div className="page-header-group">
                    <div className="page-title-icon">
                        <Activity size={28} />
                    </div>
                    <div className="page-title-block">
                        <h1>Consola de Plataforma</h1>
                        <p>Estado de la aplicación y de las empresas que la usan</p>
                    </div>
                </div>
                <button className="btn-primary-page" onClick={loadStats} disabled={loading}>
                    <RefreshCw size={18} />
                    {loading ? 'Actualizando...' : 'Actualizar'}
                </button>
            </header>

            {error && (
                <div className="ui-alert ui-alert-danger pd-dash-alert">
                    {error}
                </div>
            )}

            <div className="pd-kpi-grid">
                <div className="ui-card pd-kpi">
                    <div className={`pd-kpi-icon ${healthSummary?.error ? 'is-error' : 'is-ok'}`}>
                        <HeartPulse size={22} />
                    </div>
                    <div>
                        <div className="pd-kpi-label">Sistema</div>
                        <div className={`pd-kpi-value pd-kpi-value-${healthTone}`}>
                            {loading && !healthSummary ? '...' : healthSummary?.error ? 'Con fallos'
                                : healthSummary?.warn ? 'Con avisos' : 'Operativo'}
                        </div>
                        {healthSummary && (
                            <div className="pd-kpi-note">{healthSummary.ok}/{healthSummary.total} chequeos bien</div>
                        )}
                    </div>
                </div>

                <div className="ui-card pd-kpi">
                    <div className="pd-kpi-icon is-primary">
                        <Globe size={22} />
                    </div>
                    <div>
                        <div className="pd-kpi-label">Empresas activas</div>
                        <div className="pd-kpi-value">{loading ? '...' : active.length}</div>
                        <div className="pd-kpi-note">
                            {inactive.length > 0
                                ? `${inactive.length} desactivada${inactive.length === 1 ? '' : 's'}`
                                : 'Ninguna desactivada'}
                        </div>
                    </div>
                </div>

                <div className="ui-card pd-kpi">
                    <div className={`pd-kpi-icon ${idleCompanies.length > 0 ? 'is-warning' : 'is-neutral'}`}>
                        <AlertTriangle size={22} />
                    </div>
                    <div>
                        <div className="pd-kpi-label">Sin uso reciente</div>
                        <div className="pd-kpi-value">{loading ? '...' : idleCompanies.length}</div>
                        <div className="pd-kpi-note">{IDLE_DAYS_THRESHOLD}+ días sin ventas</div>
                    </div>
                </div>

                <div className="ui-card pd-kpi">
                    <div className="pd-kpi-icon is-info">
                        <Users size={22} />
                    </div>
                    <div>
                        <div className="pd-kpi-label">Usuarios en empresas</div>
                        <div className="pd-kpi-value">{loading ? '...' : totalUsers}</div>
                    </div>
                </div>
            </div>

            <div className="pd-section-heading">
                <Building2 size={20} />
                <h2>Empresas registradas</h2>
            </div>

            <CompanyList
                companies={companies}
                loading={loading}
                error={error}
                onRefresh={loadStats}
            />
        </div>
    );
}