-- ==========================================
-- ROLLBACK 20261004000003 - Restaurar RLS basada en JWT
-- ==========================================
-- ⚠️ CUIDADO: este rollback restaura las políticas "tenant_*" que filtran
--             por el company_id del JWT. Si los JWTs no tienen el claim
--             company_id correctamente, las queries devolverán 0 filas.
--
-- Ejecutar SOLO si el smoke test de la fase 10.4 falla y se necesita
-- volver al comportamiento anterior.
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
    -- Eliminar políticas nuevas (membership_*)
    FOREACH t IN ARRAY tenant_tables
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "membership_select" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "membership_insert" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "membership_update" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "membership_delete" ON %I', t);

        -- Restaurar políticas basadas en JWT
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
END $$;

-- Restaurar estado de company_memberships
DROP POLICY IF EXISTS "self_memberships_select" ON company_memberships;
DROP POLICY IF EXISTS "owner_tenant_memberships" ON company_memberships;
ALTER TABLE company_memberships DISABLE ROW LEVEL SECURITY;

COMMIT;
