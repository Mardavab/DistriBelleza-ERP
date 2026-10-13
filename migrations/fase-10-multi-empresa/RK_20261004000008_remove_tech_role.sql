-- ==========================================
-- ROLLBACK 20261004000008 - Eliminar app_metadata.role=technician de platform admins
-- Fase 10.8 - Multi-empresa por usuario
-- ==========================================
-- OBJETIVO: Quitar el claim 'role' del app_metadata de los platform admins.
--           Necesario si se decide no usar `app_metadata.role` como
--           señal de técnico (e.g. pasar a detectar platform admins en el
--           middleware por otro mecanismo, o si se quiere que los técnicos
--           NO pasen por el flujo de middleware).
--
-- ⚠️  PELIGRO: este rollback ELIMINA el claim 'role' para TODOS los
--     platform admins. Si algún platform admin tenía app_metadata.role
--     distinto a 'technician' ANTES de 10.8, este rollback BORRARÁ
--     ese valor sin restaurarlo.
--
--     Pre-flight check antes de ejecutar:
--       SELECT id, raw_app_meta_data FROM auth.users
--       WHERE id IN (SELECT id FROM profiles WHERE is_platform_admin = true);
--     Si algún platform admin tiene role distinto a 'technician',
--     revertir manualmente fila por fila.
--
-- IDEMPOTENTE: Sí (solo afecta filas con role='technician').
-- ==========================================

BEGIN;

UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data - 'role'
WHERE id IN (SELECT id FROM public.profiles WHERE is_platform_admin = true)
  AND (raw_app_meta_data ->> 'role') = 'technician';

COMMIT;