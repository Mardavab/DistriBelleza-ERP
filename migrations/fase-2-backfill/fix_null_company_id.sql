-- ==========================================
-- FIX — Re-aplicar company_id a filas NULL restantes
-- ==========================================
-- OBJETIVO: Después de un backfill incompleto o inserciones posteriores,
--           actualizar cualquier fila con company_id = NULL al tenant
--           Distribelleza.
-- SEGURO: Idempotente. Solo actualiza filas donde company_id IS NULL.
-- ==========================================
-- ⚠️ EJECUTAR SOLO DESPUÉS de diagnose_null_company_id.sql para confirmar
--    que hay NULLs restantes.
-- ==========================================

BEGIN;

-- Deshabilitar triggers de inmutabilidad
ALTER TABLE inventory_movements DISABLE TRIGGER tr_inventory_movements_immutable;
ALTER TABLE audit_logs DISABLE TRIGGER tr_audit_logs_immutable;

DO $$
DECLARE
    target_company UUID := '11111111-1111-1111-1111-111111111111';
    null_count BIGINT;
    affected_count BIGINT;
    tbl_name TEXT;
    target_tables TEXT[] := ARRAY[
        'products', 'product_variants', 'customers', 'sales', 'sale_items',
        'customer_payments', 'cash_sessions', 'expenses', 'supplier_payments',
        'major_expenses', 'inventory_movements', 'audit_logs', 'suppliers',
        'supplier_invoices', 'profiles'
    ];
BEGIN
    FOREACH tbl_name IN ARRAY target_tables
    LOOP
        EXECUTE format('UPDATE %I SET company_id = $1 WHERE company_id IS NULL', tbl_name)
            USING target_company;
        GET DIAGNOSTICS affected_count = ROW_COUNT;

        IF affected_count > 0 THEN
            RAISE NOTICE '%: % filas NULL actualizadas', tbl_name, affected_count;
        END IF;

        EXECUTE format('SELECT COUNT(*) FROM %I WHERE company_id IS NULL', tbl_name)
            INTO null_count;

        IF null_count > 0 THEN
            RAISE EXCEPTION 'Aun quedan % filas NULL en companies', null_count;
        END IF;
    END LOOP;

    RAISE NOTICE '============================================';
    RAISE NOTICE 'Todas las filas NULL fueron actualizadas.';
    RAISE NOTICE '============================================';
END $$;

-- Rehabilitar triggers
ALTER TABLE inventory_movements ENABLE TRIGGER tr_inventory_movements_immutable;
ALTER TABLE audit_logs ENABLE TRIGGER tr_audit_logs_immutable;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-FIX
-- ==========================================
-- Esta query debe devolver 0 filas:
--
-- SELECT table_name, COUNT(*) AS null_count
-- FROM (
--     SELECT 'products' AS table_name, NULL::uuid AS company_id FROM products WHERE company_id IS NULL
--     UNION ALL SELECT 'product_variants', NULL FROM product_variants WHERE company_id IS NULL
--     UNION ALL SELECT 'customers', NULL FROM customers WHERE company_id IS NULL
--     UNION ALL SELECT 'sales', NULL FROM sales WHERE company_id IS NULL
--     UNION ALL SELECT 'sale_items', NULL FROM sale_items WHERE company_id IS NULL
--     UNION ALL SELECT 'customer_payments', NULL FROM customer_payments WHERE company_id IS NULL
--     UNION ALL SELECT 'cash_sessions', NULL FROM cash_sessions WHERE company_id IS NULL
--     UNION ALL SELECT 'expenses', NULL FROM expenses WHERE company_id IS NULL
--     UNION ALL SELECT 'supplier_payments', NULL FROM supplier_payments WHERE company_id IS NULL
--     UNION ALL SELECT 'major_expenses', NULL FROM major_expenses WHERE company_id IS NULL
--     UNION ALL SELECT 'inventory_movements', NULL FROM inventory_movements WHERE company_id IS NULL
--     UNION ALL SELECT 'audit_logs', NULL FROM audit_logs WHERE company_id IS NULL
--     UNION ALL SELECT 'suppliers', NULL FROM suppliers WHERE company_id IS NULL
--     UNION ALL SELECT 'supplier_invoices', NULL FROM supplier_invoices WHERE company_id IS NULL
--     UNION ALL SELECT 'profiles', NULL FROM profiles WHERE company_id IS NULL
-- ) sub
-- GROUP BY table_name;
--
-- Después de este fix, re-ejecutar 20261003200300_set_company_id_not_null.sql
-- ==========================================