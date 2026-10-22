import { createClient } from './server'
import { getActiveMembership, isPlatformUser } from './membership-queries'
import { err } from '../errors'

/**
 * Obtiene el company_id del tenant activo del usuario.
 *
 * Orden de resolución (Fase 10.2):
 *   1. La membresía cuyo company_id coincide con el JWT.
 *   2. La membresía marcada como `is_default`.
 *   3. La primera membresía del usuario.
 *
 * Si el usuario no tiene membresías (caso típico: técnico de plataforma),
 * se considera "sin contexto de empresa" y se devuelve null. La función NO
 * aplica fallback a Distribelleza como en versiones anteriores: con membresías,
 * un usuario o tiene empresa activa explícita o no.
 *
 * Errores que lanza:
 *   - 'UNAUTHENTICATED': no hay sesión de usuario activa.
 */
export async function getCurrentCompanyId(): Promise<string | null> {
    const supabase = createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
        throw err('UNAUTHENTICATED', 'getCurrentCompanyId: no active session')
    }

    // Cuentas de plataforma: no tienen empresa.
    if (await isPlatformUser(user.id)) {
        return null
    }

    const jwtCompanyId = user.app_metadata?.company_id as string | undefined
    const membership = await getActiveMembership(user.id, jwtCompanyId)

    return membership?.company_id ?? null
}

/**
 * Versión silenciosa: devuelve null en vez de lanzar errores.
 */
export async function getCurrentCompanyIdSafe(): Promise<string | null> {
    try {
        return await getCurrentCompanyId()
    } catch {
        return null
    }
}
