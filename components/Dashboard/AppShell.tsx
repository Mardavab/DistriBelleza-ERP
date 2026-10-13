'use client'

import React, { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getUserProfile, type UserProfile } from '../../app/actions/auth';
import { getCurrentCompanyAction } from '../../app/actions/company';
import { createSupabaseBrowserClient } from '../../lib/supabase/browser';
import Sidebar from './Sidebar';
import './Dashboard.css';

const AppProfileContext = createContext<UserProfile | null>(null);

/**
 * Perfil del usuario autenticado, cargado una sola vez por el AppShell.
 * Lo consumen las páginas que necesitan rol o datos del usuario
 * (p. ej. /reportes, /sucursales, /configuracion, /).
 */
export function useAppProfile() {
    return useContext(AppProfileContext);
}

/**
 * Shell de la aplicación autenticada (grupo de rutas `app/(main)`).
 *
 * Responsabilidades:
 * - Cargar el perfil y la empresa activa una única vez por sesión.
 * - Redirigir a /login si no hay sesión válida.
 * - Sincronizar el claim branch_id del JWT cuando el servidor lo corrige.
 * - Defensa en profundidad: consola de plataforma (/plataforma) y módulos
 *   de negocio son excluyentes; si el rol no corresponde a la ruta, se
 *   redirige a la home del rol correspondiente.
 * - Renderizar el Sidebar y el <main> con la variante visual del POS.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [companyName, setCompanyName] = useState<string>('');
    const [loading, setLoading] = useState(true);

    const isPlatformAdmin = profile?.is_platform_admin === true;
    const isPlatformRoute = pathname.startsWith('/plataforma');

    useEffect(() => {
        async function load() {
            try {
                const p = await getUserProfile();
                if (!p) {
                    window.location.href = '/login';
                    return;
                }

                // FASE 11.7 (fix selector de sucursal):
                // si el server action detectó que el JWT del cliente estaba
                // desincronizado (branch_id faltante o distinto del activo
                // real), recargamos la página para que el próximo request
                // traiga el JWT fresco con el claim correcto. Sin esto,
                // Supabase no refresca el access token en cada request y
                // el usuario quedaba con el JWT cacheado viejo.
                //
                // SIEMPRE llamamos `refreshSession()` cuando este flag es
                // `true`, sin condicionar a `!p.active_branch_id`. Antes el
                // guard sólo aplicaba al path defensivo de "JWT sin branch_id
                // + 2+ sucursales", pero el servidor acaba de escribir el
                // branch_id correcto en `auth.users` y necesitamos refrescar
                // el access token del navegador para que el siguiente request
                // traiga el claim actualizado. Sin el refresh, el reload
                // continúa con el claim viejo y `branch_sync_needed` se
                // mantiene en true → loop infinito de reloads.
                //
                // El reload es la PRIMERA acción tras detectar el flag: el
                // segundo load() traerá el JWT ya sincronizado y
                // `branch_sync_needed` será false.
                if (p.branch_sync_needed && !p.is_platform_admin) {
                    try {
                        const supabase = createSupabaseBrowserClient();
                        await supabase.auth.refreshSession();
                    } catch (err) {
                        console.warn('[AppShell] refreshSession failed:', err);
                    }
                    window.location.reload();
                    return;
                }

                setProfile(p);

                // Una cuenta de plataforma no tiene empresa: se salta la consulta.
                if (p.is_platform_admin) return;

                const company = await getCurrentCompanyAction();
                if (company) {
                    setCompanyName(company.trade_name || company.legal_name);
                }
            } catch (err) {
                console.error('Auth error:', err);
                window.location.href = '/login';
            } finally {
                setLoading(false);
            }
        }
        load();
    }, []);

    // Defensa en profundidad: si el rol no corresponde a la sección de la
    // ruta actual, se cae a la home del rol en vez de renderizar el módulo.
    useEffect(() => {
        if (loading || !profile) return;
        if (isPlatformAdmin && !isPlatformRoute) {
            router.replace('/plataforma');
        } else if (!isPlatformAdmin && isPlatformRoute) {
            router.replace('/');
        }
    }, [loading, profile, isPlatformAdmin, isPlatformRoute, router]);

    // No renderizar el módulo mientras carga el perfil ni mientras un
    // redirect de rol está pendiente (evita flash de datos de otra sección).
    const routeAllowed = !!profile && isPlatformAdmin === isPlatformRoute;
    if (loading || !routeAllowed) {
        return (
            <div className="dashboard-layout" style={{ justifyContent: 'center', alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                    <h2 style={{ color: 'var(--color-primary)' }}>Iniciando sistema...</h2>
                    <p style={{ color: 'var(--color-text-mute)', fontSize: 'var(--font-base)' }}>Verificando credenciales</p>
                </div>
            </div>
        );
    }

    return (
        <AppProfileContext.Provider value={profile}>
            <div className="dashboard-layout">
                <Sidebar userProfile={profile} companyName={companyName} />
                <main className={`main-content${pathname.startsWith('/pos') ? ' pos-active' : ''}`}>
                    {children}
                </main>
            </div>
        </AppProfileContext.Provider>
    );
}
