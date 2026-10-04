'use client'

import React, { useEffect, useState, useCallback } from 'react';
import { HeartPulse, RefreshCw, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { getSystemHealth, type HealthCheck, type HealthStatus } from '../../app/actions/platform';
import './Platform.css';

/** Los colores de cada estado viven en `Platform.css` (`.sh-tone-*`). */
const STATUS_META: Record<HealthStatus, { icon: React.ReactNode; label: string }> = {
    ok: { icon: <CheckCircle2 size={20} />, label: 'Operativo' },
    warn: { icon: <AlertTriangle size={20} />, label: 'Atención' },
    error: { icon: <XCircle size={20} />, label: 'Fallando' },
};

export default function SystemHealth() {
    const [checks, setChecks] = useState<HealthCheck[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [checkedAt, setCheckedAt] = useState<Date | null>(null);

    const runChecks = useCallback(async () => {
        setLoading(true);
        setError('');
        const res = await getSystemHealth();
        if (res.success && res.checks) {
            setChecks(res.checks);
            setCheckedAt(new Date());
        } else {
            setError(res.error || 'No se pudo ejecutar el diagnóstico');
        }
        setLoading(false);
    }, []);

    useEffect(() => { runChecks(); }, [runChecks]);

    const overall: HealthStatus = !checks?.length
        ? 'warn'
        : checks.some(c => c.status === 'error')
            ? 'error'
            : checks.some(c => c.status === 'warn')
                ? 'warn'
                : 'ok';

    const errorCount = checks?.filter(c => c.status === 'error').length ?? 0;
    const warnCount = checks?.filter(c => c.status === 'warn').length ?? 0;

    return (
        <div className="page-container">
            <header className="page-header">
                <div className="page-header-group">
                    <div className="page-title-icon">
                        <HeartPulse size={28} />
                    </div>
                    <div className="page-title-block">
                        <h1>Salud del Sistema</h1>
                        <p>Diagnóstico de los servicios de los que depende la aplicación</p>
                    </div>
                </div>
                <button className="btn-primary-page" onClick={runChecks} disabled={loading}>
                    <RefreshCw size={18} className={loading ? 'spin' : undefined} />
                    {loading ? 'Verificando...' : 'Volver a verificar'}
                </button>
            </header>

            {error && (
                <div className="ui-alert ui-alert-danger sh-alert">
                    {error}
                </div>
            )}

            {/* Resumen */}
            <div className={`ui-card sh-summary sh-tone-${overall}`}>
                <div className="sh-summary-icon">{STATUS_META[overall].icon}</div>
                <div className="sh-summary-body">
                    <p className="sh-summary-title">
                        {loading ? 'Verificando servicios...' : (
                            overall === 'ok' ? 'Todos los servicios operativos'
                                : overall === 'warn' ? 'Operando con advertencias'
                                    : 'Hay servicios con fallos'
                        )}
                    </p>
                    {!loading && checks && (
                        <p className="sh-summary-note">
                            {errorCount > 0 && `${errorCount} con fallo`}
                            {errorCount > 0 && warnCount > 0 && ' · '}
                            {warnCount > 0 && `${warnCount} con advertencia`}
                            {errorCount === 0 && warnCount === 0 && 'Sin incidencias detectadas'}
                            {checkedAt && ` · Última verificación ${checkedAt.toLocaleTimeString('es-CO')}`}
                        </p>
                    )}
                </div>
            </div>

            {/* Chequeos */}
            <div className="sh-list">
                {loading && !checks
                    ? [0, 1, 2, 3].map(i => (
                        <div key={i} className="ui-card sh-skeleton sh-row-skeleton" />
                    ))
                    : checks?.map(check => {
                        const meta = STATUS_META[check.status];
                        return (
                            <div key={check.id} className="ui-card sh-row">
                                <div className={`sh-row-icon sh-tone-${check.status}`}>
                                    {meta.icon}
                                </div>
                                <div className="sh-row-body">
                                    <div className="sh-row-head">
                                        <span className="sh-row-label">{check.label}</span>
                                        <span className={`sh-badge sh-tone-text-${check.status}`}>
                                            {meta.label}
                                        </span>
                                    </div>
                                    <p className="sh-row-detail">
                                        {check.detail}
                                        {check.meta && ` · ${check.meta}`}
                                    </p>
                                </div>
                            </div>
                        );
                    })
                }
            </div>

            <p className="sh-footnote">
                Los errores de las operaciones de negocio no se registran aquí: para diagnosticar un
                fallo puntual se necesita revisar los logs del servidor. Estos chequeos detectan
                caídas de infraestructura (base de datos e impresión).
            </p>
        </div>
    );
}