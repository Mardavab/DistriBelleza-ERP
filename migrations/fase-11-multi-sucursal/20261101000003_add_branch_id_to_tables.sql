-- ==========================================
-- MIGRACIÓN 20261101000003 - branch_id en tablas operativas
-- Fase 11 - Multi-sucursal (Bloque B)
-- ==========================================
-- OBJETIVO:
--   Agregar la columna `branch_id` a las 10 tablas operativas para que
--   cada registro esté asociado a una sucursal específica dentro de la
--   empresa. Backfillear los registros existentes con la sucursal MAIN
--   de su empresa y luego aplicar NOT NULL.
--
--   Tablas con branch_id (operativas — separadas por sucursal):
--     - sales
--     - sale_items
--     - cash_sessions
--     - inventory_movements
--     - customer_payments
--     - expenses
--     - supplier_payments
--     - supplier_invoices
--     - audit_logs
--     - major_expenses
--
--   Tablas SIN branch_id (catálogo compartido por empresa):
--     - products, customers, suppliers, company_settings,
--       tenant_migration_audit, categories
--
-- PREREQUISITOS:
--   1. 20261101000000 aplicada (branches existe con backfill ejecutado).
--   2. 20261101000001 aplicada (branch_memberships existe; útil para RLS).
--   3. 20261101000002 aplicada (branch_stock existe).
--
-- IDEMPOTENTE: Sí. ALTER TABLE ADD COLUMN es idempotente con IF NOT EXISTS
--              (Postgres 9.6+). Los UPDATEs de backfill son idempotentes con
--              WHERE branch_id IS NULL. SET NOT NULL es idempotente.
--              El disable/enable de triggers de inmutabilidad es idempotente:
--              deshabilitar un trigger ya deshabilitado es no-op, y rehabilitar
--              dentro del mismo BEGIN/COMMIT garantiza que tras cualquier error
--              el BEGIN hace rollback y los triggers vuelven a su estado
--              original (no quedan permanentemente deshabilitados).
--
-- REVERSIBLE: Sí. Ver RK_20261101000003_drop_branch_id_from_tables.sql.
--
-- ORDEN DE APLICACIÓN (último paso del Bloque B):
--   1. 20261101000000_create_branches.sql
--   2. 20261101000001_branch_memberships.sql
--   3. 20261101000002_create_branch_stock.sql
--   4. 20261101000003_add_branch_id_to_tables.sql ← ESTE
-- ==========================================

BEGIN;

-- ============================================================
-- PASO 1: agregar columna branch_id (nullable) a las 10 tablas.
-- ============================================================
-- Usamos IF NOT EXISTS para idempotencia (Postgres 9.6+). Si ya
-- existe, la sentencia es no-op.
--
-- La columna es UUID REFERENCES branches(id) (FK con ON DELETE RESTRICT
-- implícito: NO permitimos borrar sucursales con registros asociados).
-- Para Fase 11 las sucursales NO se borran (deactivateBranchAction
-- marca active=false), así que esta restricción es coherente.
-- ============================================================

ALTER TABLE sales                ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE sale_items           ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE cash_sessions        ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE inventory_movements  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE customer_payments    ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE expenses             ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE supplier_payments    ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE supplier_invoices    ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE audit_logs           ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE major_expenses       ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

