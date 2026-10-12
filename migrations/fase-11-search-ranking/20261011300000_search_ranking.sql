-- ============================================================
-- Mejora de ranking en tenant_search_inventory
-- ============================================================
-- El RPC anterior usaba solo el operador `%` de pg_trgm sin ORDER BY,
-- por lo que el orden de los resultados era arbitrario y las
-- coincidencias exactas de SKU no aparecían primero.
--
-- Esta migración agrega:
--   1) Filtro ampliado: además del `%%` trigram, incluye prefijo
--      ILIKE para SKU / nombre producto / nombre variante.
--   2) ORDER BY que prioriza:
--        a) Coincidencia exacta de SKU
--        b) Prefijo de SKU
--        c) Prefijo de nombre de producto
--        d) Prefijo de nombre de variante
--        e) Distancia trigram (menor = más parecido)
--
-- Resultado: al escanear un código de barras, el producto exacto aparece
-- de primero en la lista del POS.

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
          v.sku ILIKE search_term
          OR v.sku ILIKE search_term || '%'
          OR p.name ILIKE search_term || '%'
          OR v.name ILIKE search_term || '%'
          OR p.brand ILIKE search_term || '%'
          OR v.sku % search_term
          OR p.name % search_term
          OR v.name % search_term
          OR p.brand % search_term
      )
    ORDER BY
        CASE WHEN v.sku ILIKE search_term THEN 0 ELSE 1 END,
        CASE WHEN v.sku ILIKE search_term || '%' THEN 0 ELSE 1 END,
        CASE WHEN p.name ILIKE search_term || '%' THEN 0 ELSE 1 END,
        CASE WHEN v.name ILIKE search_term || '%' THEN 0 ELSE 1 END,
        v.sku <-> search_term
    LIMIT 20
    ;
$$;