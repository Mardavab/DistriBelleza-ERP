-- ==========================================
-- MIGRACIÓN 20261003200400 - Eliminar UNIQUE constraints antiguos
-- Fase 2 - Backfill (multi-tenant)
-- ==========================================
-- OBJETIVO: Eliminar los UNIQUE constraints globales en SKU, barcode, email
--           y name (categorías). Ahora son los índices únicos compuestos
--           (company_id, x) los que aplican.
-- IDEMPOTENTE: Sí. DROP CONSTRAINT IF EXISTS es idempotente.
-- ==========================================
-- ⚠️ IMPORTANTE:
--   Solo ejecutar DESPUÉS de:
--     1. Fase 2.2 (backfill completo verificado)
--     2. Fase 2.3 (SET NOT NULL exitoso)
-- ==========================================

BEGIN;

-- product_variants.sku UNIQUE → ahora idx_variants_company_sku
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_sku_key;

-- product_variants.barcode UNIQUE → ahora idx_variants_company_barcode
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_barcode_key;

-- customers.email UNIQUE → ahora idx_customers_company_email
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_email_key;

-- categories.name UNIQUE → ahora idx_categories_company_name (placeholder)
-- Solo eliminar el UNIQUE antiguo si la columna name NO recibió company_id
-- (que es el caso actual). Si en el futuro categories recibe company_id,
-- el nuevo índice empezará a aplicar.
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-ELIMINACIÓN
-- ==========================================
-- Debe devolver 0 filas (los UNIQUE antiguos ya no existen):
--
-- SELECT conname, conrelid::regclass::text AS tabla
-- FROM pg_constraint
-- WHERE contype = 'u' AND conname IN (
--     'product_variants_sku_key',
--     'product_variants_barcode_key',
--     'customers_email_key',
--     'categories_name_key'
-- )
-- ORDER BY tabla;
--
-- Los índices únicos compuestos deben seguir existiendo:
--   idx_variants_company_sku
--   idx_variants_company_barcode
--   idx_customers_company_email
--   idx_categories_company_name
-- ==========================================
--
-- AHORA dos empresas pueden tener el mismo SKU (ej: "001"), el mismo
-- barcode EAN, o clientes con el mismo email — siempre que sean de
-- distintos company_id.
-- ==========================================