-- ==========================================
-- ROLLBACK 20261101000005 - Restaurar policies de Fase 10.6
-- Fase 11 - Multi-sucursal (Bloque C)
-- ==========================================
-- OBJETIVO: revertir las policies RLS al estado de Fase 10.6 (filtran
--           solo por company_memberships, sin branch_memberships).
--
-- ESTADO RESTAURADO:
--   - Las 10 tablas operativas vuelven al filtro de Fase 10.6
--     (company_memberships + exclusion de platform admins).
--   - branch_stock vuelve a su policy de Fase 11.2 (company_memberships
--     + exclusion de platform admins, sin branch_memberships).
--   - branches y branch_memberships: no se modificaron en 11.5, siguen
--     igual.
--
-- CUÁNDO USARLO:
--   - Si la migración 11.5 introduce un bug de rendimiento (las
--     subconsultas a branch_memberships son costosas en queries masivas).
--   - Si se decide relajar el modelo multi-sucursal y permitir que
--     un usuario con company_membership vea datos de TODAS las
--     sucursales de su empresa.
--
-- ⚠️  IMPORTANTE: este rollback también requiere revertir el código
--     TS de Bloque C (sales.ts, inventory_actions.ts, etc.) que ahora
--     filtra por `branch_id` explícito en las queries. Si el código
--     sigue filtrando por branch_id pero el RLS no, las queries con
--     branch_id "equivocado" devolverán [].
-- ==========================================

BEGIN;

-- ============================================================
-- PASO 1: Restaurar policies de Fase 10.6 en las 10 tablas operativas.
-- ============================================================

DO $$
DECLARE
    t TEXT;
    branch_tables TEXT[] := ARRAY[
        'sales', 'sale_items', 'cash_sessions', 'inventory_movements',
        'customer_payments', 'expenses', 'supplier_payments',
        'supplier_invoices', 'audit_logs', 'major_expenses'
    ];
BEGIN
    FOREACH t IN ARRAY branch_tables
    LOOP
        -- Eliminar las policies creadas por 11.5.
        EXECUTE format('DROP POLICY IF EXISTS "membership_select" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "membership_insert" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "membership_update" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "membership_delete" ON %I', t);

        -- Restaurar la versión de Fase 10.6: company_memberships + exclusion
        -- de platform admins. Sin filtro por branch_memberships.
        EXECUTE format(
            'CREATE POLICY "membership_select" ON %I FOR SELECT TO authenticated '
            'USING ('
            'EXISTS (SELECT 1 FROM company_memberships m '
            'WHERE m.user_id = auth.uid() AND m.company_id = %I.company_id) '
            'AND NOT EXISTS (SELECT 1 FROM profiles p '
            'WHERE p.id = auth.uid() AND p.is_platform_admin = true)'
            ')',
            t, t
        );

        EXECUTE format(
            'CREATE POLICY "membership_insert" ON %I FOR INSERT TO authenticated '
            'WITH CHECK ('
            'EXISTS (SELECT 1 FROM company_memberships m '
            'WHERE m.user_id = auth.uid() AND m.company_id = %I.company_id) '
            'AND NOT EXISTS (SELECT 1 FROM profiles p '
            'WHERE p.id = auth.uid() AND p.is_platform_admin = true)'
            ')',
            t, t
        );

        EXECUTE format(
            'CREATE POLICY "membership_update" ON %I FOR UPDATE TO authenticated '
            'USING ('
            'EXISTS (SELECT 1 FROM company_memberships m '
            'WHERE m.user_id = auth.uid() AND m.company_id = %I.company_id) '
            'AND NOT EXISTS (SELECT 1 FROM profiles p '
            'WHERE p.id = auth.uid() AND p.is_platform_admin = true)'
            ') '
            'WITH CHECK ('
            'EXISTS (SELECT 1 FROM company_memberships m '
            'WHERE m.user_id = auth.uid() AND m.company_id = %I.company_id) '
            'AND NOT EXISTS (SELECT 1 FROM profiles p '
            'WHERE p.id = auth.uid() AND p.is_platform_admin = true)'
            ')',
            t, t, t
        );

        EXECUTE format(
            'CREATE POLICY "membership_delete" ON %I FOR DELETE TO authenticated '
            'USING ('
            'EXISTS (SELECT 1 FROM company_memberships m '
            'WHERE m.user_id = auth.uid() AND m.company_id = %I.company_id) '
            'AND NOT EXISTS (SELECT 1 FROM profiles p '
            'WHERE p.id = auth.uid() AND p.is_platform_admin = true)'
            ')',
            t, t
        );
    END LOOP;

    RAISE NOTICE 'Políticas membership_* restauradas a versión 10.6 en 10 tablas operativas.';
END $$;

-- ============================================================
-- PASO 2: Restaurar policies de branch_stock a versión Fase 11.2.
-- ============================================================

DO $$
BEGIN
    DROP POLICY IF EXISTS "membership_select_branch_stock" ON branch_stock;
    CREATE POLICY "membership_select_branch_stock" ON branch_stock
        FOR SELECT TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM company_memberships m
                WHERE m.user_id = auth.uid() AND m.company_id = branch_stock.company_id
            )
            AND NOT EXISTS (
                SELECT 1 FROM profiles p
                WHERE p.id = auth.uid() AND p.is_platform_admin = true
            )
        );

    DROP POLICY IF EXISTS "membership_insert_branch_stock" ON branch_stock;
    CREATE POLICY "membership_insert_branch_stock" ON branch_stock
        FOR INSERT TO authenticated
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM company_memberships m
                WHERE m.user_id = auth.uid() AND m.company_id = branch_stock.company_id
            )
            AND NOT EXISTS (
                SELECT 1 FROM profiles p
                WHERE p.id = auth.uid() AND p.is_platform_admin = true
            )
        );

    DROP POLICY IF EXISTS "membership_update_branch_stock" ON branch_stock;
    CREATE POLICY "membership_update_branch_stock" ON branch_stock
        FOR UPDATE TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM company_memberships m
                WHERE m.user_id = auth.uid() AND m.company_id = branch_stock.company_id
            )
            AND NOT EXISTS (
                SELECT 1 FROM profiles p
                WHERE p.id = auth.uid() AND p.is_platform_admin = true
            )
        )
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM company_memberships m
                WHERE m.user_id = auth.uid() AND m.company_id = branch_stock.company_id
            )
            AND NOT EXISTS (
                SELECT 1 FROM profiles p
                WHERE p.id = auth.uid() AND p.is_platform_admin = true
            )
        );

    DROP POLICY IF EXISTS "membership_delete_branch_stock" ON branch_stock;
    CREATE POLICY "membership_delete_branch_stock" ON branch_stock
        FOR DELETE TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM company_memberships m
                WHERE m.user_id = auth.uid() AND m.company_id = branch_stock.company_id
            )
            AND NOT EXISTS (
                SELECT 1 FROM profiles p
                WHERE p.id = auth.uid() AND p.is_platform_admin = true
            )
        );
END $$;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-ROLLBACK
-- ==========================================
-- Las policies de las 10 tablas operativas y branch_stock NO deben
-- contener "branch_memberships":
--
-- SELECT tablename, policyname, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND (
--     tablename IN (
--         'sales', 'sale_items', 'cash_sessions', 'inventory_movements',
--         'customer_payments', 'expenses', 'supplier_payments',
--         'supplier_invoices', 'audit_logs', 'major_expenses'
--     ) OR tablename = 'branch_stock'
--   )
--   AND policyname LIKE 'membership_%';
-- -- Ningún qual debe contener "branch_memberships".
-- ==========================================
