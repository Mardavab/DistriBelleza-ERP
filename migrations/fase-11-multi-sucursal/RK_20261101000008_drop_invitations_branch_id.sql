-- ==========================================
-- ROLLBACK 20261101000008 - Eliminar branch_id de invitations
-- Fase 11 - Multi-sucursal (Bloque C)
-- ==========================================
-- OBJETIVO:
--   Devolver invitations al estado previo a 20261101000008: sin
--   columna branch_id ni su índice.
--
-- ADVERTENCIA:
--   Este rollback BORRA el branch_id de cada invitación (incluso
--   invitaciones pendientes). Tras el rollback, las invitaciones
--   pendientes quedan SIN sucursal asignada: el código TS las resuelve
--   con fallback a MAIN (mismo path que las invitaciones legacy).
--
-- IDEMPOTENTE: Sí. DROP INDEX IF EXISTS, ALTER TABLE ... DROP COLUMN
--              IF EXISTS.
-- ==========================================

BEGIN;

DROP INDEX IF EXISTS idx_invitations_branch_pending;

ALTER TABLE invitations DROP COLUMN IF EXISTS branch_id;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-ROLLBACK
-- ==========================================
-- 1. La columna branch_id no debe existir:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'invitations'
--      AND column_name = 'branch_id';
--    -- Esperado: 0 filas
--
-- 2. El índice debe haber desaparecido:
--    SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public' AND tablename = 'invitations'
--      AND indexname = 'idx_invitations_branch_pending';
--    -- Esperado: 0 filas
-- ==========================================