-- ==========================================
-- MIGRACIÓN 20261101000006 - Sincronizar app_metadata.branch_id para usuarios existentes
-- Fase 11 - Multi-sucursal (Bloque C — fix post-deploy)
-- ==========================================
-- OBJETIVO:
--   Poblar `app_metadata.branch_id` en el JWT de cada usuario con la
--   branch_membership marcada como `is_default = true`.
--
--   ANTECEDENTE: el claim `app_metadata.branch_id` es NUEVO (Fase 11).
--   Solo se setea cuando el usuario ejecuta `switchActiveBranchAction`
--   (que llama `supabaseAdmin.auth.admin.updateUserById` con el nuevo
--   branch_id). Los usuarios existentes que aún no interactuaron con
--   el selector de sucursal tienen su JWT sin este claim, lo que hace
--   que `requireBranchContext()` lance `NO_BRANCH_CONTEXT` y las
--   páginas fallen.
--
--   Esta migración sincroniza el backfill al `auth.users.raw_app_meta_data`
--   para que el PRÓXIMO refresh de sesión ya traiga `branch_id`.
--
-- ⚠️  IMPORTANTE - JWTs cacheados:
--   Los JWTs cacheados en el navegador del usuario NO se actualizan
--   automáticamente. El usuario debe cerrar sesión y volver a entrar
--   (logout + login), o el cliente debe llamar
--   `supabase.auth.refreshSession()`.
--
--   En código de servidor, el fix blinda `requireBranchContext()` y
--   `getCurrentBranchId()` con un fallback a `is_default`
--   (ver `lib/supabase/branch-context.ts`), por lo que el bug es
--   transparente para los flujos que pasan por el helper. Esta
--   migración optimiza futuros logins.
--
-- PREREQUISITOS:
--   1. 20261101000001 aplicada (branch_memberships existe, con backfill
--      ejecutado). Cada company_membership debe tener al menos una
--      branch_membership con `is_default=true`.
--   2. branch_memberships tiene el índice único parcial
--      `uniq_branch_default_per_user (user_id) WHERE is_default`, lo que
--      garantiza que un usuario tiene a lo sumo una `is_default=true`.
--
-- IDEMPOTENTE: Sí. La condición `IS DISTINCT FROM` evita reescribir si
--              el valor ya es correcto. Re-ejecuciones son no-op.
--
-- REVERSIBLE: Sí. Ver RK_20261101000006_remove_branch_from_jwt.sql.
--             ⚠️ El rollback BORRA `branch_id` para TODOS los usuarios
--             (incluso si lo tenían antes por `switchActiveBranchAction`).
--             Solo seguro si todos los branch_id existentes vienen
--             exclusivamente de este backfill.
--
-- ORDEN DE APLICACIÓN (Bloque C, parte 3 — fix post-deploy):
--   1. 20261101000000_create_branches.sql
--   2. 20261101000001_branch_memberships.sql
--   3. 20261101000002_create_branch_stock.sql
--   4. 20261101000003_add_branch_id_to_tables.sql
--   5. 20261101000004_tenant_rpc_with_branch.sql
--   6. 20261101000005_rls_with_branches.sql
--   7. 20261101000006_sync_branch_id_to_jwt.sql   ← ESTE (post-deploy)
-- ==========================================

BEGIN;

-- ============================================
-- PASO 1: Setear `app_metadata.branch_id` desde `is_default`.
-- ============================================
-- Solo afecta usuarios con branch_membership.is_default = true.
-- La condición `IS DISTINCT FROM` (null-safe) hace la migración
-- idempotente: si el claim ya coincide, no se reescribe.
--
-- Si un usuario tiene branch_id pre-existente en su JWT (caso:
-- usó switchActiveBranchAction recientemente), su valor se
-- RESPETA (la condición IS DISTINCT FROM garantiza no-op si ya
-- coincide). Si difiere del is_default (caso degenerado: el
-- owner le cambió el default manualmente y no refrescó sesión),
-- se SOBREESCRIBE con el is_default actual.
-- ============================================

UPDATE auth.users au
SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('branch_id', bm.branch_id::text)
FROM branch_memberships bm
WHERE bm.user_id = au.id
  AND bm.is_default = true
  AND (raw_app_meta_data ->> 'branch_id') IS DISTINCT FROM bm.branch_id::text;

-- ============================================
-- PASO 2 (defensa): si un usuario NO tiene is_default=true
-- (raro: branch_memberships sin backfill completo), pero SÍ
-- tiene al menos una branch_membership, NO le seteamos
-- branch_id. La razón: un usuario sin is_default verdadero
-- tiene membrisías en múltiples sucursales; forzar una
-- "primera" sería arbitrario y crearía un acoplamiento entre
-- `is_default` y `app_metadata.branch_id` que no queremos.
-- ============================================

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- 1. Todos los usuarios con branch_membership.is_default=true
--    deben tener el claim sincronizado:
--
--    SELECT
--        u.id,
--        u.email,
--        u.raw_app_meta_data ->> 'branch_id' AS jwt_branch_id,
--        bm.branch_id AS is_default_branch_id,
--        (u.raw_app_meta_data ->> 'branch_id') = bm.branch_id::text AS synced
--    FROM auth.users u
--    JOIN branch_memberships bm
--      ON bm.user_id = u.id AND bm.is_default = true;
--    -- Esperado: todas las filas con synced = true.
--
-- 2. Usuarios SIN branch_id en JWT que no tienen is_default
--    (típico: usuarios recién invitados sin asignar):
--
--    SELECT COUNT(*) FROM auth.users u
--    WHERE (u.raw_app_meta_data ->> 'branch_id') IS NULL
--      AND EXISTS (
--          SELECT 1 FROM branch_memberships bm WHERE bm.user_id = u.id
--      )
--      AND NOT EXISTS (
--          SELECT 1 FROM branch_memberships bm
--          WHERE bm.user_id = u.id AND bm.is_default = true
--      );
--    -- Esperado: 0 (o solo usuarios con branch_memberships sin is_default,
--    -- caso que no tocamos deliberadamente).
--
-- 3. Smoke test crítico (resolver NO_BRANCH_CONTEXT):
--    - Login con un usuario existente de Distribelleza.
--    - Llamar `supabase.auth.refreshSession()` en el cliente.
--    - Verificar que `user.app_metadata.branch_id` ya tiene valor.
--    - Cargar dashboard → deben aparecer datos (no NO_BRANCH_CONTEXT).
-- ==========================================