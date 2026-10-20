-- ============================================================
-- Fase 13 — Alinear firma de `tenant_process_sale` con la realidad
-- ============================================================
--
-- Contexto:
--   La función `tenant_process_sale` en producción diverge de la migración
--   versionada `fase-11-multi-sucursal/20261101000004_tenant_rpc_with_branch.sql`.
--   Esa migración declaraba los parámetros como:
--       (p_company_id, p_branch_id, p_customer_id, p_items,
--        p_payment_method, p_transfer_type, p_total_discount)
--
--   Pero la función real en Supabase tiene esta firma (renombrada y extendida):
--       (p_company_id uuid,
--        p_branch_id uuid,
--        p_items jsonb,
--        p_payment_method text,
--        p_customer_id uuid DEFAULT NULL,
--        p_transfer_type text DEFAULT NULL,
--        p_received_amount numeric DEFAULT NULL,
--        p_discount_amount numeric DEFAULT 0,
--        p_status text DEFAULT 'completed')
--
--   Cambios respecto a la versión declarada en el repo:
--     1) `p_total_discount` → `p_discount_amount`  (renombrado)
--     2) `p_received_amount`  → NUEVO, controla el cambio (v_change)
--                                en pagos en efectivo.
--     3) `p_status`           → NUEVO, default 'completed'.
--     4) `p_items` y `p_payment_method` reordenados en la firma
--        (no afecta callers: en PL/pgSQL son argumentos posicionales).
--
--   Como consecuencia, el código TS en `app/actions/sales.ts` llamaba con
--   `p_total_discount` y Postgres rechazaba la llamada con un error de
--   tipo, que el wrapper `handleActionError` de `lib/errors.ts` mapeaba
--   a `EXTERNAL` → "No se pudo conectar con el servicio externo".
--
-- Esta migración:
--   - Recrea la función con la firma y cuerpo exactos que están en
--     producción hoy.
--   - Es idempotente (`CREATE OR REPLACE FUNCTION`).
--   - NO requiere backfill ni tocar datos: solo cambia el código PL/pgSQL
--     de la función.
--
-- Después de aplicar esta migración, el repo y la DB quedan alineados y
-- cualquier deploy nuevo mantiene esta firma. Si en el futuro se quiere
-- cambiar la firma de la RPC, el cambio se hace en una migración versionada
-- (estilo `fase-X-...`) y se actualiza el caller en `app/actions/sales.ts`
-- en el mismo commit.
--
-- ============================================================
-- tenant_process_sale — firma real en producción (Oct 2026)
-- ============================================================

