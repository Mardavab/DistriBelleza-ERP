'use server'

import { supabaseAdmin } from '../../../lib/supabase'
import { requirePlatformRole } from '../../../lib/supabase/auth-helpers'
import { err, handleActionError, type ActionResult } from '../../../lib/errors'
import type { CompanyActivity, HealthCheck } from '../types'

/**
 * ACCIONES DE LA CONSOLA DE PLATAFORMA
 *
 * Solo accesibles para el rol `technician` (administrador de plataforma).
 * Usan `requirePlatformRole` porque estas cuentas no tienen `company_id`.
 *
 * No se usa `requireAuthContext` porque exige contexto de empresa.
 */

const PLATFORM_ROLES = ['technician']

/** Ejecuta una promesa con timeout para que un servicio caído no
 *  deje la consola colgada. */
async function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)
    })
    try {
        return await Promise.race([Promise.resolve(promise), timeout])
    } finally {
        clearTimeout(timer!)
    }
}

/**
 * Chequeos de salud del sistema. Sin infraestructura nueva:
 * consulta directa a Supabase y al print service local.
 */
export async function getSystemHealth(): Promise<ActionResult<HealthCheck[]>> {
    try {
        await requirePlatformRole(PLATFORM_ROLES)

        const checks: HealthCheck[] = []

        // ---------------------------------------------------------
        // 1) Base de datos
        // ---------------------------------------------------------
        const dbStart = Date.now()
        try {
            // Importante: el query builder de PostgREST resuelve con
            // `{ data, error }` y NO lanza excepción. Hay que mirar `error`
            // explícitamente o el check reportaría "ok" con la base caída.
            const { error } = await withTimeout(
                supabaseAdmin.from('companies').select('id').limit(1),
                5000
            )
            if (error) throw new Error(error.message)

            const latency = Date.now() - dbStart
            checks.push({
                id: 'database',
                label: 'Base de datos',
                status: latency > 2000 ? 'warn' : 'ok',
                detail: 'Conexión activa',
                meta: `${latency} ms`,
            })
        } catch (dbFailure: any) {
            checks.push({
                id: 'database',
                label: 'Base de datos',
                status: 'error',
                detail: dbFailure?.message === 'timeout 5000ms'
                    ? 'Sin respuesta en 5 segundos'
                    : (dbFailure?.message || 'No se pudo conectar'),
            })
        }

        // ---------------------------------------------------------
        // 2) Impresión
        // ---------------------------------------------------------
        // La impresión se hace vía WebUSB directamente desde el navegador
        // del cajero contra la impresora USB local. No hay servicio central
        // que monitorear: el estado de la impresora depende del hardware del
        // cliente. Marcamos este check como informativo ("ok" siempre) para
        // que la consola de plataforma no muestre falsos errores.
        checks.push({
            id: 'printing',
            label: 'Impresión (WebUSB local)',
            status: 'ok',
            detail: 'La impresión es local vía WebUSB (Chrome/Edge).',
            meta: 'Compatible con impresoras térmicas ESC/POS nativas USB',
        })

        // ---------------------------------------------------------
        // 3) Tenants
        // ---------------------------------------------------------
        const { data: allCompanies, error: companiesError } = await supabaseAdmin
            .from('companies')
            .select('id, active')

        if (companiesError) {
            checks.push({
                id: 'tenants',
                label: 'Empresas registradas',
                status: 'error',
                detail: companiesError.message,
            })
        } else {
            const total = allCompanies?.length ?? 0
            const inactive = allCompanies?.filter(c => !c.active).length ?? 0
            checks.push({
                id: 'tenants',
                label: 'Empresas registradas',
                status: 'ok',
                detail: `${total - inactive} activa${total - inactive === 1 ? '' : 's'}`,
                meta: inactive > 0 ? `${inactive} inactiva${inactive === 1 ? '' : 's'}` : undefined,
            })
        }

        // ---------------------------------------------------------
        // 4) Usuarios de plataforma configurados
        // ---------------------------------------------------------
        // FASE 10.5: detectar técnicos por `is_platform_admin` (no por
        // `profiles.role`, que se elimina en 10.5).
        const { count: technicianCount } = await supabaseAdmin
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('is_platform_admin', true)

        checks.push({
            id: 'platform-admins',
            label: 'Administradores de plataforma',
            status: (technicianCount ?? 0) > 0 ? 'ok' : 'error',
            detail: (technicianCount ?? 0) > 0
                ? `${technicianCount} cuenta${technicianCount === 1 ? '' : 's'} con acceso`
                : 'Ninguna cuenta puede administrar la plataforma',
        })

        return { success: true as const, data: checks }
    } catch (caught) {
        return handleActionError(caught, 'getSystemHealth')
    }
}

