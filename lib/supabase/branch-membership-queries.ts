import { supabaseAdmin } from '../supabase'
import type { Branch, BranchMembership } from './branches'
import type { UserRole } from './memberships'

/**
 * Resuelve las membresías de sucursal del usuario, opcionalmente
 * filtradas por empresa.
 *
 *   - Si se pasa `companyId`, devuelve solo las membresías en sucursales
 *     de ESA empresa.
 *   - Si NO se pasa, devuelve TODAS las branch_memberships del usuario.
 *
 * Comportamiento para OWNERS (Fase 11.8 — fix selector de sucursales):
 *   - Si el usuario es `owner` en `companyId`, devuelve TODAS las
 *     sucursales activas de la empresa, no solo las donde tiene
 *     membrisía explícita.
 *   - Las sucursales donde NO tiene membrisía real se devuelven como
 *     membresías "sintéticas" con `role: 'owner'` e `is_default: false`.
 *   - Las membresías reales (de `branch_memberships`) se preservan tal
 *     cual (con su `role` e `is_default` originales).
 *
 * Para managers/technicians, filtra solo por `user_id` (comportamiento
 * previo).
 *
 * Hace LEFT JOIN a `branches` para que la UI pueda mostrar el nombre
 * de la sucursal sin un fetch extra.
 *
 * Usa `supabaseAdmin` (bypass RLS) porque la query filtra por user.id
 * (que viene del JWT verificado) y las políticas RLS sobre
 * branch_memberships aún no están desplegadas para el cliente autenticado
 * durante la fase 11.0/11.1. El servidor tiene service role, así que
 * obtiene todas las filas; el caller debe limitar el resultado a la
 * `companyId` que ya validó por su lado (multi-tenant defense in depth).
 */
export async function getUserBranches(
    userId: string,
    companyId?: string | null
): Promise<BranchMembership[]> {
    // 1. Resolver el rol del usuario en la empresa (si se pasa companyId).
    // Solo importa para owners (manager/technician se filtran por user_id).
    let companyRole: UserRole | null = null

    if (companyId) {
        const { data: cmData, error: cmError } = await supabaseAdmin
            .from('company_memberships')
            .select('role')
            .eq('user_id', userId)
            .eq('company_id', companyId)
            .maybeSingle()

        if (cmError) {
            console.warn(
                `[getUserBranches] Error leyendo company_memberships: ${cmError.message}`
            )
            // Continuar: caemos al caso "sin role" = solo realMemberships.
        } else {
            companyRole = (cmData?.role as UserRole | undefined) ?? null
        }
    }

    // 2. Leer las branch_memberships reales (comportamiento previo).
    let query = supabaseAdmin
        .from('branch_memberships')
        .select(`
            user_id,
            company_id,
            branch_id,
            role,
            is_default,
            created_at,
            branches:branch_id (
                id,
                company_id,
                code,
                name,
                address,
                phone,
                is_main,
                active,
                created_at
            )
        `)
        .eq('user_id', userId)

    if (companyId) {
        query = query.eq('company_id', companyId)
    }

    const { data, error } = await query

    if (error) {
        console.warn(`[getUserBranches] Error leyendo membresías: ${error.message}`)
        return []
    }

    const realMemberships = (data ?? []) as unknown as BranchMembership[]

    // 3. Si el usuario es owner en esta empresa, expandir con TODAS las
    // sucursales activas de la empresa (no solo las donde tiene membrisía
    // explícita). Las membresías reales se preservan; las demás se inyectan
    // como sintéticas con role='owner', is_default=false. Esto permite que el
    // BranchSelector muestre todas las sucursales de la empresa en el
    // dropdown aunque el owner aún no se haya auto-asignado como miembro.
    if (companyRole === 'owner' && companyId) {
        const cid: string = companyId
        const { data: branchesData, error: branchesError } = await supabaseAdmin
            .from('branches')
            .select('id, company_id, code, name, address, phone, is_main, active, created_at')
            .eq('company_id', cid)
            .eq('active', true)

        if (branchesError) {
            console.warn(
                `[getUserBranches] Error leyendo branches (owner expansion): ${branchesError.message}`
            )
            // Si falla la expansión, devolver solo las membresías reales.
            return realMemberships
        }

        const realBranchIds = new Set(realMemberships.map((m) => m.branch_id))

        const synthetic: BranchMembership[] = (branchesData ?? [])
            .filter((b) => !realBranchIds.has(b.id))
            .map((b) => ({
                user_id: userId,
                company_id: cid,
                branch_id: b.id,
                role: 'owner',
                is_default: false,
                created_at: b.created_at,
                branches: b as Branch,
            }))

        return [...realMemberships, ...synthetic]
    }

    return realMemberships
}

