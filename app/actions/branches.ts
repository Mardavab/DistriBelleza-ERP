'use server'

import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '../../lib/supabase'
import { requireAuthContext, requireOwner } from '../../lib/supabase/auth-helpers'
import { handleActionError, err } from '../../lib/errors'
import type { Branch } from '../../lib/supabase/branches'

/**
 * ACCIONES DE GESTIÓN DE SUCURSALES (BLOQUE B - FASE 11)
 *
 * Solo owners pueden crear/actualizar/desactivar sucursales dentro de
 * su empresa. Las queries filtran explícitamente por `company_id` para
 * mantener el aislamiento multi-tenant (la server-side usa supabaseAdmin
 * que bypassa RLS).
 *
 * Reglas:
 *   - listBrachesAction: visible para cualquier usuario con membrisía
 *     (no solo owner) — necesario para que el selector de sucursal
 *     funcione. Devuelve solo sucursales activas por defecto.
 *   - createBranchAction: solo owner.
 *   - updateBranchAction: solo owner.
 *   - deactivateBranchAction: solo owner (NO se borra, marca active=false).
 *
 * NO hay deleteBranchAction: la política es preservar historial
 * (ventas, stock). deactivateBranchAction es la forma correcta de
 * "cerrar" una sucursal.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODE_RE = /^[A-Z0-9_-]{1,20}$/
const NAME_MAX_LENGTH = 200
const PHONE_MAX_LENGTH = 50
const ADDRESS_MAX_LENGTH = 500

/**
 * Lista las sucursales de la empresa activa del usuario.
 *
 * Devuelve todas las sucursales (activas e inactivas) para que el owner
 * pueda gestionar también las desactivadas. Orden: principal primero, luego
 * alfabético por code.
 */
export async function listBranchesAction(): Promise<{
    success: true
    data: Branch[]
} | {
    success: false
    error: string
    code: import('../../lib/errors').AppErrorCode
}> {
    try {
        const ctx = await requireAuthContext()

        const { data: branches, error } = await supabaseAdmin
            .from('branches')
            .select('id, company_id, code, name, address, phone, is_main, active, created_at')
            .eq('company_id', ctx.companyId)
            .order('is_main', { ascending: false })
            .order('code', { ascending: true })

        if (error) {
            throw err('EXTERNAL', `branches.list: ${error.message}`, { cause: error })
        }

        return { success: true as const, data: (branches ?? []) as Branch[] }
    } catch (caught) {
        return handleActionError(caught, 'listBranchesAction')
    }
}

/**
 * Crea una nueva sucursal en la empresa activa.
 *
 * Validaciones:
 *   - Caller debe ser owner (requireOwner).
 *   - `code` solo letras mayúsculas, números, guion y guion bajo
 *     (1-20 chars). Constraint UNIQUE(company_id, code) lo protege de
 *     duplicados a nivel DB.
 *   - `name` no vacío, máx 200 chars.
 *   - `address` opcional, máx 500 chars.
 *   - `phone` opcional, máx 50 chars.
 *
 * NO crea branch_memberships automáticamente. El owner debe asignar
 * usuarios después con `assignUserToBranchAction`.
 */
export async function createBranchAction(payload: {
    code: string
    name: string
    address?: string | null
    phone?: string | null
}): Promise<{
    success: true
    data: Branch
} | {
    success: false
    error: string
    code: import('../../lib/errors').AppErrorCode
}> {
    try {
        const ctx = await requireAuthContext()
        requireOwner(ctx.role)

        const code = (payload.code ?? '').trim().toUpperCase()
        const name = (payload.name ?? '').trim()

        if (!CODE_RE.test(code)) {
            throw err('VALIDATION', `code inválido: ${payload.code}`, {
                userMessage: 'El código debe tener 1-20 caracteres: letras mayúsculas, números, guion o guion bajo.',
            })
        }
        if (!name) {
            throw err('VALIDATION', 'name vacío', {
                userMessage: 'El nombre es obligatorio.',
            })
        }
        if (name.length > NAME_MAX_LENGTH) {
            throw err('VALIDATION', `name demasiado largo: ${name.length}`, {
                userMessage: `El nombre no puede superar ${NAME_MAX_LENGTH} caracteres.`,
            })
        }
        if (payload.address && payload.address.length > ADDRESS_MAX_LENGTH) {
            throw err('VALIDATION', `address demasiado largo: ${payload.address.length}`, {
                userMessage: `La dirección no puede superar ${ADDRESS_MAX_LENGTH} caracteres.`,
            })
        }
        if (payload.phone && payload.phone.length > PHONE_MAX_LENGTH) {
            throw err('VALIDATION', `phone demasiado largo: ${payload.phone.length}`, {
                userMessage: `El teléfono no puede superar ${PHONE_MAX_LENGTH} caracteres.`,
            })
        }

        const { data: created, error } = await supabaseAdmin
            .from('branches')
            .insert({
                company_id: ctx.companyId,
                code,
                name,
                address: payload.address?.trim() || null,
                phone: payload.phone?.trim() || null,
                is_main: false, // solo se permite una is_main (constraint de app)
                active: true,
                created_by: ctx.user.id,
            })
            .select('id, company_id, code, name, address, phone, is_main, active, created_at')
            .single()

        if (error) {
            if (error.code === '23505') {
                throw err('CONFLICT', `branch unique violation: ${code}`, {
                    userMessage: `Ya existe una sucursal con código "${code}" en esta empresa.`,
                })
            }
            throw err('EXTERNAL', `branches.insert: ${error.message}`, { cause: error })
        }

        revalidatePath('/', 'layout')
        return { success: true as const, data: created as Branch }
    } catch (caught) {
        return handleActionError(caught, 'createBranchAction')
    }
}

