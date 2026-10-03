-- ==========================================
-- MIGRACIÓN 20261003200300 - SET company_id NOT NULL
-- Fase 2 - Backfill (multi-tenant)
-- ==========================================
-- OBJETIVO: Restringir company_id a NOT NULL en las 15 tablas per-tenant.
--           ESTE PASO ES RESTRICTIVO: solo ejecutarlo DESPUÉS de verificar
--           que el backfill fue completo (Fase 2.2).
-- IDEMPOTENTE: Sí. ALTER COLUMN SET NOT NULL es idempotente (segunda
--              ejecución no hace nada si ya es NOT NULL).
-- ==========================================
-- ⚠️ ADVERTENCIA CRÍTICA ⚠️
-- Si CUALQUIER fila quedó con company_id = NULL por error, este script
-- FALLA con un error de constraint. Esto es intencional: detecta fallos.
--
-- Si esto falla, REVERTIR con:
--   RK_20261003200000_rollback_backfill.sql
-- ==========================================

BEGIN;

-- 1. products
ALTER TABLE products              ALTER COLUMN company_id SET NOT NULL;

-- 2. product_variants
ALTER TABLE product_variants      ALTER COLUMN company_id SET NOT NULL;

-- 3. customers
ALTER TABLE customers             ALTER COLUMN company_id SET NOT NULL;

-- 4. sales
ALTER TABLE sales                 ALTER COLUMN company_id SET NOT NULL;

-- 5. sale_items
ALTER TABLE sale_items            ALTER COLUMN company_id SET NOT NULL;

-- 6. customer_payments
ALTER TABLE customer_payments     ALTER COLUMN company_id SET NOT NULL;

-- 7. cash_sessions
ALTER TABLE cash_sessions         ALTER COLUMN company_id SET NOT NULL;

-- 8. expenses
ALTER TABLE expenses              ALTER COLUMN company_id SET NOT NULL;

-- 9. supplier_payments
ALTER TABLE supplier_payments     ALTER COLUMN company_id SET NOT NULL;

-- 10. major_expenses
ALTER TABLE major_expenses        ALTER COLUMN company_id SET NOT NULL;

-- 11. inventory_movements
ALTER TABLE inventory_movements   ALTER COLUMN company_id SET NOT NULL;

-- 12. audit_logs
ALTER TABLE audit_logs            ALTER COLUMN company_id SET NOT NULL;

-- 13. suppliers
ALTER TABLE suppliers             ALTER COLUMN company_id SET NOT NULL;

-- 14. supplier_invoices
ALTER TABLE supplier_invoices     ALTER COLUMN company_id SET NOT NULL;

-- 15. profiles
ALTER TABLE profiles              ALTER COLUMN company_id SET NOT NULL;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-NOT NULL
-- ==========================================
-- Esta query debe devolver 0 filas (todas las columnas son NOT NULL):
--
-- SELECT table_name, column_name, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND column_name = 'company_id'
--   AND is_nullable = 'YES'
-- ORDER BY table_name;
-- ==========================================
--
-- company_settings.company_id sigue siendo NOT NULL (era parte del PK).
-- companies.id siempre ha sido NOT NULL.
-- ==========================================