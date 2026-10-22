/**
 * Tests para modules/platform-admin/actions/platform.ts (Fase 10 — multi-empresa).
 *
 * Cubre el cambio de Fase 10.5 en `getSystemHealth`:
 *   - El check "platform-admins" ahora cuenta usuarios con
 *     `is_platform_admin = true` (NO `role = 'technician'`).
 *
 * Mocks: supabaseAdmin (de lib/supabase) + requirePlatformRole (de auth-helpers).
 * NO se pega a la base real.
 */

const mockRequirePlatformRole = jest.fn()
jest.mock('../../../lib/supabase/auth-helpers', () => ({
    requirePlatformRole: (...args: unknown[]) => mockRequirePlatformRole(...args),
}))

const mockFrom = jest.fn()
jest.mock('../../../lib/supabase', () => ({
    supabaseAdmin: { from: mockFrom },
}))

// next/cache no se usa directamente en este archivo pero lo necesitamos
// porque el archivo lo importa... esperá, en realidad platform.ts no
// importa next/cache. Lo dejamos fuera.

import { getSystemHealth, getAllCompanies, setCompanyActive } from '../../../modules/platform-admin/actions/platform'
import { err } from '../../../lib/errors'

type Chain = {
    select: jest.Mock
    eq: jest.Mock
    limit: jest.Mock
}

/**
 * Builder de Supabase JS simulado. Soporta 3 estilos de terminal:
 *   - .limit(1)              → resuelve al final con `returnValue`
 *   - .select(cols) simple   → resuelve al final con `returnValue`
 *   - .select(opts).eq(...)  → resuelve como thenable al final con `returnValue`
 */
function makeBuilder(returnValue: { data?: unknown; error?: unknown; count?: unknown }) {
    const builder: Partial<Chain> & Record<string, unknown> = {}
    builder.select = jest.fn().mockReturnValue(builder)
    builder.eq = jest.fn().mockImplementation(() => {
        // eq devuelve un objeto thenable que resuelve con returnValue.
        return {
            then: (onFulfilled: (v: unknown) => unknown) => onFulfilled(returnValue),
        }
    })
    builder.limit = jest.fn().mockResolvedValue(returnValue)
    // Make the builder itself thenable so `await` after `.select()` resolves
    // with the returnValue (used for queries like `.select('id, active')`).
    ;(builder as any).then = (onFulfilled: (v: unknown) => unknown) =>
        onFulfilled(returnValue)
    return builder as Chain
}