/**
 * Actualiza campos editables de una sucursal.
 *
 * NO permite cambiar `code` ni `is_main` ni `company_id`:
 *   - `code`: cambiarlo rompe la identidad legible y referencias históricas.
 *   - `is_main`: solo una MAIN por empresa. Si se necesitara reasignar,
 *     eso debe ser una operación explícita separada (no implementada en
 *     este bloque).
 *   - `company_id`: cambiaría el tenant — operación no soportada.
 *
 * Campos editables: name, address, phone, active.
 */
export async function updateBranchAction(
    branchId: string,
    updates: { name?: string; address?: string | null; phone?: string | null; active?: boolean }
): Promise<{
    success: true
} | {
    success: false
    error: string
    code: import('../../lib/errors').AppErrorCode
}> {
    try {
        const ctx = await requireAuthContext()
        requireOwner(ctx.role)

        if (!UUID_RE.test(branchId)) {
            throw err('VALIDATION', `branchId inválido: ${branchId}`, {
                userMessage: 'Identificador de sucursal inválido.',
            })
        }

        const patch: Record<string, unknown> = {}

        if (updates.name !== undefined) {
            const name = updates.name.trim()
            if (!name) {
                throw err('VALIDATION', 'name vacío', {
                    userMessage: 'El nombre es obligatorio.',
                })
            }
            if (name.length > NAME_MAX_LENGTH) {
                throw err('VALIDATION', `name demasiado largo: ${name.length}`, {
                    userMessage: `El nombre no puede superar ${NAME_MAX_LENGTH} caracteres.`,
                })
            }
            patch.name = name
        }

        if (updates.address !== undefined) {
            if (updates.address && updates.address.length > ADDRESS_MAX_LENGTH) {
                throw err('VALIDATION', `address demasiado largo`, {
                    userMessage: `La dirección no puede superar ${ADDRESS_MAX_LENGTH} caracteres.`,
                })
            }
            patch.address = updates.address?.trim() || null
        }

        if (updates.phone !== undefined) {
            if (updates.phone && updates.phone.length > PHONE_MAX_LENGTH) {
                throw err('VALIDATION', `phone demasiado largo`, {
                    userMessage: `El teléfono no puede superar ${PHONE_MAX_LENGTH} caracteres.`,
                })
            }
            patch.phone = updates.phone?.trim() || null
        }

        if (updates.active !== undefined) {
            patch.active = updates.active
        }

        if (Object.keys(patch).length === 0) {
            // No-op: nada que cambiar.
            return { success: true as const }
        }

        const { error } = await supabaseAdmin
            .from('branches')
            .update(patch)
            .eq('id', branchId)
            .eq('company_id', ctx.companyId) // defensa multi-tenant

        if (error) {
            throw err('EXTERNAL', `branches.update: ${error.message}`, { cause: error })
        }

        revalidatePath('/', 'layout')
        return { success: true as const }
    } catch (caught) {
        return handleActionError(caught, 'updateBranchAction')
    }
}

/**
 * Marca una sucursal como inactiva (soft delete).
 *
 * NO se borra físicamente: queremos conservar el historial de ventas,
 * movimientos de inventario y demás operaciones asociadas a la sucursal.
 * Una sucursal desactivada:
 *   - No aparece en el selector de sucursal activa (filtra active=true).
 *   - Sus branch_memberships siguen existiendo (puede reactivarse).
 *
 * Reglas:
 *   - Solo owners.
 *   - No permite desactivar la sucursal MAIN (is_main=true). La MAIN
 *     es la "sede" histórica y debe permanecer activa para preservar
 *     la integridad de los registros pre-multi-sucursal.
 */
export async function deactivateBranchAction(branchId: string): Promise<{
    success: true
} | {
    success: false
    error: string
    code: import('../../lib/errors').AppErrorCode
}> {
    try {
        const ctx = await requireAuthContext()
        requireOwner(ctx.role)

        if (!UUID_RE.test(branchId)) {
            throw err('VALIDATION', `branchId inválido: ${branchId}`, {
                userMessage: 'Identificador de sucursal inválido.',
            })
        }

        // Leer la sucursal para validar is_main y pertenencia.
        const { data: branch, error: readError } = await supabaseAdmin
            .from('branches')
            .select('id, is_main, active')
            .eq('id', branchId)
            .eq('company_id', ctx.companyId)
            .maybeSingle()

        if (readError) {
            throw err('EXTERNAL', `branches.select: ${readError.message}`, { cause: readError })
        }
        if (!branch) {
            throw err('NOT_FOUND', `branch not in tenant: ${branchId}`, {
                userMessage: 'Sucursal no encontrada en esta empresa.',
            })
        }

        if (branch.is_main) {
            throw err('VALIDATION', 'cannot deactivate main branch', {
                userMessage: 'No se puede desactivar la sucursal principal.',
            })
        }

        if (!branch.active) {
            // Ya está inactiva: no-op silencioso.
            return { success: true as const }
        }

        const { error } = await supabaseAdmin
            .from('branches')
            .update({ active: false })
            .eq('id', branchId)
            .eq('company_id', ctx.companyId)

        if (error) {
            throw err('EXTERNAL', `branches.update: ${error.message}`, { cause: error })
        }

        revalidatePath('/', 'layout')
        return { success: true as const }
    } catch (caught) {
        return handleActionError(caught, 'deactivateBranchAction')
    }
}