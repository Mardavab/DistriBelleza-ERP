-- ==========================================
-- MIGRACIÓN 20261003200000 - Crear tenant Distribelleza + settings iniciales
-- Fase 2 - Backfill (multi-tenant)
-- ==========================================
-- OBJETIVO: Crear el primer tenant (Distribelleza) con id UUID fijo para
--           que el backfill sea determinístico y reproducible.
--           Sembrar company_settings con los valores hardcoded que ya
--           existían en el código (comisión, branding).
-- IDEMPOTENTE: Sí. Usa ON CONFLICT DO NOTHING.
-- ==========================================
-- UUID Fijo: 11111111-1111-1111-1111-111111111111
--   - Determinístico: cualquier re-ejecución usa el mismo id.
--   - Distinguible: los siguientes tenants usarán gen_random_uuid().
--   - Fácil de reconocer en queries: empieza con "11111111".
-- ==========================================

BEGIN;

-- Tenant Distribelleza
INSERT INTO companies (id, slug, legal_name, trade_name, tax_id, currency, timezone)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    'distribelleza',
    'Distribelleza S.A.S.',
    'DistriBelleza',
    'PENDIENTE',
    'COP',
    'America/Bogota'
)
ON CONFLICT (slug) DO NOTHING;

-- Settings iniciales (replican los valores hardcoded del código actual)
INSERT INTO company_settings (company_id, key, value)
VALUES
    -- Comisión diaria (antes hardcodeada en cash_actions.ts:142 y reports.ts:142)
    ('11111111-1111-1111-1111-111111111111', 'commission_threshold', '1800000'::jsonb),
    -- Tasa de comisión (antes hardcodeada en cash_actions.ts:143 y reports.ts:143)
    ('11111111-1111-1111-1111-111111111111', 'commission_rate', '0.012'::jsonb),
    -- Opciones para "A nombre de quién" en proveedores.
    -- Defaults actuales de Distribelleza (Norby y Marlon son los socios).
    -- Otros tenants pueden modificar estas opciones desde
    -- company_settings o desde un panel de admin (futuro).
    ('11111111-1111-1111-1111-111111111111', 'default_customer_options',
     '["Norby", "Marlon", "Otros"]'::jsonb),
    -- Encabezado del recibo (antes hardcodeado en print-service/printer.js:66)
    ('11111111-1111-1111-1111-111111111111', 'receipt_header',
     '"DISTRIBELLEZA\nProductos de Belleza"'::jsonb),
    -- Pie del recibo
    ('11111111-1111-1111-1111-111111111111', 'receipt_footer',
     '"Gracias por su compra"'::jsonb),
    -- Encabezado PDF (antes hardcodeado en ReportsView.tsx:73 y SuppliersView.tsx:517)
    ('11111111-1111-1111-1111-111111111111', 'pdf_header_text',
     '"DISTRIBELLEZA"'::jsonb),
    -- Pie PDF (antes hardcodeado en ReportsView.tsx:164 y SuppliersView.tsx:634)
    ('11111111-1111-1111-1111-111111111111', 'pdf_footer_text',
     '"DistriBelleza ERP - Reporte generado automáticamente."'::jsonb)
ON CONFLICT (company_id, key) DO NOTHING;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- Debe devolver 1 fila para companies y 7 filas para company_settings:
--
-- SELECT slug, legal_name, trade_name FROM companies;
-- SELECT key, value FROM company_settings
-- WHERE company_id = '11111111-1111-1111-1111-111111111111';
-- ==========================================