/**
 * Tipos de la consola de plataforma (platform-admin).
 *
 * Se separan de `actions/platform.ts` para que la capa de acciones no sea la
 * dueña de tipos que consume la UI. Viven en el módulo porque solo lo usan
 * sus propios componentes.
 */

export type HealthStatus = 'ok' | 'warn' | 'error'

export interface HealthCheck {
    id: string
    label: string
    status: HealthStatus
    detail: string
    meta?: string
}

export interface CompanyActivity {
    id: string
    slug: string
    trade_name: string | null
    legal_name: string
    active: boolean
    deactivation_reason: string | null
    deactivated_at: string | null
    created_at: string
    user_count: number
    last_sale_at: string | null
    sales_total: number
}
