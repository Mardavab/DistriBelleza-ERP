-- ==========================================
-- MIGRACIÓN 20261004000001 - Backfill de membresías desde profiles
-- Fase 10 - Multi-empresa por usuario
-- ==========================================

BEGIN;

-- Replica el estado actual: cada profile con company_id se convierte en
-- una membresía con is_default=true.
INSERT INTO company_memberships (user_id, company_id, role, is_default)
SELECT p.id, p.company_id, p.role, true
FROM profiles p
WHERE p.company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM company_memberships m
    WHERE m.user_id = p.id AND m.company_id = p.company_id
  );

COMMIT;