/**
 * Lista todas las empresas de la plataforma con su actividad.
 * Sin filtro `created_by`: el administrador de plataforma necesita ver
 * la totalidad de los tenants, no solo los que él creó.
 */
export async function getAllCompanies(): Promise<ActionResult<CompanyActivity[]>> {
    try {
        await requirePlatformRole(PLATFORM_ROLES)

        const { data: companies, error } = await supabaseAdmin
            .from('companies')
            .select('id, slug, legal_name, trade_name, active, deactivation_reason, deactivated_at, created_at')
            .order('created_at', { ascending: false })

        if (error) throw err('EXTERNAL', `companies.list: ${error.message}`, { cause: error })
        if (!companies?.length) return { success: true as const, data: [] }

        const ids = companies.map(c => c.id)

        // Conteos y actividad agregados: una query por tabla, no por empresa.
        const [usersRes, salesRes] = await Promise.all([
            supabaseAdmin
                .from('profiles')
                .select('company_id')
                .in('company_id', ids),
            supabaseAdmin
                .from('sales')
                .select('company_id, total_with_discount, created_at')
                .in('company_id', ids)
                .eq('status', 'completed'),
        ])

        const userCounts = new Map<string, number>()
        for (const p of usersRes.data ?? []) {
            if (!p.company_id) continue
            userCounts.set(p.company_id, (userCounts.get(p.company_id) ?? 0) + 1)
        }

        const salesByCompany = new Map<string, { total: number; last: string | null }>()
        for (const s of salesRes.data ?? []) {
            if (!s.company_id) continue
            const entry = salesByCompany.get(s.company_id) ?? { total: 0, last: null }
            entry.total += Number(s.total_with_discount ?? 0)
            if (!entry.last || s.created_at > entry.last) entry.last = s.created_at
            salesByCompany.set(s.company_id, entry)
        }

        const data: CompanyActivity[] = companies.map(c => {
            const activity = salesByCompany.get(c.id)
            return {
                id: c.id,
                slug: c.slug,
                trade_name: c.trade_name,
                legal_name: c.legal_name,
                active: c.active,
                deactivation_reason: c.deactivation_reason,
                deactivated_at: c.deactivated_at,
                created_at: c.created_at,
                user_count: userCounts.get(c.id) ?? 0,
                last_sale_at: activity?.last ?? null,
                sales_total: activity?.total ?? 0,
            }
        })

        return { success: true as const, data }
    } catch (caught) {
        return handleActionError(caught, 'getAllCompanies')
    }
}

/**
 * Activa o desactiva una empresa.
 *
 * Desactivar es REVERSIBLE: no se borra ningún dato de negocio, solo se
 * bloquea el login (`app/actions/auth.ts` rechaza empresas inactivas).
 * El motivo queda registrado para auditoría.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_REASON_LENGTH = 500

export async function setCompanyActive(
    companyId: string,
    active: boolean,
    reason?: string
): Promise<ActionResult<never>> {
    try {
        await requirePlatformRole(PLATFORM_ROLES)

        if (typeof companyId !== 'string' || !UUID_RE.test(companyId)) {
            throw err('VALIDATION', 'invalid company id', {
                userMessage: 'Identificador de empresa inválido',
            })
        }

        if (reason && reason.length > MAX_REASON_LENGTH) {
            throw err('VALIDATION', 'deactivation reason too long', {
                userMessage: `El motivo no puede superar ${MAX_REASON_LENGTH} caracteres`,
            })
        }

        const { data: company } = await supabaseAdmin
            .from('companies')
            .select('id, active')
            .eq('id', companyId)
            .maybeSingle()

        if (!company) {
            throw err('NOT_FOUND', `company not found: ${companyId}`, {
                userMessage: 'La empresa no existe',
            })
        }

        if (company.active === active) {
            return { success: true as const } // sin cambios
        }

        const cleanReason = reason?.trim()
            || 'Desactivada manualmente por el administrador de plataforma'

        const { error } = await supabaseAdmin
            .from('companies')
            .update({
                active,
                deactivated_at: active ? null : new Date().toISOString(),
                deactivation_reason: active ? null : cleanReason,
            })
            .eq('id', companyId)

        if (error) throw err('EXTERNAL', `companies.update: ${error.message}`, { cause: error })

        console.log(
            `[platform] Empresa ${companyId} ${active ? 'activada' : 'desactivada'}` +
            (active ? '' : ` — motivo: ${cleanReason}`)
        )

        return { success: true as const }
    } catch (caught) {
        return handleActionError(caught, 'setCompanyActive')
    }
}