import { supabaseAdmin } from '../supabase'
import type { CompanyMembership } from './memberships'

/**
 * Resuelve las membresías del usuario autenticado.
 *
 * Una membresía representa (user, company, role). Un usuario puede tener
 * varias. Lee con `supabaseAdmin` (bypass RLS) porque el cliente autenticado
 * todavía no tiene políticas sobre `company_memberships` durante la fase 10.2.
 *
 * El filtro por `user.id` viene del JWT verificado, así que es seguro.
 *
 * Devuelve un array vacío si el usuario no tiene membresías (caso típico:
 * cuentas de plataforma como `technician`).
 */
export async function getUserMemberships(userId: string): Promise<CompanyMembership[]> {
    const { data, error } = await supabaseAdmin
        .from('company_memberships')
        .select(`
            user_id,
            company_id,
            role,
            is_default,
            created_at,
            companies:company_id (
                id,
                slug,
                legal_name,
                trade_name,
                logo_url,
                active
            )
        `)
        .eq('user_id', userId)

    if (error) {
        console.warn(`[getUserMemberships] Error leyendo membresías: ${error.message}`)
        return []
    }

    return (data ?? []) as unknown as CompanyMembership[]
}

/**
 * Devuelve la membresía "activa" del usuario.
 *
 * Prioridad:
 *   1. La membresía cuyo company_id coincide con el del JWT.
 *   2. La membresía marcada como `is_default = true`.
 *   3. La primera membresía (orden de creación).
 *
 * Devuelve `null` si el usuario no tiene membresías (técnico sin empresa).
 */
export async function getActiveMembership(
    userId: string,
    jwtCompanyId?: string | null
): Promise<CompanyMembership | null> {
    const memberships = await getUserMemberships(userId)
    if (memberships.length === 0) return null

    if (jwtCompanyId) {
        const fromJwt = memberships.find((m) => m.company_id === jwtCompanyId)
        if (fromJwt) return fromJwt
    }

    const defaultMembership = memberships.find((m) => m.is_default)
    if (defaultMembership) return defaultMembership

    return memberships[0]
}

/**
 * Marca una membresía como `is_default = true`.
 *
 * Como hay un índice único parcial `WHERE is_default`, primero desmarca
 * la default actual del usuario (si existe) en la misma transacción.
 */
export async function setDefaultMembership(userId: string, companyId: string): Promise<void> {
    // Limpiar default anterior
    const { error: clearError } = await supabaseAdmin
        .from('company_memberships')
        .update({ is_default: false })
        .eq('user_id', userId)
        .eq('is_default', true)

    if (clearError) {
        console.warn(`[setDefaultMembership] clear default: ${clearError.message}`)
    }

    // Marcar la nueva como default
    const { error: setError } = await supabaseAdmin
        .from('company_memberships')
        .update({ is_default: true })
        .eq('user_id', userId)
        .eq('company_id', companyId)

    if (setError) {
        console.warn(`[setDefaultMembership] set default: ${setError.message}`)
    }
}

/**
 * Determina si un usuario es administrador de plataforma (técnico).
 *
 * FASE 10.5: lee de `profiles.is_platform_admin` (boolean). Los técnicos
 * NO tienen membresías: su alcance es cross-tenant, no operan sobre
 * datos de empresa.
 */
export async function isPlatformUser(userId: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('is_platform_admin')
        .eq('id', userId)
        .maybeSingle()

    if (error || !data) return false
    return data.is_platform_admin === true
}
