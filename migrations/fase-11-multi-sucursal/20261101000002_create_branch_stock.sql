-- ==========================================
-- MIGRACIÓN 20261101000002 - Tabla branch_stock
-- Fase 11 - Multi-sucursal (Bloque B)
-- ==========================================
-- OBJETIVO:
--   Crear la tabla `branch_stock` que reparte el stock de cada variante
--   (product_variants) entre las sucursales de la empresa.
--
--   Reglas:
--     - La VARIANTE sigue siendo única por SKU (catálogo compartido).
--       NO se duplican variantes por sucursal.
--     - El STOCK se reparte: `branch_stock.stock` por (branch, variant).
--     - `min_stock` permite alertas de reposición por sucursal.
--     - `price_override` (nullable) permite que una variante tenga
--       precio distinto en esta sucursal (ej: promoción local).
--
-- PREREQUISITOS:
--   1. 20261101000000 aplicada (branches existe con backfill ejecutado).
--   2. product_variants existe y tiene company_id (Fase 1/2).
--
-- IDEMPOTENTE: Sí. CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
--              INSERT ... ON CONFLICT DO NOTHING.
-- REVERSIBLE: Sí. Ver RK_20261101000002_drop_branch_stock.sql.
--
-- ORDEN DE APLICACIÓN:
--   1. 20261101000000_create_branches.sql
--   2. 20261101000001_branch_memberships.sql
--   3. 20261101000002_create_branch_stock.sql      ← ESTE
--   4. 20261101000003_add_branch_id_to_tables.sql
-- ==========================================

BEGIN;

CREATE TABLE IF NOT EXISTS branch_stock (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id       UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    variant_id      UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    stock           INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
    min_stock       INT DEFAULT 0,
    price_override  NUMERIC,
    active          BOOLEAN NOT NULL DEFAULT true,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(branch_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_stock_branch
    ON branch_stock(branch_id);

CREATE INDEX IF NOT EXISTS idx_branch_stock_variant
    ON branch_stock(variant_id);

-- Trigger de updated_at
DROP TRIGGER IF EXISTS trg_branch_stock_updated_at ON branch_stock;
CREATE TRIGGER trg_branch_stock_updated_at
    BEFORE UPDATE ON branch_stock
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- BACKFILL: para cada product_variants existente, crear una fila en
-- branch_stock con `stock = product_variants.stock` en la sucursal
-- principal (MAIN) de su empresa.
--
-- Tras este backfill, el stock total de la empresa está concentrado en
-- la sucursal MAIN. Para multi-sucursal real (Bloque C / UI), el usuario
-- redistribuye el stock creando sucursales y moviendo cantidades con
-- `tenant_transfer_stock` (RPC de Fase 3).
-- ============================================================

INSERT INTO branch_stock (company_id, branch_id, variant_id, stock, min_stock, active)
SELECT
    pv.company_id,
    b.id AS branch_id,
    pv.id AS variant_id,
    pv.stock,
    0 AS min_stock,
    true AS active
FROM product_variants pv
JOIN branches b
  ON b.company_id = pv.company_id AND b.is_main = true
ON CONFLICT (branch_id, variant_id) DO NOTHING;

-- ============================================================
-- RLS: branch_stock se gobierna por membresía de empresa (Fase 10.6).
-- ============================================================
-- Las políticas siguen el patrón de las tablas per-tenant: EXISTS en
-- company_memberships + exclusión de platform admins. Esto cierra el
-- agujero del SELECT cruzado si un técnico conserva membresía heredada.
-- ============================================================

ALTER TABLE branch_stock ENABLE ROW LEVEL SECURITY;

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

COMMENT ON TABLE branch_stock IS
    'Stock por sucursal de cada variante. La variante sigue siendo única por SKU (catálogo compartido de la empresa); el stock se reparte. min_stock permite alertas de reposición locales. price_override permite precio distinto en esta sucursal (nullable: NULL = usar precio de la variante).';
COMMENT ON COLUMN branch_stock.price_override IS
    'Precio alternativo para esta variante en esta sucursal. NULL = usar product_variants.price. Útil para promociones locales o ajustes regionales.';

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- 1. Backfill: una fila por variant en la sucursal principal:
--    SELECT COUNT(*) FROM branch_stock;
--    -- Esperado: igual al número de product_variants (en este proyecto: ~125)
--
-- 2. El stock inicial es el mismo que tenía product_variants.stock:
--    SELECT pv.id, pv.stock AS variant_stock, bs.stock AS branch_stock
--    FROM product_variants pv
--    JOIN branch_stock bs ON bs.variant_id = pv.id
--    JOIN branches b ON b.id = bs.branch_id AND b.is_main = true;
--    -- Esperado: variant_stock = branch_stock en cada fila
--
-- 3. RLS activo:
--    SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'branch_stock';
--    -- Esperado: relrowsecurity = true
--
-- 4. Políticas membership_*:
--    SELECT policyname FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'branch_stock';
--    -- Esperado: 4 filas (select, insert, update, delete)
-- ==========================================