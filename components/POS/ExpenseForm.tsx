'use client'

import React, { useState } from 'react';
import { MinusCircle } from 'lucide-react';
import { addExpense } from '../../app/actions/cash_actions';
import { formatCurrencyInput, parseCurrencyInput } from '../../lib/format';

/**
 * Form de gastos menores (salida de dinero de caja actual).
 *
 * Subcomponente del POS. Se muestra cuando activeTab === 'expenses'.
 * Pide descripción + valor, llama a addExpense action.
 */
interface ExpenseFormProps {
    hasActiveSession: boolean;
    onAdded: (data: { description: string; amount: number }) => void;
    onError: (msg: string) => void;
}

export default function ExpenseForm({ hasActiveSession, onAdded, onError }: ExpenseFormProps) {
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [isAdding, setIsAdding] = useState(false);

    const handleSubmit = async () => {
        if (!description || !amount || isAdding) return;

        setIsAdding(true);
        const numericAmount = parseCurrencyInput(amount);
        const res = await addExpense(description, numericAmount);
        setIsAdding(false);

        if (res.success) {
            // Limpiar form DESPUÉS de propagar al padre (que abrirá el modal)
            // El padre limpiará al cerrar el modal con "Nuevo gasto"
            onAdded({ description, amount: numericAmount });
        } else {
            onError(res.error || 'Error al registrar gasto');
        }
    };

    return (
        <div className="expenses-container animate-in">
            <div className="expense-form-header">
                <MinusCircle className="text-danger" size={24} />
                <h3>Registrar Gasto</h3>
                <p>Salida de dinero de la caja actual</p>
            </div>

            <div className="expense-form">
                <div className="form-group">
                    <label>Descripción</label>
                    <input
                        type="text"
                        placeholder="Ej: Pago de almuerzo, Transporte..."
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                    />
                </div>
                <div className="form-group">
                    <label>Valor (COP)</label>
                    <div className="input-with-currency">
                        <span>$</span>
                        <input
                            type="text"
                            placeholder="0"
                            value={amount}
                            onChange={e => {
                                const rawValue = parseCurrencyInput(e.target.value);
                                setAmount(rawValue ? formatCurrencyInput(rawValue) : '');
                            }}
                        />
                    </div>
                </div>

                <button
                    className="btn-save-expense"
                    disabled={!description || !amount || isAdding || !hasActiveSession}
                    onClick={handleSubmit}
                >
                    {isAdding ? 'Guardando...' : 'GUARDAR GASTO'}
                </button>
            </div>
        </div>
    );
}