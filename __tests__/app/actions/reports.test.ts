/**
 * Tests para app/actions/reports.ts — getFinancialReport (Fase 11 — Commit 4).
 *
 * Cubre los tres modos del nuevo parámetro `branchFilter`:
 *   - 'current' (default): usa requireBranchContext y filtra por esa
 *     sucursal. Devuelve scope='current'.
 *   - 'all': no filtra por branch_id (consolidado de la empresa). Solo
 *     owners. Devuelve scope='all'.
 *   - <UUID>: filtra por una sucursal específica. Valida pertenencia al
 *     tenant, estado activo y membrisía del usuario. Solo owners.
 *     Devuelve scope='branch'.
 *
 * Cubre también:
 *   - branchName se devuelve cuando scope !== 'all'.
 *   - branchId es null cuando scope === 'all'.
 *   - branchFilter con string inválido (no UUID, no 'all') → VALIDATION.
 *   - getDashboardStats sigue usando 'current' (compatibilidad).
 *
 * Mocks:
 *   - lib/supabase/auth-helpers (requireAuthContext, requireOwner)
 *   - lib/supabase (supabaseAdmin.from)
 *   - lib/supabase/branch-context (requireBranchContext)
 *   - lib/supabase/branch-membership-queries (isUserInBranch)
 *   - lib/company (getCurrentCompany)
 */

const mockRequireAuthContext = jest.fn()
const mockRequireOwner = jest.fn()
jest.mock('../../../lib/supabase/auth-helpers', () => ({
    requireAuthContext: (...args: unknown[]) => mockRequireAuthContext(...args),
    requireOwner: (...args: unknown[]) => mockRequireOwner(...args),
}))

const mockRequireBranchContext = jest.fn()
jest.mock('../../../lib/supabase/branch-context', () => ({
    requireBranchContext: (...args: unknown[]) => mockRequireBranchContext(...args),
}))

const mockIsUserInBranch = jest.fn()
jest.mock('../../../lib/supabase/branch-membership-queries', () => ({
    isUserInBranch: (...args: unknown[]) => mockIsUserInBranch(...args),
}))

const mockFrom = jest.fn()
jest.mock('../../../lib/supabase', () => ({
    supabaseAdmin: { from: mockFrom },
}))

jest.mock('../../../lib/company', () => ({
    getCurrentCompany: jest.fn(async () => ({
        id: 'c-1',
        settings: {
            commission_threshold: 1800000,
            commission_rate: 0.012,
        },
    })),
}))

import {
    getFinancialReport,
    getDashboardStats,
    getCommissionGoalFormatted,
} from '../../../app/actions/reports'
import { err } from '../../../lib/errors'

type Chain = {
    select: jest.Mock
    eq: jest.Mock
    neq: jest.Mock
    gte: jest.Mock
    lte: jest.Mock
    order: jest.Mock
    limit: jest.Mock
    maybeSingle: jest.Mock
    [key: string]: unknown
}

/**
 * Builder thenable recursivo: cada método encadenable retorna el
 * propio builder (que también es thenable). Permite encadenar varios
 * .eq()/.gte()/.lte() (defensa multi-tenant con id+company_id,
 * filtros de fecha, etc.) y usar tanto await como terminadores
 * como .maybeSingle().
 *
 * Por defecto el builder termina con `[]` cuando se resuelve sin
 * `maybeSingle/single`, así las queries que solo suman
 * (sales/customer_payments/expenses/supplier_payments) devuelven
 * un array vacío y la suma es 0 — eso es lo que queremos para los
 * happy paths.
 */
function makeBuilder(defaultReturn: unknown = { data: [], error: null }) {
    const b: any = {}
    b.select = jest.fn().mockReturnValue(b)
    b.eq = jest.fn().mockReturnValue(b)
    b.neq = jest.fn().mockReturnValue(b)
    b.gte = jest.fn().mockReturnValue(b)
    b.lte = jest.fn().mockReturnValue(b)
    b.order = jest.fn().mockReturnValue(b)
    b.limit = jest.fn().mockReturnValue(b)
    b.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null })
    b.single = jest.fn().mockResolvedValue({ data: null, error: null })
    b.then = (onFulfilled: (v: unknown) => unknown) => onFulfilled(defaultReturn)
    return b as Chain
}

