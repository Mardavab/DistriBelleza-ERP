/**
 * Tests para lib/supabase/company-context.ts (Fase 10 — multi-empresa).
 *
 * Cubre `getCurrentCompanyId`:
 *   - Devuelve company_id de la membresía activa cuando el usuario tiene
 *     membresía.
 *   - Devuelve null si el usuario es platform admin (sin membresía).
 *   - Lanza 'UNAUTHENTICATED' si no hay sesión.
 *   - Prioridad: JWT.company_id > is_default > primera membresía.
 *
 * `getActiveMembership` y `isPlatformUser` se mockean directamente porque
 * son dependencias de `company-context.ts` (se testean en su propio archivo).
 * El cliente Supabase SSR (`createClient`) también se mockea.
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

import { getCurrentCompanyId, getCurrentCompanyIdSafe } from '../../../lib/supabase/company-context'

describe('company-context.ts (Fase 10)', () => {
    beforeEach(() => {
        mockAuthGetUser.mockReset()
        mockGetActiveMembership.mockReset()
        mockIsPlatformUser.mockReset()
        mockCreateClient.mockClear()
    })

    describe('getCurrentCompanyId — sesión', () => {
        it('lanza UNAUTHENTICATED si no hay usuario (auth.getUser devuelve null)', async () => {
            mockAuthGetUser.mockResolvedValue({ data: { user: null }, error: null })

            await expect(getCurrentCompanyId()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
            // Importante: NO debe llegar a consultar membresías / platform admin
            expect(mockIsPlatformUser).not.toHaveBeenCalled()
            expect(mockGetActiveMembership).not.toHaveBeenCalled()
        })

        it('lanza UNAUTHENTICATED si auth.getUser devuelve error', async () => {
            mockAuthGetUser.mockResolvedValue({
                data: { user: null },
                error: { message: 'session missing' },
            })

            await expect(getCurrentCompanyId()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
            expect(mockIsPlatformUser).not.toHaveBeenCalled()
        })
    })

    describe('getCurrentCompanyId — platform admin', () => {
        it('devuelve null para técnicos (is_platform_admin=true)', async () => {
            mockAuthGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'tech-1',
                        app_metadata: {},
                        user_metadata: {},
                    },
                },
                error: null,
            })
            mockIsPlatformUser.mockResolvedValue(true)

            const companyId = await getCurrentCompanyId()

            expect(companyId).toBeNull()
            // Platform admin → no se llega a getActiveMembership
            expect(mockGetActiveMembership).not.toHaveBeenCalled()
        })

        it('devuelve null aunque el platform admin tenga JWT con company_id', async () => {
            // Caso degenerado: is_platform_admin=true tiene precedencia absoluta.
            mockAuthGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'tech-2',
                        app_metadata: { company_id: 'c-heredado' },
                    },
                },
                error: null,
            })
            mockIsPlatformUser.mockResolvedValue(true)

            const companyId = await getCurrentCompanyId()

            expect(companyId).toBeNull()
            // getActiveMembership NO se llama si es platform admin (ahorra query)
            expect(mockGetActiveMembership).not.toHaveBeenCalled()
        })
    })

    describe('getCurrentCompanyId — usuario con membresía', () => {
        beforeEach(() => {
            mockAuthGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'u-owner',
                        app_metadata: { company_id: 'c-jwt' },
                    },
                },
                error: null,
            })
            mockIsPlatformUser.mockResolvedValue(false)
        })

        it('devuelve company_id de la membresía activa cuando existe', async () => {
            mockGetActiveMembership.mockResolvedValue({
                user_id: 'u-owner',
                company_id: 'c-active',
                role: 'owner',
                is_default: true,
                created_at: '2026-01-01',
            })

            const companyId = await getCurrentCompanyId()

            expect(companyId).toBe('c-active')
            expect(mockGetActiveMembership).toHaveBeenCalledWith('u-owner', 'c-jwt')
        })

        it('propaga el JWT.company_id a getActiveMembership (prioridad JWT)', async () => {
            mockGetActiveMembership.mockResolvedValue({
                user_id: 'u-owner',
                company_id: 'c-jwt',
                role: 'owner',
                is_default: false,
                created_at: '2026-01-01',
            })

            await getCurrentCompanyId()

            expect(mockGetActiveMembership).toHaveBeenCalledWith(
                'u-owner',
                'c-jwt' // segundo argumento = jwtCompanyId
            )
        })

        it('pasa undefined como jwtCompanyId si no está en app_metadata', async () => {
            mockAuthGetUser.mockResolvedValueOnce({
                data: {
                    user: {
                        id: 'u-no-jwt',
                        app_metadata: {}, // sin company_id
                    },
                },
                error: null,
            })
            mockGetActiveMembership.mockResolvedValue({
                user_id: 'u-no-jwt',
                company_id: 'c-default',
                role: 'manager',
                is_default: true,
                created_at: '2026-01-01',
            })

            await getCurrentCompanyId()

            expect(mockGetActiveMembership).toHaveBeenCalledWith('u-no-jwt', undefined)
        })

        it('devuelve null si getActiveMembership devuelve null (usuario sin membresía)', async () => {
            // Caso: usuario NO platform admin pero tampoco tiene membresías
            // (estado inconsistente pero posible durante migraciones).
            mockGetActiveMembership.mockResolvedValue(null)

            const companyId = await getCurrentCompanyId()

            expect(companyId).toBeNull()
        })
    })

    describe('getCurrentCompanyIdSafe', () => {
        it('devuelve null sin lanzar si getCurrentCompanyId tira UNAUTHENTICATED', async () => {
            mockAuthGetUser.mockResolvedValue({ data: { user: null }, error: null })

            const companyId = await getCurrentCompanyIdSafe()

            expect(companyId).toBeNull()
        })

        it('propaga el valor cuando getCurrentCompanyId resuelve con éxito', async () => {
            mockAuthGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'u-ok',
                        app_metadata: { company_id: 'c-ok' },
                    },
                },
                error: null,
            })
            mockIsPlatformUser.mockResolvedValue(false)
            mockGetActiveMembership.mockResolvedValue({
                user_id: 'u-ok',
                company_id: 'c-ok',
                role: 'manager',
                is_default: true,
                created_at: '2026-01-01',
            })

            const companyId = await getCurrentCompanyIdSafe()

            expect(companyId).toBe('c-ok')
        })
    })
})