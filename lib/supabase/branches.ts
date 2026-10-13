/**
 * Tipos compartidos para multi-sucursal (Fase 11).
 *
 * Una empresa puede tener N sucursales (modelo "sub-tenants"). Las
 * sucursales comparten catálogo (products, customers, suppliers) pero
 * tienen stock, ventas y operaciones propias (`branch_id` en tablas
 * operativas).
 *
 * `Branch` es la fila base; `BranchMembership` une (user, branch, role)
 * análoga a `CompanyMembership` de Fase 10.
 */

import type { UserRole } from './memberships'

export interface Branch {
    id: string
    company_id: string
    code: string
    name: string
    address: string | null
    phone: string | null
    is_main: boolean
    active: boolean
    created_at: string
}

export interface BranchMembership {
    user_id: string
    company_id: string
    branch_id: string
    role: UserRole
    is_default: boolean
    created_at: string
    /** Sucursal anidada cuando se hace join con `branches`. */
    branches?: Branch | null
}