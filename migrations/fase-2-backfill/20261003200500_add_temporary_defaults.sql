-- ==========================================
-- MIGRACIÓN 20261003200500 - DEFAULT temporal para company_id
-- ==========================================
-- ⚠️ TEMPORAL — SOLO PARA DESBLOQUEAR LA OPERACIÓN
-- ==========================================
-- OBJETIVO: Permitir que la app siga funcionando mientras se implementa
--           Fase 4 (auth multi-tenant). Cada INSERT que no pase
--           company_id explícitamente, usará Distribelleza como default.
-- IDEMPOTENTE: Sí. SET DEFAULT es idempotente.
-- ==========================================
-- ⚠️ ADVERTENCIAS IMPORTANTES:
--   - NO usar este archivo en producción multi-tenant con >1 empresa.
--   - El DEFAULT apunta fijo a Distribelleza. Cualquier INSERT desde
--     código va a apuntar a Distribelleza sin saber qué.
--   - Este DEFAULT debe ser ELIMINADO en Fase 4 cuando se use
--     requireAuthContext() en las actions.
-- ==========================================

BEGIN;

ALTER TABLE products              ALTER COLUMN company_id SET DEFAULT '11111111-1111-1111-1111-111111111111';
ALTER TABLE product_variants      ALTER COLUMN company_id SET DEFAULT '11111111-1111-1111-1111-111111111111';
ALTER TABLE customers             ALTER COLUMN company_id SET DEFAULT '11111111-1111-1111-1111-111111111111';
ALTER TABLE sales                 ALTER COLUMN company_id SET DEFAULT '11111111-1111-1111-1111-111111111111';
ALTER TABLE sale_items            ALTER COLUMN company_id SET DEFAULT '11111111-1111-1111-1111-111111111111';
ALTER TABLE customer_payments     ALTER COLUMN company_id SET DEFAULT '11111111-1111-1111-1111-111111111111';
ALTER TABLE cash_sessions         ALTER COLUMN company_id SET DEFAULT '11111111-1111-1111-1111-111111111111';
ALTER TABLE expenses              ALTER COLUMN company_id SET DEFAULT '11111111-1111-1111-1111-111111111111';
ALTER TABLE supplier_payments     ALTER COLUMN company_id SET DEFAULT '11111111-1111-1111-1111-111111111111';
ALTER TABLE major_expenses        ALTER COLUMN company_id SET DEFAULT '11111111-1111-1111-1111-111111111111';
ALTER TABLE inventory_movements   ALTER COLUMN company_id SET DEFAULT '11111111-1111-1111-1111-111111111111';
ALTER TABLE audit_logs            ALTER COLUMN company_id SET DEFAULT '11111111-1111-1111-1111-111111111111';
ALTER TABLE suppliers             ALTER COLUMN company_id SET DEFAULT '11111111-1111-1111-1111-111111111111';
ALTER TABLE supplier_invoices     ALTER COLUMN company_id SET DEFAULT '11111111-1111-1111-1111-111111111111';
ALTER TABLE profiles              ALTER COLUMN company_id SET DEFAULT '11111111-1111-1111-1111-111111111111';

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- Debe devolver 15 filas, todas con column_default conteniendo '11111111':
--
-- SELECT table_name, column_name, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND column_name = 'company_id'
--   AND table_name != 'companies'
-- ORDER BY table_name;
-- ==========================================

-- ==========================================
-- CÓMO ELIMINAR ESTE DEFAULT (en Fase 4)
-- ==========================================
-- ALTER TABLE products              ALTER COLUMN company_id DROP DEFAULT;
-- ALTER TABLE product_variants      ALTER COLUMN company_id DROP DEFAULT;
-- ALTER TABLE customers             ALTER COLUMN company_id DROP DEFAULT;
-- ALTER TABLE sales                 ALTER COLUMN company_id DROP DEFAULT;
-- ALTER TABLE sale_items            ALTER COLUMN company_id DROP DEFAULT;
-- ALTER TABLE customer_payments     ALTER COLUMN company_id DROP DEFAULT;
-- ALTER TABLE cash_sessions         ALTER COLUMN company_id DROP DEFAULT;
-- ALTER TABLE expenses              ALTER COLUMN company_id DROP DEFAULT;
-- ALTER TABLE supplier_payments     ALTER COLUMN company_id DROP DEFAULT;
-- ALTER TABLE major_expenses        ALTER COLUMN company_id DROP DEFAULT;
-- ALTER TABLE inventory_movements   ALTER COLUMN company_id DROP DEFAULT;
-- ALTER TABLE audit_logs            ALTER COLUMN company_id DROP DEFAULT;
-- ALTER TABLE suppliers             ALTER COLUMN company_id DROP DEFAULT;
-- ALTER TABLE supplier_invoices     ALTER COLUMN company_id DROP DEFAULT;
-- ALTER TABLE profiles              ALTER COLUMN company_id DROP DEFAULT;
-- ==========================================