/**
 * Tests para `lib/supabase/auth-helpers.ts` — las guardias de server action.
 *
 * El contrato que se verifica es que cada guardia lanza `AppError` (vía `err()`)
 * y no `Error` plano, para que `handleActionError` pueda clasificar el `code`
 * del resultado. Antes tiraban `new Error('UNAUTHENTICATED')` y el consumidor
 * recibía `code: 'UNKNOWN'` con un mensaje genérico.
 *
 * Cada test aserta sobre `code`, que es el dato que el contrato expone.
 */

const mockGetActiveMembership = jest.fn()
const mockIsPlatformUser = jest.fn()
jest.mock('../../../lib/supabase/membership-queries', () => ({
    getActiveMembership: (...args: unknown[]) => mockGetActiveMembership(...args),
    isPlatformUser: (...args: unknown[]) => mockIsPlatformUser(...args),
}))

const mockAuthGetUser = jest.fn()
const mockCreateClient = jest.fn(() => ({
    auth: { getUser: mockAuthGetUser },
}))
jest.mock('../../../lib/supabase/server', () => ({
    createClient: (...args: unknown[]) => mockCreateClient(...args),
}))

const mockAdminFrom = jest.fn()
jest.mock('../../../lib/supabase', () => ({
    supabaseAdmin: { from: mockAdminFrom },
}))

import {
    requireAuthContext,
    requireOwner,
    requireRole,
    requirePlatformRole,
} from '../../../lib/supabase/auth-helpers'
import { isAppError } from '../../../lib/errors'

/** Acepta la promesa y devuelve el error lanzado, validando que es AppError. */
async function captureError(promise: Promise<unknown>): Promise<{ code: string }> {
    try {
        await promise
    } catch (thrown) {
        expect(isAppError(thrown)).toBe(true)
        return thrown as { code: string }
    }
    throw new Error('expected the guard to throw, but it resolved')
}

