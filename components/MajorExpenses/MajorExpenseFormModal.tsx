'use client'

import React, { useState } from 'react';
import ModalBase, { ModalHeader, ModalBody, ModalFooter, ModalButton } from '../UI/ModalBase';
import CustomSelect from '../UI/CustomSelect';
import { parseCurrencyInput } from '../../lib/format';
import { addMajorExpense } from '../../app/actions/major_expenses';
import type { MajorExpenseCategory } from './categories';

interface Props {
    onClose: () => void;
    onSaved: () => Promise<void> | void;
}

export default function MajorExpenseFormModal({ onClose, onSaved }: Props) {
    const [category, setCategory] = useState<MajorExpenseCategory>('RENT');
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSave = async () => {
        if (!description.trim() || !amount || saving) return;
        setSaving(true);
        setError('');
        try {
            const numericAmount = parseCurrencyInput(amount);
            const res = await addMajorExpense(
                category,
                description.trim(),
                numericAmount,
                expenseDate,
                notes.trim() || null
            );
            if (res.success) {
                await onSaved();
                onClose();
            } else {
                setError(res.error || 'No se pudo registrar el gasto');
            }
        } catch (err: any) {
            setError(err?.message || 'Error inesperado al registrar el gasto');
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalBase onClose={onClose} size="md">
            <ModalHeader title="Registrar Gasto Mayor" onClose={onClose} />

            <ModalBody>
                {error && (
                    <div className="ui-alert ui-alert-danger" style={{ marginBottom: 'var(--space-4)' }}>
                        {error}
                    </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                    <div className="ui-field">
                        <label className="ui-label">Categoría</label>
                        <CustomSelect
                            value={category}
                            onChange={(val: any) => setCategory(val)}
                            options={CATEGORY_OPTIONS}
                        />
                    </div>

                    <div className="ui-field">
                        <label className="ui-label">Fecha</label>
                        <input
                            className="ui-input"
                            type="date"
                            value={expenseDate}
                            onChange={(e) => setExpenseDate(e.target.value)}
                        />
                    </div>

                    <div className="ui-field" style={{ gridColumn: '1 / -1' }}>
                        <label className="ui-label">Descripción</label>
                        <input
                            className="ui-input"
                            type="text"
                            placeholder="Ej: Arriendo local comercial, Servicio de energía..."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </div>

                    <div className="ui-field">
                        <label className="ui-label">Valor (COP)</label>
                        <div style={{ position: 'relative' }}>
                            <span style={{
                                position: 'absolute',
                                left: '12px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: 'var(--color-text-light)',
                                fontWeight: 'var(--font-weight-bold)',
                                pointerEvents: 'none',
                            }}>$</span>
                            <input
                                className="ui-input"
                                style={{ paddingLeft: '28px' }}
                                type="text"
                                inputMode="numeric"
                                placeholder="0"
                                value={amount}
                                onChange={(e) => {
                                    const raw = parseCurrencyInput(e.target.value);
                                    setAmount(raw ? raw.toLocaleString('es-CO') : '');
                                }}
                            />
                        </div>
                    </div>

                    <div className="ui-field">
                        <label className="ui-label">Notas (opcional)</label>
                        <input
                            className="ui-input"
                            type="text"
                            placeholder="Referencia adicional..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                        />
                    </div>
                </div>
            </ModalBody>

            <ModalFooter>
                <ModalButton variant="secondary" onClick={onClose} disabled={saving}>
                    Cancelar
                </ModalButton>
                <ModalButton
                    variant="primary"
                    onClick={handleSave}
                    disabled={!description.trim() || !amount}
                    loading={saving}
                    style={{ flex: 1 }}
                >
                    {saving ? 'Guardando...' : 'GUARDAR GASTO'}
                </ModalButton>
            </ModalFooter>
        </ModalBase>
    );
}

const CATEGORY_OPTIONS = [
    { value: 'RENT', label: 'Arriendo', icon: null },
    { value: 'UTILITIES', label: 'Servicios Públicos', icon: null },
    { value: 'PAYROLL', label: 'Nómina', icon: null },
    { value: 'MAINTENANCE', label: 'Mantenimiento', icon: null },
    { value: 'INSURANCE', label: 'Seguros', icon: null },
    { value: 'TAXES', label: 'Impuestos', icon: null },
    { value: 'OTHER', label: 'Otros', icon: null },
];