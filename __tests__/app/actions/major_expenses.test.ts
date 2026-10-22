/**
 * Tests para modules/major-expenses/actions/major_expenses.ts (Fase 10 — multi-empresa + Fase 11 — multi-sucursal).
 *
 * Cubre el refactor del Bloque A (Fase 10) y del Bloque C (Fase 11):
 *   - addMajorExpense y deleteMajorExpense usan requireAuthContext + requireOwner
 *     para el check de owner (no leen profiles.role directamente).
 *   - Si el rol no es owner, debe lanzar error FORBIDDEN.
 *   - El created_by se toma de ctx.user.id (no de getUser() manual).
 *   - El company_id se toma de ctx.companyId (de requireAuthContext).
 *   - FASE 11 (Bloque C): el branch_id se toma de requireBranchContext() y se
 *     incluye en el INSERT y en el filtro del DELETE (defense in depth).
 *
 * Mocks: requireAuthContext, requireOwner, requireBranchContext, supabaseAdmin,
 * revalidatePath. (getCurrentCompanyId ya no se usa: companyId viene de ctx.)
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

const mockFrom = jest.fn()
jest.mock('../../../lib/supabase', () => ({
    supabaseAdmin: { from: mockFrom },
}))

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
}))

import { getMajorExpenses, addMajorExpense, deleteMajorExpense } from '../../../modules/major-expenses/actions/major_expenses'
import { err } from '../../../lib/errors'

type Chain = {
    select: jest.Mock
    insert: jest.Mock
    update: jest.Mock
    delete: jest.Mock
    eq: jest.Mock
    order: jest.Mock
    [key: string]: unknown
}

function makeBuilder(returnValue: { data?: unknown; error?: unknown }) {
    const b: Partial<Chain> & Record<string, unknown> = {}
    b.select = jest.fn().mockReturnValue(b)
    b.insert = jest.fn().mockReturnValue(b)
    b.update = jest.fn().mockReturnValue(b)
    b.delete = jest.fn().mockReturnValue(b)
    b.eq = jest.fn().mockReturnValue(b)
    b.order = jest.fn().mockResolvedValue(returnValue)
    // Terminal thenable
    ;(b as any).then = (onFulfilled: (v: unknown) => unknown) =>
        onFulfilled(returnValue)
    return b as Chain
}

describe('modules/major-expenses/actions/major_expenses.ts (Fase 10 + Fase 11 Bloque C)', () => {
    let consoleErrorSpy: jest.SpyInstance
    let consoleWarnSpy: jest.SpyInstance

    beforeEach(() => {
        mockFrom.mockReset()
        mockRequireAuthContext.mockReset()
        mockRequireOwner.mockReset()
        mockRequireBranchContext.mockReset()
        // Silenciar console.error/warn: los tests de error path ejercitan
        // handleActionError, que loguea siempre.
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
        // Default: caller es owner del tenant c-1 con sucursal b-1 activa
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
        // FASE 11: sucursal activa por defecto del usuario mockeado
        mockRequireBranchContext.mockResolvedValue({
            userId: 'owner-1',
            branchId: 'b-1',
        })
    })

    afterEach(() => {
        consoleErrorSpy.mockRestore()
        consoleWarnSpy.mockRestore()
    })

    describe('addMajorExpense', () => {
        it('usa requireAuthContext + requireOwner (no profiles.role)', async () => {
            const insertSpy = jest.fn().mockReturnThis()
            mockFrom.mockReturnValue({
                insert: insertSpy,
            })

            await addMajorExpense('rent', 'arriendo local', 500000, '2026-05-01', null)

            expect(mockRequireAuthContext).toHaveBeenCalledTimes(1)
            expect(mockRequireOwner).toHaveBeenCalledTimes(1)
            expect(mockRequireOwner).toHaveBeenCalledWith('owner')
            // FASE 11: también se llama requireBranchContext para el branch_id
            expect(mockRequireBranchContext).toHaveBeenCalledTimes(1)
        })

        it('inserta en major_expenses con company_id, branch_id y created_by del ctx', async () => {
            const insertArgs: unknown[] = []
            mockFrom.mockImplementation((table: string) => {
                if (table === 'major_expenses') {
                    return {
                        insert: jest.fn().mockImplementation((payload: unknown) => {
                            insertArgs.push(payload)
                            return {
                                then: (onFulfilled: (v: unknown) => unknown) =>
                                    onFulfilled({ error: null }),
                            }
                        }),
                    }
                }
                throw new Error(`Unexpected table: ${table}`)
            })

            await addMajorExpense(
                'utilities',
                'pago luz',
                350000,
                '2026-05-15',
                'nota importante'
            )

            expect(mockFrom).toHaveBeenCalledWith('major_expenses')
            expect(insertArgs).toHaveLength(1)
            const payload = insertArgs[0] as Record<string, unknown>
            expect(payload).toMatchObject({
                company_id: 'c-1', // de ctx.companyId
                branch_id: 'b-1', // FASE 11: de requireBranchContext
                category: 'utilities',
                description: 'pago luz',
                amount: 350000,
                expense_date: '2026-05-15',
                notes: 'nota importante',
                created_by: 'owner-1', // de ctx.user.id, NO de getUser() manual
            })
        })

        it('permite notes = null explícito', async () => {
            const insertArgs: unknown[] = []
            mockFrom.mockImplementation((table: string) => {
                if (table === 'major_expenses') {
                    return {
                        insert: jest.fn().mockImplementation((payload: unknown) => {
                            insertArgs.push(payload)
                            return {
                                then: (onFulfilled: (v: unknown) => unknown) =>
                                    onFulfilled({ error: null }),
                            }
                        }),
                    }
                }
            })

            await addMajorExpense('rent', 'arriendo', 100, '2026-05-01', null)

            const payload = insertArgs[0] as Record<string, unknown>
            expect(payload.notes).toBeNull()
        })

        it('rechaza con FORBIDDEN si el rol no es owner', async () => {
            mockRequireAuthContext.mockResolvedValueOnce({
                user: { id: 'mgr-1' },
                companyId: 'c-1',
                role: 'manager', // NO owner
                membership: {
                    user_id: 'mgr-1',
                    company_id: 'c-1',
                    role: 'manager',
                    is_default: true,
                    created_at: '2026-01-01',
                },
            })
            mockRequireOwner.mockImplementationOnce(() => {
                throw err('FORBIDDEN', "requireOwner: requires owner role, got 'manager'")
            })

            const result = await addMajorExpense('cat', 'desc', 1, '2026-05-01', null)

            expect(mockRequireOwner).toHaveBeenCalledWith('manager')
            expect(result.success).toBe(false)
            expect(result.code).toBe('FORBIDDEN')
            expect(mockFrom).not.toHaveBeenCalled()
            // FASE 11: si requireAuthContext/requireOwner falla, NO se llega
            // a llamar requireBranchContext.
            expect(mockRequireBranchContext).not.toHaveBeenCalled()
        })

        it('rechaza con UNAUTHENTICATED si requireAuthContext falla', async () => {
            mockRequireAuthContext.mockRejectedValueOnce(
                err('UNAUTHENTICATED', 'requireAuthContext: no active session')
            )

            const result = await addMajorExpense('cat', 'desc', 1, '2026-05-01', null)

            expect(result.success).toBe(false)
            expect(result.code).toBe('UNAUTHENTICATED')
            expect(mockFrom).not.toHaveBeenCalled()
            expect(mockRequireOwner).not.toHaveBeenCalled()
            expect(mockRequireBranchContext).not.toHaveBeenCalled()
        })

        it('rechaza con NO_BRANCH_CONTEXT si el usuario no tiene sucursal activa', async () => {
            // FASE 11: el owner puede no tener branch_membership (caso edge
            // de un owner recién creado sin sucursal asignada).
            mockRequireBranchContext.mockRejectedValueOnce(
                err('NO_BRANCH_CONTEXT', 'requireBranchContext: no active branch for owner-1')
            )

            const result = await addMajorExpense('cat', 'desc', 1, '2026-05-01', null)

            expect(result.success).toBe(false)
            expect(result.code).toBe('NO_BRANCH_CONTEXT')
            expect(mockFrom).not.toHaveBeenCalled()
        })

        it('devuelve error EXTERNAL si la query falla', async () => {
            mockFrom.mockImplementation((table: string) => {
                if (table === 'major_expenses') {
                    return {
                        insert: jest.fn().mockReturnValue({
                            then: (onFulfilled: (v: unknown) => unknown) =>
                                onFulfilled({
                                    error: { message: 'foreign key violation' },
                                }),
                        }),
                    }
                }
            })

            const result = await addMajorExpense('cat', 'desc', 1, '2026-05-01', null)

            expect(result.success).toBe(false)
            expect(result.code).toBe('EXTERNAL')
        })
    })

    describe('deleteMajorExpense', () => {
        it('usa requireAuthContext + requireOwner (no profiles.role)', async () => {
            mockFrom.mockReturnValue(makeBuilder({ data: null, error: null }))

            await deleteMajorExpense('expense-uuid-1')

            expect(mockRequireAuthContext).toHaveBeenCalledTimes(1)
            expect(mockRequireOwner).toHaveBeenCalledTimes(1)
            expect(mockRequireOwner).toHaveBeenCalledWith('owner')
            // FASE 11: también se llama requireBranchContext para el filtro
            expect(mockRequireBranchContext).toHaveBeenCalledTimes(1)
        })

        it('elimina filtrando por id, company_id y branch_id (defense in depth)', async () => {
            const eqCalls: Array<[string, unknown]> = []
            mockFrom.mockImplementation((table: string) => {
                if (table === 'major_expenses') {
                    const builder: any = {
                        delete: jest.fn().mockReturnValue({
                            eq: jest.fn().mockImplementation((col: string, val: unknown) => {
                                eqCalls.push([col, val])
                                return {
                                    eq: jest.fn().mockImplementation((col2: string, val2: unknown) => {
                                        eqCalls.push([col2, val2])
                                        return {
                                            eq: jest.fn().mockImplementation((col3: string, val3: unknown) => {
                                                eqCalls.push([col3, val3])
                                                return {
                                                    then: (onFulfilled: (v: unknown) => unknown) =>
                                                        onFulfilled({ error: null }),
                                                }
                                            }),
                                        }
                                    }),
                                }
                            }),
                        }),
                    }
                    return builder
                }
            })

            await deleteMajorExpense('expense-uuid-1')

            // FASE 11: ahora son 3 eq: id, company_id, branch_id
            expect(eqCalls).toEqual([
                ['id', 'expense-uuid-1'],
                ['company_id', 'c-1'],
                ['branch_id', 'b-1'],
            ])
        })

        it('rechaza con FORBIDDEN si el rol no es owner', async () => {
            mockRequireAuthContext.mockResolvedValueOnce({
                user: { id: 'tech-1' },
                companyId: 'c-1',
                role: 'technician', // NO owner (aunque technician no debería llegar aquí)
                membership: {
                    user_id: 'tech-1',
                    company_id: 'c-1',
                    role: 'technician',
                    is_default: true,
                    created_at: '2026-01-01',
                },
            })
            mockRequireOwner.mockImplementationOnce(() => {
                throw err('FORBIDDEN', "requireOwner: requires owner role, got 'technician'")
            })

            const result = await deleteMajorExpense('any')

            expect(result.success).toBe(false)
            expect(result.code).toBe('FORBIDDEN')
            expect(mockFrom).not.toHaveBeenCalled()
            expect(mockRequireBranchContext).not.toHaveBeenCalled()
        })

        it('rechaza con NO_BRANCH_CONTEXT si el usuario no tiene sucursal activa', async () => {
            mockRequireBranchContext.mockRejectedValueOnce(
                err('NO_BRANCH_CONTEXT', 'requireBranchContext: no active branch for owner-1')
            )

            const result = await deleteMajorExpense('expense-uuid-1')

            expect(result.success).toBe(false)
            expect(result.code).toBe('NO_BRANCH_CONTEXT')
            expect(mockFrom).not.toHaveBeenCalled()
        })

        it('devuelve EXTERNAL si la query falla', async () => {
            mockFrom.mockImplementation((table: string) => {
                if (table === 'major_expenses') {
                    return {
                        delete: jest.fn().mockReturnValue({
                            eq: jest.fn().mockReturnValue({
                                eq: jest.fn().mockReturnValue({
                                    eq: jest.fn().mockReturnValue({
                                        then: (onFulfilled: (v: unknown) => unknown) =>
                                            onFulfilled({
                                                error: { message: 'row not found' },
                                            }),
                                    }),
                                }),
                            }),
                        }),
                    }
                }
            })

            const result = await deleteMajorExpense('expense-uuid-1')

            expect(result.success).toBe(false)
            expect(result.code).toBe('EXTERNAL')
        })
    })

    describe('getMajorExpenses', () => {
        it('usa requireBranchContext y filtra por branch_id (Fase 11)', async () => {
            const eqCalls: Array<[string, unknown]> = []
            const orderCalls: Array<[string, unknown]> = []
            mockFrom.mockImplementation((table: string) => {
                if (table === 'major_expenses') {
                    return {
                        select: jest.fn().mockReturnValue({
                            eq: jest.fn().mockImplementation((col: string, val: unknown) => {
                                eqCalls.push([col, val])
                                return {
                                    order: jest.fn().mockImplementation((col2: string, opts: unknown) => {
                                        orderCalls.push([col2, opts])
                                        return {
                                            then: (onFulfilled: (v: unknown) => unknown) =>
                                                onFulfilled({ data: [], error: null }),
                                        }
                                    }),
                                }
                            }),
                        }),
                    }
                }
            })

            await getMajorExpenses()

            expect(mockRequireBranchContext).toHaveBeenCalledTimes(1)
            expect(mockFrom).toHaveBeenCalledWith('major_expenses')
            expect(eqCalls).toEqual([['branch_id', 'b-1']])
            expect(orderCalls).toEqual([['expense_date', { ascending: false }]])
        })

        it('NO llama requireAuthContext ni requireOwner (solo lectura)', async () => {
            mockFrom.mockImplementation((table: string) => {
                if (table === 'major_expenses') {
                    return {
                        select: jest.fn().mockReturnValue({
                            eq: jest.fn().mockReturnValue({
                                order: jest.fn().mockReturnValue({
                                    then: (onFulfilled: (v: unknown) => unknown) =>
                                        onFulfilled({ data: [], error: null }),
                                }),
                            }),
                        }),
                    }
                }
            })

            await getMajorExpenses()

            expect(mockRequireAuthContext).not.toHaveBeenCalled()
            expect(mockRequireOwner).not.toHaveBeenCalled()
        })

        it('devuelve los gastos de la sucursal activa', async () => {
            const rows = [
                {
                    id: 'exp-1',
                    company_id: 'c-1',
                    branch_id: 'b-1',
                    category: 'rent',
                    description: 'arriendo',
                    amount: 500000,
                    expense_date: '2026-05-01',
                },
            ]
            mockFrom.mockImplementation((table: string) => {
                if (table === 'major_expenses') {
                    return {
                        select: jest.fn().mockReturnValue({
                            eq: jest.fn().mockReturnValue({
                                order: jest.fn().mockReturnValue({
                                    then: (onFulfilled: (v: unknown) => unknown) =>
                                        onFulfilled({ data: rows, error: null }),
                                }),
                            }),
                        }),
                    }
                }
            })

            const result = await getMajorExpenses()

            expect(result.success).toBe(true)
            expect(result.data).toEqual(rows)
        })

        it('devuelve EXTERNAL si la query falla', async () => {
            mockFrom.mockImplementation((table: string) => {
                if (table === 'major_expenses') {
                    return {
                        select: jest.fn().mockReturnValue({
                            eq: jest.fn().mockReturnValue({
                                order: jest.fn().mockReturnValue({
                                    then: (onFulfilled: (v: unknown) => unknown) =>
                                        onFulfilled({
                                            data: null,
                                            error: { message: 'permission denied' },
                                        }),
                                }),
                            }),
                        }),
                    }
                }
            })

            const result = await getMajorExpenses()

            expect(result.success).toBe(false)
            expect(result.code).toBe('EXTERNAL')
        })

        it('rechaza si el usuario no tiene sucursal activa', async () => {
            mockRequireBranchContext.mockRejectedValueOnce(
                err('NO_BRANCH_CONTEXT', 'requireBranchContext: no active branch for owner-1')
            )

            const result = await getMajorExpenses()

            expect(result.success).toBe(false)
            expect(result.code).toBe('NO_BRANCH_CONTEXT')
            expect(mockFrom).not.toHaveBeenCalled()
        })
    })
})