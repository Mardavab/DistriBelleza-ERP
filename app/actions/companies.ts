'use server'

import { supabaseAdmin } from '../../lib/supabase'
import { requirePlatformRole } from '../../lib/supabase/auth-helpers'

/**
 * Crea una nueva empresa (tenant) con su configuración inicial.
 *
 * Acceso: owner + technician (rol plataforma).
 * Crea:
 *   1. Fila en companies (con UUID aleatorio)
 *   2. Settings iniciales (commission, default_customer_options)
 *   3. Si se proporciona initialOwnerEmail, crea una invitación
 *
 * Devuelve el invitation_url para enviar al nuevo owner.
 */
export async function createCompany(payload: {
    legal_name: string
    trade_name: string
    slug: string
    tax_id?: string
    address?: string
    phone?: string
    email?: string
    currency?: string
    timezone?: string
    initialOwnerEmail?: string
}) {
    try {
        // Las cuentas de plataforma no tienen company_id: se usa
        // requirePlatformRole en lugar de requireRole.
        const ctx = await requirePlatformRole(['technician'])

        if (!payload.legal_name?.trim()) {
            return { success: false, error: 'Razón social es obligatoria.' }
        }
        if (!payload.trade_name?.trim()) {
            return { success: false, error: 'Nombre comercial es obligatorio.' }
        }
        if (!payload.slug?.trim() || !/^[a-z0-9-]+$/.test(payload.slug)) {
            return { success: false, error: 'Slug inválido (solo minúsculas, números y guiones).' }
        }

        const { data: existing } = await supabaseAdmin
            .from('companies')
            .select('id')
            .eq('slug', payload.slug)
            .maybeSingle()

        if (existing) {
            return { success: false, error: `El slug "${payload.slug}" ya existe.` }
        }

        // Intentar insertar con created_by; si la columna no existe,
        // hacer fallback sin ella.
        let company: any
        const insertPayload: any = {
            slug: payload.slug,
            legal_name: payload.legal_name.trim(),
            trade_name: payload.trade_name.trim(),
            tax_id: payload.tax_id?.trim() || null,
            address: payload.address?.trim() || null,
            phone: payload.phone?.trim() || null,
            email: payload.email?.trim() || null,
            currency: payload.currency || 'COP',
            timezone: payload.timezone || 'America/Bogota',
            active: true,
        }

        if (await checkColumnExists('companies', 'created_by')) {
            insertPayload.created_by = ctx.user.id
        }

        const { data: createdCompany, error: companyError } = await supabaseAdmin
            .from('companies')
            .insert(insertPayload)
            .select()
            .single()

        if (companyError) throw companyError
        company = createdCompany

        const defaultSettings: Array<[string, string]> = [
            ['commission_threshold', '1800000'],
            ['commission_rate', '0.012'],
            ['default_customer_options', '["Empresa", "Socios", "Otros"]'],
            ['receipt_header', `"${payload.trade_name.trim()}"`],
            ['receipt_footer', '"Gracias por su compra"'],
            ['pdf_header_text', `"${payload.trade_name.trim()}"`],
            ['pdf_footer_text', `"${payload.trade_name.trim()} ERP - Reporte generado automáticamente."`],
        ]

        for (const [key, value] of defaultSettings) {
            await supabaseAdmin
                .from('company_settings')
                .insert({
                    company_id: company.id,
                    key,
                    value,
                })
        }

        let invitation_url: string | null = null

        if (payload.initialOwnerEmail?.trim()) {
            const token = `${crypto.randomUUID()}-${Date.now().toString(36)}`
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

            const { error: invError } = await supabaseAdmin
                .from('invitations')
                .insert({
                    company_id: company.id,
                    email: payload.initialOwnerEmail.trim(),
                    role: 'owner',
                    invited_by: ctx.user.id,
                    token,
                    expires_at: expiresAt,
                })

            if (invError) throw invError

            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
            invitation_url = `${baseUrl}/accept-invitation?token=${token}`

            console.log(`[createCompany] Invitación creada para ${payload.initialOwnerEmail}: ${invitation_url}`)
        }

        return {
            success: true,
            data: {
                company_id: company.id,
                invitation_url,
            },
        }
    } catch (err: any) {
        console.error('[createCompany]', err)
        return { success: false, error: mapError(err.message) }
    }
}

/**
 * Helper: verifica si una columna existe en una tabla vía information_schema.
 */
async function checkColumnExists(table: string, column: string): Promise<boolean> {
    try {
        const { data } = await supabaseAdmin
            .from('information_schema.columns')
            .select('column_name')
            .eq('table_schema', 'public')
            .eq('table_name', table)
            .eq('column_name', column)
            .maybeSingle()

        return !!data
    } catch {
        return false
    }
}

function mapError(message: string): string {
    if (message === 'UNAUTHENTICATED') return 'No autenticado.'
    if (message === 'NO_COMPANY_CONTEXT') return 'Tu usuario no tiene empresa asignada.'
    if (message === 'NO_PROFILE') return 'Perfil de usuario no encontrado.'
    if (message.startsWith('FORBIDDEN')) return message
    return message
}