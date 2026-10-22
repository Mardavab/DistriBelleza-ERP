-- ============================================================
-- ROLLBACK RK_20261022000000_restore_legacy_table_grants.sql (Fase 18)
-- ============================================================
-- Revierte 20261022000000_restrict_legacy_table_grants.sql restaurando los
-- grants permisivos que tenían `categories`, `invitations` y
-- `tenant_migration_audit`:
--
--     {postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm,
--      service_role=arwdDxtm}
--
-- ⚠️  ADVERTENCIA — ESTE ROLLBACK VUELVE A LA TRAMPA SILENCIOSA.
--
-- Con RLS habilitado y 0 policies, esas tablas siguen estando CERRADAS para
-- `anon`/`authenticated`: un SELECT devuelve 0 filas y un INSERT falla por RLS.
-- Lo que cambia es que el GRANT vuelve a conceder permisos que RLS no cumple,
-- con lo que un `SELECT` con cliente de usuario devuelve [] en vez de un error
-- de permisos. Es el escenario en el que un desarrollador pierde un día
-- buscando por qué la lista está vacía.
--
-- Es un "volver exactamente a como estaba" para comparar comportamientos, no un
-- estado operativo. Preferir volver a aplicar la Fase 18.
--
-- No se toca RLS: sigue habilitado en ambos sentidos.
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON public.categories TO PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON public.invitations TO PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON public.tenant_migration_audit TO PUBLIC, anon, authenticated;
