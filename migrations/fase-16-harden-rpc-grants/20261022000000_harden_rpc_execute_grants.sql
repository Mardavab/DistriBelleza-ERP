-- ============================================================
-- Fase 16 — Endurecer los EXECUTE grants de las RPCs de `public`
-- ============================================================
--
-- Contexto:
--   Las 8 funciones SECURITY DEFINER del esquema `public` eran ejecutables
--   con la ANON KEY, es decir sin ninguna sesión. Como son SECURITY DEFINER,
--   corren con los permisos de `postgres` y bypasean RLS: un caller anónimo
--   podía invocarlas directamente contra PostgREST, saltándose el middleware,
--   `requireRole`/`requireOwner` y la auditoría que viven en las server actions.
--
--   ACL que tenían las 8:
--       {=X/postgres, postgres=X/postgres, anon=X/postgres,
--        authenticated=X/postgres, service_role=X/postgres}
--
--   Impacto concreto (verificado leyendo los cuerpos):
--     - `tenant_delete_sale` borra ventas y hace
--       `UPDATE product_variants SET stock = stock + quantity` → destrucción de
--       datos e inflado de inventario, sin login y sin quedar auditado.
--     - `tenant_process_sale` crea ventas falsas con cualquier
--       company_id + branch_id válidos.
--     - `tenant_search_inventory` filtra el catálogo de cualquier tenant.
--
--   Nota de urgencia: este hueco era TEÓRICO mientras las RPCs estaban rotas
--   (fallaban antes de escribir). La Fase 15 las reparó, con lo que el camino
--   quedó funcional — y por lo tanto explotable. Por eso se cierra ahora.
--
-- POR QUÉ NO ALCANZA CON UN REVOKE SIMPLE:
--   `pg_default_acl` en el esquema `public` otorga EXECUTE a `anon` sobre toda
--   función nueva:
--       ALTER DEFAULT PRIVILEGES IN SCHEMA public
--         GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
--   Es decir, `anon` tiene grant EXPLÍCITO además del heredado de PUBLIC.
--   Hay que revocar de AMBOS. Y hay que hacerlo DESPUÉS de cada CREATE: al
--   recrear una función los default privileges le vuelven a dar EXECUTE a anon.
--   (Se observó esto al hacer DROP+CREATE de `tenant_search_inventory` en la
--   Fase 15: `anon` siguió con permiso pese al GRANT posterior.)
--
-- MATRIZ OBJETIVO:
--   tenant_process_sale      PUBLIC/anon/authenticated -> REVOKE ; service_role -> GRANT
--   tenant_delete_sale       idem
--   tenant_search_inventory  idem
--   tenant_transfer_stock    idem  (sin llamadores en el código)
--   process_sale             idem  (legacy, sin llamadores)
--   accept_invitation        PUBLIC -> REVOKE ; anon/authenticated/service_role -> GRANT
--                            ⚠️ CONSERVA anon: app/accept-invitation/page.tsx es un
--                            server component que se ejecuta con el invitado SIN
--                            sesión, y lib/supabase/server.ts usa la anon key →
--                            PostgREST lo ve como rol `anon`. Sin este permiso se
--                            rompe la aceptación de invitaciones.
--   handle_new_user          PUBLIC/anon -> REVOKE ; authenticated/service_role -> GRANT
--                            Es trigger `on_auth_user_created AFTER INSERT ON
--                            auth.users`, disparado por GoTrue, nunca por anon.
--   rls_auto_enable          PUBLIC/anon -> REVOKE ; authenticated/service_role -> GRANT
--                            Event trigger `ensure_rls` en ddl_command_end,
--                            disparado por quien ejecuta DDL, nunca por anon.
--
--   Se deja `authenticated` en las dos de trigger por prudencia: no quiero
--   cambiar permisos de funciones de trigger sin poder probar su disparo sin
--   crear/eliminar usuarios de verdad. El riesgo que se quita es `anon`.
--
-- QUÉ NO SE TOCA:
--   * Los default privileges. Toda función nueva en `public` volverá a nacer
--     con `EXECUTE` para `anon`: hay que revocarlo a mano. Queda documentado
--     en AGENTS.md §5.
--   * SECURITY DEFINER: cambiarlo a INVOKER haría que RLS bloqueara las
--     escrituras y el POS dejara de funcionar.
--
-- REVERSIBLE: Sí, vía RK_20261022000000_restore_permissive_rpc_grants.sql,
--             que restaura la ACL exacta de arriba (estado VULNERABLE).
--
-- IDEMPOTENTE: Sí. REVOKE sobre un permiso inexistente es no-op, y el GRANT
--              posterior fija el estado deseado.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1) RPCs del negocio: solo service_role (las server actions usan
--    supabaseAdmin, que se autentica con SUPABASE_SERVICE_ROLE_KEY).
-- ────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.tenant_process_sale(uuid, uuid, jsonb, text, uuid, text, numeric, numeric, text)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tenant_process_sale(uuid, uuid, jsonb, text, uuid, text, numeric, numeric, text)
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.tenant_delete_sale(uuid, uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tenant_delete_sale(uuid, uuid, uuid)
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.tenant_search_inventory(uuid, uuid, text, integer)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tenant_search_inventory(uuid, uuid, text, integer)
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.tenant_transfer_stock(uuid, uuid, uuid, integer)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tenant_transfer_stock(uuid, uuid, uuid, integer)
    TO service_role;

REVOKE EXECUTE ON FUNCTION public.process_sale(uuid, jsonb, payment_method, transfer_type, numeric, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.process_sale(uuid, jsonb, payment_method, transfer_type, numeric, uuid)
    TO service_role;

-- ────────────────────────────────────────────────────────────
-- 2) accept_invitation: CONSERVA anon. El invitado llega sin sesión.
-- ────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.accept_invitation(text)
    FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.accept_invitation(text)
    TO anon, authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 3) Funciones de trigger: solo se les quita anon y PUBLIC.
-- ────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.handle_new_user()
    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.handle_new_user()
    TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()
    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rls_auto_enable()
    TO authenticated, service_role;
