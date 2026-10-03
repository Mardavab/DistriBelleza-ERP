-- ==========================================
-- MIGRACIÓN 20261003200100 - Backfill de company_id
-- Fase 2 - Backfill (multi-tenant)
-- ==========================================
-- OBJETIVO: Asignar company_id = '11111111-1111-1111-1111-111111111111'
--           (Distribelleza) a TODAS las filas existentes en las 15 tablas.
--           Validar que el 100% fue asignado antes de proceder.
-- IDEMPOTENTE: Sí. Usa WHERE company_id IS NULL en cada UPDATE.
--              Re-ejecutable sin efectos secundarios.
-- ==========================================
-- PRINCIPIO RECTOR CRÍTICO:
--   - Validamos con assert antes de tener un NOT NULL.
--   - Si CUALQUIER tabla tiene NULLs restantes, la transacción falla.
--   - NO se eliminan ni modifican datos existentes.
-- ==========================================
-- TABLAS INCLUIDAS (15):
--   products, product_variants, customers, sales, sale_items,
--   customer_payments, cash_sessions, expenses, supplier_payments,
--   major_expenses, inventory_movements, audit_logs, suppliers,
--   supplier_invoices, profiles
-- ==========================================
-- ⚠️ TABLAS CON TRIGGERS DE INMUTABILIDAD:
--   inventory_movements y audit_logs tienen triggers prevent_modification()
--   que rechazan UPDATE y DELETE (definidos en schema.sql:261-267).
--   Se deshabilitan temporalmente al inicio del script y se rehabilitan
--   al final. Si la transacción falla, el ROLLBACK automático los restaura.
-- ==========================================

BEGIN;

-- ============================================================
-- Deshabilitar triggers de inmutabilidad temporalmente
-- ============================================================
-- inventory_movements y audit_logs tienen triggers que bloquean UPDATE/DELETE
-- (definidos en schema.sql:261-267). Para el backfill necesitamos actualizar
-- la columna company_id, lo cual es una operación única de migración
-- (no se repite nunca más). Después del backfill los rehabilitamos.
--
-- Si algo falla en el DO block, el BEGIN/COMMIT hace rollback y los
-- triggers vuelven a estar habilitados automáticamente.

ALTER TABLE inventory_movements DISABLE TRIGGER tr_inventory_movements_immutable;
ALTER TABLE audit_logs DISABLE TRIGGER tr_audit_logs_immutable;

DO $$
DECLARE
    target_company UUID := '11111111-1111-1111-1111-111111111111';
    null_count BIGINT;
    affected_count BIGINT;
