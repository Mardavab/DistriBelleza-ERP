'use client'

import React from 'react';
import { Banknote, CreditCard, RefreshCw, ShieldCheck, Smartphone, Wallet, QrCode, AlertTriangle } from 'lucide-react';
import CustomSelect from '../UI/CustomSelect';
import { formatCurrency, formatCurrencyInput, parseCurrencyInput } from '../../lib/format';
import { PaymentMethod, TransferType } from './types';

/**
 * Form de checkout del POS: método de pago, efectivo recibido, totales.
 *
 * Subcomponente del POS. Encargado de:
 * - Selector de método de pago (Efectivo, Tarjeta, Transf., Crédito)
 * - Input de efectivo recibido (solo si es CASH)
 * - Selector de canal de transferencia (solo si es BANK_TRANSFER)
 * - Resumen: subtotal, descuentos item, total, cambio/faltante
 * - Botón CONFIRMAR VENTA
 *
 * Props: todos los states de venta y callbacks.
 */
interface CheckoutFormProps {
    paymentMethod: PaymentMethod;
    setPaymentMethod: (m: PaymentMethod) => void;
    transferType: TransferType;
    setTransferType: (t: TransferType) => void;
    cashReceived: string | number;
    setCashReceived: (v: string | number) => void;
    calculateSubtotal: () => number;
    calculateItemDiscounts: () => number;
    calculateTotal: () => number;
    cartIsEmpty: boolean;
    isLoading: boolean;
    hasActiveSession: boolean;
    error: string | null;
    onConfirm: () => void;
}

export default function CheckoutForm({
    paymentMethod, setPaymentMethod,
    transferType, setTransferType,
    cashReceived, setCashReceived,
    calculateSubtotal, calculateItemDiscounts, calculateTotal,
    cartIsEmpty, isLoading, hasActiveSession,
    error, onConfirm,
}: CheckoutFormProps) {
    const total = calculateTotal()
    const cashNum = Number(cashReceived)
    const showChange = paymentMethod === 'CASH' && cashNum > 0
    const change = cashNum - total

    return (
        <div className="cart-checkout-form">
            <div className="checkout-row-compact">
                <div className="compact-col">
                    <CustomSelect
                        label="Pago"
                        value={paymentMethod}
                        onChange={(val: any) => setPaymentMethod(val)}
                        options={[
                            { value: 'CASH', label: 'Efectivo', icon: <Banknote size={16} /> },
                            { value: 'CARD', label: 'Tarjeta', icon: <CreditCard size={16} /> },
                            { value: 'BANK_TRANSFER', label: 'Transf.', icon: <RefreshCw size={16} /> },
                            { value: 'CREDIT', label: 'Crédito', icon: <ShieldCheck size={16} /> }
                        ]}
                    />
                </div>

                {paymentMethod === 'CASH' && (
                    <div className="compact-col">
                        <div className="cash-received-input">
                            <label>Recibido</label>
                            <div className="input-with-symbol compact">
                                <span>$</span>
                                <input
                                    type="text"
                                    placeholder="0"
                                    value={cashReceived ? formatCurrencyInput(cashReceived) : ''}
                                    onChange={(e) => {
                                        const val = parseCurrencyInput(e.target.value);
                                        setCashReceived(val === 0 ? '' : val);
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {paymentMethod === 'BANK_TRANSFER' && (
                <CustomSelect
                    label="Canal"
                    value={transferType}
                    onChange={(val: any) => setTransferType(val)}
                    options={[
                        { value: 'NEQUI', label: 'Nequi', icon: <Smartphone size={16} /> },
                        { value: 'DAVIPLATA', label: 'Daviplata', icon: <Smartphone size={16} /> },
                        { value: 'BANCOLOMBIA', label: 'Bancolombia', icon: <Wallet size={16} /> },
                        { value: 'QR', label: 'QR', icon: <QrCode size={16} /> },
                        { value: 'OTHER', label: 'Otro', icon: <RefreshCw size={16} /> }
                    ]}
                />
            )}

            <div className="summary">
                <div className="summary-row"><span>Subtotal</span><span>{formatCurrency(calculateSubtotal())}</span></div>
                <div className="summary-row"><span>Dsctos. Item</span><span>-{formatCurrency(calculateItemDiscounts())}</span></div>
                <div className="summary-row total"><span>Total a Pagar</span><span>{formatCurrency(total)}</span></div>
                {showChange && (
                    <div className="summary-row change">
                        <span>{change < 0 ? 'Faltante' : 'Cambio (Vueltas)'}</span>
                        <span className={`change-value ${change < 0 ? 'negative' : ''}`}>
                            {formatCurrency(Math.abs(change))}
                        </span>
                    </div>
                )}
            </div>

            {error && (
                <div className="error-box">
                    <AlertTriangle size={14} /> {error}
                </div>
            )}

            <button
                className="btn-confirm"
                disabled={cartIsEmpty || isLoading || !hasActiveSession}
                onClick={onConfirm}
            >
                {isLoading ? 'Procesando...' : 'CONFIRMAR VENTA'}
            </button>
        </div>
    );
}