'use server'

import { createClient } from '../../lib/supabase/server'
import { supabaseAdmin } from '../../lib/supabase'
import { redirect } from 'next/navigation'
import { warnSilently } from '../../lib/errors'
import { getUserMemberships, getActiveMembership, isPlatformUser } from '../../lib/supabase/membership-queries'
import { getUserBranches } from '../../lib/supabase/branch-membership-queries'
import { syncBranchIdToJwtIfMissing } from '../../lib/supabase/branch-context'
import type { CompanyMembership, UserRole } from '../../lib/supabase/memberships'
import type { BranchMembership } from '../../lib/supabase/branches'

/** Indica si el usuario es técnico de plataforma (lee `is_platform_admin`). */
async function resolveIsPlatform(userId: string): Promise<boolean> {
    return isPlatformUser(userId)
}

export async function login(formData: FormData) {
    const supabase = createClient()
    const email = formData.get('email') as string
    const password = formData.get('password') as string

    const { data: authData, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    })

    if (error || !authData.user) {
        return { error: 'Credenciales inválidas o error de conexión.' }
    }

    const userId = authData.user.id
    const isPlatformAdmin = await resolveIsPlatform(userId)

    // Denormalizar `profiles.is_platform_admin` en app_metadata para que el
    // middleware pueda enrutar por rol sin consultar la BD. Se escribe el
    // app_metadata completo (spread) porque updateUserById lo reemplaza.
    const currentMeta = (authData.user.app_metadata ?? {}) as Record<string, unknown>
    if (currentMeta.is_platform_admin !== isPlatformAdmin) {
        await supabaseAdmin.auth.admin.updateUserById(userId, {
            app_metadata: { ...currentMeta, is_platform_admin: isPlatformAdmin },
        })
    }

    // Las cuentas de plataforma no están vinculadas a ninguna empresa.
    if (isPlatformAdmin) {
        console.warn(`[login] Acceso de plataforma: ${email}`)
        redirect('/plataforma')
    }

    const companyId = authData.user.app_metadata?.company_id as string | undefined

    if (!companyId) {
        await supabase.auth.signOut()
        return {
            error: 'Usuario sin empresa asignada. Contacta al administrador para recibir una invitación.'
        }
    }

    // Validar membresía en la empresa del JWT (Fase 10.2)
    const membership = await getActiveMembership(userId, companyId)
    if (!membership) {
        await supabase.auth.signOut()
        return {
            error: 'No tenés membresía en la empresa asociada. Contacta al administrador.'
        }
    }

    const { data: company, error: companyError } = await supabaseAdmin
        .from('companies')
        .select('id, slug, active')
        .eq('id', companyId)
        .single()

    if (companyError || !company) {
        await supabase.auth.signOut()
        warnSilently('login.companyLookup', { companyId, error: companyError?.message });
        return {
            error: 'La empresa asociada a tu cuenta no existe. Contacta al administrador.'
        }
    }

    if (!company.active) {
        await supabase.auth.signOut()
        return {
            error: 'La empresa asociada a tu cuenta está inactiva. Contacta al administrador.'
        }
    }

    redirect('/')
}

export async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    redirect('/login')
}

