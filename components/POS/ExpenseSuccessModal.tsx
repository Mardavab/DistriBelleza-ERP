'use client'

import React from 'react';
import { CheckCircle, Receipt, Plus, X } from 'lucide-react';
import ModalBase, { ModalButton } from '../UI/ModalBase';
import { formatCurrency, formatDateTime } from '../../lib/format';

/**
 * Modal de éxito al registrar un gasto.
 *
 * Se muestra después de registrar un gasto menor desde el POS.
 * Muestra los detalles del gasto y permite:
 *   - Registrar otro gasto (limpia el formulario)
 *   - Cerrar y volver al tab de ventas
 */
interface ExpenseSuccessModalProps {
    expense: {
        description: string;
        amount: number;
    } | null;
    onClose: () => void;
    onNewExpense: () => void;
}

export default function ExpenseSuccessModal({ expense, onClose, onNewExpense }: ExpenseSuccessModalProps) {
    if (!expense) return null;

    return (
        <ModalBase onClose={onClose} size="sm">
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: 'var(--space-5) var(--space-6)',
                borderBottom: '1px solid var(--color-border)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: 'var(--radius-lg)',
                        background: 'var(--color-success-light)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        <CheckCircle size={24} color="var(--color-success-dark)" />
                    </div>
                    <h3 style={{
                        margin: 0,
                        fontSize: 'var(--font-lg)',
                        color: 'var(--color-text)',
                        fontWeight: 'var(--font-weight-semibold)',
                    }}>
                        Gasto registrado
                    </h3>
                </div>
                <button
                    onClick={onClose}
                    style={{
                        background: 'var(--color-bg)',
                        border: 'none',
                        borderRadius: '50%',
                        width: '32px',
                        height: '32px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        color: 'var(--color-text-mute)',
                    }}
                >
                    <X size={20} />
                </button>
            </div>

            <div style={{
                padding: 'var(--space-6)',
                textAlign: 'center',
            }}>
                <div style={{
                    background: 'var(--color-success-light)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'var(--space-5)',
                    marginBottom: 'var(--space-5)',
                    textAlign: 'left',
                }}>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        marginBottom: 'var(--space-3)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                            <Receipt size={16} color="var(--color-text-mute)" />
                            <span style={{
                                fontSize: 'var(--font-sm)',
                                color: 'var(--color-text-mute)',
                                fontWeight: 'var(--font-weight-medium)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.025em',
                            }}>
                                Descripción
                            </span>
                        </div>
                    </div>
                    <p style={{
                        margin: '0 0 var(--space-4) 0',
                        fontSize: 'var(--font-md)',
                        color: 'var(--color-text)',
                        fontWeight: 'var(--font-weight-medium)',
                    }}>
                        {expense.description}
                    </p>

                    <div style={{
                        borderTop: '1px dashed var(--color-border)',
                        paddingTop: 'var(--space-3)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                    }}>
                        <span style={{
                            fontSize: 'var(--font-sm)',
                            color: 'var(--color-text-mute)',
                            fontWeight: 'var(--font-weight-medium)',
                        }}>
                            Monto
                        </span>
                        <span style={{
                            fontSize: 'var(--font-xl)',
                            fontWeight: 'var(--font-weight-bold)',
                            color: 'var(--color-danger-dark)',
                        }}>
                            -{formatCurrency(expense.amount)}
                        </span>
                    </div>
                </div>

                <p style={{
                    fontSize: 'var(--font-sm)',
                    color: 'var(--color-text-light)',
                    margin: 0,
                }}>
                    {formatDateTime(new Date())}
                </p>
            </div>

            <div style={{
                padding: 'var(--space-4) var(--space-6)',
                borderTop: '1px solid var(--color-border)',
                display: 'flex',
                gap: 'var(--space-3)',
            }}>
                <ModalButton variant="secondary" onClick={onClose}>
                    Cerrar
                </ModalButton>
                <ModalButton variant="primary" onClick={onNewExpense}>
                    <Plus size={16} /> Nuevo gasto
                </ModalButton>
            </div>
        </ModalBase>
    );
}