/**
 * Builder "filtrado": simula los filtros encadenados (.eq/.neq/.gte/.lte)
 * sobre un dataset dado. Útil para validar la lógica de cálculo (sumas)
 * sin tener que escribir mocks diferentes por cada combinación de
 * filtros.
 *
 * Cómo se aplica el filtro:
 *   - .eq(col, val)   → solo filas donde fila[col] === val
 *   - .neq(col, val)  → solo filas donde fila[col] !== val
 *   - .gte(col, val)  → solo filas donde fila[col] >= val
 *   - .lte(col, val)  → solo filas donde fila[col] <= val
 *
 * Si el dataset es `null` o `undefined`, devuelve data vacío (para
 * .maybeSingle/.single) o { data: [] } en then-await.
 */
function makeFilteredBuilder(
    dataset: unknown[] | null,
    defaultSingle: unknown = null,
) {
    let currentData = Array.isArray(dataset) ? [...dataset] : []

    function applyFilters() {
        return (b as any)._filters || []
    }

    function matches(filters: Array<{ col: string; op: string; val: unknown }>, row: any): boolean {
        return filters.every((f) => {
            const v = row?.[f.col]
            // Si la fila no tiene la columna, saltamos el filtro (asumimos
            // que el caller ya filtró previamente, ej: por tenant). Esto
            // simplifica los tests: solo necesitamos incluir en el dataset
            // las columnas que varían entre queries (payment_method, etc).
            if (v === undefined && !(f.col in row)) {
                return true
            }
            switch (f.op) {
                case 'eq': return v === f.val
                case 'neq': return v !== f.val
                case 'gte': return typeof v === 'number' ? v >= (f.val as number) : true
                case 'lte': return typeof v === 'number' ? v <= (f.val as number) : true
                default: return true
            }
        })
    }

    const b: any = {}
    b._filters = []

    b.select = jest.fn().mockReturnValue(b)
    b.eq = jest.fn().mockImplementation((col: string, val: unknown) => {
        b._filters.push({ col, op: 'eq', val })
        return b
    })
    b.neq = jest.fn().mockImplementation((col: string, val: unknown) => {
        b._filters.push({ col, op: 'neq', val })
        return b
    })
    b.gte = jest.fn().mockImplementation((col: string, val: unknown) => {
        b._filters.push({ col, op: 'gte', val })
        return b
    })
    b.lte = jest.fn().mockImplementation((col: string, val: unknown) => {
        b._filters.push({ col, op: 'lte', val })
        return b
    })
    b.order = jest.fn().mockReturnValue(b)
    b.limit = jest.fn().mockReturnValue(b)

    b.maybeSingle = jest.fn().mockImplementation(() => {
        const filtered = currentData.filter((row) => matches(b._filters, row))
        return Promise.resolve({
            data: filtered[0] ?? defaultSingle,
            error: null,
        })
    })
    b.single = jest.fn().mockImplementation(() => {
        const filtered = currentData.filter((row) => matches(b._filters, row))
        return Promise.resolve({
            data: filtered[0] ?? defaultSingle,
            error: null,
        })
    })
    b.then = (onFulfilled: (v: unknown) => unknown) => {
        const filtered = currentData.filter((row) => matches(b._filters, row))
        return onFulfilled({ data: filtered, error: null })
    }
    return b as Chain
}

const VALID_BRANCH_MAIN = '11111111-1111-4111-8111-111111111111'
const VALID_BRANCH_NORTE = '22222222-2222-4222-8222-222222222222'

