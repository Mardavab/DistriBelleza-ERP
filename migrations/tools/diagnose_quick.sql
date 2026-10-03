-- ==========================================
-- DIAGNÓSTICO RÁPIDO — Todo en una sola query
-- ==========================================
-- OBJETIVO: Mostrar el estado completo de Fase 1 en una sola tabla.
--           Ejecutar y compartir el resultado completo.
-- ==========================================

SELECT * FROM (
    -- Tablas nuevas (esperado: 3)
    SELECT 'tabla_nueva' AS tipo, table_name AS nombre,
           'existe' AS detalle
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('companies', 'company_settings', 'tenant_migration_audit')

    UNION ALL

    -- Columnas company_id (esperado: 15)
    SELECT 'columna_company_id' AS tipo, table_name AS nombre,
           is_nullable AS detalle
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'company_id'
      AND table_name != 'companies'

    UNION ALL

    -- FKs de company (esperado: 15)
    SELECT 'fk_company' AS tipo,
           conrelid::regclass::text AS nombre,
           conname AS detalle
    FROM pg_constraint
    WHERE contype = 'f' AND conname LIKE 'fk_%_company'

    UNION ALL

    -- Índices únicos compuestos (esperado: 4)
    SELECT 'idx_compound_unique' AS tipo, indexname AS nombre,
           'OK' AS detalle
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'idx_variants_company_sku',
        'idx_variants_company_barcode',
        'idx_customers_company_email',
        'idx_categories_company_name'
      )

    UNION ALL

    -- Índices simples company_id (esperado: 17+)
    SELECT 'idx_company_id' AS tipo, indexname AS nombre,
           'OK' AS detalle
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname LIKE 'idx_%company%'
      AND indexname NOT IN (
        'idx_variants_company_sku',
        'idx_variants_company_barcode',
        'idx_customers_company_email',
        'idx_categories_company_name'
      )

    UNION ALL

    -- Triggers Fase 1 (esperado: 2)
    SELECT 'trigger_fase1' AS tipo, trigger_name AS nombre,
           event_object_table AS detalle
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND trigger_name IN ('trg_companies_updated_at', 'trg_company_settings_updated_at')
) AS estado
ORDER BY tipo, nombre;

-- ==========================================
-- INTERPRETACIÓN
-- ==========================================
-- Conteos esperados al final de Fase 1 correctamente:
--   tabla_nueva:           3 filas  (companies, company_settings, tenant_migration_audit)
--   columna_company_id:    15 filas (products, product_variants, customers, sales, sale_items,
--                                   customer_payments, cash_sessions, expenses,
--                                   supplier_payments, major_expenses, inventory_movements,
--                                   audit_logs, suppliers, supplier_invoices, profiles)
--   fk_company:            15 filas
--   idx_compound_unique:   4 filas
--   idx_company_id:        17+ filas
--   trigger_fase1:         2 filas
-- ==========================================