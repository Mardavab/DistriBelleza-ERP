-- ==========================================
-- MIGRACIÓN 20261003500000 - Habilitar RLS con políticas permisivas
-- Fase 5 - RLS real (multi-tenant)
-- ==========================================
-- OBJETIVO: Habilitar Row Level Security en las 14 tablas per-tenant
--           con políticas iniciales PERMISIVAS (cualquier usuario
--           autenticado puede leer/escribir).
--           Esto es una transición segura: el comportamiento de la
--           app NO cambia hasta que ejecutemos el siguiente archivo
--           con las políticas estrictas.
-- IDEMPOTENTE: Sí. DROP POLICY IF EXISTS + CREATE.
-- ==========================================
-- ⚠️ IMPORTANTE: Esta migración NO aisla tenants todavía.
--   Solo enciende RLS. Para aislar, ejecuta 20261003500100.
-- ==========================================

BEGIN;

-- ============================================================
-- Habilitar RLS en las 14 tablas per-tenant
-- ============================================================
ALTER TABLE products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE major_expenses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices     ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;

-- companies y company_settings también (lectura para todos los autenticados)
ALTER TABLE companies             ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_settings       ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Políticas permisivas: cualquier usuario autenticado pasa
-- ============================================================
-- Usamos DO block con text array para aplicar 16 tablas sin repetir 32 veces
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
        EXECUTE format('CREATE POLICY "auth_permissive_read"  ON %I FOR SELECT TO authenticated USING (true)', t);
        EXECUTE format('CREATE POLICY "auth_permissive_write" ON %I FOR ALL    TO authenticated USING (true) WITH CHECK (true)', t);
    END LOOP;
    RAISE NOTICE 'Políticas permisivas creadas en % tablas', array_length(tables, 1);
END $$;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- Debe devolver 17 tablas con rowsecurity = true:
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
--
-- Cada tabla debe tener rowsecurity = 't' y al menos 2 policies.
-- ==========================================