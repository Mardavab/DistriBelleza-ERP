-- ==========================================
-- ROLLBACK 20261004000007 - Restaurar trigger handle_new_user original
-- Fase 10.7 - Multi-empresa por usuario
-- ==========================================
-- OBJETIVO: Restaurar la versión de `handle_new_user` que incluye la
--           columna `role` (versión de `fase-3-rpc/20261003300200`).
--
--           Este rollback es necesario si se decide revertir la decisión
--           de dropear `profiles.role` (10.5) o si se necesita reordenar
--           la aplicación de 10.7 / 10.5.
--
-- ⚠️  Solo ejecutar si `profiles.role` SIGUE EXISTIENDO.
--
--     Si ya se ejecutó 10.5 (DROP COLUMN role), este rollback fallará
--     con "column 'role' does not exist". En ese caso:
--       1) Ejecutar primero `RK_20261004000005_restore_profiles_role.sql`.
--       2) Luego ejecutar este archivo.
--
-- IDEMPOTENTE: Sí (CREATE OR REPLACE).
-- ==========================================

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_company_id UUID;
BEGIN
    v_company_id := (NEW.raw_app_meta_data ->> 'company_id')::UUID;

    -- Fallback al tenant por defecto para usuarios legacy
    IF v_company_id IS NULL THEN
        v_company_id := '11111111-1111-1111-1111-111111111111';
    END IF;

    INSERT INTO public.profiles (id, full_name, role, company_id)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', 'Nuevo Usuario'),
        COALESCE((NEW.raw_app_meta_data ->> 'role')::user_role, 'manager'::user_role),
        v_company_id
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

COMMIT;