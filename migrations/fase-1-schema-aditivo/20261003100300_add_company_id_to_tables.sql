-- ==========================================
-- MIGRACIÓN 20261003100300 - Agregar company_id a tablas per-tenant
-- Fase 1 - Schema aditivo (multi-tenant)
-- ==========================================
-- OBJETIVO: Agregar columna company_id (NULLABLE) a las 15 tablas per-tenant.
--           La columna será rellenada en Fase 2 (backfill) y luego restringida a NOT NULL.
-- REVERSIBLE: Sí. Ver migrations/RK_20261003100000_drop_companies.sql
-- IDEMPOTENTE: Sí. Usa ADD COLUMN IF NOT EXISTS.
-- ==========================================
-- PRINCIPIO RECTOR:
--   - Columna NULLABLE al inicio: ningún query existente se rompe.
--   - Ningún cambio restrictivo en esta fase.
--   - El backfill (Fase 2) ocurre ANTES de pasar a NOT NULL.
-- ==========================================
-- TABLAS INCLUIDAS (15 total):
--   products, product_variants, customers, sale_items, customer_payments,
--   cash_sessions, expenses, supplier_payments, major_expenses,
--   inventory_movements, audit_logs, suppliers, supplier_invoices, profiles,
--   sales
-- ==========================================
-- TABLA EXCLUIDA:
--   categories - Es catálogo global compartible entre empresas (decisión de producto).
--               Si más adelante cada tenant requiere sus propias categorías, se modifica.
-- ==========================================

BEGIN;

-- 1. products
ALTER TABLE products ADD COLUMN IF NOT EXISTS company_id UUID;

-- 2. product_variants
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS company_id UUID;

-- 3. customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_id UUID;

-- 4. sales
ALTER TABLE sales ADD COLUMN IF NOT EXISTS company_id UUID;

-- 5. sale_items
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS company_id UUID;

-- 6. customer_payments
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS company_id UUID;

-- 7. cash_sessions
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS company_id UUID;

-- 8. expenses
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS company_id UUID;

-- 9. supplier_payments
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS company_id UUID;

-- 10. major_expenses
ALTER TABLE major_expenses ADD COLUMN IF NOT EXISTS company_id UUID;

-- 11. inventory_movements
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS company_id UUID;

-- 12. audit_logs
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS company_id UUID;

-- 13. suppliers (definida en scripts/suppliers_migration.sql)
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS company_id UUID;

-- 14. supplier_invoices (definida en scripts/suppliers_migration.sql)
ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS company_id UUID;

-- 15. profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS company_id UUID;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN (OBLIGATORIA)
-- ==========================================
-- Ejecutar esta query y confirmar 15 filas:
--
-- SELECT table_name, column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND column_name = 'company_id'
--   AND table_name != 'companies'
-- ORDER BY table_name;
--
-- Cada fila debe tener:
--   data_type: 'uuid'
--   is_nullable: 'YES'
-- ==========================================

-- ==========================================
-- ÍNDICES PARA PERFORMANCE
-- ==========================================
-- Las queries con filtro WHERE company_id = X serán masivas en multi-tenant.
-- Agregar índices ahora es seguro (las columnas están NULLABLE; los índices
-- incluyen filas con NULL, lo cual es aceptable para Fase 1).

BEGIN;

CREATE INDEX IF NOT EXISTS idx_products_company_id ON products(company_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_company_id ON product_variants(company_id);
CREATE INDEX IF NOT EXISTS idx_customers_company_id ON customers(company_id);
CREATE INDEX IF NOT EXISTS idx_sales_company_id ON sales(company_id);
CREATE INDEX IF NOT EXISTS idx_sales_company_created ON sales(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_items_company_id ON sale_items(company_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_company_id ON customer_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_company_id ON cash_sessions(company_id);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_company_status ON cash_sessions(company_id, status);
CREATE INDEX IF NOT EXISTS idx_expenses_company_id ON expenses(company_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_company_id ON supplier_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_major_expenses_company_id ON major_expenses(company_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_company_id ON inventory_movements(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_id ON audit_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_company_id ON suppliers(company_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_company_id ON supplier_invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_profiles_company_id ON profiles(company_id);

COMMIT;

-- ==========================================
-- NOTAS SOBRE RENDIMIENTO
-- ==========================================
-- idx_sales_company_created: compuesto, optimiza el query más frecuente
--   (reporte diario de ventas: WHERE company_id = X AND created_at >= Z).
--
-- idx_cash_sessions_company_status: optimiza la búsqueda de caja abierta
--   (WHERE company_id = X AND status = 'open'), crítica para multi-tenant
--   porque cada tenant tiene su propia caja.
--
-- Los demás índices simples son preparación para los filtros RLS de Fase 5.
-- ==========================================