describe('modules/platform-admin/actions/platform.ts — getSystemHealth (Fase 10.5)', () => {
    let consoleSpy: jest.SpyInstance

    beforeEach(() => {
        mockFrom.mockReset()
        mockRequirePlatformRole.mockReset()
        // Por defecto, asumimos que el caller es platform role válido.
        mockRequirePlatformRole.mockResolvedValue({
            user: { id: 'tech-1' },
            role: 'technician',
            companyId: null,
        })
        // console.error/warn aparecen con try/catch en errores; tests de error
        // ejercitan getSystemHealth → Platform.check fallido → console.error
        consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
        consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleSpy.mockRestore()
    })

    it('cuenta técnicos por is_platform_admin=true (NO por role=technician)', async () => {
        // 1) companies.select → para "database" check
        // 2) companies.select id,active → para "tenants"
        // 3) profiles.select().eq(is_platform_admin, true) → para "platform-admins"

        let calls = 0
        mockFrom.mockImplementation((table: string) => {
            if (table === 'companies') {
                calls++
                if (calls === 1) {
                    // database health check
                    return makeBuilder({ data: [{ id: 'c1' }], error: null })
                }
                // tenants check
                return makeBuilder({ data: [{ id: 'c1', active: true }], error: null })
            }

            if (table === 'profiles') {
                // platform-admins check
                const eqSpy = jest.fn().mockImplementation((col: string, val: unknown) => {
                    // El check crítico: se filtra por is_platform_admin, NO por role.
                    expect(col).toBe('is_platform_admin')
                    expect(val).toBe(true)

                    // Thenable que resuelve con count = 3
                    return {
                        then: (onFulfilled: (v: unknown) => unknown) =>
                            onFulfilled({ count: 3, error: null }),
                    }
                })

                return {
                    select: jest.fn().mockReturnValue({
                        eq: eqSpy,
                    }),
                }
            }

            throw new Error(`Unexpected table: ${table}`)
        })

        const result = await getSystemHealth()

        expect(result.success).toBe(true)
        expect(result.data).toBeDefined()

        const platformCheck = result.data!.find((c) => c.id === 'platform-admins')
        expect(platformCheck).toBeDefined()
        expect(platformCheck!.status).toBe('ok')
        expect(platformCheck!.detail).toContain('3')
    })

    it('NO usa role=technician para detectar platform admins (regression)', async () => {
        // Este test falla si alguien revierte el cambio y vuelve a .eq('role', 'technician').
        let roleCheckCalled = false
        let isPlatformCheckCalled = false

        mockFrom.mockImplementation((table: string) => {
            if (table === 'companies') {
                return makeBuilder({ data: [], error: null })
            }

            if (table === 'profiles') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockImplementation((col: string, _val: unknown) => {
                            if (col === 'role') {
                                roleCheckCalled = true
                                return {
                                    then: (onFulfilled: (v: unknown) => unknown) =>
                                        onFulfilled({ count: 0, error: null }),
                                }
                            }
                            if (col === 'is_platform_admin') {
                                isPlatformCheckCalled = true
                                return {
                                    then: (onFulfilled: (v: unknown) => unknown) =>
                                        onFulfilled({ count: 1, error: null }),
                                }
                            }
                            throw new Error(`Unexpected column: ${col}`)
                        }),
                    }),
                }
            }

            throw new Error(`Unexpected table: ${table}`)
        })

        await getSystemHealth()

        expect(isPlatformCheckCalled).toBe(true)
        expect(roleCheckCalled).toBe(false)
    })

    it('reporta error si no hay ningún platform admin configurado', async () => {
        let calls = 0
        mockFrom.mockImplementation((table: string) => {
            if (table === 'companies') {
                calls++
                if (calls === 1) {
                    return makeBuilder({ data: [], error: null })
                }
                return makeBuilder({ data: [], error: null })
            }

            if (table === 'profiles') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            then: (onFulfilled: (v: unknown) => unknown) =>
                                onFulfilled({ count: 0, error: null }),
                        }),
                    }),
                }
            }
        })

        const result = await getSystemHealth()

        const platformCheck = result.data!.find((c) => c.id === 'platform-admins')
        expect(platformCheck!.status).toBe('error')
        expect(platformCheck!.detail).toContain('Ninguna')
    })

    it('rechaza al caller si no es platform role', async () => {
        // requirePlatformRole lanza AppError (err('FORBIDDEN', ...)); el mock
        // refleja ese comportamiento real, no un Error plano.
        mockRequirePlatformRole.mockRejectedValueOnce(
            err('FORBIDDEN', 'FORBIDDEN: se requiere cuenta de plataforma (is_platform_admin=true), pero el usuario no la tiene')
        )

        const result = await getSystemHealth()

        expect(result.success).toBe(false)
        if (!result.success) {
            expect(result.code).toBe('FORBIDDEN')
            expect(result.error).toBe('No tenés permisos para realizar esta acción.')
        }
        // NO debe haber consultado la base
        expect(mockFrom).not.toHaveBeenCalled()
    })

    it('maneja count=undefined/null de Supabase sin crashear', async () => {
        let calls = 0
        mockFrom.mockImplementation((table: string) => {
            if (table === 'companies') {
                calls++
                if (calls === 1) {
                    return makeBuilder({ data: [], error: null })
                }
                return makeBuilder({ data: [], error: null })
            }

            if (table === 'profiles') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            then: (onFulfilled: (v: unknown) => unknown) =>
                                onFulfilled({ count: null, error: null }),
                        }),
                    }),
                }
            }
        })

        const result = await getSystemHealth()

        expect(result.success).toBe(true)
        const platformCheck = result.data!.find((c) => c.id === 'platform-admins')
        // count null → fallback 0 → status error
        expect(platformCheck!.status).toBe('error')
    })

    it('singular/plural correcto: 1 cuenta vs N cuentas', async () => {
        let calls = 0
        mockFrom.mockImplementation((table: string) => {
            if (table === 'companies') {
                calls++
                if (calls === 1) return makeBuilder({ data: [], error: null })
                return makeBuilder({ data: [], error: null })
            }

            if (table === 'profiles') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            then: (onFulfilled: (v: unknown) => unknown) =>
                                onFulfilled({ count: 1, error: null }),
                        }),
                    }),
                }
            }
        })

        const result = await getSystemHealth()
        const platformCheck = result.data!.find((c) => c.id === 'platform-admins')

        // Singular: "1 cuenta"
        expect(platformCheck!.detail).toContain('1 cuenta')
        expect(platformCheck!.detail).not.toContain('1 cuentas')
    })
})

