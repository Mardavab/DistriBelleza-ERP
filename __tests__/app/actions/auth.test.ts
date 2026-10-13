/**
 * Tests para app/actions/auth.ts — getUserProfile (Fase 10.5 + 11.7).
 *
 * Cubre la función más importante del dashboard:
 *   - Sesión: devuelve null si no hay usuario o auth.getUser devuelve error.
 *   - Platform admin (is_platform_admin=true): role='technician',
 *     memberships=[], is_platform_admin=true, branch_sync_needed=false.
 *   - Profile: devuelve null si profile tiene error o no existe.
 *   - Membresía activa: devuelve null si no hay membresía.
 *   - Company fallback fetch (defensa en profundidad cuando
 *     activeMembership.companies viene null en el join).
 *   - Branch resolution con JWT branch_id válido: usa el JWT, sync
 *     idempotente, branch_sync_needed=false.
 *   - Branch resolution con JWT sin branch_id + membrisía is_default:
 *     usa el default como active_branch_id, sync escribe y devuelve
 *     true, branch_sync_needed=true. (Hallazgo ALTO #1 del auditor:
 *     sin este fallback syncBranchId era no-op efectivo y el cliente
 *     quedaba en loop infinito de refreshes.)
 *   - Branch resolution con JWT branch_id que no matchea ninguna
 *     branch_membership (JWT desincronizado): fallback a is_default,
 *     sync escribe, branch_sync_needed=true.
 *   - Branch resolution sin membrisía default: active_branch_id=null,
 *     branch_sync_needed=false.
 *   - syncBranchIdToJwtIfMissing lanza excepción: branch_sync_needed
 *     se queda en false (NO rompe la carga del dashboard), se loggea
 *     un warning.
 *
 * Mocks:
 *   - lib/supabase/server (createClient.auth.getUser)
 *   - lib/supabase (supabaseAdmin.from — profiles y companies)
 *   - lib/supabase/membership-queries (getUserMemberships, getActiveMembership, isPlatformUser)
 *   - lib/supabase/branch-membership-queries (getUserBranches)
 *   - lib/supabase/branch-context (syncBranchIdToJwtIfMissing)
 */

const mockGetUser = jest.fn()
const mockCreateClient = jest.fn(() => ({
    auth: { getUser: mockGetUser },
}))
jest.mock('../../../lib/supabase/server', () => ({
    createClient: (...args: unknown[]) => mockCreateClient(...args),
}))

const mockFrom = jest.fn()
jest.mock('../../../lib/supabase', () => ({
    supabaseAdmin: { from: (...args: unknown[]) => mockFrom(...args) },
}))

const mockGetUserMemberships = jest.fn()
const mockGetActiveMembership = jest.fn()
const mockIsPlatformUser = jest.fn()
jest.mock('../../../lib/supabase/membership-queries', () => ({
    getUserMemberships: (...args: unknown[]) => mockGetUserMemberships(...args),
    getActiveMembership: (...args: unknown[]) => mockGetActiveMembership(...args),
    isPlatformUser: (...args: unknown[]) => mockIsPlatformUser(...args),
}))

const mockGetUserBranches = jest.fn()
jest.mock('../../../lib/supabase/branch-membership-queries', () => ({
    getUserBranches: (...args: unknown[]) => mockGetUserBranches(...args),
}))

const mockSyncBranchIdToJwtIfMissing = jest.fn()
jest.mock('../../../lib/supabase/branch-context', () => ({
    syncBranchIdToJwtIfMissing: (...args: unknown[]) =>
        mockSyncBranchIdToJwtIfMissing(...args),
}))

import { getUserProfile } from '../../../app/actions/auth'

type Chain = {
    select: jest.Mock
    eq: jest.Mock
    maybeSingle: jest.Mock
    single: jest.Mock
    [key: string]: unknown
}

function makeBuilder(returnValue: { data?: unknown; error?: unknown }) {
    const b: any = {}
    b.select = jest.fn().mockReturnValue(b)
    b.eq = jest.fn().mockReturnValue(b)
    b.maybeSingle = jest.fn().mockResolvedValue(returnValue)
    b.single = jest.fn().mockResolvedValue(returnValue)
    return b as Chain
}

