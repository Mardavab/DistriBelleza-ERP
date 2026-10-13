'use server'

import { supabaseAdmin } from '../../lib/supabase'
import { revalidatePath } from 'next/cache'
import { requireAuthContext, requireOwner } from '../../lib/supabase/auth-helpers'
import { handleActionError, err, warnSilently } from '../../lib/errors'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Forma de un perfil con su JOIN a memberships (Fase 10.5). */
interface ProfileWithMemberships {
    id: string
    full_name: string | null
    company_id: string | null
    created_at: string
    memberships?: Array<{
        role: string
        is_default: boolean
        company_id: string
    }> | null
}

/**
 * Lista todos los usuarios del tenant actual.
 *
 * FASE 4: usa requireAuthContext() — solo accesible para usuarios autenticados.
 * FASE 10.5: filtra por `company_memberships` (no por `profiles.company_id`,
 *            que ahora es nullable). El rol se lee desde la membresía
 *            (no desde `profiles.role`, eliminado en 10.5).
 * FASE 10.5 (Bloque A): INNER JOIN contra `company_memberships` filtrado por
 *            `memberships.company_id = ctx.companyId`. Esto reemplaza el
 *            `.eq('company_id', ctx.companyId)` sobre profiles — que tras
 *            10.1 deja de ser la fuente de verdad (profile.company_id
 *            puede ser NULL aunque el usuario tenga membresía en este tenant).
 *
 * Solo owners pueden listar el equipo del tenant (Bloque A — A3).
 * Los managers reciben FORBIDDEN.
 */
export async function getUsers() {
    try {
        const ctx = await requireAuthContext()
        requireOwner(ctx.role)

        // INNER JOIN sobre company_memberships filtrado por este tenant.
        // Filtra en la relación (`memberships.company_id`) en vez del perfil,
        // porque tras 10.1 `profiles.company_id` ya no es la fuente de verdad.
        // Con `!inner`, un perfil sin membresía en este tenant NO aparece
        // (caso degenerado: la migración 10.1 lo cubre, pero INNER JOIN lo
        // hace explícito en el query plan).
        const { data: profiles, error } = await supabaseAdmin
            .from('profiles')
            .select(`
                id,
                full_name,
                company_id,
                created_at,
                memberships:company_memberships!inner(
                    role,
                    is_default,
                    company_id
                )
            `)
            .eq('memberships.company_id', ctx.companyId)
            .order('created_at', { ascending: false })

        if (error) throw err('EXTERNAL', `profiles.list: ${error.message}`, { cause: error })

        // Aplanar: con INNER JOIN, hay a lo sumo 1 membresía coincidente
        // por (user, company) — la PK de memberships lo garantiza.
        const flattened = (profiles ?? []).map((p: ProfileWithMemberships) => {
            const member = (p.memberships ?? [])[0]
            return {
                id: p.id,
                full_name: p.full_name,
                company_id: p.company_id,
                created_at: p.created_at,
                role: member?.role ?? null,
                is_default: member?.is_default ?? false,
            }
        })

        return { success: true as const, data: flattened }
    } catch (caught) {
        return handleActionError(caught, 'getUsers')
    }
}

/**
 * Crea una invitación para un nuevo usuario al tenant actual.
 *
 * FASE 4: requiere rol owner (cierra P0.2).
 * En lugar de crear el usuario directamente (que era un agujero de seguridad),
 * crea una invitación que debe ser aceptada por el invitado.
 *
 * FASE 11 (Bloque C — Commit 3): acepta `branch_id` opcional para
 * vincular la invitación a UNA sucursal. Al aceptar la invitación, el
 * invitado queda automáticamente asignado a esa sucursal con un
 * branch_membership (is_default=true).
 *
 * Reglas de `branch_id`:
 *   - Si se pasa: debe ser UUID, pertenecer a la empresa activa y
 *     estar activa (active=true).
 *   - Si NO se pasa: se hace fallback a la sucursal MAIN de la empresa
 *     (toda empresa tiene una MAIN por backfill de Fase 11.0).
 *   - Defensa multi-tenant: el filtro `company_id = ctx.companyId`
 *     cierra cualquier intento de cross-tenant.
 */
