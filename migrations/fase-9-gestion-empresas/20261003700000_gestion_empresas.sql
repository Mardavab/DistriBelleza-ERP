-- ==========================================
-- MIGRACIÓN 20261003700000 - Gestión de empresas (activar/desactivar)
-- Fase 9 - Consola de plataforma
-- ==========================================
-- OBJETIVO:
--   1. Columnas para desactivar empresas de forma reversible, con motivo
--      y fecha (auditoría de por qué una empresa dejó de usarse).
--   2. Inyectar el claim `role` en auth.users.app_metadata para TODOS los
--      usuarios, incluidos los de plataforma.
--
-- POR QUÉ EL BACKFILL DE `role`:
--   La migración 20261003400002 solo inyectó company_id + role a los usuarios
--   que ya existían en el momento de aplicarse. Las cuentas de plataforma
--   creadas después (y cualquier usuario nuevo, ya que el trigger
--   handle_new_user quedó condicionado a `company_id IS NOT NULL`) nunca
--   recibieron el claim `role`, y el middleware lo necesita para no
--   redirigirlas a /no-tenant.
--
--   OJO: el motivo NO es que el técnico "no pertenezca a ninguna empresa".
--   profiles.company_id es NOT NULL desde la fase 2.5, así que sí tiene
--   empresa asignada. Ver la nota detallada al final del archivo.
--
-- REVERSIBLE: Parcialmente. Ver RK_20261003700000_rollback_gestion_empresas.sql
--   (las columnas sí; el claim `role` no se puede revertir selectivamente).
-- IDEMPOTENTE: Sí. ADD COLUMN IF NOT EXISTS + DROP/ADD CONSTRAINT + WHERE.
-- SEGURO: No modifica ni borra datos de negocio.
-- ==========================================

BEGIN;

-- ------------------------------------------------------------
-- 1) Columnas de desactivación
-- ------------------------------------------------------------

-- Motivo por el que se desactivó la empresa (ej: "no renovó plan",
-- "empresa se retiró", "suspendida por impago").
ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS deactivation_reason TEXT;

-- Fecha en que se desactivó. NULL = empresa activa.
ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

-- Constraint de coherencia: `active` y `deactivated_at` son complementarios.
--   activa  -> sin fecha de desactivación
--   inactiva -> con fecha de desactivación
--
-- Se define como XOR explícito para que ninguna de las dos columnas pueda
-- quedar "colgada": una empresa no puede estar activa con fecha de
-- desactivación, ni inactiva sin fecha (que es lo que impide saber cuándo
-- se retiró).
--
-- Se añade NOT VALID para no bloquear escrituras concurrentes; se valida al
-- final de esta misma transacción, ya con los datos normalizados.
ALTER TABLE companies
    DROP CONSTRAINT IF EXISTS companies_deactivation_consistency;

ALTER TABLE companies
    ADD CONSTRAINT companies_deactivation_consistency
    CHECK (
        (active = true  AND deactivated_at IS NULL)
     OR (active = false AND deactivated_at IS NOT NULL)
    ) NOT VALID;

-- ------------------------------------------------------------
-- 2) Normalizar datos existentes
--    Empresas ya inactivas (posibles por ediciones manuales) reciben
--    fecha de desactivación para no violar el constraint.
-- ------------------------------------------------------------

UPDATE companies
SET deactivated_at = COALESCE(deactivated_at, NOW()),
    deactivation_reason = COALESCE(deactivation_reason, 'Desactivada antes de la fase 9')
WHERE active = false
  AND deactivated_at IS NULL;

-- Empresas activas no deben tener fecha de desactivación.
UPDATE companies
SET deactivated_at = NULL
WHERE active = true;

-- Validar el constraint ahora que los datos están consistentes.
ALTER TABLE companies VALIDATE CONSTRAINT companies_deactivation_consistency;

-- ------------------------------------------------------------
-- 3) Índices
-- ------------------------------------------------------------

-- Búsqueda rápida de empresas inactivas (panel del técnico).
CREATE INDEX IF NOT EXISTS idx_companies_deactivated_at
    ON companies(deactivated_at DESC)
    WHERE active = false;

-- ------------------------------------------------------------
-- 4) Backfill del claim `role` para cuentas de plataforma
-- ------------------------------------------------------------

UPDATE auth.users u
SET raw_app_meta_data =
    COALESCE(u.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', p.role::text)
FROM profiles p
WHERE u.id = p.id
  AND (u.raw_app_meta_data ->> 'role') IS DISTINCT FROM p.role::text;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
--
-- 1) Las cuentas de plataforma deben tener el claim 'role':
--
-- SELECT u.email, u.raw_app_meta_data ->> 'role' AS role,
--        u.raw_app_meta_data ->> 'company_id' AS company_id
-- FROM auth.users u
-- JOIN profiles p ON p.id = u.id
-- WHERE p.role = 'technician';
--
-- Debe mostrar role = 'technician'.
--
-- NOTA sobre company_id: perfiles.company_id es NOT NULL desde la fase 2.5,
-- por lo que una cuenta de plataforma SIEMPRE tiene empresa asignada
-- (típicamente el tenant 1111... de Distribelleza). Que tenga company_id
-- NO significa que tenga acceso a los datos de esa empresa: el acceso lo
-- gobierna el rol, y el middleware/las server actions solo conceden acceso
-- a la consola de plataforma cuando role = 'technician'.
--
-- Por eso esta migración es un no-op para el claim company_id y solo agrega
-- el claim 'role' cuando falta.
--
-- 2) Ningún usuario debe tener un role desalineado con profiles:
--
-- SELECT u.email, u.raw_app_meta_data ->> 'role' AS jwt_role, p.role
-- FROM auth.users u JOIN profiles p ON p.id = u.id
-- WHERE (u.raw_app_meta_data ->> 'role') IS DISTINCT FROM p.role::text;
--
-- Debe devolver 0 filas.
--
-- 3) Consistencia del constraint de desactivación:
--
--    SELECT active, COUNT(*) FROM companies GROUP BY active;
--
--    Además, ninguna empresa activa debe tener fecha de desactivación:
--
--    SELECT COUNT(*) FROM companies
--    WHERE active = true AND deactivated_at IS NOT NULL;
--    -- Debe devolver 0.
--
-- ==========================================
-- ⚠️ PASO OBLIGATORIO DESPUÉS DE EJECUTAR
-- ==========================================
-- 1) El claim del JWT NO se actualiza en caliente. Cada cuenta de plataforma
--    debe cerrar sesión y volver a iniciar sesión. Si no lo hace, el
--    middleware no verá el claim `role` y lo redirigirá a /no-tenant
--    (comportamiento seguro por defecto).
--
-- 2) Si ya habías ejecutado una versión anterior de este archivo, VUELVE A
--    EJECUTARLO: el constraint se endureció a XOR (activa ⟺ sin fecha).
--    Es idempotente y normaliza los datos antes de validar, así que no hay
--    riesgo. Alternativa sin re-ejecutar, solo si necesitas el inviolable:
--
--    ALTER TABLE companies
--        DROP CONSTRAINT IF EXISTS companies_deactivation_consistency;
--    ALTER TABLE companies
--        ADD CONSTRAINT companies_deactivation_consistency
--        CHECK ((active = true  AND deactivated_at IS NULL)
--             OR (active = false AND deactivated_at IS NOT NULL)) NOT VALID;
--    ALTER TABLE companies
--        VALIDATE CONSTRAINT companies_deactivation_consistency;
-- ==========================================