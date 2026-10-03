-- ==========================================
-- ROLLBACK 20261003100000 - Eliminar todo lo de Fase 1
-- ==========================================
-- OBJETIVO: Deshacer Fase 1 completamente. NO se pierden datos:
--           - Se eliminan columnas company_id (NULL en este punto, no afecta)
--           - Se eliminan FKs, índices compuestos y tablas nuevas.
-- USAR: Solo si Fase 1 falla o se decide abortar el roadmap multi-tenant.
-- IDEMPOTENTE: Sí. Cada DROP protegido con validación.
-- ==========================================
-- VERSIÓN 2 — corregir bug original:
--   El DROP TRIGGER IF EXISTS ... ON <tabla> falla si la tabla no existe,
--   porque Postgres comprueba la tabla antes del trigger. Ahora se valida
--   que la tabla exista antes de intentar eliminar el trigger.
-- ==========================================

BEGIN;

-- ============================================================
-- 1. Eliminar FKs de company_id
-- ============================================================
DO $$
DECLARE
    constraint_record RECORD;
BEGIN
    FOR constraint_record IN
        SELECT conname, conrelid::regclass::text AS tabla
        FROM pg_constraint
        WHERE contype = 'f' AND conname LIKE 'fk_%_company'
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I',
                       constraint_record.tabla, constraint_record.conname);
    END LOOP;
END $$;

-- ============================================================
-- 2. Eliminar índices (idempotente)
-- ============================================================
DROP INDEX IF EXISTS idx_variants_company_sku;
DROP INDEX IF EXISTS idx_variants_company_barcode;
DROP INDEX IF EXISTS idx_customers_company_email;
DROP INDEX IF EXISTS idx_categories_company_name;

DROP INDEX IF EXISTS idx_products_company_id;
DROP INDEX IF EXISTS idx_product_variants_company_id;
DROP INDEX IF EXISTS idx_customers_company_id;
DROP INDEX IF EXISTS idx_sales_company_id;
DROP INDEX IF EXISTS idx_sales_company_created;
DROP INDEX IF EXISTS idx_sale_items_company_id;
DROP INDEX IF EXISTS idx_customer_payments_company_id;
DROP INDEX IF EXISTS idx_cash_sessions_company_id;
DROP INDEX IF EXISTS idx_cash_sessions_company_status;
DROP INDEX IF EXISTS idx_expenses_company_id;
DROP INDEX IF EXISTS idx_supplier_payments_company_id;
DROP INDEX IF EXISTS idx_major_expenses_company_id;
DROP INDEX IF EXISTS idx_inventory_movements_company_id;
DROP INDEX IF EXISTS idx_audit_logs_company_id;
DROP INDEX IF EXISTS idx_suppliers_company_id;
DROP INDEX IF EXISTS idx_supplier_invoices_company_id;
DROP INDEX IF EXISTS idx_profiles_company_id;

DROP INDEX IF EXISTS idx_companies_slug;
DROP INDEX IF EXISTS idx_companies_active;

DROP INDEX IF EXISTS idx_company_settings_key;
DROP INDEX IF EXISTS idx_tma_table_name;
DROP INDEX IF EXISTS idx_tma_table_row;
DROP INDEX IF EXISTS idx_tma_migrated_at;

-- ============================================================
-- 3. Eliminar triggers (validando tabla primero)
-- ============================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'companies') THEN
        DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'company_settings') THEN
        DROP TRIGGER IF EXISTS trg_company_settings_updated_at ON company_settings;
    END IF;
END $$;

-- ============================================================
-- 4. Eliminar columnas company_id (idempotente)
-- ============================================================
ALTER TABLE products              DROP COLUMN IF EXISTS company_id;
ALTER TABLE product_variants      DROP COLUMN IF EXISTS company_id;
ALTER TABLE customers             DROP COLUMN IF EXISTS company_id;
ALTER TABLE sales                 DROP COLUMN IF EXISTS company_id;
ALTER TABLE sale_items            DROP COLUMN IF EXISTS company_id;
ALTER TABLE customer_payments     DROP COLUMN IF EXISTS company_id;
ALTER TABLE cash_sessions         DROP COLUMN IF EXISTS company_id;
ALTER TABLE expenses              DROP COLUMN IF EXISTS company_id;
ALTER TABLE supplier_payments     DROP COLUMN IF EXISTS company_id;
ALTER TABLE major_expenses        DROP COLUMN IF EXISTS company_id;
ALTER TABLE inventory_movements   DROP COLUMN IF EXISTS company_id;
ALTER TABLE audit_logs            DROP COLUMN IF EXISTS company_id;
ALTER TABLE suppliers             DROP COLUMN IF EXISTS company_id;
ALTER TABLE supplier_invoices     DROP COLUMN IF EXISTS company_id;
ALTER TABLE profiles              DROP COLUMN IF EXISTS company_id;

-- ============================================================
-- 5. Eliminar tablas nuevas (orden inverso por dependencias FK)
-- ============================================================
DROP TABLE IF EXISTS tenant_migration_audit CASCADE;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'company_settings') THEN
        DROP TABLE company_settings CASCADE;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'companies') THEN
        DROP TABLE companies CASCADE;
    END IF;
END $$;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-ROLLBACK
-- ==========================================
-- Esta query debe devolver 0 filas para confirmar estado limpio:
--
-- SELECT conrelid::regclass::text AS tabla, conname
-- FROM pg_constraint
-- WHERE contype = 'f' AND conname LIKE 'fk_%_company'
-- UNION ALL
-- SELECT 'tabla ' || table_name, table_name
-- FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('companies', 'company_settings', 'tenant_migration_audit')
-- UNION ALL
-- SELECT 'columna ' || table_name, column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND column_name = 'company_id';
-- ==========================================