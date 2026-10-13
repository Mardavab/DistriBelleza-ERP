-- ==========================================
-- MIGRACIÓN 20261004000003 - RLS vía company_memberships
-- Fase 10.4 - Multi-empresa por usuario
-- ==========================================
-- OBJETIVO: Cambiar las políticas RLS de las 15 tablas per-tenant para que
--           filtren por membresía (EXISTS en company_memberships) en lugar de
--           por el company_id del JWT. Esto permite que un usuario con
--           membresía en A y B vea datos de ambas con cualquier JWT.
--
--           El JWT sigue cargando un único company_id (el activo) para
--           mantener el contexto de "empresa activa" en la UI. Las acciones
--           de escritura determinan la empresa destino desde el JWT o desde
--           la membresía específica que se esté modificando.
--
-- IMPORTANTE - PREREQUISITOS:
--   1. Haber ejecutado 20261004000000 (crear tabla company_memberships)
--   2. Haber ejecutado 20261004000001 (backfill de membresías)
--   3. Haber ejecutado 20261004000002 (DROP NOT NULL en profiles.company_id)
--   4. Todos los usuarios con profile.company_id NOT NULL deben tener una
--      membresía equivalente (verificado por diagnose_fase10_1.sql)
--
-- RIESGO: ALTO. Si una cuenta válida no tiene membresía, deja de ver
--         sus propios datos. El rollback es la red de seguridad.
--
-- IDEMPOTENTE: Sí (DROP POLICY IF EXISTS + CREATE).
-- REVERSIBLE: Sí, vía RK_20261004000003_restore_jwt_rls.sql.
-- ==========================================

BEGIN;

DO $$
DECLARE
    t TEXT;
    -- 15 tablas per-tenant (incluye company_settings; excluye companies
    -- y profiles que tienen políticas especiales).
    tenant_tables TEXT[] := ARRAY[
        'products', 'product_variants', 'customers', 'sales', 'sale_items',
        'customer_payments', 'cash_sessions', 'expenses', 'supplier_payments',
        'major_expenses', 'inventory_movements', 'audit_logs', 'suppliers',
        'supplier_invoices', 'company_settings'
    ];
BEGIN
    FOREACH t IN ARRAY tenant_tables
    LOOP
        -- Eliminar las políticas antiguas (basadas en JWT)
        EXECUTE format('DROP POLICY IF EXISTS "tenant_select" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "tenant_insert" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "tenant_update" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "tenant_delete" ON %I', t);

        -- Nuevas políticas: EXISTS sobre company_memberships
        EXECUTE format(
            'CREATE POLICY "membership_select" ON %I FOR SELECT TO authenticated '
            'USING (EXISTS (SELECT 1 FROM company_memberships m '
            'WHERE m.user_id = auth.uid() AND m.company_id = %I.company_id))',
            t, t
        );

        EXECUTE format(
            'CREATE POLICY "membership_insert" ON %I FOR INSERT TO authenticated '
            'WITH CHECK (EXISTS (SELECT 1 FROM company_memberships m '
            'WHERE m.user_id = auth.uid() AND m.company_id = %I.company_id))',
            t, t
        );

        EXECUTE format(
            'CREATE POLICY "membership_update" ON %I FOR UPDATE TO authenticated '
            'USING (EXISTS (SELECT 1 FROM company_memberships m '
            'WHERE m.user_id = auth.uid() AND m.company_id = %I.company_id)) '
            'WITH CHECK (EXISTS (SELECT 1 FROM company_memberships m '
            'WHERE m.user_id = auth.uid() AND m.company_id = %I.company_id))',
            t, t, t
        );

        EXECUTE format(
            'CREATE POLICY "membership_delete" ON %I FOR DELETE TO authenticated '
            'USING (EXISTS (SELECT 1 FROM company_memberships m '
            'WHERE m.user_id = auth.uid() AND m.company_id = %I.company_id))',
            t, t
        );
    END LOOP;

    RAISE NOTICE 'Políticas actualizadas en 15 tablas per-tenant.';
END $$;

-- ============================================================
-- company_memberships: política para que un usuario vea sus membresías
-- ============================================================
ALTER TABLE company_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self_memberships_select" ON company_memberships;
CREATE POLICY "self_memberships_select" ON company_memberships
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- Owners también ven las membresías de su propio tenant
-- (para la UI de "gestionar equipo" del owner).
DROP POLICY IF EXISTS "owner_tenant_memberships" ON company_memberships;
CREATE POLICY "owner_tenant_memberships" ON company_memberships
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM company_memberships m2
            WHERE m2.user_id = auth.uid()
              AND m2.role = 'owner'
              AND m2.company_id = company_memberships.company_id
        )
    );

-- IMPORTANTE: las escrituras sobre company_memberships siguen siendo
-- exclusiva vía supabaseAdmin (server actions). El RLS no da acceso
-- directo a INSERT/UPDATE/DELETE a usuarios autenticados.
-- (Si en el futuro se quiere que un owner invite/remover usuarios desde
-- la app sin pasar por una server action, agregar políticas aquí.)

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- 1. Las nuevas políticas deben existir:
--    SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname = 'public' AND policyname LIKE 'membership_%'
--    ORDER BY tablename, policyname;
--    -- Esperado: 60 filas (15 tablas × 4 ops)
--
-- 2. Las políticas antiguas NO deben existir:
--    SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname = 'public' AND policyname LIKE 'tenant_%'
--    ORDER BY tablename, policyname;
--    -- Esperado: 0 filas
--
-- 3. company_memberships tiene RLS:
--    SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname = 'company_memberships';
--    -- Esperado: relrowsecurity = true
--
-- 4. Smoke test de aislamiento con cuenta multi-membresía:
--    - Crear usuario con membresía en A y B.
--    - Como ese usuario, hacer SELECT products WHERE company_id = A → ver filas de A.
--    - Cambiar JWT a B (vía switchActiveCompanyAction + refresh).
--    - SELECT products → ver filas de A y B (porque la membresía lo permite).
-- ==========================================
