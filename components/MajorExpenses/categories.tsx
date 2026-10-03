import React from 'react';
import { Building2, Zap, User, RefreshCw, ShieldCheck, DollarSign, MinusCircle } from 'lucide-react';

export type MajorExpenseCategory =
    | 'RENT'
    | 'UTILITIES'
    | 'PAYROLL'
    | 'MAINTENANCE'
    | 'INSURANCE'
    | 'TAXES'
    | 'OTHER';

export interface CategoryConfig {
    label: string;
    icon: React.ReactNode;
    color: string;
    bg: string;
}

export const CATEGORY_CONFIG: Record<MajorExpenseCategory, CategoryConfig> = {
    RENT: { label: 'Arriendo', icon: <Building2 size={16} />, color: 'var(--color-danger)', bg: 'var(--color-danger-light)' },
    UTILITIES: { label: 'Servicios Públicos', icon: <Zap size={16} />, color: 'var(--color-info)', bg: 'var(--color-info-bg)' },
    PAYROLL: { label: 'Nómina', icon: <User size={16} />, color: 'var(--color-primary)', bg: 'var(--color-primary-bg)' },
    MAINTENANCE: { label: 'Mantenimiento', icon: <RefreshCw size={16} />, color: '#ea580c', bg: '#ffedd5' },
    INSURANCE: { label: 'Seguros', icon: <ShieldCheck size={16} />, color: 'var(--color-success-dark)', bg: 'var(--color-success-light)' },
    TAXES: { label: 'Impuestos', icon: <DollarSign size={16} />, color: 'var(--color-warning-dark)', bg: 'var(--color-warning-light)' },
    OTHER: { label: 'Otros', icon: <MinusCircle size={16} />, color: 'var(--color-text-mute)', bg: 'var(--color-bg)' },
};

export const CATEGORY_ENTRIES = Object.entries(CATEGORY_CONFIG) as [MajorExpenseCategory, CategoryConfig][];

export const getCategory = (key: string): CategoryConfig =>
    CATEGORY_CONFIG[key as MajorExpenseCategory] ?? CATEGORY_CONFIG.OTHER;