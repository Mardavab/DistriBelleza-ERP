'use client'

import React from 'react';
import ModalBase, { ModalHeader, ModalFooter, ModalButton } from '../UI/ModalBase';

/**
 * Modal específico para Confirmar/Eliminar acciones.
 *
 * Reutilizable en TODO el sistema para mantener consistencia visual.
 * Ejemplo de uso:
 *
 *   <ConfirmModal
 *     title="¿Eliminar venta?"
 *     message="Esta acción no se puede deshacer."
 *     confirmLabel="ELIMINAR"
 *     variant="danger"
 *     onConfirm={...}
 *     onClose={...}
 *   />
 */
interface ConfirmModalProps {
    title: string;
    message: string | React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'primary';
    loading?: boolean;
    onConfirm: () => void;
    onClose: () => void;
}

export default function ConfirmModal({
    title,
    message,
    confirmLabel = 'CONFIRMAR',
    cancelLabel = 'CANCELAR',
    variant = 'primary',
    loading = false,
    onConfirm,
    onClose,
}: ConfirmModalProps) {
    return (
        <ModalBase onClose={onClose} size="sm" variant={variant === 'danger' ? 'danger' : 'default'}>
            <ModalHeader title={title} onClose={onClose} />
            <div className="ui-modal-body" style={{ textAlign: 'center', padding: '32px 24px' }}>
                <p style={{ color: 'var(--color-text-mute)', lineHeight: 1.5, margin: 0 }}>
                    {message}
                </p>
            </div>
            <ModalFooter>
                <ModalButton variant="secondary" onClick={onClose}>
                    {cancelLabel}
                </ModalButton>
                <ModalButton variant={variant} onClick={onConfirm} loading={loading}>
                    {confirmLabel}
                </ModalButton>
            </ModalFooter>
        </ModalBase>
    );
}