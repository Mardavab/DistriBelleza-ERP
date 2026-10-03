'use client'

import React from 'react';
import { Receipt, Trash2, Percent } from 'lucide-react';
import { CartItem } from './types';
import { formatCurrency } from '../../lib/format';

/**
 * Lista visual del carrito de ventas.
 *
 * Subcomponente del POS. Encargado de:
 * - Renderizar cada item con sus controles (qty, descuento %, eliminar)
 * - Mostrar estado vacío cuando no hay items
 *
 * Props: cart y setCart. Todo el resto (modals, lógica de descuento)
 * se maneja en POS.tsx vía callbacks.
 */
interface CartPanelProps {
    cart: CartItem[];
    setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
    onRemoveItem: (variantId: string) => void;
    onPercentDiscount: (variantId: string) => void;
}

export default function CartPanel({ cart, setCart, onRemoveItem, onPercentDiscount }: CartPanelProps) {
    if (cart.length === 0) {
        return (
            <div className="cart-list">
                <div className="empty-state">
                    <Receipt size={40} />
                    <p>El carrito está vacío</p>
                    <p className="empty-hint">Escanea o busca productos para agregar</p>
                </div>
            </div>
        );
    }

    return (
        <div className="cart-list">
            {cart.map(item => (
                <div key={item.variant_id} className="cart-item">
                    <div className="cart-item-main">
                        <div className="item-desc">
                            <p className="name">{item.product_name}</p>
                            <p className="sub">{item.variant_name} · {formatCurrency(item.price)} c/u</p>
                        </div>
                        <span className="item-price">{formatCurrency(item.price * item.quantity)}</span>
                    </div>
                    <div className="cart-item-actions">
                        <div className="qty-controls">
                            <button
                                className="qty-btn"
                                onClick={() => {
                                    if (item.quantity > 1) {
                                        setCart(prev => prev.map(i =>
                                            i.variant_id === item.variant_id
                                                ? { ...i, quantity: i.quantity - 1 }
                                                : i
                                        ));
                                    }
                                }}
                            >-</button>
                            <input
                                type="number"
                                value={item.quantity === 0 ? '' : item.quantity}
                                onChange={(e) => {
                                    const val = parseInt(e.target.value);
                                    setCart(prev => prev.map(i =>
                                        i.variant_id === item.variant_id
                                            ? { ...i, quantity: isNaN(val) || val < 1 ? 1 : val }
                                            : i
                                    ));
                                }}
                                min="1"
                            />
                            <button
                                className="qty-btn"
                                onClick={() => {
                                    setCart(prev => prev.map(i =>
                                        i.variant_id === item.variant_id
                                            ? { ...i, quantity: i.quantity + 1 }
                                            : i
                                    ));
                                }}
                            >+</button>
                        </div>
                        <button
                            className="btn-percent-inline"
                            title="Descuento %"
                            onClick={() => onPercentDiscount(item.variant_id)}
                        >
                            <Percent size={12} />
                        </button>
                        {item.discount > 0 && (
                            <span className="discount-applied">-{formatCurrency(item.discount)}</span>
                        )}
                        <button
                            className="btn-remove-inline"
                            onClick={() => onRemoveItem(item.variant_id)}
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}