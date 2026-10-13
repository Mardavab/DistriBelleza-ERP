/**
 * Tests para app/actions/users.ts — acceptInvitationAction
 * (Fase 4 + Fase 11 Bloque C — Commit 3).
 *
 * Cubre el flujo crítico de aceptación de invitaciones (no confundir
 * con `createUser`, que solo CREA la invitación):
 *
 *   - Token inválido / expirado (la RPC `accept_invitation` rechaza).
 *   - Validación de campos del FormData (token / password / full_name).
 *   - Ruta feliz con `invitations.branch_id` presente (post-migración 11.8).
 *   - Legacy fallback a MAIN cuando `invitations.branch_id` es null
 *     (invitaciones creadas antes de la migración 11.8).
 *   - MAIN inactiva → error claro.
 *   - MAIN inexistente → error claro.
 *   - Re-aceptación (23505 silencioso) — la membresía ya existe y la
 *     acción igualmente completa y devuelve success.
 *   - Propagación de `branch_id` a `auth.users.app_metadata` en el
 *     `createUser` (Fase 11 — el JWT emitido por Supabase tras
 *     createUser debe incluir el claim para que el usuario no quede con
 *     el JWT cacheado sin branch_id).
 *   - Marcar la invitación como usada (used_at, accepted_user_id).
 *   - Creación de branch_membership con is_default=true.
 *
 * Mocks:
 *   - lib/supabase (supabaseAdmin) — from/rpc/auth.admin.createUser
 *   - lib/errors → silenciar warnSilently en paths esperados
 */

const mockFrom = jest.fn()
const mockRpc = jest.fn()
const mockCreateUser = jest.fn()
jest.mock('../../../lib/supabase', () => ({
    supabaseAdmin: {
        from: (...args: unknown[]) => mockFrom(...args),
        rpc: (...args: unknown[]) => mockRpc(...args),
        auth: {
            admin: {
                createUser: (...args: unknown[]) => mockCreateUser(...args),
            },
        },
    },
}))

import { acceptInvitationAction } from '../../../app/actions/users'

type Chain = {
    select: jest.Mock
    eq: jest.Mock
    update: jest.Mock
    insert: jest.Mock
    maybeSingle: jest.Mock
    single: jest.Mock
    [key: string]: unknown
}

/**
 * Builder "thenable" recursivo: cada llamada encadenable retorna el
 * propio builder (que también es thenable), permitiendo que el chain
 * termine tanto con `.maybeSingle()` / `.single()` como con un `await`
 * directo (caso de `from(...).insert(...)` y
 * `from(...).update(...).eq(...).eq(...)` que NO usan .single()).
 *
 * El valor resuelto es único para toda la cadena (no se puede cambiar
 * entre métodos). Para tests que necesitan valores distintos entre
 * llamadas al mismo builder, usar `mockResolvedValueOnce` o cambiar
 * la lógica del test.
 *
 * `selectableInsertPayload` / `selectableUpdatePayload` capturan el
 * payload pasado al insert/update, accesibles para los asserts.
 */
function makeBuilder(returnValue: {
    data?: unknown
    error?: unknown
}) {
    const b: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue(returnValue),
        single: jest.fn().mockResolvedValue(returnValue),
        then: (onFulfilled: (v: unknown) => unknown) =>
            onFulfilled(returnValue),
    }
    return b as Chain
}

/**
 * Builder especializado que captura el payload de insert/update
 * para poder asertarlo en los tests. Cada llamada a `insert(payload)`
 *   o `update(payload)` guarda el argumento y devuelve el builder.
 *
 * El value por default es `{ error: null, data: null }` (Supabase
 * devuelve eso en operaciones de escritura exitosas).
 */
function makeCapturingBuilder(
    returnValue: { data?: unknown; error?: unknown } = { data: null, error: null }
) {
    const b: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        update: jest.fn().mockImplementation((payload: unknown) => {
            ;(b as { _lastUpdatePayload?: unknown })._lastUpdatePayload = payload
            return b
        }),
        insert: jest.fn().mockImplementation((payload: unknown) => {
            ;(b as { _lastInsertPayload?: unknown })._lastInsertPayload = payload
            return b
        }),
        maybeSingle: jest.fn().mockResolvedValue(returnValue),
        single: jest.fn().mockResolvedValue(returnValue),
        then: (onFulfilled: (v: unknown) => unknown) =>
            onFulfilled(returnValue),
    }
    return b as Chain & {
        _lastInsertPayload?: unknown
        _lastUpdatePayload?: unknown
    }
}

