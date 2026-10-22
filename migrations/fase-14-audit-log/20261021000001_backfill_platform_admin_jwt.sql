-- ==========================================
-- MIGRACIÓN 20261021000001 - Backfill app_metadata.is_platform_admin (Fase 14)
-- ==========================================
-- OBJETIVO: denormalizar `profiles.is_platform_admin` dentro de
--           `auth.users.raw_app_meta_data` para TODOS los usuarios.
--
-- POR QUÉ:
--   El middleware enruta por rol leyendo el JWT (sin consultar la BD). Para
--   detectar cuentas de plataforma usaba `app_metadata.role === 'technician'`,
--   patrón que AGENTS.md §5 prohíbe explícitamente porque 'technician' TAMBIÉN
--   es un rol válido de membresía de empresa (ver branch-memberships.ts
--   ALLOWED_ROLES). Eso dejaba saltar la validación de company_id a cualquier
--   miembro con ese rol.
--
--   La migración 10.8 había parcheado esto por el lado equivocado: escribía
--   `role: 'technician'` en el JWT de los platform admins para que el patrón
--   prohibido funcionara. Esta migración cierra el hueco de verdad: el claim
--   pasa a ser `is_platform_admin` (boolean), espejo de profiles.
--
--   El middleware.ts ya lee `app_metadata.is_platform_admin === true`. Sin este
--   backfill, los platform admins existentes se verían como usuarios de empresa
--   y el middleware los redirigiría a /no-tenant.
--
-- ESCOPE:
--   - `is_platform_admin: true` para los que lo tengan en profiles.
--   - `is_platform_admin: false` para el resto (incluye usuarios sin fila en
--     profiles: se asume el valor seguro).
--   - Se preserva el resto de app_metadata (|| jsonb).
--
-- IDEMPOTENTE: Sí. Solo escribe cuando el valor es DISTINTO del esperado.
--
-- REVERSIBLE: Sí, vía RK_20261021000001_remove_platform_admin_claim.sql.
--             Ese rollback deja el middleware sin claim, con lo que los
--             platform admins volverían a caer en /no-tenant. Solo aplicar
--             si también se revierte middleware.ts.
--
-- ORDEN DE APLICACIÓN: aplicar DESPUÉS de 20261021000000 (aunque son
--                      independientes, así se mantiene el orden de la fase).
-- ==========================================

BEGIN;

UPDATE auth.users u
SET raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('is_platform_admin', true)
WHERE EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = u.id AND p.is_platform_admin = true
    )
  AND (u.raw_app_meta_data ->> 'is_platform_admin') IS DISTINCT FROM 'true';

-- OJO: sin COALESCE en la condición. `NULL IS DISTINCT FROM 'false'` es TRUE,
-- así que un usuario SIN el claim se considera pendiente y lo recibe. Con
-- COALESCE(..., 'false') el claim ausente parecía ya correcto y no se escribía.
UPDATE auth.users u
SET raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('is_platform_admin', false)
WHERE NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = u.id AND p.is_platform_admin = true
    )
  AND (u.raw_app_meta_data ->> 'is_platform_admin') IS DISTINCT FROM 'false';

COMMIT;
