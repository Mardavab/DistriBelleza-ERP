'use client'

import React, { useState, useRef, useEffect } from 'react';
import { Store, Check, ChevronDown } from 'lucide-react';
import { switchActiveBranchAction } from '../../app/actions/branch-memberships';
import { isFailure } from '../../lib/errors';
import type { BranchMembership } from '../../lib/supabase/branches';

interface BranchSelectorProps {
    /**
     * Membresías de sucursal del usuario (ya filtradas por empresa
     * activa). Si solo hay 1, el componente se renderiza como label
     * informativo (no como dropdown interactivo).
     */
    memberships: BranchMembership[];
    /** ID de la sucursal actualmente activa (de app_metadata.branch_id del JWT). */
    activeBranchId: string | null;
    /** Rol del usuario en la sucursal activa (mostrado en chip). */
    currentRole: string;
}

/**
 * Selector de sucursal activa para usuarios con varias branch_memberships.
 *
 * FASE 11.4 (Bloque C):
 *   - Se renderiza debajo del CompanySelector en el sidebar.
 *   - Llama a `switchActiveBranchAction(branchId)` que actualiza el JWT
 *     y refresca la sesión (igual que el switcher de empresa).
 *   - Tras el switch, hace `window.location.reload()` para forzar al cliente
 *     a obtener el JWT fresco.
 *   - Si memberships.length === 1, se renderiza como label estático
 *     (no hay nada que elegir, pero la info sigue siendo útil para
 *     el contexto del usuario).
 *
 * FASE 11.8 — contenido del array `memberships` según rol:
 *   - OWNER: `memberships` incluye TODAS las sucursales activas de la
 *     empresa (no solo las donde tiene membrisía explícita). Las
 *     sucursales sin membrisía real vienen como "sintéticas" con
 *     `role: 'owner'` e `is_default: false`. Esto permite que el
 *     owner gestione sucursales recién creadas sin tener que
 *     auto-asignarse como miembro primero.
 *   - MANAGER (u otros roles no-owner): `memberships` solo incluye las
 *     sucursales donde tiene membrisía real. El branch selector se
 *     muestra como label estático si memberships.length === 1.
 *
 * El filtro por rol lo hace `getUserBranches` (server-side, en
 * `lib/supabase/branch-membership-queries.ts`); este componente solo
 * renderiza lo que recibe.
 *
 * Reutiliza las clases CSS de CompanySelector (`.company-selector-*`).
 * Esto es deliberado: la única diferencia visual es el icono (Store vs
 * Building2). Reusar evita duplicar ~130 líneas de CSS casi idénticas.
 */
export default function BranchSelector({
    memberships,
    activeBranchId,
    currentRole,
}: BranchSelectorProps) {
    const [open, setOpen] = useState(false);
    const [switching, setSwitching] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // FASE 11 — Bug fix 2: filtrar sucursales inactivas en el cliente.
    // `getUserBranches` puede devolver memberships cuyo `branches.active`
    // es false (p. ej. un manager cuya sucursal acaba de ser desactivada
    // por el owner). El selector solo debe mostrar sucursales operativas,
    // por eso descartamos cualquier membership cuya sucursal esté
    // explícitamente inactiva. Se conserva cualquier membership sin
    // `branches` anidada (defensivo: datos parciales).
    const visibleMemberships = memberships.filter(
        (m) => m.branches?.active !== false
    );

    const active = visibleMemberships.find((m) => m.branch_id === activeBranchId);
    const displayName = active?.branches?.name
        || (activeBranchId ? 'Sucursal' : 'Sin sucursal');

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

    // Si solo hay una sucursal, mostrar como label estático (sin dropdown).
    // Caso típico: manager con 1 sola membrisía. Para owners, si la empresa
    // tiene 1 sola sucursal activa, también se renderiza como label estático.
    if (visibleMemberships.length <= 1) {
        if (!active) return null;
        return (
            <div className="company-selector company-selector--static">
                <div className="company-selector-trigger" aria-label="Sucursal activa">
                    <Store size={14} />
                    <span className="company-selector-name">{displayName}</span>
                    <span className="company-selector-role">{currentRole}</span>
                </div>
            </div>
        );
    }

    async function handleSelect(branchId: string) {
        if (branchId === activeBranchId) {
            setOpen(false);
            return;
        }
        setSwitching(branchId);
        try {
            const result = await switchActiveBranchAction(branchId);
            if (result.success) {
                // Forzar reload: refreshSession no garantiza que el cliente
                // reciba los nuevos claims sin un round-trip explícito.
                window.location.reload();
            } else if (isFailure(result)) {
                setSwitching(null);
                console.error('[BranchSelector] switch failed:', result.error);
                window.alert(result.error || 'No se pudo cambiar de sucursal.');
            }
        } catch (err) {
            setSwitching(null);
            console.error('[BranchSelector] switch error:', err);
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
                aria-label="Cambiar de sucursal"
                disabled={switching !== null}
            >
                <Store size={14} />
                <span className="company-selector-name">{displayName}</span>
                <span className="company-selector-role">{currentRole}</span>
                <ChevronDown size={14} className={open ? 'rotated' : ''} />
            </button>

            {open && (
                <ul className="company-selector-menu" role="listbox">
                    {visibleMemberships.map((m) => {
                        const isActive = m.branch_id === activeBranchId;
                        const name = m.branches?.name || 'Sucursal';
                        const isSwitching = switching === m.branch_id;
                        return (
                            <li key={m.branch_id} role="option" aria-selected={isActive}>
                                <button
                                    type="button"
                                    onClick={() => handleSelect(m.branch_id)}
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
