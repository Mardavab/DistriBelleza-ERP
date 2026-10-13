-- ==========================================
-- MIGRACIÓN 20261101000007 - Eliminar branch_stock
-- Fase 11 - Multi-sucursal (Bloque D - reversión parcial)
-- ==========================================
-- OBJETIVO:
--   El usuario decidió que las sucursales COMPARTEN inventario (no
--   tienen stock propio). Por tanto, la tabla `branch_stock` deja de
--   tener sentido: `product_variants.stock` vuelve a ser la fuente de
--   verdad del stock de la empresa, accesible desde cualquier sucursal.
--
--   Decisión de modelo:
--     - Catálogo compartido por empresa (products / variants / customers /
--       suppliers / categories) — sin cambios.
--     - Stock compartido por empresa (`product_variants.stock`) — fuente
--       de verdad ÚNICA; las sucursales NO tienen stock propio.
--     - Ventas y movimientos siguen por sucursal (`sales`, `sale_items`,
--       `inventory_movements`, `cash_sessions`, etc. con `branch_id`
--       NOT NULL) — los reportes y la caja siguen siendo por sucursal.
--
--   Lo que esta migración hace:
--     - DROP TABLE branch_stock (con CASCADE para arrastrar policies y FK).
--     - DROP explícito de las policies que dejó Fase 11.2/11.5
--       (defensa en profundidad; CASCADE ya las arrastra).
--     - DROP del trigger de updated_at (defensa; CASCADE lo arrastra).
--
--   Lo que esta migración NO hace:
--     - NO elimina `branches` ni `branch_memberships`: siguen siendo
--       útiles para asignar personal, caja, reportes y segmentar ventas.
--     - NO elimina `branch_id` de las 10 tablas operativas: las ventas,
--       cajas, gastos, auditorías siguen siendo por sucursal.
--     - NO borra datos históricos de ventas, movimientos ni cajas.
--     - NO toca `product_variants.stock` (los datos de stock siguen
--       intactos; el origen de verdad no cambia de tabla, solo deja de
--       coexistir con un duplicado por sucursal).
--
-- IDEMPOTENTE: Sí. DROP IF EXISTS / DROP POLICY IF EXISTS /
--              DROP TRIGGER IF EXISTS.
--
-- REVERSIBLE: NO directamente. Recrear `branch_stock` requeriría
--             restaurar la tabla + backfill del stock por sucursal +
--             policies. Si en el futuro se quiere volver al modelo
--             con stock por sucursal, escribir una nueva migración
--             2026XXXXXXXXXX_recreate_branch_stock.sql (no incluida).
--
-- PREREQUISITOS:
--   1. Migración 20261101000004 modificada para operar sobre
--      `product_variants.stock` (no `branch_stock`).
--   2. Código TS refactorizado para usar `product_variants.stock`.
--
-- ORDEN DE APLICACIÓN (Bloque D):
--   1. 20261101000000_create_branches.sql
--   2. 20261101000001_branch_memberships.sql
--   3. 20261101000002_create_branch_stock.sql
--   4. 20261101000003_add_branch_id_to_tables.sql
--   5. 20261101000004_tenant_rpc_with_branch.sql  (versión stock compartido)
--   6. 20261101000005_rls_with_branches.sql
--   7. 20261101000007_remove_branch_stock.sql     ← ESTE
-- ==========================================

BEGIN;

-- ============================================================
-- PASO 1: eliminar policies de Fase 11.2 y 11.5.
-- ============================================================
-- Las dropeamos explícitamente para tener un log claro, aunque el
-- DROP TABLE ... CASCADE del paso 3 las arrastraría igualmente.
-- Esto preserva la simetría con RK_20261101000002_drop_branch_stock.sql.
-- ============================================================

DROP POLICY IF EXISTS "membership_select_branch_stock" ON branch_stock;
DROP POLICY IF EXISTS "membership_insert_branch_stock" ON branch_stock;
DROP POLICY IF EXISTS "membership_update_branch_stock" ON branch_stock;
DROP POLICY IF EXISTS "membership_delete_branch_stock" ON branch_stock;

-- ============================================================
-- PASO 2: eliminar trigger de updated_at.
-- ============================================================
-- Idem: CASCADE lo arrastra, pero lo dropeamos por defensa y simetría.
-- ============================================================

DROP TRIGGER IF EXISTS trg_branch_stock_updated_at ON branch_stock;

-- ============================================================
-- PASO 3: DROP TABLE branch_stock.
-- ============================================================
-- CASCADE arrastra:
--   - Policies que aún pudieran quedar (no debería, tras paso 1).
--   - Foreign keys desde otras tablas (no las hay en este modelo:
--     nadie referencia branch_stock).
--   - Índices asociados.
-- ============================================================

DROP TABLE IF EXISTS branch_stock CASCADE;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- 1. La tabla no existe:
--
--    SELECT to_regclass('public.branch_stock');
--    -- Esperado: NULL
--
-- 2. Las policies tampoco existen:
--
--    SELECT COUNT(*) FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'branch_stock';
--    -- Esperado: 0
--
-- 3. product_variants.stock sigue intacto (la fuente de verdad):
--
--    SELECT COUNT(*) FROM product_variants WHERE stock IS NOT NULL;
--    -- Esperado: igual al conteo de antes de esta migración.
--
-- 4. Smoke test: una venta de prueba descuenta de product_variants.stock
--    (no de branch_stock, que ya no existe):
--
--    -- Antes
--    SELECT stock FROM product_variants WHERE id = '<variant_id>';
--
--    -- Venta
--    SELECT tenant_process_sale(
--        '<company_id>', '<branch_id>', NULL,
--        '[{"variant_id":"<variant_id>","quantity":1,"expected_updated_at":"2026-01-01T00:00:00Z","discount":0}]'::jsonb,
--        'CASH'::payment_method, NULL, 0
--    );
--
--    -- Después
--    SELECT stock FROM product_variants WHERE id = '<variant_id>';
--    -- Debe haber bajado en 1.
-- ==========================================