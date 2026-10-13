-- ==========================================
-- MIGRACIÓN 20261004000004 - Agregar is_platform_admin
-- Fase 10.5 - Cleanup
-- ==========================================
-- OBJETIVO: Reemplazar la detección de técnicos vía `profiles.role = 'technician'`
--           por un flag explícito `is_platform_admin`. Esto desacopla el rol
--           de plataforma del modelo de datos de membresías.
--
--   - profiles.role queda como cache legacy (se elimina en fase 10.5.2)
--   - profiles.is_platform_admin es la nueva fuente de verdad
--
-- IDEMPOTENTE: Sí (ADD COLUMN IF NOT EXISTS no es estándar PG; usamos
--              DO block para verificar antes).
-- REVERSIBLE: Sí (DROP COLUMN).
-- ==========================================

BEGIN;

-- 1. Agregar columna is_platform_admin si no existe.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'is_platform_admin'
    ) THEN
        ALTER TABLE profiles
            ADD COLUMN is_platform_admin BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

-- 2. Backfill: todos los técnicos actuales quedan marcados.
UPDATE profiles
SET is_platform_admin = true
WHERE role = 'technician' AND is_platform_admin = false;

-- 3. Verificación: ¿hay técnicos sin marcar?
DO $$
DECLARE
    unmarked INT;
BEGIN
    SELECT COUNT(*) INTO unmarked
    FROM profiles
    WHERE role = 'technician' AND is_platform_admin = false;

    IF unmarked > 0 THEN
        RAISE WARNING 'Quedan % profiles con role=technician pero is_platform_admin=false', unmarked;
    END IF;
END $$;

COMMIT;

-- ==========================================
-- VERIFICACIÓN
-- ==========================================
-- 1. La columna existe:
--    SELECT column_name, data_type, is_nullable, column_default
--    FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'profiles'
--      AND column_name = 'is_platform_admin';
--    -- Esperado: boolean, NO, false
--
-- 2. Conteo de platform admins:
--    SELECT is_platform_admin, COUNT(*) FROM profiles
--    GROUP BY is_platform_admin;
--    -- Esperado: true = N técnicos, false = resto
-- ==========================================
