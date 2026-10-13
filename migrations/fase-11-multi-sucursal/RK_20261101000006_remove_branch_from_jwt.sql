-- ==========================================
-- ROLLBACK 20261101000006 - Eliminar app_metadata.branch_id de todos los usuarios
-- Fase 11 - Multi-sucursal (Bloque C — fix post-deploy)
-- ==========================================
-- OBJETIVO:
--   Quitar el claim `branch_id` del `raw_app_meta_data` de todos los
--   usuarios de `auth.users`. Necesario si se decide volver al estado
--   previo a esta migración (donde solo `switchActiveBranchAction`
--   podía popular el claim).
--
-- ⚠️  PELIGRO: este rollback BORRA `branch_id` para TODOS los usuarios,
--     incluso si el valor provenía de `switchActiveBranchAction` (no
--     del backfill de 11.6). Tras ejecutarlo, los JWTs cacheados en
--     navegadores仍将 llevar `branch_id` hasta que el usuario refresque
--     sesión (logout/login o `refreshSession()`).
--
--     Pre-flight check antes de ejecutar:
--       SELECT id, raw_app_meta_data ->> 'branch_id' AS branch_id
--       FROM auth.users
--       WHERE raw_app_meta_data ? 'branch_id';
--     Si algún usuario tiene branch_id pre-existente que NO quieras
--     perder, revertir manualmente fila por fila:
--       UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data ||
--           jsonb_build_object('branch_id', '<valor_a_conservar>'::text)
--       WHERE id = '<user_id>';
--
-- IDEMPOTENTE: Sí (solo afecta filas con `branch_id` en app_metadata).
-- ==========================================

BEGIN;

UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data - 'branch_id'
WHERE raw_app_meta_data ? 'branch_id';

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-ROLLBACK
-- ==========================================
-- 1. Ningún usuario debe tener `branch_id` en app_metadata:
--
--    SELECT COUNT(*) FROM auth.users
--    WHERE raw_app_meta_data ? 'branch_id';
--    -- Esperado: 0.
--
-- 2. branch_memberships NO se ve afectada (solo tocamos JWT claims):
--
--    SELECT COUNT(*) FROM branch_memberships WHERE is_default = true;
--    -- Esperado: igual que antes del rollback (el conteo no cambia).
-- ==========================================