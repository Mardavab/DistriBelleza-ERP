import { createClient } from './server'
import { supabaseAdmin } from '../supabase'
import { getActiveMembership, isPlatformUser } from './membership-queries'
import { err } from '../errors'
import type { AuthContext, UserRole } from './memberships'

/**
 * Helper de autenticación + tenant para usar en server actions.
 *
 * Lee la sesión del usuario (vía Supabase SSR cookies) y resuelve:
 *   - user: el usuario autenticado
 *   - companyId: el tenant activo (de app_metadata.company_id del JWT)
 *   - role: el rol del usuario EN ESE TENANT (de company_memberships)
 *   - membership: la fila de membresía completa
 *
 * Cambios FASE 10.2:
 *   - El rol se lee de `company_memberships.role`, no de `profiles.role`.
 *     `profiles.role` queda como cache legacy, eliminado en fase 10.5.
 *   - Se valida que el usuario tenga una membresía en la empresa del JWT
 *     (no solo que tenga profile.company_id igual).
 *
 * IMPORTANTE: Lee membresías con supabaseAdmin (bypass RLS) porque las
 * políticas RLS sobre company_memberships no existen todavía. Esto es seguro
 * porque la query filtra por user.id (que viene del JWT verificado).
 *
 * Errores que lanza:
 *   - 'UNAUTHENTICATED': no hay sesión de usuario activa.
 *   - 'NO_COMPANY_CONTEXT': el JWT no tiene company_id en app_metadata
 *     y el usuario no es técnico de plataforma.
 *   - 'NO_MEMBERSHIP': el usuario no tiene membresía en la empresa del JWT.
 *   - 'NO_PROFILE': el usuario no tiene fila en profiles.
 */
export async function requireAuthContext(): Promise<AuthContext> {
    const supabase = createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
        throw err('UNAUTHENTICATED', 'requireAuthContext: no active session')
    }

    const jwtCompanyId = user.app_metadata?.company_id as string | undefined

    // Cuentas de plataforma (technician) no pertenecen a ningún tenant:
    // llegan sin company_id y eso no es un error para ellas.
    if (!jwtCompanyId) {
        const platform = await isPlatformUser(user.id)
        if (platform) {
            // Construimos un contexto "vacío" para técnicos.
            return {
                user,
                companyId: '',
                role: 'technician',
                membership: {
                    user_id: user.id,
                    company_id: '',
                    role: 'technician',
                    is_default: false,
                    created_at: new Date().toISOString(),
                },
            }
        }
        throw err('NO_COMPANY_CONTEXT', 'requireAuthContext: JWT without company_id')
    }

    // Resolver membresía activa: prioridad JWT > default > primera.
    const membership = await getActiveMembership(user.id, jwtCompanyId)

    if (!membership) {
        throw err(
            'NO_MEMBERSHIP',
            `requireAuthContext: no membership for user in company ${jwtCompanyId}`
        )
    }

    // Defensa: si la membresión es de una empresa distinta a la del JWT,
    // rechazar (el JWT está desincronizado). El fix es refrescar la sesión.
    if (membership.company_id !== jwtCompanyId) {
        console.warn(
            `[requireAuthContext] JWT.company_id=${jwtCompanyId} no coincide con membresía=${membership.company_id}`
        )
    }

    return {
        user,
        companyId: membership.company_id,
        role: membership.role as UserRole,
        membership,
    }
}

export function requireOwner(role: string) {
    if (role !== 'owner') {
        throw err('FORBIDDEN', `requireOwner: requires owner role, got '${role}'`)
    }
}

export async function requireRole(allowedRoles: string[]) {
    const ctx = await requireAuthContext()
    if (!allowedRoles.includes(ctx.role)) {
        throw err(
            'FORBIDDEN',
            `requireRole: requires one of [${allowedRoles.join(', ')}], got '${ctx.role}'`
        )
    }
    return ctx
}

/**
 * Versión de `requireRole` para CUENTAS DE PLATAFORMA.
 *
 * Las cuentas de plataforma (técnicos) no operan sobre datos de ningún
 * tenant: su alcance es la consola de plataforma. Este helper resuelve el
 * perfil sin exigir contexto de empresa.
 *
 * FASE 10.5: detecta técnicos por `profiles.is_platform_admin = true`.
 *
 * Devuelve `role: 'technician'` para que el caller pueda usar la misma
 * firma que con `requireRole`, aunque ese "rol" no viva en memberships.
 */
export async function requirePlatformRole(allowedRoles: string[]) {
    const supabase = createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
        throw err('UNAUTHENTICATED', 'requirePlatformRole: no active session')
    }

    const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('is_platform_admin, company_id')
        .eq('id', user.id)
        .maybeSingle()

    if (profileError || !profile) {
        throw err('NOT_FOUND', 'requirePlatformRole: profile not found')
    }

    if (!profile.is_platform_admin) {
        throw err(
            'FORBIDDEN',
            `FORBIDDEN: se requiere cuenta de plataforma (is_platform_admin=true), pero el usuario no la tiene`
        )
    }

    const role = 'technician' // Convencional: técnicos tienen rol 'technician' en el helper.

    if (!allowedRoles.includes(role)) {
        throw err(
            'FORBIDDEN',
            `FORBIDDEN: se requiere uno de los roles [${allowedRoles.join(', ')}], pero el usuario tiene '${role}'`
        )
    }

    return {
        user,
        role,
        companyId: (profile.company_id as string | null) ?? null,
    }
}
