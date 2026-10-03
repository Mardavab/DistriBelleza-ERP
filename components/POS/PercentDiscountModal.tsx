'use client'

import React, { useState, useEffect } from 'react';
import { Percent } from 'lucide-react';
import { CartItem } from './types';

/**
 * Modal para aplicar un descuento porcentual a un item del carrito.
 *
 * Subcomponente del POS. Encargado de:
 * - Pedir el porcentaje (0-100)
 * - Calcular el descuento en pesos y notificar al padre
 */
interface PercentDiscountModalProps {
    itemId: string | null;
    cart: CartItem[];
    onApply: (itemId: string, discountAmount: number) => void;
    onClose: () => void;
}

export default function PercentDiscountModal({ itemId, cart, onApply, onClose }: PercentDiscountModalProps) {
    const [percentValue, setPercentValue] = useState('');

    useEffect(() => {
        if (itemId) setPercentValue('');
    }, [itemId]);

    const handleApply = () => {
        if (!itemId) return;
        const item = cart.find(i => i.variant_id === itemId);
        if (!item) return;

        const percent = parseFloat(percentValue) || 0;
        const discountAmount = Math.round((item.price * item.quantity) * (percent / 100));
        onApply(itemId, discountAmount);
    };

    if (!itemId) return null;

    return (
        <div className="modal-overlay dark-blur" onClick={onClose}>
            <div className="modal-percent animate-pop" onClick={e => e.stopPropagation()}>
                <div className="percent-header">
                    <Percent size={24} />
                    <h3>Aplicar Porcentaje</h3>
                </div>
                <div className="percent-body">
                    <input
                        type="number"
                        placeholder="%"
                        value={percentValue}
                        onChange={e => setPercentValue(e.target.value)}
                        autoFocus
                        onKeyDown={e => e.key === 'Enter' && handleApply()}
                    />
                </div>
                <div className="percent-footer">
                    <button className="btn-cancel-sm" onClick={onClose}>Cerrar</button>
                    <button className="btn-confirm-sm" onClick={handleApply}>Aplicar</button>
                </div>
            </div>
        </div>
    );
}