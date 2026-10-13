-- ==========================================
-- MIGRACIÓN 20261004000006 - RLS defensiva: excluir platform admins
-- Fase 10.6 - Multi-empresa por usuario
-- ==========================================
-- OBJETIVO:
--   Las políticas `membership_*` (creadas por 10.3) conceden acceso a
--   quien tenga una membresía en la empresa destino. Sin embargo, los
--   técnicos (`is_platform_admin = true`) pueden tener una membresía
--   heredada del backfill de fase 2 (cuando `profiles.company_id` era
--   NOT NULL y todos los usuarios tenían una fila en la empresa de
--   respaldo Distribelleza).
--
--   Esto significa que, tras 10.3, un técnico que aún conserve esa
--   membresía podría acceder a datos de empresa usando un cliente
--   autenticado, en lugar del flujo correcto (consola de plataforma +
--   supabaseAdmin bypass RLS).
--
--   Esta migración cierra el agujero AÑADIENDO una condición
--   `AND NOT EXISTS(... is_platform_admin ...)` a las políticas:
--   si el usuario es platform admin, se deniega todo acceso a las
--   tablas per-tenant. Los técnicos siguen accediendo vía
--   `supabaseAdmin` en server actions de plataforma, que bypasea RLS.
--
-- IMPORTANTE - PREREQUISITOS:
--   1. Haber ejecutado 20261004000004 (agregar `is_platform_admin`).
--   2. (Opcional pero recomendado) Haber ejecutado 20261004000003
--      (RLS por membresía). Si no se ejecutó, esta migración reemplaza
--      completamente su lógica porque recrea las mismas políticas
--      con la exclusión añadida.
--
-- IDEMPOTENTE: Sí (DROP POLICY IF EXISTS + CREATE).
-- REVERSIBLE: Sí, vía RK_20261004000006_restore_membership_rls.sql.
--
-- ORDEN DE APLICACIÓN RECOMENDADO:
--   1. 20261004000000_memberships_create_table.sql
--   2. 20261004000001_memberships_backfill.sql
--   3. 20261004000002_profiles_drop_company_id_not_null.sql
--   4. 20261004000004_profiles_is_platform_admin.sql    ← flag primero
--   5. 20261004000006_rls_exclude_platform_admins.sql   ← ESTE
--      (Esta migración REEMPLAZA 20261004000003: hace lo mismo
--       que 10.3 + la exclusión de platform admins. Si se aplica
--       10.3 después de esta, las políticas de 10.3 sobrescribirán
--       las de esta y se perderá la exclusión. Si 10.3 ya está
--       aplicada, esta migración la actualiza in-place.)
--   6. 20261004000005_drop_profiles_role.sql            ← último
-- ==========================================

BEGIN;

-- ============================================================
-- PASO 1: Re-crear políticas `membership_*` con exclusión de
--         platform admins en las 15 tablas per-tenant.
--
--         Esta migración funciona en DOS modos:
--           (a) 10.3 YA corrió: las políticas `membership_*` existen
--               → las dropeamos y las recreamos con la exclusión.
--           (b) 10.3 NO corrió: las políticas son las viejas `tenant_*`
--               → dropeamos `tenant_*` (y `membership_*` por si acaso,
--               que será no-op), y creamos las `membership_*` con
--               exclusión. Esto deja las tablas con la nueva semántica
--               sin necesidad de correr 10.3.
-- ============================================================

DO $$
DECLARE
    t TEXT;
    -- 15 tablas per-tenant (mismas que 10.3: products, product_variants,
    -- customers, sales, sale_items, customer_payments, cash_sessions,
    -- expenses, supplier_payments, major_expenses, inventory_movements,
    -- audit_logs, suppliers, supplier_invoices, company_settings).
    tenant_tables TEXT[] := ARRAY[
        'products', 'product_variants', 'customers', 'sales', 'sale_items',
        'customer_payments', 'cash_sessions', 'expenses', 'supplier_payments',
        'major_expenses', 'inventory_movements', 'audit_logs', 'suppliers',
        'supplier_invoices', 'company_settings'
    ];
