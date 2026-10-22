/**
 * Tests para modules/platform-admin/actions/companies.ts — createCompany.
 *
 * Caracterizan el contrato ACTUAL de la acción (patrón handleActionError de
 * lib/errors.ts), que es el shape que la Fase 6 del refactor propone unificar
 * en platform.ts:
 *   - Éxito → `{ success: true, data: { company_id, invitation_url } }`
 *   - Fallo → `{ success: false, error: <userMessage>, code: AppErrorCode }`
 *
 * Cubren: validación (VALIDATION), slug duplicado (CONFLICT), creación de
 * company_settings por defecto, invitación opcional del owner inicial y
 * acceso restringido a cuentas de plataforma.
 *
 * Mocks: requirePlatformRole (auth-helpers), supabaseAdmin (lib/supabase).
 */

const mockRequirePlatformRole = jest.fn()
jest.mock('../../../lib/supabase/auth-helpers', () => ({
    requirePlatformRole: (...args: unknown[]) => mockRequirePlatformRole(...args),
}))

const mockFrom = jest.fn()
jest.mock('../../../lib/supabase', () => ({
    supabaseAdmin: { from: mockFrom },
}))

import { createCompany } from '../../../modules/platform-admin/actions/companies'

// jsdom no expone crypto.randomUUID en todas las versiones de Node/Jest.
const cryptoObj: { randomUUID?: () => string } = (globalThis as any).crypto ?? {}
if (typeof cryptoObj.randomUUID !== 'function') {
    cryptoObj.randomUUID = () => '00000000-0000-4000-8000-000000000000'
    ;(globalThis as any).crypto = cryptoObj
}

type Row = Record<string, unknown>

/**
 * Mock centralizado por tabla. `insertHandlers` registra cada payload insertado
 * para poder asertar sobre él; `errorByTable` fuerza un error de Supabase.
 */
function installTables(options: {
    existingSlug?: Row | null
    createdCompany?: Row
    insertErrors?: Partial<Record<string, { message: string } | null>>
    columnExists?: boolean
} = {}) {
    const {
        existingSlug = null,
        createdCompany = { id: 'co-1' },
        insertErrors = {},
        columnExists = true,
    } = options

    const inserts: Record<string, Row[]> = {
        companies: [],
        company_settings: [],
        invitations: [],
    }

    mockFrom.mockImplementation((table: string) => {
        if (table === 'information_schema.columns') {
            return {
                select: jest.fn().mockReturnValue({
                    eq: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            eq: jest.fn().mockReturnValue({
                                maybeSingle: jest.fn().mockResolvedValue({
                                    data: columnExists ? { column_name: 'created_by' } : null,
                                }),
                            }),
                        }),
                    }),
                }),
            }
        }

        if (table === 'companies') {
            return {
                select: jest.fn().mockReturnValue({
                    eq: jest.fn().mockReturnValue({
                        maybeSingle: jest.fn().mockResolvedValue({ data: existingSlug }),
                    }),
                }),
                insert: jest.fn().mockImplementation((payload: Row) => {
                    inserts.companies.push(payload)
                    const error = insertErrors.companies ?? null
                    return {
                        select: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: error ? null : createdCompany,
                                error,
                            }),
                        }),
                    }
                }),
            }
        }

        if (table === 'company_settings' || table === 'invitations') {
            return {
                insert: jest.fn().mockImplementation((payload: Row) => {
                    inserts[table].push(payload)
                    return {
                        then: (onFulfilled: (v: unknown) => unknown) =>
                            onFulfilled({ error: insertErrors[table] ?? null }),
                    }
                }),
            }
        }

        throw new Error(`Unexpected table: ${table}`)
    })

    return inserts
}

const VALID_PAYLOAD = {
    legal_name: 'Comercializadora Andina SAS',
    trade_name: 'Andina',
    slug: 'andina',
}

