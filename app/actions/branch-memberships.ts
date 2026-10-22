'use server'

import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '../../lib/supabase'
import { createClient } from '../../lib/supabase/server'
import { requireAuthContext, requireOwner, requireRole } from '../../lib/supabase/auth-helpers'
import { isPlatformUser } from '../../lib/supabase/membership-queries'
import { handleActionError, err } from '../../lib/errors'
import { audit } from '../../lib/audit'
import {
    getUserBranches,
    isUserInBranch,
} from '../../lib/supabase/branch-membership-queries'
import type { BranchMembership } from '../../lib/supabase/branches'
import type { UserRole } from '../../lib/supabase/memberships'

/**
 * ACCIONES DE MEMBRESÍAS DE SUCURSAL (BLOQUE B - FASE 11)
 *
 * Permiten al owner asignar / remover usuarios a sucursales dentro de
 * la empresa activa, y cambiar la sucursal activa del propio usuario
 * (similar a `switchActiveCompanyAction` de Fase 10).
 *
 * Todas las queries filtran por `company_id` (multi-tenant defense in
 * depth: aunque `supabaseAdmin` bypassa RLS, las acciones operan
 * exclusivamente sobre la empresa del JWT).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_ROLES = ['owner', 'manager', 'technician']

/**
 * Asigna un usuario a una sucursal con un rol determinado.
 *
 * Validaciones:
 *   - Caller debe ser owner.
 *   - El usuario a asignar debe tener company_membership en la empresa
 *     activa (no se pueden asignar usuarios ajenos al tenant).
 *   - La sucursal debe pertenecer a la empresa activa.
 *   - El rol debe ser uno de los user_role válidos.
 *
 * Si es la primera branch_membership del usuario, se marca is_default=true.
 */
export async function assignUserToBranchAction(
    userId: string,
    branchId: string,
    role: string
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

        if (!UUID_RE.test(userId)) {
            throw err('VALIDATION', `userId inválido: ${userId}`, {
                userMessage: 'Identificador de usuario inválido.',
            })
        }
        if (!UUID_RE.test(branchId)) {
            throw err('VALIDATION', `branchId inválido: ${branchId}`, {
                userMessage: 'Identificador de sucursal inválido.',
            })
        }
        if (!ALLOWED_ROLES.includes(role)) {
            throw err('VALIDATION', `rol inválido: ${role}`, {
                userMessage: `Rol inválido. Permitidos: ${ALLOWED_ROLES.join(', ')}.`,
            })
        }

        // 1. Validar que el usuario tiene company_membership en la empresa activa.
        const { data: companyMembership, error: cmError } = await supabaseAdmin
            .from('company_memberships')
            .select('user_id, company_id')
            .eq('user_id', userId)
            .eq('company_id', ctx.companyId)
            .maybeSingle()

        if (cmError) {
            throw err('EXTERNAL', `company_memberships.select: ${cmError.message}`, {
                cause: cmError,
            })
        }
        if (!companyMembership) {
            throw err('NOT_FOUND', `user ${userId} sin company_membership en ${ctx.companyId}`, {
                userMessage: 'El usuario no pertenece a esta empresa.',
            })
        }

        // 2. Validar que la sucursal pertenece a la empresa activa.
        const { data: branch, error: branchError } = await supabaseAdmin
            .from('branches')
            .select('id, company_id, active')
            .eq('id', branchId)
            .eq('company_id', ctx.companyId)
            .maybeSingle()

        if (branchError) {
            throw err('EXTERNAL', `branches.select: ${branchError.message}`, { cause: branchError })
        }
        if (!branch) {
            throw err('NOT_FOUND', `branch ${branchId} no en tenant ${ctx.companyId}`, {
                userMessage: 'Sucursal no encontrada en esta empresa.',
            })
        }
        if (!branch.active) {
            throw err('VALIDATION', 'branch inactive', {
                userMessage: 'No se puede asignar a una sucursal desactivada.',
            })
        }

        // 3. Detectar si es la primera branch_membership del usuario.
        const existing = await getUserBranches(userId, ctx.companyId)
        const isFirst = existing.length === 0

        // 4. Limpiar default actual si vamos a marcar esta como default.
        if (isFirst) {
            await supabaseAdmin
                .from('branch_memberships')
                .update({ is_default: false })
                .eq('user_id', userId)
                .eq('is_default', true)
        }

        // 5. Insert (o actualizar si ya existía por error humano).
        const { error: insertError } = await supabaseAdmin
            .from('branch_memberships')
            .upsert(
                {
                    user_id: userId,
                    company_id: ctx.companyId,
                    branch_id: branchId,
                    role: role as UserRole,
                    is_default: isFirst,
                },
                { onConflict: 'user_id,branch_id' }
            )

        if (insertError) {
            if (insertError.code === '23505') {
                throw err('CONFLICT', 'branch_membership duplicate', {
                    userMessage: 'El usuario ya está asignado a esta sucursal.',
                })
            }
            throw err('EXTERNAL', `branch_memberships.upsert: ${insertError.message}`, {
                cause: insertError,
            })
        }

        await audit(ctx, 'assignUserToBranchAction', 'branch_membership', {
          branchId,
          entityId: `${userId}:${branchId}`, payload: { userId, branchId, role },
        });

        revalidatePath('/', 'layout')
        return { success: true as const }
    } catch (caught) {
        return handleActionError(caught, 'assignUserToBranchAction')
    }
}

