import { createClient } from './supabase/server'
import { supabaseAdmin } from './supabase'

export interface CompanySettings {
    commission_threshold: number
    commission_rate: number
    default_customer_options: string[]
    receipt_header: string
    receipt_footer: string
    pdf_header_text: string
    pdf_footer_text: string
}

export interface CompanyData {
    id: string
    slug: string
    legal_name: string
    trade_name: string | null
    tax_id: string | null
    address: string | null
    phone: string | null
    email: string | null
    logo_url: string | null
    currency: string
    timezone: string
    active: boolean
    settings: CompanySettings
}

const DEFAULT_SETTINGS: CompanySettings = {
    commission_threshold: 1800000,
    commission_rate: 0.012,
    default_customer_options: ['Norby', 'Marlon', 'Otros'],
    receipt_header: 'DISTRIBELLEZA\nProductos de Belleza',
    receipt_footer: 'Gracias por su compra',
    pdf_header_text: 'DISTRIBELLEZA',
    pdf_footer_text: 'DistriBelleza ERP - Reporte generado automáticamente.',
}

/**
 * Carga los datos del tenant actual + sus settings.
 *
 * Usa supabaseAdmin para bypass RLS (es una lectura de sistema,
 * no una operación del usuario). Filtra por company_id del JWT
 * para mantener el aislamiento.
 *
 * Retorna null si no hay sesión, sin company_id, o si el tenant
 * no existe / está inactivo.
 */
export async function getCurrentCompany(): Promise<CompanyData | null> {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) return null

    const companyId = user.app_metadata?.company_id as string | undefined
    if (!companyId) return null

    const { data: company, error: companyError } = await supabaseAdmin
        .from('companies')
        .select('*')
        .eq('id', companyId)
        .single()

    if (companyError || !company) return null

    const { data: settingsRows } = await supabaseAdmin
        .from('company_settings')
        .select('key, value')
        .eq('company_id', companyId)

    const map: Record<string, any> = {}
    for (const row of settingsRows ?? []) {
        map[row.key] = row.value
    }

    return {
        id: company.id,
        slug: company.slug,
        legal_name: company.legal_name,
        trade_name: company.trade_name,
        tax_id: company.tax_id,
        address: company.address,
        phone: company.phone,
        email: company.email,
        logo_url: company.logo_url,
        currency: company.currency ?? 'COP',
        timezone: company.timezone ?? 'America/Bogota',
        active: company.active,
        settings: {
            commission_threshold: Number(map.commission_threshold ?? DEFAULT_SETTINGS.commission_threshold),
            commission_rate: Number(map.commission_rate ?? DEFAULT_SETTINGS.commission_rate),
            default_customer_options: map.default_customer_options ?? DEFAULT_SETTINGS.default_customer_options,
            receipt_header: map.receipt_header ?? DEFAULT_SETTINGS.receipt_header,
            receipt_footer: map.receipt_footer ?? DEFAULT_SETTINGS.receipt_footer,
            pdf_header_text: map.pdf_header_text ?? DEFAULT_SETTINGS.pdf_header_text,
            pdf_footer_text: map.pdf_footer_text ?? DEFAULT_SETTINGS.pdf_footer_text,
        },
    }
}

/**
 * Versión silenciosa: devuelve null en vez de throw.
 */
export async function getCurrentCompanySafe(): Promise<CompanyData | null> {
    try {
        return await getCurrentCompany()
    } catch (err) {
        console.error('[getCurrentCompanySafe]', err)
        return null
    }
}