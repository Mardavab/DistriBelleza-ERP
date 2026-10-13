/**
 * Tests para lib/supabase/branch-membership-queries.ts (Fase 11 — multi-sucursal).
 *
 * Cubre el acceso a datos de membresías de sucursal:
 *   - getUserBranches: devuelve array con la sucursal anidada (PostgREST join
 *     sobre `branch_id` → `branches`). Filtra por `companyId` cuando se
 *     proporciona.
 *   - getActiveBranch: prioridad JWT.branch_id > is_default > primera.
 *   - setDefaultBranch: clear-then-set para evitar violar el índice único
 *     parcial `uniq_branch_default_per_user`.
 *   - isUserInBranch: boolean puro, usado en `requireBranchContext` y en
 *     validaciones previas a INSERT/UPDATE.
 *
 * NO se pega a la base real: `supabaseAdmin` está mockeado a nivel de módulo.
 */

const mockFrom = jest.fn()
const mockSupabaseAdmin = {
    from: mockFrom,
}

jest.mock('../../../lib/supabase', () => ({
    supabaseAdmin: mockSupabaseAdmin,
}))

import {
    getUserBranches,
    getActiveBranch,
    setDefaultBranch,
    isUserInBranch,
} from '../../../lib/supabase/branch-membership-queries'

type Chain = {
    select: jest.Mock
    eq: jest.Mock
    maybeSingle: jest.Mock
    update: jest.Mock
    [key: string]: unknown
}

/**
 * Builder "thenable" para imitar el comportamiento de Supabase JS.
 * Cada método encadenable retorna el propio builder (que también es
 * thenable: `await builder` resuelve con `defaultReturn`). Esto
 * permite que la última `.eq()` en un chain de varios `.eq()` siga
 * siendo `await`-able, replicando la API real.
 */
function makeBuilder(defaultReturn: { data?: unknown; error?: unknown }) {
    const b: any = {}
    b.select = jest.fn().mockReturnValue(b)
    b.eq = jest.fn().mockReturnValue(b)
    b.maybeSingle = jest.fn().mockResolvedValue(defaultReturn)
    b.update = jest.fn().mockReturnValue(b)
    b.insert = jest.fn().mockReturnValue(b)
    b.upsert = jest.fn().mockReturnValue(b)
    b.delete = jest.fn().mockReturnValue(b)
    b.order = jest.fn().mockReturnValue(b)
    // Thenable: cualquier `await` en cualquier eslabón del chain resuelve
    // con `defaultReturn`. Esto emula a PostgREST: la última promesa
    // pendiente es la que entrega `{data, error}`.
    b.then = (onFulfilled: (v: unknown) => unknown) => onFulfilled(defaultReturn)
    return b as Chain
}

