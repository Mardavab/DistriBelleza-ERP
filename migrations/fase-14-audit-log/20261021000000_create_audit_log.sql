-- ==========================================
-- MIGRACIÓN 20261021000000 - Tabla audit_log (Fase 14)
-- ==========================================
-- OBJETIVO: registrar cada MUTACIÓN de negocio con quién la hizo, cuándo y
--           qué hizo. No hay UI de consulta todavía: el log se escribe desde
--           las server actions (vía lib/audit.ts) y se lee directo en BD.
--
--           Sin este log no hay forma de responder "quién anuló esta venta"
--           o "quién cambió el precio de este producto", que es una de las
--           recomendaciones de seguridad abiertas en AUDIT.md §1.
--
-- DISEÑO:
--   - Una fila por mutación exitosa. Los SELECT NO se registran.
--   - `payload` guarda los argumentos/resultados relevantes (jsonb) pero NUNCA
--     secretos: el caller de lib/audit.ts es responsable de no enviar tokens,
--     passwords ni service keys.
--   - `actor_role` se copia del rol del actor EN EL MOMENTO de la acción, no
--     se recomputa después (así el log no cambia si luego cambia el rol).
--   - `entity_id` es text y no uuid: algunas entidades no usan uuid (p.ej.
--     argumentos compuestos) y preferimos no perder filas por un casteo.
--
-- SEGURIDAD:
--   - RLS habilitado. Solo SELECT para miembros de la misma empresa.
--   - Sin políticas INSERT/UPDATE/DELETE para `authenticated`: la escritura es
--     exclusiva de `service_role` (server actions con supabaseAdmin), que bypasea
--     RLS. Así un usuario autenticado no puede plantar ni borrar entradas.
--   - Los técnicos de plataforma no ven el log de tenants: no tienen membresía,
--     así que el EXISTS sobre company_memberships les da 0 filas.
--
-- REVERSIBLE: Sí, vía RK_20261021000000_drop_audit_log.sql (borra la tabla y
--             con ella todo el historial acumulado).
--
-- IDEMPOTENTE: Sí (IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- ORDEN DE APLICACIÓN: no depende de otras migraciones de la Fase 14.
-- ==========================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.audit_log (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
    branch_id     uuid,
    actor_user_id uuid NOT NULL,
    actor_role    text NOT NULL,
    action        text NOT NULL,
    entity_type   text NOT NULL,
    entity_id     text,
    payload       jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Consultas típicas: "últimas acciones de la empresa" y "todo lo que hizo X
-- sobre una entidad". Cubiertas por estos dos índices.
CREATE INDEX IF NOT EXISTS audit_log_company_created_idx
    ON public.audit_log (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_company_action_created_idx
    ON public.audit_log (company_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_entity_idx
    ON public.audit_log (company_id, entity_type, entity_id);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Lectura: solo miembros de la misma empresa. Mismo patrón EXISTS sobre
-- company_memberships que el resto de tablas multi-tenant (fase-10.3).
DROP POLICY IF EXISTS "audit_log_membership_select" ON public.audit_log;
CREATE POLICY "audit_log_membership_select" ON public.audit_log
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.company_memberships m
        WHERE m.company_id = audit_log.company_id
          AND m.user_id = auth.uid()
    ));

-- Sin INSERT/UPDATE/DELETE para authenticated: solo service_role escribe.

COMMIT;
