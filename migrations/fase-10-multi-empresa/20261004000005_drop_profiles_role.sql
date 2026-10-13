-- ==========================================
-- MIGRACIÓN 20261004000005 - DROP profiles.role
-- Fase 10.5 - Cleanup final
-- ==========================================
-- OBJETIVO: Eliminar la columna `profiles.role` ahora que el rol vive en
--           `company_memberships.role` y los técnicos se detectan por
--           `profiles.is_platform_admin`.
--
-- PREREQUISITOS (CRÍTICOS):
--   1. Haber ejecutado 20261004000004 (agregar is_platform_admin).
--   2. La columna `company_memberships.role` está poblada para todos los
--      usuarios con membresía (verificado en sub-fase 10.2).
--   3. El código ya NO lee `profiles.role` (verificado por
--      `grep -r "profile\.role\|profiles\.role" --include=*.ts --include=*.tsx app components`).
--
-- ⚠️ Si hay código que aún lee `profiles.role`, esto fallará en runtime
--    (la columna no existirá). Verificar antes.
--
-- IDEMPOTENTE: No. DROP COLUMN falla si la columna no existe.
-- REVERSIBLE: ALTER TABLE profiles ADD COLUMN role user_role.
-- ==========================================

BEGIN;

-- Verificación previa: no debe haber técnicos sin is_platform_admin=true
DO $$
DECLARE
    unmarked INT;
BEGIN
    SELECT COUNT(*) INTO unmarked
    FROM profiles
    WHERE role = 'technician' AND is_platform_admin = false;

    IF unmarked > 0 THEN
        RAISE EXCEPTION 'Hay % profiles con role=technician sin is_platform_admin=true. Abortando.', unmarked;
    END IF;
END $$;

-- Eliminar columna role de profiles.
ALTER TABLE profiles DROP COLUMN role;

COMMIT;

-- ==========================================
-- VERIFICACIÓN
-- ==========================================
-- 1. La columna role ya no existe:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role';
--    -- Esperado: 0 filas
--
-- 2. Los técnicos siguen funcionando:
--    SELECT id, full_name, is_platform_admin FROM profiles
--    WHERE is_platform_admin = true;
--    -- Esperado: mismos usuarios que antes eran 'technician'
--
-- 3. La membresía del usuario técnico NO debe existir (sigue siendo plataforma):
--    SELECT m.user_id FROM company_memberships m
--    JOIN profiles p ON p.id = m.user_id
--    WHERE p.is_platform_admin = true;
--    -- Esperado: 0 filas (los técnicos no tienen membresía)
-- ==========================================
