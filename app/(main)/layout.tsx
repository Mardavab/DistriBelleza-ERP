'use client'

import AppShell from '../../components/Dashboard/AppShell';

/**
 * Layout de la aplicación autenticada (rutas de negocio y plataforma).
 * AppShell carga el perfil una sola vez y lo expone vía useAppProfile().
 * Las rutas públicas (/login, /accept-invitation, /no-tenant) quedan
 * fuera de este grupo y no montan el shell.
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
    return <AppShell>{children}</AppShell>;
}
