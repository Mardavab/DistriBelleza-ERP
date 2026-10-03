-- ==========================================
-- FIX — Asignar company_id a profiles legacy
-- ==========================================
-- OBJETIVO: Los usuarios que existían antes del trigger actualizado
--           (Fase 3) tienen profiles.company_id = NULL. Asignarles
--           Distribelleza como tenant.
-- IDEMPOTENTE: Sí. Usa WHERE company_id IS NULL.
-- ==========================================

BEGIN;

UPDATE profiles
SET company_id = '11111111-1111-1111-1111-111111111111'
WHERE company_id IS NULL;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- Debe devolver 0 filas (todos los profiles con tenant asignado):
--
-- SELECT id, full_name, role
-- FROM profiles
-- WHERE company_id IS NULL;
--
-- Si devuelve filas: re-ejecutar este script.
-- ==========================================