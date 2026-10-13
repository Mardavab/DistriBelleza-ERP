/**
 * Tipos compartidos para multi-tenancy (Fase 10).
 *
 * `company_memberships` es la fuente de verdad para la membresía de un
 * usuario. Un usuario puede tener varias membresías (una por empresa) y
 * cada una tiene su propio rol.
 */

export type UserRole = 'owner' | 'manager' | 'technician' | string

export interface CompanyMembership {
    user_id: string
    company_id: string
    role: UserRole
    is_default: boolean
    created_at: string
    /** Empresa anidada cuando se hace join con `companies`. */
    companies?: {
        id: string
        slug: string
        legal_name: string
        trade_name: string | null
        logo_url?: string | null
        active?: boolean
    } | null
}

export interface AuthContext {
    user: {
        id: string
        email?: string | null
        app_metadata?: Record<string, any>
        user_metadata?: Record<string, any>
    }
    companyId: string
    role: UserRole
    membership: CompanyMembership
}
