-- ==========================================
-- MIGRACIÓN 20261101000001 - Tabla branch_memberships
-- Fase 11 - Multi-sucursal (Bloque B)
-- ==========================================
-- OBJETIVO:
--   Crear la tabla `branch_memberships` para que un usuario pueda tener
--   acceso a una o varias sucursales dentro de una misma empresa.
--
--   Reglas:
--     - Un usuario con company_membership en una empresa PUEDE tener
--       cero o más branch_memberships en las sucursales de esa empresa.
--       Sin branch_membership, el usuario está en la empresa pero NO
--       puede operar en ninguna sucursal (útil para owners globales
--       que aún no asignaron su primera sucursal).
--     - role es POR SUCURSAL: el mismo usuario puede ser owner en una
--       sucursal y manager en otra. Esto replica el patrón Fase 10
--       (rol por empresa) pero a nivel sucursal.
--     - is_default indica la sucursal "activa" cuando hay varias. Solo
--       puede haber una is_default=true por usuario (índice único parcial).
--
-- PREREQUISITOS:
--   1. 20261101000000 aplicada (branches existe con backfill ejecutado).
--   2. company_memberships existe (Fase 10.0 aplicada).
--
-- IDEMPOTENTE: Sí. CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
--              INSERT ... ON CONFLICT DO NOTHING.
-- REVERSIBLE: Sí. Ver RK_20261101000001_drop_branch_memberships.sql.
--
-- ORDEN DE APLICACIÓN:
--   1. 20261101000000_create_branches.sql
--   2. 20261101000001_branch_memberships.sql        ← ESTE
--   3. 20261101000002_create_branch_stock.sql
--   4. 20261101000003_add_branch_id_to_tables.sql
-- ==========================================

BEGIN;

CREATE TABLE IF NOT EXISTS branch_memberships (
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    role        user_role NOT NULL,
    is_default  BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, branch_id)
);

-- Solo una sucursal default por usuario (índice único parcial).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_branch_default_per_user
    ON branch_memberships (user_id) WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_branch_memberships_user
    ON branch_memberships(user_id);

CREATE INDEX IF NOT EXISTS idx_branch_memberships_branch
    ON branch_memberships(branch_id);

-- ============================================================
-- BACKFILL: crear branch_membership en la sucursal principal por
-- cada company_membership existente.
--
-- Reglas:
--   - branch_id = la sucursal MAIN (is_main=true) de la empresa.
--   - role = el mismo role de la company_membership.
--   - is_default = true para el primer branch_membership del usuario.
--
-- Si un usuario tiene varias company_memberships (multi-empresa), cada
-- una genera un branch_membership en su respectiva sucursal MAIN. El
-- índice único parcial `uniq_branch_default_per_user` garantiza que solo
-- una de esas membresías quede is_default=true.
-- ============================================================

INSERT INTO branch_memberships (user_id, company_id, branch_id, role, is_default)
SELECT
    cm.user_id,
    cm.company_id,
    b.id AS branch_id,
    cm.role,
    -- Marcar como default SOLO si el usuario no tiene ya otra default.
    -- Esto evita violar el índice único parcial cuando un usuario tiene
    -- múltiples company_memberships.
    NOT EXISTS (
        SELECT 1 FROM branch_memberships bm2
        WHERE bm2.user_id = cm.user_id AND bm2.is_default = true
    ) AS is_default
FROM company_memberships cm
JOIN branches b
  ON b.company_id = cm.company_id AND b.is_main = true
ON CONFLICT (user_id, branch_id) DO NOTHING;

-- Defensa: si por alguna razón quedó más de una is_default=true (no debería),
-- dejar solo la de la membresía default de company_memberships (o la más antigua).
UPDATE branch_memberships bm
SET is_default = false
WHERE bm.is_default = true
  AND EXISTS (
      SELECT 1 FROM branch_memberships bm2
      WHERE bm2.user_id = bm.user_id
        AND bm2.is_default = true
        AND bm2.created_at < bm.created_at
  );

-- ============================================================
-- RLS: branch_memberships sigue el patrón de company_memberships.
-- ============================================================
-- SELECT: un usuario ve sus propias branch_memberships (para que la UI
-- pueda listar las sucursales accesibles). Owners ven las del tenant.
-- Excluimos platform admins (mismo motivo que Fase 10.6).
--
-- NO concedemos INSERT/UPDATE/DELETE aquí: las asignaciones las hace el
-- owner vía server actions (app/actions/branch-memberships.ts) que opera
-- con supabaseAdmin (bypass RLS).
-- ============================================================

ALTER TABLE branch_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self_branch_memberships_select" ON branch_memberships;
CREATE POLICY "self_branch_memberships_select" ON branch_memberships
    FOR SELECT TO authenticated
    USING (
        user_id = auth.uid()
        AND NOT EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.is_platform_admin = true
        )
    );

-- Owners ven las branch_memberships de su tenant.
DROP POLICY IF EXISTS "owner_tenant_branch_memberships" ON branch_memberships;
CREATE POLICY "owner_tenant_branch_memberships" ON branch_memberships
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM branch_memberships bm2
            WHERE bm2.user_id = auth.uid()
              AND bm2.role = 'owner'
              AND bm2.company_id = branch_memberships.company_id
        )
        AND NOT EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.is_platform_admin = true
        )
    );

COMMENT ON TABLE branch_memberships IS
    'Membresías de usuarios a sucursales específicas. Permite que un usuario tenga distinto rol en cada sucursal (ej: owner en MAIN, manager en NORTE). Una fila por (user, branch). El índice único `uniq_branch_default_per_user` garantiza que solo haya una is_default=true por usuario.';
COMMENT ON COLUMN branch_memberships.role IS
    'Rol del usuario en ESTA sucursal. El mismo usuario puede ser owner en una sucursal y manager en otra.';
COMMENT ON COLUMN branch_memberships.is_default IS
    'Sucursal "activa" cuando el usuario tiene varias. Solo una true por usuario (constraint enforced por índice único parcial).';

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- 1. Backfill: cada company_membership tiene una branch_membership:
--    SELECT cm.user_id, cm.company_id, EXISTS (
--        SELECT 1 FROM branch_memberships bm
--        WHERE bm.user_id = cm.user_id AND bm.company_id = cm.company_id
--    ) AS has_branch_membership
--    FROM company_memberships cm;
--    -- Esperado: todas las filas con has_branch_membership = true
--
-- 2. Solo una is_default=true por usuario:
--    SELECT user_id, COUNT(*) AS defaults
--    FROM branch_memberships WHERE is_default = true
--    GROUP BY user_id HAVING COUNT(*) > 1;
--    -- Esperado: 0 filas
--
-- 3. RLS activo:
--    SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'branch_memberships';
--    -- Esperado: relrowsecurity = true
-- ==========================================