describe('branch-membership-queries.ts (Fase 11 — multi-sucursal)', () => {
    beforeEach(() => {
        mockFrom.mockReset()
    })

    describe('getUserBranches', () => {
        it('devuelve el array de membresías con la sucursal anidada (LEFT JOIN)', async () => {
            const rows = [
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-main',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01T00:00:00Z',
                    branches: {
                        id: 'b-main',
                        company_id: 'c-1',
                        code: 'MAIN',
                        name: 'Sucursal Principal',
                        address: null,
                        phone: null,
                        is_main: true,
                        active: true,
                        created_at: '2026-01-01T00:00:00Z',
                    },
                },
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-norte',
                    role: 'manager',
                    is_default: false,
                    created_at: '2026-02-01T00:00:00Z',
                    branches: {
                        id: 'b-norte',
                        company_id: 'c-1',
                        code: 'NORTE',
                        name: 'Sucursal Norte',
                        address: 'Av. Norte 123',
                        phone: '+541112345678',
                        is_main: false,
                        active: true,
                        created_at: '2026-02-01T00:00:00Z',
                    },
                },
            ]

            // La cadena terminal es `.eq('user_id', userId)` → resuelve con las filas.
            const builder = makeBuilder({})
            builder.eq = jest.fn().mockResolvedValue({ data: rows, error: null })
            mockFrom.mockReturnValue(builder)

            const memberships = await getUserBranches('u-1')

            expect(mockFrom).toHaveBeenCalledWith('branch_memberships')
            expect(memberships).toHaveLength(2)
            // Validar aplanado: la membrisía 0 expone el branch anidado.
            expect(memberships[0]).toMatchObject({
                user_id: 'u-1',
                company_id: 'c-1',
                branch_id: 'b-main',
                role: 'owner',
                is_default: true,
            })
            expect((memberships[0] as any).branches).toMatchObject({
                id: 'b-main',
                code: 'MAIN',
                is_main: true,
            })
            expect(memberships[1]).toMatchObject({
                branch_id: 'b-norte',
                role: 'manager',
                is_default: false,
            })
            expect((memberships[1] as any).branches.code).toBe('NORTE')
        })

        it('el SELECT hace JOIN a branches (PostgREST nested select)', async () => {
            // Defensa: si alguien revierte el JOIN, este test falla.
            const builder = makeBuilder({})
            const selectMock = jest.fn().mockReturnValue(builder)
            builder.select = selectMock
            mockFrom.mockReturnValue(builder)

            await getUserBranches('u-x')

            const selectArg = selectMock.mock.calls[0][0] as string
            // Debe usar el alias `branches:branch_id` (snake_case PostgREST).
            expect(selectArg).toContain('branches:branch_id')
            // Debe incluir los campos del branch.
            expect(selectArg).toContain('id')
            expect(selectArg).toContain('code')
            expect(selectArg).toContain('is_main')
        })

        it('filtra por companyId cuando se proporciona (defense in depth multi-tenant)', async () => {
            const builder = makeBuilder({ data: [], error: null })
            const eqSpy = builder.eq
            mockFrom.mockReturnValue(builder)

            await getUserBranches('u-1', 'c-1')

            // Las dos eq deben ser: user_id y company_id
            expect(eqSpy).toHaveBeenCalledWith('user_id', 'u-1')
            expect(eqSpy).toHaveBeenCalledWith('company_id', 'c-1')
        })

        it('NO filtra por companyId cuando se omite (todas las del usuario)', async () => {
            const builder = makeBuilder({ data: [], error: null })
            const eqSpy = builder.eq
            mockFrom.mockReturnValue(builder)

            await getUserBranches('u-1')

            // Solo debe haber una eq con user_id; NUNCA company_id.
            const calls = eqSpy.mock.calls.map((c) => c[0])
            expect(calls).toEqual(['user_id'])
            expect(calls).not.toContain('company_id')
        })

        it('devuelve array vacío cuando el usuario no tiene branch_memberships', async () => {
            const builder = makeBuilder({ data: [], error: null })
            mockFrom.mockReturnValue(builder)

            const memberships = await getUserBranches('ghost')

            expect(memberships).toEqual([])
        })

        it('devuelve [] si la query falla (Supabase reporta error)', async () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

            const builder = makeBuilder({})
            builder.eq = jest
                .fn()
                .mockResolvedValue({ data: null, error: { message: 'permission denied' } })
            mockFrom.mockReturnValue(builder)

            const memberships = await getUserBranches('u-error')

            expect(memberships).toEqual([])
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Error leyendo membresías')
            )

            warnSpy.mockRestore()
        })
    })

    /**
     * Fase 11.8 — fix selector de sucursales para owners.
     *
     * Bug original: un owner que crea nuevas sucursales no se auto-asigna
     * como branch_member, por lo que getUserBranches no las devolvía y
     * el BranchSelector solo mostraba las sucursales donde tenía
     * membrisía explícita.
     *
     * Fix: si el usuario es owner en `companyId`, getUserBranches
     * devuelve TODAS las sucursales activas de la empresa (las reales
     * se preservan, las demás se inyectan como sintéticas con
     * role='owner', is_default=false).
     */
    describe('getUserBranches — owner expansion (Fase 11.8)', () => {
        const makeBranch = (overrides: Partial<{
            id: string
            company_id: string
            code: string
            name: string
            address: string | null
            phone: string | null
            is_main: boolean
            active: boolean
            created_at: string
        }> = {}) => ({
            id: 'b-x',
            company_id: 'c-1',
            code: 'X',
            name: 'Sucursal X',
            address: null,
            phone: null,
            is_main: false,
            active: true,
            created_at: '2026-01-01T00:00:00Z',
            ...overrides,
        })

        it('owner con membresías en 2 sucursales pero 4 en la empresa → devuelve las 4', async () => {
            // Membresías reales: MAIN + NORTE.
            const realMemberships = [
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-main',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01T00:00:00Z',
                    branches: makeBranch({
                        id: 'b-main',
                        code: 'MAIN',
                        name: 'Sucursal Principal',
                        is_main: true,
                    }),
                },
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-norte',
                    role: 'owner',
                    is_default: false,
                    created_at: '2026-02-01T00:00:00Z',
                    branches: makeBranch({ id: 'b-norte', code: 'NORTE', name: 'Sucursal Norte' }),
                },
            ]
            // Todas las sucursales activas de la empresa: 4.
            const allBranches = [
                makeBranch({ id: 'b-main', code: 'MAIN', name: 'Sucursal Principal', is_main: true }),
                makeBranch({ id: 'b-norte', code: 'NORTE', name: 'Sucursal Norte' }),
                makeBranch({ id: 'b-maxy', code: 'MAXY', name: 'Sucursal Maxy' }),
                makeBranch({ id: 'b-maxybelt', code: 'MAXYBELT', name: 'Sucursal MaxyBelt' }),
            ]
            const companyMembership = { role: 'owner' }

            const cmBuilder = makeBuilder({ data: companyMembership, error: null })
            const bmBuilder = makeBuilder({ data: realMemberships, error: null })
            const branchesBuilder = makeBuilder({ data: allBranches, error: null })

            mockFrom.mockImplementation((table: string) => {
                if (table === 'company_memberships') return cmBuilder
                if (table === 'branch_memberships') return bmBuilder
                if (table === 'branches') return branchesBuilder
                throw new Error(`Unexpected table: ${table}`)
            })

            const memberships = await getUserBranches('u-1', 'c-1')

            // Debe devolver 4: 2 reales + 2 sintéticas.
            expect(memberships).toHaveLength(4)
            const branchIds = memberships.map((m) => m.branch_id).sort()
            expect(branchIds).toEqual(['b-main', 'b-maxy', 'b-maxybelt', 'b-norte'])
        })

        it('manager con 1 membresía → devuelve solo 1 (NO se expande)', async () => {
            // manager: NO debe consultar branches ni expandir.
            const realMemberships = [
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-main',
                    role: 'manager',
                    is_default: true,
                    created_at: '2026-01-01T00:00:00Z',
                    branches: makeBranch({ id: 'b-main', code: 'MAIN', is_main: true }),
                },
            ]
            const companyMembership = { role: 'manager' }

            const cmBuilder = makeBuilder({ data: companyMembership, error: null })
            const bmBuilder = makeBuilder({ data: realMemberships, error: null })

            mockFrom.mockImplementation((table: string) => {
                if (table === 'company_memberships') return cmBuilder
                if (table === 'branch_memberships') return bmBuilder
                throw new Error(`Unexpected table: ${table}`)
            })

            const memberships = await getUserBranches('u-1', 'c-1')

            expect(memberships).toHaveLength(1)
            expect(memberships[0].branch_id).toBe('b-main')
            expect(memberships[0].role).toBe('manager')
            // NO debe haber consultado la tabla branches.
            expect(mockFrom).not.toHaveBeenCalledWith('branches')
        })

        it('owner sin membresías pero con 2 sucursales activas → devuelve 2 sintéticas', async () => {
            // El owner creó la empresa y 2 sucursales pero no se auto-asignó.
            const companyMembership = { role: 'owner' }
            const allBranches = [
                makeBranch({ id: 'b-main', code: 'MAIN', name: 'Sucursal Principal', is_main: true }),
                makeBranch({ id: 'b-norte', code: 'NORTE', name: 'Sucursal Norte' }),
            ]

            const cmBuilder = makeBuilder({ data: companyMembership, error: null })
            const bmBuilder = makeBuilder({ data: [], error: null })
            const branchesBuilder = makeBuilder({ data: allBranches, error: null })

            mockFrom.mockImplementation((table: string) => {
                if (table === 'company_memberships') return cmBuilder
                if (table === 'branch_memberships') return bmBuilder
                if (table === 'branches') return branchesBuilder
                throw new Error(`Unexpected table: ${table}`)
            })

            const memberships = await getUserBranches('u-1', 'c-1')

            expect(memberships).toHaveLength(2)
            // Todas las membresías son sintéticas: role='owner', is_default=false.
            for (const m of memberships) {
                expect(m.role).toBe('owner')
                expect(m.is_default).toBe(false)
                expect(m.user_id).toBe('u-1')
                expect(m.company_id).toBe('c-1')
            }
            const branchIds = memberships.map((m) => m.branch_id).sort()
            expect(branchIds).toEqual(['b-main', 'b-norte'])
            // Cada sintética trae la info del branch anidada (del 2do query).
            const main = memberships.find((m) => m.branch_id === 'b-main')
            expect(main?.branches?.code).toBe('MAIN')
        })

        it('owner con membresías en TODAS las sucursales → no crea sintéticas', async () => {
            const realMemberships = [
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-main',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01T00:00:00Z',
                    branches: makeBranch({ id: 'b-main', code: 'MAIN', is_main: true }),
                },
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-norte',
                    role: 'owner',
                    is_default: false,
                    created_at: '2026-02-01T00:00:00Z',
                    branches: makeBranch({ id: 'b-norte', code: 'NORTE' }),
                },
            ]
            const allBranches = [
                makeBranch({ id: 'b-main', code: 'MAIN', is_main: true }),
                makeBranch({ id: 'b-norte', code: 'NORTE' }),
            ]
            const companyMembership = { role: 'owner' }

            const cmBuilder = makeBuilder({ data: companyMembership, error: null })
            const bmBuilder = makeBuilder({ data: realMemberships, error: null })
            const branchesBuilder = makeBuilder({ data: allBranches, error: null })

            mockFrom.mockImplementation((table: string) => {
                if (table === 'company_memberships') return cmBuilder
                if (table === 'branch_memberships') return bmBuilder
                if (table === 'branches') return branchesBuilder
                throw new Error(`Unexpected table: ${table}`)
            })

            const memberships = await getUserBranches('u-1', 'c-1')

            expect(memberships).toHaveLength(2)
            // Ninguna debe ser sintética (is_default=false del real es OK).
            // La real de MAIN tiene is_default=true (preservado).
            const main = memberships.find((m) => m.branch_id === 'b-main')
            expect(main?.is_default).toBe(true)
            expect(main?.role).toBe('owner')
        })

        it('preserva is_default y role de las membresías reales (no los sobrescribe)', async () => {
            // Defensa: si el owner tiene una membrisía real con role='manager'
            // (caso atípico), NO debe convertirse en 'owner' al expandir.
            const realMemberships = [
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-norte',
                    role: 'manager',
                    is_default: false,
                    created_at: '2026-01-01T00:00:00Z',
                    branches: makeBranch({ id: 'b-norte', code: 'NORTE' }),
                },
            ]
            const allBranches = [
                makeBranch({ id: 'b-norte', code: 'NORTE' }),
                makeBranch({ id: 'b-sur', code: 'SUR' }),
            ]
            const companyMembership = { role: 'owner' }

            const cmBuilder = makeBuilder({ data: companyMembership, error: null })
            const bmBuilder = makeBuilder({ data: realMemberships, error: null })
            const branchesBuilder = makeBuilder({ data: allBranches, error: null })

            mockFrom.mockImplementation((table: string) => {
                if (table === 'company_memberships') return cmBuilder
                if (table === 'branch_memberships') return bmBuilder
                if (table === 'branches') return branchesBuilder
                throw new Error(`Unexpected table: ${table}`)
            })

            const memberships = await getUserBranches('u-1', 'c-1')

            expect(memberships).toHaveLength(2)
            const real = memberships.find((m) => m.branch_id === 'b-norte')
            expect(real?.role).toBe('manager') // preservado
            expect(real?.is_default).toBe(false) // preservado
            const synthetic = memberships.find((m) => m.branch_id === 'b-sur')
            expect(synthetic?.role).toBe('owner') // sintética
            expect(synthetic?.is_default).toBe(false) // sintética
        })

        it('NO consulta company_memberships ni branches si companyId es undefined', async () => {
            // Sin companyId, no podemos saber el rol: caemos al caso
            // "solo realMemberships" (comportamiento previo a Fase 11.8).
            const realMemberships = [
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-main',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01T00:00:00Z',
                    branches: makeBranch({ id: 'b-main', code: 'MAIN', is_main: true }),
                },
            ]
            const bmBuilder = makeBuilder({ data: realMemberships, error: null })
            mockFrom.mockReturnValue(bmBuilder)

            const memberships = await getUserBranches('u-1')

            expect(memberships).toHaveLength(1)
            expect(mockFrom).not.toHaveBeenCalledWith('company_memberships')
            expect(mockFrom).not.toHaveBeenCalledWith('branches')
            expect(mockFrom).toHaveBeenCalledWith('branch_memberships')
        })

        it('si la consulta a company_memberships falla → cae a realMemberships sin expandir', async () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

            const realMemberships = [
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-main',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01T00:00:00Z',
                    branches: makeBranch({ id: 'b-main', code: 'MAIN', is_main: true }),
                },
            ]
            const cmBuilder = makeBuilder({})
            cmBuilder.maybeSingle = jest.fn().mockResolvedValue({
                data: null,
                error: { message: 'rls denied' },
            })
            const bmBuilder = makeBuilder({ data: realMemberships, error: null })
            mockFrom.mockImplementation((table: string) => {
                if (table === 'company_memberships') return cmBuilder
                if (table === 'branch_memberships') return bmBuilder
                throw new Error(`Unexpected table: ${table}`)
            })

            const memberships = await getUserBranches('u-1', 'c-1')

            expect(memberships).toHaveLength(1)
            expect(memberships[0].branch_id).toBe('b-main')
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('company_memberships')
            )
            // No se intenta expandir (companyRole=null al fallar).
            expect(mockFrom).not.toHaveBeenCalledWith('branches')

            warnSpy.mockRestore()
        })

        it('si la consulta a branches falla → devuelve realMemberships sin expandir', async () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

            const realMemberships = [
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-main',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01T00:00:00Z',
                    branches: makeBranch({ id: 'b-main', code: 'MAIN', is_main: true }),
                },
            ]
            const cmBuilder = makeBuilder({ data: { role: 'owner' }, error: null })
            const bmBuilder = makeBuilder({ data: realMemberships, error: null })
            // Builder de branches: encadena bien pero resuelve con error al hacer await.
            const branchesBuilder = makeBuilder({})
            branchesBuilder.then = (onFulfilled) =>
                onFulfilled({ data: null, error: { message: 'rls denied' } })
            mockFrom.mockImplementation((table: string) => {
                if (table === 'company_memberships') return cmBuilder
                if (table === 'branch_memberships') return bmBuilder
                if (table === 'branches') return branchesBuilder
                throw new Error(`Unexpected table: ${table}`)
            })

            const memberships = await getUserBranches('u-1', 'c-1')

            expect(memberships).toHaveLength(1)
            expect(memberships[0].branch_id).toBe('b-main')
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('owner expansion')
            )

            warnSpy.mockRestore()
        })

        it('la query a branches filtra por active=true y company_id', async () => {
            // Verificamos que la query a branches usó los filtros esperados.
            // No podemos confiar en que el mock filtre el data devuelto, así
            // que comprobamos los argumentos pasados a .eq().
            const companyMembership = { role: 'owner' }
            const cmBuilder = makeBuilder({ data: companyMembership, error: null })
            const bmBuilder = makeBuilder({ data: [], error: null })
            const branchesBuilder = makeBuilder({ data: [], error: null })

            mockFrom.mockImplementation((table: string) => {
                if (table === 'company_memberships') return cmBuilder
                if (table === 'branch_memberships') return bmBuilder
                if (table === 'branches') return branchesBuilder
                throw new Error(`Unexpected table: ${table}`)
            })

            await getUserBranches('u-1', 'c-1')

            // La query a branches debe filtrar por company_id y active=true.
            const eqCalls = branchesBuilder.eq.mock.calls.map((c) => c)
            expect(eqCalls).toContainEqual(['company_id', 'c-1'])
            expect(eqCalls).toContainEqual(['active', true])
        })

        it('owner con 0 sucursales activas en la empresa → devuelve []', async () => {
            // Empresa recién creada sin sucursales: el owner no ve ninguna
            // opción (BranchSelector no se renderiza en el Sidebar).
            const companyMembership = { role: 'owner' }
            const cmBuilder = makeBuilder({ data: companyMembership, error: null })
            const bmBuilder = makeBuilder({ data: [], error: null })
            const branchesBuilder = makeBuilder({ data: [], error: null })
            mockFrom.mockImplementation((table: string) => {
                if (table === 'company_memberships') return cmBuilder
                if (table === 'branch_memberships') return bmBuilder
                if (table === 'branches') return branchesBuilder
                throw new Error(`Unexpected table: ${table}`)
            })

            const memberships = await getUserBranches('u-1', 'c-1')

            expect(memberships).toEqual([])
        })

        it('no expande para roles distintos a owner (technician-like)', async () => {
            // Aunque el rol no sea 'manager' ni 'owner', solo 'owner' expande.
            // Cualquier otro cae al caso "solo realMemberships".
            const realMemberships = [
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-main',
                    role: 'manager',
                    is_default: true,
                    created_at: '2026-01-01T00:00:00Z',
                    branches: makeBranch({ id: 'b-main', code: 'MAIN', is_main: true }),
                },
            ]
            const companyMembership = { role: 'cashier' }
            const cmBuilder = makeBuilder({ data: companyMembership, error: null })
            const bmBuilder = makeBuilder({ data: realMemberships, error: null })
            mockFrom.mockImplementation((table: string) => {
                if (table === 'company_memberships') return cmBuilder
                if (table === 'branch_memberships') return bmBuilder
                throw new Error(`Unexpected table: ${table}`)
            })

            const memberships = await getUserBranches('u-1', 'c-1')

            expect(memberships).toHaveLength(1)
            expect(mockFrom).not.toHaveBeenCalledWith('branches')
        })
    })

    describe('getActiveBranch', () => {
        it('prioriza la membrisía cuyo branch_id coincide con el del JWT', async () => {
            // El usuario tiene 2 membresías; el JWT apunta a b-norte.
            // Aunque is_default=true esté en b-main, debe ganar b-norte.
            const rows = [
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-main',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01T00:00:00Z',
                    branches: { id: 'b-main', code: 'MAIN', is_main: true },
                },
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-norte',
                    role: 'manager',
                    is_default: false,
                    created_at: '2026-02-01T00:00:00Z',
                    branches: { id: 'b-norte', code: 'NORTE', is_main: false },
                },
            ]
            const builder = makeBuilder({ data: rows, error: null })
            mockFrom.mockReturnValue(builder)

            const result = await getActiveBranch('u-1', 'c-1', 'b-norte')

            expect(result).not.toBeNull()
            expect(result!.branch.id).toBe('b-norte')
            expect(result!.membership.role).toBe('manager')
        })

        it('si el JWT no coincide, devuelve la membrisía marcada como is_default', async () => {
            const rows = [
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-main',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01T00:00:00Z',
                    branches: { id: 'b-main', code: 'MAIN', is_main: true },
                },
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-norte',
                    role: 'manager',
                    is_default: false,
                    created_at: '2026-02-01T00:00:00Z',
                    branches: { id: 'b-norte', code: 'NORTE', is_main: false },
                },
            ]
            const builder = makeBuilder({ data: rows, error: null })
            mockFrom.mockReturnValue(builder)

            // JWT apunta a b-inexistente → debe ganar is_default (b-main).
            const result = await getActiveBranch('u-1', 'c-1', 'b-inexistente')

            expect(result).not.toBeNull()
            expect(result!.branch.id).toBe('b-main')
            expect(result!.membership.is_default).toBe(true)
        })

        it('si no hay match JWT ni is_default, devuelve la primera membrisía', async () => {
            const rows = [
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-main',
                    role: 'manager',
                    is_default: false,
                    created_at: '2026-01-01T00:00:00Z',
                    branches: { id: 'b-main', code: 'MAIN', is_main: true },
                },
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-norte',
                    role: 'manager',
                    is_default: false,
                    created_at: '2026-02-01T00:00:00Z',
                    branches: { id: 'b-norte', code: 'NORTE', is_main: false },
                },
            ]
            const builder = makeBuilder({ data: rows, error: null })
            mockFrom.mockReturnValue(builder)

            const result = await getActiveBranch('u-1', 'c-1')

            expect(result).not.toBeNull()
            expect(result!.branch.id).toBe('b-main') // primera del array
        })

        it('devuelve null si el usuario no tiene branch_memberships en la empresa', async () => {
            const builder = makeBuilder({ data: [], error: null })
            mockFrom.mockReturnValue(builder)

            const result = await getActiveBranch('u-empty', 'c-1', 'b-whatever')

            expect(result).toBeNull()
        })

        it('hace fetch explícito a branches si la membrisía no trae sucursal anidada', async () => {
            // Defensa: si la primera query no incluye el LEFT JOIN (mock parcial),
            // el código hace un SELECT explícito a `branches` por id.
            const membershipsWithoutBranches = [
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-main',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01T00:00:00Z',
                    branches: null, // mock parcial: no viene anidado
                },
            ]
            const expectedBranch = {
                id: 'b-main',
                company_id: 'c-1',
                code: 'MAIN',
                name: 'Sucursal Principal',
                address: null,
                phone: null,
                is_main: true,
                active: true,
                created_at: '2026-01-01T00:00:00Z',
            }

            // cmBuilder: devuelve role='manager' para que NO se intente expandir
            // (queremos probar solo el fallback de getActiveBranch, no la lógica
            // de owner expansion).
            const cmBuilder = makeBuilder({ data: { role: 'manager' }, error: null })
            const bmBuilder = makeBuilder({
                data: membershipsWithoutBranches,
                error: null,
            })
            const branchesBuilder = makeBuilder({
                data: expectedBranch,
                error: null,
            })

            let call = 0
            mockFrom.mockImplementation((table: string) => {
                call++
                if (table === 'company_memberships') return cmBuilder
                if (table === 'branch_memberships') return bmBuilder
                if (table === 'branches') return branchesBuilder
                throw new Error(`Unexpected table: ${table}`)
            })

            const result = await getActiveBranch('u-1', 'c-1')

            expect(result).not.toBeNull()
            expect(result!.branch.id).toBe('b-main')
            expect(result!.branch.code).toBe('MAIN')
            // Se hicieron al menos DOS queries: branch_memberships + branches (fallback).
            expect(call).toBeGreaterThanOrEqual(2)
            expect(mockFrom).toHaveBeenCalledWith('branches')
        })

        it('devuelve null si la membrisía existe pero la sucursal tampoco se puede resolver', async () => {
            // Estado inconsistente: la membrisía existe pero la sucursal fue borrada
            // (debería cascade-eliminarse por FK, pero defendemos el caso).
            const membershipsWithoutBranches = [
                {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-ghost',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01T00:00:00Z',
                    branches: null,
                },
            ]
            // cmBuilder: role='manager' para NO expandir.
            const cmBuilder = makeBuilder({ data: { role: 'manager' }, error: null })
            const bmBuilder = makeBuilder({
                data: membershipsWithoutBranches,
                error: null,
            })
            const branchesBuilder = makeBuilder({ data: null, error: null })

            mockFrom.mockImplementation((table: string) => {
                if (table === 'company_memberships') return cmBuilder
                if (table === 'branch_memberships') return bmBuilder
                if (table === 'branches') return branchesBuilder
                throw new Error(`Unexpected: ${table}`)
            })

            const result = await getActiveBranch('u-1', 'c-1')

            expect(result).toBeNull()
        })
    })

    describe('setDefaultBranch', () => {
        it('limpia el default actual antes de marcar el nuevo (clear-then-set)', async () => {
            const builder = makeBuilder({ error: null })
            const updateSpy = builder.update
            mockFrom.mockReturnValue(builder)

            await setDefaultBranch('u-1', 'b-norte')

            expect(mockFrom).toHaveBeenCalledWith('branch_memberships')
            // update() llamado dos veces: clear + set
            expect(updateSpy).toHaveBeenCalledTimes(2)
            expect(updateSpy).toHaveBeenNthCalledWith(1, { is_default: false })
            expect(updateSpy).toHaveBeenNthCalledWith(2, { is_default: true })
        })

        it('el clear filtra por user_id y is_default=true; el set por user_id y branch_id', async () => {
            const builder = makeBuilder({ error: null })
            const eqSpy = builder.eq
            mockFrom.mockReturnValue(builder)

            await setDefaultBranch('u-1', 'b-norte')

            // eq() se invoca 4 veces (clear: 2, set: 2).
            const eqCalls = eqSpy.mock.calls.map((c) => c)
            // Ambos bloques incluyen user_id (aparece 2 veces, una por bloque).
            const userIdCalls = eqCalls.filter((c) => c[0] === 'user_id')
            expect(userIdCalls.length).toBeGreaterThanOrEqual(2)
            expect(userIdCalls[0]).toEqual(['user_id', 'u-1'])
            // El clear incluye is_default=true; el set NO.
            expect(eqCalls).toContainEqual(['is_default', true])
            // El set incluye branch_id=b-norte; el clear NO.
            expect(eqCalls).toContainEqual(['branch_id', 'b-norte'])
        })

        it('lanza error si el update final (set) falla', async () => {
            // Para simular que SOLO el set falla, devolvemos `null` en el
            // clear y `error` en el set. Como ambos usan el mismo builder
            // thenable, no podemos distinguirlos por builder. La forma más
            // simple: el primer update es OK (no error), el segundo update
            // reporta error. Usamos un contador de llamadas.
            const okBuilder = makeBuilder({ error: null })
            let updateCall = 0
            okBuilder.update = jest.fn().mockImplementation(() => {
                updateCall++
                if (updateCall === 1) {
                    // clear: ok
                    return makeBuilder({ error: null })
                }
                // set: falla
                return makeBuilder({ error: { message: 'rls violation' } })
            })
            mockFrom.mockReturnValue(okBuilder)

            await expect(setDefaultBranch('u-1', 'b-norte')).rejects.toThrow(
                /setDefaultBranch/
            )
        })

        it('sigue si el clear falla (console.warn) y luego intenta el set', async () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

            let updateCall = 0
            const okBuilder = makeBuilder({ error: null })
            okBuilder.update = jest.fn().mockImplementation(() => {
                updateCall++
                if (updateCall === 1) {
                    // clear: falla
                    return makeBuilder({ error: { message: 'rls' } })
                }
                // set: ok
                return makeBuilder({ error: null })
            })
            mockFrom.mockReturnValue(okBuilder)

            await expect(setDefaultBranch('u-1', 'b-norte')).resolves.toBeUndefined()
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('setDefaultBranch')
            )

            warnSpy.mockRestore()
        })
    })

    describe('isUserInBranch', () => {
        it('devuelve true si la membrisía existe (maybeSingle trae fila)', async () => {
            const builder = makeBuilder({ data: { user_id: 'u-1' } })
            mockFrom.mockReturnValue(builder)

            const result = await isUserInBranch('u-1', 'b-main')

            expect(mockFrom).toHaveBeenCalledWith('branch_memberships')
            expect(result).toBe(true)
        })

        it('devuelve false si no hay membrisía (maybeSingle → null)', async () => {
            const builder = makeBuilder({ data: null })
            mockFrom.mockReturnValue(builder)

            const result = await isUserInBranch('u-other', 'b-main')

            expect(result).toBe(false)
        })

        it('devuelve false si la query falla', async () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

            const builder = makeBuilder({})
            builder.maybeSingle = jest.fn().mockResolvedValue({
                data: null,
                error: { message: 'rls denied' },
            })
            mockFrom.mockReturnValue(builder)

            const result = await isUserInBranch('u-x', 'b-x')

            expect(result).toBe(false)
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('isUserInBranch'))

            warnSpy.mockRestore()
        })

        it('filtra por user_id y branch_id en la query', async () => {
            const builder = makeBuilder({ data: { user_id: 'u-1' } })
            const eqSpy = builder.eq
            mockFrom.mockReturnValue(builder)

            await isUserInBranch('u-1', 'b-main')

            // eq() se invoca dos veces: con user_id y con branch_id.
            const calls = eqSpy.mock.calls.map((c) => c)
            expect(calls).toContainEqual(['user_id', 'u-1'])
            expect(calls).toContainEqual(['branch_id', 'b-main'])
        })
    })
})
