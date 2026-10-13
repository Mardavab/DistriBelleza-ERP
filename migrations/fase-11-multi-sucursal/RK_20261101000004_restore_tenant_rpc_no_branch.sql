-- ==========================================
-- ROLLBACK 20261101000004 - Restaurar tenant_* sin branch_id
-- Fase 11 - Multi-sucursal (Bloque C)
-- ==========================================
-- OBJETIVO: revertir las funciones `tenant_*` a su estado previo
--           (sin parámetro `p_branch_id`, sin branch_stock, sin
--           branch_id en sales/sale_items/inventory_movements).
--
-- CUÁNDO USARLO:
--   - Si la migración 11.4 introduce un bug crítico (ej: no actualiza
--     branch_stock en alguna ruta).
--   - Si se decide volver al modelo "stock único por empresa" mientras
--     se re-evalúa el modelo de multi-sucursal.
--
-- PREREQUISITO: este rollback asume que las migraciones 11.0–11.3
-- (branches, branch_memberships, branch_stock, branch_id en tablas)
-- SIGUEN aplicadas. Si también se quiere revertir esas, aplicar
-- RK_20261101000000 → RK_20261101000003 en orden inverso.
--
-- ⚠️  IMPORTANTE: este rollback restaura las funciones a la versión
--     pre-11.4. El código TS DEBE revertirse en sincronía. Si el
--     código ya llama a `tenant_*` con `p_branch_id` (este commit),
--     la firma no coincidirá y fallará en runtime.
-- ==========================================

BEGIN;

-- ============================================================
-- tenant_process_sale (versión pre-11.4)
-- ============================================================
CREATE OR REPLACE FUNCTION tenant_process_sale(
    p_company_id UUID,
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
BEGIN
    -- 1. Validar que el tenant existe y está activo
    PERFORM 1 FROM companies WHERE id = p_company_id AND active = true;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Empresa no encontrada o inactiva');
    END IF;

    -- 2. Validar caja abierta para pago en efectivo (dentro del tenant)
    IF p_payment_method = 'CASH' AND NOT EXISTS (
        SELECT 1 FROM cash_sessions
        WHERE company_id = p_company_id AND status = 'open'
    ) THEN
        RAISE EXCEPTION 'No hay una sesión de caja abierta.';
    END IF;

    -- 3. Crear venta con company_id
    INSERT INTO sales (
        company_id, customer_id, status, payment_method, transfer_type, discount_amount
    ) VALUES (
        p_company_id, p_customer_id, 'completed', p_payment_method, p_transfer_type, p_total_discount
    )
    RETURNING id INTO v_sale_id;

    -- 4. Procesar items
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items)
        AS x(variant_id UUID, quantity INTEGER, expected_updated_at TIMESTAMP WITH TIME ZONE, discount DECIMAL)
    LOOP
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

        -- Precio con herencia
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

        IF NOT EXISTS (
            SELECT 1 FROM product_variants
            WHERE id = v_item.variant_id AND stock >= v_item.quantity AND company_id = p_company_id
        ) THEN
            RAISE EXCEPTION 'Stock insuficiente para %.', v_item.variant_id;
        END IF;

        UPDATE product_variants
        SET stock = stock - v_item.quantity, updated_at = NOW()
        WHERE id = v_item.variant_id AND company_id = p_company_id;

        INSERT INTO sale_items (
            company_id, sale_id, product_id, variant_id, quantity, unit_price, discount_amount
        ) VALUES (
            p_company_id, v_sale_id, v_product_id, v_item.variant_id,
            v_item.quantity, v_effective_price, COALESCE(v_item.discount, 0)
        );

        INSERT INTO inventory_movements (
            company_id, product_id, type, quantity, reason
        ) VALUES (
            p_company_id, v_product_id, 'out', v_item.quantity, 'Venta #' || v_sale_id
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
-- tenant_search_inventory (versión pre-11.4)
-- ============================================================
CREATE OR REPLACE FUNCTION tenant_search_inventory(
    p_company_id UUID,
    search_term TEXT
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
    LIMIT 20;
$$;

-- ============================================================
-- tenant_delete_sale (versión pre-11.4)
-- ============================================================
CREATE OR REPLACE FUNCTION tenant_delete_sale(
    p_company_id UUID,
    p_sale_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item RECORD;
BEGIN
    -- Verificar que la venta pertenece al tenant
    PERFORM 1 FROM sales WHERE id = p_sale_id AND company_id = p_company_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Venta no encontrada para esta empresa.');
    END IF;

    FOR v_item IN
        SELECT product_id, variant_id, quantity
        FROM sale_items
        WHERE sale_id = p_sale_id AND company_id = p_company_id
    LOOP
        UPDATE product_variants
        SET stock = stock + v_item.quantity, updated_at = NOW()
        WHERE id = v_item.variant_id AND company_id = p_company_id;

        INSERT INTO inventory_movements (
            company_id, product_id, type, quantity, reason
        ) VALUES (
            p_company_id, v_item.product_id, 'in', v_item.quantity,
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

-- tenant_transfer_stock: la firma no cambió en 11.4, no requiere
-- reescritura. Se deja explícitamente como no-op en este rollback.
-- Si en una migración futura se modifica, aplicar el RK_ correspondiente.

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-ROLLBACK
-- ==========================================
-- 1. Las funciones vuelven a la firma antigua:
--    SELECT proname, pg_get_function_arguments(oid) AS args
--    FROM pg_proc
--    WHERE proname IN (
--        'tenant_process_sale', 'tenant_search_inventory',
--        'tenant_delete_sale', 'tenant_transfer_stock'
--    )
--    ORDER BY proname;
--    -- tenant_process_sale NO debe tener p_branch_id.
--    -- tenant_search_inventory NO debe tener p_branch_id ni p_limit.
--    -- tenant_delete_sale NO debe tener p_branch_id.
-- ==========================================
