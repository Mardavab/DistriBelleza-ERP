-- ==========================================
-- MIGRACIÓN 20261004000002 - Quitar NOT NULL a profiles.company_id
-- Fase 10.1 - Multi-empresa por usuario
-- ==========================================
-- OBJETIVO: Permitir que un mismo `auth.users` pertenezca a varias empresas.
--           `company_id` en `profiles` pasa de NOT NULL a NULL; la fuente de
--           verdad para la membresía del usuario será `company_memberships`.
--
-- TOLERANTE: Sí. Si `company_memberships` aún no existe (porque 0000/0001
--            no se han corrido), salta el UPDATE de defaults y solo hace
--            el ALTER TABLE. La membresía por defecto se asignará después
--            cuando se corra 0001.
--
-- IDEMPOTENTE: Sí. ALTER TABLE ... DROP NOT NULL es idempotente en PG.
-- REVERSIBLE: Sí. ALTER TABLE ... SET NOT NULL requiere que no haya NULLs
--             (rollback debe limpiar NULLs primero).
-- ==========================================

BEGIN;

-- 1. Antes de quitar NOT NULL, marcar la membresía por defecto en
--    `company_memberships` (idempotente: solo afecta filas sin default).
--    Esto preserva la "membresía actual" de cada usuario antes del cambio.
--    Se salta si la tabla no existe aún (será creada por 0000/0001).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'company_memberships'
    ) THEN
        UPDATE company_memberships m
        SET is_default = true
        FROM profiles p
        WHERE m.user_id = p.id
          AND m.company_id = p.company_id
          AND p.company_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM company_memberships m2
            WHERE m2.user_id = m.user_id AND m2.is_default = true
          );

        RAISE NOTICE 'Defaults marcados en company_memberships.';
    ELSE
        RAISE NOTICE 'company_memberships aún no existe; el UPDATE de defaults se hará en 20261004000001.';
    END IF;
END $$;

-- 2. Quitar NOT NULL en profiles.company_id.
--    Después de este cambio, un usuario puede existir en profiles sin
--    empresa asignada (caso normal: pertenece solo a memberships).
ALTER TABLE profiles ALTER COLUMN company_id DROP NOT NULL;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- 1. La columna debe ser nullable:
--    SELECT is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'company_id';
--    -- Esperado: 'YES'
--
-- 2. Si company_memberships ya existe: no debe haber regresión
--    (todos los profiles con company_id NOT NULL deben seguir teniendo
--    su fila correspondiente en memberships):
--    SELECT COUNT(*) FROM profiles p
--    WHERE p.company_id IS NOT NULL
--      AND EXISTS (SELECT 1 FROM information_schema.tables
--                  WHERE table_schema = 'public' AND table_name = 'company_memberships')
--      AND NOT EXISTS (
--        SELECT 1 FROM company_memberships m
--        WHERE m.user_id = p.id AND m.company_id = p.company_id
--      );
--    -- Esperado: 0
-- ==========================================
