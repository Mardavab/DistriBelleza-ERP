'use client'

import React from 'react';
import { Zap, History } from 'lucide-react';

/**
 * Conjunto de toasts del POS.
 *
 * Subcomponente del POS. Dos toasts no bloqueantes que aparecen en la
 * esquina superior derecha según el evento:
 *   - Producto añadido al carrito (info)
 *   - Carrito restaurado de localStorage (warning)
 *
 * Para "gasto registrado" ahora hay un modal dedicado
 * (ExpenseSuccessModal) en lugar de un toast.
 */

interface PosToastsProps {
    showProductAdded: boolean;
    showRestoredToast: boolean;
    addedProductName?: string;
}

export default function PosToasts({
    showProductAdded,
    showRestoredToast,
    addedProductName,
}: PosToastsProps) {
    return (
        <>
            {showProductAdded && (
                <div className="global-toast product-added-toast animate-slide-in-right">
                    <div className="toast-content">
                        <Zap size={20} className="text-white" />
                        <p className="toast-title">{addedProductName} agregado</p>
                    </div>
                    <div className="toast-progress" />
                </div>
            )}

            {showRestoredToast && (
                <div className="global-toast cart-restored-toast animate-slide-in-right">
                    <div className="toast-content">
                        <History size={20} className="text-white" />
                        <p className="toast-title">Carrito restaurado</p>
                        <p className="toast-subtitle">Tenías items sin completar</p>
                    </div>
                    <div className="toast-progress" />
                </div>
            )}
        </>
    );
}