/**
 * Devuelve la sucursal "activa" del usuario para la empresa dada.
 *
 * Prioridad:
 *   1. La sucursal cuyo branch_id coincide con `jwtBranchId` (si se
 *      pasa y la membrisía existe).
 *   2. La sucursal marcada como `is_default = true`.
 *   3. La primera sucursal (orden de creación).
 *
 * Devuelve `null` si el usuario no tiene branch_memberships en esa
 * empresa (caso normal: usuario con company_membership pero aún no
 * asignado a ninguna sucursal específica).
 *
 * Si se omite `companyId`, NO se filtra por empresa y se devuelven
 * membresías de todas las empresas del usuario. En este modo, el
 * `is_default` se evalúa a nivel global del usuario (el índice único
 * parcial `uniq_branch_default_per_user` garantiza que solo haya una
 * is_default=true por usuario, independientemente de la empresa).
 * Usado por `getUserDefaultBranchId` (Fase 11.6) para resolver el
 * default cuando el JWT aún no trae `branch_id`.
 */
export async function getActiveBranch(
    userId: string,
    companyId?: string | null,
    jwtBranchId?: string | null
): Promise<{ membership: BranchMembership; branch: Branch } | null> {
    const memberships = await getUserBranches(userId, companyId)
    if (memberships.length === 0) return null

    let chosen: BranchMembership | undefined

    if (jwtBranchId) {
        chosen = memberships.find((m) => m.branch_id === jwtBranchId)
    }

    if (!chosen) {
        chosen = memberships.find((m) => m.is_default)
    }

    if (!chosen) {
        chosen = memberships[0]
    }

    // Defensa: si la membrisía existe pero la sucursal anidada no
    // llegó (mock o inconsistencia), hacer fetch explícito.
    let branch = chosen.branches as Branch | null | undefined
    if (!branch) {
        const { data } = await supabaseAdmin
            .from('branches')
            .select('id, company_id, code, name, address, phone, is_main, active, created_at')
            .eq('id', chosen.branch_id)
            .maybeSingle()
        branch = (data ?? null) as Branch | null
    }

    if (!branch) return null

    return { membership: chosen, branch }
}

/**
 * Marca una branch_membership como `is_default = true`.
 *
 * Como hay un índice único parcial `WHERE is_default`, primero
 * desmarca la default actual del usuario (si existe) en la misma
 * operación.
 *
 * Lanza error si la branch_membership no existe (el caller ya debe
 * haber validado la pertenencia con `isUserInBranch`).
 */
export async function setDefaultBranch(userId: string, branchId: string): Promise<void> {
    // Limpiar default anterior del usuario.
    const { error: clearError } = await supabaseAdmin
        .from('branch_memberships')
        .update({ is_default: false })
        .eq('user_id', userId)
        .eq('is_default', true)

    if (clearError) {
        console.warn(`[setDefaultBranch] clear default: ${clearError.message}`)
    }

    // Marcar la nueva como default.
    const { error: setError } = await supabaseAdmin
        .from('branch_memberships')
        .update({ is_default: true })
        .eq('user_id', userId)
        .eq('branch_id', branchId)

    if (setError) {
        throw new Error(`setDefaultBranch: ${setError.message}`)
    }
}

/**
 * Determina si un usuario tiene membrisía en una sucursal específica.
 *
 * Usado por server actions que necesitan validar antes de un INSERT/
 * UPDATE (defense in depth: aunque el filtro `branch_id` esté en la URL,
 * validamos la membrisía para evitar que un usuario con permisos
 * limitados en una sucursal salte a otra vía inyección).
 */
export async function isUserInBranch(userId: string, branchId: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
        .from('branch_memberships')
        .select('user_id')
        .eq('user_id', userId)
        .eq('branch_id', branchId)
        .maybeSingle()

    if (error) {
        console.warn(`[isUserInBranch] ${error.message}`)
        return false
    }
    return !!data
}

/**
 * Devuelve el `company_id` al que pertenece una sucursal.
 *
 * Helper liviano para acciones que necesitan el companyId a partir del
 * branchId (típicamente después de `requireBranchContext()` que solo
 * expone `userId` + `branchId`). Usar el resultado directamente en
 * queries filtradas — NO asumir que coincide con el JWT.
 *
 * Cachea el resultado en proceso para evitar queries repetidas en
 * la misma request (módulo singleton).
 */
const _companyIdCache = new Map<string, string>()

export async function getCompanyIdForBranch(branchId: string): Promise<string | null> {
    if (!branchId) return null

    const cached = _companyIdCache.get(branchId)
    if (cached) return cached

    const { data, error } = await supabaseAdmin
        .from('branches')
        .select('company_id')
        .eq('id', branchId)
        .maybeSingle()

    if (error) {
        console.warn(`[getCompanyIdForBranch] ${branchId}: ${error.message}`)
        return null
    }

    const companyId = (data?.company_id as string | undefined) ?? null
    if (companyId) _companyIdCache.set(branchId, companyId)
    return companyId
}

/**
 * Re-export por conveniencia de tipos en callers que importan solo
 * desde este módulo.
 */
export type { Branch, BranchMembership }
export type { UserRole }