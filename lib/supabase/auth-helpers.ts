import { createClient } from './server'
import { supabaseAdmin } from '../supabase'

/**
 * Helper de autenticación + tenant para usar en server actions.
 *
 * Lee la sesión del usuario (vía Supabase SSR cookies) y resuelve:
 *   - user: el usuario autenticado
 *   - companyId: el tenant al que pertenece (de app_metadata.company_id)
 *   - role: el rol en profiles (owner/technician/manager)
 *
 * IMPORTANTE: Lee el profile con supabaseAdmin (bypass RLS) para evitar
 * problemas donde el cliente con sesión no encuentra el profile por
 * RLS o por falta de claims en el JWT. Esto es seguro porque la query
 * filtra por user.id (que viene del JWT verificado por createClient).
 *
 * Errores que lanza:
 *   - 'UNAUTHENTICATED': no hay sesión de usuario activa.
 *   - 'NO_COMPANY_CONTEXT': el JWT no tiene company_id en app_metadata.
 *   - 'NO_PROFILE': el usuario no tiene fila en profiles, o su perfil no tiene rol.
 */
export async function requireAuthContext() {
    const supabase = createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
        throw new Error('UNAUTHENTICATED')
    }

    const companyId = user.app_metadata?.company_id as string | undefined

    if (!companyId) {
        throw new Error('NO_COMPANY_CONTEXT')
    }

    // Leer perfil con supabaseAdmin (bypass RLS).
    // Filtramos por user.id (que viene del JWT verificado) para mantener
    // la seguridad: solo leemos el perfil del usuario autenticado.
    const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('role, company_id')
        .eq('id', user.id)
        .maybeSingle()

    if (profileError || !profile) {
        throw new Error('NO_PROFILE')
    }

    return {
        user,
        companyId,
        role: profile.role as string,
    }
}

export function requireOwner(role: string) {
    if (role !== 'owner') {
        throw new Error('FORBIDDEN: se requiere rol owner')
    }
}

export async function requireRole(allowedRoles: string[]) {
    const ctx = await requireAuthContext()
    if (!allowedRoles.includes(ctx.role)) {
        throw new Error(
            `FORBIDDEN: se requiere uno de los roles [${allowedRoles.join(', ')}], pero el usuario tiene '${ctx.role}'`
        )
    }
    return ctx
}