CREATE OR REPLACE FUNCTION tenant_process_sale(
    p_company_id UUID,
    p_branch_id UUID,
    p_items JSONB,
    p_payment_method TEXT,
    p_customer_id UUID DEFAULT NULL,
    p_transfer_type TEXT DEFAULT NULL,
    p_received_amount NUMERIC DEFAULT NULL,
    p_discount_amount NUMERIC DEFAULT 0,
    p_status TEXT DEFAULT 'completed'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sale_id UUID;
    v_total NUMERIC := 0;
    v_total_with_discount NUMERIC;
    v_change NUMERIC := 0;
    v_session_id UUID;
    v_item JSONB;
    v_product_id UUID;
    v_variant_id UUID;
    v_quantity INT;
    v_unit_price NUMERIC;
    v_item_discount NUMERIC;
    v_subtotal NUMERIC;
    v_cash_open BOOLEAN;
    v_branch_active BOOLEAN;
BEGIN
    -- 1. Validar que la empresa existe y está activa
    PERFORM 1 FROM companies WHERE id = p_company_id AND active = true;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Empresa no encontrada o inactiva');
    END IF;

    -- 2. Validar que la sucursal pertenece a la empresa y está activa
    SELECT active INTO v_branch_active FROM branches
    WHERE id = p_branch_id AND company_id = p_company_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sucursal no encontrada para esta empresa');
    END IF;
    IF NOT v_branch_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sucursal inactiva');
    END IF;

    -- 3. Validar caja abierta en la sucursal para pago en efectivo
    IF p_payment_method = 'CASH' THEN
        SELECT id INTO v_session_id
        FROM cash_sessions
        WHERE company_id = p_company_id AND branch_id = p_branch_id AND status = 'open'
        ORDER BY opening_time DESC
        LIMIT 1;

        IF v_session_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'No hay caja abierta para esta sucursal');
        END IF;
    END IF;

    -- 4. Calcular total
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::UUID;
        v_variant_id := (v_item->>'variant_id')::UUID;
        v_quantity := (v_item->>'quantity')::INT;
        v_item_discount := COALESCE((v_item->>'discount')::NUMERIC, 0);

        SELECT COALESCE(pv.price_override, p.price_base)
        INTO v_unit_price
        FROM products p
        JOIN product_variants pv ON pv.product_id = p.id
        WHERE pv.id = v_variant_id AND p.company_id = p_company_id;

        IF v_unit_price IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Variante no encontrada para esta empresa');
        END IF;

        v_subtotal := (v_unit_price * v_quantity) - v_item_discount;
        v_total := v_total + v_subtotal;
    END LOOP;

    v_total_with_discount := v_total - p_discount_amount;
    IF v_total_with_discount < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Descuento excede el total');
    END IF;

    IF p_payment_method = 'CASH' AND p_received_amount IS NOT NULL THEN
        v_change := p_received_amount - v_total_with_discount;
    END IF;

    -- 5. Insertar venta con company_id y branch_id
    INSERT INTO sales (
        company_id, branch_id, customer_id, payment_method, transfer_type,
        total, total_with_discount, discount_amount,
        received_amount, cash_change, status, cash_session_id
    ) VALUES (
        p_company_id, p_branch_id, p_customer_id, p_payment_method, p_transfer_type,
        v_total, v_total_with_discount, p_discount_amount,
        p_received_amount, v_change, p_status, v_session_id
    )
    RETURNING id INTO v_sale_id;

    -- 6. Insertar items, descontar stock de branch_stock, registrar movimientos
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::UUID;
        v_variant_id := (v_item->>'variant_id')::UUID;
        v_quantity := (v_item->>'quantity')::INT;
        v_item_discount := COALESCE((v_item->>'discount')::NUMERIC, 0);

        SELECT COALESCE(pv.price_override, p.price_base)
        INTO v_unit_price
        FROM products p
        JOIN product_variants pv ON pv.product_id = p.id
        WHERE pv.id = v_variant_id AND p.company_id = p_company_id;

        INSERT INTO sale_items (
            company_id, branch_id, sale_id, product_id, variant_id,
            quantity, unit_price, discount_amount
        ) VALUES (
            p_company_id, p_branch_id, v_sale_id, v_product_id, v_variant_id,
            v_quantity, v_unit_price, v_item_discount
        );

        -- Descontar stock de branch_stock
        UPDATE branch_stock
        SET stock = stock - v_quantity, updated_at = now()
        WHERE branch_id = p_branch_id AND variant_id = v_variant_id AND stock >= v_quantity;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'CONFLICT_409: stock insuficiente para ' || v_variant_id::text);
        END IF;

        INSERT INTO inventory_movements (
            company_id, branch_id, product_id, variant_id, movement_type,
            quantity, reason, reference_id
        ) VALUES (
            p_company_id, p_branch_id, v_product_id, v_variant_id, 'out',
            v_quantity, 'Venta #' || v_sale_id::text, v_sale_id
        );
    END LOOP;

    -- 7. Registrar crédito a favor del cliente si aplica
    IF p_payment_method = 'CREDIT' AND p_customer_id IS NOT NULL THEN
        INSERT INTO customer_payments (
            company_id, branch_id, customer_id, sale_id, amount, payment_method
        ) VALUES (
            p_company_id, p_branch_id, p_customer_id, v_sale_id, v_total_with_discount, 'CREDIT'
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'sale_id', v_sale_id,
        'total', v_total,
        'total_with_discount', v_total_with_discount,
        'change', v_change
    );
END;
$$;
