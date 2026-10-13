-- ==========================================
-- MIGRACIÓN 20261004000008 - Sincronizar app_metadata.role para platform admins
-- Fase 10.8 - Multi-empresa por usuario
-- ==========================================
-- OBJETIVO: Asegurar que los platform admins (técnicos) tengan
--           `app_metadata.role = 'technician'` en su JWT.
--
--           El middleware (`middleware.ts:53`) detecta técnicos por
--           `user.app_metadata?.role === 'technician'` para permitirles
--           navegar a `/` sin company_id. Sin este claim, el middleware
--           los redirige a `/no-tenant`, que a su vez los redirige a `/`,
--           generando un redirect loop infinito.
--
--           Por otra parte, `lib/supabase/auth-helpers.ts → requireAuthContext`
--           y `app/actions/auth.ts → login` ahora detectan técnicos por
--           `profiles.is_platform_admin = true` (no por app_metadata.role).
--           Los platform admins existentes (creados antes de Fase 10) ya
--           tienen `is_platform_admin = true` tras 10.4, pero su JWT no
--           lleva el claim `role: 'technician'`. Esta migración cierra esa
--           desincronización.
--
-- PREREQUISITOS:
--   1. 20261004000004 (agregar is_platform_admin). Puede ejecutarse en cualquier
--      momento posterior a 10.4 (no depende de 10.6/10.7/10.5).
--
-- IDEMPOTENTE: Sí. La condición `IS DISTINCT FROM 'technician'` evita
--              reescribir si el valor ya es correcto. Re-ejecuciones son no-op.
--
-- REVERSIBLE: Sí, vía RK_20261004000008_remove_tech_role.sql — pero ese rollback
--             BORRA el claim 'role' para los platform admins (incluso si tenía
--             otro valor pre-existente). Solo seguro si los platform admins
--             originalmente tenían role='technician'.
--
-- ORDEN DE APLICACIÓN (actualizado):
--   10.0 → 10.1 → 10.2 → 10.4 → 10.6 → 10.8 → 10.7 → 10.5
--   10.8 puede aplicarse en cualquier momento tras 10.4.
-- ==========================================

BEGIN;

-- Solo afecta platform admins. La subquery a profiles es eficiente
-- (PK lookup por id).
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || '{"role":"technician"}'::jsonb
WHERE id IN (SELECT id FROM public.profiles WHERE is_platform_admin = true)
  AND (raw_app_meta_data ->> 'role') IS DISTINCT FROM 'technician';

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- 1. Todos los platform admins deben tener role='technician' en su app_metadata:
--    SELECT u.id, u.email, u.raw_app_meta_data->>'role' AS app_role,
--           p.is_platform_admin
--    FROM auth.users u
--    JOIN profiles p ON p.id = u.id
--    WHERE p.is_platform_admin = true;
--    -- Esperado: app_role = 'technician' en todas las filas.
--
-- 2. Smoke test crítico (resolver el redirect loop):
--    - Login como técnico (is_platform_admin=true).
--    - El JWT debe contener app_metadata.role = 'technician'.
--    - El middleware debe permitir acceso a / sin redirigir a /no-tenant.
--    - Cargar el dashboard de plataforma (/) sin loop.
--
-- 3. Verificar que usuarios NO-platform-admin no fueron tocados:
--    SELECT COUNT(*) FROM auth.users
--    WHERE (raw_app_meta_data ->> 'role') = 'technician'
--      AND id NOT IN (SELECT id FROM profiles WHERE is_platform_admin = true);
--    -- Esperado: 0 (o solo los técnicos legados si los hubiera, que deberían
--    -- haber sido back-filleados a is_platform_admin=true en 10.4).
-- ==========================================