/**
 * Tests del modelo de roles de 3 niveles aplicado a las server actions.
 *
 * Verifica que cada tier de ruta tenga la guardia que le corresponde:
 *
 *   owner      → requireAuthContext() + requireOwner(ctx.role)
 *   manager    → requireRole(['owner', 'manager'])
 *   technician → requirePlatformRole(['technician'])
 *
 * Se cubren acciones representativas de cada tier. La lista completa vive en
 * AGENTS.md §5; lo que se protege aquí es el PATRÓN, no cada función.
 */

const mockRequireAuthContext = jest.fn()
const mockRequireOwner = jest.fn()
const mockRequireRole = jest.fn()
const mockRequirePlatformRole = jest.fn()
jest.mock('../../../lib/supabase/auth-helpers', () => ({
    requireAuthContext: (...args: unknown[]) => mockRequireAuthContext(...args),
    requireOwner: (...args: unknown[]) => mockRequireOwner(...args),
    requireRole: (...args: unknown[]) => mockRequireRole(...args),
    requirePlatformRole: (...args: unknown[]) => mockRequirePlatformRole(...args),
}))

const mockRequireBranchContext = jest.fn()
jest.mock('../../../lib/supabase/branch-context', () => ({
    requireBranchContext: (...args: unknown[]) => mockRequireBranchContext(...args),
}))

const mockGetCurrentCompanyId = jest.fn()
jest.mock('../../../lib/supabase/company-context', () => ({
    getCurrentCompanyId: (...args: unknown[]) => mockGetCurrentCompanyId(...args),
}))

const mockFrom = jest.fn()
jest.mock('../../../lib/supabase', () => ({
    supabaseAdmin: { from: mockFrom },
}))

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))

import { getInventory, deleteProduct } from '../../../app/actions/inventory_actions'
import { deleteSupplier } from '../../../app/actions/suppliers'
import { getMajorExpenses } from '../../../modules/major-expenses/actions/major_expenses'
import { listBranchesAction } from '../../../app/actions/branches'
import { createCompany } from '../../../modules/platform-admin/actions/companies'

const MANAGER_CTX = {
    user: { id: 'mgr-1' },
    companyId: 'c-1',
    role: 'manager',
}
const OWNER_CTX = {
    user: { id: 'own-1' },
    companyId: 'c-1',
    role: 'owner',
}
const TECH_CTX = {
    user: { id: 'tech-1' },
    companyId: '',
    role: 'technician',
}

function stubQueries() {
    mockFrom.mockImplementation(() => {
        const builder: Record<string, unknown> = {}
        builder.select = jest.fn().mockReturnValue(builder)
        builder.insert = jest.fn().mockReturnValue(builder)
        builder.update = jest.fn().mockReturnValue(builder)
        builder.delete = jest.fn().mockReturnValue(builder)
        builder.eq = jest.fn().mockReturnValue(builder)
        builder.in = jest.fn().mockReturnValue(builder)
        builder.order = jest.fn().mockReturnValue(builder)
        builder.limit = jest.fn().mockResolvedValue({ data: [], error: null })
        builder.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null })
        builder.single = jest.fn().mockResolvedValue({ data: null, error: null })
        ;(builder as { then?: unknown }).then = (ok: (v: unknown) => unknown) =>
            ok({ data: [], error: null })
        return builder
    })
}

describe('modelo de roles — nivel manager (requireRole)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        stubQueries()
        mockRequireRole.mockResolvedValue(MANAGER_CTX)
        mockRequireBranchContext.mockResolvedValue({ userId: 'mgr-1', branchId: 'b-1' })
        mockGetCurrentCompanyId.mockResolvedValue('c-1')
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    it('getInventory acepta un manager usando requireRole', async () => {
        await getInventory()

        expect(mockRequireRole).toHaveBeenCalledWith(['owner', 'manager'])
        expect(mockRequireOwner).not.toHaveBeenCalled()
    })

    it('deleteProduct acepta un manager (control total de Inventario)', async () => {
        await deleteProduct('prod-1')

        expect(mockRequireRole).toHaveBeenCalledWith(['owner', 'manager'])
    })
})

describe('modelo de roles — nivel owner (requireOwner)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        stubQueries()
        mockRequireAuthContext.mockResolvedValue(OWNER_CTX)
        mockRequireOwner.mockImplementation((role: string) => {
            if (role !== 'owner') throw new Error('FORBIDDEN')
        })
        mockRequireRole.mockRejectedValue(new Error('FORBIDDEN: requireRole no debe usarse aquí'))
        mockRequireBranchContext.mockResolvedValue({ userId: 'own-1', branchId: 'b-1' })
        mockGetCurrentCompanyId.mockResolvedValue('c-1')
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    it('deleteSupplier exige owner', async () => {
        await deleteSupplier('sup-1')

        expect(mockRequireAuthContext).toHaveBeenCalled()
        expect(mockRequireOwner).toHaveBeenCalledWith('owner')
        expect(mockRequireRole).not.toHaveBeenCalled()
    })

    it('listBranchesAction exige owner', async () => {
        await listBranchesAction()

        expect(mockRequireOwner).toHaveBeenCalledWith('owner')
    })

    it('getMajorExpenses exige owner también en lectura', async () => {
        await getMajorExpenses()

        expect(mockRequireOwner).toHaveBeenCalledWith('owner')
    })

    it('rechaza a un manager en deleteSupplier', async () => {
        mockRequireAuthContext.mockResolvedValue(MANAGER_CTX)
        mockRequireOwner.mockImplementation(() => {
            throw new Error('FORBIDDEN: se requiere rol owner')
        })

        const result = await deleteSupplier('sup-1')

        expect(result.success).toBe(false)
        expect(mockFrom).not.toHaveBeenCalled()
    })
})

describe('modelo de roles — nivel technician (requirePlatformRole)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        stubQueries()
        mockRequirePlatformRole.mockResolvedValue(TECH_CTX)
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        jest.spyOn(console, 'log').mockImplementation(() => {})
    })

    it('createCompany exige requirePlatformRole, no requireAuthContext', async () => {
        mockRequirePlatformRole.mockRejectedValue(new Error('FORBIDDEN'))

        const result = await createCompany({
            legal_name: 'ACME',
            trade_name: 'ACME',
            slug: 'acme',
        })

        expect(mockRequirePlatformRole).toHaveBeenCalledWith(['technician'])
        expect(mockRequireAuthContext).not.toHaveBeenCalled()
        expect(mockRequireOwner).not.toHaveBeenCalled()
        expect(result.success).toBe(false)
    })
})
