-- ==========================================
-- ROLLBACK RK_20261021000001_remove_platform_admin_claim.sql (Fase 14)
-- ==========================================
-- Revierte 20261021000001_backfill_platform_admin_jwt.sql: quita el claim
-- `is_platform_admin` de app_metadata para todos los usuarios.
--
-- ADVERTENCIA: al quedar el JWT sin claim, el middleware.ts (que ya lee
--              `app_metadata.is_platform_admin`) deja de reconocer a los
--              técnicos de plataforma y los trata como usuarios de empresa:
--              los redirige a /no-tenant o a /. Aplicar SOLO junto con el
--              revert de middleware.ts al patrón anterior.
--
-- No borra `profiles.is_platform_admin`, que es la fuente de verdad y queda
-- intacta. Un nuevo backfill o un login con la app en marcha lo restaura.
-- ==========================================

BEGIN;

UPDATE auth.users u
SET raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::jsonb) - 'is_platform_admin'
WHERE u.raw_app_meta_data ? 'is_platform_admin';

COMMIT;