export interface UserProfile {
    id: string
    full_name: string | null
    role: UserRole
    company_id: string | null
    companies: {
        id: string
        slug: string
        trade_name: string | null
        legal_name: string
        currency: string
        timezone: string
    } | null
    /** Todas las membresías del usuario (cada una con su empresa y rol). */
    memberships: CompanyMembership[]
    /** Membresía activa según el JWT. */
    active_membership: CompanyMembership | null
    /**
     * Membresías de sucursal del usuario en la empresa activa.
     * FASE 11 (Bloque C). Vacío si el usuario no tiene branch_membership
     * o es platform admin.
     *
     * FASE 11.8 — comportamiento por rol (server-side, ver
     * `getUserBranches` en lib/supabase/branch-membership-queries.ts):
     *   - OWNER: incluye TODAS las sucursales activas de la empresa. Las
     *     sucursales donde el owner no tiene membrisía real vienen como
     *     membresías "sintéticas" con `role: 'owner'` e `is_default: false`.
     *     Esto permite que el BranchSelector muestre todas las sucursales
     *     aunque el owner aún no se haya auto-asignado.
     *   - MANAGER (u otros): solo las sucursales donde tiene membrisía
     *     explícita. Vacío si no tiene ninguna (caso degenerado).
     */
    branch_memberships: BranchMembership[]
    /**
     * ID de la sucursal activa (de app_metadata.branch_id del JWT).
     * Null si el usuario aún no tiene branch_id en el JWT (estado de
     * post-login en una empresa multi-sucursal: debe seleccionar
     * una sucursal antes de operar).
     */
    active_branch_id: string | null
    /**
     * Rol del usuario en la sucursal activa (puede diferir de
     * `role` que es el rol de empresa). Por ejemplo: owner en
     * la empresa, manager en la sucursal Norte.
     */
    branch_role: UserRole | null
    /** True si el usuario es técnico de plataforma (sin membresías). */
    is_platform_admin: boolean
    /**
     * Indica si el servidor tuvo que sincronizar `app_metadata.branch_id`
     * en `auth.users` durante esta llamada (Fase 11.7).
     *
     * Casos en que es `true`:
     *   - El JWT del usuario no traía `branch_id` (usuario pre-Fase 11
     *     con JWT cacheado sin este claim), pero el fallback encontró
     *     una membrisía `is_default = true` válida. El servidor acaba
     *     de escribirla en `auth.users` y el cliente debe refrescar la
     *     sesión para que el próximo request traiga el claim.
     *   - El JWT traía un `branch_id` distinto del branch activo real
     *     (caso degenerado: JWT desincronizado o branch eliminado).
     *
     * Cuando es `true`, el cliente (`components/Dashboard/AppShell.tsx`)
     * llama `supabase.auth.refreshSession()` y luego
     * `window.location.reload()` para que el próximo request traiga el
     * JWT con el `branch_id` correcto. Sin esto, Supabase no refresca
     * el access token en cada request y el usuario quedaba con el JWT
     * cacheado viejo hasta cerrar y reabrir sesión.
     *
     * Para cuentas de plataforma siempre es `false` (no tienen
     * branch_id). Para usuarios sin branch_membership activa
     * (caso degenerado: owner sin asignar) también es `false` (no hay
     * qué sincronizar).
     */
    branch_sync_needed: boolean
}

/**
 * Obtiene el perfil del usuario autenticado con su empresa y membresías.
 *
 * FASE 10.2 + 10.5:
 *   - `role` se lee de la membresía activa (no de profiles.role).
 *   - `is_platform_admin` indica técnicos de plataforma.
 *   - Cuentas de plataforma: role='technician', companies=null, memberships=[].
 */
