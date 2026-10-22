-- ==========================================
-- ROLLBACK RK_20261021000000_drop_audit_log.sql (Fase 14)
-- ==========================================
-- Revierte 20261021000000_create_audit_log.sql.
--
-- ADVERTENCIA: borra la tabla audit_log y con ella TODO el historial acumulado
--              de acciones. No hay forma de recuperarlo. Si solo se quiere
--              dejar de escribir, basta con desacoplar lib/audit.ts en el
--              código: no hace falta tocar la BD.
--
-- No toca 20261021000001 (backfill de is_platform_admin): ese rollback vive en
-- su propio archivo porque es independiente.
-- ==========================================

BEGIN;

DROP POLICY IF EXISTS "audit_log_membership_select" ON public.audit_log;
DROP TABLE IF EXISTS public.audit_log;

COMMIT;
