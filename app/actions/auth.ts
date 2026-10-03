'use server'

import { createClient } from '../../lib/supabase/server'
import { supabaseAdmin } from '../../lib/supabase'
import { redirect } from 'next/navigation'

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

    const companyId = authData.user.app_metadata?.company_id as string | undefined

    if (!companyId) {
        await supabase.auth.signOut()
        return {
            error: 'Usuario sin empresa asignada. Contacta al administrador para recibir una invitación.'
        }
    }

    const { data: company, error: companyError } = await supabaseAdmin
        .from('companies')
        .select('id, slug, active')
        .eq('id', companyId)
        .single()

    if (companyError || !company) {
        await supabase.auth.signOut()
        console.error(`[login] Empresa ${companyId} no encontrada:`, companyError?.message)
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

/**
 * Obtiene el perfil del usuario autenticado con su company.
 *
 * FASE 4 - versión robusta con logging.
 */
export async function getUserProfile() {
    const supabase = createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        console.warn('[getUserProfile] No user:', authError?.message)
        return null
    }

    const companyId = user.app_metadata?.company_id as string | undefined
    if (!companyId) {
        console.warn(`[getUserProfile] Usuario ${user.id} sin company_id en app_metadata`)
        return null
    }

    // Usamos supabaseAdmin para evitar problemas con RLS o joins.
    // Dividimos en dos queries (profile + company) en lugar de un join,
    // porque PostgREST puede tener problemas con FKs nombrados custom
    // (como 'fk_profiles_company').
    const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

    if (profileError) {
        console.error(`[getUserProfile] Error leyendo profile:`, profileError.message)
        return null
    }

    if (!profile) {
        console.warn(`[getUserProfile] Usuario ${user.id} no tiene fila en profiles`)
        return null
    }

    // Leer la empresa
    const { data: company } = await supabaseAdmin
        .from('companies')
        .select('id, slug, trade_name, currency, timezone')
        .eq('id', companyId)
        .maybeSingle()

    return {
        ...profile,
        companies: company,
    }
}