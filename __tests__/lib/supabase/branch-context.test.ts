/**
 * Tests para lib/supabase/branch-context.ts (Fase 11 — multi-sucursal).
 *
 * Cubre el helper de contexto de sucursal activa del usuario:
 *   - getCurrentBranchId: lee `app_metadata.branch_id` del JWT y valida la
 *     membrisía con `isUserInBranch`. Si JWT desincronizado o sin branch_id,
 *     hace fallback a la membrisía `is_default` (Fase 11.6). NO dispara
 *     side-effects sobre auth.users (Fase 11.7): la sincronización del
 *     JWT la hace `getUserProfile` (auth.ts) llamando a
 *     `syncBranchIdToJwtIfMissing`.
 *   - getCurrentBranchIdSafe: versión silenciosa que nunca lanza.
 *   - requireBranchContext: versión estricta para server actions
 *     operacionales. Lanza 'UNAUTHENTICATED' o 'NO_BRANCH_CONTEXT'.
 *     Tampoco dispara side-effects.
 *   - getUserDefaultBranchId: helper para resolver el default sin pasar
 *     por la lógica JWT.
 *   - syncBranchIdToJwtIfMissing: helper público (Fase 11.7) que sincroniza
 *     `app_metadata.branch_id` en auth.users. Idempotente: devuelve
 *     false si el JWT ya tiene el branch_id correcto.
 *
 * Mocks:
 *   - lib/supabase/server (createClient)
 *   - lib/supabase/membership-queries (isPlatformUser)
 *   - lib/supabase/branch-membership-queries (isUserInBranch, getActiveBranch)
 *   - lib/supabase (supabaseAdmin.auth.admin.updateUserById re-export)
 */

const mockGetUser = jest.fn()
const mockCreateClient = jest.fn(() => ({
    auth: { getUser: mockGetUser },
}))

jest.mock('../../../lib/supabase/server', () => ({
    createClient: (...args: unknown[]) => mockCreateClient(...args),
}))

const mockIsPlatformUser = jest.fn()
jest.mock('../../../lib/supabase/membership-queries', () => ({
    isPlatformUser: (...args: unknown[]) => mockIsPlatformUser(...args),
}))

const mockIsUserInBranch = jest.fn()
const mockGetActiveBranch = jest.fn()
jest.mock('../../../lib/supabase/branch-membership-queries', () => ({
    isUserInBranch: (...args: unknown[]) => mockIsUserInBranch(...args),
    getActiveBranch: (...args: unknown[]) => mockGetActiveBranch(...args),
}))

const mockUpdateUserById = jest.fn()
// supabaseAdmin se re-exporta desde branch-context, así que también lo
// mockeamos para no inicializar el cliente real (sin env vars en test).
jest.mock('../../../lib/supabase', () => ({
    supabaseAdmin: {
        from: jest.fn(),
        auth: {
            admin: {
                updateUserById: (...args: unknown[]) => mockUpdateUserById(...args),
            },
        },
    },
}))

import {
    getCurrentBranchId,
    getCurrentBranchIdSafe,
    getUserDefaultBranchId,
    requireBranchContext,
    syncBranchIdToJwtIfMissing,
} from '../../../lib/supabase/branch-context'

