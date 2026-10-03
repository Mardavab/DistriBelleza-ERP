-- ==========================================
-- MIGRACIÓN 20261003400002 - Inyectar company_id en auth.users.app_metadata
-- ==========================================
-- OBJETIVO: Para usuarios legacy cuyo JWT no tiene company_id en
--           app_metadata, copiar el company_id desde profiles.
--           Después de esto, al hacer sign out / sign in el JWT
--           incluirá company_id.
-- IDEMPOTENTE: Sí. Solo actualiza si NO tiene company_id.
-- ==========================================

BEGIN;

UPDATE auth.users u
SET raw_app_meta_data =
    COALESCE(u.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object(
        'company_id', p.company_id::text,
        'role', p.role::text
    )
FROM profiles p
WHERE u.id = p.id
  AND p.company_id IS NOT NULL
  AND (u.raw_app_meta_data ->> 'company_id') IS NULL;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- Esta query debe devolver 0 filas (todos los usuarios con company_id):
--
-- SELECT u.id, u.email, u.raw_app_meta_data
-- FROM auth.users u
-- JOIN profiles p ON p.id = u.id
-- WHERE p.company_id IS NOT NULL
--   AND (u.raw_app_meta_data ->> 'company_id') IS NULL;
--
-- Si devuelve filas, re-ejecutar el script.
-- ==========================================

-- ==========================================
-- ⚠️ SIGUIENTE PASO OBLIGATORIO
-- ==========================================
-- Después de ejecutar esta migración, CADA usuario afectado debe:
--   1. Cerrar sesión (sign out)
--   2. Volver a iniciar sesión (sign in)
-- Esto regenera el JWT con los nuevos claims de app_metadata.
--
-- El JWT actual NO se actualiza automáticamente; necesita un nuevo sign in.
-- ==========================================