BEGIN
    -- 1. products
    UPDATE products SET company_id = target_company WHERE company_id IS NULL;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RAISE NOTICE 'products: % filas actualizadas', affected_count;
    SELECT COUNT(*) INTO null_count FROM products WHERE company_id IS NULL;
    IF null_count > 0 THEN
        RAISE EXCEPTION 'Backfill incompleto en products: % filas sin company_id', null_count;
    END IF;

    -- 2. product_variants
    UPDATE product_variants SET company_id = target_company WHERE company_id IS NULL;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RAISE NOTICE 'product_variants: % filas actualizadas', affected_count;
    SELECT COUNT(*) INTO null_count FROM product_variants WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en product_variants'; END IF;

    -- 3. customers
    UPDATE customers SET company_id = target_company WHERE company_id IS NULL;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RAISE NOTICE 'customers: % filas actualizadas', affected_count;
    SELECT COUNT(*) INTO null_count FROM customers WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en customers'; END IF;

    -- 4. sales
    UPDATE sales SET company_id = target_company WHERE company_id IS NULL;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RAISE NOTICE 'sales: % filas actualizadas', affected_count;
    SELECT COUNT(*) INTO null_count FROM sales WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en sales'; END IF;

    -- 5. sale_items
    UPDATE sale_items SET company_id = target_company WHERE company_id IS NULL;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RAISE NOTICE 'sale_items: % filas actualizadas', affected_count;
    SELECT COUNT(*) INTO null_count FROM sale_items WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en sale_items'; END IF;

    -- 6. customer_payments
    UPDATE customer_payments SET company_id = target_company WHERE company_id IS NULL;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RAISE NOTICE 'customer_payments: % filas actualizadas', affected_count;
    SELECT COUNT(*) INTO null_count FROM customer_payments WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en customer_payments'; END IF;

    -- 7. cash_sessions
    UPDATE cash_sessions SET company_id = target_company WHERE company_id IS NULL;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RAISE NOTICE 'cash_sessions: % filas actualizadas', affected_count;
    SELECT COUNT(*) INTO null_count FROM cash_sessions WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en cash_sessions'; END IF;

    -- 8. expenses
    UPDATE expenses SET company_id = target_company WHERE company_id IS NULL;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RAISE NOTICE 'expenses: % filas actualizadas', affected_count;
    SELECT COUNT(*) INTO null_count FROM expenses WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en expenses'; END IF;

    -- 9. supplier_payments
    UPDATE supplier_payments SET company_id = target_company WHERE company_id IS NULL;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RAISE NOTICE 'supplier_payments: % filas actualizadas', affected_count;
    SELECT COUNT(*) INTO null_count FROM supplier_payments WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en supplier_payments'; END IF;

    -- 10. major_expenses
    UPDATE major_expenses SET company_id = target_company WHERE company_id IS NULL;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RAISE NOTICE 'major_expenses: % filas actualizadas', affected_count;
    SELECT COUNT(*) INTO null_count FROM major_expenses WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en major_expenses'; END IF;

    -- 11. inventory_movements
    UPDATE inventory_movements SET company_id = target_company WHERE company_id IS NULL;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RAISE NOTICE 'inventory_movements: % filas actualizadas', affected_count;
    SELECT COUNT(*) INTO null_count FROM inventory_movements WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en inventory_movements'; END IF;

    -- 12. audit_logs
    UPDATE audit_logs SET company_id = target_company WHERE company_id IS NULL;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RAISE NOTICE 'audit_logs: % filas actualizadas', affected_count;
    SELECT COUNT(*) INTO null_count FROM audit_logs WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en audit_logs'; END IF;

    -- 13. suppliers
    UPDATE suppliers SET company_id = target_company WHERE company_id IS NULL;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RAISE NOTICE 'suppliers: % filas actualizadas', affected_count;
    SELECT COUNT(*) INTO null_count FROM suppliers WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en suppliers'; END IF;

    -- 14. supplier_invoices
    UPDATE supplier_invoices SET company_id = target_company WHERE company_id IS NULL;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RAISE NOTICE 'supplier_invoices: % filas actualizadas', affected_count;
    SELECT COUNT(*) INTO null_count FROM supplier_invoices WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en supplier_invoices'; END IF;

    -- 15. profiles
    UPDATE profiles SET company_id = target_company WHERE company_id IS NULL;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RAISE NOTICE 'profiles: % filas actualizadas', affected_count;
    SELECT COUNT(*) INTO null_count FROM profiles WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en profiles'; END IF;

    RAISE NOTICE '============================================';
    RAISE NOTICE 'Backfill completado para las 15 tablas.';
    RAISE NOTICE 'Tenant: Distribelleza (11111111-1111-1111-1111-111111111111)';
    RAISE NOTICE '============================================';
END $$;

-- Rehabilitar triggers de inmutabilidad
ALTER TABLE inventory_movements ENABLE TRIGGER tr_inventory_movements_immutable;
ALTER TABLE audit_logs ENABLE TRIGGER tr_audit_logs_immutable;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-BACKFILL (OBLIGATORIA ANTES DE FASE 2.3)
-- ==========================================
-- Cada query debe devolver 0 filas (sin company_id NULL):
--
-- SELECT 'products', COUNT(*) FROM products WHERE company_id IS NULL;
-- SELECT 'product_variants', COUNT(*) FROM product_variants WHERE company_id IS NULL;
-- SELECT 'customers', COUNT(*) FROM customers WHERE company_id IS NULL;
-- SELECT 'sales', COUNT(*) FROM sales WHERE company_id IS NULL;
-- SELECT 'sale_items', COUNT(*) FROM sale_items WHERE company_id IS NULL;
-- SELECT 'customer_payments', COUNT(*) FROM customer_payments WHERE company_id IS NULL;
-- SELECT 'cash_sessions', COUNT(*) FROM cash_sessions WHERE company_id IS NULL;
-- SELECT 'expenses', COUNT(*) FROM expenses WHERE company_id IS NULL;
-- SELECT 'supplier_payments', COUNT(*) FROM supplier_payments WHERE company_id IS NULL;
-- SELECT 'major_expenses', COUNT(*) FROM major_expenses WHERE company_id IS NULL;
-- SELECT 'inventory_movements', COUNT(*) FROM inventory_movements WHERE company_id IS NULL;
-- SELECT 'audit_logs', COUNT(*) FROM audit_logs WHERE company_id IS NULL;
-- SELECT 'suppliers', COUNT(*) FROM suppliers WHERE company_id IS NULL;
-- SELECT 'supplier_invoices', COUNT(*) FROM supplier_invoices WHERE company_id IS NULL;
-- SELECT 'profiles', COUNT(*) FROM profiles WHERE company_id IS NULL;
--
-- O una sola query con todas las tablas:
--
-- SELECT table_name, COUNT(*) AS null_count
-- FROM (
--     SELECT 'products' as table_name, NULL::uuid as company_id FROM products WHERE company_id IS NULL
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
-- WHERE company_id IS NULL
-- GROUP BY table_name;
--
-- Si devuelve 0 filas: backfill exitoso. Proceder a 20261003200300.
-- Si devuelve alguna fila con count > 0: ALGO FALLÓ. NO continuar.
--   Contactar al administrador.
-- ==========================================