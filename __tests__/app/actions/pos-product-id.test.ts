/**
 * Tests del vínculo venta↔producto y de los parámetros de las RPCs del POS.
 *
 * Regresiones que cubren:
 *   1. `searchPOSProducts` pasa `p_search_term` (no `search_term`): antes
 *      PostgREST ignoraba el parámetro y la búsqueda no filtraba.
 *   2. `searchPOSProducts` y `getDefaultProducts` propagan `product_id`, que es
 *      lo que permite que `sale_items.product_id` deje de ser NULL.
 *   3. `processPOSSale` manda `product_id` por cada ítem del carrito.
 */

const mockRpc = jest.fn()
const mockSelect = jest.fn()
const mockFrom = jest.fn()
jest.mock('../../../lib/supabase', () => ({
    supabaseAdmin: {
        rpc: (...args: unknown[]) => mockRpc(...args),
        from: (...args: unknown[]) => mockFrom(...args),
    },
}))

const mockRequireRole = jest.fn()
const mockRequireAuthContext = jest.fn()
const mockRequireOwner = jest.fn()
jest.mock('../../../lib/supabase/auth-helpers', () => ({
    requireRole: (...args: unknown[]) => mockRequireRole(...args),
    requireAuthContext: (...args: unknown[]) => mockRequireAuthContext(...args),
    requireOwner: (...args: unknown[]) => mockRequireOwner(...args),
}))

const mockRequireBranchContext = jest.fn()
jest.mock('../../../lib/supabase/branch-context', () => ({
    requireBranchContext: (...args: unknown[]) => mockRequireBranchContext(...args),
}))

const mockGetCompanyIdForBranch = jest.fn()
jest.mock('../../../lib/supabase/branch-membership-queries', () => ({
    getCompanyIdForBranch: (...args: unknown[]) => mockGetCompanyIdForBranch(...args),
}))

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    unstable_noStore: jest.fn(),
}))

const mockCreateClient = jest.fn(() => ({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
}))
jest.mock('../../../lib/supabase/server', () => ({
    createClient: (...args: unknown[]) => mockCreateClient(...args),
}))

jest.mock('../../../lib/audit', () => ({ audit: jest.fn() }))

import { searchPOSProducts, getDefaultProducts, processPOSSale } from '../../../app/actions/sales'

const CTX = { user: { id: 'u-1' }, companyId: 'c-1', role: 'manager' }

