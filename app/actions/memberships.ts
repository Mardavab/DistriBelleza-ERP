'use server'

import { createClient } from '../../lib/supabase/server'
import { supabaseAdmin } from '../../lib/supabase'
import { revalidatePath } from 'next/cache'
import { getUserMemberships, setDefaultMembership, isPlatformUser } from '../../lib/supabase/membership-queries'
import { requireRole } from '../../lib/supabase/auth-helpers'
import { audit } from '../../lib/audit'
import { handleActionError, err } from '../../lib/errors'

/**
 * Cambia la empresa activa del usuario.
 *
 * FASE 10.3:
 *   1. Valida que el usuario tenga membresía en la empresa destino.
 *   2. Actualiza `app_metadata.company_id` + `app_metadata.role` en auth.users
 *      (esto propaga al JWT en el próximo refresh).
 *   3. Marca la nueva membresía como `is_default = true` para que la UI
 *      sepa cuál es la activa tras login.
 *   4. Revalida `/` para que el sidebar recargue con la nueva empresa.
 *
 * Restricciones:
 *   - No permite cambiar a técnicos de plataforma (no tienen membresías).
 *   - No permite cambiar a una empresa donde el usuario no sea miembro.
 *
 * Importante sobre el JWT: el cambio en `app_metadata` se ve cuando el
 * cliente llama a `supabase.auth.refreshSession()` o cuando vence el token.
 * Forzamos un redirect a `/` para que el siguiente render obtenga el JWT
 * fresco con el nuevo `company_id`.
 */
export async function switchActiveCompanyAction(companyId: string) {
    try {
        const ctx = await requireRole(['owner', 'manager'])
        const supabase = createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            throw err('UNAUTHENTICATED', 'No hay sesión activa')
        }

        if (!companyId) {
            throw err('VALIDATION', 'Falta companyId', {
                userMessage: 'Empresa inválida.',
            })
        }

        // 1. Verificar que el usuario tiene membresía en la empresa destino.
        const memberships = await getUserMemberships(user.id)
        const target = memberships.find((m) => m.company_id === companyId)

        if (!target) {
            throw err('FORBIDDEN', `user ${user.id} sin membresía en ${companyId}`, {
                userMessage: 'No pertenecés a esa empresa.',
            })
        }

        // 2. Actualizar app_metadata en auth.users.
        //    Esto NO invalida el JWT actual, pero al próximo refresh (en el
        //    redirect que hacemos abajo) el cliente recibirá los nuevos claims.
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
            user.id,
            {
                app_metadata: {
                    company_id: companyId,
                    role: target.role,
                    // Espejo de profiles.is_platform_admin para que el middleware
                    // enrute por rol sin consultar la BD. Se escribe explícito
                    // porque updateUserById reemplaza app_metadata.
                    is_platform_admin: await isPlatformUser(user.id),
                },
            }
        )

        if (updateError) {
            throw err('EXTERNAL', `auth.updateUserById: ${updateError.message}`, {
                cause: updateError,
            })
        }

        // 3. Marcar la membresía como default (para persistencia tras re-login).
        await setDefaultMembership(user.id, companyId)

        // 4. Refrescar la sesión en el cliente actual y revalidar.
        //    `refreshSession()` reemite el JWT con los nuevos claims de
        //    app_metadata, así que el render siguiente ya ve company_id nuevo.
        await supabase.auth.refreshSession()

        await audit(ctx, 'switchActiveCompanyAction', 'membership', {
          companyId,
          entityId: companyId,
          payload: { switched_to: companyId, role: target.role },
        });

        revalidatePath('/', 'layout')
        return { success: true as const, companyId, role: target.role }
    } catch (caught) {
        return handleActionError(caught, 'switchActiveCompanyAction')
    }
}
