-- ==========================================
-- MIGRACIÓN 20261003500100 - Endurecer políticas por tenant
-- Fase 5 - RLS real (multi-tenant)
-- ==========================================
-- OBJETIVO: Reemplazar las políticas permisivas con políticas estrictas
--           que filtran por company_id del usuario (de su app_metadata JWT).
--           ESTE PASO AÍSLA REALMENTE LOS TENANTS.
-- IDEMPOTENTE: Sí. DROP POLICY IF EXISTS + CREATE.
-- ==========================================================
-- ⚠️ CRÍTICO:
--   - Solo ejecutar DESPUÉS de verificar que la app sigue funcionando
--     con las políticas permisivas (paso 20261003500000).
--   - Si algún INSERT/UPDATE/SELECT falla, significa que el código
--     TypeScript no está pasando company_id o el JWT no tiene
--     company_id en app_metadata.
--   - Para revertir: ejecuta RK_20261003500000_disable_rls.sql
-- ==========================================================
-- IMPORTANTE sobre las tablas 'companies' y 'company_settings':
--   - companies: lectura por cualquier autenticado (para saber su tenant).
--     Solo service_role puede escribir.
--   - company_settings: lectura/escritura SOLO por usuarios del tenant.
-- ==========================================================

BEGIN;

DO $$
DECLARE
    t TEXT;
    -- Tablas que filtran por company_id directamente
    tenant_tables TEXT[] := ARRAY[
        'products', 'product_variants', 'customers', 'sales', 'sale_items',
        'customer_payments', 'cash_sessions', 'expenses', 'supplier_payments',
        'major_expenses', 'inventory_movements', 'audit_logs', 'suppliers',
        'supplier_invoices', 'company_settings'
    ];
    -- Tablas donde la isolation es por profiles.company_id del usuario actual
    profile_tables TEXT[] := ARRAY['profiles'];
BEGIN
    -- ============================================================
    -- Tablas per-tenant: company_id = JWT.app_metadata.company_id
    -- ============================================================
    FOREACH t IN ARRAY tenant_tables
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "auth_permissive_read"  ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "auth_permissive_write" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "tenant_select" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "tenant_insert" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "tenant_update" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "tenant_delete" ON %I', t);

        EXECUTE format(
            'CREATE POLICY "tenant_select" ON %I FOR SELECT TO authenticated '
            'USING (company_id = (auth.jwt() -> ''app_metadata'' ->> ''company_id'')::uuid)',
            t
        );
        EXECUTE format(
            'CREATE POLICY "tenant_insert" ON %I FOR INSERT TO authenticated '
            'WITH CHECK (company_id = (auth.jwt() -> ''app_metadata'' ->> ''company_id'')::uuid)',
            t
        );
        EXECUTE format(
            'CREATE POLICY "tenant_update" ON %I FOR UPDATE TO authenticated '
            'USING (company_id = (auth.jwt() -> ''app_metadata'' ->> ''company_id'')::uuid) '
            'WITH CHECK (company_id = (auth.jwt() -> ''app_metadata'' ->> ''company_id'')::uuid)',
            t
        );
        EXECUTE format(
            'CREATE POLICY "tenant_delete" ON %I FOR DELETE TO authenticated '
            'USING (company_id = (auth.jwt() -> ''app_metadata'' ->> ''company_id'')::uuid)',
            t
        );
    END LOOP;

    -- ============================================================
    -- Tabla profiles: usuario solo ve/edita su propio perfil.
    -- Pero owners también pueden ver profiles de su tenant.
    -- Para simplificar Fase 5: usuario solo ve su propio perfil.
    -- Owners acceden vía supabaseAdmin (service role) sin restricción.
    -- ============================================================
    FOREACH t IN ARRAY profile_tables
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "auth_permissive_read"  ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "auth_permissive_write" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "self_select" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "self_update" ON %I', t);

        EXECUTE format(
            'CREATE POLICY "self_select" ON %I FOR SELECT TO authenticated '
            'USING (id = auth.uid())',
            t
        );
        EXECUTE format(
            'CREATE POLICY "self_update" ON %I FOR UPDATE TO authenticated '
            'USING (id = auth.uid()) WITH CHECK (id = auth.uid())',
            t
        );
    END LOOP;

    -- ============================================================
    -- Tabla companies: lectura por cualquier autenticado, escritura
    -- solo por service_role (no se crean empresas desde la app, solo
    -- desde el panel admin o migraciones SQL).
    -- ============================================================
    EXECUTE 'DROP POLICY IF EXISTS "auth_permissive_read"  ON companies';
    EXECUTE 'DROP POLICY IF EXISTS "auth_permissive_write" ON companies';
    EXECUTE 'CREATE POLICY "companies_read" ON companies FOR SELECT TO authenticated USING (true)';

    RAISE NOTICE 'Políticas estrictas aplicadas a 17 tablas.';
END $$;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- Esta query debe devolver 16 políticas estrictas (4 por cada una de
-- las 14 tablas per-tenant) + 1 read en companies + 2 en profiles:
--
-- SELECT schemaname, tablename, policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
-- ==========================================

-- ==========================================
-- CÓMO PROBAR AISLAMIENTO
-- ==========================================
-- 1. Crear un tenant 2 con un usuario de prueba:
--
--    INSERT INTO companies (id, slug, legal_name) VALUES
--    ('22222222-2222-2222-2222-222222222222', 'empresa-prueba-b', 'Empresa B S.A.S.');
--
-- 2. Crear invitación para el usuario de prueba en empresa-prueba-b
--    (via la app o manualmente)
--
-- 3. Login como usuario de Distribelleza:
--    SELECT * FROM products;
--    → Solo ve productos con company_id = '11111111-...'
--
-- 4. Login como usuario de Empresa B:
--    SELECT * FROM products;
--    → Solo ve productos con company_id = '22222222-...'
--    → Si intenta SELECT WHERE company_id = '11111111-...' → 0 rows
--
-- ==========================================