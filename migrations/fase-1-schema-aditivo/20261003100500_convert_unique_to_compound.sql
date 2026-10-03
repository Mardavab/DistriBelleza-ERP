-- ==========================================
-- MIGRACIÓN 20261003100500 - Conversión soft de UNIQUE a compuesto
-- Fase 1 - Schema aditivo (multi-tenant)
-- ==========================================
-- OBJETIVO: Crear índices únicos compuestos (company_id, x) SIN eliminar los
--           UNIQUE antiguos. El constraint antiguo sigue activo durante Fase 1.
-- REVERSIBLE: Sí. DROP INDEX IF EXISTS.
-- IDEMPOTENTE: Sí. Usa CREATE UNIQUE INDEX IF NOT EXISTS (sí soportado en PG 9.5+).
-- ==========================================
-- RAZÓN DE LA CONVERSIÓN SOFT:
--   - Las tablas tienen company_id = NULL durante Fase 1.
--   - El constraint UNIQUE antiguo (sku UNIQUE, barcode UNIQUE, email UNIQUE)
--     se mantiene activo porque sigue siendo válido: dos SKUs iguales
--     siguen siendo un error.
--   - El NUEVO índice único compuesto usa WHERE company_id IS NOT NULL para
--     permitir que múltiples filas con company_id=NULL coexistan (no choca
--     con el antiguo constraint porque la nueva restricción los excluye).
--   - En Fase 2, cuando el backfill rellena company_id, este nuevo índice
--     empieza a aplicar realmente.
--   - En Fase 2.6, una vez que TODAS las filas tienen company_id NOT NULL,
--     se eliminan los constraints antiguos.
-- ==========================================

BEGIN;

-- ============================================================
-- product_variants.sku UNIQUE por tenant
-- ============================================================
-- UNIQUE antiguo: sku UNIQUE NOT NULL (definido en schema.sql:75)
-- Nuevo: UNIQUE(company_id, sku) WHERE company_id IS NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_company_sku
    ON product_variants(company_id, sku)
    WHERE company_id IS NOT NULL;

-- ============================================================
-- product_variants.barcode UNIQUE por tenant (donde exista)
-- ============================================================
-- UNIQUE antiguo: barcode UNIQUE (schema.sql:76)
-- Algunos barcodes pueden ser NULL; el índice los excluye.
CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_company_barcode
    ON product_variants(company_id, barcode)
    WHERE company_id IS NOT NULL AND barcode IS NOT NULL;

-- ============================================================
-- customers.email UNIQUE por tenant (donde exista)
-- ============================================================
-- UNIQUE antiguo: email UNIQUE (schema.sql:88)
-- Algunos emails pueden ser NULL; el índice los excluye.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_company_email
    ON customers(company_id, email)
    WHERE company_id IS NOT NULL AND email IS NOT NULL;

-- ============================================================
-- categories.name UNIQUE por tenant (decisión de Fase 6+)
-- ============================================================
-- UNIQUE antiguo: name UNIQUE NOT NULL (schema.sql:52)
-- Esta tabla NO tiene company_id en Fase 1, pero creamos el índice
-- compuesto para cuando se le agregue company_id en una migración futura.
-- Por ahora, este índice tendrá company_id siempre NULL (porque la columna
-- no existe), así que el WHERE company_id IS NOT NULL lo excluye.
-- Es un placeholder para Fase 6+ cuando cada tenant quiera sus categorías.
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_company_name
    ON categories(name)
    WHERE false;  -- Inactivo hasta que categories reciba company_id

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN (OBLIGATORIA)
-- ==========================================
-- Debe devolver 4 índices:
--
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND indexname IN (
--     'idx_variants_company_sku',
--     'idx_variants_company_barcode',
--     'idx_customers_company_email',
--     'idx_categories_company_name'
--   )
-- ORDER BY indexname;
-- ==========================================

-- ==========================================
-- NOTA IMPORTANTE
-- ==========================================
-- En Fase 2.6 se eliminarán los constraints UNIQUE antiguos:
--   - product_variants_sku_key
--   - product_variants_barcode_key
--   - customers_email_key
--   - categories_name_key
--
-- PERO ESTO SOLO SE HARÁ DESPUÉS DE:
--   1. Ejecutar el backfill completo (Fase 2.1-2.4)
--   2. Confirmar que TODAS las filas tienen company_id NOT NULL (Fase 2.4)
--   3. Hacer ALTER COLUMN SET NOT NULL (Fase 2.5)
--
-- Si Fase 2.6 se ejecuta antes de completar 2.5, fallará con:
--   "duplicate key value violates unique constraint"
-- ==========================================