export async function createUser(payload: {
    email: string
    full_name: string
    role: string
    branch_id?: string | null
}) {
    try {
        const ctx = await requireAuthContext()
        requireOwner(ctx.role)

        // 1. Resolver branch_id de la invitación.
        let invitationBranchId: string | null = null

        if (payload.branch_id) {
            // Validar formato UUID.
            if (!UUID_RE.test(payload.branch_id)) {
                throw err('VALIDATION', `branch_id inválido: ${payload.branch_id}`, {
                    userMessage: 'Identificador de sucursal inválido.',
                })
            }

            // Validar pertenencia a la empresa activa y que esté activa
            // (defense multi-tenant + estado: no se asigna a sucursal
            // desactivada).
            const { data: branch, error: branchError } = await supabaseAdmin
                .from('branches')
                .select('id, company_id, active')
                .eq('id', payload.branch_id)
                .eq('company_id', ctx.companyId)
                .maybeSingle()

            if (branchError) {
                throw err('EXTERNAL', `branches.select: ${branchError.message}`, {
                    cause: branchError,
                })
            }
            if (!branch) {
                throw err('NOT_FOUND', `branch ${payload.branch_id} no en tenant ${ctx.companyId}`, {
                    userMessage: 'Sucursal no encontrada en esta empresa.',
                })
            }
            if (!branch.active) {
                throw err('VALIDATION', 'branch inactive', {
                    userMessage: 'No se puede asignar a una sucursal desactivada.',
                })
            }
            invitationBranchId = branch.id
        } else {
            // Fallback: sucursal MAIN de la empresa activa.
            // El backfill de Fase 11.0 garantiza que toda empresa tenga una
            // MAIN, pero defendemos por si acaso (creación de empresa
            // reciente sin backfill completo).
            const { data: mainBranch, error: mainError } = await supabaseAdmin
                .from('branches')
                .select('id, active')
                .eq('company_id', ctx.companyId)
                .eq('is_main', true)
                .maybeSingle()

            if (mainError) {
                throw err('EXTERNAL', `branches.main: ${mainError.message}`, {
                    cause: mainError,
                })
            }
            if (!mainBranch) {
                throw err('NOT_FOUND', `empresa ${ctx.companyId} sin sucursal MAIN`, {
                    userMessage: 'La empresa no tiene sucursal principal configurada.',
                })
            }
            if (!mainBranch.active) {
                throw err('VALIDATION', 'MAIN branch inactive', {
                    userMessage: 'La sucursal principal está desactivada; no se puede crear la invitación.',
                })
            }
            invitationBranchId = mainBranch.id
        }

        // Generar token único
        const token = `${crypto.randomUUID()}-${Date.now().toString(36)}`

        // Expiración: 7 días
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

        const { error: invError } = await supabaseAdmin
            .from('invitations')
            .insert({
                company_id: ctx.companyId,
                email: payload.email.trim(),
                role: payload.role,
                invited_by: ctx.user.id,
                token,
                expires_at: expiresAt,
                branch_id: invitationBranchId,
            })

        if (invError) {
            if (invError.code === '23505') {
                throw err('CONFLICT', 'invitations.unique violation', {
                    userMessage: 'Ya existe una invitación pendiente para este email.',
                })
            }
            throw err('EXTERNAL', `invitations.insert: ${invError.message}`, { cause: invError })
        }

        // Construir URL de invitación
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        const inviteUrl = `${baseUrl}/accept-invitation?token=${token}`

        // TODO: enviar email con el link de invitación
        // await sendInvitationEmail(payload.email, inviteUrl)
        // eslint-disable-next-line no-console
        console.log(`[createUser] Invitación creada para ${payload.email}: ${inviteUrl}`)

        revalidatePath('/')
        return { success: true as const, invitation_url: inviteUrl }
    } catch (caught) {
        return handleActionError(caught, 'createUser')
    }
}

/**
 * Actualiza un usuario del tenant actual.
 * Solo accesible para owners.
 */
export async function updateUser(
    userId: string,
    updates: { full_name?: string; role?: string; email?: string; password?: string }
) {
    try {
        const ctx = await requireAuthContext()
        requireOwner(ctx.role)

        // 1. Validar que el userId pertenece al tenant
        //    (Fase 10: chequear membresía en vez de profile.company_id)
        const { data: targetMembership } = await supabaseAdmin
            .from('company_memberships')
            .select('user_id, company_id, role')
            .eq('user_id', userId)
            .eq('company_id', ctx.companyId)
            .maybeSingle()

        if (!targetMembership) {
            throw err('NOT_FOUND', `user not in tenant: ${userId}`, {
                userMessage: 'Usuario no encontrado en este tenant.',
            })
        }

        // 2. Actualizar profile (full_name solamente; role va en memberships)
        const profileUpdates: any = {}
        if (updates.full_name) profileUpdates.full_name = updates.full_name

        if (Object.keys(profileUpdates).length > 0) {
            const { error } = await supabaseAdmin
                .from('profiles')
                .update(profileUpdates)
                .eq('id', userId)
            if (error) throw err('EXTERNAL', `profiles.update: ${error.message}`, { cause: error })
        }

        // 2b. Actualizar role en la membresía (Fase 10).
        //     Solo si el nuevo rol es distinto al actual, para no tocar la fila.
        if (updates.role && updates.role !== targetMembership.role) {
            const { error: memberUpdateError } = await supabaseAdmin
                .from('company_memberships')
                .update({ role: updates.role })
                .eq('user_id', userId)
                .eq('company_id', ctx.companyId)

            if (memberUpdateError) {
                throw err('EXTERNAL', `memberships.update: ${memberUpdateError.message}`, {
                    cause: memberUpdateError,
                })
            }
        }

        // 3. Actualizar auth.users (email, password, metadata)
        const authUpdates: any = {
            user_metadata: {
                full_name: updates.full_name,
                role: updates.role,
            },
        }
        if (updates.email) authUpdates.email = updates.email
        if (updates.password) authUpdates.password = updates.password

        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
            userId,
            authUpdates
        )
        if (authError) throw err('EXTERNAL', `auth.updateUserById: ${authError.message}`, { cause: authError })

        revalidatePath('/')
        return { success: true as const }
    } catch (caught) {
        return handleActionError(caught, 'updateUser')
    }
}

