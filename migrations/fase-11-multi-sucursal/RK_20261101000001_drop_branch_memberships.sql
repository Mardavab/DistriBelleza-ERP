-- ==========================================
-- ROLLBACK 20261101000001 - Eliminar tabla branch_memberships
-- Fase 11 - Multi-sucursal (Bloque B)
-- ==========================================
-- OBJETIVO:
--   Devolver el schema al estado previo a 20261101000001.
--   Elimina las políticas RLS y la tabla completa.
--
-- ADVERTENCIA:
--   Este rollback NO restaura las filas eliminadas. Como la tabla
--   es nueva y se generó por backfill, ejecutar de nuevo 20261101000001
--   las recrea a partir de company_memberships.
--
-- IDEMPOTENTE: Sí. DROP POLICY IF EXISTS, DROP TABLE IF EXISTS.
-- ==========================================

BEGIN;

DROP POLICY IF EXISTS "self_branch_memberships_select" ON branch_memberships;
DROP POLICY IF EXISTS "owner_tenant_branch_memberships" ON branch_memberships;
DROP TABLE IF EXISTS branch_memberships;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-ROLLBACK
-- ==========================================
-- 1. La tabla no debe existir:
--    SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name = 'branch_memberships';
--    -- Esperado: 0 filas
-- ==========================================