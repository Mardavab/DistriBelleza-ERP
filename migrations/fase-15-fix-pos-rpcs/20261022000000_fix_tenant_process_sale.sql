-- ============================================================
-- Fase 15 — Reparar `tenant_process_sale` contra el esquema real
-- ============================================================
--
-- Contexto:
--   El POS dejó de registrar ventas con el error genérico
--   `EXTERNAL: "No se pudo conectar con el servicio externo"`.
--
--   La causa NO es la impresora ni la red: es la RPC `tenant_process_sale`.
--   La migración `fase-13-rpc-align/20261020000000_align_tenant_process_sale.sql`
--   (aplicada el 2026-10-20) se vendió como "recrear la función con la firma y
--   cuerpo exactos que están en producción", pero instaló un cuerpo que
--   referencia objetos que NO existen en el esquema. La última venta exitosa en
--   producción es del 2026-10-12; desde fase-13 hay cero.
--
--   Errores verificados en vivo (pg_proc → prosrc vs information_schema):
--     1) `SELECT COALESCE(pv.price_override, p.price_base)` — `price_override`
--        no existe en `product_variants`. El precio vive en `pv.price`.
--        Este es el PRIMERO que revienta (línea 55 del cuerpo viejo):
--            ERROR:  42703: column pv.price_override does not exist
--     2) `INSERT INTO sales (..., total, ..., received_amount, ..., cash_change, ...)`
--        — esas tres columnas no existen en `sales`. Las reales son
--        `total_amount`, `paid_amount` y `pending_balance`.
--     3) `UPDATE branch_stock SET stock = stock - ...` — la tabla `branch_stock`
--        NO existe. El stock es `product_variants.stock` (Bloque D: las
--        sucursales comparten inventario, el stock es global de la empresa).
--
-- Qué hace esta migración:
--   Reemplaza el cuerpo por uno alineado con el esquema real, conservando la
--   firma pública y la semántica de negocio.
--
-- Semántica de dinero (SIN columnas nuevas):
--   `sales` no tiene columna de vuelto. Se deriva:
--       paid_amount      = COALESCE(p_received_amount, total_with_discount)
--       pending_balance  = GREATEST(total_with_discount - paid_amount, 0) si CREDIT
--                          0 en otro caso
--       vuelto           = GREATEST(paid_amount - total_with_discount, 0)
--   El vuelto se devuelve en el JSON ('change') para que el recibo siga
--   funcionando; `processPOSSale` ya lo lee.
--
-- Atomicidad (arreglo adicional):
--   El cuerpo anterior devolvía `{'success': false, ...}` con RETURN tras haber
--   insertado la venta si el stock no alcanzaba. Como la función termina
--   "bien", PostgREST confirma la transacción y quedaba una venta huérfana.
--   Ahora las validaciones previas fallan ANTES de escribir, y los writes
--   viven en un bloque con EXCEPTION: cualquier fallo revierte el subtransaction.
--
-- REVERSIBLE: Sí, vía RK_20261022000000_restore_broken_tenant_rpcs.sql.
--             Ese rollback restaura el cuerpo ROTO de fase-13 (el que no deja
--             vender). Es un "volver a como estaba", no un estado sano.
--
-- IDEMPOTENTE: Sí (CREATE OR REPLACE FUNCTION).
-- ============================================================

