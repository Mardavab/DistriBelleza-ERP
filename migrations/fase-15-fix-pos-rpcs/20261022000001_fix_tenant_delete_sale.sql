-- ============================================================
-- Fase 15 — Reparar `tenant_delete_sale` (devolver stock)
-- ============================================================
--
-- Mismo defecto que `tenant_process_sale` (ver 20261022000000): la función
-- hacía `UPDATE branch_stock SET stock = stock + ...`, pero `branch_stock` NO
-- existe. El stock vive en `product_variants.stock` (Bloque D: global de la
-- empresa, las sucursales comparten inventario).
--
-- Síntoma: al anular una venta desde el historial fallaba con
-- `relation "branch_stock" does not exist`, que `handleActionError` traducía a
-- `EXTERNAL: "No se pudo conectar con el servicio externo"`.
--
-- Además, el cuerpo anterior tenía el mismo problema de atomicidad que
-- `tenant_process_sale`: si algo fallaba a mitad, se quedaban los
-- `inventory_movements` sin revertir. Aquí los writes van en un subtransaction.
--
-- REVERSIBLE: vía RK_20261022000000_restore_broken_tenant_rpcs.sql
-- IDEMPOTENTE: Sí (CREATE OR REPLACE FUNCTION).
-- ============================================================

CREATE OR REPLACE FUNCTION public.tenant_delete_sale(
    p_company_id uuid,
    p_branch_id uuid,
    p_sale_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item RECORD;
    v_company_id uuid;
BEGIN
    -- La venta existe y pertenece a esa empresa/sucursal (defense in depth).
    SELECT company_id INTO v_company_id
      FROM sales
     WHERE id = p_sale_id
       AND company_id = p_company_id
       AND branch_id = p_branch_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Venta no encontrada para esta empresa y sucursal');
    END IF;

    BEGIN
        FOR v_item IN
            SELECT variant_id, product_id, quantity
              FROM sale_items
             WHERE sale_id = p_sale_id
               AND company_id = p_company_id
               AND branch_id = p_branch_id
        LOOP
            -- Devolver stock al pool global de la empresa (NO branch_stock).
            UPDATE product_variants
               SET stock = stock + v_item.quantity,
                   updated_at = now()
             WHERE id = v_item.variant_id
               AND company_id = p_company_id;

            -- `inventory_movements` no tiene `variant_id` ni `reference_id`, y
            -- el tipo de movimiento es la columna `type` (enum movement_type).
            INSERT INTO inventory_movements (
                company_id, branch_id, product_id, type,
                quantity, reason
            ) VALUES (
                p_company_id, p_branch_id, v_item.product_id, 'in'::movement_type,
                v_item.quantity, 'Anulación venta #' || p_sale_id::text
            );
        END LOOP;

        DELETE FROM sale_items
         WHERE sale_id = p_sale_id
           AND company_id = p_company_id
           AND branch_id = p_branch_id;

        DELETE FROM sales
         WHERE id = p_sale_id
           AND company_id = p_company_id
           AND branch_id = p_branch_id;
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
    END;

    RETURN jsonb_build_object('success', true);
END;
$$;
