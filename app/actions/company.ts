'use server'

import { getCurrentCompany } from '../../lib/company'
import { getCurrentCompanyId as _getCurrentCompanyId } from '../../lib/supabase/company-context'
import { requireRole } from '../../lib/supabase/auth-helpers'
import { handleActionError, isAppError } from '../../lib/errors'

/**
 * Server action que devuelve los datos del tenant actual.
 *
 * Wrapper porque `getCurrentCompany` usa APIs de Next.js (cookies)
 * que no funcionan en Client Components. Esta action SÍ funciona
 * desde cualquier componente (servidor o cliente).
 */
export async function getCurrentCompanyAction() {
    await requireRole(['owner', 'manager'])
    return getCurrentCompany()
}

/**
 * Server action que devuelve solo el company_id del usuario actual.
 * Wrapper porque `getCurrentCompanyId` usa `cookies()` que es server-only.
 *
 * Errores de autenticación/contexto se silencian (devuelve null) porque
 * la página de login no tiene company_id y debe renderizar de todas formas.
 */
export async function getCurrentCompanyIdAction(): Promise<string | null> {
    try {
        await requireRole(['owner', 'manager'])
        return await _getCurrentCompanyId()
    } catch (caught) {
        if (isAppError(caught) && (caught.code === 'UNAUTHENTICATED' || caught.code === 'NO_COMPANY_CONTEXT')) {
            return null;
        }
        handleActionError(caught, 'getCurrentCompanyIdAction');
        return null;
    }
}

/**
 * Branding para reportes PDF (encabezado + pie de página).
 * Devuelve defaults sensatos si el tenant no tiene settings personalizados.
 */
export async function getPdfBrandingAction(): Promise<{
    header: string
    footer: string
    trade_name: string
}> {
    await requireRole(['owner', 'manager'])
    const company = await getCurrentCompany()
    const tradeName = company?.trade_name || company?.legal_name || 'ERP'

    return {
        header: company?.settings.pdf_header_text ?? tradeName,
        footer: company?.settings.pdf_footer_text
            ?? `${tradeName} ERP - Reporte generado automáticamente.`,
        trade_name: tradeName,
    }
}