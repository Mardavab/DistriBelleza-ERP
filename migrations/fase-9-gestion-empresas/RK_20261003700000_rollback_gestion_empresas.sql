-- ==========================================
-- ROLLBACK 20261003700000 - Gestión de empresas
-- Fase 9 - Consola de plataforma
-- ==========================================
-- REVIERTE: las columnas de desactivación y su índice/constraint.
--
-- ⚠️ SOBRE EL BACKFILL DE `role`:
--   Esta migración NO lo revierte, y no por descuido.
--
--   La intentamos revertir solo para "cuentas de plataforma" usando
--   `profiles.company_id IS NULL`, pero eso ya no identifica a nadie: la fase
--   2.5 (20261003200300) puso `profiles.company_id` en NOT NULL, así que
--   TODOS los perfiles —incluido el técnico— tienen empresa asignada.
--
--   Por tanto no hay forma de distinguir, tras la ejecución, qué usuarios
--   recibieron el claim en esta fase y cuáles lo tenían desde 20261003400002.
--   Un revert "de todos" borraría el claim a los usuarios de empresa y los
--   dejaría sin poder entrar; un revert selectivo es imposible.
--
--   DECISIÓN: se deja el claim `role` intacto. Es inocuo —solo espeja
--   `profiles.role`, que es la fuente de verdad— y además se reinyecta en
--   cada login. Si aún así se necesita limpiarlo por completo:
--
--     UPDATE auth.users SET raw_app_meta_data =
--         raw_app_meta_data - 'role'
--     WHERE raw_app_meta_data ? 'role';
--
--   Ojo: Doing esto deja a las cuentas de plataforma y de empresa sin claim
--   `role` hasta su próximo login, y el middleware manda a /no-tenant a quien
--   no lo tenga.
-- ==========================================

BEGIN;

-- 1) Índice primero (depende de companies.deactivated_at).
DROP INDEX IF EXISTS idx_companies_deactivated_at;

-- 2) Constraint y columnas.
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_deactivation_consistency;
ALTER TABLE companies DROP COLUMN IF EXISTS deactivation_reason;
ALTER TABLE companies DROP COLUMN IF EXISTS deactivated_at;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
--
-- 1) Las columnas ya no existen:
--
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'companies'
--      AND column_name IN ('deactivation_reason', 'deactivated_at');
--    -- Debe devolver 0 filas.
--
-- 2) Las empresas conservan su estado `active` original (esta migración
--    nunca lo modificó, solo lo normalizó):
--
--    SELECT active, COUNT(*) FROM companies GROUP BY active;
-- ==========================================