export async function getUserProfile(): Promise<UserProfile | null> {
    const supabase = createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        warnSilently('getUserProfile.auth', authError);
        return null
    }

    const userId = user.id
    const jwtCompanyId = user.app_metadata?.company_id as string | undefined

    // Cuentas de plataforma: rol 'technician' convencional, sin membresías.
    if (await isPlatformUser(userId)) {
        return {
            id: userId,
            full_name: null,
            role: 'technician' as UserRole,
            company_id: null,
            companies: null,
            memberships: [],
            active_membership: null,
            branch_memberships: [],
            active_branch_id: null,
            branch_role: null,
            is_platform_admin: true,
            branch_sync_needed: false,
        }
    }

    // Leer profile (full_name principalmente; company_id es cache).
    const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, company_id')
        .eq('id', userId)
        .maybeSingle()

    if (profileError) {
        warnSilently('getUserProfile.profile', profileError);
        return null
    }

    if (!profile) {
        console.warn(`[getUserProfile] Usuario ${userId} no tiene fila en profiles`);
        return null
    }

    // Leer todas las membresías con su empresa anidada.
    const memberships = await getUserMemberships(userId)
    const activeMembership = await getActiveMembership(userId, jwtCompanyId)

    if (!activeMembership) {
        console.warn(`[getUserProfile] Usuario ${userId} sin membresía activa`);
        return null
    }

    // Si por alguna razón la empresa activa no tiene `companies` anidado,
    // hacer fetch explícito (defensa en profundidad).
    let companies = activeMembership.companies ?? null
    if (!companies) {
        const { data: company } = await supabaseAdmin
            .from('companies')
            .select('id, slug, trade_name, legal_name, currency, timezone')
            .eq('id', activeMembership.company_id)
            .maybeSingle()
        companies = company
    }

    // FASE 11 (Bloque C): cargar branch_memberships de la empresa activa.
    // Si el usuario no tiene branch_membership (caso degenerado post-11.5),
    // el array queda vacío y la UI muestra el selector como label estático
    // (o no lo muestra si es role owner que debe asignarse primero).
    const branchMemberships = await getUserBranches(userId, activeMembership.company_id)

    // Resolver el branch_id activo y el rol en la sucursal.
    // Prioridad (Fase 11.6 + 11.7 — fix hallazgos auditor Commits 2-4):
    //   1. JWT.branch_id si la membrisía existe en esta empresa (caso
    //      normal post-deploy con sesión ya sincronizada).
    //   2. Fallback: membrisía con `is_default = true` del usuario en
    //      esta empresa. Esto cubre usuarios pre-Fase 11 con JWT
    //      cacheado sin branch_id (la autorregeneración del JWT era el
    //      comportamiento original de `getCurrentBranchId` y se conserva
    //      aquí para que `getUserProfile` calcule el activeBranchId
    //      canónico ANTES de invocar `syncBranchIdToJwtIfMissing`).
    //   3. null si el usuario no tiene ninguna membrisía usable
    //      (caso degenerado: owner sin asignar).
    //
    // IMPORTANTE: este cálculo debe usar el MISMO fallback que
    // `resolveBranchIdForUser` en `lib/supabase/branch-context.ts`. Si
    // diferimos, `syncBranchIdToJwtIfMissing` se vuelve un no-op
    // efectivo (porque activeBranchId === jwtBranchId siempre), y el
    // usuario queda con el JWT cacheado viejo — bug que producía un
    // loop de refresh en el AppShell (Hallazgo ALTO #1 del auditor).
    const jwtBranchId = user.app_metadata?.branch_id as string | undefined
    let activeBranchMembership = branchMemberships.find(
        (m) => m.branch_id === jwtBranchId
    )
    if (!activeBranchMembership) {
        activeBranchMembership = branchMemberships.find((m) => m.is_default)
    }
    const activeBranchId = activeBranchMembership?.branch_id ?? null
    const branchRole = activeBranchMembership?.role ?? null

    // FASE 11.7 (Commit 2 — fix selector de sucursal): sincronizar JWT
    // si hace falta.
    //
    // El JWT cacheado en el navegador del cliente NO se actualiza solo
    // (Supabase solo emite un access token nuevo en `refreshSession()`
    // explícito o al recargar la pestaña). Por eso, si el JWT trae un
    // branch_id distinto del activo (o no lo trae y el fallback resolvió
    // uno), sincronizamos `auth.users` acá y avisamos al cliente con
    // `branch_sync_needed: true` para que recargue y traiga el claim
    // correcto.
    //
    // `syncBranchIdToJwtIfMissing` devuelve `true` cuando escribe
    // (JWT desincronizado: null, distinto, o membership eliminada). El
    // cliente (`components/Dashboard/AppShell.tsx`) siempre llama
    // `refreshSession()` y luego `window.location.reload()` cuando este
    // flag es `true`.
    //
    // Si la sincronización falla (rate-limit de Admin API, red, etc.),
    // NO rompe la carga del dashboard: log warn y devolvemos
    // `branch_sync_needed = false`. El usuario verá el selector de
    // sucursal con el branch por defecto calculado, aunque el JWT quede
    // desincronizado hasta el próximo reload manual.
    let branchSyncNeeded = false
    if (activeBranchId) {
        try {
            branchSyncNeeded = await syncBranchIdToJwtIfMissing(
                userId,
                activeBranchId,
                (user.app_metadata as Record<string, unknown>) ?? {}
            )
        } catch (err) {
            console.warn(
                `[getUserProfile] syncBranchIdToJwtIfMissing failed for user=${userId}: ${(err as Error).message}`
            )
        }
    }

    return {
        id: userId,
        full_name: profile.full_name as string | null,
        role: activeMembership.role as UserRole,
        company_id: activeMembership.company_id,
        companies: companies as UserProfile['companies'],
        memberships,
        active_membership: activeMembership,
        branch_memberships: branchMemberships,
        active_branch_id: activeBranchId,
        branch_role: branchRole as UserRole | null,
        is_platform_admin: false,
        branch_sync_needed: branchSyncNeeded,
    }
}