describe('lib/supabase/auth-helpers.ts — guardias lanzan AppError', () => {
    beforeEach(() => {
        mockAuthGetUser.mockReset()
        mockGetActiveMembership.mockReset()
        mockIsPlatformUser.mockReset()
        mockAdminFrom.mockReset()
        mockCreateClient.mockClear()
    })

    describe('requireAuthContext', () => {
        it('lanza UNAUTHENTICATED (code) si no hay usuario', async () => {
            mockAuthGetUser.mockResolvedValue({ data: { user: null }, error: null })

            const e = await captureError(requireAuthContext())

            expect(e.code).toBe('UNAUTHENTICATED')
            expect(mockIsPlatformUser).not.toHaveBeenCalled()
            expect(mockGetActiveMembership).not.toHaveBeenCalled()
        })

        it('lanza UNAUTHENTICATED (code) si auth.getUser devuelve error', async () => {
            mockAuthGetUser.mockResolvedValue({
                data: { user: null },
                error: { message: 'session missing' },
            })

            const e = await captureError(requireAuthContext())

            expect(e.code).toBe('UNAUTHENTICATED')
        })

        it('lanza NO_COMPANY_CONTEXT si no hay company_id y no es platform admin', async () => {
            mockAuthGetUser.mockResolvedValue({
                data: { user: { id: 'u-1', app_metadata: {} } },
                error: null,
            })
            mockIsPlatformUser.mockResolvedValue(false)

            const e = await captureError(requireAuthContext())

            expect(e.code).toBe('NO_COMPANY_CONTEXT')
            expect(mockGetActiveMembership).not.toHaveBeenCalled()
        })

        it('lanza NO_MEMBERSHIP si hay company_id pero sin membresía', async () => {
            mockAuthGetUser.mockResolvedValue({
                data: { user: { id: 'u-1', app_metadata: { company_id: 'c-1' } } },
                error: null,
            })
            mockGetActiveMembership.mockResolvedValue(null)

            const e = await captureError(requireAuthContext())

            expect(e.code).toBe('NO_MEMBERSHIP')
        })

        it('devuelve contexto de técnico para platform admin sin company_id', async () => {
            mockAuthGetUser.mockResolvedValue({
                data: { user: { id: 'tech-1', app_metadata: {} } },
                error: null,
            })
            mockIsPlatformUser.mockResolvedValue(true)

            const ctx = await requireAuthContext()

            expect(ctx.role).toBe('technician')
            expect(ctx.companyId).toBe('')
            expect(mockGetActiveMembership).not.toHaveBeenCalled()
        })

        it('devuelve el contexto con el rol de la membresía activa', async () => {
            mockAuthGetUser.mockResolvedValue({
                data: { user: { id: 'u-1', app_metadata: { company_id: 'c-1' } } },
                error: null,
            })
            mockGetActiveMembership.mockResolvedValue({
                user_id: 'u-1',
                company_id: 'c-1',
                role: 'manager',
                is_default: true,
                created_at: '2026-01-01',
            })

            const ctx = await requireAuthContext()

            expect(ctx.role).toBe('manager')
            expect(ctx.companyId).toBe('c-1')
        })
    })

    describe('requireOwner', () => {
        it('lanza FORBIDDEN (code) si el rol no es owner', () => {
            let thrown: unknown
            try {
                requireOwner('manager')
            } catch (e) {
                thrown = e
            }
            expect(isAppError(thrown)).toBe(true)
            expect((thrown as { code: string }).code).toBe('FORBIDDEN')
        })

        it('no lanza si el rol es owner', () => {
            expect(() => requireOwner('owner')).not.toThrow()
        })
    })

    describe('requireRole', () => {
        it('lanza FORBIDDEN (code) si el rol no está permitido', async () => {
            mockAuthGetUser.mockResolvedValue({
                data: { user: { id: 'u-1', app_metadata: { company_id: 'c-1' } } },
                error: null,
            })
            mockGetActiveMembership.mockResolvedValue({
                user_id: 'u-1',
                company_id: 'c-1',
                role: 'manager',
                is_default: true,
                created_at: '2026-01-01',
            })

            const e = await captureError(requireRole(['owner']))

            expect(e.code).toBe('FORBIDDEN')
        })

        it('devuelve el contexto si el rol está permitido', async () => {
            mockAuthGetUser.mockResolvedValue({
                data: { user: { id: 'u-1', app_metadata: { company_id: 'c-1' } } },
                error: null,
            })
            mockGetActiveMembership.mockResolvedValue({
                user_id: 'u-1',
                company_id: 'c-1',
                role: 'manager',
                is_default: true,
                created_at: '2026-01-01',
            })

            const ctx = await requireRole(['owner', 'manager'])

            expect(ctx.role).toBe('manager')
        })
    })

    describe('requirePlatformRole', () => {
        it('lanza UNAUTHENTICATED (code) si no hay sesión', async () => {
            mockAuthGetUser.mockResolvedValue({ data: { user: null }, error: null })

            const e = await captureError(requirePlatformRole(['technician']))

            expect(e.code).toBe('UNAUTHENTICATED')
        })

        it('lanza NOT_FOUND (code) si el usuario no tiene perfil', async () => {
            mockAuthGetUser.mockResolvedValue({
                data: { user: { id: 'u-1' }, error: null },
                error: null,
            })
            mockAdminFrom.mockReturnValue({
                select: jest.fn().mockReturnValue({
                    eq: jest.fn().mockReturnValue({
                        maybeSingle: jest.fn().mockResolvedValue({ data: null }),
                    }),
                }),
            })

            const e = await captureError(requirePlatformRole(['technician']))

            expect(e.code).toBe('NOT_FOUND')
        })

        it('lanza FORBIDDEN (code) si is_platform_admin es false', async () => {
            mockAuthGetUser.mockResolvedValue({
                data: { user: { id: 'u-1' }, error: null },
                error: null,
            })
            mockAdminFrom.mockReturnValue({
                select: jest.fn().mockReturnValue({
                    eq: jest.fn().mockReturnValue({
                        maybeSingle: jest.fn().mockResolvedValue({
                            data: { is_platform_admin: false, company_id: 'c-1' },
                        }),
                    }),
                }),
            })

            const e = await captureError(requirePlatformRole(['technician']))

            expect(e.code).toBe('FORBIDDEN')
        })

        it('devuelve el contexto para un platform admin', async () => {
            mockAuthGetUser.mockResolvedValue({
                data: { user: { id: 'tech-1' }, error: null },
                error: null,
            })
            mockAdminFrom.mockReturnValue({
                select: jest.fn().mockReturnValue({
                    eq: jest.fn().mockReturnValue({
                        maybeSingle: jest.fn().mockResolvedValue({
                            data: { is_platform_admin: true, company_id: null },
                        }),
                    }),
                }),
            })

            const ctx = await requirePlatformRole(['technician'])

            expect(ctx.role).toBe('technician')
            expect(ctx.companyId).toBeNull()
        })
    })
})
