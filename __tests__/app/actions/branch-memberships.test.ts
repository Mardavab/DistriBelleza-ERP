/**
 * Tests para app/actions/branch-memberships.ts (Fase 11 — Bloque B).
 *
 * Cubre las server actions de membresías de sucursal:
 *   - assignUserToBranchAction: solo owners. Valida UUID, role, membrisía
 *     de empresa del target, branch del tenant, branch activa. Marca
 *     is_default=true si es la primera.
 *   - removeUserFromBranchAction: solo owners. Rechaza quitar MAIN si
 *     es la única membrisía.
 *   - switchActiveBranchAction: actualiza `app_metadata.branch_id` y
 *     `app_metadata.role` en auth.users; marca is_default. Rechaza si
 *     no hay membrisía, si el caller es platform admin (A1) o si el
 *     branchId pertenece a OTRA empresa (C1 — cross-tenant swap).
 *     SIEMPRE escribe `app_metadata.company_id` desde `ctx.companyId`
 *     (validado por requireAuthContext), NUNCA desde `target.company_id`.
 *
 * Mocks:
 *   - lib/supabase/auth-helpers (requireAuthContext, requireOwner)
 *   - lib/supabase/membership-queries (isPlatformUser — defensa A1)
 *   - lib/supabase/server (createClient — refreshSession)
 *   - lib/supabase (supabaseAdmin.from + supabaseAdmin.auth.admin.updateUserById)
 *   - lib/supabase/branch-membership-queries (getUserBranches, isUserInBranch)
 *   - next/cache (revalidatePath → noop)
 */

const mockRequireAuthContext = jest.fn()
const mockRequireOwner = jest.fn()
jest.mock('../../../lib/supabase/auth-helpers', () => ({
    requireAuthContext: (...args: unknown[]) => mockRequireAuthContext(...args),
    requireOwner: (...args: unknown[]) => mockRequireOwner(...args),
}))

const mockIsPlatformUser = jest.fn()
jest.mock('../../../lib/supabase/membership-queries', () => ({
    isPlatformUser: (...args: unknown[]) => mockIsPlatformUser(...args),
}))

const mockAuthRefreshSession = jest.fn()
const mockCreateClient = jest.fn(() => ({
    auth: {
        refreshSession: mockAuthRefreshSession,
    },
}))
jest.mock('../../../lib/supabase/server', () => ({
    createClient: (...args: unknown[]) => mockCreateClient(...args),
}))

const mockFrom = jest.fn()
const mockUpdateUserById = jest.fn()
jest.mock('../../../lib/supabase', () => ({
    supabaseAdmin: {
        from: mockFrom,
        auth: {
            admin: {
                updateUserById: (...args: unknown[]) => mockUpdateUserById(...args),
            },
        },
    },
}))

const mockGetUserBranches = jest.fn()
const mockIsUserInBranch = jest.fn()
jest.mock('../../../lib/supabase/branch-membership-queries', () => ({
    getUserBranches: (...args: unknown[]) => mockGetUserBranches(...args),
    isUserInBranch: (...args: unknown[]) => mockIsUserInBranch(...args),
}))

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
}))

import {
    assignUserToBranchAction,
    removeUserFromBranchAction,
    switchActiveBranchAction,
} from '../../../app/actions/branch-memberships'
import { err } from '../../../lib/errors'

type Chain = {
    select: jest.Mock
    eq: jest.Mock
    update: jest.Mock
    upsert: jest.Mock
    delete: jest.Mock
    maybeSingle: jest.Mock
    [key: string]: unknown
}

/**
 * Builder "thenable" recursivo: cada método encadenable retorna el
 * propio builder (que también es thenable), permitiendo que el chain
 * crezca sin límite (.eq().eq().eq()...). Esto es esencial para los
 * flujos que encadenan varios .eq() (clear-then-set, multi-tenant
 * defense con id+company_id, etc).
 */
function makeBuilder(returnValue: { data?: unknown; error?: unknown }) {
    const b: any = {}
    b.select = jest.fn().mockReturnValue(b)
    b.eq = jest.fn().mockReturnValue(b)
    b.update = jest.fn().mockReturnValue(b)
    b.upsert = jest.fn().mockReturnValue(b)
    b.delete = jest.fn().mockReturnValue(b)
    b.maybeSingle = jest.fn().mockResolvedValue(returnValue)
    b.single = jest.fn().mockResolvedValue(returnValue)
    b.then = (onFulfilled: (v: unknown) => unknown) => onFulfilled(returnValue)
    return b as Chain
}

