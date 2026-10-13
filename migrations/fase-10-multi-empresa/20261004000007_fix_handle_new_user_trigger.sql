-- ==========================================
-- MIGRACIÓN 20261004000007 - Arreglar trigger handle_new_user
-- Fase 10.7 - Multi-empresa por usuario
-- ==========================================
-- OBJETIVO: Actualizar la función `public.handle_new_user()` para que NO
--           haga INSERT con la columna `profiles.role`, que se elimina en
--           10.5 (DROP COLUMN role).
--
--           El trigger original (`fase-3-rpc/20261003300200`) hace:
--             INSERT INTO profiles (id, full_name, role, company_id)
--           Tras 10.5, ese INSERT falla con
--           "column 'role' of relation 'profiles' does not exist"
--           para CUALQUIER nuevo registro de usuario, incluyendo el flujo
--           de invitación (`acceptInvitationAction`). 100% de los nuevos
--           registros quedan bloqueados.
--
--           Esta migración reescribe la función del trigger al esquema
--           post-10.5 (sin `role`) y re-aplica el trigger. El orden de
--           aplicación recomendado es:
--
--             10.0 → 10.1 → 10.2 → 10.4 → 10.6 → 10.8 → 10.7 → 10.5
--
--           Es decir, ESTA migración corre ANTES de 10.5. Cuando 10.5
--           ejecute `ALTER TABLE profiles DROP COLUMN role`, la función
--           ya no la referencia y el trigger sigue funcionando.
--
-- IDEMPOTENTE: Sí. CREATE OR REPLACE FUNCTION reemplaza el cuerpo.
-- REVERSIBLE: Sí, vía RK_20261004000007_restore_handle_new_user_trigger.sql.
-- ==========================================

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, company_id)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
        -- company_id: del JWT app_metadata (inyectado por flujo de invitación)
        -- o fallback a Distribelleza para usuarios legacy / signup directo.
        COALESCE((NEW.raw_app_meta_data ->> 'company_id')::UUID, '11111111-1111-1111-1111-111111111111')
    );
    RETURN NEW;
END;
$$;

-- Re-aplicar el trigger (CREATE OR REPLACE ya lo conserva, pero lo hacemos
-- explícito para mantener la simetría con la migración fase-3-rpc/...).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- 1. La función ya no debe referenciar 'role':
--    SELECT prosrc FROM pg_proc WHERE proname = 'handle_new_user';
--    -- No debe contener "INSERT INTO public.profiles (id, full_name, role,"
--
-- 2. El trigger debe seguir activo:
--    SELECT trigger_name, event_manipulation, action_timing
--    FROM information_schema.triggers
--    WHERE trigger_name = 'on_auth_user_created';
--    -- Esperado: 1 fila (INSERT, AFTER).
--
-- 3. Smoke test (recomendado antes de ejecutar 10.5):
--    - Crear usuario de prueba con supabaseAdmin.auth.admin.createUser.
--    - SELECT * FROM profiles WHERE id = NEW.id → debe devolver 1 fila
--      con full_name y company_id correctos (sin columna role).
--    - Si esto funciona, ya se puede ejecutar 20261004000005 sin riesgo.
-- ==========================================