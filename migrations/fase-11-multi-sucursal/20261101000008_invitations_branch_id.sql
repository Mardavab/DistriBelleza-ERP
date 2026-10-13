-- ==========================================
-- MIGRACIÓN 20261101000008 - branch_id en invitations
-- Fase 11 - Multi-sucursal (Bloque C — Commit 3)
-- ==========================================
-- OBJETIVO:
--   Vincular cada invitación a UNA sucursal específica. Al aceptar la
--   invitación, el invitado queda asignado automáticamente a esa
--   sucursal con un branch_membership (is_default=true).
--
--   Antes de esta migración, `invitations` no guardaba la sucursal: la
--   página de aceptación podía recibir un CSV de branch_ids por form
--   (sub-optimal y dependía de la UI). Ahora la sucursal vive en la
--   propia invitación: server-side, persistente, y consistente con el
--   resto del modelo multi-sucursal.
--
-- CAMBIOS:
--   - ALTER TABLE invitations ADD COLUMN branch_id UUID REFERENCES branches(id)
--     (NULLABLE: invitaciones legacy ya emitidas quedan sin branch_id;
--     el fallback en acceptInvitationAction las resuelve a MAIN).
--   - Backfill: para invitaciones pendientes (used_at IS NULL), asignar
--     la sucursal MAIN de su empresa. Idempotente.
--   - Índice parcial sobre (branch_id) WHERE used_at IS NULL para
--     acelerar el lookup durante la aceptación.
--
-- PREREQUISITOS:
--   1. Fase 11.0 aplicada (branches existe con backfill MAIN por empresa).
--
-- IDEMPOTENTE: Sí. ADD COLUMN IF NOT EXISTS, UPDATE con guarda NOT EXISTS,
--              CREATE INDEX IF NOT EXISTS.
-- REVERSIBLE: Sí. Ver RK_20261101000008_drop_invitations_branch_id.sql.
--
-- ORDEN DE APLICACIÓN (Fase 11, Bloque C):
--   1. 20261101000007_remove_branch_stock.sql
--   2. 20261101000008_invitations_branch_id.sql     ← ESTE
-- ==========================================

BEGIN;

ALTER TABLE invitations
    ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

-- Backfill: invitaciones pendientes sin branch_id → MAIN de su empresa.
--
-- Idempotente: usa `i.branch_id IS NULL` para no pisar invitaciones
-- que ya tengan un branch_id asignado (ej: si se re-ejecuta la
-- migración tras una ejecución parcial, o si una invitación nueva fue
-- creada con un branch_id explícito entre la primera ejecución y un
-- rollback).
--
-- `LEFT JOIN` + `b.is_main = true`: la subquery es per-invitation, así
-- que no se duplican filas en caso de que (caso degenerado) hubiera
-- más de una is_main=true.
UPDATE invitations
SET branch_id = (
    SELECT b.id
    FROM branches b
    WHERE b.company_id = invitations.company_id
      AND b.is_main = true
    LIMIT 1
)
WHERE used_at IS NULL
  AND branch_id IS NULL;

-- Índice parcial sobre branch_id en invitaciones pendientes.
-- Acelera el lookup durante la aceptación (acceptInvitationAction
-- hace JOIN con branches para resolver la sucursal).
CREATE INDEX IF NOT EXISTS idx_invitations_branch_pending
    ON invitations(branch_id) WHERE used_at IS NULL;

COMMENT ON COLUMN invitations.branch_id IS
    'Sucursal a la que quedará asignado el invitado al aceptar. NULL = invitación legacy (el fallback en acceptInvitationAction la resuelve a la sucursal MAIN de la empresa).';
COMMENT ON INDEX idx_invitations_branch_pending IS
    'Acelera el lookup de invitaciones pendientes por branch_id. Usado por acceptInvitationAction al resolver la sucursal activa post-aceptación.';

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- 1. Columna creada y nullable:
--    SELECT column_name, data_type, is_nullable
--    FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'invitations'
--      AND column_name = 'branch_id';
--    -- Esperado: branch_id | uuid | YES
--
-- 2. Backfill: todas las invitaciones pendientes tienen branch_id:
--    SELECT COUNT(*) FROM invitations WHERE used_at IS NULL AND branch_id IS NULL;
--    -- Esperado: 0 (salvo que alguna empresa no tenga sucursal MAIN)
--
-- 3. Cada branch_id apunta a una sucursal de la misma empresa que la
--    invitación:
--    SELECT i.id, i.branch_id, i.company_id, b.company_id AS branch_company
--    FROM invitations i
--    LEFT JOIN branches b ON b.id = i.branch_id
--    WHERE i.branch_id IS NOT NULL
--      AND b.company_id IS DISTINCT FROM i.company_id;
--    -- Esperado: 0 filas
--
-- 4. Índice creado:
--    SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public' AND tablename = 'invitations'
--      AND indexname = 'idx_invitations_branch_pending';
--    -- Esperado: 1 fila
-- ==========================================