/**
 * Tests para lib/supabase/membership-queries.ts
 *
 * Cubre la lógica de Fase 10 — multi-empresa por usuario:
 *   - getUserMemberships: devuelve las membresías del usuario con la empresa
 *     anidada (PostgREST join sobre `company_id` → `companies`).
 *   - isPlatformUser: detecta cuentas de plataforma (técnicos) leyendo
 *     `profiles.is_platform_admin`.
 *
 * NO se pega a la base real: todo Supabase está mockeado.
 */

const mockFrom = jest.fn()
const mockSupabaseAdmin = {
    from: mockFrom,
}

jest.mock('../../../lib/supabase', () => ({
    supabaseAdmin: mockSupabaseAdmin,
}))

import {
    getUserMemberships,
    isPlatformUser,
    getActiveMembership,
    setDefaultMembership,
} from '../../../lib/supabase/membership-queries'

type Chain = {
    select: jest.Mock
    eq: jest.Mock
    maybeSingle: jest.Mock
    update: jest.Mock
    then?: unknown
}

function makeBuilder(defaultReturn: { data?: unknown; error?: unknown }) {
    const builder: Partial<Chain> = {}
    builder.select = jest.fn().mockReturnValue(builder)
    builder.eq = jest.fn().mockReturnValue(builder)
    builder.maybeSingle = jest.fn().mockResolvedValue(defaultReturn)
    builder.update = jest.fn().mockReturnValue(builder)
    return builder as Chain
}

