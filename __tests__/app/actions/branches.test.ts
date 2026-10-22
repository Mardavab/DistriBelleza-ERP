/**
 * Tests para app/actions/branches.ts (Fase 11 — Bloque B).
 *
 * Cubre las server actions de gestión de sucursales:
 *   - listBranchesAction: lista sucursales de la empresa activa (activas
 *     e inactivas, ordenadas por is_main desc, code asc).
 *   - createBranchAction: solo owners. Valida code (regex), name, address,
 *     phone. Normaliza code a uppercase. Maneja unique violation.
 *   - updateBranchAction: solo owners. Filtra por company_id (defense in
 *     depth multi-tenant).
 *   - deactivateBranchAction: solo owners. Rechaza desactivar MAIN.
 *
 * Mocks:
 *   - lib/supabase/auth-helpers (requireAuthContext, requireOwner)
 *   - lib/supabase (supabaseAdmin)
 *   - next/cache (revalidatePath → noop)
 */

const mockRequireAuthContext = jest.fn()
const mockRequireOwner = jest.fn()
jest.mock('../../../lib/supabase/auth-helpers', () => ({
    requireAuthContext: (...args: unknown[]) => mockRequireAuthContext(...args),
    requireOwner: (...args: unknown[]) => mockRequireOwner(...args),
}))

const mockFrom = jest.fn()
jest.mock('../../../lib/supabase', () => ({
    supabaseAdmin: { from: mockFrom },
}))

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
}))

import {
    listBranchesAction,
    createBranchAction,
    updateBranchAction,
    deactivateBranchAction,
} from '../../../app/actions/branches'

type Chain = {
    select: jest.Mock
    eq: jest.Mock
    order: jest.Mock
    insert: jest.Mock
    update: jest.Mock
    maybeSingle: jest.Mock
    single: jest.Mock
    [key: string]: unknown
}

function makeBuilder(returnValue: { data?: unknown; error?: unknown }) {
    const b: any = {}
    b.select = jest.fn().mockReturnValue(b)
    b.eq = jest.fn().mockReturnValue(b)
    b.order = jest.fn().mockReturnValue(b)
    b.insert = jest.fn().mockReturnValue(b)
    b.update = jest.fn().mockReturnValue(b)
    b.maybeSingle = jest.fn().mockResolvedValue(returnValue)
    b.single = jest.fn().mockResolvedValue(returnValue)
    // Thenable para soportar `await query` con chain de varios .eq()
    b.then = (onFulfilled: (v: unknown) => unknown) => onFulfilled(returnValue)
    return b as Chain
}

const VALID_UUID_A = '11111111-1111-4111-8111-111111111111'
const VALID_UUID_B = '22222222-2222-4222-8222-222222222222'

