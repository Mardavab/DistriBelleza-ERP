'use client'

import React, { useState } from 'react';
import { Plus, Link2, Copy, Check, AlertCircle } from 'lucide-react';
import ModalBase, { ModalHeader, ModalBody, ModalFooter, ModalButton } from '../UI/ModalBase';
import { createCompany } from '../../app/actions/companies';
import { slugify } from '../../lib/slug';

interface CompanyForm {
    legal_name: string;
    trade_name: string;
    slug: string;
    tax_id: string;
    address: string;
    phone: string;
    email: string;
    currency: string;
    timezone: string;
    initialOwnerEmail: string;
}

interface SuccessResult {
    company_id: string;
    invitation_url: string | null;
    trade_name: string;
}

const EMPTY_FORM: CompanyForm = {
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
};

interface CreateCompanyModalProps {
    onClose: () => void;
    onCreated: () => void;
}

export default function CreateCompanyModal({ onClose, onCreated }: CreateCompanyModalProps) {
    const [form, setForm] = useState<CompanyForm>(EMPTY_FORM);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<SuccessResult | null>(null);
    const [copied, setCopied] = useState(false);

    function update<K extends keyof CompanyForm>(key: K, value: CompanyForm[K]) {
        setForm(prev => ({ ...prev, [key]: value }));
    }

    function handleTradeNameChange(value: string) {
        // El slug se autocompleta solo mientras el usuario no lo edite a mano.
        setForm(prev => ({
            ...prev,
            trade_name: value,
            slug: prev.slug || slugify(value),
        }));
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setSubmitting(true);

        const res = await createCompany(form);
        setSubmitting(false);

        if (res.success && res.data) {
            setSuccess({
                company_id: res.data.company_id,
                invitation_url: res.data.invitation_url,
                trade_name: form.trade_name,
            });
            setForm(EMPTY_FORM);
            onCreated();
        } else {
            setError(res.error ?? 'Error desconocido');
        }
    }

    async function handleCopyLink() {
        if (!success?.invitation_url) return;
        try {
            await navigator.clipboard.writeText(success.invitation_url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            prompt('Copia este link:', success.invitation_url);
        }
    }

    return (
        <ModalBase onClose={onClose} size="md">
            <ModalHeader
                title={success ? 'Empresa Creada' : 'Nueva Empresa Cliente'}
                onClose={onClose}
            />

            <ModalBody>
                {error && (
                    <div className="platform-alert-error">
                        <AlertCircle size={18} />
                        <span>{error}</span>
                    </div>
                )}

                {!success ? (
                    <form id="create-company-form" onSubmit={handleSubmit}>
                        <div className="platform-form-section">
                            <h4>Información básica</h4>
                            <div className="platform-form-row">
                                <div className="platform-field">
                                    <label htmlFor="cc-trade-name">Nombre comercial *</label>
                                    <input
                                        id="cc-trade-name"
                                        type="text"
                                        required
                                        placeholder="Ej: Belleza Total"
                                        value={form.trade_name}
                                        onChange={e => handleTradeNameChange(e.target.value)}
                                    />
                                </div>
                                <div className="platform-field">
                                    <label htmlFor="cc-slug">Slug (identificador URL) *</label>
                                    <input
                                        id="cc-slug"
                                        type="text"
                                        required
                                        placeholder="belleza-total"
                                        pattern="[a-z0-9\-]+"
                                        value={form.slug}
                                        onChange={e => update('slug', e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="platform-field">
                                <label htmlFor="cc-legal-name">Razón social *</label>
                                <input
                                    id="cc-legal-name"
                                    type="text"
                                    required
                                    placeholder="Ej: Belleza Total S.A.S."
                                    value={form.legal_name}
                                    onChange={e => update('legal_name', e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="platform-form-section">
                            <h4>Información fiscal y contacto (opcional)</h4>
                            <div className="platform-form-row">
                                <div className="platform-field">
                                    <label htmlFor="cc-tax-id">NIT / Tax ID</label>
                                    <input
                                        id="cc-tax-id"
                                        type="text"
                                        placeholder="900.xxx.xxx-x"
                                        value={form.tax_id}
                                        onChange={e => update('tax_id', e.target.value)}
                                    />
                                </div>
                                <div className="platform-field">
                                    <label htmlFor="cc-phone">Teléfono</label>
                                    <input
                                        id="cc-phone"
                                        type="tel"
                                        placeholder="+57 300 000 0000"
                                        value={form.phone}
                                        onChange={e => update('phone', e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="platform-field">
                                <label htmlFor="cc-address">Dirección</label>
                                <input
                                    id="cc-address"
                                    type="text"
                                    placeholder="Calle 100 #15-20"
                                    value={form.address}
                                    onChange={e => update('address', e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="platform-form-section">
                            <h4>Owner inicial (opcional)</h4>
                            <p className="platform-form-desc">
                                Si proporcionas un email, generaremos una invitación que el
                                nuevo owner usará para crear su cuenta y empezar a gestionar
                                la empresa.
                            </p>
                            <div className="platform-field">
                                <label htmlFor="cc-owner-email">Email del primer owner</label>
                                <input
                                    id="cc-owner-email"
                                    type="email"
                                    placeholder="dueno@empresa.com"
                                    value={form.initialOwnerEmail}
                                    onChange={e => update('initialOwnerEmail', e.target.value)}
                                />
                            </div>
                        </div>
                    </form>
                ) : (
                    <>
                        <div className="platform-success-box">
                            <Check size={24} className="platform-success-icon" />
                            <div>
                                <strong>Empresa "{success.trade_name}" creada</strong>
                                <p>
                                    La empresa se creó con su configuración inicial.
                                </p>
                            </div>
                        </div>

                        {success.invitation_url ? (
                            <>
                                <div className="platform-info-note">
                                    <Link2 size={14} />
                                    <span>
                                        Comparte este link con el nuevo owner.
                                        Tendrá 7 días para aceptar la invitación.
                                    </span>
                                </div>

                                <div className="platform-field">
                                    <label htmlFor="cc-invite-link">Link de invitación</label>
                                    <div className="platform-link-box">
                                        <Link2 size={16} />
                                        <input
                                            id="cc-invite-link"
                                            type="text"
                                            value={success.invitation_url}
                                            readOnly
                                            onClick={e => e.currentTarget.select()}
                                        />
                                        <button
                                            type="button"
                                            className="platform-btn-copy"
                                            onClick={handleCopyLink}
                                        >
                                            {copied ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar</>}
                                        </button>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="platform-info-note">
                                <AlertCircle size={14} />
                                <span>
                                    No se creó invitación. El owner actual puede invitar
                                    usuarios desde Configuración.
                                </span>
                            </div>
                        )}
                    </>
                )}
            </ModalBody>

            <ModalFooter>
                {success ? (
                    <ModalButton onClick={onClose} variant="primary">Cerrar</ModalButton>
                ) : (
                    <>
                        <ModalButton onClick={onClose} variant="secondary">Cancelar</ModalButton>
                        <ModalButton
                            type="submit"
                            form="create-company-form"
                            loading={submitting}
                        >
                            <Plus size={18} />
                            Crear Empresa
                        </ModalButton>
                    </>
                )}
            </ModalFooter>
        </ModalBase>
    );
}