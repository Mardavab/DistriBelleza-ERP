-- ==========================================
-- ROLLBACK 20261004000002 - Restaurar NOT NULL a profiles.company_id
-- ==========================================
-- ADVERTENCIA: este rollback asigna `company_id` a partir de la membresía
-- por defecto de cada usuario. Si un usuario no tiene membresía default,
-- no se le podrá asignar empresa y el SET NOT NULL fallará.
--
-- TOLERANTE: si `company_memberships` no existe, este rollback NO puede
--            restaurar los company_id (porque no hay fuente de verdad).
--            En ese caso, falla explícitamente con mensaje claro.
--
-- Procedimiento:
--   1. Restaurar company_id desde memberships (default o única).
--   2. SET NOT NULL.
-- ==========================================

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'company_memberships'
    ) THEN
        RAISE EXCEPTION 'No se puede hacer rollback: company_memberships no existe. No hay fuente de verdad para restaurar company_id.';
    END IF;
END $$;

-- 1. Restaurar company_id desde la membresía por defecto.
--    Prioridad: is_default=true. Si no hay, tomar la primera.
UPDATE profiles p
SET company_id = COALESCE(
    (SELECT m.company_id FROM company_memberships m
     WHERE m.user_id = p.id AND m.is_default = true
     LIMIT 1),
    (SELECT m.company_id FROM company_memberships m
     WHERE m.user_id = p.id
     ORDER BY m.created_at ASC
     LIMIT 1)
)
WHERE p.company_id IS NULL;

-- 2. Si quedó algún profile sin company_id, abortar (no se puede SET NOT NULL).
DO $$
DECLARE
    null_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO null_count FROM profiles WHERE company_id IS NULL;
    IF null_count > 0 THEN
        RAISE EXCEPTION 'No se puede restaurar NOT NULL: % profiles sin company_id', null_count;
    END IF;
END $$;

-- 3. Restaurar NOT NULL.
ALTER TABLE profiles ALTER COLUMN company_id SET NOT NULL;

COMMIT;
