-- ==========================================
-- MIGRACIÓN 20261101000000 - Crear tabla branches (sucursales)
-- Fase 11 - Multi-sucursal (sub-tenants dentro de una empresa)
-- ==========================================
-- OBJETIVO:
--   Crear la tabla `branches` para modelar las sucursales de cada empresa.
--   El modelo es "sub-tenants": una empresa (companies) tiene N sucursales.
--   Las sucursales comparten catálogo (products, customers, suppliers) pero
--   tienen stock, ventas y operaciones propias (branch_id en tablas operativas).
--
--   Esta migración es ADITIVA: no modifica ninguna tabla existente.
--
-- PREREQUISITOS:
--   1. Fase 10 cerrada (company_memberships existe, RLS por membresía activa).
--   2. Tabla `companies` creada (Fase 1).
--   3. Función `update_updated_at_column()` existe (legacy/schema_pre_multitenant.sql).
--
-- IDEMPOTENTE: Sí. Usa `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
--              `DROP TRIGGER IF EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`.
-- REVERSIBLE: Sí. Ver migrations/RK_20261101000000_drop_branches.sql.
--
-- ORDEN DE APLICACIÓN (Fase 11, Bloque B):
--   1. 20261101000000_create_branches.sql         ← ESTE
--   2. 20261101000001_branch_memberships.sql
--   3. 20261101000002_create_branch_stock.sql
--   4. 20261101000003_add_branch_id_to_tables.sql
-- ==========================================

BEGIN;

CREATE TABLE IF NOT EXISTS branches (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    code        VARCHAR(20) NOT NULL,
    name        VARCHAR(200) NOT NULL,
    address     TEXT,
    phone       VARCHAR(50),
    is_main     BOOLEAN NOT NULL DEFAULT false,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_by  UUID REFERENCES auth.users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_branches_company
    ON branches(company_id);

-- Trigger de updated_at: la función `update_updated_at_column()` ya existe
-- en el schema (creada por legacy/schema_pre_multitenant.sql).
DROP TRIGGER IF EXISTS trg_branches_updated_at ON branches;
CREATE TRIGGER trg_branches_updated_at
    BEFORE UPDATE ON branches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- BACKFILL: crear "Sucursal Principal" por cada empresa existente.
-- ============================================================
-- is_main=true y code='MAIN' son la convención para identificar la
-- sucursal única creada durante el backfill. Esta sucursal recibe
-- todos los registros operacionales existentes en la migración 11.3
-- (branch_id = sucursal principal de cada empresa).
--
-- created_by se deja NULL: el "primer owner" de la empresa no es
-- trazable de forma simple sin JOIN adicional; para Fase 11 no es
-- información crítica (la auditoría la cubre created_at).
-- ============================================================

INSERT INTO branches (company_id, code, name, is_main, active)
SELECT c.id, 'MAIN', 'Sucursal Principal', true, true
FROM companies c
WHERE NOT EXISTS (
    SELECT 1 FROM branches b
    WHERE b.company_id = c.id AND b.code = 'MAIN'
);

-- ============================================================
-- RLS: branches se gobierna por membresía de empresa.
-- ============================================================
-- Como las tablas operativas se protegen con `company_memberships`
-- (Fase 10.6), branches sigue el mismo patrón: un usuario accede a
-- las sucursales de empresas donde tiene membresía.
--
-- NO concedemos acceso de escritura aquí (lo hace `app/actions/branches.ts`
-- que opera con supabaseAdmin). RLS solo evita fugas en SELECT/UPDATE/
-- DELETE a través de cliente autenticado. Esto es defensivo: el flujo
-- canónico siempre pasa por server actions.
-- ============================================================

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "membership_select_branches" ON branches;
CREATE POLICY "membership_select_branches" ON branches
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM company_memberships m
            WHERE m.user_id = auth.uid() AND m.company_id = branches.company_id
        )
        AND NOT EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.is_platform_admin = true
        )
    );

-- Las escrituras sobre branches quedan exclusivamente vía supabaseAdmin
-- (server actions de owners). El RLS no concede INSERT/UPDATE/DELETE.

COMMENT ON TABLE branches IS
    'Sucursales de cada empresa. Modelo sub-tenant: comparten catálogo (products, customers, suppliers) pero tienen stock, ventas y operaciones propias (branch_id en tablas operativas). Cada empresa tiene al menos una sucursal is_main=true creada durante el backfill.';
COMMENT ON COLUMN branches.code IS
    'Código corto único dentro de la empresa (ej: MAIN, NORTE, SUR). Visible al usuario en URLs y referencias.';
COMMENT ON COLUMN branches.is_main IS
    'true para la sucursal "principal" (sede única original del tenant). Solo puede haber una is_main=true por empresa (constraint de aplicación, no enforced a nivel SQL).';
COMMENT ON COLUMN branches.active IS
    'false = sucursal desactivada. No se borra: conserva historial de ventas y stock.';

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- 1. Tabla creada:
--    SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name = 'branches';
--    -- Esperado: 1 fila
--
-- 2. Backfill: una sucursal MAIN por empresa:
--    SELECT c.slug, b.code, b.is_main
--    FROM branches b JOIN companies c ON c.id = b.company_id
--    ORDER BY c.slug;
--    -- Esperado: 2 filas (Distribelleza + otra empresa existente), is_main=true
--
-- 3. RLS activo:
--    SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname = 'branches';
--    -- Esperado: relrowsecurity = true
--
-- 4. Política membership_select_branches existe:
--    SELECT policyname FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'branches';
--    -- Esperado: 1 fila
-- ==========================================