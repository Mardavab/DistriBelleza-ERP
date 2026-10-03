-- ==========================================
-- MIGRACIÓN 20261003600000 - Add created_by a companies
-- Fase 8 - Platform admin (multi-tenant)
-- ==========================================
-- OBJETIVO: Saber QUÉ usuario/tenant creó cada empresa cliente.
--           Esto permite a un "platform owner" gestionar solo las
--           empresas que él creó (no ver todas las del sistema).
-- IDEMPOTENTE: Sí. ADD COLUMN IF NOT EXISTS.
-- ==========================================

BEGIN;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

-- Backfill: la primera empresa (Distribelleza) se asigna al primer
-- usuario de auth.users como su creador histórico.
UPDATE companies
SET created_by = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1)
WHERE created_by IS NULL;

-- Hacer índice
CREATE INDEX IF NOT EXISTS idx_companies_created_by ON companies(created_by);

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- Debe mostrar created_by poblado para Distribelleza:
--
-- SELECT slug, legal_name, created_by FROM companies;
-- ==========================================