describe('modules/platform-admin/actions/companies.ts — createCompany', () => {
    let consoleLogSpy: jest.SpyInstance
    let consoleErrorSpy: jest.SpyInstance

    beforeEach(() => {
        mockFrom.mockReset()
        mockRequirePlatformRole.mockReset()
        mockRequirePlatformRole.mockResolvedValue({
            user: { id: 'tech-1' },
            role: 'technician',
            companyId: null,
        })
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleLogSpy.mockRestore()
        consoleErrorSpy.mockRestore()
    })

    describe('validación (code VALIDATION)', () => {
        it('rechaza legal_name vacío', async () => {
            installTables()

            const result = await createCompany({ ...VALID_PAYLOAD, legal_name: '   ' })

            expect(result.success).toBe(false)
            if (!result.success) {
                expect(result.code).toBe('VALIDATION')
                expect(result.error).toBe('Razón social es obligatoria.')
            }
            expect(mockFrom).not.toHaveBeenCalled()
        })

        it('rechaza trade_name vacío', async () => {
            installTables()

            const result = await createCompany({ ...VALID_PAYLOAD, trade_name: '' })

            expect(result.success).toBe(false)
            if (!result.success) {
                expect(result.code).toBe('VALIDATION')
                expect(result.error).toBe('Nombre comercial es obligatorio.')
            }
        })

        it('rechaza slug con caracteres inválidos', async () => {
            installTables()

            const result = await createCompany({ ...VALID_PAYLOAD, slug: 'Slug Invalido!' })

            expect(result.success).toBe(false)
            if (!result.success) {
                expect(result.code).toBe('VALIDATION')
                expect(result.error).toBe('Slug inválido (solo minúsculas, números y guiones).')
            }
        })
    })

    describe('conflicto de slug', () => {
        it('devuelve CONFLICT si el slug ya existe', async () => {
            installTables({ existingSlug: { id: 'co-99' } })

            const result = await createCompany(VALID_PAYLOAD)

            expect(result.success).toBe(false)
            if (!result.success) {
                expect(result.code).toBe('CONFLICT')
                expect(result.error).toBe('El slug "andina" ya existe.')
            }
        })
    })

    describe('creación exitosa', () => {
        it('inserta la company con currency/timezone por defecto', async () => {
            const inserts = installTables()

            const result = await createCompany(VALID_PAYLOAD)

            expect(result.success).toBe(true)
            expect(inserts.companies).toHaveLength(1)
            expect(inserts.companies[0]).toMatchObject({
                slug: 'andina',
                legal_name: 'Comercializadora Andina SAS',
                trade_name: 'Andina',
                tax_id: null,
                currency: 'COP',
                timezone: 'America/Bogota',
                active: true,
            })
        })

        it('crea los 7 company_settings por defecto', async () => {
            const inserts = installTables()

            await createCompany(VALID_PAYLOAD)

            const keys = inserts.company_settings.map((s) => s.key)
            expect(keys).toEqual([
                'commission_threshold',
                'commission_rate',
                'default_customer_options',
                'receipt_header',
                'receipt_footer',
                'pdf_header_text',
                'pdf_footer_text',
            ])
            expect(inserts.company_settings).toHaveLength(7)
            // Los settings de branding heredan el trade_name del payload
            expect(inserts.company_settings.find((s) => s.key === 'receipt_header')!.value).toBe(
                '"Andina"'
            )
        })

        it('devuelve invitation_url null si no se provee initialOwnerEmail', async () => {
            const inserts = installTables()

            const result = await createCompany(VALID_PAYLOAD)

            expect(result.success).toBe(true)
            if (result.success) {
                expect(result.data.company_id).toBe('co-1')
                expect(result.data.invitation_url).toBeNull()
            }
            expect(inserts.invitations).toHaveLength(0)
        })

        it('crea invitación y devuelve invitation_url cuando hay initialOwnerEmail', async () => {
            const inserts = installTables()

            const result = await createCompany({
                ...VALID_PAYLOAD,
                initialOwnerEmail: 'owner@andina.co',
            })

            expect(result.success).toBe(true)
            if (result.success) {
                expect(result.data.invitation_url).toContain('/accept-invitation?token=')
            }
            expect(inserts.invitations).toHaveLength(1)
            expect(inserts.invitations[0]).toMatchObject({
                company_id: 'co-1',
                email: 'owner@andina.co',
                role: 'owner',
                invited_by: 'tech-1',
            })
            expect(typeof inserts.invitations[0].expires_at).toBe('string')
        })
    })

    describe('errores de persistencia', () => {
        it('devuelve EXTERNAL si falla el insert de company_settings', async () => {
            installTables({
                insertErrors: {
                    company_settings: { message: 'violates not-null constraint' },
                },
            })

            const result = await createCompany(VALID_PAYLOAD)

            expect(result.success).toBe(false)
            if (!result.success) {
                expect(result.code).toBe('EXTERNAL')
            }
        })

        it('devuelve EXTERNAL si falla el insert de la company', async () => {
            installTables({
                insertErrors: { companies: { message: 'duplicate key value' } },
            })

            const result = await createCompany(VALID_PAYLOAD)

            expect(result.success).toBe(false)
            if (!result.success) {
                expect(result.code).toBe('EXTERNAL')
            }
        })
    })

    describe('acceso', () => {
        it('rechaza al caller sin rol de plataforma', async () => {
            mockRequirePlatformRole.mockRejectedValueOnce(
                new Error('FORBIDDEN: se requiere cuenta de plataforma')
            )

            const result = await createCompany(VALID_PAYLOAD)

            expect(result.success).toBe(false)
            if (!result.success) {
                expect(result.code).toBeTruthy()
            }
            expect(mockFrom).not.toHaveBeenCalled()
        })

        it('solo usa requirePlatformRole (no requireAuthContext/requireRole)', async () => {
            installTables()

            await createCompany(VALID_PAYLOAD)

            expect(mockRequirePlatformRole).toHaveBeenCalledTimes(1)
            expect(mockRequirePlatformRole).toHaveBeenCalledWith(['technician'])
        })
    })
})