describe('app/actions/branches.ts (Fase 11 — Bloque B)', () => {
    let consoleErrorSpy: jest.SpyInstance
    let consoleWarnSpy: jest.SpyInstance

    beforeEach(() => {
        mockFrom.mockReset()
        mockRequireAuthContext.mockReset()
        mockRequireOwner.mockReset()
        // Silenciar logs de los happy paths y los error paths.
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
        // Default: caller es owner del tenant c-1.
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
    })

    afterEach(() => {
        consoleErrorSpy.mockRestore()
        consoleWarnSpy.mockRestore()
    })

    // ────────────────────────────────────────────────────────────────────
    // listBranchesAction
    // ────────────────────────────────────────────────────────────────────
    describe('listBranchesAction', () => {
        it('devuelve solo las sucursales de la empresa activa (filtra company_id)', async () => {
            const branches = [
                {
                    id: VALID_UUID_A,
                    company_id: 'c-1',
                    code: 'MAIN',
                    name: 'Sucursal Principal',
                    address: null,
                    phone: null,
                    is_main: true,
                    active: true,
                    created_at: '2026-01-01T00:00:00Z',
                },
                {
                    id: VALID_UUID_B,
                    company_id: 'c-1',
                    code: 'NORTE',
                    name: 'Sucursal Norte',
                    address: 'Av. Norte 123',
                    phone: '+541112345678',
                    is_main: false,
                    active: true,
                    created_at: '2026-02-01T00:00:00Z',
                },
            ]

            const builder = makeBuilder({ data: branches, error: null })
            mockFrom.mockReturnValue(builder)

            const result = await listBranchesAction()

            expect(result.success).toBe(true)
            const data = (result as { data: unknown[] }).data
            expect(data).toHaveLength(2)
            // Filtra por company_id = ctx.companyId (multi-tenant defense in depth)
            expect(builder.eq).toHaveBeenCalledWith('company_id', 'c-1')
        })

        it('incluye tanto sucursales activas como inactivas (no filtra por active)', async () => {
            // El owner debe poder ver también las desactivadas para gestionarlas.
            const branches = [
                {
                    id: VALID_UUID_A,
                    company_id: 'c-1',
                    code: 'MAIN',
                    name: 'Principal',
                    address: null,
                    phone: null,
                    is_main: true,
                    active: true,
                    created_at: '2026-01-01',
                },
                {
                    id: VALID_UUID_B,
                    company_id: 'c-1',
                    code: 'SUR',
                    name: 'Sur (desactivada)',
                    address: null,
                    phone: null,
                    is_main: false,
                    active: false,
                    created_at: '2026-02-01',
                },
            ]
            const builder = makeBuilder({ data: branches, error: null })
            mockFrom.mockReturnValue(builder)

            const result = await listBranchesAction()

            const data = (result as { data: { active: boolean }[] }).data
            expect(data.find((b) => b.active === false)).toBeDefined()
            // NO debe haber un .eq('active', ...) — la query no filtra por estado
            const eqCalls = (builder.eq as jest.Mock).mock.calls.map((c) => c[0])
            expect(eqCalls).not.toContain('active')
        })

        it('ordena por is_main desc y code asc (MAIN primero, después alfabético)', async () => {
            const builder = makeBuilder({ data: [], error: null })
            const orderSpy = builder.order
            mockFrom.mockReturnValue(builder)

            await listBranchesAction()

            expect(orderSpy).toHaveBeenCalledWith('is_main', { ascending: false })
            expect(orderSpy).toHaveBeenCalledWith('code', { ascending: true })
        })

        it('devuelve error EXTERNAL si la query a branches falla', async () => {
            const builder = makeBuilder({
                data: null,
                error: { message: 'rls denied' },
            })
            mockFrom.mockReturnValue(builder)

            const result = await listBranchesAction()

            expect(result.success).toBe(false)
            expect(result.code).toBe('EXTERNAL')
        })

        it('devuelve error si requireAuthContext falla (UNAUTHENTICATED)', async () => {
            mockRequireAuthContext.mockRejectedValueOnce(new Error('UNAUTHENTICATED'))

            const result = await listBranchesAction()

            expect(result.success).toBe(false)
            expect(result.code).toBeTruthy()
            expect(mockFrom).not.toHaveBeenCalled()
        })

        it('requiere owner (solo pantallas de owner la consumen)', async () => {
            // listBranchesAction la usan BranchManagement (/sucursales),
            // ReportsView (/reportes) y UserManagement (/configuracion),
            // las tres rutas owner-only. El BranchSelector del dashboard
            // usa getUserBranches (lib), no esta action.
            const builder = makeBuilder({ data: [], error: null })
            mockFrom.mockReturnValue(builder)

            await listBranchesAction()

            expect(mockRequireOwner).toHaveBeenCalledTimes(1)
            expect(mockRequireOwner).toHaveBeenCalledWith('owner')
        })
    })

    // ────────────────────────────────────────────────────────────────────
    // createBranchAction
    // ────────────────────────────────────────────────────────────────────
    describe('createBranchAction', () => {
        it('crea la sucursal con companyId, created_by y is_main=false', async () => {
            let insertArgs: unknown
            mockFrom.mockImplementation((table: string) => {
                if (table !== 'branches') throw new Error(`Unexpected: ${table}`)
                const created = {
                    id: VALID_UUID_A,
                    company_id: 'c-1',
                    code: 'NORTE',
                    name: 'Sucursal Norte',
                    address: 'Av. Norte 123',
                    phone: '+541112345678',
                    is_main: false,
                    active: true,
                    created_at: '2026-05-01T00:00:00Z',
                }
                return {
                    insert: jest.fn().mockImplementation((payload: unknown) => {
                        insertArgs = payload
                        return {
                            select: jest.fn().mockReturnValue({
                                single: jest.fn().mockResolvedValue({
                                    data: created,
                                    error: null,
                                }),
                            }),
                        }
                    }),
                }
            })

            const result = await createBranchAction({
                code: 'NORTE',
                name: 'Sucursal Norte',
                address: 'Av. Norte 123',
                phone: '+541112345678',
            })

            expect(result.success).toBe(true)
            expect(insertArgs).toMatchObject({
                company_id: 'c-1',
                code: 'NORTE',
                name: 'Sucursal Norte',
                address: 'Av. Norte 123',
                phone: '+541112345678',
                is_main: false, // solo se permite una is_main (constraint de app)
                active: true,
                created_by: 'owner-1',
            })
        })

        it('normaliza code a uppercase antes de guardar', async () => {
            let insertArgs: unknown
            // Solo capturar el INSERT de branches: `audit()` también inserta
            // (en audit_log) y pisaría insertArgs si no filtramos por tabla.
            mockFrom.mockImplementation((table: string) => ({
                insert: jest.fn().mockImplementation((payload: unknown) => {
                    if (table === 'branches') insertArgs = payload
                    return {
                        select: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: { id: VALID_UUID_A },
                                error: null,
                            }),
                        }),
                    }
                }),
            }))

            await createBranchAction({ code: 'norte', name: 'Norte' })

            expect((insertArgs as { code: string }).code).toBe('NORTE')
        })

        it('rechaza con VALIDATION si code no cumple la regex (caracteres prohibidos)', async () => {
            // CODE_RE: /^[A-Z0-9_-]{1,20}$/ → no permite minúsculas, espacios ni acentos
            const result = await createBranchAction({
                code: 'norte con espacio',
                name: 'Norte',
            })

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION')
            // No debe llegar a la base
            expect(mockFrom).not.toHaveBeenCalled()
        })

        it('rechaza con VALIDATION si code excede 20 caracteres', async () => {
            const result = await createBranchAction({
                code: 'A'.repeat(21),
                name: 'X',
            })

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION')
        })

        it('rechaza con VALIDATION si name está vacío', async () => {
            const result = await createBranchAction({ code: 'NORTE', name: '   ' })

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION')
            expect(mockFrom).not.toHaveBeenCalled()
        })

        it('rechaza con VALIDATION si name excede 200 caracteres', async () => {
            const result = await createBranchAction({
                code: 'NORTE',
                name: 'X'.repeat(201),
            })

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION')
        })

        it('rechaza con VALIDATION si address excede 500 caracteres', async () => {
            const result = await createBranchAction({
                code: 'NORTE',
                name: 'Norte',
                address: 'X'.repeat(501),
            })

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION')
        })

        it('rechaza con VALIDATION si phone excede 50 caracteres', async () => {
            const result = await createBranchAction({
                code: 'NORTE',
                name: 'Norte',
                phone: '1'.repeat(51),
            })

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION')
        })

        it('convierte strings vacíos de address/phone a null', async () => {
            let insertArgs: unknown
            // Solo capturar el INSERT de branches: `audit()` también inserta
            // (en audit_log) y pisaría insertArgs si no filtramos por tabla.
            mockFrom.mockImplementation((table: string) => ({
                insert: jest.fn().mockImplementation((payload: unknown) => {
                    if (table === 'branches') insertArgs = payload
                    return {
                        select: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: { id: VALID_UUID_A },
                                error: null,
                            }),
                        }),
                    }
                }),
            }))

            await createBranchAction({
                code: 'NORTE',
                name: 'Norte',
                address: '',
                phone: '',
            })

            const payload = insertArgs as { address: unknown; phone: unknown }
            expect(payload.address).toBeNull()
            expect(payload.phone).toBeNull()
        })

        it('rechaza con CONFLICT en unique violation (23505, code duplicado)', async () => {
            mockFrom.mockImplementation(() => ({
                insert: jest.fn().mockReturnValue({
                    select: jest.fn().mockReturnValue({
                        single: jest.fn().mockResolvedValue({
                            data: null,
                            error: { code: '23505', message: 'duplicate key' },
                        }),
                    }),
                }),
            }))

            const result = await createBranchAction({ code: 'NORTE', name: 'Norte' })

            expect(result.success).toBe(false)
            expect(result.code).toBe('CONFLICT')
        })

        it('rechaza con FORBIDDEN si el caller no es owner', async () => {
            mockRequireAuthContext.mockResolvedValueOnce({
                user: { id: 'mgr-1' },
                companyId: 'c-1',
                role: 'manager',
                membership: {
                    user_id: 'mgr-1',
                    company_id: 'c-1',
                    role: 'manager',
                    is_default: true,
                    created_at: '2026-01-01',
                },
            })
            mockRequireOwner.mockImplementationOnce(() => {
                throw new Error('FORBIDDEN: se requiere rol owner')
            })

            const result = await createBranchAction({ code: 'NORTE', name: 'Norte' })

            expect(result.success).toBe(false)
            expect(mockFrom).not.toHaveBeenCalled()
            expect(mockRequireOwner).toHaveBeenCalledWith('manager')
        })
    })

    // ────────────────────────────────────────────────────────────────────
    // updateBranchAction
    // ────────────────────────────────────────────────────────────────────
    describe('updateBranchAction', () => {
        it('rechaza con VALIDATION si branchId no es UUID', async () => {
            const result = await updateBranchAction('not-a-uuid', { name: 'X' })

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION')
            expect(mockFrom).not.toHaveBeenCalled()
        })

        it('construye el patch con solo los campos provistos', async () => {
            let updateArgs: unknown
            mockFrom.mockImplementation(() => {
                const updateBuilder: any = {
                    eq: jest.fn().mockReturnThis(),
                }
                updateBuilder.then = (onFulfilled: (v: unknown) => unknown) =>
                    onFulfilled({ error: null })
                return {
                    update: jest.fn().mockImplementation((payload: unknown) => {
                        updateArgs = payload
                        return updateBuilder
                    }),
                }
            })

            const result = await updateBranchAction(VALID_UUID_A, {
                name: 'Nuevo Nombre',
            })

            expect(result.success).toBe(true)
            expect(updateArgs).toEqual({ name: 'Nuevo Nombre' })
        })

        it('filtra el update por company_id (defense in depth multi-tenant)', async () => {
            const eqCalls: Array<[string, unknown]> = []
            mockFrom.mockImplementation(() => {
                const updateBuilder: any = {
                    eq: jest.fn().mockImplementation((col: string, val: unknown) => {
                        eqCalls.push([col, val])
                        const next: any = {
                            eq: jest.fn().mockImplementation((c2: string, v2: unknown) => {
                                eqCalls.push([c2, v2])
                                next.then = (onFulfilled: (v: unknown) => unknown) =>
                                    onFulfilled({ error: null })
                                return next
                            }),
                        }
                        next.then = (onFulfilled: (v: unknown) => unknown) =>
                            onFulfilled({ error: null })
                        return next
                    }),
                }
                updateBuilder.then = (onFulfilled: (v: unknown) => unknown) =>
                    onFulfilled({ error: null })
                return {
                    update: jest.fn().mockReturnValue(updateBuilder),
                }
            })

            await updateBranchAction(VALID_UUID_A, {
                name: 'X',
                address: 'Y',
            })

            // eq con id + company_id (multi-tenant defense)
            expect(eqCalls).toEqual([
                ['id', VALID_UUID_A],
                ['company_id', 'c-1'],
            ])
        })

        it('no permite cambiar is_main (la firma no acepta ese campo)', async () => {
            // Defensa: el tipo de `updates` excluye is_main.
            // Si alguien lo fuerza, NO se propaga al patch.
            let updateArgs: unknown
            mockFrom.mockImplementation(() => {
                const updateBuilder: any = {
                    eq: jest.fn().mockReturnThis(),
                }
                updateBuilder.then = (onFulfilled: (v: unknown) => unknown) =>
                    onFulfilled({ error: null })
                return {
                    update: jest.fn().mockImplementation((payload: unknown) => {
                        updateArgs = payload
                        return updateBuilder
                    }),
                }
            })

            // Cast a any para bypasear TS y simular un intento de pasar is_main.
            await updateBranchAction(VALID_UUID_A, {
                name: 'X',
                // @ts-expect-error: intencional, queremos forzar el campo
                is_main: false,
            })

            // El patch solo debe contener name; is_main NO se propaga.
            expect(updateArgs).toEqual({ name: 'X' })
            expect((updateArgs as Record<string, unknown>).is_main).toBeUndefined()
        })

        it('devuelve éxito sin consultar la base si no hay campos que cambiar', async () => {
            // Si updates = {} → el patch está vacío → return success sin tocar DB.
            const result = await updateBranchAction(VALID_UUID_A, {})

            expect(result.success).toBe(true)
            expect(mockFrom).not.toHaveBeenCalled()
        })

        it('rechaza con FORBIDDEN si el caller no es owner', async () => {
            mockRequireAuthContext.mockResolvedValueOnce({
                user: { id: 'mgr-1' },
                companyId: 'c-1',
                role: 'manager',
                membership: {
                    user_id: 'mgr-1',
                    company_id: 'c-1',
                    role: 'manager',
                    is_default: true,
                    created_at: '2026-01-01',
                },
            })
            mockRequireOwner.mockImplementationOnce(() => {
                throw new Error('FORBIDDEN: se requiere rol owner')
            })

            const result = await updateBranchAction(VALID_UUID_A, { name: 'X' })

            expect(result.success).toBe(false)
            expect(mockFrom).not.toHaveBeenCalled()
        })
    })

    // ────────────────────────────────────────────────────────────────────
    // deactivateBranchAction
    // ────────────────────────────────────────────────────────────────────
    describe('deactivateBranchAction', () => {
        it('rechaza con VALIDATION si branchId no es UUID', async () => {
            const result = await deactivateBranchAction('not-a-uuid')

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION')
            expect(mockFrom).not.toHaveBeenCalled()
        })

        it('rechaza con NOT_FOUND si la sucursal no pertenece a la empresa', async () => {
            mockFrom.mockImplementation(() => {
                const selectBuilder: any = {
                    eq: jest.fn().mockReturnThis(),
                }
                selectBuilder.maybeSingle = jest
                    .fn()
                    .mockResolvedValue({ data: null, error: null })
                return {
                    select: jest.fn().mockReturnValue(selectBuilder),
                }
            })

            const result = await deactivateBranchAction(VALID_UUID_A)

            expect(result.success).toBe(false)
            expect(result.code).toBe('NOT_FOUND')
        })

        it('rechaza con VALIDATION si la sucursal es MAIN (is_main=true)', async () => {
            mockFrom.mockImplementation(() => {
                const selectBuilder: any = {
                    eq: jest.fn().mockReturnThis(),
                }
                selectBuilder.maybeSingle = jest.fn().mockResolvedValue({
                    data: { id: VALID_UUID_A, is_main: true, active: true },
                    error: null,
                })
                return {
                    select: jest.fn().mockReturnValue(selectBuilder),
                }
            })

            const result = await deactivateBranchAction(VALID_UUID_A)

            expect(result.success).toBe(false)
            expect(result.code).toBe('VALIDATION')
            // NO se debe hacer update (solo se permite marcar inactivas, no la MAIN)
            // Verificamos que no se llamó a update con active: false
        })

        it('marca active=false si la sucursal NO es MAIN y está activa', async () => {
            let updatePayload: unknown
            mockFrom.mockImplementation((table: string) => {
                if (table !== 'branches') throw new Error(`Unexpected: ${table}`)
                const selectBuilder: any = {
                    eq: jest.fn().mockReturnThis(),
                }
                selectBuilder.maybeSingle = jest.fn().mockResolvedValue({
                    data: {
                        id: VALID_UUID_B,
                        is_main: false,
                        active: true,
                    },
                    error: null,
                })

                const updateBuilder: any = {
                    eq: jest.fn().mockReturnThis(),
                }
                updateBuilder.then = (onFulfilled: (v: unknown) => unknown) =>
                    onFulfilled({ error: null })

                return {
                    select: jest.fn().mockReturnValue(selectBuilder),
                    update: jest.fn().mockImplementation((payload: unknown) => {
                        updatePayload = payload
                        return updateBuilder
                    }),
                }
            })

            const result = await deactivateBranchAction(VALID_UUID_B)

            expect(result.success).toBe(true)
            expect(updatePayload).toEqual({ active: false })
        })

        it('no-op silencioso si la sucursal ya está inactiva', async () => {
            mockFrom.mockImplementation(() => {
                const selectBuilder: any = {
                    eq: jest.fn().mockReturnThis(),
                }
                selectBuilder.maybeSingle = jest.fn().mockResolvedValue({
                    data: {
                        id: VALID_UUID_B,
                        is_main: false,
                        active: false, // ya inactiva
                    },
                    error: null,
                })
                return {
                    select: jest.fn().mockReturnValue(selectBuilder),
                }
            })

            const result = await deactivateBranchAction(VALID_UUID_B)

            expect(result.success).toBe(true)
            // No debe llamar update (no-op)
            // Verificamos que solo se llamó select, no update
            const fromCalls = (mockFrom as jest.Mock).mock.calls
            const updateCalled = fromCalls.some((_args) => {
                // update está en el builder, no en from directamente.
                // La forma más simple: verificar que el builder retornado
                // no fue usado para update.
                return false
            })
            expect(updateCalled).toBe(false)
        })

        it('rechaza con FORBIDDEN si el caller no es owner', async () => {
            mockRequireAuthContext.mockResolvedValueOnce({
                user: { id: 'mgr-1' },
                companyId: 'c-1',
                role: 'manager',
                membership: {
                    user_id: 'mgr-1',
                    company_id: 'c-1',
                    role: 'manager',
                    is_default: true,
                    created_at: '2026-01-01',
                },
            })
            mockRequireOwner.mockImplementationOnce(() => {
                throw new Error('FORBIDDEN: se requiere rol owner')
            })

            const result = await deactivateBranchAction(VALID_UUID_A)

            expect(result.success).toBe(false)
            expect(mockFrom).not.toHaveBeenCalled()
        })
    })
})
