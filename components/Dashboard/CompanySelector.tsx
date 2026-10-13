'use client'

import React, { useState, useRef, useEffect } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';
import { switchActiveCompanyAction } from '../../app/actions/memberships';
import { isFailure } from '../../lib/errors';
import type { CompanyMembership } from '../../lib/supabase/memberships';

interface CompanySelectorProps {
    memberships: CompanyMembership[];
    activeCompanyId: string;
    currentRole: string;
}

/**
 * Selector de empresa activa para usuarios con varias membresías.
 *
 * FASE 10.3:
 *   - Solo se renderiza si memberships.length > 1.
 *   - Llama a `switchActiveCompanyAction(companyId)` que actualiza el JWT
 *     y refresca la sesión.
 *   - Tras el switch, hace `window.location.reload()` para forzar al cliente
 *     a obtener el JWT fresco (refreshSession no es síncrono en todos los
 *     navegadores para propagar los nuevos claims de app_metadata).
 */
export default function CompanySelector({
    memberships,
    activeCompanyId,
    currentRole,
}: CompanySelectorProps) {
    const [open, setOpen] = useState(false);
    const [switching, setSwitching] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const active = memberships.find((m) => m.company_id === activeCompanyId);
    const displayName = active?.companies?.trade_name
        || active?.companies?.legal_name
        || 'Empresa';

    useEffect(() => {
        if (!open) return;
        function handleClickOutside(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open]);

    if (memberships.length <= 1) return null;

    async function handleSelect(companyId: string) {
        if (companyId === activeCompanyId) {
            setOpen(false);
            return;
        }
        setSwitching(companyId);
        try {
            const result = await switchActiveCompanyAction(companyId);
            if (result.success) {
                // Forzar reload: refreshSession no garantiza que el cliente
                // reciba los nuevos claims sin un round-trip explícito.
                window.location.reload();
            } else if (isFailure(result)) {
                setSwitching(null);
                console.error('[CompanySelector] switch failed:', result.error);
                window.alert(result.error || 'No se pudo cambiar de empresa.');
            }
        } catch (err) {
            setSwitching(null);
            console.error('[CompanySelector] switch error:', err);
        }
    }

    return (
        <div ref={containerRef} className="company-selector">
            <button
                type="button"
                className="company-selector-trigger"
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label="Cambiar de empresa"
                disabled={switching !== null}
            >
                <Building2 size={14} />
                <span className="company-selector-name">{displayName}</span>
                <span className="company-selector-role">{currentRole}</span>
                <ChevronDown size={14} className={open ? 'rotated' : ''} />
            </button>

            {open && (
                <ul className="company-selector-menu" role="listbox">
                    {memberships.map((m) => {
                        const isActive = m.company_id === activeCompanyId;
                        const name = m.companies?.trade_name || m.companies?.legal_name || 'Empresa';
                        const isSwitching = switching === m.company_id;
                        return (
                            <li key={m.company_id} role="option" aria-selected={isActive}>
                                <button
                                    type="button"
                                    onClick={() => handleSelect(m.company_id)}
                                    disabled={switching !== null}
                                    className={`company-selector-item${isActive ? ' active' : ''}`}
                                >
                                    <div className="company-selector-item-info">
                                        <span className="company-selector-item-name">{name}</span>
                                        <span className="company-selector-item-role">{m.role}</span>
                                    </div>
                                    {isActive && <Check size={14} />}
                                    {isSwitching && <span className="company-selector-spinner" />}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