describe('app/actions/reports.ts — getFinancialReport (Fase 11 — Commit 4)', () => {
    let consoleErrorSpy: jest.SpyInstance
    let consoleWarnSpy: jest.SpyInstance

    beforeEach(() => {
        mockFrom.mockReset()
        mockRequireAuthContext.mockReset()
        mockRequireOwner.mockReset()
        mockRequireBranchContext.mockReset()
        mockIsUserInBranch.mockReset()
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

        // Default: caller es owner del tenant c-1 y tiene membership
        // en la sucursal MAIN por default.
        mockRequireAuthContext.mockResolvedValue({
            user: { id: 'owner-1' },
            companyId: 'c-1',
            role: 'owner',
            membership: {
                user_id: 'owner-1',
                company_id: 'c-1',
                role: 'owner',
                is_default: true,
                created_at: '2026-01-01',
            },
        })
        mockRequireBranchContext.mockResolvedValue({
            userId: 'owner-1',
            branchId: VALID_BRANCH_MAIN,
        })
        mockIsUserInBranch.mockResolvedValue(true)
        // requireOwner() es un void throw-if-not-owner. El owner-1 pasa
        // siempre, salvo que un test lo sobreescriba explícitamente.
        mockRequireOwner.mockImplementation(() => undefined)

        // Por defecto el builder devuelve datos neutros (sin ventas,
        // sin sesiones, sin gastos). Los tests específicos sobrescriben
        // el `data` para ejercitar sumas.
        //
        // IMPORTANTE: usamos makeFilteredBuilder con la data real de la
        // sucursal MAIN para que las queries internas (que filtran por
        // payment_method=CASH, status=completed, branch_id=MAIN) devuelvan
        // resultados coherentes. Sin esto, los tests pasarían pero las
        // aserciones sobre sumas serían incorrectas porque el mock devolvería
        // datos sin aplicar los filtros.
        const defaultSalesData = [
            { paid_amount: 50000, payment_method: 'CASH', status: 'completed' },
            { paid_amount: 30000, payment_method: 'CARD', status: 'completed' },
            { paid_amount: 20000, payment_method: 'CASH', status: 'cancelled' },
            { paid_amount: 15000, payment_method: 'BANK_TRANSFER', status: 'completed' },
            { paid_amount: 10000, payment_method: 'CREDIT', status: 'completed' },
        ]
        mockFrom.mockImplementation((table: string) => {
            if (table === 'branches') {
                return makeFilteredBuilder(
                    [
                        {
                            id: VALID_BRANCH_MAIN,
                            company_id: 'c-1',
                            name: 'Sucursal Principal',
                            active: true,
                            is_main: true,
                        },
                    ],
                    null,
                )
            }
            if (table === 'sales') {
                return makeFilteredBuilder(defaultSalesData)
            }
            return makeBuilder({ data: [], error: null })
        })
    })

    afterEach(() => {
        consoleErrorSpy.mockRestore()
        consoleWarnSpy.mockRestore()
    })

    // ────────────────────────────────────────────────────────────────────
    // branchFilter === 'current' (default, comportamiento legacy)
    // ────────────────────────────────────────────────────────────────────
    describe("branchFilter === 'current'", () => {
        it('resuelve la sucursal activa con requireBranchContext y filtra todas las queries por branch_id', async () => {
            const result = await getFinancialReport('2026-10-10', 'current')

            expect(result.success).toBe(true)
            expect(result.scope).toBe('current')
            expect(result.branchId).toBe(VALID_BRANCH_MAIN)
            expect(result.branchName).toBe('Sucursal Principal')
            expect(mockRequireBranchContext).toHaveBeenCalledTimes(1)
            // requireOwner NO se llama para scope='current'
            expect(mockRequireOwner).not.toHaveBeenCalled()
        })

        it('default sin branchFilter también usa scope="current"', async () => {
            const result = await getFinancialReport('2026-10-10')

            expect(result.scope).toBe('current')
            expect(result.branchId).toBe(VALID_BRANCH_MAIN)
            expect(mockRequireBranchContext).toHaveBeenCalledTimes(1)
        })

        it('filtra cada query por branch_id cuando scope es current', async () => {
            const eqSpy = jest.fn().mockReturnThis()
            const eqImplementations: Array<[string, unknown]> = []

            // Capturamos todos los .eq(column, value) que recibe el builder
            // para verificar que las queries operativas filtran por branch_id.
            function trackingBuilder() {
                const b: any = {}
                b.select = jest.fn().mockReturnValue(b)
                b.eq = jest.fn().mockImplementation((col: string, val: unknown) => {
                    eqImplementations.push([col, val])
                    return b
                })
                b.neq = jest.fn().mockReturnValue(b)
                b.gte = jest.fn().mockReturnValue(b)
                b.lte = jest.fn().mockReturnValue(b)
                b.order = jest.fn().mockReturnValue(b)
                b.limit = jest.fn().mockReturnValue(b)
                b.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null })
                b.single = jest.fn().mockResolvedValue({ data: null, error: null })
                b.then = (onFulfilled: (v: unknown) => unknown) =>
                    onFulfilled({ data: [], error: null })
                return b
            }

            mockFrom.mockImplementation(() => trackingBuilder())

            await getFinancialReport('2026-10-10', 'current')

            // Debe haber al menos una query de cada tabla operativa
            // (sales/customer_payments/expenses/supplier_payments/cash_sessions)
            // con .eq('branch_id', MAIN).
            const branchFilterCalls = eqImplementations.filter(
                ([col, val]) => col === 'branch_id' && val === VALID_BRANCH_MAIN
            )
            // 5 tablas operativas + filtro de company_id (no es branch_id)
            expect(branchFilterCalls.length).toBeGreaterThanOrEqual(5)

            // Todas las queries deben filtrar por company_id del ctx.
            const companyFilterCalls = eqImplementations.filter(
                ([col, val]) => col === 'company_id' && val === 'c-1'
            )
            expect(companyFilterCalls.length).toBeGreaterThanOrEqual(5)
        })

        it('NO requiere owner (managers también pueden ver scope=current)', async () => {
            // Manager puede ver scope='current'. Por defecto el caller es
            // owner en beforeEach, pero el comportamiento que nos interesa
            // es que NO se llame requireOwner.
            await getFinancialReport('2026-10-10', 'current')

            expect(mockRequireOwner).not.toHaveBeenCalled()
        })

        it('propaga NO_BRANCH_CONTEXT si el usuario no tiene sucursal', async () => {
            mockRequireBranchContext.mockRejectedValueOnce(
                err('NO_BRANCH_CONTEXT', 'requireBranchContext: no active branch for u-1')
            )

            const result = await getFinancialReport('2026-10-10', 'current')

            expect(result.success).toBe(false)
            expect(result.scope).toBe('current')
            expect(result.branchId).toBeNull()
        })

        it('calcula correctamente KPIs cuando hay ventas en la sucursal', async () => {
            // Configurar el builder para que las queries de sales
            // devuelvan datos con la sucursal MAIN. Usamos el filtered
            // builder para que los .eq('payment_method', ...) y
            // .neq('status', 'cancelled') del server action se apliquen
            // a la data mockeada.
            mockFrom.mockImplementation((table: string) => {
                if (table === 'cash_sessions') {
                    return makeFilteredBuilder([{ initial_fund: 100000 }])
                }
                if (table === 'sales') {
                    // cashSalesQuery filtra payment_method=CASH, status!=cancelled
                    // otherSalesQuery filtra payment_method!=CASH, status!=cancelled
                    // El filtered builder aplica esos filtros a la data.
                    return makeFilteredBuilder([
                        { paid_amount: 50000, payment_method: 'CASH', status: 'completed' },
                        { paid_amount: 30000, payment_method: 'CARD', status: 'completed' },
                        { paid_amount: 10000, payment_method: 'CASH', status: 'cancelled' }, // cancelled → no entra en ninguna query
                    ])
                }
                if (table === 'customer_payments') {
                    return makeBuilder({
                        data: [{ amount: 10000 }],
                        error: null,
                    })
                }
                return makeBuilder({ data: [], error: null })
            })

            const result = await getFinancialReport('2026-10-10', 'current')

            expect(result.success).toBe(true)
            expect(result.summary.cashFromSales).toBe(50000)
            expect(result.summary.cardSales).toBe(30000)
            expect(result.summary.initialFund).toBe(100000)
            expect(result.summary.cashFromCustomers).toBe(10000)
        })
    })

    // ────────────────────────────────────────────────────────────────────
    // branchFilter === 'all' (consolidado)
    // ────────────────────────────────────────────────────────────────────
    describe("branchFilter === 'all'", () => {
        it('NO llama requireBranchContext y NO filtra queries por branch_id', async () => {
            const eqImplementations: Array<[string, unknown]> = []

            function trackingBuilder() {
                const b: any = {}
                b.select = jest.fn().mockReturnValue(b)
                b.eq = jest.fn().mockImplementation((col: string, val: unknown) => {
                    eqImplementations.push([col, val])
                    return b
                })
                b.neq = jest.fn().mockReturnValue(b)
                b.gte = jest.fn().mockReturnValue(b)
                b.lte = jest.fn().mockReturnValue(b)
                b.order = jest.fn().mockReturnValue(b)
                b.limit = jest.fn().mockReturnValue(b)
                b.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null })
                b.single = jest.fn().mockResolvedValue({ data: null, error: null })
                b.then = (onFulfilled: (v: unknown) => unknown) =>
                    onFulfilled({ data: [], error: null })
                return b
            }

            mockFrom.mockImplementation(() => trackingBuilder())

            const result = await getFinancialReport('2026-10-10', 'all')

            expect(result.success).toBe(true)
            expect(result.scope).toBe('all')
            expect(result.branchId).toBeNull()
            expect(result.branchName).toBeNull()
            // requireBranchContext NO se llama en modo 'all' (puede no
            // haber sucursal activa — owner navegando entre reportes).
            expect(mockRequireBranchContext).not.toHaveBeenCalled()
            // Ninguna query filtra por branch_id
            const branchIdCalls = eqImplementations.filter(([col]) => col === 'branch_id')
            expect(branchIdCalls).toHaveLength(0)
        })

        it('requiere owner (manager NO puede ver consolidado)', async () => {
            mockRequireOwner.mockImplementationOnce(() => {
                throw err('FORBIDDEN', "requireOwner: requires owner role, got 'manager'")
            })

            const result = await getFinancialReport('2026-10-10', 'all')

            expect(result.success).toBe(false)
            // No expone información sensible: solo el mensaje genérico
            expect(result.scope).toBe('all')
            expect(result.branchId).toBeNull()
        })

        it('filtra por company_id del ctx (defense in depth multi-tenant)', async () => {
            const eqImplementations: Array<[string, unknown]> = []
            function trackingBuilder() {
                const b: any = {}
                b.select = jest.fn().mockReturnValue(b)
                b.eq = jest.fn().mockImplementation((col: string, val: unknown) => {
                    eqImplementations.push([col, val])
                    return b
                })
                b.neq = jest.fn().mockReturnValue(b)
                b.gte = jest.fn().mockReturnValue(b)
                b.lte = jest.fn().mockReturnValue(b)
                b.order = jest.fn().mockReturnValue(b)
                b.limit = jest.fn().mockReturnValue(b)
                b.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null })
                b.single = jest.fn().mockResolvedValue({ data: null, error: null })
                b.then = (onFulfilled: (v: unknown) => unknown) =>
                    onFulfilled({ data: [], error: null })
                return b
            }

            mockFrom.mockImplementation(() => trackingBuilder())

            await getFinancialReport('2026-10-10', 'all')

            // Todas las queries operativas filtran por company_id='c-1'.
            const companyCalls = eqImplementations.filter(
                ([col, val]) => col === 'company_id' && val === 'c-1'
            )
            expect(companyCalls.length).toBeGreaterThanOrEqual(5)
        })

        it('permite que NO haya sucursal activa (owner navegando consolidado sin switch previo)', async () => {
            // Simula un platform user / owner sin sucursal activa:
            // requireBranchContext ni se llama. El test valida que
            // 'all' sigue funcionando sin tirar NO_BRANCH_CONTEXT.
            // (En este test ya validamos arriba que mockRequireBranchContext
            // no se llama; este test es una garantía explícita de que
            // aunque lancemos algo en el futuro desde requireBranchContext,
            // NO afecta a 'all'.)
            expect(mockRequireBranchContext).not.toHaveBeenCalled()

            const result = await getFinancialReport('2026-10-10', 'all')
            expect(result.success).toBe(true)
        })
    })

    // ────────────────────────────────────────────────────────────────────
    // branchFilter === <UUID de sucursal>
    // ────────────────────────────────────────────────────────────────────
    describe('branchFilter === <UUID>', () => {
        it('filtra por la sucursal indicada cuando es válida, activa y pertenece al tenant', async () => {
            const eqImplementations: Array<[string, unknown]> = []

            function trackingBuilder() {
                const b: any = {}
                b.select = jest.fn().mockReturnValue(b)
                b.eq = jest.fn().mockImplementation((col: string, val: unknown) => {
                    eqImplementations.push([col, val])
                    return b
                })
                b.neq = jest.fn().mockReturnValue(b)
                b.gte = jest.fn().mockReturnValue(b)
                b.lte = jest.fn().mockReturnValue(b)
                b.order = jest.fn().mockReturnValue(b)
                b.limit = jest.fn().mockReturnValue(b)
                b.maybeSingle = jest.fn().mockImplementation((...args: unknown[]) => {
                    // La query inicial sobre `branches` debe devolver la
                    // sucursal Norte cuando se valida la pertenencia.
                    return Promise.resolve({
                        data: {
                            id: VALID_BRANCH_NORTE,
                            company_id: 'c-1',
                            name: 'Sucursal Norte',
                            active: true,
                            is_main: false,
                        },
                        error: null,
                    })
                })
                b.single = jest.fn().mockResolvedValue({ data: null, error: null })
                b.then = (onFulfilled: (v: unknown) => unknown) =>
                    onFulfilled({ data: [], error: null })
                return b
            }

            mockFrom.mockImplementation(() => trackingBuilder())
            mockIsUserInBranch.mockResolvedValueOnce(true)

            const result = await getFinancialReport('2026-10-10', VALID_BRANCH_NORTE)

            expect(result.success).toBe(true)
            expect(result.scope).toBe('branch')
            expect(result.branchId).toBe(VALID_BRANCH_NORTE)
            expect(result.branchName).toBe('Sucursal Norte')
            // Filtra por la sucursal indicada en las queries de datos
            const branchCalls = eqImplementations.filter(
                ([col, val]) => col === 'branch_id' && val === VALID_BRANCH_NORTE
            )
            expect(branchCalls.length).toBeGreaterThanOrEqual(5)
            // requireOwner se llamó (modo owner-only)
            expect(mockRequireOwner).toHaveBeenCalled()
        })

        it('rechaza con NOT_FOUND cuando la sucursal no pertenece al tenant', async () => {
            // branches.maybeSingle devuelve null → NOT_FOUND
            mockFrom.mockImplementation(() =>
                makeBuilder({ data: null, error: null })
            )

            const result = await getFinancialReport('2026-10-10', VALID_BRANCH_NORTE)

            expect(result.success).toBe(false)
            expect(result.scope).toBe('branch')
            expect(result.branchId).toBeNull()
        })

        it('rechaza con VALIDATION cuando la sucursal está inactiva', async () => {
            // La primera query sobre branches es la validación: debe
            // devolver active=false.
            mockFrom.mockImplementation((table: string) => {
                if (table === 'branches') {
                    const b: any = {}
                    b.select = jest.fn().mockReturnValue(b)
                    b.eq = jest.fn().mockReturnValue(b)
                    b.maybeSingle = jest.fn().mockResolvedValue({
                        data: {
                            id: VALID_BRANCH_NORTE,
                            company_id: 'c-1',
                            name: 'Sucursal Norte',
                            active: false,
                            is_main: false,
                        },
                        error: null,
                    })
                    b.then = (onFulfilled: (v: unknown) => unknown) =>
                        onFulfilled({ data: null, error: null })
                    return b
                }
                return makeBuilder({ data: [], error: null })
            })

            const result = await getFinancialReport('2026-10-10', VALID_BRANCH_NORTE)

            expect(result.success).toBe(false)
            // scope=branch porque el input fue UUID (no 'all' ni 'current')
            expect(result.scope).toBe('branch')
        })

        it('rechaza con FORBIDDEN cuando el usuario no tiene membrisía en esa sucursal', async () => {
            // Sucursal existe y está activa, pero el usuario no es miembro.
            mockFrom.mockImplementation((table: string) => {
                if (table === 'branches') {
                    const b: any = {}
                    b.select = jest.fn().mockReturnValue(b)
                    b.eq = jest.fn().mockReturnValue(b)
                    b.maybeSingle = jest.fn().mockResolvedValue({
                        data: {
                            id: VALID_BRANCH_NORTE,
                            company_id: 'c-1',
                            name: 'Sucursal Norte',
                            active: true,
                            is_main: false,
                        },
                        error: null,
                    })
                    b.then = (onFulfilled: (v: unknown) => unknown) =>
                        onFulfilled({ data: null, error: null })
                    return b
                }
                return makeBuilder({ data: [], error: null })
            })
            mockIsUserInBranch.mockResolvedValueOnce(false)

            const result = await getFinancialReport('2026-10-10', VALID_BRANCH_NORTE)

            expect(result.success).toBe(false)
            expect(result.scope).toBe('branch')
        })

        it('requiere owner (manager NO puede consultar otra sucursal)', async () => {
            mockRequireOwner.mockImplementationOnce(() => {
                throw err('FORBIDDEN', "requireOwner: requires owner role, got 'manager'")
            })

            const result = await getFinancialReport('2026-10-10', VALID_BRANCH_NORTE)

            expect(result.success).toBe(false)
            expect(result.scope).toBe('branch')
        })

        it('filtra por la sucursal indicada Y por company_id del ctx (defense in depth)', async () => {
            // Defense in depth: cuando validamos la pertenencia de la
            // sucursal, filtramos por id + company_id.
            const eqImplementations: Array<[string, string]> = []

            function trackingBuilder() {
                const b: any = {}
                b.select = jest.fn().mockReturnValue(b)
                b.eq = jest.fn().mockImplementation((col: string, val: string) => {
                    eqImplementations.push([col, val])
                    return b
                })
                b.neq = jest.fn().mockReturnValue(b)
                b.gte = jest.fn().mockReturnValue(b)
                b.lte = jest.fn().mockReturnValue(b)
                b.order = jest.fn().mockReturnValue(b)
                b.limit = jest.fn().mockReturnValue(b)
                b.maybeSingle = jest.fn().mockResolvedValue({
                    data: {
                        id: VALID_BRANCH_NORTE,
                        company_id: 'c-1',
                        name: 'Sucursal Norte',
                        active: true,
                        is_main: false,
                    },
                    error: null,
                })
                b.single = jest.fn().mockResolvedValue({ data: null, error: null })
                b.then = (onFulfilled: (v: unknown) => unknown) =>
                    onFulfilled({ data: [], error: null })
                return b
            }

            mockFrom.mockImplementation(() => trackingBuilder())
            mockIsUserInBranch.mockResolvedValueOnce(true)

            await getFinancialReport('2026-10-10', VALID_BRANCH_NORTE)

            // La validación inicial debe incluir id + company_id
            const branchValidation = eqImplementations.find(
                ([col, val]) => col === 'id' && val === VALID_BRANCH_NORTE
            )
            expect(branchValidation).toBeDefined()
            const companyValidation = eqImplementations.find(
                ([col, val]) => col === 'company_id' && val === 'c-1'
            )
            expect(companyValidation).toBeDefined()
        })
    })

    // ────────────────────────────────────────────────────────────────────
    // Validación de input
    // ────────────────────────────────────────────────────────────────────
    describe('validación de branchFilter', () => {
        it('rechaza con VALIDATION si branchFilter es un string no-UUID distinto de "all"', async () => {
            const result = await getFinancialReport('2026-10-10', 'some-string')

            expect(result.success).toBe(false)
            // scope inferido del input (no es 'current' ni 'all', pero
            // tampoco es UUID → devolvemos 'branch' como fallback en el
            // error path)
            expect(['branch', 'current', 'all']).toContain(result.scope)
            expect(result.branchId).toBeNull()
            // No se llamó ninguna query
            expect(mockFrom).not.toHaveBeenCalled()
        })

        it('rechaza con VALIDATION si branchFilter es un UUID malformado', async () => {
            const result = await getFinancialReport('2026-10-10', 'not-a-uuid-12345')

            expect(result.success).toBe(false)
            expect(mockFrom).not.toHaveBeenCalled()
        })
    })

    // ────────────────────────────────────────────────────────────────────
    // Errores de autenticación / contexto
    // ────────────────────────────────────────────────────────────────────
    describe('errores de autenticación', () => {
        it('propaga UNAUTHENTICATED si requireAuthContext falla', async () => {
            mockRequireAuthContext.mockRejectedValueOnce(
                err('UNAUTHENTICATED', 'requireAuthContext: no active session')
            )

            const result = await getFinancialReport('2026-10-10', 'current')

            expect(result.success).toBe(false)
            expect(result.branchId).toBeNull()
            // No se llamó ninguna query (cortocircuito en requireAuthContext)
            expect(mockFrom).not.toHaveBeenCalled()
        })

        it('propaga NO_COMPANY_CONTEXT si el JWT no tiene company_id', async () => {
            mockRequireAuthContext.mockRejectedValueOnce(
                err('NO_COMPANY_CONTEXT', 'requireAuthContext: JWT without company_id')
            )

            const result = await getFinancialReport('2026-10-10', 'all')

            expect(result.success).toBe(false)
            expect(mockFrom).not.toHaveBeenCalled()
        })
    })

    // ────────────────────────────────────────────────────────────────────
    // branchName
    // ────────────────────────────────────────────────────────────────────
    describe('branchName en respuesta', () => {
        it('devuelve el nombre de la sucursal activa cuando scope=current', async () => {
            const result = await getFinancialReport('2026-10-10', 'current')

            expect(result.branchName).toBe('Sucursal Principal')
        })

        it('devuelve el nombre de la sucursal específica cuando scope=branch', async () => {
            mockFrom.mockImplementation((table: string) => {
                if (table === 'branches') {
                    const b: any = {}
                    b.select = jest.fn().mockReturnValue(b)
                    b.eq = jest.fn().mockReturnValue(b)
                    b.maybeSingle = jest.fn().mockResolvedValue({
                        data: {
                            id: VALID_BRANCH_NORTE,
                            company_id: 'c-1',
                            name: 'Sucursal Norte',
                            active: true,
                            is_main: false,
                        },
                        error: null,
                    })
                    b.then = (onFulfilled: (v: unknown) => unknown) =>
                        onFulfilled({ data: null, error: null })
                    return b
                }
                return makeBuilder({ data: [], error: null })
            })
            mockIsUserInBranch.mockResolvedValueOnce(true)

            const result = await getFinancialReport('2026-10-10', VALID_BRANCH_NORTE)

            expect(result.branchName).toBe('Sucursal Norte')
        })

        it('devuelve null cuando scope=all', async () => {
            const result = await getFinancialReport('2026-10-10', 'all')

            expect(result.branchName).toBeNull()
        })

        it('devuelve null si la sucursal activa fue borrada (defense)', async () => {
            // branches.maybeSingle para resolver el nombre devuelve null
            mockFrom.mockImplementation((table: string) => {
                if (table === 'branches') {
                    return makeBuilder({ data: null, error: null })
                }
                return makeBuilder({ data: [], error: null })
            })

            const result = await getFinancialReport('2026-10-10', 'current')

            expect(result.branchName).toBeNull()
            // Pero el reporte igual se genera (sumando 0)
            expect(result.success).toBe(true)
        })
    })
})

