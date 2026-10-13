-- ==========================================
-- ROLLBACK 20261101000002 - Eliminar tabla branch_stock
-- Fase 11 - Multi-sucursal (Bloque B)
-- ==========================================
-- OBJETIVO:
--   Devolver el schema al estado previo a 20261101000002.
--   Elimina las políticas RLS, el trigger y la tabla completa.
--
-- ADVERTENCIA:
--   Este rollback NO restaura las filas eliminadas. Como la tabla es
--   nueva y se generó por backfill desde product_variants, ejecutar
--   de nuevo 20261101000002 las recrea con stock = product_variants.stock.
--
-- IDEMPOTENTE: Sí. DROP POLICY IF EXISTS, DROP TRIGGER IF EXISTS, DROP TABLE IF EXISTS.
-- ==========================================

BEGIN;

DROP POLICY IF EXISTS "membership_select_branch_stock" ON branch_stock;
DROP POLICY IF EXISTS "membership_insert_branch_stock" ON branch_stock;
DROP POLICY IF EXISTS "membership_update_branch_stock" ON branch_stock;
DROP POLICY IF EXISTS "membership_delete_branch_stock" ON branch_stock;
DROP TRIGGER IF EXISTS trg_branch_stock_updated_at ON branch_stock;
DROP TABLE IF EXISTS branch_stock;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-ROLLBACK
-- ==========================================
-- 1. La tabla no debe existir:
--    SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name = 'branch_stock';
--    -- Esperado: 0 filas
-- ==========================================