describe('POS — parámetros y product_id', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockRequireRole.mockResolvedValue(CTX)
        mockRequireAuthContext.mockResolvedValue(CTX)
        mockRequireBranchContext.mockResolvedValue({ userId: 'u-1', branchId: 'b-1' })
        mockGetCompanyIdForBranch.mockResolvedValue('c-1')
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    describe('searchPOSProducts', () => {
        it('pasa p_search_term (y p_limit) a tenant_search_inventory', async () => {
            mockRpc.mockResolvedValue({ data: [], error: null })

            await searchPOSProducts('  labial  ')

            expect(mockRpc).toHaveBeenCalledTimes(1)
            const [name, args] = mockRpc.mock.calls[0]
            expect(name).toBe('tenant_search_inventory')
            // El parámetro es p_search_term. `search_term` era ignorado.
            expect(args).toHaveProperty('p_search_term', 'labial')
            expect(args).not.toHaveProperty('search_term')
            expect(args).toHaveProperty('p_company_id', 'c-1')
            expect(args).toHaveProperty('p_branch_id', 'b-1')
        })

        it('propaga product_id, brand y variant_name desde la RPC', async () => {
            mockRpc.mockResolvedValue({
                data: [
                    {
                        variant_id: 'v-1',
                        product_id: 'p-1',
                        product_name: 'Labial Mate',
                        variant_name: 'Rojo Pasión',
                        brand: 'Glow',
                        sku: 'SKU-1',
                        barcode: null,
                        stock: 5,
                        price: 32000,
                        category_name: 'Maquillaje',
                    },
                ],
                error: null,
            })

            const res = await searchPOSProducts('labial')

            expect(res).toHaveLength(1)
            expect(res[0]).toMatchObject({
                variant_id: 'v-1',
                product_id: 'p-1',
                product_name: 'Labial Mate',
                variant_name: 'Rojo Pasión',
                product_brand: 'Glow',
                sku: 'SKU-1',
                stock: 5,
                price: 32000,
            })
        })

        it('no silencia el error de la RPC: lo deja en warn y devuelve []', async () => {
            const warnSpy = jest.spyOn(console, 'warn')
            mockRpc.mockResolvedValue({
                data: null,
                error: { message: 'relation "branch_stock" does not exist' },
            })

            const res = await searchPOSProducts('labial')

            expect(res).toEqual([])
            expect(warnSpy).toHaveBeenCalled()
        })
    })

    describe('getDefaultProducts', () => {
        function stubVariants(rows: Array<Record<string, unknown>>) {
            const builder: Record<string, unknown> = {}
            builder.select = mockSelect.mockReturnValue(builder)
            builder.eq = jest.fn().mockReturnValue(builder)
            builder.gt = jest.fn().mockReturnValue(builder)
            builder.order = jest.fn().mockReturnValue(builder)
            builder.range = jest.fn().mockResolvedValue({ data: rows, error: null, count: rows.length })
            mockFrom.mockImplementation((table: string) => {
                expect(table).toBe('product_variants')
                return builder
            })
        }

        it('propaga product_id desde el JOIN products', async () => {
            stubVariants([
                {
                    id: 'v-1',
                    sku: 'SKU-1',
                    price: 32000,
                    name: 'Rojo Pasión',
                    stock: 5,
                    updated_at: '2026-10-22',
                    products: { id: 'p-1', name: 'Labial Mate', brand: 'Glow', price_base: 30000 },
                },
            ])

            const res = await getDefaultProducts()

            expect(res.data).toHaveLength(1)
            expect(res.data[0]).toMatchObject({
                variant_id: 'v-1',
                product_id: 'p-1',
                product_name: 'Labial Mate',
                variant_name: 'Rojo Pasión',
                product_brand: 'Glow',
            })
        })

        it('pide products.id en el select (sin él no hay product_id)', async () => {
            stubVariants([])
            await getDefaultProducts()
            expect(mockSelect).toHaveBeenCalledTimes(1)
            expect(mockSelect.mock.calls[0][0]).toContain('products!inner(id,')
        })
    })

    describe('processPOSSale', () => {
        it('envía product_id por cada ítem del carrito', async () => {
            const rpcArgs: Record<string, unknown>[] = []
            mockRpc.mockImplementation((_name: string, args: Record<string, unknown>) => {
                rpcArgs.push(args)
                return Promise.resolve({
                    data: { success: true, sale_id: 's-1', paid: 100 },
                    error: null,
                })
            })
            mockFrom.mockImplementation((table: string) => {
                const builder: Record<string, unknown> = {}
                builder.select = jest.fn().mockReturnValue(builder)
                builder.eq = jest.fn().mockReturnValue(builder)
                builder.single = jest.fn().mockResolvedValue({
                    data:
                        table === 'sales'
                            ? {
                                total_amount: 100,
                                discount_amount: 0,
                                total_with_discount: 100,
                                paid_amount: 100,
                                created_at: '2026-10-22',
                            }
                            : null,
                    error: null,
                })
                builder.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null })
                builder.then = (ok: (v: unknown) => unknown) => ok({ data: [], error: null })
                return builder
            })

            await processPOSSale(
                null,
                [
                    { variant_id: 'v-1', product_id: 'p-1', quantity: 2 },
                    { variant_id: 'v-2', product_id: 'p-2', quantity: 1 },
                ] as never,
                'CASH'
            )

            expect(rpcArgs).toHaveLength(1)
            const items = rpcArgs[0].p_items as Array<Record<string, unknown>>
            expect(items).toHaveLength(2)
            expect(items[0]).toMatchObject({ variant_id: 'v-1', product_id: 'p-1', quantity: 2 })
            expect(items[1]).toMatchObject({ variant_id: 'v-2', product_id: 'p-2', quantity: 1 })
        })
    })
})
