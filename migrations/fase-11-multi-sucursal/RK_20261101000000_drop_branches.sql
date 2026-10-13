-- ==========================================
-- ROLLBACK 20261101000000 - Eliminar tabla branches
-- Fase 11 - Multi-sucursal (Bloque B)
-- ==========================================
-- OBJETIVO:
--   Devolver el schema al estado previo a 20261101000000 (sin branches).
--   Elimina las políticas RLS, el trigger y la tabla completa.
--
-- ADVERTENCIA:
--   Este rollback NO restaura las filas eliminadas porque branches
--   es una tabla nueva: DROP TABLE la elimina junto con sus datos.
--   En fase 11, las filas se generaron a partir del backfill de Fase 1/2
--   y se pueden volver a crear ejecutando de nuevo 20261101000000.
--
-- IDEMPOTENTE: Sí. Usa `DROP POLICY IF EXISTS`, `DROP TRIGGER IF EXISTS`,
--              `DROP TABLE IF EXISTS`.
-- ==========================================

BEGIN;

DROP POLICY IF EXISTS "membership_select_branches" ON branches;
DROP TRIGGER IF EXISTS trg_branches_updated_at ON branches;
DROP TABLE IF EXISTS branches;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-ROLLBACK
-- ==========================================
-- 1. La tabla no debe existir:
--    SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name = 'branches';
--    -- Esperado: 0 filas
-- ==========================================