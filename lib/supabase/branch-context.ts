import { createClient } from './server'
import { supabaseAdmin } from '../supabase'
import { isPlatformUser } from './membership-queries'
import {
    getActiveBranch,
    isUserInBranch,
} from './branch-membership-queries'

/**
 * Resuelve el branch_id de la sucursal activa del usuario.
 *
 * Orden de resolución (Fase 11.0 + 11.6):
 *   1. Lee `app_metadata.branch_id` del JWT (lo setea
 *      `switchActiveBranchAction`).
 *      - Si existe Y la membrisía es válida → úsala.
 *      - Si existe PERO la membrisía no existe (JWT desincronizado):
 *        console.warn + fallback al paso 2.
 *   2. Fallback: la membrisía `is_default = true` del usuario
 *      (`branch_memberships`). El índice único parcial
 *      `uniq_branch_default_per_user` garantiza que solo haya una
 *      `is_default=true` por usuario.
 *      - Si la encuentra, la devuelve (SIN side-effect sobre el JWT:
 *        la sincronización la hace el caller, típicamente
 *        `getUserProfile` en `app/actions/auth.ts`).
 *   3. Si no hay membrisía default → null.
 *
 * Esta función NUNCA lanza: para uso silencioso en páginas que no
 * requieren contexto de sucursal (ej: dashboard admin). Para uso
 * estricto, usar `requireBranchContext`.
 *
 * Casos que devuelven null:
 *   - No hay sesión.
 *   - Usuario es platform admin (sin membrisías operativas).
 *   - Usuario con company_membership pero sin branch_membership
 *     (raro; el owner aún no lo asignó a una sucursal).
 *   - JWT trae branch_id pero la membrisía no existe Y no hay
 *     membrisía default (estado inconsistente).
 *
 * IMPORTANTE (Fase 11.7): `getCurrentBranchId` ya NO dispara
 * side-effects. Antes sincronizaba el JWT como "autorregeneración"
 * post-deploy, pero el JWT cacheado en el navegador del cliente no
 * se actualizaba solo (Supabase NO refresca el access token en cada
 * request, solo en `refreshSession()` explícito o al recargar la
 * pestaña). El side-effect se movió a `getUserProfile` (auth.ts)
 * que retorna `branch_sync_needed: boolean` para que el cliente
 * haga `window.location.reload()` y traiga el JWT fresco.
 *
 * POR QUÉ el fallback (Fase 11.6):
 *   `app_metadata.branch_id` es un claim NUEVO de Fase 11, solo
 *   seteado por `switchActiveBranchAction`. Los usuarios existentes
 *   (pre-Fase 11) tienen JWTs cacheados sin este claim, lo que hace
 *   que `requireBranchContext` lance `NO_BRANCH_CONTEXT` y rompa
 *   todas las páginas. El fallback permite que el sistema "se
 *   autorregenere" en el primer request post-deploy: `getCurrentBranchId`
 *   devuelve el default correcto, y `getUserProfile` se encarga de
 *   sincronizar el JWT y avisar al cliente para que recargue.
 */
export async function getCurrentBranchId(): Promise<string | null> {
    const supabase = createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
        return null
    }

    return resolveBranchIdForUser(user.id, user.app_metadata ?? {})
}

/**
 * Versión silenciosa: nunca lanza, siempre devuelve `string | null`.
 * Equivalente directo de `getCurrentBranchId` (mantiene la firma
 * paralela con `getCurrentCompanyIdSafe` por simetría con Fase 10).
 */
export async function getCurrentBranchIdSafe(): Promise<string | null> {
    try {
        return await getCurrentBranchId()
    } catch {
        return null
    }
}

/**
 * Versión estricta: lanza si no hay branch_id (incluso tras fallback).
 * Usar en server actions operacionales (POS, ventas, inventario) donde
 * se REQUIERE contexto de sucursal.
 *
 * Errores que lanza:
 *   - 'UNAUTHENTICATED': no hay sesión.
 *   - 'NO_BRANCH_CONTEXT': el usuario no tiene branch_id activo y
 *     tampoco tiene membrisía default. Distinto de
 *     `NO_COMPANY_CONTEXT` (Fase 10): el usuario tiene empresa pero
 *     no sucursal activa.
 *
 * IMPORTANTE (Fase 11.7): NO dispara side-effects. El caller (la
 * server action operacional) NO necesita recargar el navegador porque
 * los flows operacionales suelen empezar con un redirect o un revalidate
 * tras la acción. La sincronización del JWT la gestiona
 * `getUserProfile` al cargar el dashboard (`app/page.tsx`).
 */
export async function requireBranchContext(): Promise<{ userId: string; branchId: string }> {
    const supabase = createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
        throw new Error('UNAUTHENTICATED')
    }

    const branchId = await resolveBranchIdForUser(user.id, user.app_metadata ?? {})

    if (!branchId) {
        throw new Error('NO_BRANCH_CONTEXT')
    }

    return { userId: user.id, branchId }
}

/**
 * Helper interno: núcleo de la lógica de resolución.
 *
 * Recibe `userId` y `appMetadata` ya extraídos (los callers públicos
 * necesitan el `user` para chequear sesión, así que lo extraen una
 * sola vez y lo propagan).
 *
 * Platform admins → null (cortocircuito, evita queries innecesarias).
 * Resto → aplica prioridad JWT.branch_id > fallback is_default.
 *
 * NO dispara side-effects: solo LEE y devuelve el branch_id activo.
 * La sincronización del JWT la hace el caller (típicamente
 * `getUserProfile`) llamando a `syncBranchIdToJwtIfMissing`.
 */
