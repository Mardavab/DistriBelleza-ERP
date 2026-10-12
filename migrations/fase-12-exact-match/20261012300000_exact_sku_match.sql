-- ============================================================
-- Búsqueda con match EXACTO prioritario (sku/barcode)
-- ============================================================
-- Bug reportado: al escanear el código 7703819017780, el POS devolvía
-- el producto con SKU 7703819017773 (difieren en 2 dígitos consecutivos).
--
-- Causa: el RPC `tenant_search_inventory` usaba `ILIKE` (substring match)
-- y trigram similarity. Cuando los SKUs son muy similares, ambos productos
-- pasan el filtro fuzzy y el orden no garantiza que el exacto venga primero.
--
-- Además, el campo `barcode` (código de barras físico) no estaba incluido
-- en el filtro — solo `sku`.
--
-- Esta migración:
--   1) Agrega `v.barcode` al conjunto de campos buscados.
--   2) Reemplaza `ILIKE` por `=` (equality) en el ORDER BY de mayor
--      prioridad. Eso garantiza que si el SKU o barcode coincide exacto,
--      ese producto va primero — sin importar el orden arbitrario de
--      PostgREST.
--   3) Mantiene el resto del ranking (prefix, fuzzy, distance) como
--      fallback para búsquedas parciales por nombre.

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
    barcode TEXT,
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
        v.barcode,
        COALESCE(v.price, p.price_base) as price,
        v.stock,
        v.updated_at
    FROM product_variants v
    JOIN products p ON v.product_id = p.id
    WHERE v.company_id = p_company_id
      AND p.company_id = p_company_id
      AND (
          v.sku = search_term                          -- match exacto de SKU
          OR v.barcode = search_term                    -- match exacto de barcode
          OR v.sku ILIKE search_term || '%'           -- prefijo de SKU
          OR v.barcode ILIKE search_term || '%'       -- prefijo de barcode
          OR p.name ILIKE search_term || '%'           -- prefijo de producto
          OR v.name ILIKE search_term || '%'           -- prefijo de variante
          OR p.brand ILIKE search_term || '%'          -- prefijo de marca
          OR v.sku % search_term                       -- fuzzy
          OR v.barcode % search_term
          OR p.name % search_term
          OR v.name % search_term
          OR p.brand % search_term
      )
    ORDER BY
        CASE WHEN v.sku = search_term THEN 0
             WHEN v.barcode = search_term THEN 0
             ELSE 1 END,
        CASE WHEN v.sku ILIKE search_term || '%' THEN 0
             WHEN v.barcode ILIKE search_term || '%' THEN 0
             ELSE 1 END,
        CASE WHEN p.name ILIKE search_term || '%' THEN 0
             WHEN v.name ILIKE search_term || '%' THEN 0
             ELSE 1 END,
        -- Si hay varios resultados, el exacto siempre gana por estar arriba.
        -- El distance sirve solo para empates dentro del mismo bucket.
        LEAST(COALESCE(v.sku <-> search_term, 1.0),
              COALESCE(v.barcode <-> search_term, 1.0))
    LIMIT 20
    ;
$$;