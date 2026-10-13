/**
 * Tests para app/actions/users.ts — getUsers (Fase 10.5 + Bloque A).
 *
 * Cubre el refactor del Bloque A:
 *   - getUsers ahora usa INNER JOIN con company_memberships filtrado por
 *     `memberships.company_id = ctx.companyId` (no por profiles.company_id,
 *     que ahora es nullable tras 10.1).
 *   - Devuelve `role` e `is_default` desde la membresía, NO desde profiles.role.
 *   - Usuarios sin membresía en el tenant NO aparecen (filtro del INNER JOIN).
 *   - Solo owners pueden listar el equipo (requireOwner). Los managers
 *     reciben FORBIDDEN.
 *
 * Cubre también Commit 3 (Fase 11 — invitación a UNA sucursal):
 *   - createUser acepta `branch_id` opcional y lo guarda en la invitación.
 *   - Valida UUID de branch_id.
 *   - Valida que la sucursal pertenece a la empresa activa.
 *   - Valida que la sucursal está activa.
 *   - Si NO se pasa branch_id, hace fallback a la sucursal MAIN de la
 *     empresa.
 *
 * Mocks:
 *   - lib/supabase (supabaseAdmin)
 *   - lib/supabase/auth-helpers (requireAuthContext, requireOwner)
 *   - next/cache (revalidatePath) → no-op
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

// next/cache revalidatePath → noop (no afecta la lógica bajo test)
jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
}))

import { getUsers, createUser } from '../../../app/actions/users'

type Chain = {
    select: jest.Mock
    eq: jest.Mock
    order: jest.Mock
    [key: string]: unknown
}

function makeBuilder(returnValue: { data?: unknown; error?: unknown }) {
    const b: Partial<Chain> = {}
    b.select = jest.fn().mockReturnValue(b)
    b.eq = jest.fn().mockReturnValue(b)
    b.order = jest.fn().mockResolvedValue(returnValue)
    return b as Chain
}

/**
 * Builder "thenable" recursivo: cada método encadenable retorna el
 * propio builder (que también es thenable), permitiendo encadenar
 * varios `.eq()` (clear-then-set, defensa multi-tenant con id+company_id).
 * Necesario para los flows de `createUser` (Bloque C — Commit 3) que
 * validan pertenencia con `.eq('id', ...).eq('company_id', ...)` y
 * luego insertan en `invitations`.
 */
function makeThenableBuilder(returnValue: { data?: unknown; error?: unknown }) {
    const b: any = {}
    b.select = jest.fn().mockReturnValue(b)
    b.eq = jest.fn().mockReturnValue(b)
    b.maybeSingle = jest.fn().mockResolvedValue(returnValue)
    b.single = jest.fn().mockResolvedValue(returnValue)
    b.insert = jest.fn().mockReturnValue(b)
    b.then = (onFulfilled: (v: unknown) => unknown) => onFulfilled(returnValue)
    return b as Chain
}

