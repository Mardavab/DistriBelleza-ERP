'use server'

import { getCurrentCompany } from '../../lib/company'
import { requireRole } from '../../lib/supabase/auth-helpers'

/**
 * Devuelve las opciones configuradas para el campo "billed_to"
 * (A nombre de quién) del tenant actual.
 *
 * Antes había valores hardcoded ('Norby', 'Marlon', 'Otros').
 * Ahora se lee de company_settings.default_customer_options.
 */
export async function getBilledToOptions(): Promise<string[]> {
    await requireRole(['owner', 'manager'])
    const company = await getCurrentCompany();
    return company?.settings.default_customer_options ?? ['Norby', 'Marlon', 'Otros'];
}