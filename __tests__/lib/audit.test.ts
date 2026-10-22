/**
 * Tests para `lib/audit.ts`.
 *
 * Contratos que se verifican:
 *   1. Registra una fila en `audit_log` con actor, acción, entidad y payload.
 *   2. Nunca lanza: si el INSERT falla, `audit()` devuelve `void` y no
 *      revierte la operación de negocio que la llamó.
 *   3. `options.companyId` permite auditar sobre un tenant distinto al del
 *      actor (caso de la consola de plataforma).
 *   4. Rechaza un `ctx` incompleto sin intentar escribir.
 */

const mockFrom = jest.fn()
jest.mock('../../lib/supabase', () => ({
    supabaseAdmin: { from: mockFrom },
}))

const mockWarnSilently = jest.fn()
jest.mock('../../lib/errors', () => ({
    warnSilently: (...args: unknown[]) => mockWarnSilently(...args),
}))

import { audit } from '../../lib/audit'

const CTX = {
    user: { id: 'u-1' },
    companyId: 'c-1',
    role: 'manager',
}

function captureInsert() {
    const inserts: Array<Record<string, unknown>> = []
    mockFrom.mockImplementation((table: string) => {
        expect(table).toBe('audit_log')
        return {
            insert: jest.fn().mockImplementation((payload: Record<string, unknown>) => {
                inserts.push(payload)
                return {
                    then: (onFulfilled: (v: unknown) => unknown) =>
                        onFulfilled({ error: null }),
                }
            }),
        }
    })
    return inserts
}

describe('lib/audit.ts', () => {
    beforeEach(() => {
        mockFrom.mockReset()
        mockWarnSilently.mockReset()
    })

    it('inserta en audit_log con actor, acción, entidad y payload', async () => {
        const inserts = captureInsert()

        await audit(CTX, 'processPOSSale', 'sale', {
            branchId: 'b-1',
            entityId: 'sale-1',
            payload: { paymentMethod: 'CASH', total: 1500 },
        })

        expect(inserts).toHaveLength(1)
        expect(inserts[0]).toMatchObject({
            company_id: 'c-1',
            branch_id: 'b-1',
            actor_user_id: 'u-1',
            actor_role: 'manager',
            action: 'processPOSSale',
            entity_type: 'sale',
            entity_id: 'sale-1',
            payload: { paymentMethod: 'CASH', total: 1500 },
        })
    })

    it('deja entity_id, branch_id y payload en null cuando no se proveen', async () => {
        const inserts = captureInsert()

        await audit(CTX, 'deleteProduct', 'product')

        expect(inserts[0]).toMatchObject({
            entity_id: null,
            branch_id: null,
            payload: null,
        })
    })

    it('usa options.companyId para auditar sobre otro tenant', async () => {
        const inserts = captureInsert()

        await audit(
            { user: { id: 'tech-1' }, companyId: '', role: 'technician' },
            'setCompanyActive',
            'company',
            { companyId: 'c-9', entityId: 'c-9', payload: { active: false } }
        )

        expect(inserts[0]).toMatchObject({
            company_id: 'c-9',
            actor_user_id: 'tech-1',
            actor_role: 'technician',
        })
    })

    it('NUNCA lanza si el INSERT falla: solo warnSilently', async () => {
        mockFrom.mockImplementation(() => ({
            insert: jest.fn().mockReturnValue({
                then: (onFulfilled: (v: unknown) => unknown) =>
                    onFulfilled({ error: { message: 'permission denied' } }),
            }),
        }))

        await expect(
            audit(CTX, 'processPOSSale', 'sale')
        ).resolves.toBeUndefined()

        expect(mockWarnSilently).toHaveBeenCalledWith(
            'audit.processPOSSale',
            expect.objectContaining({ message: 'permission denied' })
        )
    })

    it('NUNCA lanza si supabaseAdmin.from lanza', async () => {
        mockFrom.mockImplementation(() => {
            throw new Error('network down')
        })

        await expect(
            audit(CTX, 'processPOSSale', 'sale')
        ).resolves.toBeUndefined()

        expect(mockWarnSilently).toHaveBeenCalled()
    })

    it('no escribe si falta el actor (ctx incompleto)', async () => {
        const inserts = captureInsert()

        await audit({ user: { id: '' }, companyId: 'c-1', role: 'manager' }, 'x', 'y')
        await audit({ user: { id: 'u-1' }, companyId: '', role: 'manager' }, 'x', 'y')

        expect(inserts).toHaveLength(0)
        expect(mockWarnSilently).toHaveBeenCalledTimes(2)
    })
})