/**
 * Elimina un usuario del tenant actual.
 * Solo accesible para owners.
 */
export async function deleteUser(userId: string) {
    try {
        const ctx = await requireAuthContext()
        requireOwner(ctx.role)

        // Prevenir auto-eliminación
        if (userId === ctx.user.id) {
            throw err('VALIDATION', 'cannot delete self', {
                userMessage: 'No puedes eliminarte a ti mismo.',
            })
        }

        // Validar que pertenece al tenant
        const { data: targetProfile } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('id', userId)
            .eq('company_id', ctx.companyId)
            .maybeSingle()

        if (!targetProfile) {
            throw err('NOT_FOUND', `user not in tenant: ${userId}`, {
                userMessage: 'Usuario no encontrado en este tenant.',
            })
        }

        const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)
        if (error) throw err('EXTERNAL', `auth.deleteUser: ${error.message}`, { cause: error })

        revalidatePath('/')
        return { success: true as const }
    } catch (caught) {
        return handleActionError(caught, 'deleteUser')
    }
}

/**
 * Acción llamada desde /accept-invitation cuando un invitado completa el registro.
 *
 * Valida el token, crea el usuario en auth.users con company_id en app_metadata,
 * y marca la invitación como usada.
 *
 * Esta acción NO requiere autenticación previa (es para usuarios nuevos).
 *
 * Devuelve `{ error: string }` (sin `success`) intencionalmente porque la página
 * de aceptación no usa discriminated union; usa un try/catch con redirect.
 */
