'use client'

import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { deleteSale } from '../../app/actions/sales_history';

/**
 * Modal de confirmación para eliminar una venta.
 *
 * Subcomponente del POS. Encargado de:
 * - Mostrar advertencia visual
 * - Llamar a deleteSale y propagar resultado al padre
 */
interface DeleteConfirmModalProps {
    saleId: string | null;
    onClose: () => void;
    onDeleted: () => void;
    onError: (msg: string) => void;
}

export default function DeleteConfirmModal({ saleId, onClose, onDeleted, onError }: DeleteConfirmModalProps) {
    const [isDeleting, setIsDeleting] = useState(false);

    if (!saleId) return null;

    const handleConfirm = async () => {
        setIsDeleting(true);
        const res = await deleteSale(saleId);
        setIsDeleting(false);

        if (res.success) {
            onDeleted();
        } else {
            onError("Error al eliminar venta: " + (res.error || ''));
        }
    };

    return (
        <div className="modal-overlay dark-blur" onClick={onClose}>
            <div className="modal-confirm-delete animate-pop" onClick={e => e.stopPropagation()}>
                <div className="delete-icon-wrap"><Trash2 size={40} /></div>
                <h2>¿Eliminar Venta?</h2>
                <p>Esta acción devolverá los productos al inventario y eliminará el registro permanentemente.</p>
                <div className="delete-modal-actions">
                    <button className="btn-cancel-delete" onClick={onClose}>CANCELAR</button>
                    <button
                        className="btn-confirm-delete-final"
                        disabled={isDeleting}
                        onClick={handleConfirm}
                    >
                        {isDeleting ? 'ELIMINANDO...' : 'SÍ, ELIMINAR'}
                    </button>
                </div>
            </div>
        </div>
    );
}