'use server'

import { supabaseAdmin } from '../../lib/supabase'
import { revalidatePath } from 'next/cache'
import { requireAuthContext, requireOwner } from '../../lib/supabase/auth-helpers'
import { handleActionError, err, warnSilently } from '../../lib/errors'

/**
 * Lista todos los usuarios del tenant actual.
 *
 * FASE 4: usa requireAuthContext() — solo accesible para usuarios autenticados.
 * Filtra por company_id para aislamiento multi-tenant.
 */
export async function getUsers() {
    try {
        const ctx = await requireAuthContext()

        const { data: profiles, error } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('company_id', ctx.companyId)
            .order('created_at', { ascending: false })

        if (error) throw err('EXTERNAL', `profiles.list: ${error.message}`, { cause: error })
        return { success: true as const, data: profiles }
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
 */
export async function createUser(payload: {
    email: string
    full_name: string
    role: string
}) {
    try {
        const ctx = await requireAuthContext()
        requireOwner(ctx.role)

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

        // 2. Actualizar profile (full_name, role)
        const profileUpdates: any = {}
        if (updates.full_name) profileUpdates.full_name = updates.full_name
        if (updates.role) profileUpdates.role = updates.role

        if (Object.keys(profileUpdates).length > 0) {
            const { error } = await supabaseAdmin
                .from('profiles')
                .update(profileUpdates)
                .eq('id', userId)
            if (error) throw err('EXTERNAL', `profiles.update: ${error.message}`, { cause: error })
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

        // 2. Crear usuario en auth.users con company_id en app_metadata
        const { data, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email: invitation.email,
            password,
            user_metadata: { full_name: fullName },
            app_metadata: {
                company_id: invitation.company_id,
                role: invitation.role,
            },
            email_confirm: true,
        })

        if (createError) {
            warnSilently('acceptInvitationAction.createUser', createError)
            return { error: 'No se pudo crear el usuario. Intentá nuevamente.' }
        }
        if (!data.user) return { error: 'No se pudo crear el usuario.' }

        // 3. Marcar invitación como usada
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