export async function acceptInvitationAction(formData: FormData) {
    try {
        const token = formData.get('token') as string
        const password = formData.get('password') as string
        const fullName = formData.get('full_name') as string

        if (!token || !password || !fullName) {
            return { error: 'Todos los campos son obligatorios.' }
        }

        // 1. Validar token
        const { data: rpcData, error: rpcError } = await supabaseAdmin
            .rpc('accept_invitation', { p_token: token })

        if (rpcError) {
            warnSilently('acceptInvitationAction.accept_invitation', rpcError)
            return { error: 'Invitación inválida o expirada.' }
        }
        const invitation = rpcData as {
            success: boolean
            error?: string
            email?: string
            company_id?: string
            role?: string
        }

        if (!invitation.success || !invitation.email || !invitation.company_id) {
            return { error: invitation.error || 'Invitación inválida.' }
        }

        // 1b. FASE 11 (Bloque C — Commit 3): resolver la sucursal de la
        //     invitación. La sucursal vive en `invitations.branch_id`
        //     (migración 11.8); para invitaciones legacy sin branch_id,
        //     se hace fallback a la sucursal MAIN de la empresa.
        //
        //     Hacemos un SELECT directo a la fila de la invitación porque
        //     la RPC `accept_invitation` no devuelve branch_id (Fase 4).
        //     El token ya está validado por la RPC, así que el SELECT
        //     es seguro.
        const { data: invitationRow, error: invReadError } = await supabaseAdmin
            .from('invitations')
            .select('id, branch_id')
            .eq('token', token)
            .maybeSingle()

        if (invReadError) {
            warnSilently('acceptInvitationAction.invitationsRead', invReadError)
            return { error: 'No se pudo leer la invitación.' }
        }

        let targetBranchId: string | null = invitationRow?.branch_id ?? null

        if (!targetBranchId) {
            // Fallback (invitaciones legacy pre-11.8): MAIN de la empresa.
            const { data: mainBranch, error: mainError } = await supabaseAdmin
                .from('branches')
                .select('id, active')
                .eq('company_id', invitation.company_id)
                .eq('is_main', true)
                .maybeSingle()

            if (mainError) {
                warnSilently('acceptInvitationAction.mainBranch', mainError)
                return { error: 'No se pudo resolver la sucursal principal.' }
            }
            if (!mainBranch) {
                return { error: 'La empresa no tiene sucursal principal configurada.' }
            }
            if (!mainBranch.active) {
                return { error: 'La sucursal principal está desactivada. Contactá al administrador.' }
            }
            targetBranchId = mainBranch.id
        }

        // 2. Crear usuario en auth.users con company_id en app_metadata.
        //    Se setea branch_id en app_metadata también para que el JWT
        //    emitido por Supabase tras createUser ya incluya el claim.
        const { data, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email: invitation.email,
            password,
            user_metadata: { full_name: fullName },
            app_metadata: {
                company_id: invitation.company_id,
                role: invitation.role,
                branch_id: targetBranchId,
            },
            email_confirm: true,
        })

        if (createError) {
            warnSilently('acceptInvitationAction.createUser', createError)
            return { error: 'No se pudo crear el usuario. Intentá nuevamente.' }
        }
        if (!data.user) return { error: 'No se pudo crear el usuario.' }

        // 3. Crear la membresía del usuario en la empresa (Fase 10).
        //    Sin esta fila, el RLS por membresía no le concede acceso.
        //
        //    ANTES de insertar con `is_default = true`, limpiar el default
        //    actual del usuario (si existe en otra empresa). El índice único
        //    parcial `uniq_membership_default_per_user` rechaza dos filas
        //    con is_default=true para el mismo user_id — sin el clear previo,
        //    un usuario que ya tenía membresía default en otra empresa
        //    quedaría sin membresía en esta nueva empresa (23505 silencioso).
        //
        //    Mismo patrón que `setDefaultMembership` (lib/supabase/membership-queries).
        const { error: clearDefaultError } = await supabaseAdmin
            .from('company_memberships')
            .update({ is_default: false })
            .eq('user_id', data.user.id)
            .eq('is_default', true)

        if (clearDefaultError) {
            // No bloqueamos el flujo: si el clear falla por algún motivo, el
            // insert siguiente capturará el 23505 y lo manejaremos como abajo.
            warnSilently('acceptInvitationAction.clearDefault', clearDefaultError)
        }

        const { error: memberError } = await supabaseAdmin
            .from('company_memberships')
            .insert({
                user_id: data.user.id,
                company_id: invitation.company_id,
                role: invitation.role ?? 'manager',
                is_default: true,
            })

        if (memberError) {
            // Si la membresía ya existe (re-aceptación de invitación), no fallar.
            if (memberError.code !== '23505') {
                warnSilently('acceptInvitationAction.membership', memberError)
            }
        }

        // 3b. FASE 11 (Bloque C — Commit 3): crear 1 branch_membership con
        //     is_default=true para la sucursal resuelta arriba.
        //
        //     Antes de esta versión, el flujo aceptaba un CSV de branch_ids
        //     desde el form (`formData.get('branch_ids')`), lo que obligaba a
        //     la página de aceptación a tener un selector multi-sucursal. Con
        //     el campo `invitations.branch_id` (migración 11.8), la sucursal
        //     vive en la invitación y se crea exactamente 1 branch_membership
        //     con is_default=true.
        //
        //     Reglas:
        //       - branch_id viene de `invitations.branch_id` (o fallback a
        //         MAIN si la invitación no lo trae, p.ej. legacy).
        //       - role se hereda de la company_membership (mismo role que la
        //         invitación).
        //       - Limpiar defaults anteriores antes del insert (defense: por
        //         si el usuario ya tenía otra branch_membership default).
        await supabaseAdmin
            .from('branch_memberships')
            .update({ is_default: false })
            .eq('user_id', data.user.id)
            .eq('is_default', true)

        const { error: bmError } = await supabaseAdmin
            .from('branch_memberships')
            .insert({
                user_id: data.user.id,
                company_id: invitation.company_id,
                branch_id: targetBranchId,
                role: invitation.role ?? 'manager',
                is_default: true,
            })

        if (bmError) {
            // Si falla por duplicado (caso: re-aceptación), no bloqueamos.
            if (bmError.code !== '23505') {
                warnSilently('acceptInvitationAction.branchMembership', bmError)
            }
        }

        // 4. Marcar invitación como usada
        await supabaseAdmin
            .from('invitations')
            .update({
                used_at: new Date().toISOString(),
                accepted_user_id: data.user.id,
            })
            .eq('token', token)

        return { success: true }
    } catch (err: any) {
        warnSilently('acceptInvitationAction', err)
        return { error: err?.message || 'Error al aceptar la invitación.' }
    }
}