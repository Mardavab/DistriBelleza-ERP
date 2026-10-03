-- ==========================================
-- MIGRACIÓN 20261003300200 - Actualizar trigger handle_new_user
-- ==========================================
-- OBJETIVO: handle_new_user ahora crea el perfil con company_id tomado
--           de raw_app_meta_data (inyectado por el flujo de invitación
--           de Fase 4). Fallback a Distribelleza para usuarios legacy.
-- ==========================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_company_id UUID;
BEGIN
    -- Resolver company_id desde app_metadata (inyectado por invitación)
    v_company_id := (NEW.raw_app_meta_data ->> 'company_id')::UUID;

    -- Fallback al tenant por defecto para usuarios legacy
    IF v_company_id IS NULL THEN
        v_company_id := '11111111-1111-1111-1111-111111111111';
    END IF;

    INSERT INTO public.profiles (id, full_name, role, company_id)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', 'Nuevo Usuario'),
        COALESCE((NEW.raw_app_meta_data->>'role')::user_role, 'manager'::user_role),
        v_company_id
    );
    RETURN NEW;
END;
$$;

-- Re-aplicar el trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- El trigger debe existir:
-- SELECT trigger_name FROM information_schema.triggers
-- WHERE trigger_name = 'on_auth_user_created';
--
-- Debe devolver 1 fila.
-- ==========================================