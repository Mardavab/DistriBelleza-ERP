'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit3, Power, Store, MapPin, Phone, AlertCircle, X } from 'lucide-react';
import {
    listBranchesAction,
    createBranchAction,
    updateBranchAction,
    deactivateBranchAction,
} from '../../app/actions/branches';
import { isFailure, isSuccess, warnSilently } from '../../lib/errors';
import type { Branch } from '../../lib/supabase/branches';

interface BranchManagementProps {
    currentUserRole: string;
}

interface FormState {
    code: string;
    name: string;
    address: string;
    phone: string;
}

const EMPTY_FORM: FormState = { code: '', name: '', address: '', phone: '' };

/**
 * UI para gestión de sucursales de la empresa activa.
 *
 * FASE 11.4 (Bloque C):
 *   - Solo visible para owners (currentUserRole === 'owner').
 *   - Lista las sucursales (activas e inactivas).
 *   - Permite crear, editar nombre/dirección/teléfono y desactivar
 *     (no se borra: deactivateBranchAction es soft delete).
 *   - La sucursal MAIN (is_main=true) no se puede desactivar.
 *
 * Las server actions ya validan permisos (requireOwner) y hacen el
 * filtro multi-tenant (defense in depth), por lo que la UI puede
 * llamar directamente y manejar la respuesta.
 */