-- Índices para acelerar los filtros por sucursal. Las queries más
-- calientes (POS, reportes) filtran siempre por company_id + branch_id.
CREATE INDEX IF NOT EXISTS idx_sales_branch               ON sales(branch_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_branch          ON sale_items(branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_branch       ON cash_sessions(branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_branch ON inventory_movements(branch_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_branch   ON customer_payments(branch_id);
CREATE INDEX IF NOT EXISTS idx_expenses_branch            ON expenses(branch_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_branch   ON supplier_payments(branch_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_branch   ON supplier_invoices(branch_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_branch          ON audit_logs(branch_id);
CREATE INDEX IF NOT EXISTS idx_major_expenses_branch      ON major_expenses(branch_id);

-- ============================================================
-- PASO 2: backfill — asignar branch_id = sucursal MAIN de la empresa.
-- ============================================================
-- Cada fila operativa existente se asigna a la sucursal principal de
-- su empresa (la misma creada en 20261101000000). Esto preserva el
-- estado actual: antes de Fase 11 toda la operación estaba concentrada
-- en una sola "sucursal lógica" (la empresa), y físicamente se reparte
-- a la sucursal MAIN en Fase 11.
--
-- NOTA: las tablas con company_id usan un JOIN directo. Para tablas
-- operativas que se unen al "tenant" por otra vía (ej: sale_items
-- vía sale_id), seguimos usando company_id cuando esté presente.
--
-- TRIGGERS DE INMUTABILIDAD:
--   `inventory_movements` y `audit_logs` tienen triggers
--   `tr_inventory_movements_immutable` y `tr_audit_logs_immutable` que
--   bloquean UPDATE/DELETE (definidos en schema.sql). Como el backfill
--   aquí hace UPDATE sobre estas tablas, los deshabilitamos temporalmente
--   y los rehabilitamos tras el UPDATE. Mismo patrón que la migración de
--   Fase 2 `20261003200100_backfill_company_id.sql:42-43,165-166`.
--   Todo ocurre dentro del mismo BEGIN/COMMIT, así que si algo falla los
--   triggers vuelven a su estado original por el rollback.
-- ============================================================

ALTER TABLE inventory_movements DISABLE TRIGGER tr_inventory_movements_immutable;
ALTER TABLE audit_logs         DISABLE TRIGGER tr_audit_logs_immutable;

UPDATE sales               t SET branch_id = b.id FROM branches b WHERE b.company_id = t.company_id AND b.is_main = true AND t.branch_id IS NULL;
UPDATE sale_items         t SET branch_id = b.id FROM branches b WHERE b.company_id = t.company_id AND b.is_main = true AND t.branch_id IS NULL;
UPDATE cash_sessions      t SET branch_id = b.id FROM branches b WHERE b.company_id = t.company_id AND b.is_main = true AND t.branch_id IS NULL;
UPDATE inventory_movements t SET branch_id = b.id FROM branches b WHERE b.company_id = t.company_id AND b.is_main = true AND t.branch_id IS NULL;
UPDATE customer_payments  t SET branch_id = b.id FROM branches b WHERE b.company_id = t.company_id AND b.is_main = true AND t.branch_id IS NULL;
UPDATE expenses           t SET branch_id = b.id FROM branches b WHERE b.company_id = t.company_id AND b.is_main = true AND t.branch_id IS NULL;
UPDATE supplier_payments  t SET branch_id = b.id FROM branches b WHERE b.company_id = t.company_id AND b.is_main = true AND t.branch_id IS NULL;
UPDATE supplier_invoices  t SET branch_id = b.id FROM branches b WHERE b.company_id = t.company_id AND b.is_main = true AND t.branch_id IS NULL;
UPDATE audit_logs         t SET branch_id = b.id FROM branches b WHERE b.company_id = t.company_id AND b.is_main = true AND t.branch_id IS NULL;
UPDATE major_expenses     t SET branch_id = b.id FROM branches b WHERE b.company_id = t.company_id AND b.is_main = true AND t.branch_id IS NULL;

ALTER TABLE inventory_movements ENABLE TRIGGER tr_inventory_movements_immutable;
ALTER TABLE audit_logs         ENABLE TRIGGER tr_audit_logs_immutable;

-- ============================================================
-- PASO 3: abortar si quedó alguna fila con branch_id NULL.
-- ============================================================
-- Esto es defensivo: el backfill anterior asigna branch_id a TODAS las
-- filas que tienen company_id (todas, gracias a NOT NULL en company_id
-- desde Fase 2.3). Si quedó algo NULL, abortamos con mensaje claro.
-- ============================================================

DO $$
DECLARE
    null_count BIGINT;
    t TEXT;
    tables TEXT[] := ARRAY[
        'sales', 'sale_items', 'cash_sessions', 'inventory_movements',
        'customer_payments', 'expenses', 'supplier_payments',
        'supplier_invoices', 'audit_logs', 'major_expenses'
    ];
BEGIN
    FOREACH t IN ARRAY tables
    LOOP
        EXECUTE format('SELECT COUNT(*) FROM %I WHERE branch_id IS NULL', t) INTO null_count;
        IF null_count > 0 THEN
            RAISE EXCEPTION 'Backfill incompleto: % filas sin branch_id en tabla %', null_count, t;
        END IF;
    END LOOP;
END $$;

-- ============================================================
-- PASO 4: SET NOT NULL en branch_id para forzar la integridad.
-- ============================================================
-- A partir de aquí, INSERT en estas tablas SIN branch_id falla.
-- Las server actions y RPCs deben pasar branch_id explícito.
-- ============================================================

ALTER TABLE sales                ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE sale_items           ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE cash_sessions        ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE inventory_movements  ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE customer_payments    ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE expenses             ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE supplier_payments    ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE supplier_invoices    ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE audit_logs           ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE major_expenses       ALTER COLUMN branch_id SET NOT NULL;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- 1. branch_id NOT NULL en las 10 tablas:
--    SELECT table_name, column_name, is_nullable
--    FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND column_name = 'branch_id'
--      AND table_name IN (
--          'sales', 'sale_items', 'cash_sessions', 'inventory_movements',
--          'customer_payments', 'expenses', 'supplier_payments',
--          'supplier_invoices', 'audit_logs', 'major_expenses'
--      )
--    ORDER BY table_name;
--    -- Esperado: is_nullable = 'NO' en las 10 filas
--
-- 2. Cada fila tiene branch_id apuntando a la sucursal MAIN de su empresa:
--    SELECT s.id, s.branch_id, b.company_id, b.is_main
--    FROM sales s
--    JOIN branches b ON b.id = s.branch_id
--    WHERE b.is_main = false
--    LIMIT 10;
--    -- Esperado: 0 filas (todas las filas existentes apuntan a MAIN)
--
-- 3. Las tablas de catálogo NO tienen branch_id:
--    SELECT table_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND column_name = 'branch_id'
--      AND table_name IN ('products', 'customers', 'suppliers',
--                         'company_settings', 'tenant_migration_audit',
--                         'categories');
--    -- Esperado: 0 filas
-- ==========================================