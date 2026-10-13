-- ==========================================
-- MIGRACIÓN 20261101000004 - RPC tenant_* parametrizados con branch_id
-- Fase 11 - Multi-sucursal (Bloque C)
-- ==========================================
-- OBJETIVO:
--   Parametrizar las funciones RPC `tenant_*` para que operen dentro
--   del contexto empresa + sucursal. Como las ventas, cajas y
--   movimientos siguen siendo por sucursal, las RPC reciben
--   `p_branch_id` para registrar la operación en la sucursal activa.
--
--   Modelo de stock (Bloque D, revertido parcialmente en 11.7):
--     - Las sucursales COMPARTEN inventario. La fuente de verdad es
--       `product_variants.stock` (stock único por empresa), NO
--       `branch_stock`.
--     - `tenant_process_sale` valida que hay stock global suficiente
--       en `product_variants.stock` y descuenta de ahí.
--     - `tenant_search_inventory` devuelve el stock global de la
--       variante (no hace LEFT JOIN a `branch_stock`).
--     - `tenant_delete_sale` revierte el stock a `product_variants.stock`.
--     - `tenant_transfer_stock` se mantiene entre variantes de la misma
--       empresa (transferencia interna); sigue operando sobre
--       `product_variants.stock`.
--
--   Por qué mantenemos `p_branch_id` aunque el stock sea global:
--     - Las ventas se insertan en `sales` / `sale_items` con branch_id.
--     - Las cajas se validan por sucursal (cash_sessions tiene branch_id).
--     - Los movimientos se registran con branch_id (inventory_movements).
--     - Los reportes siguen siendo por sucursal o consolidados.
--
-- IDEMPOTENTE: Sí. CREATE OR REPLACE FUNCTION.
-- REVERSIBLE: Sí. Ver RK_20261101000004_restore_tenant_rpc_no_branch.sql
--              (rollback puro al modelo pre-11.4 sin `p_branch_id`).
--
-- IMPORTANTE - PREREQUISITOS:
--   1. Bloque B aplicado: branches y branch_memberships existen
--      (NOTA: branch_stock se elimina en 11.7, ya no es prerrequisito).
--   2. branch_id NOT NULL en las 10 tablas operativas.
--   3. El código TS que llama a estos RPC ya pasa p_company_id y
--      p_branch_id.
--
-- ORDEN DE APLICACIÓN (Bloque C):
--   1. 20261101000000_create_branches.sql
--   2. 20261101000001_branch_memberships.sql
--   3. 20261101000002_create_branch_stock.sql
--   4. 20261101000003_add_branch_id_to_tables.sql
--   5. 20261101000004_tenant_rpc_with_branch.sql  ← ESTE
--   6. 20261101000005_rls_with_branches.sql
--   7. 20261101000007_remove_branch_stock.sql
-- ==========================================

BEGIN;

-- ============================================================
-- tenant_process_sale
-- ============================================================
-- Cambios respecto a la versión 11.4 original:
--   - Bloque D: descuenta stock de `product_variants.stock` (NO de
--     `branch_stock`). El stock es compartido por empresa; las
--     sucursales NO tienen stock propio.
--   - La validación de stock es global de la empresa (no por sucursal):
--     si hay suficiente stock en `product_variants.stock`, la venta pasa
--     desde cualquier sucursal.
--   - Mantiene `p_branch_id` porque las ventas, cajas y movimientos
--     siguen siendo por sucursal (sales, sale_items, inventory_movements,
--     cash_sessions).
--   - Validaciones de empresa y sucursal activas se mantienen (defensa
--     en profundidad; la FK ya lo valida).
-- ============================================================

