-- ============================================================
-- Fase 18 — Revocar grants sobre tablas con RLS y sin policy
-- ============================================================
--
-- Contexto:
--   El advisor `rls_enabled_no_policy` marcaba 3 tablas con RLS habilitado y
--   0 políticas: `categories`, `invitations` y `tenant_migration_audit`.
--
--   En Postgres, RLS sin policies = DENEGACIÓN TOTAL para los roles que no son
--   el dueño ni tienen BYPASSRLS. O sea, la tabla está CERRADA para
--   `anon`/`authenticated`. Pero el GRANT seguía mintiendo:
--
--       {postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm,
--        service_role=arwdDxtm}          ← 'arwdDxtm' = SELECT/INSERT/UPDATE/
--                                           DELETE/TRUNCATE/REFERENCES/TRIGGER
--
--   Un `SELECT * FROM categories` con cliente de usuario devuelve **0 filas**
--   (RLS filtra todo), y un `INSERT` da error de RLS. NO es un error de
--   permisos: es un vacío silencioso.
--
--   Eso es una trampa de mantenimiento. El próximo que escriba una consulta
--   con `createClient()` en vez de `supabaseAdmin` verá una lista vacía y no
--   sabrá por qué. Exactamente el tipo de bug que cuesta un día entero.
--
-- POR QUÉ NO AÑADIR POLICIES EN VEZ DE REVOCAR:
--   Los 7 accesos del código a estas tablas van TODOS por `supabaseAdmin`
--   (service_role, BYPASSRLS) — verificado:
--
--       inventory_actions.ts:59,68,290   supabaseAdmin.from('categories')
--       users.ts:193,410,548             supabaseAdmin.from('invitations')
--       companies.ts:126                 supabaseAdmin.from('invitations')
--
--   `tenant_migration_audit` no se usa desde el código (es de la fase 1).
--
--   Si todo va a propósito por service_role, la denegación debería ser
--   EXPLÍCITA (error de permisos) y no silenciosa (0 filas). Revocar es más
--   barato que diseñar policies y elimina la trampa. Si en el futuro hace
--   falta leer `categories` con sesión de usuario, ahí sí se diseñan policies
--   por membresía (como las de `audit_log`).
--
-- QUÉ NO SE TOCA:
--   * No se desactiva RLS. Sigue habilitado como segunda barrera.
--   * No se borran tablas.
--   * Las funciones SECURITY DEFINER que las leen (`accept_invitation` sobre
--     `invitations`, `tenant_search_inventory` sobre `categories`) corren como
--     `postgres`, que es el DUEÑO: no necesitan grants y siguen funcionando.
--
-- VERIFICADO ANTES DE APLICAR:
--   * `categories` tiene 1 trigger (`tr_categories_updated_at`, BEFORE UPDATE,
--     SECURITY INVOKER) — solo lo dispara quien actualice, que tras este
--     cambio es `service_role`/`postgres`.
--   * Ninguna vista ni materialized view depende de estas 3 tablas.
--   * Ninguna policy de otras tablas las referencia.
--
-- REVERSIBLE: Sí, vía RK_20261022000000_restore_legacy_table_grants.sql,
--             que restaura los grants permisivos previos (el estado con la
--             denegación silenciosa).
--
-- IDEMPOTENTE: Sí. REVOKE sobre un permiso inexistente es no-op.
-- ============================================================

REVOKE ALL ON public.categories FROM PUBLIC, anon, authenticated;
GRANT  SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON public.categories TO service_role;

REVOKE ALL ON public.invitations FROM PUBLIC, anon, authenticated;
GRANT  SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON public.invitations TO service_role;

REVOKE ALL ON public.tenant_migration_audit FROM PUBLIC, anon, authenticated;
GRANT  SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON public.tenant_migration_audit TO service_role;