describe('membership-queries.ts', () => {
    beforeEach(() => {
        mockFrom.mockReset()
    })

    describe('getUserMemberships', () => {
        it('devuelve el array de membresías incluyendo la empresa anidada', async () => {
            const rows = [
                {
                    user_id: 'u1',
                    company_id: 'c1',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-01T00:00:00Z',
                    companies: {
                        id: 'c1',
                        slug: 'distribelleza',
                        legal_name: 'Distribelleza S.A.S.',
                        trade_name: 'DistriBelleza',
                        logo_url: null,
                        active: true,
                    },
                },
                {
                    user_id: 'u1',
                    company_id: 'c2',
                    role: 'manager',
                    is_default: false,
                    created_at: '2026-01-02T00:00:00Z',
                    companies: {
                        id: 'c2',
                        slug: 'otra',
                        legal_name: 'Otra Empresa',
                        trade_name: null,
                        logo_url: null,
                        active: true,
                    },
                },
            ]

            const builder = makeBuilder({ data: rows })
            // La query encadena: from().select().eq() (sin then, devolvemos rows al eq final)
            // Porque getUserMemberships no usa .maybeSingle(); el último eq() es terminal.
            builder.eq = jest.fn().mockResolvedValue({ data: rows, error: null })

            mockFrom.mockReturnValue(builder)

            const memberships = await getUserMemberships('u1')

            expect(mockFrom).toHaveBeenCalledWith('company_memberships')
            expect(memberships).toHaveLength(2)
            expect(memberships[0]).toMatchObject({
                user_id: 'u1',
                company_id: 'c1',
                role: 'owner',
                is_default: true,
            })
            expect(memberships[0].companies).toMatchObject({
                id: 'c1',
                slug: 'distribelleza',
                legal_name: 'Distribelleza S.A.S.',
            })
            expect(memberships[1]).toMatchObject({
                company_id: 'c2',
                role: 'manager',
            })
        })

        it('devuelve array vacío cuando el usuario no tiene membresías', async () => {
            const builder = makeBuilder({ data: [], error: null })
            builder.eq = jest.fn().mockResolvedValue({ data: [], error: null })
            mockFrom.mockReturnValue(builder)

            const memberships = await getUserMemberships('no-memberships-user')

            expect(memberships).toEqual([])
        })

        it('devuelve [] si la query falla (error reportado por Supabase)', async () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

            const builder = makeBuilder({})
            builder.eq = jest
                .fn()
                .mockResolvedValue({ data: null, error: { message: 'permission denied' } })
            mockFrom.mockReturnValue(builder)

            const memberships = await getUserMemberships('u-error')

            expect(memberships).toEqual([])
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Error leyendo membresías')
            )

            warnSpy.mockRestore()
        })

        it('filtra por user_id en la query (no por company_id)', async () => {
            const builder = makeBuilder({})
            const eqSpy = jest.fn().mockResolvedValue({ data: [], error: null })
            builder.eq = eqSpy
            mockFrom.mockReturnValue(builder)

            await getUserMemberships('u-filter-test')

            // Solo se filtra por user_id, no por company_id
            expect(eqSpy).toHaveBeenCalledWith('user_id', 'u-filter-test')
            expect(eqSpy).not.toHaveBeenCalledWith('company_id', expect.anything())
        })
    })

    describe('isPlatformUser', () => {
        it('devuelve true cuando profiles.is_platform_admin === true', async () => {
            const builder = makeBuilder({
                data: { is_platform_admin: true },
            })
            mockFrom.mockReturnValue(builder)

            const result = await isPlatformUser('tech-1')

            expect(mockFrom).toHaveBeenCalledWith('profiles')
            expect(result).toBe(true)
        })

        it('devuelve false cuando is_platform_admin es false explícito', async () => {
            const builder = makeBuilder({
                data: { is_platform_admin: false },
            })
            mockFrom.mockReturnValue(builder)

            const result = await isPlatformUser('owner-1')

            expect(result).toBe(false)
        })

        it('devuelve false cuando el perfil no existe (maybeSingle → null)', async () => {
            const builder = makeBuilder({ data: null })
            mockFrom.mockReturnValue(builder)

            const result = await isPlatformUser('ghost-user')

            expect(result).toBe(false)
        })

        it('devuelve false si la query a profiles falla', async () => {
            const builder = makeBuilder({})
            builder.maybeSingle = jest.fn().mockResolvedValue({
                data: null,
                error: { message: 'rls violation' },
            })
            mockFrom.mockReturnValue(builder)

            const result = await isPlatformUser('broken')

            expect(result).toBe(false)
        })

        it('NO considera platform admin si el valor es truthy no-true (defensa)', async () => {
            const builder = makeBuilder({
                data: { is_platform_admin: 'true' as unknown as boolean }, // string, no boolean
            })
            mockFrom.mockReturnValue(builder)

            const result = await isPlatformUser('trick')

            // Solo se acepta === true literal; cualquier otro truthy (incluido 'true' string) → false
            expect(result).toBe(false)
        })

        it('filtra la query a profiles por id del usuario', async () => {
            const builder = makeBuilder({ data: { is_platform_admin: false } })
            const eqSpy = builder.eq
            mockFrom.mockReturnValue(builder)

            await isPlatformUser('specific-user')

            expect(eqSpy).toHaveBeenCalledWith('id', 'specific-user')
        })
    })

    describe('getActiveMembership', () => {
        it('prioriza la membresía cuyo company_id coincide con el del JWT', async () => {
            const rows = [
                {
                    user_id: 'u1',
                    company_id: 'c-A',
                    role: 'manager',
                    is_default: true,
                    created_at: '2026-01-01T00:00:00Z',
                },
                {
                    user_id: 'u1',
                    company_id: 'c-B',
                    role: 'owner',
                    is_default: false,
                    created_at: '2026-01-02T00:00:00Z',
                },
            ]
            const builder = makeBuilder({})
            builder.eq = jest.fn().mockResolvedValue({ data: rows, error: null })
            mockFrom.mockReturnValue(builder)

            // JWT.company_id = c-B → debe ganar owner aunque la default sea c-A
            const m = await getActiveMembership('u1', 'c-B')

            expect(m).not.toBeNull()
            expect(m!.company_id).toBe('c-B')
            expect(m!.role).toBe('owner')
        })

        it('si el JWT no coincide, devuelve la marcada como is_default', async () => {
            const rows = [
                {
                    user_id: 'u1',
                    company_id: 'c-A',
                    role: 'manager',
                    is_default: false,
                    created_at: '2026-01-01T00:00:00Z',
                },
                {
                    user_id: 'u1',
                    company_id: 'c-B',
                    role: 'owner',
                    is_default: true,
                    created_at: '2026-01-02T00:00:00Z',
                },
            ]
            const builder = makeBuilder({})
            builder.eq = jest.fn().mockResolvedValue({ data: rows, error: null })
            mockFrom.mockReturnValue(builder)

            // JWT apunta a c-X (inexistente) → debe ganar is_default (c-B)
            const m = await getActiveMembership('u1', 'c-X')

            expect(m).not.toBeNull()
            expect(m!.company_id).toBe('c-B')
            expect(m!.is_default).toBe(true)
        })

        it('si no hay default ni match de JWT, devuelve la primera membresía', async () => {
            const rows = [
                {
                    user_id: 'u1',
                    company_id: 'c-A',
                    role: 'manager',
                    is_default: false,
                    created_at: '2026-01-01T00:00:00Z',
                },
                {
                    user_id: 'u1',
                    company_id: 'c-B',
                    role: 'manager',
                    is_default: false,
                    created_at: '2026-01-02T00:00:00Z',
                },
            ]
            const builder = makeBuilder({})
            builder.eq = jest.fn().mockResolvedValue({ data: rows, error: null })
            mockFrom.mockReturnValue(builder)

            const m = await getActiveMembership('u1') // sin jwtCompanyId

            expect(m).not.toBeNull()
            expect(m!.company_id).toBe('c-A')
        })

        it('devuelve null si el usuario no tiene membresías', async () => {
            const builder = makeBuilder({})
            builder.eq = jest.fn().mockResolvedValue({ data: [], error: null })
            mockFrom.mockReturnValue(builder)

            const m = await getActiveMembership('no-memberships')

            expect(m).toBeNull()
        })
    })

    describe('setDefaultMembership', () => {
        it('limpia el default actual antes de marcar el nuevo', async () => {
            // eq(...) debe llamarse DOS veces: clear (id+is_default=true) y set (id+company_id).
            const builder = makeBuilder({})
            const eqSpy = jest.fn().mockReturnValue(builder)
            const updateSpy = jest.fn().mockReturnValue(builder)
            builder.update = updateSpy
            builder.eq = eqSpy
            mockFrom.mockReturnValue(builder)

            // No esperamos nada especial, sólo verificamos las llamadas.
            await setDefaultMembership('u1', 'c-new')

            expect(mockFrom).toHaveBeenCalledWith('company_memberships')
            expect(updateSpy).toHaveBeenCalledTimes(2)
            expect(updateSpy).toHaveBeenNthCalledWith(1, { is_default: false })
            expect(updateSpy).toHaveBeenNthCalledWith(2, { is_default: true })

            // Las dos eq tras el primer update: (user_id, ...), (is_default, true)
            expect(eqSpy).toHaveBeenCalledWith('user_id', 'u1')
            expect(eqSpy).toHaveBeenCalledWith('is_default', true)
            expect(eqSpy).toHaveBeenCalledWith('company_id', 'c-new')
        })

        it('sigue si la query de clear falla (no throw)', async () => {
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

            // Chain: update().eq().eq()
            // - Primer bloque (clear): update().eq(user_id).eq(is_default, true) → falla
            // - Segundo bloque (set):   update().eq(user_id).eq(company_id) → ok
            const failChain = {
                eq: jest.fn().mockReturnThis(),
            }
            failChain.eq
                .mockReturnValueOnce({ type: 'eq2', resolve: Promise.resolve({ error: { message: 'rls' } }) })
                .mockReturnValueOnce({ type: 'eq1', resolve: Promise.resolve({ error: null }) })
                // Re-mock para devolver algo con .eq
            // Estrategia más simple: usamos la implementación alternativa abajo.

            // Implementación más simple: cada update().eq().eq() se invoca dos veces.
            // Primer bloque: update().eq() → Promise.reject, update().eq().eq() → falla.
            // Segundo bloque: update().eq() → Promise.resolve ok.
            let firstBlock = true
            const okBuilder: any = {
                update: jest.fn().mockImplementation(() => {
                    if (firstBlock) {
                        firstBlock = false
                        // Primera eq (user_id) → objeto que soporta segunda eq → falla
                        return {
                                eq: jest.fn().mockReturnValue({
                                    eq: jest.fn().mockResolvedValue({ error: { message: 'rls' } }),
                                }),
                            }
                    }
                    // Segunda update: ok
                    return {
                        eq: jest.fn().mockReturnValue({
                            eq: jest.fn().mockResolvedValue({ error: null }),
                        }),
                    }
                }),
            }
            mockFrom.mockReturnValue(okBuilder)

            await expect(setDefaultMembership('u1', 'c-new')).resolves.toBeUndefined()
            expect(warnSpy).toHaveBeenCalled()

            warnSpy.mockRestore()
        })
    })
})