-- ==========================================
-- ROLLBACK 20261003200000 - Revertir Fase 2 (backfill)
-- ==========================================
-- OBJETIVO: Devolver la DB al estado de Fase 1 (company_id NULLABLE en 15 tablas).
--           NO se eliminan datos: solo se "desasigna" el tenant.
-- USAR: Si Fase 2 falla o se decide abortar el roadmap multi-tenant.
-- IDEMPOTENTE: Sí.
-- ==========================================
-- EFECTO POST-ROLLBACK:
--   - company_id en las 15 tablas vuelve a ser NULL (pero los datos siguen ahí).
--   - Tenant Distribelleza se mantiene en companies (puedes eliminarlo
--     manualmente si quieres).
--   - Registros de auditoría en tenant_migration_audit se mantienen
--     (es historial, no se borra).
--   - UNIQUE constraints antiguos se restauran.
-- ==========================================

BEGIN;

-- ============================================================
-- PASO 1: Restaurar UNIQUE constraints antiguos
-- ============================================================
-- (espejo de 20261003200400)
ALTER TABLE product_variants ADD CONSTRAINT product_variants_sku_key UNIQUE (sku);
ALTER TABLE product_variants ADD CONSTRAINT product_variants_barcode_key UNIQUE (barcode);
ALTER TABLE customers ADD CONSTRAINT customers_email_key UNIQUE (email);
ALTER TABLE categories ADD CONSTRAINT categories_name_key UNIQUE (name);

-- ============================================================
-- PASO 2: company_id → NULL (mantiene los datos, los "desasigna")
-- ============================================================
-- Es seguro: company_id actualmente tiene el valor del tenant, no NULL.
-- Después de esto, las filas existen pero sin tenant.

UPDATE products              SET company_id = NULL;
UPDATE product_variants      SET company_id = NULL;
UPDATE customers             SET company_id = NULL;
UPDATE sales                 SET company_id = NULL;
UPDATE sale_items            SET company_id = NULL;
UPDATE customer_payments     SET company_id = NULL;
UPDATE cash_sessions         SET company_id = NULL;
UPDATE expenses              SET company_id = NULL;
UPDATE supplier_payments     SET company_id = NULL;
UPDATE major_expenses        SET company_id = NULL;
UPDATE inventory_movements   SET company_id = NULL;
UPDATE audit_logs            SET company_id = NULL;
UPDATE suppliers             SET company_id = NULL;
UPDATE supplier_invoices     SET company_id = NULL;
UPDATE profiles              SET company_id = NULL;

-- ============================================================
-- PASO 3: company_id → DROP NOT NULL
-- ============================================================
-- (espejo de 20261003200300)

ALTER TABLE products              ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE product_variants      ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE customers             ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE sales                 ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE sale_items            ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE customer_payments     ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE cash_sessions         ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE expenses              ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE supplier_payments     ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE major_expenses        ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE inventory_movements   ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE audit_logs            ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE suppliers             ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE supplier_invoices     ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE profiles              ALTER COLUMN company_id DROP NOT NULL;

COMMIT;

-- ============================================================
-- (OPCIONAL) Eliminar tenant Distribelleza
-- ============================================================
-- Descomentar si quieres deshacer completamente:
--
-- DELETE FROM company_settings WHERE company_id = '11111111-1111-1111-1111-111111111111';
-- DELETE FROM companies WHERE id = '11111111-1111-1111-1111-111111111111';
--
-- Los registros en tenant_migration_audit NO se eliminan (historial).

-- ==========================================
-- VERIFICACIÓN POST-ROLLBACK
-- ==========================================
-- Esta query debe devolver 0 filas (sin filas asignadas):
--
-- SELECT table_name, COUNT(*) AS assigned
-- FROM (
--     SELECT 'products' AS table_name, company_id FROM products WHERE company_id IS NOT NULL
--     UNION ALL SELECT 'product_variants', company_id FROM product_variants WHERE company_id IS NOT NULL
--     -- ... repetir para las 15 tablas ...
-- ) sub
-- GROUP BY table_name;
--
-- company_id debe ser nullable en las 15 tablas:
--
-- SELECT table_name, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND column_name = 'company_id'
--   AND table_name != 'companies'
-- ORDER BY table_name;
--
-- Debe mostrar 15 filas, todas 'YES'.
-- ==========================================