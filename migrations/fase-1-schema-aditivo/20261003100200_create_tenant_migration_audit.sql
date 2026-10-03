-- ==========================================
-- MIGRACIÓN 20261003100200 - Crear tabla tenant_migration_audit
-- Fase 1 - Schema aditivo (multi-tenant)
-- ==========================================
-- OBJETIVO: Tabla inmutable para auditar qué fila fue migrada a qué tenant.
--           Permite reconstruir el mapeo legacy → tenant para forense.
-- REVERSIBLE: Sí. Ver migrations/RK_20261003100000_drop_companies.sql
-- IDEMPOTENTE: Sí. Usa IF NOT EXISTS.
-- ==========================================

BEGIN;

CREATE TABLE IF NOT EXISTS tenant_migration_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(100) NOT NULL,
    row_id UUID,
    old_value JSONB,
    new_value JSONB,
    migrated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    notes TEXT
);

-- Índices para búsquedas eficientes
CREATE INDEX IF NOT EXISTS idx_tma_table_name ON tenant_migration_audit(table_name);
CREATE INDEX IF NOT EXISTS idx_tma_table_row ON tenant_migration_audit(table_name, row_id);
CREATE INDEX IF NOT EXISTS idx_tma_migrated_at ON tenant_migration_audit(migrated_at);

-- Comentarios
COMMENT ON TABLE tenant_migration_audit IS
    'Auditoría inmutable del backfill de company_id. Permite rastrear qué fila quedó asignada a qué tenant durante la migración multi-tenant.';
COMMENT ON COLUMN tenant_migration_audit.table_name IS
    'Nombre de la tabla origen (ej: products, sales, customers).';
COMMENT ON COLUMN tenant_migration_audit.row_id IS
    'ID de la fila migrada (puede ser NULL en backfills masivos donde no se registra cada fila individualmente).';
COMMENT ON COLUMN tenant_migration_audit.old_value IS
    'Valor antes de la migración (ej: {company_id: null}).';
COMMENT ON COLUMN tenant_migration_audit.new_value IS
    'Valor después de la migración (ej: {company_id: 11111111-1111-1111-1111-111111111111}).';
COMMENT ON COLUMN tenant_migration_audit.notes IS
    'Contexto adicional (ej: "Backfill masivo Fase 2", "Asignación manual para usuario X").';

COMMIT;