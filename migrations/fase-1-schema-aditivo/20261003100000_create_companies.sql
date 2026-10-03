-- ==========================================
-- MIGRACIÓN 20261003100000 - Crear tabla companies
-- Fase 1 - Schema aditivo (multi-tenant)
-- ==========================================
-- OBJETIVO: Crear la tabla maestra de tenants.
--           Esta tabla NO existía en el schema pre-multi-tenant.
-- REVERSIBLE: Sí. Ver migrations/RK_20261003100000_drop_companies.sql
-- IDEMPOTENTE: Sí. Usa IF NOT EXISTS.
-- ==========================================

BEGIN;

CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(50) UNIQUE NOT NULL,
    legal_name VARCHAR(200) NOT NULL,
    trade_name VARCHAR(200),
    tax_id VARCHAR(50),
    address TEXT,
    phone VARCHAR(50),
    email VARCHAR(200),
    logo_url TEXT,
    currency VARCHAR(10) DEFAULT 'COP',
    timezone VARCHAR(50) DEFAULT 'America/Bogota',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trigger de updated_at (la función ya existe en el schema, creada por schema.sql:18)
DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
CREATE TRIGGER trg_companies_updated_at
    BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Índice por slug (para lookups rápidos en login)
CREATE INDEX IF NOT EXISTS idx_companies_slug ON companies(slug);

-- Índice por active (para filtrar empresas activas)
CREATE INDEX IF NOT EXISTS idx_companies_active ON companies(active) WHERE active = true;

-- Comentarios descriptivos para el equipo
COMMENT ON TABLE companies IS
    'Tabla maestra de tenants (empresas). Cada tenant tiene su propio conjunto de productos, ventas, clientes, etc. La segmentación se hace vía RLS por company_id.';
COMMENT ON COLUMN companies.slug IS
    'Identificador URL-safe único (ej: distribelleza, empresa-b). Usado en URLs y como identificador legible.';
COMMENT ON COLUMN companies.currency IS
    'Código ISO 4217 (COP, USD, MXN, etc.). Default COP.';
COMMENT ON COLUMN companies.timezone IS
    'Zona horaria IANA (America/Bogota, America/Mexico_City, etc.).';

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- SELECT table_name, column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'companies'
-- ORDER BY ordinal_position;
--
-- Debe mostrar 14 columnas:
--   id, slug, legal_name, trade_name, tax_id, address, phone,
--   email, logo_url, currency, timezone, active, created_at, updated_at
-- ==========================================