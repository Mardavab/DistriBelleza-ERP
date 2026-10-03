import { createClient } from './server'

const DEFAULT_TENANT_ID = '11111111-1111-1111-1111-111111111111'

/**
 * Obtiene el company_id del usuario actualmente autenticado.
 *
 * Lee la sesión del usuario vía cookies (Supabase SSR) y luego su fila
 * en `profiles` para extraer el `company_id`.
 *
 * Si el profile no tiene company_id (usuario legacy), usa Distribelleza
 * como fallback. Esto evita romper la app por un side-effect del backfill
 * de Fase 2. El fallback es seguro porque solo aplica cuando no hay
 * tenant explícito.
 *
 * Uso típico:
 *   const companyId = await getCurrentCompanyId()
 *   await supabaseAdmin.from('suppliers').insert({ company_id: companyId, ... })
 *
 * Errores que lanza:
 *   - 'UNAUTHENTICATED': no hay sesión de usuario activa.
 *
 * Esta función es el anticipo del `requireAuthContext()` completo de
 * Fase 4 (auth multi-tenant). Cuando implementemos Fase 4, esta función
 * será reemplazada por una que también valide role y rechace profiles
 * sin company_id explícito.
 */
export async function getCurrentCompanyId(): Promise<string> {
    const supabase = createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
        throw new Error('UNAUTHENTICATED')
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .maybeSingle()

    // Fallback a Distribelleza si el profile no tiene company_id
    // (caso legacy: usuario creado antes de Fase 2).
    if (!profile?.company_id) {
        console.warn(
            `[getCurrentCompanyId] Usuario ${user.id} sin company_id en profile. Usando tenant por defecto.`
        )
        return DEFAULT_TENANT_ID
    }

    return profile.company_id
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