-- ==========================================
-- ROLLBACK 20261004000006 - Restaurar políticas membership_* sin exclusión
-- ==========================================
-- OBJETIVO: revertir esta migración al estado previo a 10.6.
--
-- ESTADO RESTAURADO:
--   Las políticas `membership_*` quedan IGUALES que las que crea
--   la migración 20261004000003 (sin la condición `AND NOT EXISTS`
--   sobre profiles.is_platform_admin). NO se restaura el RLS viejo
--   basado en JWT (tenant_*): si 10.3 estaba aplicada, restauramos
--   la versión de 10.3; si no, este rollback deja las tablas SIN
--   políticas (que es el estado pre-10.6 si 10.3 no había corrido).
--
-- CUÁNDO USARLO:
--   - Si 10.6 introduce un bug de rendimiento en RLS (las subconsultas
--     a profiles podrían ser costosas en tablas grandes).
--   - Si se decide más adelante NO excluir platform admins (y se confía
--     en que las membresías de los técnicos se limpien manualmente).
--
-- NO INCLUYE el rollback de las migraciones 10.0-10.4 ni de 10.5.
-- Cada una tiene su propio RK_*.sql.
-- ==========================================

BEGIN;

DO $$
DECLARE
    t TEXT;
    tenant_tables TEXT[] := ARRAY[
        'products', 'product_variants', 'customers', 'sales', 'sale_items',
        'customer_payments', 'cash_sessions', 'expenses', 'supplier_payments',
        'major_expenses', 'inventory_movements', 'audit_logs', 'suppliers',
        'supplier_invoices', 'company_settings'
    ];
BEGIN
    FOREACH t IN ARRAY tenant_tables
    LOOP
        -- Eliminar las políticas creadas por 10.6 (con exclusión).
        EXECUTE format('DROP POLICY IF EXISTS "membership_select" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "membership_insert" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "membership_update" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "membership_delete" ON %I', t);

        -- Restaurar la versión "original" de 10.3: SOLO por membresía,
        -- sin la condición de platform admin. Este es el comportamiento
        -- previo a 10.6 (que es lo que el usuario quiere revertir).
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

    RAISE NOTICE 'Políticas membership_* restauradas a la versión sin exclusión en 15 tablas per-tenant.';
END $$;

-- Restaurar las políticas de company_memberships a la versión 10.3.
DROP POLICY IF EXISTS "self_memberships_select" ON company_memberships;
CREATE POLICY "self_memberships_select" ON company_memberships
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

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

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-ROLLBACK
-- ==========================================
-- 1. Las políticas activas deben ser `membership_*` SIN la condición
--    sobre profiles.is_platform_admin:
--
--    SELECT tablename, policyname, qual
--    FROM pg_policies
--    WHERE schemaname = 'public' AND policyname LIKE 'membership_%'
--    ORDER BY tablename, policyname
--    LIMIT 5;
--    -- Ningún qual debe contener "is_platform_admin".
--
-- 2. Si se quiere volver COMPLETAMENTE al estado pre-10.3 (RLS basada
--    en JWT), aplicar también RK_20261004000003_restore_jwt_rls.sql.
-- ==========================================
