'use client'

import React from 'react';
import { X } from 'lucide-react';

/**
 * Modal base — Componente compartido para todos los modales del sistema.
 *
 * Garantiza:
 * - Estilo consistente (overlay oscuro con blur, contenedor blanco, bordes redondeados)
 * - Comportamiento consistente (cerrar con click fuera, botón X)
 * - Stop propagation en el contenido para no cerrar al click dentro
 *
 * Subcomponentes:
 *   <ModalBase>
 *     <ModalHeader title="..." onClose={...} />
 *     <ModalBody>{...}</ModalBody>
 *     <ModalFooter>{...}</ModalFooter>
 *   </ModalBase>
 *
 * O simplemente usar <ModalBase title onClose>{children}</ModalBase>
 */

interface ModalHeaderProps {
    title: string;
    onClose: () => void;
    children?: React.ReactNode;
}

export function ModalHeader({ title, onClose, children }: ModalHeaderProps) {
    return (
        <div className="ui-modal-header">
            <h3>{title}</h3>
            <button className="ui-modal-close" onClick={onClose}><X size={20} /></button>
            {children}
        </div>
    );
}

interface ModalBodyProps {
    children: React.ReactNode;
}

export function ModalBody({ children }: ModalBodyProps) {
    return <div className="ui-modal-body">{children}</div>;
}

interface ModalFooterProps {
    children: React.ReactNode;
}

export function ModalFooter({ children }: ModalFooterProps) {
    return <div className="ui-modal-footer">{children}</div>;
}

interface ModalBaseProps {
    onClose: () => void;
    children: React.ReactNode;
    size?: 'sm' | 'md' | 'lg';
    variant?: 'default' | 'danger' | 'success';
}

export default function ModalBase({
    onClose,
    children,
    size = 'md',
    variant = 'default',
}: ModalBaseProps) {
    return (
        <div className="ui-modal-overlay" onClick={onClose}>
            <div
                className={`ui-modal-window ui-modal-${size} ui-modal-${variant}`}
                onClick={e => e.stopPropagation()}
            >
                {children}
            </div>
        </div>
    );
}

/**
 * Botones estandarizados para modales (cancel, primary, danger).
 * Usar dentro de ModalFooter.
 */
interface ModalButtonProps {
    onClick?: () => void;
    disabled?: boolean;
    loading?: boolean;
    children: React.ReactNode;
    variant?: 'primary' | 'secondary' | 'danger';
    type?: 'submit' | 'button';
    style?: React.CSSProperties;
}

export function ModalButton({
    onClick,
    disabled,
    loading,
    children,
    variant = 'primary',
    type = 'button',
    style,
}: ModalButtonProps) {
    return (
        <button
            type={type}
            className={`ui-btn ui-btn-${variant}`}
            onClick={onClick}
            disabled={disabled || loading}
            style={style}
        >
            {loading ? '...' : children}
        </button>
    );
}