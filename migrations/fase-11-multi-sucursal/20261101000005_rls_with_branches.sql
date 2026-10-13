-- ==========================================
-- MIGRACIÓN 20261101000005 - RLS vía branch_memberships
-- Fase 11 - Multi-sucursal (Bloque C)
-- ==========================================
-- OBJETIVO:
--   Actualizar las policies RLS `membership_*` de Fase 10.6 en las
--   10 tablas operativas para que filtren ADEMÁS por `branch_memberships`.
--   Hasta ahora (Fase 10.6), un usuario con company_membership podía
--   ver/operar sobre TODAS las filas operativas de la empresa,
--   independientemente de si tenía branch_membership en la sucursal
--   específica de cada fila.
--
--   Con esta migración, el filtro se compone:
--     1. Company membership (tabla.company_id) — sigue igual.
--     2. Branch membership (tabla.branch_id) — NUEVO.
--     3. Exclusión de platform admins — sigue igual.
--
-- TABLAS CON branch_id (operativas — filtradas también por branch_memberships):
--   sales, sale_items, cash_sessions, inventory_movements,
--   customer_payments, expenses, supplier_payments,
--   supplier_invoices, audit_logs, major_expenses
--
-- TABLAS SIN branch_id (siguen igual que Fase 10.6):
--   products, product_variants, customers, suppliers,
--   company_settings, categories
--
-- TABLAS DE GESTIÓN DE SUCURSALES (siguen igual que Bloque B):
--   branches, branch_memberships
--
-- IMPORTANTE - EFECTO COLATERAL:
--   Un usuario SIN branch_membership (caso: recién invitado y aún no
--   asignado a una sucursal) deja de tener acceso a las 10 tablas
--   operativas. El owner debe usar `assignUserToBranchAction` (o
--   `acceptInvitationAction` con `branch_ids`) para darle acceso.
--
--   El backfill de Fase 11.1 (20261101000001) ya creó branch_memberships
--   para todos los usuarios existentes, por lo que ningún usuario
--   preexistente se ve afectado.
--
-- IDEMPOTENTE: Sí. DROP POLICY IF EXISTS + CREATE.
-- REVERSIBLE: Sí. Ver RK_20261101000005_restore_company_only_rls.sql.
--
-- ORDEN DE APLICACIÓN (Bloque C, parte 2):
--   1. 20261101000000_create_branches.sql
--   2. 20261101000001_branch_memberships.sql
--   3. 20261101000002_create_branch_stock.sql
--   4. 20261101000003_add_branch_id_to_tables.sql
--   5. 20261101000004_tenant_rpc_with_branch.sql
--   6. 20261101000005_rls_with_branches.sql        ← ESTE
-- ==========================================

BEGIN;

-- ============================================================
-- PASO 1: Re-crear políticas `membership_*` con filtro adicional
--         por `branch_memberships` en las 10 tablas operativas
--         (las que tienen `branch_id`).
-- ============================================================

DO $$
DECLARE
    t TEXT;
    -- 10 tablas operativas con branch_id NOT NULL.
    branch_tables TEXT[] := ARRAY[
        'sales', 'sale_items', 'cash_sessions', 'inventory_movements',
        'customer_payments', 'expenses', 'supplier_payments',
        'supplier_invoices', 'audit_logs', 'major_expenses'
    ];
BEGIN
    FOREACH t IN ARRAY branch_tables
    LOOP
        -- Eliminar las políticas de Fase 10.6 (con exclusion de platform admins).
        EXECUTE format('DROP POLICY IF EXISTS "membership_select" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "membership_insert" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "membership_update" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "membership_delete" ON %I', t);

        -- SELECT: company_membership + branch_membership + NOT platform admin.
        EXECUTE format(
            'CREATE POLICY "membership_select" ON %I FOR SELECT TO authenticated '
            'USING ('
            'EXISTS (SELECT 1 FROM company_memberships m '
            'WHERE m.user_id = auth.uid() AND m.company_id = %I.company_id) '
            'AND EXISTS (SELECT 1 FROM branch_memberships bm '
            'WHERE bm.user_id = auth.uid() AND bm.branch_id = %I.branch_id) '
            'AND NOT EXISTS (SELECT 1 FROM profiles p '
            'WHERE p.id = auth.uid() AND p.is_platform_admin = true)'
            ')',
            t, t, t
        );

        -- INSERT: con branch_membership en el branch_id de la nueva fila.
        EXECUTE format(
            'CREATE POLICY "membership_insert" ON %I FOR INSERT TO authenticated '
            'WITH CHECK ('
            'EXISTS (SELECT 1 FROM company_memberships m '
            'WHERE m.user_id = auth.uid() AND m.company_id = %I.company_id) '
            'AND EXISTS (SELECT 1 FROM branch_memberships bm '
            'WHERE bm.user_id = auth.uid() AND bm.branch_id = %I.branch_id) '
            'AND NOT EXISTS (SELECT 1 FROM profiles p '
            'WHERE p.id = auth.uid() AND p.is_platform_admin = true)'
            ')',
            t, t, t
        );

        -- UPDATE: branch_membership en branch_id antiguo (USING) Y nuevo (WITH CHECK).
        EXECUTE format(
            'CREATE POLICY "membership_update" ON %I FOR UPDATE TO authenticated '
            'USING ('
            'EXISTS (SELECT 1 FROM company_memberships m '
            'WHERE m.user_id = auth.uid() AND m.company_id = %I.company_id) '
            'AND EXISTS (SELECT 1 FROM branch_memberships bm '
            'WHERE bm.user_id = auth.uid() AND bm.branch_id = %I.branch_id) '
            'AND NOT EXISTS (SELECT 1 FROM profiles p '
            'WHERE p.id = auth.uid() AND p.is_platform_admin = true)'
            ') '
            'WITH CHECK ('
            'EXISTS (SELECT 1 FROM company_memberships m '
            'WHERE m.user_id = auth.uid() AND m.company_id = %I.company_id) '
            'AND EXISTS (SELECT 1 FROM branch_memberships bm '
            'WHERE bm.user_id = auth.uid() AND bm.branch_id = %I.branch_id) '
            'AND NOT EXISTS (SELECT 1 FROM profiles p '
            'WHERE p.id = auth.uid() AND p.is_platform_admin = true)'
            ')',
            t, t, t, t, t
        );

        -- DELETE: branch_membership en branch_id de la fila.
        EXECUTE format(
            'CREATE POLICY "membership_delete" ON %I FOR DELETE TO authenticated '
            'USING ('
            'EXISTS (SELECT 1 FROM company_memberships m '
            'WHERE m.user_id = auth.uid() AND m.company_id = %I.company_id) '
            'AND EXISTS (SELECT 1 FROM branch_memberships bm '
            'WHERE bm.user_id = auth.uid() AND bm.branch_id = %I.branch_id) '
            'AND NOT EXISTS (SELECT 1 FROM profiles p '
            'WHERE p.id = auth.uid() AND p.is_platform_admin = true)'
            ')',
            t, t, t
        );
    END LOOP;

    RAISE NOTICE 'Políticas membership_* con branch_memberships aplicadas a 10 tablas operativas.';