CREATE OR REPLACE FUNCTION tenant_process_sale(
    p_company_id UUID,
    p_branch_id UUID,
    p_customer_id UUID,
    p_items JSONB,
    p_payment_method payment_method,
    p_transfer_type transfer_type DEFAULT NULL,
    p_total_discount DECIMAL DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sale_id UUID;
    v_item RECORD;
    v_current_updated_at TIMESTAMP WITH TIME ZONE;
    v_total_amount DECIMAL(12,2) := 0;
    v_item_discount_total DECIMAL(12,2) := 0;
    v_effective_price DECIMAL(12,2);
    v_product_id UUID;
    v_paid_amount DECIMAL(12,2) := 0;
    v_branch_company_id UUID;
    v_branch_active BOOLEAN;
BEGIN
    -- 1. Validar que la empresa existe y está activa.
    PERFORM 1 FROM companies WHERE id = p_company_id AND active = true;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Empresa no encontrada o inactiva');
    END IF;

    -- 2. Validar que la sucursal pertenece a la empresa y está activa.
    SELECT company_id, active INTO v_branch_company_id, v_branch_active
    FROM branches
    WHERE id = p_branch_id;

    IF v_branch_company_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sucursal no encontrada.');
    END IF;
    IF v_branch_company_id <> p_company_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'La sucursal no pertenece a la empresa.');
    END IF;
    IF NOT v_branch_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'La sucursal está inactiva.');
    END IF;

    -- 3. Validar caja abierta en la SUCURSAL para pago en efectivo.
    IF p_payment_method = 'CASH' AND NOT EXISTS (
        SELECT 1 FROM cash_sessions
        WHERE company_id = p_company_id
          AND branch_id = p_branch_id
          AND status = 'open'
    ) THEN
        RAISE EXCEPTION 'No hay una sesión de caja abierta.';
    END IF;

    -- 4. Crear venta con company_id + branch_id.
    INSERT INTO sales (
        company_id, branch_id, customer_id, status, payment_method, transfer_type, discount_amount
    ) VALUES (
        p_company_id, p_branch_id, p_customer_id, 'completed', p_payment_method, p_transfer_type, p_total_discount
    )
    RETURNING id INTO v_sale_id;

    -- 5. Procesar items.
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items)
        AS x(variant_id UUID, quantity INTEGER, expected_updated_at TIMESTAMP WITH TIME ZONE, discount DECIMAL)
    LOOP
        -- Leer la variante y su updated_at (para detectar conflictos).
        -- FOR UPDATE bloquea la fila mientras se valida y descuenta stock.
        SELECT updated_at, product_id INTO v_current_updated_at, v_product_id
        FROM product_variants
        WHERE id = v_item.variant_id AND company_id = p_company_id
        FOR UPDATE;

        IF v_current_updated_at IS NULL THEN
            RAISE EXCEPTION 'Variante % no encontrada para esta empresa.', v_item.variant_id;
        END IF;

        IF v_current_updated_at::text != v_item.expected_updated_at::text THEN
            RAISE EXCEPTION 'CONFLICT_409: El producto % ha sido modificado.', v_item.variant_id;
        END IF;

        -- Precio con herencia.
        SELECT
            CASE WHEN v.price IS NOT NULL THEN v.price
                 WHEN p.price_base IS NOT NULL THEN p.price_base
                 ELSE NULL END
        INTO v_effective_price
        FROM product_variants v
        JOIN products p ON v.product_id = p.id
        WHERE v.id = v_item.variant_id AND p.company_id = p_company_id;

        IF v_effective_price IS NULL THEN
            RAISE EXCEPTION 'BLOQUEO_PRECIO: La variante % y su producto base no tienen precio.', v_item.variant_id;
        END IF;

        -- 5a. Validar stock GLOBAL de la empresa en `product_variants.stock`.
        --     Las sucursales comparten inventario: si la empresa tiene
        --     stock suficiente, la venta pasa desde cualquier sucursal.
        IF NOT EXISTS (
            SELECT 1 FROM product_variants
            WHERE id = v_item.variant_id
              AND company_id = p_company_id
              AND stock >= v_item.quantity
        ) THEN
            RAISE EXCEPTION 'Stock insuficiente para %.', v_item.variant_id;
        END IF;

        -- 5b. Descontar stock de `product_variants.stock` (NO de branch_stock).
        UPDATE product_variants
        SET stock = stock - v_item.quantity, updated_at = NOW()
        WHERE id = v_item.variant_id AND company_id = p_company_id;

        -- 5c. Insertar sale_item con branch_id (la venta es por sucursal).
        INSERT INTO sale_items (
            company_id, branch_id, sale_id, product_id, variant_id, quantity, unit_price, discount_amount
        ) VALUES (
            p_company_id, p_branch_id, v_sale_id, v_product_id, v_item.variant_id,
            v_item.quantity, v_effective_price, COALESCE(v_item.discount, 0)
        );

        -- 5d. Insertar inventory_movement con branch_id (sucursal donde
        --     se registró la venta). El stock que afecta es el global de
        --     la empresa, pero el movimiento se asigna a la sucursal.
        INSERT INTO inventory_movements (
            company_id, branch_id, product_id, type, quantity, reason
        ) VALUES (
            p_company_id, p_branch_id, v_product_id, 'out', v_item.quantity, 'Venta #' || v_sale_id
        );

        v_total_amount := v_total_amount + (v_effective_price * v_item.quantity);
        v_item_discount_total := v_item_discount_total + COALESCE(v_item.discount, 0);
    END LOOP;

    v_paid_amount := CASE
        WHEN p_payment_method = 'CREDIT' THEN 0
        ELSE (v_total_amount - v_item_discount_total - p_total_discount)
    END;

    UPDATE sales SET
        total_amount = v_total_amount,
        discount_amount = v_item_discount_total + p_total_discount,
        total_with_discount = v_total_amount - (v_item_discount_total + p_total_discount),
        paid_amount = v_paid_amount,
        pending_balance = CASE
            WHEN p_payment_method = 'CREDIT' THEN (v_total_amount - v_item_discount_total - p_total_discount)
            ELSE 0
        END,
        updated_at = NOW()
    WHERE id = v_sale_id;

    RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'paid', v_paid_amount);

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false, 'error', SQLERRM, 'code', SQLSTATE
        );
