/**
 * Auditoría de mutaciones de negocio.
 *
 * Cada server action que escribe en BD llama a `audit()` tras el éxito para
 * registrar QUIÉN hizo QUÉ, CUÁNDO y sobre qué entidad. Los SELECT no se
 * registran: solo mutaciones.
 *
 * Reglas:
 *  - **Nunca lanza.** Si el INSERT falla, la operación de negocio ya se
 *    completó y no se revierte; se deja constancia con `warnSilently`. Un
 *    fallo de auditoría no debe tumbar una venta en el POS.
 *  - **No auditar secretos.** `payload` se guarda tal cual en una columna
 *    `jsonb` legible por owners: nunca enviar tokens, passwords ni claves.
 *  - **Escribe con `supabaseAdmin`** (service_role): la tabla `audit_log` no
 *    tiene políticas de INSERT para `authenticated`, así que un usuario
 *    autenticado no podría plantar filas aunque quisiera.
 *
 * Tabla: `migrations/fase-14-audit-log/20261021000000_create_audit_log.sql`
 */

import { supabaseAdmin } from './supabase';
import { warnSilently } from './errors';

/**
 * Subconjunto del contexto de auth que la auditoría necesita. Compatible con
 * lo que devuelven `requireAuthContext` / `requireRole`, así el caller puede
 * pasar el `ctx` que ya tiene en la mano sin adaptarlo.
 */
export type AuditActor = {
    user: { id: string };
    companyId: string;
    role: string;
};

/**
 * Registra una mutación. Devuelve `void` siempre: el caller no debe condicionar
 * su resultado a esto.
 *
 * @param ctx        actor (de requireAuthContext / requireRole)
 * @param action     nombre estable de la acción, p.ej. 'processPOSSale'
 * @param entityType entidad afectada, p.ej. 'sale', 'product', 'supplier'
 * @param branchId   sucursal sobre la que se operó, si aplica
 * @param entityId   identificador de la fila afectada, si se conoce
 * @param payload    argumentos/resultados relevantes (sin secretos)
 */
export async function audit(
    ctx: AuditActor,
    action: string,
    entityType: string,
    options?: {
        /**
         * Empresa sobre la que se opera. Por defecto `ctx.companyId`.
         * Hace falta cuando el actor es una cuenta de plataforma (que no
         * pertenece a ningún tenant) o cuando actúa sobre OTRO tenant, como
         * en la consola de plataforma.
         */
        companyId?: string | null;
        branchId?: string | null;
        entityId?: string | null;
        payload?: unknown;
    },
): Promise<void> {
    try {
        const companyId = options?.companyId ?? ctx.companyId;
        if (!ctx?.user?.id || !companyId) {
            // Sin actor o sin tenant no hay entrada válida. No es un error de
            // la operación de negocio, pero no debe silenciarse del todo.
            warnSilently('audit', new Error(`ctx incompleto para ${action}`));
            return;
        }

        const { error } = await supabaseAdmin.from('audit_log').insert({
            company_id: companyId,
            branch_id: options?.branchId ?? null,
            actor_user_id: ctx.user.id,
            actor_role: ctx.role,
            action,
            entity_type: entityType,
            entity_id: options?.entityId ?? null,
            payload: (options?.payload ?? null) as never,
        });

        if (error) {
            warnSilently(`audit.${action}`, error);
        }
    } catch (caught) {
        warnSilently(`audit.${action}`, caught);
    }
}