END $$;

-- ============================================================
-- PASO 2: branch_stock
-- ============================================================
-- branch_stock ya tiene policies de Fase 11.2 (10.6 + branch_id implícito
-- por la FK). Pero como branch_stock SÍ tiene branch_id, las policies
-- DEBEN filtrar también por branch_memberships. Las policies actuales
-- de Fase 11.2 solo filtran por company_memberships (suficiente para
-- SELECT pero no para INSERT/UPDATE/DELETE: sin branch_membership, un
-- usuario podría ver stock de OTRA sucursal).
--
-- Recreamos las 4 policies con el filtro completo.
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
            AND EXISTS (
                SELECT 1 FROM branch_memberships bm
                WHERE bm.user_id = auth.uid() AND bm.branch_id = branch_stock.branch_id
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
            AND EXISTS (
                SELECT 1 FROM branch_memberships bm
                WHERE bm.user_id = auth.uid() AND bm.branch_id = branch_stock.branch_id
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
            AND EXISTS (
                SELECT 1 FROM branch_memberships bm
                WHERE bm.user_id = auth.uid() AND bm.branch_id = branch_stock.branch_id
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
            AND EXISTS (
                SELECT 1 FROM branch_memberships bm
                WHERE bm.user_id = auth.uid() AND bm.branch_id = branch_stock.branch_id
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
            AND EXISTS (
                SELECT 1 FROM branch_memberships bm
                WHERE bm.user_id = auth.uid() AND bm.branch_id = branch_stock.branch_id
            )
            AND NOT EXISTS (
                SELECT 1 FROM profiles p
                WHERE p.id = auth.uid() AND p.is_platform_admin = true
            )
        );
END $$;

-- ============================================================
-- PASO 3: branches y branch_memberships
-- ============================================================
-- branches: la policy de Fase 11.0 (membership_select_branches) ya
-- filtra por company_memberships. branches NO tiene branch_id, por lo
-- que el filtro correcto es por company_memberships (no branch). Se
-- mantiene la policy actual.
--
-- branch_memberships: las policies de Fase 11.1 (self + owner_tenant)
-- son correctas: el usuario ve sus propias membresías, y un owner ve
-- las de su tenant. NO añadimos filtro de branch_membership aquí
-- (sería circular).
-- ============================================================

-- NO-OP intencional: las policies de branches/branch_memberships ya son
-- correctas tras Bloque B y se mantienen sin cambios.

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- 1. Las policies activas en las 10 tablas operativas deben incluir
--    una subconsulta a `branch_memberships`:
--
--    SELECT tablename, policyname, qual
--    FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN (
--          'sales', 'sale_items', 'cash_sessions', 'inventory_movements',
--          'customer_payments', 'expenses', 'supplier_payments',
--          'supplier_invoices', 'audit_logs', 'major_expenses'
--      )
--    ORDER BY tablename, policyname
--    LIMIT 5;
--    -- Cada `qual` debe contener "branch_memberships".
--
-- 2. branch_stock también:
--
--    SELECT tablename, policyname, qual
--    FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'branch_stock'
--      AND policyname LIKE 'membership_%';
--    -- Cada qual debe contener "branch_memberships".
--
-- 3. Smoke test crítico (cuenta con branch_membership):
--    - Login con owner de Distribelleza con branch_membership en MAIN.
--    - SELECT sales → debe devolver ventas existentes de MAIN.
--    - Sin branch_membership (caso degenerado post-invitación):
--      . SELECT sales → debe devolver [].
--      . El owner debe usar BranchManagement para asignar primero.
-- ==========================================
