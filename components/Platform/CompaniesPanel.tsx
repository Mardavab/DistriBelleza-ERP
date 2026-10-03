'use client'

import React, { useState, useEffect } from 'react';
import {
    Building2, Plus, Link2, Copy, Check, X, RefreshCw,
    AlertCircle, Search, ExternalLink, Globe
} from 'lucide-react';
import { getMyCompanies, createCompany } from '../../app/actions/companies';
import CustomSelect from '../UI/CustomSelect';

interface CompanySummary {
    id: string;
    slug: string;
    legal_name: string;
    trade_name: string | null;
    active: boolean;
    created_at: string;
    user_count: number;
}

export default function CompaniesPanel() {
    const [companies, setCompanies] = useState<CompanySummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [successResult, setSuccessResult] = useState<{
        company_id: string;
        invitation_url: string | null;
        trade_name: string;
    } | null>(null);
    const [copied, setCopied] = useState(false);

    // Form state
    const [form, setForm] = useState({
        legal_name: '',
        trade_name: '',
        slug: '',
        tax_id: '',
        address: '',
        phone: '',
        email: '',
        currency: 'COP',
        timezone: 'America/Bogota',
        initialOwnerEmail: '',
    });
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        loadCompanies();
    }, []);

    async function loadCompanies() {
        setLoading(true);
        setError(null);
        const res = await getMyCompanies();
        if (res.success) {
            setCompanies(res.data ?? []);
        } else {
            setError(res.error ?? 'Error desconocido');
        }
        setLoading(false);
    }

    function openCreateModal() {
        setForm({
            legal_name: '',
            trade_name: '',
            slug: '',
            tax_id: '',
            address: '',
            phone: '',
            email: '',
            currency: 'COP',
            timezone: 'America/Bogota',
            initialOwnerEmail: '',
        });
        setError(null);
        setSuccessResult(null);
        setShowCreateModal(true);
    }

    function closeModal() {
        setShowCreateModal(false);
        setSuccessResult(null);
        setError(null);
    }

    function autoSlugFromTradeName(name: string): string {
        return name.toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 50);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setSubmitting(true);

        const res = await createCompany(form);
        setSubmitting(false);

        if (res.success && res.data) {
            setSuccessResult({
                company_id: res.data.company_id,
                invitation_url: res.data.invitation_url,
                trade_name: form.trade_name,
            });
            // Reset form, keep modal open
            setForm({
                legal_name: '',
                trade_name: '',
                slug: '',
                tax_id: '',
                address: '',
                phone: '',
                email: '',
                currency: 'COP',
                timezone: 'America/Bogota',
                initialOwnerEmail: '',
            });
            loadCompanies();
        } else {
            setError(res.error ?? 'Error desconocido');
        }
    }

    async function handleCopyLink() {
        if (!successResult?.invitation_url) return;
        try {
            await navigator.clipboard.writeText(successResult.invitation_url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            prompt('Copia este link:', successResult.invitation_url);
        }
    }

    return (
        <div className="page-container">
            <header className="page-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                    <div className="page-title-icon">
                        <Building2 size={28} color="var(--color-primary)" />
                    </div>
                    <div className="page-title-block">
                        <h1>Gestión de Empresas</h1>
                        <p>Crea nuevos tenants (empresas clientes) en la plataforma</p>
                    </div>
                </div>
                <button className="btn-primary-page" onClick={openCreateModal}>
                    <Plus size={20} /> Nueva Empresa
                </button>
            </header>

            {error && (
                <div className="error-box">
                    <AlertCircle size={18} />
                    <span>{error}</span>
                </div>
            )}

            <div className="companies-list">
                {loading ? (
                    [1, 2, 3].map(i => (
                        <div key={i} className="company-card skeleton-card">
                            <div className="skeleton-line w-40"></div>
                            <div className="skeleton-line w-24"></div>
                        </div>
                    ))
                ) : companies.length === 0 ? (
                    <div className="empty-state">
                        <Globe size={48} color="#cbd5e1" />
                        <p>Aún no has creado ninguna empresa cliente.</p>
                        <p style={{ fontSize: '0.85rem' }}>
                            Click en "Nueva Empresa" para crear el primer tenant.
                        </p>
                    </div>
                ) : (
                    companies.map(c => (
                        <div key={c.id} className="company-card" style={{ borderLeft: c.active ? '4px solid #10b981' : '4px solid #ef4444' }}>
                            <div className="card-main">
                                <div>
                                    <h3>{c.trade_name || c.legal_name}</h3>
                                    <div className="meta">
                                        <span className="badge">{c.slug}</span>
                                        <span className="meta-item">
                                            {c.user_count} usuario{c.user_count !== 1 ? 's' : ''}
                                        </span>
                                        <span className="meta-item">
                                            {c.active ? '✓ Activa' : '✗ Inactiva'}
                                        </span>
                                    </div>
                                </div>
                                <div className="company-id" title={c.id}>
                                    {c.id.slice(0, 8)}...
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {showCreateModal && (
                <div className="modal-overlay">
                    <div className="modal-window">
                        <div className="modal-header">
                            <h3>{successResult ? 'Empresa Creada' : 'Nueva Empresa Cliente'}</h3>
                            <button className="btn-close" onClick={closeModal}><X /></button>
                        </div>

                        {!successResult ? (
                            <form onSubmit={handleSubmit} className="modal-body">
                                <div className="form-section">
                                    <h4>Información básica</h4>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label>Nombre comercial *</label>
                                            <input
                                                type="text"
                                                required
                                                placeholder="Ej: Belleza Total"
                                                value={form.trade_name}
                                                onChange={e => {
                                                    const newTradeName = e.target.value;
                                                    setForm({
                                                        ...form,
                                                        trade_name: newTradeName,
                                                        slug: form.slug || autoSlugFromTradeName(newTradeName),
                                                    });
                                                }}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Slug (identificador URL) *</label>
                                            <input
                                                type="text"
                                                required
                                                placeholder="belleza-total"
                                                pattern="[a-z0-9\-]+"
                                                value={form.slug}
                                                onChange={e => setForm({ ...form, slug: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label>Razón social *</label>
                                        <input
                                            type="text"
                                            required
                                            placeholder="Ej: Belleza Total S.A.S."
                                            value={form.legal_name}
                                            onChange={e => setForm({ ...form, legal_name: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="form-section">
                                    <h4>Información fiscal y contacto (opcional)</h4>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label>NIT / Tax ID</label>
                                            <input
                                                type="text"
                                                placeholder="900.xxx.xxx-x"
                                                value={form.tax_id}
                                                onChange={e => setForm({ ...form, tax_id: e.target.value })}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Teléfono</label>
                                            <input
                                                type="tel"
                                                placeholder="+57 300 000 0000"
                                                value={form.phone}
                                                onChange={e => setForm({ ...form, phone: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label>Dirección</label>
                                        <input
                                            type="text"
                                            placeholder="Calle 100 #15-20"
                                            value={form.address}
                                            onChange={e => setForm({ ...form, address: e.target.value })}
                                            style={{ width: '100%' }}
                                        />
                                    </div>
                                </div>

                                <div className="form-section">
                                    <h4>Owner inicial (opcional)</h4>
                                    <p className="section-desc">
                                        Si proporcionas un email, generaremos una invitación que el
                                        nuevo owner usará para crear su cuenta y empezar a gestionar
                                        la empresa.
                                    </p>
                                    <div className="form-group">
                                        <label>Email del primer owner</label>
                                        <input
                                            type="email"
                                            placeholder="dueno@empresa.com"
                                            value={form.initialOwnerEmail}
                                            onChange={e => setForm({ ...form, initialOwnerEmail: e.target.value })}
                                            style={{ width: '100%' }}
                                        />
                                    </div>
                                </div>

                                <div className="modal-footer">
                                    <button type="button" className="btn-cancel" onClick={closeModal}>
                                        Cancelar
                                    </button>
                                    <button type="submit" className="btn-save" disabled={submitting}>
                                        {submitting ? <RefreshCw size={18} className="spin" /> : <Check size={18} />}
                                        Crear Empresa
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <div className="modal-body">
                                <div className="success-box">
                                    <Check size={24} color="#10b981" />
                                    <div>
                                        <strong>Empresa "{successResult.trade_name}" creada</strong>
                                        <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '4px' }}>
                                            La empresa se creó con su configuración inicial.
                                        </p>
                                    </div>
                                </div>

                                {successResult.invitation_url ? (
                                    <>
                                        <div className="info-note">
                                            <Link2 size={14} />
                                            <span>
                                                Comparte este link con el nuevo owner.
                                                Tendrá 7 días para aceptar la invitación.
                                            </span>
                                        </div>

                                        <div className="form-group">
                                            <label>Link de invitación</label>
                                            <div className="link-box">
                                                <Link2 size={16} />
                                                <input
                                                    type="text"
                                                    value={successResult.invitation_url}
                                                    readOnly
                                                    onClick={(e) => e.currentTarget.select()}
                                                />
                                                <button type="button" className="btn-copy" onClick={handleCopyLink}>
                                                    {copied ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar</>}
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="info-note">
                                        <AlertCircle size={14} />
                                        <span>No se creó invitación. El owner actual puede invitar usuarios desde Configuración.</span>
                                    </div>
                                )}

                                <div className="modal-footer">
                                    <button type="button" className="btn-cancel" onClick={closeModal}>
                                        Cerrar
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <style jsx>{`
                .panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }

                .empty-state {
                    text-align: center;
                    padding: 48px 20px;
                    color: #64748b;
                    background: white;
                    border-radius: 16px;
                    border: 1px dashed #e2e8f0;
                }
                .empty-state p { margin: 8px 0; }

                .btn-primary {
                    background: #6366f1;
                    color: white;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .btn-primary:hover { background: #4f46e5; }

                .companies-list { display: flex; flex-direction: column; gap: 12px; }
                .company-card {
                    background: white;
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    padding: 16px 20px;
                    transition: all 0.2s;
                }
                .company-card:hover { box-shadow: 0 4px 8px rgba(0,0,0,0.04); }
                .card-main { display: flex; justify-content: space-between; align-items: center; }
                .company-card h3 { margin: 0 0 4px; font-size: 1rem; color: #0f172a; }
                .meta { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
                .badge {
                    background: #eff6ff;
                    color: #4f46e5;
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-size: 0.75rem;
                    font-weight: 600;
                    font-family: monospace;
                }
                .meta-item { color: #64748b; font-size: 0.8rem; }
                .company-id { color: #94a3b8; font-size: 0.75rem; font-family: monospace; }

                .error-box {
                    background: #fef2f2;
                    border: 1px solid #fecaca;
                    padding: 12px;
                    border-radius: 12px;
                    color: #dc2626;
                    display: flex;
                    gap: 10px;
                    margin-bottom: 16px;
                }

                /* Modal */
                .modal-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(15, 23, 42, 0.4);
                    backdrop-filter: blur(4px);
                    display: flex; justify-content: center; align-items: center;
                    z-index: 2000;
                }
                .modal-window {
                    background: white;
                    border-radius: 16px;
                    width: 100%;
                    max-width: 560px;
                    max-height: 90vh;
                    overflow-y: auto;
                }
                .modal-header {
                    padding: 20px 24px;
                    border-bottom: 1px solid #e2e8f0;
                    display: flex; justify-content: space-between; align-items: center;
                }
                .modal-body { padding: 24px; display: flex; flex-direction: column; gap: 20px; }

                .form-section { display: flex; flex-direction: column; gap: 12px; }
                .form-section h4 {
                    margin: 0; font-size: 0.875rem; color: #475569;
                    text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;
                }
                .section-desc { font-size: 0.85rem; color: #64748b; margin: -4px 0 0; }

                .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
                .form-group { display: flex; flex-direction: column; gap: 6px; }
                .form-group label { font-size: 0.85rem; font-weight: 600; color: #475569; }
                .form-group input {
                    padding: 10px;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    outline: none;
                    font-size: 0.875rem;
                }
                .form-group input:focus { border-color: #6366f1; }

                .link-box {
                    display: flex; gap: 8px; align-items: center;
                    padding: 8px; border: 1px solid #e2e8f0; border-radius: 12px;
                    background: #f8fafc;
                }
                .link-box input {
                    flex: 1; border: none; background: transparent;
                    font-size: 0.8rem; color: #475569; padding: 4px 8px;
                }
                .btn-copy {
                    display: flex; align-items: center; gap: 4px;
                    padding: 6px 12px;
                    background: #6366f1; color: white;
                    border: none; border-radius: 8px;
                    font-size: 0.75rem; font-weight: 600; cursor: pointer;
                }
                .btn-copy:hover { background: #4f46e5; }

                .success-box {
                    display: flex; gap: 12px; align-items: flex-start;
                    padding: 16px; background: #f0fdf4;
                    border: 1px solid #bbf7d0; border-radius: 12px;
                }

                .info-note {
                    display: flex; gap: 8px; align-items: center;
                    padding: 10px 12px; background: #fef3c7;
                    border-radius: 8px; font-size: 0.8rem; color: #78350f;
                }

                .modal-footer {
                    display: flex; justify-content: space-between; gap: 12px;
                    margin-top: 12px;
                }
                .btn-cancel {
                    background: #f1f5f9; border: none;
                    padding: 12px 24px; border-radius: 12px;
                    font-weight: 600; cursor: pointer; color: #64748b;
                }
                .btn-save {
                    background: #0f172a; color: white;
                    border: none; padding: 12px 24px;
                    border-radius: 12px; font-weight: 600;
                    cursor: pointer; display: flex; align-items: center; gap: 8px;
                }
                .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }

                .btn-close {
                    background: transparent; border: none; cursor: pointer;
                    color: #64748b; padding: 4px;
                }

                /* Skeleton */
                .skeleton-card {
                    display: flex; flex-direction: column; gap: 8px;
                }
                .skeleton-line {
                    height: 14px; background: #e2e8f0; border-radius: 4px;
                    position: relative; overflow: hidden;
                }
                .skeleton-line.w-40 { width: 40%; }
                .skeleton-line.w-24 { width: 24%; }

                .skeleton-line::after {
                    content: ""; position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent);
                    animation: skeleton-shimmer 1.5s infinite;
                }

                .spin { animation: spin 1s linear infinite; }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                @keyframes skeleton-shimmer {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(100%); }
                }
            `}</style>
        </div>
    );
}