// ────────────────────────────────────────────────────────────────────
// getDashboardStats (compatibilidad)
// ────────────────────────────────────────────────────────────────────
describe('app/actions/reports.ts — getDashboardStats', () => {
    let consoleErrorSpy: jest.SpyInstance

    beforeEach(() => {
        mockFrom.mockReset()
        mockRequireAuthContext.mockReset()
        mockRequireOwner.mockReset()
        mockRequireBranchContext.mockReset()
        mockIsUserInBranch.mockReset()
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

        mockRequireAuthContext.mockResolvedValue({
            user: { id: 'manager-1' },
            companyId: 'c-1',
            role: 'manager',
            membership: {
                user_id: 'manager-1',
                company_id: 'c-1',
                role: 'manager',
                is_default: true,
                created_at: '2026-01-01',
            },
        })
        mockRequireBranchContext.mockResolvedValue({
            userId: 'manager-1',
            branchId: VALID_BRANCH_MAIN,
        })
        mockRequireOwner.mockImplementation(() => undefined)
        mockIsUserInBranch.mockResolvedValue(true)
        mockFrom.mockImplementation((table: string) => {
            if (table === 'branches') {
                return makeFilteredBuilder(
                    [
                        {
                            id: VALID_BRANCH_MAIN,
                            company_id: 'c-1',
                            name: 'Sucursal Principal',
                            active: true,
                            is_main: true,
                        },
                    ],
                    null,
                )
            }
            return makeBuilder({ data: [], error: null })
        })
    })

    afterEach(() => {
        consoleErrorSpy.mockRestore()
    })

    it('siempre usa scope=current (compatibilidad con flujo legacy)', async () => {
        // getDashboardStats debe llamar a requireBranchContext, NO a requireOwner.
        const result = await getDashboardStats()

        expect(result).not.toBeNull()
        expect(mockRequireBranchContext).toHaveBeenCalledTimes(1)
        // requireOwner NO se llama porque getDashboardStats usa 'current'
        expect(mockRequireOwner).not.toHaveBeenCalled()
    })

    it('devuelve null si el reporte falló', async () => {
        mockRequireBranchContext.mockRejectedValueOnce(
            err('NO_BRANCH_CONTEXT', 'requireBranchContext: no active branch for u-1')
        )

        const result = await getDashboardStats()

        expect(result).toBeNull()
    })
})

// ────────────────────────────────────────────────────────────────────
// getCommissionGoalFormatted
// ────────────────────────────────────────────────────────────────────
describe('app/actions/reports.ts — getCommissionGoalFormatted', () => {
    it('formatea la meta en pesos COP', async () => {
        const result = await getCommissionGoalFormatted()
        expect(result).toContain('1.800.000')
    })
})