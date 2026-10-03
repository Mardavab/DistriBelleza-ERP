-- ==========================================
-- LIMPIEZA BRUTAL — Eliminar TODO de Fase 1 sin DO blocks
-- ==========================================
-- OBJETIVO: Limpieza 100% garantizada. Sin lógica condicional compleja.
--           Si algo falla a mitad, cada statement se commitea por separado.
--           Es seguro re-ejecutar.
-- ==========================================
-- INSTRUCCIONES: Copiar y ejecutar TODO este archivo en el SQL Editor.
-- ==========================================

-- ============================================
-- PASO 1: Eliminar FKs (drop table workspace no afecta production real,
--         pero asegura que no haya FKs colgadas)
-- ============================================

ALTER TABLE products              DROP CONSTRAINT IF EXISTS fk_products_company;
ALTER TABLE product_variants      DROP CONSTRAINT IF EXISTS fk_variants_company;
ALTER TABLE customers             DROP CONSTRAINT IF EXISTS fk_customers_company;
ALTER TABLE sales                 DROP CONSTRAINT IF EXISTS fk_sales_company;
ALTER TABLE sale_items            DROP CONSTRAINT IF EXISTS fk_sale_items_company;
ALTER TABLE customer_payments     DROP CONSTRAINT IF EXISTS fk_customer_payments_company;
ALTER TABLE cash_sessions         DROP CONSTRAINT IF EXISTS fk_cash_sessions_company;
ALTER TABLE expenses              DROP CONSTRAINT IF EXISTS fk_expenses_company;
ALTER TABLE supplier_payments     DROP CONSTRAINT IF EXISTS fk_supplier_payments_company;
ALTER TABLE major_expenses        DROP CONSTRAINT IF EXISTS fk_major_expenses_company;
ALTER TABLE inventory_movements   DROP CONSTRAINT IF EXISTS fk_inventory_movements_company;
ALTER TABLE audit_logs            DROP CONSTRAINT IF EXISTS fk_audit_logs_company;
ALTER TABLE suppliers             DROP CONSTRAINT IF EXISTS fk_suppliers_company;
ALTER TABLE supplier_invoices     DROP CONSTRAINT IF EXISTS fk_supplier_invoices_company;
ALTER TABLE profiles              DROP CONSTRAINT IF EXISTS fk_profiles_company;

-- ============================================
-- PASO 2: Eliminar índices (todos seguros con IF EXISTS)
-- ============================================

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

-- ============================================
-- PASO 3: Eliminar tablas (CASCADE elimina triggers automáticamente)
-- ============================================
-- El orden importa por las FKs:
--   - company_settings tiene FK a companies
--   - companies NO tiene FK a nadie de las nuevas
-- Entonces primero company_settings, después companies.

DROP TABLE IF EXISTS company_settings CASCADE;
DROP TABLE IF EXISTS tenant_migration_audit CASCADE;
DROP TABLE IF EXISTS companies CASCADE;

-- ============================================
-- PASO 4: Eliminar columnas company_id
-- ============================================
-- DROP COLUMN IF EXISTS es seguro aunque la tabla no exista (no hace nada).

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

-- ============================================
-- VERIFICACIÓN FINAL — debe devolver 0 filas en cada query
-- ============================================

-- A. Tablas nuevas restantes
SELECT COUNT(*) AS tablas_fase1_restantes
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('companies', 'company_settings', 'tenant_migration_audit');

-- B. Columnas company_id restantes
SELECT COUNT(*) AS columnas_company_id_restantes
FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'company_id';

-- C. FKs de company restantes
SELECT COUNT(*) AS fks_company_restantes
FROM pg_constraint
WHERE contype = 'f' AND conname LIKE 'fk_%_company';

-- D. Índices company restantes
SELECT COUNT(*) AS indices_company_restantes
FROM pg_indexes
WHERE schemaname = 'public' AND indexname LIKE 'idx_%company%';

-- E. Triggers de Fase 1 restantes
SELECT COUNT(*) AS triggers_fase1_restantes
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name IN ('trg_companies_updated_at', 'trg_company_settings_updated_at');

-- Si todas devuelven 0: LIMPIEZA COMPLETA. Proceder a re-aplicar Fase 1.
-- Si alguna devuelve >0: RE-EJECUTAR este script completo.