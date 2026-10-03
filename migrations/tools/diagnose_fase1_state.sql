-- ==========================================
-- DIAGNÓSTICO — Estado actual de Fase 1
-- ==========================================
-- OBJETIVO: Mostrar qué objetos de Fase 1 existen actualmente en la DB.
--           Usar para entender qué se creó y qué no antes de aplicar el rollback.
-- SEGURO: Solo lectura. No modifica nada.
-- ==========================================

-- 1. ¿Existen las 3 tablas nuevas de Fase 1?
SELECT
    'tabla'::text AS tipo,
    t.table_name AS nombre,
    EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = t.table_name
    ) AS existe
FROM (
    VALUES
        ('companies'::text),
        ('company_settings'::text),
        ('tenant_migration_audit'::text)
) AS t(table_name);

-- 2. ¿Qué tablas tienen columna company_id?
SELECT table_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'company_id'
  AND table_name != 'companies'
ORDER BY table_name;

-- 3. ¿Qué FKs de company_id existen?
SELECT conrelid::regclass::text AS tabla, conname, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE contype = 'f' AND conname LIKE 'fk_%_company'
ORDER BY tabla;

-- 4. ¿Qué índices únicos compuestos existen?
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_variants_company_sku',
    'idx_variants_company_barcode',
    'idx_customers_company_email',
    'idx_categories_company_name'
  )
ORDER BY indexname;

-- 5. ¿Qué índices simples de company_id existen?
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public' AND indexname LIKE 'idx_%company%'
ORDER BY indexname;

-- 6. ¿Triggers de Fase 1 existen?
SELECT trigger_name, event_object_table AS tabla
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name IN ('trg_companies_updated_at', 'trg_company_settings_updated_at')
ORDER BY tabla;

-- ==========================================
-- INTERPRETACIÓN DE RESULTADOS
-- ==========================================
-- Si "existe" es true para companies pero false para company_settings:
--   La migración 20261003100100 falló o no se ejecutó.
--   El rollback falló al intentar DROP TRIGGER ON company_settings.
--   ESTÁS AQUÍ — aplicar fix_force_cleanup_fase1.sql
--
-- Si las 3 tablas existen con true:
--   Todas las migraciones forward se aplicaron.
--   El rollback falló por alguna otra razón. Aplicar fix_force_cleanup_fase1.sql.
--
-- Si "existe" es false para las 3:
--   Las tablas ya fueron eliminadas pero quedaron objetos huérfanos.
--   Aplicar fix_force_cleanup_fase1.sql para limpiar índices/triggers sueltos.
-- ==========================================