/**
 * Builder para `.select(cols).order(col, opts)` terminal (getAllCompanies).
 */
function makeOrderBuilder(returnValue: { data?: unknown; error?: unknown }) {
    const builder: Record<string, unknown> = {}
    builder.select = jest.fn().mockReturnValue(builder)
    builder.order = jest.fn().mockReturnValue({
        then: (onFulfilled: (v: unknown) => unknown) => onFulfilled(returnValue),
    })
    return builder
}

/**
 * Builder para `.select(cols).in(col, ids)` terminal, con `.eq()` opcional
 * (getAllCompanies hace `.in(...).eq('status', 'completed')` en sales).
 */
function makeInBuilder(returnValue: { data?: unknown; error?: unknown }) {
    const inThenable = {
        then: (onFulfilled: (v: unknown) => unknown) => onFulfilled(returnValue),
    }
    const inChain: Record<string, unknown> = {
        in: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue(inThenable),
            ...inThenable,
        }),
    }
    return { select: jest.fn().mockReturnValue(inChain) }
}

describe('modules/platform-admin/actions/platform.ts — getAllCompanies', () => {
    let consoleSpy: jest.SpyInstance

    beforeEach(() => {
        mockFrom.mockReset()
        mockRequirePlatformRole.mockReset()
        mockRequirePlatformRole.mockResolvedValue({
            user: { id: 'tech-1' },
            role: 'technician',
            companyId: null,
        })
        consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleSpy.mockRestore()
    })

    it('agrega user_count, sales_total y last_sale_at por empresa', async () => {
        const companies = [
            {
                id: 'c1',
                slug: 'acme',
                legal_name: 'ACME SAS',
                trade_name: 'ACME',
                active: true,
                deactivation_reason: null,
                deactivated_at: null,
                created_at: '2026-01-01',
            },
            {
                id: 'c2',
                slug: 'beta',
                legal_name: 'BETA SAS',
                trade_name: 'BETA',
                active: true,
                deactivation_reason: null,
                deactivated_at: null,
                created_at: '2026-01-02',
            },
        ]

        mockFrom.mockImplementation((table: string) => {
            if (table === 'companies') {
                return makeOrderBuilder({ data: companies, error: null })
            }
            if (table === 'profiles') {
                return makeInBuilder({
                    data: [
                        { company_id: 'c1' },
                        { company_id: 'c1' },
                        { company_id: 'c2' },
                    ],
                    error: null,
                })
            }
            if (table === 'sales') {
                return makeInBuilder({
                    data: [
                        { company_id: 'c1', total_with_discount: 100, created_at: '2026-02-01' },
                        { company_id: 'c1', total_with_discount: 250, created_at: '2026-03-01' },
                        { company_id: 'c2', total_with_discount: '75.5', created_at: '2026-01-15' },
                    ],
                    error: null,
                })
            }
            throw new Error(`Unexpected table: ${table}`)
        })

        const result = await getAllCompanies()

        expect(result.success).toBe(true)
        const data = result.data!
        expect(data).toHaveLength(2)

        const c1 = data.find((c) => c.id === 'c1')!
        expect(c1.user_count).toBe(2)
        expect(c1.sales_total).toBe(350)
        expect(c1.last_sale_at).toBe('2026-03-01')

        const c2 = data.find((c) => c.id === 'c2')!
        expect(c2.user_count).toBe(1)
        expect(c2.sales_total).toBe(75.5)
        expect(c2.last_sale_at).toBe('2026-01-15')
    })

    it('devuelve [] sin consultar profiles/sales cuando no hay empresas', async () => {
        const queriedTables: string[] = []
        mockFrom.mockImplementation((table: string) => {
            queriedTables.push(table)
            if (table === 'companies') {
                return makeOrderBuilder({ data: [], error: null })
            }
            throw new Error(`Unexpected table: ${table}`)
        })

        const result = await getAllCompanies()

        expect(result.success).toBe(true)
        expect(result.data).toEqual([])
        expect(queriedTables).toEqual(['companies'])
    })

    it('devuelve EXTERNAL cuando companies falla (shape normalizado)', async () => {
        mockFrom.mockImplementation((table: string) => {
            if (table === 'companies') {
                return makeOrderBuilder({
                    data: null,
                    error: { message: 'permission denied for table companies' },
                })
            }
            throw new Error(`Unexpected table: ${table}`)
        })

        const result = await getAllCompanies()

        expect(result.success).toBe(false)
        if (!result.success) {
            // El detalle interno no se filtra al usuario; queda en el log.
            expect(result.code).toBe('EXTERNAL')
            expect(result.error).toBe(
                'No se pudo conectar con el servicio externo. Reintentá en unos segundos.'
            )
        }
    })

    it('rechaza al caller sin rol de plataforma sin consultar la base', async () => {
        mockRequirePlatformRole.mockRejectedValueOnce(
            err('FORBIDDEN', 'FORBIDDEN: se requiere cuenta de plataforma (is_platform_admin=true), pero el usuario no la tiene')
        )

        const result = await getAllCompanies()

        expect(result.success).toBe(false)
        if (!result.success) expect(result.code).toBe('FORBIDDEN')
        expect(mockFrom).not.toHaveBeenCalled()
    })

    it('asigna 0 y null cuando una empresa no tiene usuarios ni ventas', async () => {
        mockFrom.mockImplementation((table: string) => {
            if (table === 'companies') {
                return makeOrderBuilder({
                    data: [
                        {
                            id: 'c9',
                            slug: 'nueva',
                            legal_name: 'NUEVA',
                            trade_name: 'Nueva',
                            active: true,
                            deactivation_reason: null,
                            deactivated_at: null,
                            created_at: '2026-04-01',
                        },
                    ],
                    error: null,
                })
            }
            if (table === 'profiles' || table === 'sales') {
                return makeInBuilder({ data: [], error: null })
            }
            throw new Error(`Unexpected table: ${table}`)
        })

        const result = await getAllCompanies()

        const row = result.data![0]
        expect(row.user_count).toBe(0)
        expect(row.sales_total).toBe(0)
        expect(row.last_sale_at).toBeNull()
    })
})

