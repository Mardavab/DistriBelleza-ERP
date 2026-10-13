-- ==========================================
-- ROLLBACK 20261101000003 - DROP branch_id en tablas operativas
-- Fase 11 - Multi-sucursal (Bloque B)
-- ==========================================
-- OBJETIVO:
--   Devolver el schema al estado previo a 20261101000003.
--   Quita la columna branch_id y sus índices en las 10 tablas.
--
-- ADVERTENCIA:
--   Este rollback NO restaura los branch_id que tenían las filas
--   (DROP COLUMN los elimina). Como branch_id es derivable
--   (siempre = sucursal MAIN de la empresa en este punto del
--   roadmap), se puede regenerar ejecutando de nuevo 20261101000003.
--
-- IDEMPOTENTE: Sí. DROP INDEX IF EXISTS, ALTER TABLE DROP COLUMN IF EXISTS.
--
-- IMPORTANTE sobre NOT NULL:
--   DROP COLUMN en Postgres elimina la restricción NOT NULL consigo.
--   No hace falta un ALTER COLUMN DROP NOT NULL separado.
-- ==========================================

BEGIN;

-- ============================================================
-- PASO 1: DROP COLUMN branch_id en las 10 tablas.
-- ============================================================
-- IF EXISTS garantiza idempotencia: si ya se dropeó antes, no-op.
-- ============================================================

ALTER TABLE sales                DROP COLUMN IF EXISTS branch_id;
ALTER TABLE sale_items           DROP COLUMN IF EXISTS branch_id;
ALTER TABLE cash_sessions        DROP COLUMN IF EXISTS branch_id;
ALTER TABLE inventory_movements  DROP COLUMN IF EXISTS branch_id;
ALTER TABLE customer_payments    DROP COLUMN IF EXISTS branch_id;
ALTER TABLE expenses             DROP COLUMN IF EXISTS branch_id;
ALTER TABLE supplier_payments    DROP COLUMN IF EXISTS branch_id;
ALTER TABLE supplier_invoices    DROP COLUMN IF EXISTS branch_id;
ALTER TABLE audit_logs           DROP COLUMN IF EXISTS branch_id;
ALTER TABLE major_expenses       DROP COLUMN IF EXISTS branch_id;

-- ============================================================
-- PASO 2: DROP índices asociados.
-- ============================================================
-- Postgres no dropea automáticamente los índices cuando se dropea
-- la columna (en 14+ sí, pero ser explícitos es más seguro y portable).
-- ============================================================

DROP INDEX IF EXISTS idx_sales_branch;
DROP INDEX IF EXISTS idx_sale_items_branch;
DROP INDEX IF EXISTS idx_cash_sessions_branch;
DROP INDEX IF EXISTS idx_inventory_movements_branch;
DROP INDEX IF EXISTS idx_customer_payments_branch;
DROP INDEX IF EXISTS idx_expenses_branch;
DROP INDEX IF EXISTS idx_supplier_payments_branch;
DROP INDEX IF EXISTS idx_supplier_invoices_branch;
DROP INDEX IF EXISTS idx_audit_logs_branch;
DROP INDEX IF EXISTS idx_major_expenses_branch;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-ROLLBACK
-- ==========================================
-- 1. branch_id NO debe existir en ninguna de las 10 tablas:
--    SELECT table_name, column_name
--    FROM information_schema.columns
--    WHERE table_schema = 'public' AND column_name = 'branch_id'
--      AND table_name IN (
--          'sales', 'sale_items', 'cash_sessions', 'inventory_movements',
--          'customer_payments', 'expenses', 'supplier_payments',
--          'supplier_invoices', 'audit_logs', 'major_expenses'
--      );
--    -- Esperado: 0 filas
-- ==========================================