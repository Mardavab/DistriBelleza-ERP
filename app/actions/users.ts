'use server'

import { supabaseAdmin } from '../../lib/supabase'
import { revalidatePath } from 'next/cache'
import { requireAuthContext, requireOwner } from '../../lib/supabase/auth-helpers'

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

        if (error) throw error
        return { success: true, data: profiles }
    } catch (err: any) {
        return { success: false, error: mapAuthError(err.message) }
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
                return {
                    success: false,
                    error: 'Ya existe una invitación pendiente para este email.'
                }
            }
            throw invError
        }

        // Construir URL de invitación
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        const inviteUrl = `${baseUrl}/accept-invitation?token=${token}`

        // TODO: enviar email con el link de invitación
        // await sendInvitationEmail(payload.email, inviteUrl)
        console.log(`[createUser] Invitación creada para ${payload.email}: ${inviteUrl}`)

        revalidatePath('/')
        return { success: true, invitation_url: inviteUrl }
    } catch (err: any) {
        return { success: false, error: mapAuthError(err.message) }
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
            return { success: false, error: 'Usuario no encontrado en este tenant.' }
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
            if (error) throw error
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
        if (authError) throw authError

        revalidatePath('/')
        return { success: true }
    } catch (err: any) {
        return { success: false, error: mapAuthError(err.message) }
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
            return { success: false, error: 'No puedes eliminarte a ti mismo.' }
        }

        // Validar que pertenece al tenant
        const { data: targetProfile } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('id', userId)
            .eq('company_id', ctx.companyId)
            .maybeSingle()

        if (!targetProfile) {
            return { success: false, error: 'Usuario no encontrado en este tenant.' }
        }

        const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)
        if (error) throw error

        revalidatePath('/')
        return { success: true }
    } catch (err: any) {
        return { success: false, error: mapAuthError(err.message) }
    }
}

/**
 * Acción llamada desde /accept-invitation cuando un invitado completa el registro.
 *
 * Valida el token, crea el usuario en auth.users con company_id en app_metadata,
 * y marca la invitación como usada.
 *
 * Esta acción NO requiere autenticación previa (es para usuarios nuevos).
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

        if (rpcError) throw rpcError
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

        if (createError) throw createError
        if (!data.user) throw new Error('No se pudo crear el usuario.')

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
        console.error('[acceptInvitationAction]', err)
        return { error: err.message || 'Error al aceptar la invitación.' }
    }
}

/**
 * Mapea errores de auth-helpers a mensajes legibles.
 */
function mapAuthError(message: string): string {
    if (message === 'UNAUTHENTICATED') return 'No autenticado.'
    if (message === 'NO_COMPANY_CONTEXT') return 'Usuario sin empresa asignada.'
    if (message === 'NO_PROFILE') return 'Perfil de usuario no encontrado.'
    if (message.startsWith('FORBIDDEN')) return message
    return message
}