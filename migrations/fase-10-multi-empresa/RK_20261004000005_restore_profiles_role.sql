-- ==========================================
-- ROLLBACK 20261004000005 - Restaurar profiles.role
-- ==========================================
-- ⚠️ No podemos saber qué valor tenía role para cada profile (no hay
--    tabla de auditoría). Restauramos con 'manager' como default seguro.
--    Los técnicos se identifican por is_platform_admin=true.
-- ==========================================

BEGIN;

ALTER TABLE profiles ADD COLUMN role user_role NOT NULL DEFAULT 'manager';

-- Re-poblar role de técnicos (no se puede hacer default distinto a manager,
-- así que se actualiza después).
UPDATE profiles SET role = 'technician' WHERE is_platform_admin = true;

COMMIT;