describe('modules/platform-admin/actions/platform.ts — setCompanyActive', () => {
    let consoleLogSpy: jest.SpyInstance
    let consoleSpy: jest.SpyInstance

    const VALID_UUID = '11111111-1111-1111-1111-111111111111'

    beforeEach(() => {
        mockFrom.mockReset()
        mockRequirePlatformRole.mockReset()
        mockRequirePlatformRole.mockResolvedValue({
            user: { id: 'tech-1' },
            role: 'technician',
            companyId: null,
        })
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
        consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleLogSpy.mockRestore()
        consoleSpy.mockRestore()
    })

    function mockCompanyLookup(company: { id: string; active: boolean } | null) {
        return jest.fn().mockImplementation((table: string) => {
            if (table === 'companies') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            maybeSingle: jest.fn().mockResolvedValue({ data: company }),
                        }),
                    }),
                    update: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            then: (onFulfilled: (v: unknown) => unknown) =>
                                onFulfilled({ error: null }),
                        }),
                    }),
                }
            }
            throw new Error(`Unexpected table: ${table}`)
        })
    }

    it('rechaza un companyId que no es UUID sin consultar la base', async () => {
        const result = await setCompanyActive('no-es-uuid', true)

        expect(result.success).toBe(false)
        expect(result.error).toBe('Identificador de empresa inválido')
        expect(mockFrom).not.toHaveBeenCalled()
    })

    it('rechaza un motivo mayor a 500 caracteres', async () => {
        const result = await setCompanyActive(VALID_UUID, false, 'x'.repeat(501))

        expect(result.success).toBe(false)
        expect(result.error).toContain('500')
        expect(mockFrom).not.toHaveBeenCalled()
    })

    it('devuelve error si la empresa no existe', async () => {
        mockFrom.mockImplementation(mockCompanyLookup(null))

        const result = await setCompanyActive(VALID_UUID, false)

        expect(result.success).toBe(false)
        expect(result.error).toBe('La empresa no existe')
    })

    it('no-op (success) si el estado ya es el pedido', async () => {
        const updateSpy = jest.fn()
        mockFrom.mockImplementation((table: string) => {
            if (table === 'companies') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            maybeSingle: jest.fn().mockResolvedValue({
                                data: { id: VALID_UUID, active: true },
                            }),
                        }),
                    }),
                    update: updateSpy,
                }
            }
        })

        const result = await setCompanyActive(VALID_UUID, true)

        expect(result.success).toBe(true)
        expect(updateSpy).not.toHaveBeenCalled()
    })

    it('desactiva con motivo por defecto y marca deactivated_at', async () => {
        const updateArgs: Array<Record<string, unknown>> = []
        mockFrom.mockImplementation((table: string) => {
            if (table === 'companies') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            maybeSingle: jest.fn().mockResolvedValue({
                                data: { id: VALID_UUID, active: true },
                            }),
                        }),
                    }),
                    update: jest.fn().mockImplementation((payload: Record<string, unknown>) => {
                        updateArgs.push(payload)
                        return {
                            eq: jest.fn().mockReturnValue({
                                then: (onFulfilled: (v: unknown) => unknown) =>
                                    onFulfilled({ error: null }),
                            }),
                        }
                    }),
                }
            }
        })

        const result = await setCompanyActive(VALID_UUID, false)

        expect(result.success).toBe(true)
        expect(updateArgs).toHaveLength(1)
        const payload = updateArgs[0]
        expect(payload.active).toBe(false)
        expect(typeof payload.deactivated_at).toBe('string')
        expect(payload.deactivation_reason).toBe(
            'Desactivada manualmente por el administrador de plataforma'
        )
    })

    it('usa el motivo provisto al desactivar', async () => {
        const updateArgs: Array<Record<string, unknown>> = []
        mockFrom.mockImplementation((table: string) => {
            if (table === 'companies') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            maybeSingle: jest.fn().mockResolvedValue({
                                data: { id: VALID_UUID, active: true },
                            }),
                        }),
                    }),
                    update: jest.fn().mockImplementation((payload: Record<string, unknown>) => {
                        updateArgs.push(payload)
                        return {
                            eq: jest.fn().mockReturnValue({
                                then: (onFulfilled: (v: unknown) => unknown) =>
                                    onFulfilled({ error: null }),
                            }),
                        }
                    }),
                }
            }
        })

        await setCompanyActive(VALID_UUID, false, '  cierre definitivo  ')

        expect(updateArgs[0].deactivation_reason).toBe('cierre definitivo')
    })

    it('al reactivar limpia deactivated_at y deactivation_reason', async () => {
        const updateArgs: Array<Record<string, unknown>> = []
        mockFrom.mockImplementation((table: string) => {
            if (table === 'companies') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            maybeSingle: jest.fn().mockResolvedValue({
                                data: { id: VALID_UUID, active: false },
                            }),
                        }),
                    }),
                    update: jest.fn().mockImplementation((payload: Record<string, unknown>) => {
                        updateArgs.push(payload)
                        return {
                            eq: jest.fn().mockReturnValue({
                                then: (onFulfilled: (v: unknown) => unknown) =>
                                    onFulfilled({ error: null }),
                            }),
                        }
                    }),
                }
            }
        })

        const result = await setCompanyActive(VALID_UUID, true)

        expect(result.success).toBe(true)
        expect(updateArgs[0]).toMatchObject({
            active: true,
            deactivated_at: null,
            deactivation_reason: null,
        })
    })

    it('rechaza al caller sin rol de plataforma', async () => {
        mockRequirePlatformRole.mockRejectedValueOnce(
            err('FORBIDDEN', 'FORBIDDEN: se requiere cuenta de plataforma (is_platform_admin=true), pero el usuario no la tiene')
        )

        const result = await setCompanyActive(VALID_UUID, false)

        expect(result.success).toBe(false)
        if (!result.success) expect(result.code).toBe('FORBIDDEN')
        expect(mockFrom).not.toHaveBeenCalled()
    })
})