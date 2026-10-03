-- ==========================================
-- MIGRACIÓN 20261003300300 - Eliminar wrappers legacy
-- Fase 7 - Cleanup final (multi-tenant)
-- ==========================================
-- OBJETIVO: Eliminar las funciones wrapper retrocompatibles que llaman
--           a tenant_* con Distribelleza hardcoded. El código TypeScript
--           ya llama directamente a tenant_*.
-- IDEMPOTENTE: Sí. DROP FUNCTION IF EXISTS.
-- ==========================================
-- ⚠️ EJECUTAR SOLO DESPUÉS DE:
--   1. Verificar que ningún código TS llama a las funciones legacy.
--   2. Hacer grep en app/ por: process_sale, search_inventory, delete_sale, transfer_stock
--   3. Si hay referencias, migrarlas a tenant_* antes de ejecutar este script.
-- ==========================================

BEGIN;

DROP FUNCTION IF EXISTS process_sale(
    UUID, JSONB, payment_method, transfer_type, DECIMAL
);
DROP FUNCTION IF EXISTS search_inventory(TEXT);
DROP FUNCTION IF EXISTS delete_sale(UUID);
DROP FUNCTION IF EXISTS transfer_stock(UUID, UUID, INTEGER);

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- Esta query debe devolver solo las 4 funciones tenant_*:
--
-- SELECT proname FROM pg_proc
-- WHERE proname IN (
--     'tenant_process_sale', 'process_sale',
--     'tenant_search_inventory', 'search_inventory',
--     'tenant_delete_sale', 'delete_sale',
--     'tenant_transfer_stock', 'transfer_stock'
-- )
-- ORDER BY proname;
-- ==========================================

-- ==========================================
-- CÓMO VERIFICAR QUE NO HAY REFERENCIAS EN TS
-- ==========================================
-- Ejecutar en la raíz del proyecto:
--
--   grep -rn "\.rpc('process_sale'" app/ || echo "OK: no references"
--   grep -rn "\.rpc('search_inventory'" app/ || echo "OK: no references"
--   grep -rn "\.rpc('delete_sale'" app/ || echo "OK: no references"
--   grep -rn "\.rpc('transfer_stock'" app/ || echo "OK: no references"
--
-- Si alguno devuelve líneas, hay que migrar antes de borrar los wrappers.
-- ==========================================