END;
$$;

-- ============================================================
-- tenant_search_inventory
-- ============================================================
-- Cambios respecto a la versión 11.4 original:
--   - Bloque D: devuelve `product_variants.stock` (NO
--     `COALESCE(branch_stock.stock, 0)`). El stock es global y
--     compartido.
--   - LEFT JOIN a `branch_stock` ELIMINADO: ya no hay stock por
--     sucursal. La función hace JOIN directo a `product_variants`
--     y `products`.
--   - `p_branch_id` se mantiene en la firma por consistencia con
--     `tenant_process_sale` (los callers pasan la misma dupla
--     company/branch). No se usa en el WHERE; el stock visible es
--     el global de la empresa. Si en el futuro se quisiera
--     restringir la búsqueda a "productos disponibles en esta
--     sucursal" se reintroduciría, pero con stock compartido ese
--     concepto es equivalente a "con stock global > 0".
-- ============================================================

CREATE OR REPLACE FUNCTION tenant_search_inventory(
    p_company_id UUID,
    p_branch_id UUID,
    search_term TEXT,
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    variant_id UUID,
    product_name TEXT,
    product_brand TEXT,
    variant_name TEXT,
    sku TEXT,
    price DECIMAL(12,2),
    stock INTEGER,
    updated_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT
        v.id as variant_id,
        p.name as product_name,
        p.brand as product_brand,
        v.name as variant_name,
        v.sku,
        COALESCE(v.price, p.price_base) as price,
        v.stock,
        v.updated_at
    FROM product_variants v
    JOIN products p ON v.product_id = p.id
    WHERE v.company_id = p_company_id
      AND p.company_id = p_company_id
      AND (
          v.name % search_term
          OR p.name % search_term
          OR p.brand % search_term
          OR v.sku % search_term
      )
    LIMIT GREATEST(COALESCE(p_limit, 20), 1);
$$;

-- ============================================================
-- tenant_delete_sale
-- ============================================================
-- Cambios respecto a la versión 11.4 original:
--   - Bloque D: revierte el stock a `product_variants.stock` (NO a
--     `branch_stock`). El stock es global y compartido.
--   - Mantiene la validación de que la venta pertenece a la sucursal
--     (las ventas siguen siendo por sucursal; un operador de una
--     sucursal no debe poder borrar ventas de otra).
--   - `p_branch_id` se mantiene en la firma por la misma razón.
-- ============================================================

CREATE OR REPLACE FUNCTION tenant_delete_sale(
    p_company_id UUID,
    p_branch_id UUID,
    p_sale_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item RECORD;
    v_sale_branch UUID;
BEGIN
    -- 1. Verificar que la venta existe, pertenece al tenant Y a la sucursal.
    SELECT branch_id INTO v_sale_branch
    FROM sales
    WHERE id = p_sale_id AND company_id = p_company_id;

    IF v_sale_branch IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Venta no encontrada para esta empresa.');
    END IF;
    IF v_sale_branch <> p_branch_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'La venta no pertenece a esta sucursal.');
    END IF;

    -- 2. Revertir stock a `product_variants.stock` (NO a branch_stock).
    FOR v_item IN
        SELECT product_id, variant_id, quantity
        FROM sale_items
        WHERE sale_id = p_sale_id AND company_id = p_company_id
    LOOP
        UPDATE product_variants
        SET stock = stock + v_item.quantity, updated_at = NOW()
        WHERE id = v_item.variant_id AND company_id = p_company_id;

        INSERT INTO inventory_movements (
            company_id, branch_id, product_id, type, quantity, reason
        ) VALUES (
            p_company_id, p_branch_id, v_item.product_id, 'in', v_item.quantity,
            'Anulación de Venta #' || p_sale_id
        );
    END LOOP;

    DELETE FROM sale_items WHERE sale_id = p_sale_id AND company_id = p_company_id;
    DELETE FROM sales WHERE id = p_sale_id AND company_id = p_company_id;

    RETURN jsonb_build_object('success', true);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ============================================================
-- tenant_transfer_stock
-- ============================================================
-- Esta RPC transfiere stock ENTRE variantes de la misma empresa
-- (típicamente entre variantes del mismo producto). Opera sobre
-- `product_variants.stock` (no sobre `branch_stock`, que ya no
-- existe tras la migración 11.7).
--
-- Mantiene la firma (no cambiamos la semántica respecto a 11.4).
-- Esta función NO usa branch_id por diseño: la transferencia entre
-- variantes es agnóstica a la sucursal (stock global).
-- ============================================================

CREATE OR REPLACE FUNCTION tenant_transfer_stock(
    p_company_id UUID,
    from_variant_id UUID,
    to_variant_id UUID,
    quantity_to_move INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    origin_stock INTEGER;
    v_product_id UUID;
BEGIN
    IF quantity_to_move <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'La cantidad debe ser mayor a cero');
    END IF;

    SELECT stock, product_id INTO origin_stock, v_product_id
    FROM product_variants
    WHERE id = from_variant_id AND company_id = p_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Variante de origen no encontrada');
    END IF;

    IF origin_stock < quantity_to_move THEN
        RETURN jsonb_build_object('success', false, 'error', 'Stock insuficiente en origen');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM product_variants
        WHERE id = to_variant_id AND company_id = p_company_id
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Variante de destino no encontrada');
    END IF;

    UPDATE product_variants
    SET stock = stock - quantity_to_move, updated_at = NOW()
    WHERE id = from_variant_id AND company_id = p_company_id;

    UPDATE product_variants
    SET stock = stock + quantity_to_move, updated_at = NOW()
    WHERE id = to_variant_id AND company_id = p_company_id;

    INSERT INTO inventory_movements (company_id, product_id, type, quantity, reason)
    VALUES (p_company_id, v_product_id, 'out', quantity_to_move,
            'Transferencia a ' || to_variant_id);

    INSERT INTO inventory_movements (company_id, product_id, type, quantity, reason)
    SELECT p_company_id, product_id, 'in', quantity_to_move,
           'Transferencia desde ' || from_variant_id
    FROM product_variants WHERE id = to_variant_id;

    RETURN jsonb_build_object('success', true, 'message', 'Transferencia completada');
END;
$$;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- 1. Las 4 funciones tienen la firma esperada:
--
--    SELECT proname, pg_get_function_arguments(oid) AS args
--    FROM pg_proc
--    WHERE proname IN (
--        'tenant_process_sale', 'tenant_search_inventory',
--        'tenant_delete_sale', 'tenant_transfer_stock'
--    )
--    ORDER BY proname;
--    -- tenant_process_sale(p_company_id, p_branch_id, p_customer_id, p_items, p_payment_method, p_transfer_type, p_total_discount)
--    -- tenant_search_inventory(p_company_id, p_branch_id, search_term, p_limit)
--    -- tenant_delete_sale(p_company_id, p_branch_id, p_sale_id)
--    -- tenant_transfer_stock(p_company_id, from_variant_id, to_variant_id, quantity_to_move)
--
-- 2. Smoke test: ejecutar una venta de prueba en MAIN
--    (verificar que descuenta de product_variants.stock):
--
--    -- Antes
--    SELECT stock FROM product_variants WHERE id = '<variant_id>';
--
--    -- Venta
--    SELECT tenant_process_sale(
--        '<company_id>', '<main_id>', NULL,
--        '[{"variant_id":"<variant_id>","quantity":1,"expected_updated_at":"2026-01-01T00:00:00Z","discount":0}]'::jsonb,
--        'CASH'::payment_method, NULL, 0
--    );
--
--    -- Después
--    SELECT stock FROM product_variants WHERE id = '<variant_id>';
--    -- Debe haber bajado en 1.
--    SELECT stock FROM branch_stock WHERE variant_id = '<variant_id>';
--    -- Debe dar ERROR: branch_stock no existe.
-- ==========================================