export default function BranchManagement({ currentUserRole }: BranchManagementProps) {
    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState<Branch | null>(null);
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [submitting, setSubmitting] = useState(false);
    const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

    const isOwner = currentUserRole === 'owner';

    const load = useCallback(async () => {
        setLoading(true);
        const result = await listBranchesAction();
        if (isSuccess(result)) {
            setBranches(result.data);
        } else if (isFailure(result)) {
            setFeedback({ type: 'error', message: result.error });
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    if (!isOwner) {
        return (
            <div className="p-8 text-slate-500">
                No tienes permiso para acceder a esta sección.
            </div>
        );
    }

    function openCreateModal() {
        setEditing(null);
        setForm(EMPTY_FORM);
        setShowModal(true);
        setFeedback(null);
    }

    function openEditModal(branch: Branch) {
        setEditing(branch);
        setForm({
            code: branch.code,
            name: branch.name,
            address: branch.address ?? '',
            phone: branch.phone ?? '',
        });
        setShowModal(true);
        setFeedback(null);
    }

    function closeModal() {
        setShowModal(false);
        setEditing(null);
        setForm(EMPTY_FORM);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setSubmitting(true);
        setFeedback(null);

        try {
            if (editing) {
                const result = await updateBranchAction(editing.id, {
                    name: form.name,
                    address: form.address || null,
                    phone: form.phone || null,
                });
                if (isSuccess(result)) {
                    setFeedback({ type: 'success', message: 'Sucursal actualizada.' });
                    await load();
                    closeModal();
                } else if (isFailure(result)) {
                    setFeedback({ type: 'error', message: result.error });
                }
            } else {
                const result = await createBranchAction({
                    code: form.code,
                    name: form.name,
                    address: form.address || undefined,
                    phone: form.phone || undefined,
                });
                if (isSuccess(result)) {
                    setFeedback({ type: 'success', message: 'Sucursal creada.' });
                    await load();
                    closeModal();
                } else if (isFailure(result)) {
                    setFeedback({ type: 'error', message: result.error });
                }
            }
        } catch (err) {
            warnSilently('BranchManagement.submit', err);
            setFeedback({ type: 'error', message: 'Error inesperado.' });
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDeactivate(branch: Branch) {
        if (branch.is_main) return;
        const confirm = window.confirm(
            `¿Desactivar la sucursal "${branch.name}"? Las ventas y stock históricos se conservan.`
        );
        if (!confirm) return;

        setSubmitting(true);
        setFeedback(null);
        try {
            const result = await deactivateBranchAction(branch.id);
            if (isSuccess(result)) {
                setFeedback({ type: 'success', message: 'Sucursal desactivada.' });
                await load();
            } else if (isFailure(result)) {
                setFeedback({ type: 'error', message: result.error });
            }
        } catch (err) {
            warnSilently('BranchManagement.deactivate', err);
            setFeedback({ type: 'error', message: 'Error inesperado.' });
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="branches-view animate-fade-in">
            <header className="page-header">
                <div className="page-header-group">
                    <div className="page-title-icon">
                        <Store size={28} />
                    </div>
                    <div className="page-title-block">
                        <h1>Sucursales</h1>
                        <p>Gestión de locales de la empresa</p>
                    </div>
                </div>
                <button
                    className="btn-primary-page"
                    onClick={openCreateModal}
                    disabled={showModal || submitting}
                >
                    <Plus size={18} /> Nueva Sucursal
                </button>
            </header>

            {feedback && (
                <div
                    className={`feedback-banner ${feedback.type === 'error' ? 'feedback-error' : 'feedback-success'}`}
                >
                    {feedback.type === 'error' ? <AlertCircle size={18} /> : <Store size={18} />}
                    <span>{feedback.message}</span>
                    <button
                        className="feedback-close"
                        onClick={() => setFeedback(null)}
                        aria-label="Cerrar"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}

            {showModal && (
                <div className="modal-overlay">
                    <div className="modal-window">
                        <div className="modal-header">
                            <h3>
                                {editing
                                    ? `Editar "${editing.name}"`
                                    : 'Nueva sucursal'}
                            </h3>
                            <button
                                type="button"
                                className="btn-close"
                                onClick={closeModal}
                                aria-label="Cerrar"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="modal-body">
                            <div className="form-group">
                                <label>Código *</label>
                                <input
                                    type="text"
                                    value={form.code}
                                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                                    disabled={!!editing}
                                    placeholder="NORTE"
                                    maxLength={20}
                                    required
                                />
                                <small className="form-helper">Mayúsculas, números, guion y guion bajo. Único en la empresa.</small>
                            </div>
                            <div className="form-group">
                                <label>Nombre *</label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    placeholder="Sucursal Norte"
                                    maxLength={200}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Dirección</label>
                                <input
                                    type="text"
                                    value={form.address}
                                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                                    placeholder="Av. Norte 123"
                                    maxLength={500}
                                />
                            </div>
                            <div className="form-group">
                                <label>Teléfono</label>
                                <input
                                    type="text"
                                    value={form.phone}
                                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                    placeholder="+57 300 123 4567"
                                    maxLength={50}
                                />
                            </div>
                            <div className="modal-footer">
                                <button
                                    type="button"
                                    className="btn-cancel"
                                    onClick={closeModal}
                                    disabled={submitting}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="btn-save"
                                    disabled={submitting}
                                >
                                    {editing ? 'Guardar cambios' : 'Crear sucursal'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="branches-list-loading">Cargando sucursales…</div>
            ) : branches.length === 0 ? (
                <div className="branches-empty">
                    <Store size={48} />
                    <p>No hay sucursales registradas. Creá la primera con el botón superior.</p>
                </div>
            ) : (
                <div className="branches-list">
                    {branches.map((b) => (
                        <article
                            key={b.id}
                            className={`branch-card ${!b.active ? 'branch-card--inactive' : ''}`}
                        >
                            <div className="branch-card-header">
                                <div className="branch-card-title">
                                    <h3>
                                        {b.name}{' '}
                                        {b.is_main && <span className="badge-main">Principal</span>}
                                        {!b.active && <span className="badge-inactive">Inactiva</span>}
                                    </h3>
                                    <span className="branch-card-code">#{b.code}</span>
                                </div>
                                <div className="branch-card-actions">
                                    <button
                                        type="button"
                                        className="btn-icon"
                                        onClick={() => openEditModal(b)}
                                        aria-label={`Editar ${b.name}`}
                                        title="Editar"
                                    >
                                        <Edit3 size={16} />
                                    </button>
                                    {!b.is_main && b.active && (
                                        <button
                                            type="button"
                                            className="btn-icon btn-icon-danger"
                                            onClick={() => handleDeactivate(b)}
                                            disabled={submitting}
                                            aria-label={`Desactivar ${b.name}`}
                                            title="Desactivar"
                                        >
                                            <Power size={16} />
                                        </button>
                                    )}
                                </div>
                            </div>
                            {(b.address || b.phone) && (
                                <div className="branch-card-details">
                                    {b.address && (
                                        <p>
                                            <MapPin size={14} /> {b.address}
                                        </p>
                                    )}
                                    {b.phone && (
                                        <p>
                                            <Phone size={14} /> {b.phone}
                                        </p>
                                    )}
                                </div>
                            )}
                        </article>
                    ))}
                </div>
            )}

            <style jsx>{`
                .branches-view { padding: 0; }
                .branches-list-loading {
                    padding: 32px;
                    text-align: center;
                    color: var(--color-text-mute);
                }
                .branches-empty {
                    padding: 64px 32px;
                    text-align: center;
                    color: var(--color-text-mute);
                    background: white;
                    border-radius: 24px;
                    border: 1px solid #e2e8f0;
                }
                .branches-empty p { margin-top: 12px; }

                .branches-list {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
                    gap: 16px;
                }
                .branch-card {
                    background: white;
                    border: 1px solid #e2e8f0;
                    border-radius: 20px;
                    padding: 20px;
                    transition: all 0.2s;
                }
                .branch-card:hover {
                    box-shadow: 0 4px 12px rgba(0,0,0,0.05);
                }
                .branch-card--inactive { opacity: 0.6; }
                .branch-card-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    gap: 12px;
                }
                .branch-card-title h3 {
                    font-size: 1rem;
                    font-weight: 700;
                    color: #1e293b;
                    margin: 0;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .branch-card-code {
                    font-size: 0.7rem;
                    color: #94a3b8;
                    font-family: monospace;
                }
                .badge-main, .badge-inactive {
                    font-size: 0.65rem;
                    padding: 2px 6px;
                    border-radius: 6px;
                    text-transform: uppercase;
                    font-weight: 700;
                }
                .badge-main {
                    background: #dbeafe;
                    color: #1e40af;
                }
                .badge-inactive {
                    background: #f1f5f9;
                    color: #64748b;
                }
                .branch-card-actions {
                    display: flex;
                    gap: 4px;
                }
                .btn-icon {
                    background: transparent;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    color: #64748b;
                    transition: all 0.2s;
                }
                .btn-icon:hover:not(:disabled) {
                    background: #f8fafc;
                    color: #1e293b;
                }
                .btn-icon-danger:hover:not(:disabled) {
                    background: #fef2f2;
                    color: #b91c1c;
                    border-color: #fecaca;
                }
                .branch-card-details {
                    margin-top: 12px;
                    padding-top: 12px;
                    border-top: 1px solid #f1f5f9;
                }
                .branch-card-details p {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 0.85rem;
                    color: #64748b;
                    margin: 4px 0;
                }

                /* Modal (Fase 11 — Bug fix 1: formulario de sucursal ahora es modal) */
                .modal-overlay {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(15, 23, 42, 0.4);
                    backdrop-filter: blur(4px);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 2000;
                }
                .modal-window {
                    background: white;
                    border-radius: 24px;
                    width: 100%;
                    max-width: 520px;
                    overflow: hidden;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                }
                .modal-header {
                    padding: 24px;
                    border-bottom: 1px solid #e2e8f0;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 12px;
                }
                .modal-header h3 {
                    margin: 0;
                    font-size: 1.1rem;
                    font-weight: 700;
                    color: #1e293b;
                }
                .btn-close {
                    background: transparent;
                    border: none;
                    cursor: pointer;
                    color: #64748b;
                    padding: 4px;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s;
                }
                .btn-close:hover {
                    background: #f1f5f9;
                    color: #1e293b;
                }
                .modal-body {
                    padding: 24px;
                    display: flex;
                    flex-direction: column;
                    gap: 20px;
                }
                .form-group {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .form-group label {
                    font-size: 0.875rem;
                    font-weight: 600;
                    color: #475569;
                }
                .form-group input {
                    padding: 12px;
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    outline: none;
                    transition: border-color 0.2s;
                    font-size: 0.9rem;
                    color: #1e293b;
                    background: white;
                }
                .form-group input:focus {
                    border-color: #6366f1;
                }
                .form-group input:disabled {
                    background: #f8fafc;
                    color: #94a3b8;
                    cursor: not-allowed;
                }
                .form-helper {
                    font-size: 0.75rem;
                    color: #94a3b8;
                    margin-top: 2px;
                }
                .modal-footer {
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                    margin-top: 12px;
                }
                .btn-cancel {
                    background: #f1f5f9;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    color: #64748b;
                    transition: background 0.2s;
                }
                .btn-cancel:hover:not(:disabled) {
                    background: #e2e8f0;
                }
                .btn-cancel:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                .btn-save {
                    background: #0f172a;
                    color: white;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    transition: background 0.2s;
                }
                .btn-save:hover:not(:disabled) {
                    background: #1e293b;
                }
                .btn-save:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .feedback-banner {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px 16px;
                    border-radius: 12px;
                    margin-bottom: 16px;
                }
                .feedback-success {
                    background: #f0fdf4;
                    color: #15803d;
                    border: 1px solid #bbf7d0;
                }
                .feedback-error {
                    background: #fef2f2;
                    color: #b91c1c;
                    border: 1px solid #fecaca;
                }
                .feedback-banner span { flex: 1; }
                .feedback-close {
                    background: transparent;
                    border: none;
                    cursor: pointer;
                    color: inherit;
                    display: flex;
                    align-items: center;
                }
            `}</style>
        </div>
    );
}
