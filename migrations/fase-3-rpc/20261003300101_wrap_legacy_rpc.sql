-- ==========================================
-- MIGRACIÓN 20261003300101 - Wrappers retrocompatibles
-- ==========================================
-- OBJETIVO: Mantener las funciones viejas (process_sale, search_inventory,
--           delete_sale, transfer_stock) operativas llamando a las nuevas
--           tenant_* con Distribelleza hardcoded.
--           Permite migración gradual del código TypeScript.
-- ==========================================
-- ⚠️  TEMPORAL: estos wrappers se eliminan en Fase 7 cuando todo el código
--    use las funciones tenant_* explícitamente.
-- ==========================================

BEGIN;

-- Wrapper de process_sale
CREATE OR REPLACE FUNCTION process_sale(
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
BEGIN
    RETURN tenant_process_sale(
        '11111111-1111-1111-1111-111111111111',
        p_customer_id, p_items, p_payment_method, p_transfer_type, p_total_discount
    );
END;
$$;

-- Wrapper de search_inventory
CREATE OR REPLACE FUNCTION search_inventory(search_term TEXT)
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
    SELECT * FROM tenant_search_inventory(
        '11111111-1111-1111-1111-111111111111', search_term
    );
$$;

-- Wrapper de delete_sale
CREATE OR REPLACE FUNCTION delete_sale(p_sale_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN tenant_delete_sale(
        '11111111-1111-1111-1111-111111111111', p_sale_id
    );
END;
$$;

-- Wrapper de transfer_stock
CREATE OR REPLACE FUNCTION transfer_stock(
    from_variant_id UUID,
    to_variant_id UUID,
    quantity_to_move INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN tenant_transfer_stock(
        '11111111-1111-1111-1111-111111111111',
        from_variant_id, to_variant_id, quantity_to_move
    );
END;
$$;

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- Debe devolver 8 funciones (4 nuevas tenant_* + 4 wrappers viejos):
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