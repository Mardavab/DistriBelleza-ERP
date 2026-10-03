-- ==========================================
-- MIGRACIÓN 20261003200200 - Auditoría del backfill
-- Fase 2 - Backfill (multi-tenant)
-- ==========================================
-- OBJETIVO: Registrar el backfill en tenant_migration_audit para tener
--           trazabilidad forense de qué fila fue migrada a qué tenant.
--           Es un registro consolidado (1 fila por tabla), no fila por fila,
--           porque el volumen podría ser alto.
-- IDEMPOTENTE: Sí. Verifica existencia antes de insertar.
-- ==========================================

BEGIN;

INSERT INTO tenant_migration_audit (table_name, old_value, new_value, notes)
SELECT t.table_name,
       jsonb_build_object('company_id', NULL) AS old_value,
       jsonb_build_object('company_id', '11111111-1111-1111-1111-111111111111') AS new_value,
       'Backfill masivo Fase 2 - asignación a tenant Distribelleza' AS notes
FROM (VALUES
    ('products'::text),
    ('product_variants'),
    ('customers'),
    ('sales'),
    ('sale_items'),
    ('customer_payments'),
    ('cash_sessions'),
    ('expenses'),
    ('supplier_payments'),
    ('major_expenses'),
    ('inventory_movements'),
    ('audit_logs'),
    ('suppliers'),
    ('supplier_invoices'),
    ('profiles')
) AS t(table_name)
WHERE NOT EXISTS (
    SELECT 1 FROM tenant_migration_audit tma
    WHERE tma.table_name = t.table_name
      AND tma.notes = 'Backfill masivo Fase 2 - asignación a tenant Distribelleza'
);

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-AUDITORÍA
-- ==========================================
-- Debe devolver 15 filas (1 por tabla migrada):
--
-- SELECT table_name, migrated_at, notes
-- FROM tenant_migration_audit
-- ORDER BY table_name;
-- ==========================================