const VALID_USER_ID = 'user-1'
const VALID_COMPANY_ID = 'c-1'
const VALID_BRANCH_JWT = 'b-jwt'
const VALID_BRANCH_DEFAULT = 'b-default'

describe('app/actions/auth.ts — getUserProfile', () => {
    let consoleWarnSpy: jest.SpyInstance
    let consoleLogSpy: jest.SpyInstance

    beforeEach(() => {
        mockGetUser.mockReset()
        mockCreateClient.mockClear()
        mockFrom.mockReset()
        mockGetUserMemberships.mockReset()
        mockGetActiveMembership.mockReset()
        mockIsPlatformUser.mockReset()
        mockGetUserBranches.mockReset()
        mockSyncBranchIdToJwtIfMissing.mockReset()
        // console.warn aparece en paths de error y cuando el sync falla.
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
        // console.log aparece solo en el path defensivo antiguo (que
        // ya no se ejerce — lo limpiamos por si quedara algo).
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
        // Por defecto: sync es idempotente (no escribe).
        mockSyncBranchIdToJwtIfMissing.mockResolvedValue(false)
        // Por defecto: getUserMemberships devuelve [una membresía de c-1].
        mockGetUserMemberships.mockResolvedValue([
            {
                user_id: VALID_USER_ID,
                company_id: VALID_COMPANY_ID,
                role: 'owner',
                is_default: true,
                created_at: '2026-01-01',
                companies: {
                    id: VALID_COMPANY_ID,
                    slug: 'demo',
                    legal_name: 'Demo S.A.',
                    trade_name: 'Demo',
                    active: true,
                },
            },
        ])
        mockGetActiveMembership.mockResolvedValue({
            user_id: VALID_USER_ID,
            company_id: VALID_COMPANY_ID,
            role: 'owner',
            is_default: true,
            created_at: '2026-01-01',
            companies: {
                id: VALID_COMPANY_ID,
                slug: 'demo',
                legal_name: 'Demo S.A.',
                trade_name: 'Demo',
                active: true,
            },
        })
        // Por defecto: getUserBranches vacío (caso normal post-deploy).
        mockGetUserBranches.mockResolvedValue([])
        // Por defecto: no es platform admin.
        mockIsPlatformUser.mockResolvedValue(false)
        // Por defecto: profile existe.
        mockFrom.mockImplementation((table: string) => {
            if (table === 'profiles') {
                return makeBuilder({
                    data: { id: VALID_USER_ID, full_name: 'Demo User', company_id: VALID_COMPANY_ID },
                    error: null,
                })
            }
            if (table === 'companies') {
                return makeBuilder({
                    data: {
                        id: VALID_COMPANY_ID,
                        slug: 'demo',
                        trade_name: 'Demo',
                        legal_name: 'Demo S.A.',
                        currency: 'COP',
                        timezone: 'America/Bogota',
                    },
                    error: null,
                })
            }
            throw new Error(`Unexpected: ${table}`)
        })
    })

    afterEach(() => {
        consoleWarnSpy.mockRestore()
        consoleLogSpy.mockRestore()
    })

    // ─────────────────────────────────────────────────────────────────
    // Sesión
    // ─────────────────────────────────────────────────────────────────

    it('devuelve null si auth.getUser devuelve null (sin sesión)', async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })

        const result = await getUserProfile()

        expect(result).toBeNull()
        // No debe llegar a isPlatformUser ni al resto del flujo.
        expect(mockIsPlatformUser).not.toHaveBeenCalled()
        expect(mockFrom).not.toHaveBeenCalled()
    })

    it('devuelve null si auth.getUser devuelve error', async () => {
        mockGetUser.mockResolvedValueOnce({
            data: { user: null },
            error: { message: 'jwt expired' },
        })

        const result = await getUserProfile()

        expect(result).toBeNull()
        expect(mockIsPlatformUser).not.toHaveBeenCalled()
    })

    // ─────────────────────────────────────────────────────────────────
    // Platform admin
    // ─────────────────────────────────────────────────────────────────

    it('platform admin: devuelve role=technician, is_platform_admin=true, sin membresías ni branches', async () => {
        mockGetUser.mockResolvedValueOnce({
            data: {
                user: {
                    id: VALID_USER_ID,
                    app_metadata: {},
                },
            },
            error: null,
        })
        mockIsPlatformUser.mockResolvedValueOnce(true)

        const result = await getUserProfile()

        expect(result).not.toBeNull()
        expect(result).toMatchObject({
            id: VALID_USER_ID,
            role: 'technician',
            company_id: null,
            companies: null,
            memberships: [],
            active_membership: null,
            branch_memberships: [],
            active_branch_id: null,
            branch_role: null,
            is_platform_admin: true,
            branch_sync_needed: false,
        })
        // Platform admin: NO consulta profiles ni memberships ni branches.
        expect(mockFrom).not.toHaveBeenCalled()
        expect(mockGetUserMemberships).not.toHaveBeenCalled()
        expect(mockGetActiveMembership).not.toHaveBeenCalled()
        expect(mockGetUserBranches).not.toHaveBeenCalled()
        // Tampoco sincroniza JWT (no tiene branch_id).
        expect(mockSyncBranchIdToJwtIfMissing).not.toHaveBeenCalled()
    })

    // ─────────────────────────────────────────────────────────────────
    // Profile fetch
    // ─────────────────────────────────────────────────────────────────

    it('devuelve null si la query a profiles devuelve error', async () => {
        mockGetUser.mockResolvedValueOnce({
            data: {
                user: {
                    id: VALID_USER_ID,
                    app_metadata: { company_id: VALID_COMPANY_ID },
                },
            },
            error: null,
        })
        mockFrom.mockImplementation((table: string) => {
            if (table === 'profiles') {
                return makeBuilder({
                    data: null,
                    error: { message: 'rls denied' },
                })
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await getUserProfile()

        expect(result).toBeNull()
        // No debe continuar a memberships.
        expect(mockGetUserMemberships).not.toHaveBeenCalled()
    })

    it('devuelve null si el usuario no tiene fila en profiles', async () => {
        mockGetUser.mockResolvedValueOnce({
            data: {
                user: {
                    id: VALID_USER_ID,
                    app_metadata: { company_id: VALID_COMPANY_ID },
                },
            },
            error: null,
        })
        mockFrom.mockImplementation((table: string) => {
            if (table === 'profiles') {
                return makeBuilder({ data: null, error: null })
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await getUserProfile()

        expect(result).toBeNull()
    })

    // ─────────────────────────────────────────────────────────────────
    // Membresía activa
    // ─────────────────────────────────────────────────────────────────

    it('devuelve null si el usuario no tiene membresía activa', async () => {
        mockGetUser.mockResolvedValueOnce({
            data: {
                user: {
                    id: VALID_USER_ID,
                    app_metadata: { company_id: VALID_COMPANY_ID },
                },
            },
            error: null,
        })
        mockGetActiveMembership.mockResolvedValueOnce(null)

        const result = await getUserProfile()

        expect(result).toBeNull()
        // No debe llegar a cargar branches ni sync.
        expect(mockGetUserBranches).not.toHaveBeenCalled()
        expect(mockSyncBranchIdToJwtIfMissing).not.toHaveBeenCalled()
    })

    // ─────────────────────────────────────────────────────────────────
    // Company fallback fetch (defensa en profundidad)
    // ─────────────────────────────────────────────────────────────────

    it('hace fetch explícito de companies si activeMembership.companies es null (fallback)', async () => {
        mockGetUser.mockResolvedValueOnce({
            data: {
                user: {
                    id: VALID_USER_ID,
                    app_metadata: { company_id: VALID_COMPANY_ID },
                },
            },
            error: null,
        })
        mockGetActiveMembership.mockResolvedValueOnce({
            user_id: VALID_USER_ID,
            company_id: VALID_COMPANY_ID,
            role: 'owner',
            is_default: true,
            created_at: '2026-01-01',
            companies: null, // ← join falló, fallback necesario
        })

        const result = await getUserProfile()

        expect(result).not.toBeNull()
        expect(result?.companies).toMatchObject({
            id: VALID_COMPANY_ID,
            slug: 'demo',
            legal_name: 'Demo S.A.',
            trade_name: 'Demo',
            currency: 'COP',
            timezone: 'America/Bogota',
        })
        // Debe haber llamado a companies explícitamente.
        expect(mockFrom).toHaveBeenCalledWith('companies')
    })

    // ─────────────────────────────────────────────────────────────────
    // Branch resolution — JWT branch_id válido (caso normal post-deploy)
    // ─────────────────────────────────────────────────────────────────

    it('JWT branch_id válido y presente en branch_memberships: usa el JWT, sync idempotente', async () => {
        mockGetUser.mockResolvedValueOnce({
            data: {
                user: {
                    id: VALID_USER_ID,
                    app_metadata: {
                        company_id: VALID_COMPANY_ID,
                        branch_id: VALID_BRANCH_JWT,
                    },
                },
            },
            error: null,
        })
        mockGetUserBranches.mockResolvedValueOnce([
            {
                user_id: VALID_USER_ID,
                company_id: VALID_COMPANY_ID,
                branch_id: VALID_BRANCH_JWT,
                role: 'owner',
                is_default: true,
                created_at: '2026-01-01',
            },
            {
                user_id: VALID_USER_ID,
                company_id: VALID_COMPANY_ID,
                branch_id: 'b-otra',
                role: 'manager',
                is_default: false,
                created_at: '2026-01-02',
            },
        ])
        // sync devuelve false (idempotente: JWT ya tiene b-jwt).
        mockSyncBranchIdToJwtIfMissing.mockResolvedValueOnce(false)

        const result = await getUserProfile()

        expect(result?.active_branch_id).toBe(VALID_BRANCH_JWT)
        expect(result?.branch_role).toBe('owner')
        expect(result?.branch_sync_needed).toBe(false)
        // sync debe haber sido llamado con el branch_id del JWT y el
        // app_metadata completo (para merge de company_id, etc).
        expect(mockSyncBranchIdToJwtIfMissing).toHaveBeenCalledWith(
            VALID_USER_ID,
            VALID_BRANCH_JWT,
            expect.objectContaining({
                company_id: VALID_COMPANY_ID,
                branch_id: VALID_BRANCH_JWT,
            })
        )
    })

    // ─────────────────────────────────────────────────────────────────
    // JWT sin branch_id + 2+ branches — Hallazgo ALTO #1
    // ─────────────────────────────────────────────────────────────────

    it('JWT sin branch_id + membrisía is_default: usa default, sync escribe, branch_sync_needed=true', async () => {
        // Caso del bug del auditor: pre-Fase 11 usuario con JWT sin
        // branch_id y 2+ sucursales. Antes del fix, getUserProfile
        // resolvía activeBranchId=null (porque solo buscaba match
        // exacto por JWT.branch_id) y syncBranchIdToJwtIfMissing era
        // no-op efectivo. El cliente entraba en loop de refreshes.
        //
        // Tras el fix: activeBranchId=b-default (via fallback is_default),
        // sync escribe y devuelve true, branch_sync_needed=true.
        mockGetUser.mockResolvedValueOnce({
            data: {
                user: {
                    id: VALID_USER_ID,
                    app_metadata: {
                        company_id: VALID_COMPANY_ID,
                        // sin branch_id — caso del bug
                    },
                },
            },
            error: null,
        })
        mockGetUserBranches.mockResolvedValueOnce([
            {
                user_id: VALID_USER_ID,
                company_id: VALID_COMPANY_ID,
                branch_id: VALID_BRANCH_DEFAULT,
                role: 'owner',
                is_default: true, // ← el fallback lo va a elegir
                created_at: '2026-01-01',
            },
            {
                user_id: VALID_USER_ID,
                company_id: VALID_COMPANY_ID,
                branch_id: 'b-otra',
                role: 'manager',
                is_default: false,
                created_at: '2026-01-02',
            },
        ])
        // sync escribe (porque JWT.branch_id=undefined !== b-default).
        mockSyncBranchIdToJwtIfMissing.mockResolvedValueOnce(true)

        const result = await getUserProfile()

        expect(result?.active_branch_id).toBe(VALID_BRANCH_DEFAULT)
        expect(result?.branch_role).toBe('owner')
        expect(result?.branch_sync_needed).toBe(true)
        // branch_memberships expone AMBAS (incluida la no-default).
        expect(result?.branch_memberships).toHaveLength(2)
        // sync debe haberse llamado con b-default.
        expect(mockSyncBranchIdToJwtIfMissing).toHaveBeenCalledWith(
            VALID_USER_ID,
            VALID_BRANCH_DEFAULT,
            expect.objectContaining({ company_id: VALID_COMPANY_ID })
        )
    })

    // ─────────────────────────────────────────────────────────────────
    // JWT branch_id desincronizado (no matchea ninguna membrisía)
    // ─────────────────────────────────────────────────────────────────

    it('JWT branch_id desincronizado (no está en branch_memberships): fallback a is_default', async () => {
        // Caso: branch JWT fue eliminado o el JWT trae un branch_id
        // viejo. branchMemberships NO tiene b-jwt, entonces
        // syncBranchIdToJwtIfMissing se llama con b-default (el
        // fallback) y debe sobrescribir el JWT viejo.
        mockGetUser.mockResolvedValueOnce({
            data: {
                user: {
                    id: VALID_USER_ID,
                    app_metadata: {
                        company_id: VALID_COMPANY_ID,
                        branch_id: 'b-stale', // ← no existe en branch_memberships
                    },
                },
            },
            error: null,
        })
        mockGetUserBranches.mockResolvedValueOnce([
            {
                user_id: VALID_USER_ID,
                company_id: VALID_COMPANY_ID,
                branch_id: VALID_BRANCH_DEFAULT,
                role: 'owner',
                is_default: true,
                created_at: '2026-01-01',
            },
        ])
        // sync escribe porque b-stale !== b-default.
        mockSyncBranchIdToJwtIfMissing.mockResolvedValueOnce(true)

        const result = await getUserProfile()

        expect(result?.active_branch_id).toBe(VALID_BRANCH_DEFAULT)
        expect(result?.branch_sync_needed).toBe(true)
        // sync debe sobrescribir b-stale con b-default.
        expect(mockSyncBranchIdToJwtIfMissing).toHaveBeenCalledWith(
            VALID_USER_ID,
            VALID_BRANCH_DEFAULT,
            expect.objectContaining({ branch_id: 'b-stale' })
        )
    })

    // ─────────────────────────────────────────────────────────────────
    // JWT branch_id desincronizado + SIN is_default: active_branch_id=null
    // ─────────────────────────────────────────────────────────────────

    it('JWT branch_id desincronizado y sin is_default: active_branch_id=null, sync NO se llama', async () => {
        // Caso degenerado: usuario con 1 sola branch_membership y esa
        // memb NO es is_default (estado roto post-migración). activeBranchId
        // resuelve a null, sync NO se llama (porque requiere branchId
        // concreto).
        mockGetUser.mockResolvedValueOnce({
            data: {
                user: {
                    id: VALID_USER_ID,
                    app_metadata: {
                        company_id: VALID_COMPANY_ID,
                        branch_id: 'b-stale',
                    },
                },
            },
            error: null,
        })
        mockGetUserBranches.mockResolvedValueOnce([
            {
                user_id: VALID_USER_ID,
                company_id: VALID_COMPANY_ID,
                branch_id: 'b-otra',
                role: 'manager',
                is_default: false,
                created_at: '2026-01-01',
            },
        ])

        const result = await getUserProfile()

        expect(result?.active_branch_id).toBeNull()
        expect(result?.branch_role).toBeNull()
        expect(result?.branch_sync_needed).toBe(false)
        // sync NO se llama: no hay branchId canónico para setear.
        expect(mockSyncBranchIdToJwtIfMissing).not.toHaveBeenCalled()
    })

    // ─────────────────────────────────────────────────────────────────
    // Sin branch_memberships en la empresa activa
    // ─────────────────────────────────────────────────────────────────

    it('sin branch_memberships (owner sin asignar): active_branch_id=null, branch_sync_needed=false', async () => {
        mockGetUser.mockResolvedValueOnce({
            data: {
                user: {
                    id: VALID_USER_ID,
                    app_metadata: { company_id: VALID_COMPANY_ID },
                },
            },
            error: null,
        })
        mockGetUserBranches.mockResolvedValueOnce([])

        const result = await getUserProfile()

        expect(result?.active_branch_id).toBeNull()
        expect(result?.branch_role).toBeNull()
        expect(result?.branch_memberships).toEqual([])
        expect(result?.branch_sync_needed).toBe(false)
        expect(mockSyncBranchIdToJwtIfMissing).not.toHaveBeenCalled()
    })

    // ─────────────────────────────────────────────────────────────────
    // syncBranchIdToJwtIfMissing lanza excepción
    // ─────────────────────────────────────────────────────────────────

    it('sync lanza excepción: branch_sync_needed queda en false, log warn, devuelve el profile', async () => {
        // Hallazgo #3: sync NO debe romper la carga del dashboard si la
        // Admin API tiene rate-limit transitorio. branch_sync_needed se
        // queda en false (no podemos asegurar el flag desde el server),
        // y se loggea un warning para visibilidad.
        mockGetUser.mockResolvedValueOnce({
            data: {
                user: {
                    id: VALID_USER_ID,
                    app_metadata: { company_id: VALID_COMPANY_ID },
                },
            },
            error: null,
        })
        mockGetUserBranches.mockResolvedValueOnce([
            {
                user_id: VALID_USER_ID,
                company_id: VALID_COMPANY_ID,
                branch_id: VALID_BRANCH_DEFAULT,
                role: 'owner',
                is_default: true,
                created_at: '2026-01-01',
            },
        ])
        mockSyncBranchIdToJwtIfMissing.mockRejectedValueOnce(
            new Error('service role rate limit')
        )

        const result = await getUserProfile()

        expect(result).not.toBeNull()
        // active_branch_id sigue siendo el default calculado.
        expect(result?.active_branch_id).toBe(VALID_BRANCH_DEFAULT)
        // branch_sync_needed=false (no podemos prometer el flag).
        expect(result?.branch_sync_needed).toBe(false)
        // Debe haber loggeado un warning con contexto.
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            expect.stringContaining('syncBranchIdToJwtIfMissing failed')
        )
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            expect.stringContaining(VALID_USER_ID)
        )
    })

    // ─────────────────────────────────────────────────────────────────
    // Estructura de salida (shape check)
    // ─────────────────────────────────────────────────────────────────

    it('devuelve un objeto UserProfile con la forma esperada (Fase 11.7)', async () => {
        mockGetUser.mockResolvedValueOnce({
            data: {
                user: {
                    id: VALID_USER_ID,
                    app_metadata: {
                        company_id: VALID_COMPANY_ID,
                        branch_id: VALID_BRANCH_JWT,
                    },
                },
            },
            error: null,
        })
        mockGetUserBranches.mockResolvedValueOnce([
            {
                user_id: VALID_USER_ID,
                company_id: VALID_COMPANY_ID,
                branch_id: VALID_BRANCH_JWT,
                role: 'manager',
                is_default: true,
                created_at: '2026-01-01',
            },
        ])

        const result = await getUserProfile()

        // NOTA: el join de `getUserMemberships` solo trae
        // {id, slug, legal_name, trade_name, logo_url, active} desde
        // companies. NO trae currency/timezone — el código NO ejecuta el
        // fallback fetch cuando el join trae datos (parcial). El tipo
        // `UserProfile.companies` declara currency/timezone como
        // obligatorios, pero la implementación los omite cuando el
        // join tiene éxito. Este test fija la SEMÁNTICA REAL del código.
        expect(result).toMatchObject({
            id: VALID_USER_ID,
            full_name: 'Demo User',
            role: 'owner', // viene de activeMembership.role
            company_id: VALID_COMPANY_ID,
            companies: {
                id: VALID_COMPANY_ID,
                slug: 'demo',
                trade_name: 'Demo',
                legal_name: 'Demo S.A.',
            },
            memberships: expect.any(Array),
            active_membership: expect.objectContaining({
                user_id: VALID_USER_ID,
                company_id: VALID_COMPANY_ID,
                role: 'owner',
            }),
            branch_memberships: expect.any(Array),
            active_branch_id: VALID_BRANCH_JWT,
            branch_role: 'manager',
            is_platform_admin: false,
            branch_sync_needed: false,
        })
    })
})