const VALID_USER = '11111111-1111-4111-8111-111111111111'
const VALID_BRANCH_MAIN = '22222222-2222-4222-8222-222222222222'
const VALID_BRANCH_NORTE = '33333333-3333-4333-8333-333333333333'

describe('app/actions/branch-memberships.ts (Fase 11 — Bloque B)', () => {
    let consoleErrorSpy: jest.SpyInstance
    let consoleWarnSpy: jest.SpyInstance

    beforeEach(() => {
        mockFrom.mockReset()
        mockRequireAuthContext.mockReset()
        mockRequireOwner.mockReset()
        mockIsPlatformUser.mockReset()
        mockGetUserBranches.mockReset()
        mockIsUserInBranch.mockReset()
        mockCreateClient.mockClear()
        mockAuthRefreshSession.mockReset()
        mockUpdateUserById.mockReset()
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
        // Default: caller es owner del tenant c-1 y NO es platform admin.
        mockRequireAuthContext.mockResolvedValue({
            user: { id: VALID_USER },
            companyId: 'c-1',
            role: 'owner',
            membership: {
                user_id: VALID_USER,
                company_id: 'c-1',
                role: 'owner',
                is_default: true,
                created_at: '2026-01-01',
            },
        })
        mockIsPlatformUser.mockResolvedValue(false)
    })

    afterEach(() => {
        consoleErrorSpy.mockRestore()
        consoleWarnSpy.mockRestore()
    })

    // ────────────────────────────────────────────────────────────────────
    // assignUserToBranchAction
    // ────────────────────────────────────────────────────────────────────
    describe('assignUserToBranchAction', () => {
        it('rechaza con VALIDATION si userId no es UUID', async () => {
            const result = await assignUserToBranchAction('not-uuid', VALID_BRANCH_MAIN, 'manager')

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION')
            expect(mockFrom).not.toHaveBeenCalled()
        })

        it('rechaza con VALIDATION si branchId no es UUID', async () => {
            const result = await assignUserToBranchAction(VALID_USER, 'not-uuid', 'manager')

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION')
        })

        it('rechaza con VALIDATION si el role no está permitido', async () => {
            const result = await assignUserToBranchAction(
                VALID_USER,
                VALID_BRANCH_MAIN,
                'superuser'
            )

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION')
            expect(mockFrom).not.toHaveBeenCalled()
        })

        it('rechaza con NOT_FOUND si el user no tiene company_membership', async () => {
            // Primer mockFrom: company_memberships.maybeSingle → null
            mockFrom.mockImplementation((table: string) => {
                if (table === 'company_memberships') {
                    return makeBuilder({ data: null, error: null })
                }
                throw new Error(`Unexpected: ${table}`)
            })

            const result = await assignUserToBranchAction(
                VALID_USER,
                VALID_BRANCH_MAIN,
                'manager'
            )

            expect(result.success).toBe(false)
            expect(result.code).toBe('NOT_FOUND')
        })

        it('rechaza con NOT_FOUND si la branch no pertenece al tenant', async () => {
            // company_memberships OK; branches.maybeSingle → null
            mockFrom.mockImplementation((table: string) => {
                if (table === 'company_memberships') {
                    return makeBuilder({
                        data: { user_id: VALID_USER, company_id: 'c-1' },
                        error: null,
                    })
                }
                if (table === 'branches') {
                    return makeBuilder({ data: null, error: null })
                }
                throw new Error(`Unexpected: ${table}`)
            })

            const result = await assignUserToBranchAction(
                VALID_USER,
                VALID_BRANCH_NORTE,
                'manager'
            )

            expect(result.success).toBe(false)
            expect(result.code).toBe('NOT_FOUND')
        })

        it('rechaza con VALIDATION si la branch está desactivada (active=false)', async () => {
            mockFrom.mockImplementation((table: string) => {
                if (table === 'company_memberships') {
                    return makeBuilder({
                        data: { user_id: VALID_USER, company_id: 'c-1' },
                        error: null,
                    })
                }
                if (table === 'branches') {
                    return makeBuilder({
                        data: { id: VALID_BRANCH_NORTE, company_id: 'c-1', active: false },
                        error: null,
                    })
                }
                throw new Error(`Unexpected: ${table}`)
            })

            const result = await assignUserToBranchAction(
                VALID_USER,
                VALID_BRANCH_NORTE,
                'manager'
            )

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION')
        })

        it('inserta con is_default=true si es la primera branch_membership del usuario', async () => {
            // getUserBranches → [] (primera membrisía)
            mockGetUserBranches.mockResolvedValue([])

            let upsertArgs: unknown
            mockFrom.mockImplementation((table: string) => {
                if (table === 'company_memberships') {
                    return makeBuilder({
                        data: { user_id: VALID_USER, company_id: 'c-1' },
                        error: null,
                    })
                }
                if (table === 'branches') {
                    return makeBuilder({
                        data: { id: VALID_BRANCH_NORTE, company_id: 'c-1', active: true },
                        error: null,
                    })
                }
                if (table === 'branch_memberships') {
                    const b = makeBuilder({ error: null })
                    b.upsert = jest.fn().mockImplementation((payload: unknown) => {
                        upsertArgs = payload
                        return makeBuilder({ error: null })
                    })
                    return b
                }
                throw new Error(`Unexpected: ${table}`)
            })

            const result = await assignUserToBranchAction(
                VALID_USER,
                VALID_BRANCH_NORTE,
                'manager'
            )

            expect(result.success).toBe(true)
            expect(upsertArgs).toMatchObject({
                user_id: VALID_USER,
                company_id: 'c-1',
                branch_id: VALID_BRANCH_NORTE,
                role: 'manager',
                is_default: true, // ← clave: primera membrisía
            })
        })

        it('inserta con is_default=false si el usuario ya tiene otras branch_memberships', async () => {
            mockGetUserBranches.mockResolvedValue([
                {
                    user_id: VALID_USER,
                    company_id: 'c-1',
                    branch_id: VALID_BRANCH_MAIN,
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01',
                },
            ])

            let upsertArgs: unknown
            mockFrom.mockImplementation((table: string) => {
                if (table === 'company_memberships') {
                    return makeBuilder({
                        data: { user_id: VALID_USER, company_id: 'c-1' },
                        error: null,
                    })
                }
                if (table === 'branches') {
                    return makeBuilder({
                        data: { id: VALID_BRANCH_NORTE, company_id: 'c-1', active: true },
                        error: null,
                    })
                }
                if (table === 'branch_memberships') {
                    const b = makeBuilder({ error: null })
                    b.upsert = jest.fn().mockImplementation((payload: unknown) => {
                        upsertArgs = payload
                        return makeBuilder({ error: null })
                    })
                    return b
                }
                throw new Error(`Unexpected: ${table}`)
            })

            const result = await assignUserToBranchAction(
                VALID_USER,
                VALID_BRANCH_NORTE,
                'manager'
            )

            expect(result.success).toBe(true)
            // No es la primera → is_default=false
            expect((upsertArgs as { is_default: boolean }).is_default).toBe(false)
        })

        it('hace clear del default anterior solo si es la primera membrisía (isFirst=true)', async () => {
            mockGetUserBranches.mockResolvedValue([]) // primera
            const updateCalls: Array<{ payload: unknown }> = []

            mockFrom.mockImplementation((table: string) => {
                if (table === 'company_memberships') {
                    return makeBuilder({
                        data: { user_id: VALID_USER, company_id: 'c-1' },
                        error: null,
                    })
                }
                if (table === 'branches') {
                    return makeBuilder({
                        data: { id: VALID_BRANCH_NORTE, company_id: 'c-1', active: true },
                        error: null,
                    })
                }
                if (table === 'branch_memberships') {
                    const b = makeBuilder({ error: null })
                    b.update = jest.fn().mockImplementation((payload: unknown) => {
                        updateCalls.push({ payload })
                        return makeBuilder({ error: null })
                    })
                    b.upsert = jest.fn().mockReturnValue(makeBuilder({ error: null }))
                    return b
                }
                throw new Error(`Unexpected: ${table}`)
            })

            await assignUserToBranchAction(VALID_USER, VALID_BRANCH_NORTE, 'manager')

            // Debe haber un update({ is_default: false }) para limpiar defaults
            // viejos del usuario (defense: por si el índice único parcial tenía basura).
            const clearCall = updateCalls.find(
                (c) => (c.payload as { is_default: boolean }).is_default === false
            )
            expect(clearCall).toBeDefined()
        })

        it('rechaza con CONFLICT en 23505 (membresía duplicada)', async () => {
            mockGetUserBranches.mockResolvedValue([])

            mockFrom.mockImplementation((table: string) => {
                if (table === 'company_memberships') {
                    return makeBuilder({
                        data: { user_id: VALID_USER, company_id: 'c-1' },
                        error: null,
                    })
                }
                if (table === 'branches') {
                    return makeBuilder({
                        data: { id: VALID_BRANCH_NORTE, company_id: 'c-1', active: true },
                        error: null,
                    })
                }
                if (table === 'branch_memberships') {
                    return makeBuilder({
                        error: { code: '23505', message: 'duplicate' },
                    })
                }
                throw new Error(`Unexpected: ${table}`)
            })

            const result = await assignUserToBranchAction(
                VALID_USER,
                VALID_BRANCH_NORTE,
                'manager'
            )

            expect(result.success).toBe(false)
            expect(result.code).toBe('CONFLICT')
        })

        it('rechaza con FORBIDDEN si el caller no es owner', async () => {
            mockRequireAuthContext.mockResolvedValueOnce({
                user: { id: VALID_USER },
                companyId: 'c-1',
                role: 'manager',
                membership: {
                    user_id: VALID_USER,
                    company_id: 'c-1',
                    role: 'manager',
                    is_default: true,
                    created_at: '2026-01-01',
                },
            })
            mockRequireOwner.mockImplementationOnce(() => {
                throw new Error('FORBIDDEN: se requiere rol owner')
            })

            const result = await assignUserToBranchAction(
                VALID_USER,
                VALID_BRANCH_NORTE,
                'manager'
            )

            expect(result.success).toBe(false)
            expect(mockFrom).not.toHaveBeenCalled()
        })
    })

    // ────────────────────────────────────────────────────────────────────
    // removeUserFromBranchAction
    // ────────────────────────────────────────────────────────────────────
    describe('removeUserFromBranchAction', () => {
        it('rechaza con VALIDATION si userId no es UUID', async () => {
            const result = await removeUserFromBranchAction('bad', VALID_BRANCH_MAIN)

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION')
            expect(mockFrom).not.toHaveBeenCalled()
        })

        it('rechaza con NOT_FOUND si la membrisía no existe (isUserInBranch=false)', async () => {
            mockIsUserInBranch.mockResolvedValue(false)

            const result = await removeUserFromBranchAction(VALID_USER, VALID_BRANCH_MAIN)

            expect(result.success).toBe(false)
            expect(result.code).toBe('NOT_FOUND')
            expect(mockFrom).not.toHaveBeenCalled()
        })

        it('rechaza quitar la única membrisía del usuario si es MAIN', async () => {
            mockIsUserInBranch.mockResolvedValue(true)
            mockGetUserBranches.mockResolvedValue([
                {
                    user_id: VALID_USER,
                    company_id: 'c-1',
                    branch_id: VALID_BRANCH_MAIN,
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01',
                },
            ])
            // branches.maybeSingle → is_main=true
            mockFrom.mockImplementation((table: string) => {
                if (table === 'branches') {
                    return makeBuilder({
                        data: { is_main: true },
                        error: null,
                    })
                }
                throw new Error(`Unexpected: ${table}`)
            })

            const result = await removeUserFromBranchAction(VALID_USER, VALID_BRANCH_MAIN)

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION')
            // El usuario vería "No se puede quitar la única membrisía del usuario en la sucursal principal."
            expect(result.error).toMatch(/principal/i)
        })

        it('permite quitar MAIN si el usuario tiene más de una membrisía', async () => {
            mockIsUserInBranch.mockResolvedValue(true)
            mockGetUserBranches.mockResolvedValue([
                {
                    user_id: VALID_USER,
                    company_id: 'c-1',
                    branch_id: VALID_BRANCH_MAIN,
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01',
                },
                {
                    user_id: VALID_USER,
                    company_id: 'c-1',
                    branch_id: VALID_BRANCH_NORTE,
                    role: 'manager',
                    is_default: false,
                    created_at: '2026-02-01',
                },
            ])

            const deleteCalls: Array<[string, unknown]> = []
            mockFrom.mockImplementation((table: string) => {
                if (table === 'branches') {
                    return makeBuilder({
                        data: { is_main: true },
                        error: null,
                    })
                }
                if (table === 'branch_memberships') {
                    const b: any = {
                        delete: jest.fn().mockReturnValue({
                            eq: jest.fn().mockImplementation((col: string, val: unknown) => {
                                deleteCalls.push([col, val])
                                const next: any = {
                                    eq: jest.fn().mockImplementation((c2: string, v2: unknown) => {
                                        deleteCalls.push([c2, v2])
                                        next.then = (onFulfilled: (v: unknown) => unknown) =>
                                            onFulfilled({ error: null })
                                        return next
                                    }),
                                }
                                return next
                            }),
                        }),
                    }
                    return b
                }
                throw new Error(`Unexpected: ${table}`)
            })

            const result = await removeUserFromBranchAction(VALID_USER, VALID_BRANCH_MAIN)

            expect(result.success).toBe(true)
            // delete.eq(user_id).eq(branch_id).eq(company_id)
            expect(deleteCalls).toContainEqual(['user_id', VALID_USER])
            expect(deleteCalls).toContainEqual(['branch_id', VALID_BRANCH_MAIN])
            expect(deleteCalls).toContainEqual(['company_id', 'c-1'])
        })

        it('permite quitar una branch no-MAIN (sin defensa extra)', async () => {
            mockIsUserInBranch.mockResolvedValue(true)
            mockGetUserBranches.mockResolvedValue([
                {
                    user_id: VALID_USER,
                    company_id: 'c-1',
                    branch_id: VALID_BRANCH_MAIN,
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01',
                },
                {
                    user_id: VALID_USER,
                    company_id: 'c-1',
                    branch_id: VALID_BRANCH_NORTE,
                    role: 'manager',
                    is_default: false,
                    created_at: '2026-02-01',
                },
            ])
            // branch.is_main = false
            mockFrom.mockImplementation((table: string) => {
                if (table === 'branches') {
                    return makeBuilder({
                        data: { is_main: false },
                        error: null,
                    })
                }
                if (table === 'branch_memberships') {
                    const b: any = {
                        delete: jest.fn().mockReturnValue({
                            eq: jest.fn().mockReturnValue({
                                eq: jest.fn().mockReturnValue({
                                    eq: jest.fn().mockReturnValue({
                                        then: (onFulfilled: (v: unknown) => unknown) =>
                                            onFulfilled({ error: null }),
                                    }),
                                }),
                            }),
                        }),
                    }
                    return b
                }
                throw new Error(`Unexpected: ${table}`)
            })

            const result = await removeUserFromBranchAction(VALID_USER, VALID_BRANCH_NORTE)

            expect(result.success).toBe(true)
        })

        it('rechaza con FORBIDDEN si el caller no es owner', async () => {
            mockRequireAuthContext.mockResolvedValueOnce({
                user: { id: VALID_USER },
                companyId: 'c-1',
                role: 'manager',
                membership: {
                    user_id: VALID_USER,
                    company_id: 'c-1',
                    role: 'manager',
                    is_default: true,
                    created_at: '2026-01-01',
                },
            })
            mockRequireOwner.mockImplementationOnce(() => {
                throw new Error('FORBIDDEN: se requiere rol owner')
            })

            const result = await removeUserFromBranchAction(VALID_USER, VALID_BRANCH_MAIN)

            expect(result.success).toBe(false)
            expect(mockFrom).not.toHaveBeenCalled()
        })
    })

    // ────────────────────────────────────────────────────────────────────
    // switchActiveBranchAction
    // ────────────────────────────────────────────────────────────────────
    describe('switchActiveBranchAction', () => {
        it('rechaza con error si requireAuthContext lanza (no consulta auth ni DB)', async () => {
            // requireAuthContext ya unifica la validación de sesión + membrisía.
            // Si falla por falta de sesión, la acción aborta antes de tocar
            // nada y `handleActionError` clasifica el `code` que trae el
            // AppError de la guardia.
            mockRequireAuthContext.mockRejectedValueOnce(
                err('UNAUTHENTICATED', 'requireAuthContext: no active session')
            )

            const result = await switchActiveBranchAction(VALID_BRANCH_NORTE)

            expect(result.success).toBe(false)
            expect(result.code).toBe('UNAUTHENTICATED')
            expect(mockUpdateUserById).not.toHaveBeenCalled()
            expect(mockFrom).not.toHaveBeenCalled()
        })

        it('rechaza con VALIDATION si branchId no es UUID', async () => {
            const result = await switchActiveBranchAction('not-uuid')

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION')
        })

        it('rechaza con NO_BRANCH_CONTEXT si el usuario es platform admin (defensa explícita A1)', async () => {
            mockIsPlatformUser.mockResolvedValueOnce(true)

            const result = await switchActiveBranchAction(VALID_BRANCH_NORTE)

            expect(result.success).toBe(false)
            expect(result.code).toBe('NO_BRANCH_CONTEXT')
            // CRÍTICO: no debe tocar auth.users ni branch_memberships
            expect(mockUpdateUserById).not.toHaveBeenCalled()
            expect(mockFrom).not.toHaveBeenCalled()
        })

        it('filtra getUserBranches por companyId del JWT (defensa multi-tenant C1)', async () => {
            // El test verifica que getUserBranches recibe ctx.companyId
            // como segundo argumento, no undefined. Esto cierra el bug que
            // permitía un branchId cross-tenant.
            mockGetUserBranches.mockResolvedValue([
                {
                    user_id: VALID_USER,
                    company_id: 'c-1',
                    branch_id: VALID_BRANCH_NORTE,
                    role: 'manager',
                    is_default: false,
                    created_at: '2026-02-01',
                },
            ])
            mockUpdateUserById.mockResolvedValue({ error: null })
            mockFrom.mockImplementation(() => makeBuilder({ error: null }))

            await switchActiveBranchAction(VALID_BRANCH_NORTE)

            expect(mockGetUserBranches).toHaveBeenCalledWith(VALID_USER, 'c-1')
        })

        it('rechaza con FORBIDDEN si el usuario no tiene membrisía en la branch destino', async () => {
            mockGetUserBranches.mockResolvedValue([
                {
                    user_id: VALID_USER,
                    company_id: 'c-1',
                    branch_id: VALID_BRANCH_MAIN,
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01',
                },
            ])

            const result = await switchActiveBranchAction(VALID_BRANCH_NORTE)

            expect(result.success).toBe(false)
            expect(result.code).toBe('FORBIDDEN')
            expect(mockUpdateUserById).not.toHaveBeenCalled()
        })

        it('rechaza con FORBIDDEN si branchId pertenece a OTRA empresa (cross-tenant swap C1)', async () => {
            // El filtro de getUserBranches ya excluye la membrisía de otra
            // empresa, así que el resultado es [] y el find falla.
            mockGetUserBranches.mockResolvedValue([])

            const result = await switchActiveBranchAction(VALID_BRANCH_NORTE)

            expect(result.success).toBe(false)
            expect(result.code).toBe('FORBIDDEN')
            expect(mockUpdateUserById).not.toHaveBeenCalled()
            // El filtro DEBE ser por companyId del JWT, no undefined.
            expect(mockGetUserBranches).toHaveBeenCalledWith(VALID_USER, 'c-1')
        })

        it('rechaza con FORBIDDEN si target.company_id difiere del tenant activo (defensa en profundidad)', async () => {
            // Doble check: aunque getUserBranches filtró por company_id,
            // si por bug regresara una fila de otra empresa, este guard
            // lo detecta antes de tocar app_metadata.
            mockGetUserBranches.mockResolvedValue([
                {
                    user_id: VALID_USER,
                    company_id: 'c-OTRA', // ← empresa distinta a la del JWT
                    branch_id: VALID_BRANCH_NORTE,
                    role: 'manager',
                    is_default: false,
                    created_at: '2026-02-01',
                },
            ])

            const result = await switchActiveBranchAction(VALID_BRANCH_NORTE)

            expect(result.success).toBe(false)
            expect(result.code).toBe('FORBIDDEN')
            expect(mockUpdateUserById).not.toHaveBeenCalled()
        })

        it('escribe app_metadata.company_id desde ctx.companyId (NO desde target.company_id)', async () => {
            const memberships = [
                {
                    user_id: VALID_USER,
                    company_id: 'c-1',
                    branch_id: VALID_BRANCH_NORTE,
                    role: 'manager',
                    is_default: false,
                    created_at: '2026-02-01',
                },
            ]
            mockGetUserBranches.mockResolvedValue(memberships)
            mockUpdateUserById.mockResolvedValue({ error: null })
            mockFrom.mockImplementation((table: string) => {
                if (table !== 'branch_memberships') {
                    throw new Error(`Unexpected: ${table}`)
                }
                return makeBuilder({ error: null })
            })

            const result = await switchActiveBranchAction(VALID_BRANCH_NORTE)

            expect(result.success).toBe(true)
            if (result.success) {
                expect(result.branchId).toBe(VALID_BRANCH_NORTE)
                expect(result.role).toBe('manager')
            }
            // CRÍTICO: company_id viene de ctx.companyId (validado por
            // requireAuthContext), NO de target.company_id.
            expect(mockUpdateUserById).toHaveBeenCalledWith(
                VALID_USER,
                expect.objectContaining({
                    app_metadata: expect.objectContaining({
                        company_id: 'c-1',
                        branch_id: VALID_BRANCH_NORTE,
                        role: 'manager',
                    }),
                })
            )
        })

        it('llama clear-then-set en branch_memberships para marcar la nueva como default', async () => {
            const memberships = [
                {
                    user_id: VALID_USER,
                    company_id: 'c-1',
                    branch_id: VALID_BRANCH_NORTE,
                    role: 'manager',
                    is_default: false,
                    created_at: '2026-02-01',
                },
            ]
            mockGetUserBranches.mockResolvedValue(memberships)
            mockUpdateUserById.mockResolvedValue({ error: null })

            const updateCalls: Array<{ payload: unknown }> = []
            const eqCalls: Array<[string, unknown]> = []

            mockFrom.mockImplementation((table: string) => {
                if (table !== 'branch_memberships') {
                    throw new Error(`Unexpected: ${table}`)
                }
                // Builder recursivo: cada .eq() registra en eqCalls y devuelve
                // el MISMO builder (que también es thenable).
                const chain: any = {
                    update: jest.fn().mockImplementation((payload: unknown) => {
                        updateCalls.push({ payload })
                        return chain
                    }),
                    eq: jest.fn().mockImplementation((col: string, val: unknown) => {
                        eqCalls.push([col, val])
                        return chain
                    }),
                    then: (onFulfilled: (v: unknown) => unknown) =>
                        onFulfilled({ error: null }),
                }
                return chain
            })

            await switchActiveBranchAction(VALID_BRANCH_NORTE)

            // Dos updates: clear (is_default=false) y set (is_default=true)
            expect(updateCalls).toHaveLength(2)
            expect(updateCalls[0].payload).toEqual({ is_default: false })
            expect(updateCalls[1].payload).toEqual({ is_default: true })
            // El set incluye (user_id, branchId)
            expect(eqCalls).toContainEqual(['user_id', VALID_USER])
            expect(eqCalls).toContainEqual(['branch_id', VALID_BRANCH_NORTE])
        })

        it('llama supabase.auth.refreshSession() tras actualizar app_metadata', async () => {
            const memberships = [
                {
                    user_id: VALID_USER,
                    company_id: 'c-1',
                    branch_id: VALID_BRANCH_NORTE,
                    role: 'manager',
                    is_default: false,
                    created_at: '2026-02-01',
                },
            ]
            mockGetUserBranches.mockResolvedValue(memberships)
            mockUpdateUserById.mockResolvedValue({ error: null })
            mockFrom.mockImplementation(() => makeBuilder({ error: null }))

            await switchActiveBranchAction(VALID_BRANCH_NORTE)

            expect(mockAuthRefreshSession).toHaveBeenCalledTimes(1)
        })

        it('rechaza con EXTERNAL si updateUserById falla', async () => {
            const memberships = [
                {
                    user_id: VALID_USER,
                    company_id: 'c-1',
                    branch_id: VALID_BRANCH_NORTE,
                    role: 'manager',
                    is_default: false,
                    created_at: '2026-02-01',
                },
            ]
            mockGetUserBranches.mockResolvedValue(memberships)
            mockUpdateUserById.mockResolvedValue({
                error: { message: 'auth update failed' },
            })

            const result = await switchActiveBranchAction(VALID_BRANCH_NORTE)

            expect(result.success).toBe(false)
            expect(result.code).toBe('EXTERNAL')
        })
    })
})