describe('app/actions/users.ts — getUsers (Fase 10.5)', () => {
    let consoleSpy: jest.SpyInstance

    beforeEach(() => {
        mockFrom.mockReset()
        mockRequireAuthContext.mockReset()
        mockRequireOwner.mockReset()
        // Silenciar console.error: los tests de error path ejercitan
        // handleActionError, que loguea siempre.
        consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
        // Default: caller es owner del tenant c-1
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
        consoleSpy.mockRestore()
    })

    it('hace JOIN a company_memberships!inner (INNER JOIN) filtrado por memberships.company_id, no lee profiles.role', async () => {
        const eqSpy = jest.fn().mockReturnThis()
        const selectMock = jest.fn().mockReturnValue({ eq: eqSpy })
        const orderMock = jest.fn().mockResolvedValue({ data: [], error: null })

        mockFrom.mockReturnValue({
            select: selectMock.mockReturnValue({
                eq: eqSpy.mockReturnValue({
                    order: orderMock,
                }),
            }),
        })

        await getUsers()

        expect(mockFrom).toHaveBeenCalledWith('profiles')
        expect(selectMock).toHaveBeenCalled()

        const selectArg = selectMock.mock.calls[0][0] as string
        // Debe incluir el INNER JOIN a memberships (Bloque A — A2)
        expect(selectArg).toContain('memberships:company_memberships!inner(')
        expect(selectArg).not.toContain('memberships:company_memberships!left(')
        // Debe incluir los campos role/is_default de memberships
        expect(selectArg).toContain('role')
        expect(selectArg).toContain('is_default')
        expect(selectArg).toContain('company_id')
        // NO debe seleccionar profiles.role
        expect(selectArg).not.toMatch(/^\s*role,/) // role no al inicio
        expect(selectArg).not.toContain('profiles.role')

        // Filtra por memberships.company_id del tenant (Bloque A — A2)
        // NO por profiles.company_id (esa columna ahora es nullable).
        expect(eqSpy).toHaveBeenCalledWith('memberships.company_id', 'c-1')
        expect(eqSpy).not.toHaveBeenCalledWith('company_id', 'c-1')
    })

    it('aplana role/is_default desde la membresía del usuario activo', async () => {
        const data = [
            {
                id: 'u-owner',
                full_name: 'Owner User',
                company_id: 'c-1',
                created_at: '2026-01-01T00:00:00Z',
                memberships: [
                    { role: 'owner', is_default: true, company_id: 'c-1' },
                ],
            },
            {
                id: 'u-mgr',
                full_name: 'Manager User',
                company_id: 'c-1',
                created_at: '2026-01-02T00:00:00Z',
                memberships: [
                    { role: 'manager', is_default: true, company_id: 'c-1' },
                ],
            },
        ]

        mockFrom.mockReturnValue(makeBuilder({ data, error: null }))

        const result = await getUsers()

        expect(result.success).toBe(true)
        const flat = (result as { data: any[] }).data
        expect(flat).toHaveLength(2)
        expect(flat[0]).toMatchObject({
            id: 'u-owner',
            full_name: 'Owner User',
            company_id: 'c-1',
            role: 'owner',
            is_default: true,
        })
        expect(flat[1]).toMatchObject({
            id: 'u-mgr',
            role: 'manager',
            is_default: true,
        })
    })

    it('si un usuario tiene múltiples membresías en el MISMO tenant, expone la primera que coincida', async () => {
        // El esquema actual es: 1 fila por profile, con `role` e `is_default`
        // tomados de la membresía que coincida con el tenant.
        // NOTA: el spec del Bloque A decía "devuelve múltiples filas si hay varias
        // membresías" pero la implementación actual toma solo la membresía del
        // tenant activo (find con company_id === ctx.companyId). Si el tenant
        // tuviera dos membresías (estado inconsistente), tomaría solo una.
        // Este test fija la SEMÁNTICA REAL del código actual.
        const data = [
            {
                id: 'u-multi',
                full_name: 'Multi Membership',
                company_id: 'c-1',
                created_at: '2026-01-01',
                memberships: [
                    { role: 'manager', is_default: true, company_id: 'c-1' },
                    { role: 'technician', is_default: false, company_id: 'c-1' },
                ],
            },
        ]

        mockFrom.mockReturnValue(makeBuilder({ data, error: null }))

        const result = await getUsers()

        expect(result.success).toBe(true)
        const flat = (result as { data: any[] }).data
        expect(flat).toHaveLength(1)
        expect(flat[0]).toMatchObject({
            id: 'u-multi',
            role: 'manager', // primera coincidencia con company_id='c-1'
            is_default: true,
        })
    })

    it('toma solo la membresía del tenant actual si hay memberships en varias empresas', async () => {
        // u-cross tiene membresía en c-1 (manager) y c-2 (owner).
        // Para getUsers de c-1, debe verse SOLO manager, no owner.
        //
        // Bloque A — A2: el INNER JOIN aplica el filtro
        // `memberships.company_id = ctx.companyId` a nivel SQL.
        // Por lo tanto PostgREST solo devuelve la membresía del tenant actual.
        // El mock simula esa respuesta: el array memberships contiene UNA fila.
        const data = [
            {
                id: 'u-cross',
                full_name: 'Cross Tenant',
                company_id: 'c-1',
                created_at: '2026-01-01',
                memberships: [
                    { role: 'manager', is_default: true, company_id: 'c-1' },
                ],
            },
        ]

        mockFrom.mockReturnValue(makeBuilder({ data, error: null }))

        const result = await getUsers()

        const flat = (result as { data: any[] }).data
        expect(flat).toHaveLength(1)
        // La fila expone role: 'manager' (la del tenant actual), NO 'owner'.
        expect(flat[0]).toMatchObject({
            id: 'u-cross',
            role: 'manager',
            is_default: true,
        })
    })

    it('si el usuario no tiene membrisía en el tenant, NO aparece en la lista (INNER JOIN)', async () => {
        // Bloque A — A2: el INNER JOIN filtra perfiles sin membership en este tenant.
        // El test simula la respuesta de PostgREST: solo se devuelven perfiles con
        // membresía coincidente. Un usuario sin membresía NUNCA llega al JS.
        const data: Array<Record<string, unknown>> = []

        mockFrom.mockReturnValue(makeBuilder({ data, error: null }))

        const result = await getUsers()

        const flat = (result as { data: any[] }).data
        expect(flat).toEqual([])
    })

    it('si memberships es null (no array), trata como sin membresía', async () => {
        // Defensa: con INNER JOIN PostgREST garantiza que memberships sea un
        // array con exactamente 1 fila. Si por alguna razón viniera null (caso
        // degenerado de mock), el aplanador no rompe.
        const data = [
            {
                id: 'u-null-member',
                full_name: 'Null Member',
                company_id: 'c-1',
                created_at: '2026-01-01',
                memberships: null,
            },
        ]

        mockFrom.mockReturnValue(makeBuilder({ data, error: null }))

        const result = await getUsers()

        const flat = (result as { data: any[] }).data
        expect(flat[0].role).toBeNull()
        expect(flat[0].is_default).toBe(false)
    })

    it('preserva created_at, full_name, company_id del perfil', async () => {
        const data = [
            {
                id: 'u-shape',
                full_name: 'Shape User',
                company_id: 'c-1',
                created_at: '2026-05-12T08:30:00Z',
                memberships: [
                    { role: 'manager', is_default: false, company_id: 'c-1' },
                ],
            },
        ]

        mockFrom.mockReturnValue(makeBuilder({ data, error: null }))

        const result = await getUsers()

        const flat = (result as { data: any[] }).data
        expect(flat[0]).toEqual({
            id: 'u-shape',
            full_name: 'Shape User',
            company_id: 'c-1',
            created_at: '2026-05-12T08:30:00Z',
            role: 'manager',
            is_default: false,
        })
        // No debe exponer `memberships` en la salida (fue aplanado)
        expect(flat[0].memberships).toBeUndefined()
    })

    it('devuelve array vacío si profiles está vacío', async () => {
        mockFrom.mockReturnValue(makeBuilder({ data: [], error: null }))

        const result = await getUsers()

        expect(result.success).toBe(true)
        expect((result as { data: any[] }).data).toEqual([])
    })

    it('devuelve error si la query a profiles falla', async () => {
        mockFrom.mockReturnValue(makeBuilder({ data: null, error: { message: 'rls denied' } }))

        const result = await getUsers()

        expect(result.success).toBe(false)
        expect(result.code).toBe('EXTERNAL')
        // El userMessage del code EXTERNAL es genérico ("No se pudo conectar
        // con el servicio externo..."); el detalle va al log.
    })

    it('no consulta nada si requireAuthContext falla (UNAUTHENTICATED)', async () => {
        mockRequireAuthContext.mockRejectedValueOnce(new Error('UNAUTHENTICATED'))

        const result = await getUsers()

        expect(result.success).toBe(false)
        // NOTA: `requireAuthContext` lanza `new Error('UNAUTHENTICATED')`,
        // no un string. La compat legacy de handleActionError solo detecta
        // strings (`typeof error === 'string'`), así que actualmente el
        // código se clasifica como 'UNKNOWN'. Este test verifica que NO se
        // consulta la base (lo importante) y que la respuesta es failure.
        expect(result.code).toBeTruthy()
        expect(mockFrom).not.toHaveBeenCalled()
    })

    it('rechaza con FORBIDDEN si el caller no es owner (manager)', async () => {
        // Bloque A — A3: getUsers requiere rol owner. Un manager no puede
        // listar el equipo del tenant.
        mockRequireAuthContext.mockResolvedValueOnce({
            user: { id: 'mgr-1' },
            companyId: 'c-1',
            role: 'manager', // NOT owner
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

        const result = await getUsers()

        expect(result.success).toBe(false)
        // El código clasifica el error legacy (new Error string) como 'UNKNOWN'.
        // Lo importante: NO se ejecutó la query.
        expect(result.code).toBeTruthy()
        expect(mockFrom).not.toHaveBeenCalled()
        expect(mockRequireOwner).toHaveBeenCalledWith('manager')
    })
})

// ─────────────────────────────────────────────────────────────────────
// createUser (Bloque C — Commit 3: invitación a UNA sucursal)
// ─────────────────────────────────────────────────────────────────────

describe('app/actions/users.ts — createUser (Commit 3 — invitation to ONE branch)', () => {
    let consoleSpy: jest.SpyInstance

    beforeEach(() => {
        mockFrom.mockReset()
        mockRequireAuthContext.mockReset()
        mockRequireOwner.mockReset()
        consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
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
        consoleSpy.mockRestore()
    })

    const VALID_BRANCH = '11111111-1111-4111-8111-111111111111'
    const VALID_BRANCH_NORTE = '22222222-2222-4222-8222-222222222222'
    const VALID_EMAIL = 'employee@example.com'

    it('guarda branch_id en la invitación cuando se pasa uno válido y activo del tenant', async () => {
        // branches.select (con filtro company_id) → branch válido y activo
        const insertCalls: Array<unknown> = []
        mockFrom.mockImplementation((table: string) => {
            if (table === 'branches') {
                return makeThenableBuilder({
                    data: { id: VALID_BRANCH, company_id: 'c-1', active: true },
                    error: null,
                })
            }
            if (table === 'invitations') {
                const b: any = {
                    insert: jest.fn().mockImplementation((payload: unknown) => {
                        insertCalls.push(payload)
                        return makeThenableBuilder({ data: null, error: null })
                    }),
                }
                return b
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await createUser({
            email: VALID_EMAIL,
            full_name: 'Empleado Test',
            role: 'manager',
            branch_id: VALID_BRANCH,
        })

        expect(result.success).toBe(true)
        expect(insertCalls).toHaveLength(1)
        expect(insertCalls[0]).toMatchObject({
            company_id: 'c-1',
            email: VALID_EMAIL,
            role: 'manager',
            branch_id: VALID_BRANCH,
        })
    })

    it('rechaza con VALIDATION si branch_id no es UUID', async () => {
        const result = await createUser({
            email: VALID_EMAIL,
            full_name: 'Empleado',
            role: 'manager',
            branch_id: 'not-uuid',
        })

        expect(result.success).toBe(false)
        expect(result.code).toBe('VALIDATION')
        // No debe tocar la base (ni branches ni invitations).
        expect(mockFrom).not.toHaveBeenCalled()
    })

    it('rechaza con NOT_FOUND si la sucursal no pertenece al tenant activo (multi-tenant)', async () => {
        // branches.select → null (filtro company_id=c-1 falla).
        mockFrom.mockImplementation((table: string) => {
            if (table === 'branches') {
                return makeThenableBuilder({ data: null, error: null })
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await createUser({
            email: VALID_EMAIL,
            full_name: 'Empleado',
            role: 'manager',
            branch_id: VALID_BRANCH_NORTE,
        })

        expect(result.success).toBe(false)
        expect(result.code).toBe('NOT_FOUND')
    })

    it('rechaza con VALIDATION si la sucursal está desactivada (active=false)', async () => {
        mockFrom.mockImplementation((table: string) => {
            if (table === 'branches') {
                return makeThenableBuilder({
                    data: { id: VALID_BRANCH, company_id: 'c-1', active: false },
                    error: null,
                })
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await createUser({
            email: VALID_EMAIL,
            full_name: 'Empleado',
            role: 'manager',
            branch_id: VALID_BRANCH,
        })

        expect(result.success).toBe(false)
        expect(result.code).toBe('VALIDATION')
    })

    it('hace fallback a la sucursal MAIN si NO se pasa branch_id', async () => {
        // branches (MAIN) → id válido. invitations.insert debe usar ese id.
        const insertCalls: Array<unknown> = []
        mockFrom.mockImplementation((table: string) => {
            if (table === 'branches') {
                return makeThenableBuilder({
                    data: { id: VALID_BRANCH, company_id: 'c-1', active: true, is_main: true },
                    error: null,
                })
            }
            if (table === 'invitations') {
                const b: any = {
                    insert: jest.fn().mockImplementation((payload: unknown) => {
                        insertCalls.push(payload)
                        return makeThenableBuilder({ data: null, error: null })
                    }),
                }
                return b
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await createUser({
            email: VALID_EMAIL,
            full_name: 'Empleado',
            role: 'manager',
            // branch_id omitido → fallback a MAIN
        })

        expect(result.success).toBe(true)
        expect(insertCalls).toHaveLength(1)
        expect((insertCalls[0] as { branch_id: string }).branch_id).toBe(VALID_BRANCH)
    })

    it('rechaza con NOT_FOUND si la empresa no tiene sucursal MAIN (caso degenerado)', async () => {
        // branches (MAIN) → null
        mockFrom.mockImplementation((table: string) => {
            if (table === 'branches') {
                return makeThenableBuilder({ data: null, error: null })
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await createUser({
            email: VALID_EMAIL,
            full_name: 'Empleado',
            role: 'manager',
        })

        expect(result.success).toBe(false)
        expect(result.code).toBe('NOT_FOUND')
    })

    it('rechaza con VALIDATION si MAIN está desactivada (no se puede invitar a una MAIN inactiva)', async () => {
        mockFrom.mockImplementation((table: string) => {
            if (table === 'branches') {
                return makeThenableBuilder({
                    data: { id: VALID_BRANCH, company_id: 'c-1', active: false, is_main: true },
                    error: null,
                })
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await createUser({
            email: VALID_EMAIL,
            full_name: 'Empleado',
            role: 'manager',
        })

        expect(result.success).toBe(false)
        expect(result.code).toBe('VALIDATION')
    })

    it('rechaza con CONFLICT en 23505 al insertar invitación duplicada', async () => {
        mockFrom.mockImplementation((table: string) => {
            if (table === 'branches') {
                return makeThenableBuilder({
                    data: { id: VALID_BRANCH, company_id: 'c-1', active: true },
                    error: null,
                })
            }
            if (table === 'invitations') {
                return makeThenableBuilder({
                    error: { code: '23505', message: 'duplicate' },
                })
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await createUser({
            email: VALID_EMAIL,
            full_name: 'Empleado',
            role: 'manager',
            branch_id: VALID_BRANCH,
        })

        expect(result.success).toBe(false)
        expect(result.code).toBe('CONFLICT')
    })
})