/**
 * Remueve la membrisía de un usuario en una sucursal específica.
 *
 * NO remueve la membrisía de empresa (eso lo haría `deleteUser` o la
 * gestión de empresa). Aquí solo se quita el acceso a UNA sucursal.
 *
 * Validaciones:
 *   - Solo owners.
 *   - No se puede quitar si la membrisía es la única del usuario y la
 *     sucursal es is_main=true. Para evitar dejar al usuario sin
 *     sucursal MAIN accesible (rompería el flujo operacional).
 */
export async function removeUserFromBranchAction(
    userId: string,
    branchId: string
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

        if (!UUID_RE.test(userId)) {
            throw err('VALIDATION', `userId inválido: ${userId}`, {
                userMessage: 'Identificador de usuario inválido.',
            })
        }
        if (!UUID_RE.test(branchId)) {
            throw err('VALIDATION', `branchId inválido: ${branchId}`, {
                userMessage: 'Identificador de sucursal inválido.',
            })
        }

        // 1. Verificar que la membrisía existe Y pertenece a la empresa.
        const hasMembership = await isUserInBranch(userId, branchId)
        if (!hasMembership) {
            throw err('NOT_FOUND', `branch_membership no existe: ${userId}/${branchId}`, {
                userMessage: 'El usuario no está asignado a esta sucursal.',
            })
        }

        // 2. Defensa: no quitar la membrisía del usuario en la MAIN si es su única.
        const { data: branch, error: branchError } = await supabaseAdmin
            .from('branches')
            .select('is_main')
            .eq('id', branchId)
            .eq('company_id', ctx.companyId)
            .maybeSingle()

        if (branchError) {
            throw err('EXTERNAL', `branches.select: ${branchError.message}`, { cause: branchError })
        }

        if (branch?.is_main) {
            const userBranches = await getUserBranches(userId, ctx.companyId)
            if (userBranches.length <= 1) {
                throw err('VALIDATION', 'cannot remove last branch membership on MAIN', {
                    userMessage: 'No se puede quitar la única membrisía del usuario en la sucursal principal.',
                })
            }
        }

        const { error } = await supabaseAdmin
            .from('branch_memberships')
            .delete()
            .eq('user_id', userId)
            .eq('branch_id', branchId)
            .eq('company_id', ctx.companyId)

        if (error) {
            throw err('EXTERNAL', `branch_memberships.delete: ${error.message}`, { cause: error })
        }

        await audit(ctx, 'removeUserFromBranchAction', 'branch_membership', {
          branchId,
          entityId: `${userId}:${branchId}`, payload: { userId, branchId },
        });

        revalidatePath('/', 'layout')
        return { success: true as const }
    } catch (caught) {
        return handleActionError(caught, 'removeUserFromBranchAction')
    }
}

/**
 * Cambia la sucursal activa del usuario actual.
 *
 * Patrón análogo a `switchActiveCompanyAction` (Fase 10.3):
 *   1. Resuelve `AuthContext` (sesión + tenant activo). El `company_id`
 *      del JWT es la ÚNICA fuente válida para sobreescribir
 *      `app_metadata.company_id` (defense contra cross-tenant swap).
 *   2. Rechaza explícitamente platform admins (no operan sobre sucursales).
 *   3. Lee las membrisías de sucursal FILTRADAS por `ctx.companyId` y
 *      valida que la branch destino pertenece al tenant activo.
 *   4. Actualiza `app_metadata.branch_id` + `app_metadata.role` en
 *      auth.users (esto propaga al JWT en el próximo refresh).
 *   5. Marca la branch_membership como `is_default = true`.
 *   6. Revalida el layout.
 *
 * El rol actualizado en app_metadata se toma de la membrisía de la
 * sucursal destino (no de la membrisía de empresa), porque el rol
 * operacional vive en branch_memberships.
 *
 * `app_metadata.company_id` se escribe desde `ctx.companyId` (que ya
 * pasó por la validación multi-tenant de Fase 10) — NUNCA desde
 * `target.company_id`, para que un branchId de otra empresa no pueda
 * pivotar el tenant del JWT.
 *
 * El componente que llama (BranchSelector) hace `window.location.reload()`
 * tras el éxito para forzar al cliente a obtener el JWT fresco.
 */
