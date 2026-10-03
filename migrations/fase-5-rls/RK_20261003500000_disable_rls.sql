-- ==========================================
-- ROLLBACK 20261003500000 - Desactivar RLS
-- ==========================================
-- OBJETIVO: Volver al estado pre-Fase 5 (sin RLS).
--           Todas las tablas vuelven a ser consultables por cualquier
--           usuario autenticado o service_role.
-- SEGURO: No pierde datos. Solo desactiva restricciones de seguridad.
-- ==========================================

BEGIN;

-- Eliminar TODAS las políticas de las 17 tablas
DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY[
        'products', 'product_variants', 'customers', 'sales', 'sale_items',
        'customer_payments', 'cash_sessions', 'expenses', 'supplier_payments',
        'major_expenses', 'inventory_movements', 'audit_logs', 'suppliers',
        'supplier_invoices', 'profiles', 'companies', 'company_settings'
    ];
BEGIN
    FOREACH t IN ARRAY tables
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "auth_permissive_read"  ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "auth_permissive_write" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "tenant_select" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "tenant_insert" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "tenant_update" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "tenant_delete" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "self_select" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "self_update" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "companies_read" ON %I', t);
    END LOOP;

    -- Desactivar RLS en todas las tablas
    FOREACH t IN ARRAY tables
    LOOP
        EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
    END LOOP;

    RAISE NOTICE 'RLS desactivado en % tablas', array_length(tables, 1);
END $$;

-- Eliminar políticas de storage
DROP POLICY IF EXISTS "tenant_storage_read"   ON storage.objects;
DROP POLICY IF EXISTS "tenant_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "tenant_storage_update" ON storage.objects;
DROP POLICY IF EXISTS "tenant_storage_delete" ON storage.objects;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-ROLLBACK
-- ==========================================
-- Esta query debe devolver rowsecurity = 'f' en todas las tablas:
--
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'products', 'product_variants', 'customers', 'sales', 'sale_items',
--     'customer_payments', 'cash_sessions', 'expenses', 'supplier_payments',
--     'major_expenses', 'inventory_movements', 'audit_logs', 'suppliers',
--     'supplier_invoices', 'profiles', 'companies', 'company_settings'
--   )
-- ORDER BY tablename;
-- ==========================================