describe('branch-context.ts (Fase 11 — multi-sucursal)', () => {
    let consoleWarnSpy: jest.SpyInstance

    beforeEach(() => {
        mockGetUser.mockReset()
        mockIsPlatformUser.mockReset()
        mockIsUserInBranch.mockReset()
        mockGetActiveBranch.mockReset()
        mockUpdateUserById.mockReset()
        mockCreateClient.mockClear()
        // console.warn aparece cuando el JWT está desincronizado o cuando
        // la sync de JWT falla.
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
        // Por defecto, getActiveBranch devuelve null (sin default).
        // Tests individuales pueden sobreescribirlo.
        mockGetActiveBranch.mockResolvedValue(null)
        // Por defecto, updateUserById resuelve OK.
        mockUpdateUserById.mockResolvedValue({ data: { user: null }, error: null })
    })

    afterEach(() => {
        consoleWarnSpy.mockRestore()
    })

    describe('getCurrentBranchId — sesión', () => {
        it('devuelve null si no hay usuario (auth.getUser devuelve null)', async () => {
            mockGetUser.mockResolvedValue({ data: { user: null }, error: null })

            const branchId = await getCurrentBranchId()

            expect(branchId).toBeNull()
            // Importante: NO debe llegar a consultar platform admin / isUserInBranch
            expect(mockIsPlatformUser).not.toHaveBeenCalled()
            expect(mockIsUserInBranch).not.toHaveBeenCalled()
            expect(mockGetActiveBranch).not.toHaveBeenCalled()
        })

        it('devuelve null si auth.getUser devuelve error', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: { message: 'session missing' },
            })

            const branchId = await getCurrentBranchId()

            expect(branchId).toBeNull()
            expect(mockIsPlatformUser).not.toHaveBeenCalled()
        })
    })

    describe('getCurrentBranchId — platform admin', () => {
        it('devuelve null para técnicos (is_platform_admin=true)', async () => {
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'tech-1',
                        app_metadata: {},
                    },
                },
                error: null,
            })
            mockIsPlatformUser.mockResolvedValue(true)

            const branchId = await getCurrentBranchId()

            expect(branchId).toBeNull()
            // Platform admin → no se llega a isUserInBranch ni getActiveBranch
            // (ahorra queries).
            expect(mockIsUserInBranch).not.toHaveBeenCalled()
            expect(mockGetActiveBranch).not.toHaveBeenCalled()
        })

        it('devuelve null aunque el platform admin tenga JWT con branch_id', async () => {
            // Caso degenerado: is_platform_admin=true tiene precedencia absoluta.
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'tech-2',
                        app_metadata: { branch_id: 'b-heredado' },
                    },
                },
                error: null,
            })
            mockIsPlatformUser.mockResolvedValue(true)

            const branchId = await getCurrentBranchId()

            expect(branchId).toBeNull()
            expect(mockIsUserInBranch).not.toHaveBeenCalled()
            expect(mockGetActiveBranch).not.toHaveBeenCalled()
        })
    })

    describe('getCurrentBranchId — usuario con branch_id en JWT', () => {
        beforeEach(() => {
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'u-owner',
                        app_metadata: { branch_id: 'b-jwt' },
                    },
                },
                error: null,
            })
            mockIsPlatformUser.mockResolvedValue(false)
        })

        it('devuelve el branch_id del JWT si la membrisía existe', async () => {
            mockIsUserInBranch.mockResolvedValue(true)

            const branchId = await getCurrentBranchId()

            expect(branchId).toBe('b-jwt')
            expect(mockIsUserInBranch).toHaveBeenCalledWith('u-owner', 'b-jwt')
            // No debe intentar fallback si JWT ya es válido.
            expect(mockGetActiveBranch).not.toHaveBeenCalled()
            // No debe intentar sincronizar JWT si ya trae branch_id correcto.
            expect(mockUpdateUserById).not.toHaveBeenCalled()
        })

        it('hace fallback a is_default si la membrisía no existe (JWT desincronizado)', async () => {
            // Caso: el owner borró la membrisía del branch JWT pero el JWT
            // aún tiene el branch_id viejo. El fallback debe encontrar
            // b-default (is_default=true).
            //
            // FASE 11.7: `getCurrentBranchId` ya NO sincroniza el JWT
            // automáticamente (esa responsabilidad la tiene
            // `getUserProfile` → `syncBranchIdToJwtIfMissing`). Aquí
            // solo verificamos que devuelve el default correcto.
            mockIsUserInBranch.mockResolvedValue(false)
            mockGetActiveBranch.mockResolvedValue({
                membership: {
                    user_id: 'u-owner',
                    company_id: 'c-1',
                    branch_id: 'b-default',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01',
                },
                branch: {
                    id: 'b-default',
                    company_id: 'c-1',
                    code: 'MAIN',
                    name: 'Principal',
                    address: null,
                    phone: null,
                    is_main: true,
                    active: true,
                    created_at: '2026-01-01',
                },
            })

            const branchId = await getCurrentBranchId()

            expect(branchId).toBe('b-default')
            // console.warn se usa para alertar del JWT desincronizado.
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('JWT desincronizado')
            )
            // FASE 11.7: getCurrentBranchId NO escribe en auth.users.
            // El side-effect se delega a `syncBranchIdToJwtIfMissing`.
            expect(mockUpdateUserById).not.toHaveBeenCalled()
        })

        it('devuelve null si la membrisía JWT no existe Y no hay default', async () => {
            mockIsUserInBranch.mockResolvedValue(false)
            mockGetActiveBranch.mockResolvedValue(null)

            const branchId = await getCurrentBranchId()

            expect(branchId).toBeNull()
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('JWT desincronizado')
            )
            // No tiene sentido sincronizar JWT si no hay branch_id válido.
            expect(mockUpdateUserById).not.toHaveBeenCalled()
        })
    })

    describe('getCurrentBranchId — sin branch_id en JWT (fallback 11.6)', () => {
        beforeEach(() => {
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'u-no-branch',
                        app_metadata: { company_id: 'c-1' },
                    },
                },
                error: null,
            })
            mockIsPlatformUser.mockResolvedValue(false)
        })

        it('hace fallback a default cuando el JWT no tiene branch_id', async () => {
            // Caso: usuario pre-Fase 11 con JWT cacheado sin branch_id.
            // El fallback debe encontrar el default.
            //
            // FASE 11.7: `getCurrentBranchId` ya NO sincroniza el JWT.
            // La sincronización la hace `getUserProfile` llamando a
            // `syncBranchIdToJwtIfMissing`.
            mockGetActiveBranch.mockResolvedValue({
                membership: {
                    user_id: 'u-no-branch',
                    company_id: 'c-1',
                    branch_id: 'b-main',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01',
                },
                branch: {
                    id: 'b-main',
                    company_id: 'c-1',
                    code: 'MAIN',
                    name: 'Principal',
                    address: null,
                    phone: null,
                    is_main: true,
                    active: true,
                    created_at: '2026-01-01',
                },
            })

            const branchId = await getCurrentBranchId()

            expect(branchId).toBe('b-main')
            // No consulta isUserInBranch (no hay JWT branch_id que validar).
            expect(mockIsUserInBranch).not.toHaveBeenCalled()
            // Sí consulta getActiveBranch con companyId=undefined, jwtBranchId=undefined.
            expect(mockGetActiveBranch).toHaveBeenCalledWith(
                'u-no-branch',
                undefined,
                undefined
            )
            // FASE 11.7: getCurrentBranchId NO escribe en auth.users.
            expect(mockUpdateUserById).not.toHaveBeenCalled()
        })

        it('devuelve null si no hay JWT branch_id Y no hay default', async () => {
            // Caso degenerado: usuario sin membrisías (raro pero posible).
            mockGetActiveBranch.mockResolvedValue(null)

            const branchId = await getCurrentBranchId()

            expect(branchId).toBeNull()
            expect(mockIsUserInBranch).not.toHaveBeenCalled()
            // No sincroniza nada porque no hay branch_id válido que setear.
            expect(mockUpdateUserById).not.toHaveBeenCalled()
        })

        it('devuelve el default aunque app_metadata esté completamente vacío', async () => {
            mockGetUser.mockResolvedValueOnce({
                data: {
                    user: {
                        id: 'u-empty',
                        app_metadata: {},
                    },
                },
                error: null,
            })
            mockGetActiveBranch.mockResolvedValue({
                membership: {
                    user_id: 'u-empty',
                    company_id: 'c-1',
                    branch_id: 'b-fallback',
                    role: 'manager',
                    is_default: true,
                    created_at: '2026-01-01',
                },
                branch: {
                    id: 'b-fallback',
                    company_id: 'c-1',
                    code: 'NORTE',
                    name: 'Sucursal Norte',
                    address: null,
                    phone: null,
                    is_main: false,
                    active: true,
                    created_at: '2026-01-01',
                },
            })

            const branchId = await getCurrentBranchId()

            expect(branchId).toBe('b-fallback')
            // FASE 11.7: getCurrentBranchId NO escribe en auth.users aunque
            // viniera vacío. La sincronización la hace `getUserProfile`.
            expect(mockUpdateUserById).not.toHaveBeenCalled()
        })

        it('NO escribe en auth.users (Fase 11.7: side-effect movido a getUserProfile)', async () => {
            // Garantía explícita del contrato nuevo: getCurrentBranchId
            // es PURA (solo lectura). El side-effect se delega a
            // `syncBranchIdToJwtIfMissing` que `getUserProfile` llama
            // cuando detecta JWT desincronizado.
            mockGetActiveBranch.mockResolvedValue({
                membership: {
                    user_id: 'u-no-branch',
                    company_id: 'c-1',
                    branch_id: 'b-main',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01',
                },
                branch: {
                    id: 'b-main',
                    company_id: 'c-1',
                    code: 'MAIN',
                    name: 'Principal',
                    address: null,
                    phone: null,
                    is_main: true,
                    active: true,
                    created_at: '2026-01-01',
                },
            })

            await getCurrentBranchId()

            expect(mockUpdateUserById).not.toHaveBeenCalled()
        })
    })

    describe('getCurrentBranchIdSafe', () => {
        it('devuelve null si getCurrentBranchId devuelve null', async () => {
            mockGetUser.mockResolvedValue({ data: { user: null }, error: null })

            const branchId = await getCurrentBranchIdSafe()

            expect(branchId).toBeNull()
        })

        it('propaga el valor cuando getCurrentBranchId tiene éxito', async () => {
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'u-ok',
                        app_metadata: { branch_id: 'b-ok' },
                    },
                },
                error: null,
            })
            mockIsPlatformUser.mockResolvedValue(false)
            mockIsUserInBranch.mockResolvedValue(true)

            const branchId = await getCurrentBranchIdSafe()

            expect(branchId).toBe('b-ok')
        })
    })

    describe('getUserDefaultBranchId', () => {
        it('devuelve el branch_id del is_default cuando existe', async () => {
            mockGetActiveBranch.mockResolvedValue({
                membership: {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-default',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01',
                },
                branch: {
                    id: 'b-default',
                    company_id: 'c-1',
                    code: 'MAIN',
                    name: 'Principal',
                    address: null,
                    phone: null,
                    is_main: true,
                    active: true,
                    created_at: '2026-01-01',
                },
            })

            const branchId = await getUserDefaultBranchId('u-1')

            expect(branchId).toBe('b-default')
            // Llama getActiveBranch con companyId=undefined y jwtBranchId=undefined
            // para forzar fallback a is_default (no filtrar por empresa).
            expect(mockGetActiveBranch).toHaveBeenCalledWith('u-1', undefined, undefined)
        })

        it('devuelve null si no hay membrisías', async () => {
            mockGetActiveBranch.mockResolvedValue(null)

            const branchId = await getUserDefaultBranchId('u-empty')

            expect(branchId).toBeNull()
        })

        it('NO consulta isUserInBranch (es solo un lookup de default)', async () => {
            mockGetActiveBranch.mockResolvedValue({
                membership: {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-default',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01',
                },
                branch: {
                    id: 'b-default',
                    company_id: 'c-1',
                    code: 'MAIN',
                    name: 'Principal',
                    address: null,
                    phone: null,
                    is_main: true,
                    active: true,
                    created_at: '2026-01-01',
                },
            })

            await getUserDefaultBranchId('u-1')

            expect(mockIsUserInBranch).not.toHaveBeenCalled()
        })

        it('NO sincroniza el JWT (solo lee el default, no side-effects)', async () => {
            mockGetActiveBranch.mockResolvedValue({
                membership: {
                    user_id: 'u-1',
                    company_id: 'c-1',
                    branch_id: 'b-default',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01',
                },
                branch: {
                    id: 'b-default',
                    company_id: 'c-1',
                    code: 'MAIN',
                    name: 'Principal',
                    address: null,
                    phone: null,
                    is_main: true,
                    active: true,
                    created_at: '2026-01-01',
                },
            })

            await getUserDefaultBranchId('u-1')

            expect(mockUpdateUserById).not.toHaveBeenCalled()
        })
    })

    describe('requireBranchContext — sesión', () => {
        it('lanza UNAUTHENTICATED si no hay usuario', async () => {
            mockGetUser.mockResolvedValue({ data: { user: null }, error: null })

            await expect(requireBranchContext()).rejects.toThrow('UNAUTHENTICATED')
            // Importante: NO debe llegar a isPlatformUser / isUserInBranch
            expect(mockIsPlatformUser).not.toHaveBeenCalled()
            expect(mockIsUserInBranch).not.toHaveBeenCalled()
        })

        it('lanza UNAUTHENTICATED si auth.getUser devuelve error', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: { message: 'session missing' },
            })

            await expect(requireBranchContext()).rejects.toThrow('UNAUTHENTICATED')
        })
    })

    describe('requireBranchContext — platform admin', () => {
        it('lanza NO_BRANCH_CONTEXT si el usuario es platform admin', async () => {
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'tech-1',
                        app_metadata: {},
                    },
                },
                error: null,
            })
            mockIsPlatformUser.mockResolvedValue(true)

            await expect(requireBranchContext()).rejects.toThrow('NO_BRANCH_CONTEXT')
            // Platform admin → no llega a isUserInBranch
            expect(mockIsUserInBranch).not.toHaveBeenCalled()
        })
    })

    describe('requireBranchContext — sin branch_id en JWT (fallback 11.6)', () => {
        beforeEach(() => {
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'u-no-jwt',
                        app_metadata: { company_id: 'c-1' },
                    },
                },
                error: null,
            })
            mockIsPlatformUser.mockResolvedValue(false)
        })

        it('devuelve el default si existe (Fase 11.6 fallback)', async () => {
            // FASE 11.7: `requireBranchContext` ya NO sincroniza el JWT
            // automáticamente. La sincronización la hace `getUserProfile`
            // (auth.ts) que retorna `branch_sync_needed: boolean` para que
            // el cliente haga `window.location.reload()`.
            mockGetActiveBranch.mockResolvedValue({
                membership: {
                    user_id: 'u-no-jwt',
                    company_id: 'c-1',
                    branch_id: 'b-main',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01',
                },
                branch: {
                    id: 'b-main',
                    company_id: 'c-1',
                    code: 'MAIN',
                    name: 'Principal',
                    address: null,
                    phone: null,
                    is_main: true,
                    active: true,
                    created_at: '2026-01-01',
                },
            })

            const ctx = await requireBranchContext()

            expect(ctx).toEqual({ userId: 'u-no-jwt', branchId: 'b-main' })
            // FASE 11.7: requireBranchContext NO escribe en auth.users.
            expect(mockUpdateUserById).not.toHaveBeenCalled()
        })

        it('lanza NO_BRANCH_CONTEXT si no hay JWT branch_id Y no hay default', async () => {
            // Caso degenerado: usuario sin membrisías (raro pero posible).
            // NO es NO_COMPANY_CONTEXT; solo necesita que el owner le
            // asigne una sucursal.
            mockGetActiveBranch.mockResolvedValue(null)

            await expect(requireBranchContext()).rejects.toThrow('NO_BRANCH_CONTEXT')
            expect(mockIsUserInBranch).not.toHaveBeenCalled()
        })
    })

    describe('requireBranchContext — JWT branch_id inválido', () => {
        beforeEach(() => {
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'u-jwt-stale',
                        app_metadata: { branch_id: 'b-stale' },
                    },
                },
                error: null,
            })
            mockIsPlatformUser.mockResolvedValue(false)
        })

        it('hace fallback al default si la membrisía JWT no existe', async () => {
            mockIsUserInBranch.mockResolvedValue(false)
            mockGetActiveBranch.mockResolvedValue({
                membership: {
                    user_id: 'u-jwt-stale',
                    company_id: 'c-1',
                    branch_id: 'b-fallback',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01',
                },
                branch: {
                    id: 'b-fallback',
                    company_id: 'c-1',
                    code: 'MAIN',
                    name: 'Principal',
                    address: null,
                    phone: null,
                    is_main: true,
                    active: true,
                    created_at: '2026-01-01',
                },
            })

            const ctx = await requireBranchContext()

            expect(ctx).toEqual({ userId: 'u-jwt-stale', branchId: 'b-fallback' })
            // console.warn alerta del estado inconsistente.
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('sin membrisía')
            )
        })

        it('lanza NO_BRANCH_CONTEXT si JWT inválido Y no hay default', async () => {
            mockIsUserInBranch.mockResolvedValue(false)
            mockGetActiveBranch.mockResolvedValue(null)

            await expect(requireBranchContext()).rejects.toThrow('NO_BRANCH_CONTEXT')
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('sin membrisía')
            )
        })
    })

    describe('requireBranchContext — happy path', () => {
        it('devuelve { userId, branchId } si JWT branch_id es válido', async () => {
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'u-ok',
                        app_metadata: { branch_id: 'b-ok' },
                    },
                },
                error: null,
            })
            mockIsPlatformUser.mockResolvedValue(false)
            mockIsUserInBranch.mockResolvedValue(true)

            const ctx = await requireBranchContext()

            expect(ctx).toEqual({ userId: 'u-ok', branchId: 'b-ok' })
            expect(mockIsUserInBranch).toHaveBeenCalledWith('u-ok', 'b-ok')
            // No consulta default ni sincroniza JWT si JWT ya es válido.
            expect(mockGetActiveBranch).not.toHaveBeenCalled()
            expect(mockUpdateUserById).not.toHaveBeenCalled()
        })
    })

    describe('syncBranchIdToJwtIfMissing (Fase 11.7)', () => {
        // Helper público que `getUserProfile` (auth.ts) llama cuando
        // detecta que el JWT del cliente está desincronizado. Es la
        // nueva ubicación del side-effect que antes vivía dentro de
        // `getCurrentBranchId`.
        it('devuelve false y NO escribe si el JWT ya tiene el branch_id correcto', async () => {
            const result = await syncBranchIdToJwtIfMissing(
                'u-sync',
                'b-ok',
                { branch_id: 'b-ok', company_id: 'c-1' }
            )

            expect(result).toBe(false)
            // Idempotencia: no gastamos cuota de service_role en cada
            // carga del dashboard si el JWT ya está bien.
            expect(mockUpdateUserById).not.toHaveBeenCalled()
        })

        it('escribe y devuelve true si el JWT no tiene branch_id', async () => {
            const result = await syncBranchIdToJwtIfMissing(
                'u-new',
                'b-new',
                { company_id: 'c-1' }
            )

            expect(result).toBe(true)
            expect(mockUpdateUserById).toHaveBeenCalledWith(
                'u-new',
                expect.objectContaining({
                    app_metadata: expect.objectContaining({
                        branch_id: 'b-new',
                        company_id: 'c-1',
                    }),
                })
            )
        })

        it('escribe y devuelve true si el JWT tiene un branch_id distinto', async () => {
            const result = await syncBranchIdToJwtIfMissing(
                'u-switch',
                'b-new',
                { branch_id: 'b-stale', company_id: 'c-1' }
            )

            expect(result).toBe(true)
            expect(mockUpdateUserById).toHaveBeenCalledWith(
                'u-switch',
                expect.objectContaining({
                    app_metadata: expect.objectContaining({
                        branch_id: 'b-new', // nuevo
                        company_id: 'c-1', // preservado
                    }),
                })
            )
        })

        it('preserva todos los demás claims del JWT (merge)', async () => {
            await syncBranchIdToJwtIfMissing(
                'u-many',
                'b-target',
                {
                    branch_id: 'b-old',
                    company_id: 'c-1',
                    role: 'owner',
                    provider: 'email',
                }
            )

            expect(mockUpdateUserById).toHaveBeenCalledWith(
                'u-many',
                expect.objectContaining({
                    app_metadata: expect.objectContaining({
                        branch_id: 'b-target',
                        company_id: 'c-1',
                        role: 'owner',
                        provider: 'email',
                    }),
                })
            )
        })

        it('funciona con app_metadata vacío (caso degenerado)', async () => {
            const result = await syncBranchIdToJwtIfMissing('u-empty', 'b-fb', {})

            expect(result).toBe(true)
            expect(mockUpdateUserById).toHaveBeenCalledWith(
                'u-empty',
                expect.objectContaining({
                    app_metadata: expect.objectContaining({
                        branch_id: 'b-fb',
                    }),
                })
            )
        })

        it('lanza Error si la API falla (con mensaje del error)', async () => {
            mockUpdateUserById.mockResolvedValue({
                data: null,
                error: { message: 'service role rate limit' },
            })

            await expect(
                syncBranchIdToJwtIfMissing('u-fail', 'b-x', {})
            ).rejects.toThrow('syncBranchIdToJwtIfMissing(u-fail): service role rate limit')
        })
    })
})