BEGIN
    FOREACH t IN ARRAY tenant_tables
    LOOP
        -- Eliminar AMBAS familias por idempotencia:
        --   - tenant_*: las viejas políticas basadas en JWT
        --   - membership_*: si 10.3 ya corrió
        EXECUTE format('DROP POLICY IF EXISTS "tenant_select" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "tenant_insert" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "tenant_update" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "tenant_delete" ON %I', t);

        EXECUTE format('DROP POLICY IF EXISTS "membership_select" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "membership_insert" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "membership_update" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "membership_delete" ON %I', t);

        -- SELECT: membresía en la empresa Y NO es platform admin.
        -- La subconsulta a `profiles` tiene índice por PK (id = auth.uid())
        -- por lo que el costo es despreciable.
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

    RAISE NOTICE 'Políticas membership_* con exclusión de platform admins aplicadas a 15 tablas per-tenant.';
END $$;

-- ============================================================
-- PASO 2: Actualizar políticas de `company_memberships` para
--         excluir platform admins también en SELECT.
--
--         Las políticas actuales (10.3) permiten a un usuario ver
--         sus propias membresías y a un owner ver las de su tenant.
--         Si un platform admin tiene membresías heredadas del backfill
--         de fase 2, debe poder verlas para depurar pero NO ver las
--         de OTROS usuarios. Esta migración lo refleja.
-- ============================================================

ALTER TABLE company_memberships ENABLE ROW LEVEL SECURITY;

-- (a) self_memberships_select: un usuario ve sus propias membresías.
--     Excluimos platform admins: su membresía (si la tiene) es residual
--     y no la necesita para operar. Si la tiene, se sigue conservando
--     en la tabla para auditoría.
DROP POLICY IF EXISTS "self_memberships_select" ON company_memberships;
CREATE POLICY "self_memberships_select" ON company_memberships
    FOR SELECT TO authenticated
    USING (
        user_id = auth.uid()
        AND NOT EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.is_platform_admin = true
        )
    );

-- (b) owner_tenant_memberships: owners ven membresías de su tenant.
--     Un platform admin no es "owner" de ningún tenant → esta política
--     ya lo excluye de hecho. Pero añadimos la condición explícita
--     para hacerlo robusto si en el futuro un técnico recibiera rol
--     'owner' en alguna empresa (debería seguir siendo bloqueado).
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
        AND NOT EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.is_platform_admin = true
        )
    );

-- NOTA: las escrituras sobre company_memberships siguen siendo
-- exclusivas vía supabaseAdmin (server actions). El RLS no concede
-- INSERT/UPDATE/DELETE a usuarios autenticados.

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- 1. Las políticas activas deben ser `membership_*` con la exclusión:
--    SELECT tablename, policyname, cmd
--    FROM pg_policies
--    WHERE schemaname = 'public' AND policyname LIKE 'membership_%'
--    ORDER BY tablename, cmd;
--    -- Esperado: 60 filas (15 tablas × 4 ops) para membership_*,
--    -- más 2 filas en company_memberships (self + owner).
--
-- 2. Las políticas antiguas NO deben existir:
--    SELECT tablename, policyname FROM pg_policies
--    WHERE schemaname = 'public' AND policyname LIKE 'tenant_%';
--    -- Esperado: 0 filas
--
-- 3. Smoke test crítico (recomendado hacer ANTES de continuar con 10.5):
--    - Login con owner de Distribelleza → sigue viendo datos.
--    - Login con técnico (is_platform_admin=true):
--      · SELECT products FROM authenticated client → debe devolver [].
--      · SELECT company_memberships FROM authenticated client
--        → debe devolver [] (sus propias membresías también excluidas).
--      · SELECT sales usando supabaseAdmin en server action
--        → debe seguir devolviendo datos (bypass RLS).
--    - Si todo OK, proceder con 20261004000005 (DROP profiles.role).
-- ==========================================