export async function switchActiveBranchAction(branchId: string): Promise<{
    success: true
    branchId: string
    role: UserRole
} | {
    success: false
    error: string
    code: import('../../lib/errors').AppErrorCode
}> {
    try {
        // 1. Resolver contexto autenticado (valida sesión + membrisía + rol).
        //    requireAuthContext ya garantiza que el usuario pertenece al
        //    tenant del JWT; usamos `ctx.companyId` como ancla de defensa
        //    multi-tenant contra un branchId cross-tenant.
        const ctx = await requireRole(['owner', 'manager'])
        const user = ctx.user

        if (!UUID_RE.test(branchId)) {
            throw err('VALIDATION', `branchId inválido: ${branchId}`, {
                userMessage: 'Identificador de sucursal inválido.',
            })
        }

        // 2. Rechazar explícitamente platform admins. Es redundante con el
        //    filtro de membrisías de abajo (un platform admin no tiene
        //    branch_memberships y fallaría igual), pero explícito y testeable:
        //    evita el bug futuro "se relaja el filtro y se cuela el platform
        //    admin".
        if (await isPlatformUser(user.id)) {
            throw err('NO_BRANCH_CONTEXT', 'Los técnicos de plataforma no operan sobre sucursales', {
                userMessage: 'No tenés acceso a sucursales.',
            })
        }

        // 3. Validar membrisía filtrada por empresa (defense multi-tenant).
        //    Si branchId pertenece a OTRA empresa, el `.find` no la encuentra
        //    y se lanza FORBIDDEN sin sobreescribir `app_metadata`.
        const memberships = await getUserBranches(user.id, ctx.companyId)
        const target = memberships.find((m: BranchMembership) => m.branch_id === branchId)

        if (!target) {
            throw err('FORBIDDEN', `user ${user.id} sin branch_membership en ${branchId} del tenant ${ctx.companyId}`, {
                userMessage: 'No pertenecés a esa sucursal.',
            })
        }

        // Doble check defensivo: aunque getUserBranches filtró por
        // company_id, verificamos explícitamente que `target.company_id`
        // coincide con el tenant del JWT. Si difiere, abortamos antes de
        // tocar app_metadata.
        if (target.company_id !== ctx.companyId) {
            throw err('FORBIDDEN', `branch ${branchId} (company ${target.company_id}) no pertenece al tenant activo ${ctx.companyId}`, {
                userMessage: 'No pertenecés a esa sucursal.',
            })
        }

        // 4. Actualizar app_metadata en auth.users.
        //    NO invalida el JWT actual; el reload del cliente lo refresca.
        const supabase = createClient()
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
            user.id,
            {
                app_metadata: {
                    // CRÍTICO: `company_id` se escribe desde `ctx.companyId`
                    // (la fuente validada), NUNCA desde `target.company_id`.
                    // Esto cierra el cross-tenant JWT swap.
                    company_id: ctx.companyId,
                    branch_id: branchId,
                    role: target.role,
                    // Espejo de profiles.is_platform_admin para el middleware.
                    is_platform_admin: await isPlatformUser(user.id),
                },
            }
        )

        if (updateError) {
            throw err('EXTERNAL', `auth.updateUserById: ${updateError.message}`, {
                cause: updateError,
            })
        }

        // 5. Marcar como default.
        await supabaseAdmin
            .from('branch_memberships')
            .update({ is_default: false })
            .eq('user_id', user.id)
            .eq('is_default', true)

        await supabaseAdmin
            .from('branch_memberships')
            .update({ is_default: true })
            .eq('user_id', user.id)
            .eq('branch_id', branchId)

        // 6. Refrescar la sesión del cliente y revalidar.
        await supabase.auth.refreshSession()
        await audit(ctx, 'switchActiveBranchAction', 'branch_membership', {
          branchId,
          entityId: branchId, payload: { switched_to: branchId },
        });

        revalidatePath('/', 'layout')

        return { success: true as const, branchId, role: target.role as UserRole }
    } catch (caught) {
        return handleActionError(caught, 'switchActiveBranchAction')
    }
}