CREATE OR REPLACE FUNCTION public.tenant_process_sale(
    p_company_id uuid,
    p_branch_id uuid,
    p_items jsonb,
    p_payment_method text,
    p_customer_id uuid DEFAULT NULL::uuid,
    p_transfer_type text DEFAULT NULL::text,
    p_received_amount numeric DEFAULT NULL::numeric,
    p_discount_amount numeric DEFAULT 0,
    p_status text DEFAULT 'completed'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sale_id uuid;
    v_total numeric := 0;
    v_total_with_discount numeric;
    v_paid numeric;
    v_pending numeric;
    v_change numeric := 0;
    v_session_id uuid;
    v_item jsonb;
    v_product_id uuid;
    v_variant_id uuid;
    v_quantity integer;
    v_unit_price numeric;
    v_item_discount numeric;
    v_subtotal numeric;
    v_branch_active boolean;
BEGIN
    -- 1) La empresa existe y está activa.
    PERFORM 1 FROM companies WHERE id = p_company_id AND active = true;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Empresa no encontrada o inactiva');
    END IF;

    -- 2) La sucursal pertenece a la empresa y está activa.
    SELECT active INTO v_branch_active
      FROM branches
     WHERE id = p_branch_id AND company_id = p_company_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sucursal no encontrada para esta empresa');
    END IF;
    IF NOT v_branch_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sucursal inactiva');
    END IF;

    -- 3) Para pago en efectivo hace falta caja abierta en esa sucursal.
    IF p_payment_method = 'CASH' THEN
        SELECT id INTO v_session_id
          FROM cash_sessions
         WHERE company_id = p_company_id
           AND branch_id = p_branch_id
           AND status = 'open'
         ORDER BY opening_time DESC
         LIMIT 1;

        IF v_session_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'No hay una sesión de caja abierta');
        END IF;
    END IF;

    -- 4) Calcular el total y validar que cada variante existe en el tenant.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity   := (v_item->>'quantity')::integer;
        v_item_discount := COALESCE((v_item->>'discount')::numeric, 0);

        IF v_variant_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Ítem inválido: se requiere variant_id y quantity > 0');
        END IF;

        -- Precio: pv.price es el precio de la variante; price_base es el del producto.
        SELECT COALESCE(pv.price, p.price_base)
          INTO v_unit_price
          FROM products p
          JOIN product_variants pv ON pv.product_id = p.id
         WHERE pv.id = v_variant_id
           AND p.company_id = p_company_id;

        IF v_unit_price IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Variante no encontrada para esta empresa');
        END IF;

        -- Si el carrito no trae product_id, se resuelve desde la variante.
        IF v_product_id IS NULL THEN
            SELECT pv.product_id INTO v_product_id
              FROM product_variants pv
             WHERE pv.id = v_variant_id;
        END IF;

        v_subtotal := (v_unit_price * v_quantity) - v_item_discount;
        v_total := v_total + v_subtotal;
    END LOOP;

    v_total_with_discount := v_total - p_discount_amount;
    IF v_total_with_discount < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Descuento excede el total');
    END IF;

    -- 4b) Validar stock ANTES de escribir nada. `branch_stock` no existe:
    --     el stock es global de la empresa en product_variants (Bloque D).
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity   := (v_item->>'quantity')::integer;

        IF NOT EXISTS (
            SELECT 1 FROM product_variants
             WHERE id = v_variant_id
               AND company_id = p_company_id
               AND stock >= v_quantity
        ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'CONFLICT_409: stock insuficiente para ' || v_variant_id::text);
        END IF;
    END LOOP;

    -- Dinero: sin columna de vuelto, todo derivado.
    v_paid    := COALESCE(p_received_amount, v_total_with_discount);
    v_change  := GREATEST(v_paid - v_total_with_discount, 0);
    v_pending := CASE
                   WHEN p_payment_method = 'CREDIT' THEN GREATEST(v_total_with_discount - v_paid, 0)
                   ELSE 0
                 END;

    -- ── Escritura: todo dentro de un subtransaction para no dejar huérfanos ──
    BEGIN
        -- 5) Insertar la venta con las columnas REALES de `sales`.
        INSERT INTO sales (
            company_id, branch_id, customer_id, payment_method, transfer_type,
            total_amount, total_with_discount, discount_amount,
            paid_amount, pending_balance, status, cash_session_id
        ) VALUES (
            p_company_id, p_branch_id, p_customer_id,
            p_payment_method::payment_method,
            p_transfer_type::transfer_type,
            v_total, v_total_with_discount, p_discount_amount,
            v_paid, v_pending, p_status::sale_status, v_session_id
        )
        RETURNING id INTO v_sale_id;

        -- 6) Items, descuento de stock y movimientos de inventario.
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
            v_product_id := COALESCE((v_item->>'product_id')::uuid, v_product_id);
            v_variant_id := (v_item->>'variant_id')::uuid;
            v_quantity   := (v_item->>'quantity')::integer;
            v_item_discount := COALESCE((v_item->>'discount')::numeric, 0);

            SELECT COALESCE(pv.price, p.price_base)
              INTO v_unit_price
              FROM products p
              JOIN product_variants pv ON pv.product_id = p.id
             WHERE pv.id = v_variant_id
               AND p.company_id = p_company_id;

            INSERT INTO sale_items (
                company_id, branch_id, sale_id, product_id, variant_id,
                quantity, unit_price, discount_amount
            ) VALUES (
                p_company_id, p_branch_id, v_sale_id, v_product_id, v_variant_id,
                v_quantity, v_unit_price, v_item_discount
            );

            -- Stock global de la empresa. El `stock >= v_quantity` además hace
            -- de cierre de concurrencia (lock de fila) para dos ventas simultáneas.
            UPDATE product_variants
               SET stock = stock - v_quantity,
                   updated_at = now()
             WHERE id = v_variant_id
               AND company_id = p_company_id
               AND stock >= v_quantity;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'CONFLICT_409: stock insuficiente para %', v_variant_id;
            END IF;

            -- `inventory_movements` no tiene `variant_id` ni `reference_id`, y
            -- el tipo de movimiento es la columna `type` (enum movement_type).
            -- El vínculo con la venta queda en `reason`, y con la variante en
            -- `sale_items.variant_id`.
            INSERT INTO inventory_movements (
                company_id, branch_id, product_id, type,
                quantity, reason
            ) VALUES (
                p_company_id, p_branch_id, v_product_id, 'out'::movement_type,
                v_quantity, 'Venta #' || v_sale_id::text
            );
        END LOOP;

        -- 7) Crédito a favor del cliente si aplica.
        --    La columna es `method` (enum payment_method), no `payment_method`.
        IF p_payment_method = 'CREDIT' AND p_customer_id IS NOT NULL THEN
            INSERT INTO customer_payments (
                company_id, branch_id, customer_id, sale_id, amount, method
            ) VALUES (
                p_company_id, p_branch_id, p_customer_id, v_sale_id,
                v_total_with_discount, 'CREDIT'::payment_method
            );
        END IF;
    EXCEPTION WHEN OTHERS THEN
        -- El subtransaction revierte la venta, los items, el stock y los
        -- movimientos. Se devuelve el mensaje para que el caller lo muestre.
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
    END;

    RETURN jsonb_build_object(
        'success', true,
        'sale_id', v_sale_id,
        'total', v_total,
        'total_with_discount', v_total_with_discount,
        'paid', v_paid,
        'change', v_change
    );
END;
$$;
