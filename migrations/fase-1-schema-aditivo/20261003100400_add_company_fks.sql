-- ==========================================
-- MIGRACIÓN 20261003100400 - Foreign keys de company_id
-- Fase 1 - Schema aditivo (multi-tenant)
-- ==========================================
-- OBJETIVO: Vincular company_id a la tabla companies vía restricción de FK.
--           La FK permite NULL hasta que Fase 2 rellene las columnas.
-- REVERSIBLE: Sí. Ver migrations/RK_20261003100000_drop_companies.sql
-- IDEMPOTENTE: Sí. Usa DO blocks para verificar existencia.
-- ==========================================
-- NOTA SOBRE PATRÓN:
-- ALTER TABLE ADD CONSTRAINT no soporta IF NOT EXISTS en versiones antiguas.
-- Se usa un DO block para verificar antes de agregar.
-- ==========================================

BEGIN;

-- Helper: agregar FK si no existe
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    -- 1. products
    SELECT conname INTO constraint_name FROM pg_constraint
    WHERE conrelid = 'products'::regclass AND contype = 'f' AND conname = 'fk_products_company';
    IF constraint_name IS NULL THEN
        ALTER TABLE products ADD CONSTRAINT fk_products_company
            FOREIGN KEY (company_id) REFERENCES companies(id);
    END IF;

    -- 2. product_variants
    SELECT conname INTO constraint_name FROM pg_constraint
    WHERE conrelid = 'product_variants'::regclass AND contype = 'f' AND conname = 'fk_variants_company';
    IF constraint_name IS NULL THEN
        ALTER TABLE product_variants ADD CONSTRAINT fk_variants_company
            FOREIGN KEY (company_id) REFERENCES companies(id);
    END IF;

    -- 3. customers
    SELECT conname INTO constraint_name FROM pg_constraint
    WHERE conrelid = 'customers'::regclass AND contype = 'f' AND conname = 'fk_customers_company';
    IF constraint_name IS NULL THEN
        ALTER TABLE customers ADD CONSTRAINT fk_customers_company
            FOREIGN KEY (company_id) REFERENCES companies(id);
    END IF;

    -- 4. sales
    SELECT conname INTO constraint_name FROM pg_constraint
    WHERE conrelid = 'sales'::regclass AND contype = 'f' AND conname = 'fk_sales_company';
    IF constraint_name IS NULL THEN
        ALTER TABLE sales ADD CONSTRAINT fk_sales_company
            FOREIGN KEY (company_id) REFERENCES companies(id);
    END IF;

    -- 5. sale_items
    SELECT conname INTO constraint_name FROM pg_constraint
    WHERE conrelid = 'sale_items'::regclass AND contype = 'f' AND conname = 'fk_sale_items_company';
    IF constraint_name IS NULL THEN
        ALTER TABLE sale_items ADD CONSTRAINT fk_sale_items_company
            FOREIGN KEY (company_id) REFERENCES companies(id);
    END IF;

    -- 6. customer_payments
    SELECT conname INTO constraint_name FROM pg_constraint
    WHERE conrelid = 'customer_payments'::regclass AND contype = 'f' AND conname = 'fk_customer_payments_company';
    IF constraint_name IS NULL THEN
        ALTER TABLE customer_payments ADD CONSTRAINT fk_customer_payments_company
            FOREIGN KEY (company_id) REFERENCES companies(id);
    END IF;

    -- 7. cash_sessions
    SELECT conname INTO constraint_name FROM pg_constraint
    WHERE conrelid = 'cash_sessions'::regclass AND contype = 'f' AND conname = 'fk_cash_sessions_company';
    IF constraint_name IS NULL THEN
        ALTER TABLE cash_sessions ADD CONSTRAINT fk_cash_sessions_company
            FOREIGN KEY (company_id) REFERENCES companies(id);
    END IF;

    -- 8. expenses
    SELECT conname INTO constraint_name FROM pg_constraint
    WHERE conrelid = 'expenses'::regclass AND contype = 'f' AND conname = 'fk_expenses_company';
    IF constraint_name IS NULL THEN
        ALTER TABLE expenses ADD CONSTRAINT fk_expenses_company
            FOREIGN KEY (company_id) REFERENCES companies(id);
    END IF;

    -- 9. supplier_payments
    SELECT conname INTO constraint_name FROM pg_constraint
    WHERE conrelid = 'supplier_payments'::regclass AND contype = 'f' AND conname = 'fk_supplier_payments_company';
    IF constraint_name IS NULL THEN
        ALTER TABLE supplier_payments ADD CONSTRAINT fk_supplier_payments_company
            FOREIGN KEY (company_id) REFERENCES companies(id);
    END IF;

    -- 10. major_expenses
    SELECT conname INTO constraint_name FROM pg_constraint
    WHERE conrelid = 'major_expenses'::regclass AND contype = 'f' AND conname = 'fk_major_expenses_company';
    IF constraint_name IS NULL THEN
        ALTER TABLE major_expenses ADD CONSTRAINT fk_major_expenses_company
            FOREIGN KEY (company_id) REFERENCES companies(id);
    END IF;

    -- 11. inventory_movements
    SELECT conname INTO constraint_name FROM pg_constraint
    WHERE conrelid = 'inventory_movements'::regclass AND contype = 'f' AND conname = 'fk_inventory_movements_company';
    IF constraint_name IS NULL THEN
        ALTER TABLE inventory_movements ADD CONSTRAINT fk_inventory_movements_company
            FOREIGN KEY (company_id) REFERENCES companies(id);
    END IF;

    -- 12. audit_logs
    SELECT conname INTO constraint_name FROM pg_constraint
    WHERE conrelid = 'audit_logs'::regclass AND contype = 'f' AND conname = 'fk_audit_logs_company';
    IF constraint_name IS NULL THEN
        ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_logs_company
            FOREIGN KEY (company_id) REFERENCES companies(id);
    END IF;

    -- 13. suppliers
    SELECT conname INTO constraint_name FROM pg_constraint
    WHERE conrelid = 'suppliers'::regclass AND contype = 'f' AND conname = 'fk_suppliers_company';
    IF constraint_name IS NULL THEN
        ALTER TABLE suppliers ADD CONSTRAINT fk_suppliers_company
            FOREIGN KEY (company_id) REFERENCES companies(id);
    END IF;

    -- 14. supplier_invoices
    SELECT conname INTO constraint_name FROM pg_constraint
    WHERE conrelid = 'supplier_invoices'::regclass AND contype = 'f' AND conname = 'fk_supplier_invoices_company';
    IF constraint_name IS NULL THEN
        ALTER TABLE supplier_invoices ADD CONSTRAINT fk_supplier_invoices_company
            FOREIGN KEY (company_id) REFERENCES companies(id);
    END IF;

    -- 15. profiles
    SELECT conname INTO constraint_name FROM pg_constraint
    WHERE conrelid = 'profiles'::regclass AND contype = 'f' AND conname = 'fk_profiles_company';
    IF constraint_name IS NULL THEN
        ALTER TABLE profiles ADD CONSTRAINT fk_profiles_company
            FOREIGN KEY (company_id) REFERENCES companies(id);
    END IF;

    RAISE NOTICE 'Foreign keys de company_id creadas/verificadas para 15 tablas.';
END $$;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN (OBLIGATORIA)
-- ==========================================
-- Debe devolver 15 filas:
--
-- SELECT
--     tc.table_name,
--     tc.constraint_name,
--     kcu.column_name,
--     ccu.table_name AS foreign_table_name,
--     ccu.column_name AS foreign_column_name
-- FROM information_schema.table_constraints tc
-- JOIN information_schema.key_column_usage kcu
--     ON tc.constraint_name = kcu.constraint_name
-- JOIN information_schema.constraint_column_usage ccu
--     ON tc.constraint_name = ccu.constraint_name
-- WHERE tc.constraint_type = 'FOREIGN KEY'
--   AND tc.constraint_name LIKE 'fk_%_company'
-- ORDER BY tc.table_name;
-- ==========================================