describe('app/actions/users.ts — acceptInvitationAction', () => {
    let consoleWarnSpy: jest.SpyInstance

    const VALID_TOKEN = 'token-abc-123'
    const VALID_PASSWORD = 'Password123!'
    const VALID_FULLNAME = 'Invitado Test'
    const VALID_EMAIL = 'invitado@example.com'
    const VALID_COMPANY_ID = 'c-1'
    const VALID_INVITATION_BRANCH = '11111111-1111-4111-8111-111111111111'
    const VALID_MAIN_BRANCH = '22222222-2222-4222-8222-222222222222'
    const NEW_USER_ID = 'u-new-1'

    function buildFormData(): FormData {
        const fd = new FormData()
        fd.append('token', VALID_TOKEN)
        fd.append('password', VALID_PASSWORD)
        fd.append('full_name', VALID_FULLNAME)
        return fd
    }

    beforeEach(() => {
        mockFrom.mockReset()
        mockRpc.mockReset()
        mockCreateUser.mockReset()
        // Silenciar warnSilently en los paths esperados.
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleWarnSpy.mockRestore()
    })

    // ─────────────────────────────────────────────────────────────────
    // Validación de inputs
    // ─────────────────────────────────────────────────────────────────

    it('rechaza si falta token', async () => {
        const fd = new FormData()
        fd.append('password', VALID_PASSWORD)
        fd.append('full_name', VALID_FULLNAME)

        const result = await acceptInvitationAction(fd)

        expect(result).toEqual({ error: 'Todos los campos son obligatorios.' })
        // NO debe llamar a Supabase si la validación falla (ahorrar
        // cuota de service_role y cerrar superficie de error).
        expect(mockRpc).not.toHaveBeenCalled()
        expect(mockFrom).not.toHaveBeenCalled()
        expect(mockCreateUser).not.toHaveBeenCalled()
    })

    it('rechaza si falta password', async () => {
        const fd = new FormData()
        fd.append('token', VALID_TOKEN)
        fd.append('full_name', VALID_FULLNAME)

        const result = await acceptInvitationAction(fd)

        expect(result).toEqual({ error: 'Todos los campos son obligatorios.' })
        expect(mockRpc).not.toHaveBeenCalled()
    })

    it('rechaza si falta full_name', async () => {
        const fd = new FormData()
        fd.append('token', VALID_TOKEN)
        fd.append('password', VALID_PASSWORD)

        const result = await acceptInvitationAction(fd)

        expect(result).toEqual({ error: 'Todos los campos son obligatorios.' })
        expect(mockRpc).not.toHaveBeenCalled()
    })

    // ─────────────────────────────────────────────────────────────────
    // Token inválido / expirado (la RPC rechaza)
    // ─────────────────────────────────────────────────────────────────

    it('rechaza con "Invitación inválida o expirada." cuando la RPC devuelve error', async () => {
        mockRpc.mockResolvedValueOnce({
            data: null,
            error: { message: 'token not found' },
        })

        const result = await acceptInvitationAction(buildFormData())

        expect(result).toEqual({ error: 'Invitación inválida o expirada.' })
        // NO debe continuar: ni SELECT invitations ni createUser.
        expect(mockFrom).not.toHaveBeenCalled()
        expect(mockCreateUser).not.toHaveBeenCalled()
    })

    it('rechaza con el error de la RPC cuando success=false (invitación expirada)', async () => {
        // Caso: la RPC existe pero devuelve success=false con un mensaje
        // específico (ej: "Invitation has expired").
        mockRpc.mockResolvedValueOnce({
            data: { success: false, error: 'Invitation has expired' },
            error: null,
        })

        const result = await acceptInvitationAction(buildFormData())

        expect(result).toEqual({ error: 'Invitation has expired' })
        expect(mockFrom).not.toHaveBeenCalled()
        expect(mockCreateUser).not.toHaveBeenCalled()
    })

    it('rechaza con mensaje por defecto cuando la RPC devuelve success=false sin error', async () => {
        mockRpc.mockResolvedValueOnce({
            data: { success: false },
            error: null,
        })

        const result = await acceptInvitationAction(buildFormData())

        expect(result).toEqual({ error: 'Invitación inválida.' })
    })

    it('rechaza si la RPC devuelve success=true pero faltan email o company_id', async () => {
        // Caso degenerado: RPC incompleta. El código defensifica.
        mockRpc.mockResolvedValueOnce({
            data: { success: true, email: undefined, company_id: VALID_COMPANY_ID },
            error: null,
        })

        const result = await acceptInvitationAction(buildFormData())

        expect(result).toEqual({ error: 'Invitación inválida.' })
        expect(mockFrom).not.toHaveBeenCalled()
        expect(mockCreateUser).not.toHaveBeenCalled()
    })

    // ─────────────────────────────────────────────────────────────────
    // SELECT invitations.branch_id falla
    // ─────────────────────────────────────────────────────────────────

    it('rechaza si el SELECT a invitations devuelve error', async () => {
        mockRpc.mockResolvedValueOnce({
            data: {
                success: true,
                email: VALID_EMAIL,
                company_id: VALID_COMPANY_ID,
                role: 'manager',
            },
            error: null,
        })
        mockFrom.mockImplementation((table: string) => {
            if (table === 'invitations') {
                return makeBuilder({ data: null, error: { message: 'rls denied' } })
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await acceptInvitationAction(buildFormData())

        expect(result).toEqual({ error: 'No se pudo leer la invitación.' })
        expect(mockCreateUser).not.toHaveBeenCalled()
    })

    // ─────────────────────────────────────────────────────────────────
    // Ruta feliz: invitations.branch_id presente (post-migración 11.8)
    // ─────────────────────────────────────────────────────────────────

    it('ruta feliz con invitations.branch_id presente: usa esa sucursal y NO consulta MAIN', async () => {
        const insertCalls: Array<{ table: string; payload: unknown }> = []
        const updateCalls: Array<{ table: string; payload: unknown }> = []

        mockRpc.mockResolvedValueOnce({
            data: {
                success: true,
                email: VALID_EMAIL,
                company_id: VALID_COMPANY_ID,
                role: 'manager',
            },
            error: null,
        })
        mockCreateUser.mockResolvedValueOnce({
            data: { user: { id: NEW_USER_ID } },
            error: null,
        })
        mockFrom.mockImplementation((table: string) => {
            if (table === 'invitations') {
                // Primer llamada: SELECT .maybeSingle() → branch_id presente
                // Segunda llamada: UPDATE used_at → termina en await
                const b = makeCapturingBuilder() as ReturnType<typeof makeCapturingBuilder>
                b.select = jest.fn().mockReturnValue(b)
                b.eq = jest.fn().mockReturnValue(b)
                b.update = jest.fn().mockImplementation((payload: unknown) => {
                    updateCalls.push({ table, payload })
                    return b
                })
                b.insert = jest.fn().mockImplementation((payload: unknown) => {
                    insertCalls.push({ table, payload })
                    return b
                })
                b.maybeSingle = jest.fn().mockResolvedValueOnce({
                    data: { id: 'inv-1', branch_id: VALID_INVITATION_BRANCH },
                    error: null,
                })
                b.single = jest.fn().mockResolvedValue({ data: null, error: null })
                b.then = (onFulfilled: (v: unknown) => unknown) =>
                    onFulfilled({ data: null, error: null })
                return b
            }
            if (table === 'company_memberships') {
                const b = makeCapturingBuilder() as ReturnType<typeof makeCapturingBuilder>
                b.select = jest.fn().mockReturnValue(b)
                b.eq = jest.fn().mockReturnValue(b)
                b.update = jest.fn().mockImplementation((payload: unknown) => {
                    updateCalls.push({ table, payload })
                    return b
                })
                b.insert = jest.fn().mockImplementation((payload: unknown) => {
                    insertCalls.push({ table, payload })
                    return b
                })
                b.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null })
                b.single = jest.fn().mockResolvedValue({ data: null, error: null })
                b.then = (onFulfilled: (v: unknown) => unknown) =>
                    onFulfilled({ data: null, error: null })
                return b
            }
            if (table === 'branch_memberships') {
                const b = makeCapturingBuilder() as ReturnType<typeof makeCapturingBuilder>
                b.select = jest.fn().mockReturnValue(b)
                b.eq = jest.fn().mockReturnValue(b)
                b.update = jest.fn().mockImplementation((payload: unknown) => {
                    updateCalls.push({ table, payload })
                    return b
                })
                b.insert = jest.fn().mockImplementation((payload: unknown) => {
                    insertCalls.push({ table, payload })
                    return b
                })
                b.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null })
                b.single = jest.fn().mockResolvedValue({ data: null, error: null })
                b.then = (onFulfilled: (v: unknown) => unknown) =>
                    onFulfilled({ data: null, error: null })
                return b
            }
            if (table === 'branches') {
                // No debe consultarse porque invitation.branch_id está presente.
                throw new Error('branches no debe consultarse con branch_id en invitation')
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await acceptInvitationAction(buildFormData())

        expect(result).toEqual({ success: true })

        // auth.admin.createUser debe recibir branch_id en app_metadata.
        expect(mockCreateUser).toHaveBeenCalledTimes(1)
        expect(mockCreateUser).toHaveBeenCalledWith(
            expect.objectContaining({
                email: VALID_EMAIL,
                password: VALID_PASSWORD,
                user_metadata: { full_name: VALID_FULLNAME },
                app_metadata: expect.objectContaining({
                    company_id: VALID_COMPANY_ID,
                    role: 'manager',
                    branch_id: VALID_INVITATION_BRANCH,
                }),
                email_confirm: true,
            })
        )

        // La branch_membership creada debe apuntar a la sucursal de la
        // invitación, NO a MAIN.
        const bmInserts = insertCalls.filter((c) => c.table === 'branch_memberships')
        expect(bmInserts).toHaveLength(1)
        expect(bmInserts[0].payload).toMatchObject({
            user_id: NEW_USER_ID,
            company_id: VALID_COMPANY_ID,
            branch_id: VALID_INVITATION_BRANCH,
            role: 'manager',
            is_default: true,
        })

        // La invitación debe marcarse como usada con el nuevo user_id.
        const invUpdates = updateCalls.filter((c) => c.table === 'invitations')
        expect(invUpdates).toHaveLength(1)
        expect(invUpdates[0].payload).toMatchObject({
            accepted_user_id: NEW_USER_ID,
        })
        expect((invUpdates[0].payload as { used_at?: string }).used_at).toMatch(
            /^\d{4}-\d{2}-\d{2}T/
        )
    })

    // ─────────────────────────────────────────────────────────────────
    // Legacy fallback: invitations.branch_id null → MAIN
    // ─────────────────────────────────────────────────────────────────

    it('invitations.branch_id null hace fallback a la sucursal MAIN de la empresa', async () => {
        const insertCalls: Array<{ table: string; payload: unknown }> = []
        const updateCalls: Array<{ table: string; payload: unknown }> = []

        mockRpc.mockResolvedValueOnce({
            data: {
                success: true,
                email: VALID_EMAIL,
                company_id: VALID_COMPANY_ID,
                role: 'manager',
            },
            error: null,
        })
        mockCreateUser.mockResolvedValueOnce({
            data: { user: { id: NEW_USER_ID } },
            error: null,
        })
        mockFrom.mockImplementation((table: string) => {
            if (table === 'invitations') {
                const b = makeCapturingBuilder() as ReturnType<typeof makeCapturingBuilder>
                b.select = jest.fn().mockReturnValue(b)
                b.eq = jest.fn().mockReturnValue(b)
                b.update = jest.fn().mockImplementation((payload: unknown) => {
                    updateCalls.push({ table, payload })
                    return b
                })
                b.insert = jest.fn().mockImplementation((payload: unknown) => {
                    insertCalls.push({ table, payload })
                    return b
                })
                // branch_id null (invitación legacy pre-11.8).
                b.maybeSingle = jest.fn().mockResolvedValueOnce({
                    data: { id: 'inv-1', branch_id: null },
                    error: null,
                })
                b.single = jest.fn().mockResolvedValue({ data: null, error: null })
                b.then = (onFulfilled: (v: unknown) => unknown) =>
                    onFulfilled({ data: null, error: null })
                return b
            }
            if (table === 'branches') {
                // Devuelve MAIN de la empresa.
                return makeBuilder({
                    data: { id: VALID_MAIN_BRANCH, active: true },
                    error: null,
                })
            }
            if (table === 'company_memberships' || table === 'branch_memberships') {
                const b = makeCapturingBuilder() as ReturnType<typeof makeCapturingBuilder>
                b.select = jest.fn().mockReturnValue(b)
                b.eq = jest.fn().mockReturnValue(b)
                b.update = jest.fn().mockImplementation((payload: unknown) => {
                    updateCalls.push({ table, payload })
                    return b
                })
                b.insert = jest.fn().mockImplementation((payload: unknown) => {
                    insertCalls.push({ table, payload })
                    return b
                })
                b.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null })
                b.single = jest.fn().mockResolvedValue({ data: null, error: null })
                b.then = (onFulfilled: (v: unknown) => unknown) =>
                    onFulfilled({ data: null, error: null })
                return b
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await acceptInvitationAction(buildFormData())

        expect(result).toEqual({ success: true })

        // createUser debe usar MAIN como branch_id.
        expect(mockCreateUser).toHaveBeenCalledWith(
            expect.objectContaining({
                app_metadata: expect.objectContaining({
                    company_id: VALID_COMPANY_ID,
                    role: 'manager',
                    branch_id: VALID_MAIN_BRANCH,
                }),
            })
        )

        // La branch_membership debe usar MAIN.
        const bmInserts = insertCalls.filter((c) => c.table === 'branch_memberships')
        expect(bmInserts).toHaveLength(1)
        expect(bmInserts[0].payload).toMatchObject({
            branch_id: VALID_MAIN_BRANCH,
            is_default: true,
        })
    })

    it('MAIN inexistente: rechaza con error claro y NO crea el usuario', async () => {
        mockRpc.mockResolvedValueOnce({
            data: {
                success: true,
                email: VALID_EMAIL,
                company_id: VALID_COMPANY_ID,
                role: 'manager',
            },
            error: null,
        })
        mockFrom.mockImplementation((table: string) => {
            if (table === 'invitations') {
                const b = makeBuilder({ data: { id: 'inv-1', branch_id: null }, error: null }) as Chain
                return b
            }
            if (table === 'branches') {
                // MAIN no existe (caso degenerado: backfill no completado).
                return makeBuilder({ data: null, error: null })
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await acceptInvitationAction(buildFormData())

        expect(result).toEqual({
            error: 'La empresa no tiene sucursal principal configurada.',
        })
        expect(mockCreateUser).not.toHaveBeenCalled()
    })

    it('MAIN inactiva: rechaza con error claro y NO crea el usuario', async () => {
        mockRpc.mockResolvedValueOnce({
            data: {
                success: true,
                email: VALID_EMAIL,
                company_id: VALID_COMPANY_ID,
                role: 'manager',
            },
            error: null,
        })
        mockFrom.mockImplementation((table: string) => {
            if (table === 'invitations') {
                return makeBuilder({ data: { id: 'inv-1', branch_id: null }, error: null })
            }
            if (table === 'branches') {
                return makeBuilder({ data: { id: VALID_MAIN_BRANCH, active: false }, error: null })
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await acceptInvitationAction(buildFormData())

        expect(result).toEqual({
            error: 'La sucursal principal está desactivada. Contactá al administrador.',
        })
        expect(mockCreateUser).not.toHaveBeenCalled()
    })

    it('MAIN query falla (rls/500): rechaza y NO crea el usuario', async () => {
        mockRpc.mockResolvedValueOnce({
            data: {
                success: true,
                email: VALID_EMAIL,
                company_id: VALID_COMPANY_ID,
                role: 'manager',
            },
            error: null,
        })
        mockFrom.mockImplementation((table: string) => {
            if (table === 'invitations') {
                return makeBuilder({ data: { id: 'inv-1', branch_id: null }, error: null })
            }
            if (table === 'branches') {
                return makeBuilder({ data: null, error: { message: 'rls denied' } })
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await acceptInvitationAction(buildFormData())

        expect(result).toEqual({
            error: 'No se pudo resolver la sucursal principal.',
        })
        expect(mockCreateUser).not.toHaveBeenCalled()
    })

    // ─────────────────────────────────────────────────────────────────
    // auth.admin.createUser (parametrización completa y errores)
    // ─────────────────────────────────────────────────────────────────

    it('createUser devuelve error: rechaza con mensaje genérico', async () => {
        mockRpc.mockResolvedValueOnce({
            data: {
                success: true,
                email: VALID_EMAIL,
                company_id: VALID_COMPANY_ID,
                role: 'manager',
            },
            error: null,
        })
        mockCreateUser.mockResolvedValueOnce({
            data: { user: null },
            error: { message: 'email already registered' },
        })
        mockFrom.mockImplementation((table: string) => {
            if (table === 'invitations') {
                return makeBuilder({
                    data: { id: 'inv-1', branch_id: VALID_INVITATION_BRANCH },
                    error: null,
                })
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await acceptInvitationAction(buildFormData())

        expect(result).toEqual({
            error: 'No se pudo crear el usuario. Intentá nuevamente.',
        })
    })

    it('createUser devuelve data sin user: rechaza', async () => {
        mockRpc.mockResolvedValueOnce({
            data: {
                success: true,
                email: VALID_EMAIL,
                company_id: VALID_COMPANY_ID,
                role: 'manager',
            },
            error: null,
        })
        mockCreateUser.mockResolvedValueOnce({ data: { user: null }, error: null })
        mockFrom.mockImplementation((table: string) => {
            if (table === 'invitations') {
                return makeBuilder({
                    data: { id: 'inv-1', branch_id: VALID_INVITATION_BRANCH },
                    error: null,
                })
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await acceptInvitationAction(buildFormData())

        expect(result).toEqual({ error: 'No se pudo crear el usuario.' })
    })

    it('propaga email_confirm: true al createUser (Fase 10 — email auto-confirm en invitaciones)', async () => {
        mockRpc.mockResolvedValueOnce({
            data: {
                success: true,
                email: VALID_EMAIL,
                company_id: VALID_COMPANY_ID,
                role: 'owner',
            },
            error: null,
        })
        mockCreateUser.mockResolvedValueOnce({
            data: { user: { id: NEW_USER_ID } },
            error: null,
        })
        mockFrom.mockImplementation((table: string) => {
            if (table === 'invitations') {
                return makeBuilder({
                    data: { id: 'inv-1', branch_id: VALID_INVITATION_BRANCH },
                    error: null,
                })
            }
            if (table === 'company_memberships' || table === 'branch_memberships') {
                return makeCapturingBuilder()
            }
            throw new Error(`Unexpected: ${table}`)
        })

        await acceptInvitationAction(buildFormData())

        expect(mockCreateUser).toHaveBeenCalledWith(
            expect.objectContaining({
                email_confirm: true,
                // role viene de la invitación (owner, no manager)
                app_metadata: expect.objectContaining({ role: 'owner' }),
            })
        )
    })

    // ─────────────────────────────────────────────────────────────────
    // Re-aceptación (23505 silencioso) — sin romper la acción
    // ─────────────────────────────────────────────────────────────────

    it('re-aceptación: company_membership ya existe (23505) → la acción completa con success', async () => {
        // Caso: el invitado vuelve a abrir el link de invitación después de
        // haberlo usado. La RPC falla (token ya usado), pero este test
        // simula el otro path: createUser tuvo éxito con un user_id que
        // YA tiene membresía en la empresa (caso raro pero posible si
        // el admin re-asigna manualmente).
        //
        // El comportamiento esperado: la membresía devuelve 23505 y la
        // acción NO falla — completa el resto (branch_membership,
        // used_at) y devuelve success.
        const insertCalls: Array<{ table: string; payload: unknown }> = []
        const updateCalls: Array<{ table: string; payload: unknown }> = []

        mockRpc.mockResolvedValueOnce({
            data: {
                success: true,
                email: VALID_EMAIL,
                company_id: VALID_COMPANY_ID,
                role: 'manager',
            },
            error: null,
        })
        mockCreateUser.mockResolvedValueOnce({
            data: { user: { id: NEW_USER_ID } },
            error: null,
        })
        mockFrom.mockImplementation((table: string) => {
            if (table === 'invitations') {
                const b = makeCapturingBuilder() as ReturnType<typeof makeCapturingBuilder>
                b.select = jest.fn().mockReturnValue(b)
                b.eq = jest.fn().mockReturnValue(b)
                b.update = jest.fn().mockImplementation((payload: unknown) => {
                    updateCalls.push({ table, payload })
                    return b
                })
                b.insert = jest.fn().mockImplementation((payload: unknown) => {
                    insertCalls.push({ table, payload })
                    return b
                })
                b.maybeSingle = jest.fn().mockResolvedValueOnce({
                    data: { id: 'inv-1', branch_id: VALID_INVITATION_BRANCH },
                    error: null,
                })
                b.single = jest.fn().mockResolvedValue({ data: null, error: null })
                b.then = (onFulfilled: (v: unknown) => unknown) =>
                    onFulfilled({ data: null, error: null })
                return b
            }
            if (table === 'company_memberships') {
                const b = makeCapturingBuilder() as ReturnType<typeof makeCapturingBuilder>
                b.select = jest.fn().mockReturnValue(b)
                b.eq = jest.fn().mockReturnValue(b)
                b.update = jest.fn().mockReturnValue(b)
                b.insert = jest.fn().mockImplementation((payload: unknown) => {
                    insertCalls.push({ table, payload })
                    return b
                })
                // INSERT devuelve 23505 (membresía ya existe).
                b.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null })
                b.single = jest.fn().mockResolvedValue({ data: null, error: null })
                b.then = (onFulfilled: (v: unknown) => unknown) =>
                    onFulfilled({ data: null, error: { code: '23505', message: 'duplicate' } })
                return b
            }
            if (table === 'branch_memberships') {
                const b = makeCapturingBuilder() as ReturnType<typeof makeCapturingBuilder>
                b.select = jest.fn().mockReturnValue(b)
                b.eq = jest.fn().mockReturnValue(b)
                b.update = jest.fn().mockReturnValue(b)
                b.insert = jest.fn().mockImplementation((payload: unknown) => {
                    insertCalls.push({ table, payload })
                    return b
                })
                // branch_membership también 23505 (re-aceptación).
                b.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null })
                b.single = jest.fn().mockResolvedValue({ data: null, error: null })
                b.then = (onFulfilled: (v: unknown) => unknown) =>
                    onFulfilled({ data: null, error: { code: '23505', message: 'duplicate' } })
                return b
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await acceptInvitationAction(buildFormData())

        // A pesar de los 23505, la acción completa exitosamente.
        expect(result).toEqual({ success: true })

        // used_at debe haberse escrito igual (la invitación queda
        // marcada como usada con el user_id del nuevo intento).
        const invUpdates = updateCalls.filter((c) => c.table === 'invitations')
        expect(invUpdates).toHaveLength(1)
        expect(invUpdates[0].payload).toMatchObject({
            accepted_user_id: NEW_USER_ID,
        })
    })

    // ─────────────────────────────────────────────────────────────────
    // Limpiar default anterior antes de insertar (defense in depth)
    // ─────────────────────────────────────────────────────────────────

    it('limpia defaults anteriores en company_memberships y branch_memberships antes de insertar', async () => {
        // Captura los calls a update() con sus payloads y los filtros
        // aplicados (eq() .eq()). Se capturan cuando el chain termina
        // (await / then()), no al llamar a update() — los eq() pueden
        // llegar después del update() en el mismo chain.
        type OpCall = {
            table: string
            op: 'update' | 'insert'
            payload: unknown
            filters: Array<[string, unknown]>
        }
        const opCalls: OpCall[] = []
        let currentOp: { op: 'update' | 'insert'; payload: unknown } | null = null
        const currentFilters: Array<[string, unknown]> = []

        mockRpc.mockResolvedValueOnce({
            data: {
                success: true,
                email: VALID_EMAIL,
                company_id: VALID_COMPANY_ID,
                role: 'manager',
            },
            error: null,
        })
        mockCreateUser.mockResolvedValueOnce({
            data: { user: { id: NEW_USER_ID } },
            error: null,
        })
        mockFrom.mockImplementation((table: string) => {
            if (table === 'invitations') {
                return makeBuilder({
                    data: { id: 'inv-1', branch_id: VALID_INVITATION_BRANCH },
                    error: null,
                })
            }
            if (table === 'company_memberships' || table === 'branch_memberships') {
                const b = makeCapturingBuilder() as ReturnType<typeof makeCapturingBuilder>
                b.select = jest.fn().mockReturnValue(b)
                b.eq = jest.fn().mockImplementation((col: string, val: unknown) => {
                    currentFilters.push([col, val])
                    return b
                })
                b.update = jest.fn().mockImplementation((payload: unknown) => {
                    currentOp = { op: 'update', payload }
                    currentFilters.length = 0
                    return b
                })
                b.insert = jest.fn().mockImplementation((payload: unknown) => {
                    currentOp = { op: 'insert', payload }
                    currentFilters.length = 0
                    return b
                })
                b.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null })
                b.single = jest.fn().mockResolvedValue({ data: null, error: null })
                // then() indica que el await del chain se ejecutó. Es el
                // momento de capturar la operación + filtros.
                b.then = (onFulfilled: (v: unknown) => unknown) => {
                    if (currentOp) {
                        opCalls.push({
                            table,
                            op: currentOp.op,
                            payload: currentOp.payload,
                            filters: [...currentFilters],
                        })
                        currentOp = null
                        currentFilters.length = 0
                    }
                    return onFulfilled({ data: null, error: null })
                }
                return b
            }
            throw new Error(`Unexpected: ${table}`)
        })

        const result = await acceptInvitationAction(buildFormData())

        expect(result).toEqual({ success: true })

        // Debe haber UN update({ is_default: false }) por tabla, ANTES
        // del insert correspondiente.
        const cmUpdates = opCalls.filter(
            (c) => c.table === 'company_memberships' && c.op === 'update'
        )
        const cmInserts = opCalls.filter(
            (c) => c.table === 'company_memberships' && c.op === 'insert'
        )
        const bmUpdates = opCalls.filter(
            (c) => c.table === 'branch_memberships' && c.op === 'update'
        )
        const bmInserts = opCalls.filter(
            (c) => c.table === 'branch_memberships' && c.op === 'insert'
        )
        expect(cmUpdates).toHaveLength(1)
        expect(cmInserts).toHaveLength(1)
        expect(bmUpdates).toHaveLength(1)
        expect(bmInserts).toHaveLength(1)

        // Filtros del clear: user_id = NEW_USER_ID, is_default = true.
        for (const clear of [...cmUpdates, ...bmUpdates]) {
            expect(clear.payload).toEqual({ is_default: false })
            const filterMap = new Map(clear.filters)
            expect(filterMap.get('user_id')).toBe(NEW_USER_ID)
            expect(filterMap.get('is_default')).toBe(true)
        }
    })

    // ─────────────────────────────────────────────────────────────────
    // Errores inesperados (catch global)
    try {
        // Marker para agrupar; los tests siguientes están al mismo nivel.
    } catch {
        /* noop */
    }

    it('errores inesperados se devuelven como { error } sin romper el flujo', async () => {
        // Forzar que el RPC lance una excepción no controlada.
        // El catch global debe devolver { error }.
        mockRpc.mockImplementationOnce(() => {
            throw new Error('Boom: unexpected rpc failure')
        })

        const result = await acceptInvitationAction(buildFormData())

        expect(result.error).toBe('Boom: unexpected rpc failure')
        // No debe llegar a Supabase for data ops.
        expect(mockFrom).not.toHaveBeenCalled()
        expect(mockCreateUser).not.toHaveBeenCalled()
    })
})