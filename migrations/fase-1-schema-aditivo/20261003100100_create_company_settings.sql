-- ==========================================
-- MIGRACIÓN 20261003100100 - Crear tabla company_settings
-- Fase 1 - Schema aditivo (multi-tenant)
-- ==========================================
-- OBJETIVO: Crear tabla de reglas de negocio por tenant (JSONB).
--           Permite personalizar comisión, branding, opciones de dropdown, etc.
-- REVERSIBLE: Sí. Ver migrations/RK_20261003100000_drop_companies.sql
-- IDEMPOTENTE: Sí. Usa IF NOT EXISTS.
-- ==========================================
-- DECISIÓN DE DISEÑO:
-- Se eligió JSONB en lugar de columnas específicas porque:
--   1. Permite añadir nuevas claves sin migraciones DDL adicionales.
--   2. Es trivial de consultar (SELECT value->>'commission_threshold').
--   3. La capa de aplicación proyecta los valores tipados vía lib/company.ts.
-- ==========================================

BEGIN;

CREATE TABLE IF NOT EXISTS company_settings (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    key VARCHAR(100) NOT NULL,
    value JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (company_id, key)
);

-- Trigger de updated_at
DROP TRIGGER IF EXISTS trg_company_settings_updated_at ON company_settings;
CREATE TRIGGER trg_company_settings_updated_at
    BEFORE UPDATE ON company_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Índice para búsquedas por key específica (ej. todos los tenants con comisión custom)
CREATE INDEX IF NOT EXISTS idx_company_settings_key
    ON company_settings(key);

-- Comentarios
COMMENT ON TABLE company_settings IS
    'Reglas de negocio y configuración por tenant. Almacenadas como JSONB para flexibilidad.';
COMMENT ON COLUMN company_settings.key IS
    'Nombre de la configuración (ej: commission_threshold, receipt_header, default_customer_options).';
COMMENT ON COLUMN company_settings.value IS
    'Valor de la configuración en formato JSONB. La capa de aplicación es responsable de tiparlo.';

-- ==========================================
-- CLAVES ESPERADAS AL FINAL DEL ROADMAP
-- ==========================================
-- commission_threshold:    NUMERIC  (meta diaria de ventas en COP)
-- commission_rate:         NUMERIC  (tasa de comisión, ej: 0.012)
-- default_customer_options: ARRAY de strings (reemplaza Norby/Marlon/Otros)
-- receipt_header:          TEXT     (encabezado del recibo)
-- receipt_footer:          TEXT     (pie del recibo)
-- pdf_header_text:         TEXT     (encabezado de reportes PDF)
-- pdf_footer_text:         TEXT     (pie de reportes PDF)
-- ==========================================

COMMIT;