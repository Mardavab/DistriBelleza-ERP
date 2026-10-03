-- ==========================================
-- DIAGNÓSTICO — Filas con company_id NULL después del backfill
-- ==========================================
-- OBJETIVO: Identificar EXACTAMENTE qué tablas y cuántas filas tienen
--           company_id NULL después de la ejecución de Fase 2.
-- SEGURO: Solo lectura.
-- ==========================================

SELECT table_name, COUNT(*) AS null_count
FROM (
    SELECT 'products' AS table_name, NULL::uuid AS company_id FROM products WHERE company_id IS NULL
    UNION ALL SELECT 'product_variants', NULL FROM product_variants WHERE company_id IS NULL
    UNION ALL SELECT 'customers', NULL FROM customers WHERE company_id IS NULL
    UNION ALL SELECT 'sales', NULL FROM sales WHERE company_id IS NULL
    UNION ALL SELECT 'sale_items', NULL FROM sale_items WHERE company_id IS NULL
    UNION ALL SELECT 'customer_payments', NULL FROM customer_payments WHERE company_id IS NULL
    UNION ALL SELECT 'cash_sessions', NULL FROM cash_sessions WHERE company_id IS NULL
    UNION ALL SELECT 'expenses', NULL FROM expenses WHERE company_id IS NULL
    UNION ALL SELECT 'supplier_payments', NULL FROM supplier_payments WHERE company_id IS NULL
    UNION ALL SELECT 'major_expenses', NULL FROM major_expenses WHERE company_id IS NULL
    UNION ALL SELECT 'inventory_movements', NULL FROM inventory_movements WHERE company_id IS NULL
    UNION ALL SELECT 'audit_logs', NULL FROM audit_logs WHERE company_id IS NULL
    UNION ALL SELECT 'suppliers', NULL FROM suppliers WHERE company_id IS NULL
    UNION ALL SELECT 'supplier_invoices', NULL FROM supplier_invoices WHERE company_id IS NULL
    UNION ALL SELECT 'profiles', NULL FROM profiles WHERE company_id IS NULL
) sub
GROUP BY table_name
ORDER BY null_count DESC, table_name;

-- ==========================================
-- INTERPRETACIÓN
-- ==========================================
-- Si devuelve 0 filas: backfill exitoso, solo re-ejecutar SET NOT NULL.
-- Si hay tablas con count > 0: esas tablas necesitan un UPDATE adicional.
-- ==========================================

-- Para inspeccionar las filas problemáticas en products:
-- SELECT id, name, brand, created_at, updated_at
-- FROM products
-- WHERE company_id IS NULL;
-- ==========================================