async function resolveBranchIdForUser(
    userId: string,
    appMetadata: Record<string, unknown>
): Promise<string | null> {
    // Platform admins no operan sobre sucursales.
    if (await isPlatformUser(userId)) {
        return null
    }

    const jwtBranchId = appMetadata.branch_id as string | undefined

    if (jwtBranchId) {
        const hasMembership = await isUserInBranch(userId, jwtBranchId)
        if (hasMembership) {
            return jwtBranchId
        }
        console.warn(
            `[resolveBranchIdForUser] JWT.branch_id=${jwtBranchId} sin membrisía para user=${userId}. JWT desincronizado, usando fallback.`
        )
    }

    // Fallback: membrisía is_default del usuario.
    const defaultBranchId = await getUserDefaultBranchId(userId)
    if (!defaultBranchId) {
        return null
    }

    return defaultBranchId
}

/**
 * Devuelve el `branch_id` de la membrisía `is_default = true` del
 * usuario, o `null` si no tiene ninguna.
 *
 * Un usuario tiene a lo sumo una `is_default=true` (constraint
 * enforced por índice único parcial `uniq_branch_default_per_user`).
 * Por eso NO filtra por `companyId`: el default es único a nivel global
 * del usuario, no por empresa. Esto permite resolver el default
 * incluso antes de saber cuál es la `companyId` activa del JWT
 * (caso típico del primer request post-Fase 11).
 *
 * Implementación: delega en `getActiveBranch(userId, undefined,
 * undefined)` para forzar la prioridad JWT=∅ > is_default > primera.
 *
 * Usado por:
 *   - `resolveBranchIdForUser` (fallback cuando el JWT no trae claim).
 *   - Cualquier caller que necesite saber "cuál sería mi sucursal
 *     por defecto" sin pasar por la lógica de validación JWT.
 */
export async function getUserDefaultBranchId(userId: string): Promise<string | null> {
    const active = await getActiveBranch(userId, undefined, undefined)
    return active?.branch.id ?? null
}

/**
 * Sincroniza `app_metadata.branch_id` del usuario en `auth.users`
 * vía Supabase Admin API, SOLO si hace falta.
 *
 * Devuelve `true` si hizo el `updateUserById`, `false` si el JWT
 * ya tenía el `branch_id` correcto (idempotente).
 *
 * Comportamiento (Fase 11.7):
 *   - Si el JWT ya tiene `branch_id === branchId` → NO hace nada,
 *     devuelve `false`. Esto evita escrituras innecesarias a
 *     `auth.users` en cada carga del dashboard.
 *   - Si el JWT NO tiene `branch_id` o difiere de `branchId` →
 *     hace `updateUserById` con merge (preserva otros claims como
 *     `company_id`, `role`) y devuelve `true`.
 *
 * Lanza Error si la API falla. El caller decide cómo manejarlo
 * (típicamente: log warn + seguir, para no romper la carga del
 * dashboard si Supabase Admin API tiene rate-limit transitorio).
 *
 * POR QUÉ público (Fase 11.7):
 *   Antes era `syncBranchIdToJwt` (privado) y se llamaba como
 *   side-effect desde `resolveBranchIdForUser`. El problema:
 *   el JWT cacheado en el navegador del cliente NO se actualizaba
 *   solo — Supabase solo emite un access token nuevo en
 *   `refreshSession()` o tras recargar la pestaña. Resultado: el
 *   usuario tenía que cerrar sesión y volver a entrar. Para evitar
 *   esto, el side-effect se movió a `getUserProfile` (auth.ts),
 *   que retorna `branch_sync_needed: boolean` y `app/page.tsx`
 *   fuerza `window.location.reload()` cuando es `true`.
 *
 * IMPORTANTE: `admin.updateUserById` REEMPLAZA `app_metadata`
 * completamente. Por eso mergeamos con el `currentAppMetadata` del
 * JWT (que ya pasó por la sesión SSR verificada) antes de pasar el
 * objeto. Esto preserva `company_id` y `role` que otros flujos
 * (`switchActiveBranchAction`, Fase 10) hayan seteado.
 */
export async function syncBranchIdToJwtIfMissing(
    userId: string,
    branchId: string,
    currentAppMetadata: Record<string, unknown>
): Promise<boolean> {
    const existingBranchId = currentAppMetadata.branch_id as string | undefined
    if (existingBranchId === branchId) {
        // Ya está sincronizado: idempotente, sin escritura.
        return false
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        app_metadata: {
            ...currentAppMetadata,
            branch_id: branchId,
        },
    })

    if (error) {
        throw new Error(`syncBranchIdToJwtIfMissing(${userId}): ${error.message}`)
    }

    return true
}

/**
 * Helper interno: leer el branch_id del JWT sin validar membrisía.
 *
 * Usado por `switchActiveBranchAction` que SÍ necesita saber qué pide
 * el JWT para validar contra la membresía del destino ANTES de escribir
 * el nuevo branch_id. No se exporta del módulo (es internal helper).
 */
export async function readJwtBranchId(): Promise<string | null> {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    return (user.app_metadata?.branch_id as string | undefined) ?? null
}

// Re-export para que callers que importen desde aquí no necesiten
// tocar supabaseAdmin directamente.
export { supabaseAdmin }