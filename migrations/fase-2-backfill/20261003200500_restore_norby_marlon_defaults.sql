-- ==========================================
-- FIX ONE-OFF — Restaurar Norby/Marlon/Otros como defaults
-- ==========================================
-- OBJETIVO: Actualizar el setting default_customer_options del tenant
--           Distribelleza para que el dropdown muestre "Norby", "Marlon",
--           "Otros" (los socios reales de la empresa).
-- IDEMPOTENTE: Sí. UPDATE simple.
-- ==========================================
-- ⚠️ Solo aplica al tenant Distribelleza (id = 11111111-...).
--    Otros tenants no se ven afectados.
-- ==========================================

BEGIN;

UPDATE company_settings
SET value = '["Norby", "Marlon", "Otros"]'::jsonb,
    updated_at = NOW()
WHERE company_id = '11111111-1111-1111-1111-111111111111'
  AND key = 'default_customer_options';

-- Si la fila no existía, insertarla
INSERT INTO company_settings (company_id, key, value, updated_at)
SELECT
    '11111111-1111-1111-1111-111111111111',
    'default_customer_options',
    '["Norby", "Marlon", "Otros"]'::jsonb,
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM company_settings
    WHERE company_id = '11111111-1111-1111-1111-111111111111'
      AND key = 'default_customer_options'
);

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- Debe devolver ["Norby", "Marlon", "Otros"]:
--
-- SELECT key, value
-- FROM company_settings
-- WHERE company_id = '11111111-1111-1111-1111-111111111111'
--   AND key = 'default_customer_options';
-- ==========================================