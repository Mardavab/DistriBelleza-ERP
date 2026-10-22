-- ============================================================
-- Fase 15 — Reparar `tenant_search_inventory` (búsqueda del POS)
-- ============================================================
--
-- Tres defectos:
--
-- 1) `LEFT JOIN branch_stock bs ...` — la tabla `branch_stock` NO existe.
--    Es el PRIMERO que revienta, así que la búsqueda devolvía error y, como
--    `searchPOSProducts` hace `if (error) return []`, se perdía en silencio:
--    el POS mostraba la lista por defecto y no encontraba nada al buscar.
--
-- 2) `COALESCE(bs.price_override, pv.price, p.price_base)` — `price_override`
--    no existe. El precio es `pv.price`, con fallback a `products.price_base`.
--
-- 3) `COALESCE(bs.stock, 0)` — con `branch_stock` ausente el stock salía 0
--    siempre. Es `product_variants.stock` (global de la empresa, Bloque D).
--
-- Se conserva la firma. El `RETURNS TABLE` GANA dos columnas que el POS
-- necesita para no mostrar el mismo texto dos veces en la lista de resultados:
--   * `brand`         → `products.brand`
--   * `variant_name`  → `product_variants.name`
-- `product_id` ya se devolvía, así que el POS puede armar el carrito con el
-- vínculo venta↔producto (ver fase-15-fix-pos-rpcs/README.md).
--
-- REVERSIBLE: vía RK_20261022000000_restore_broken_tenant_rpcs.sql
-- IDEMPOTENTE: Sí (DROP IF EXISTS + CREATE).
-- NOTA: hay que hacer DROP antes que CREATE. Postgres no permite cambiar el
--       tipo de retorno de una función existente
--       (`42P13: cannot change return type of existing function`).
-- ============================================================

DROP FUNCTION IF EXISTS public.tenant_search_inventory(uuid, uuid, text, integer);

CREATE OR REPLACE FUNCTION public.tenant_search_inventory(
    p_company_id uuid,
    p_branch_id uuid,
    p_search_term text,
    p_limit integer DEFAULT 20
)
RETURNS TABLE(
    variant_id uuid,
    product_id uuid,
    product_name text,
    variant_name text,
    brand text,
    sku text,
    barcode text,
    stock integer,
    price numeric,
    category_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        pv.id,
        pv.product_id,
        p.name::text,
        pv.name::text,
        p.brand::text,
        pv.sku::text,
        pv.barcode::text,
        COALESCE(pv.stock, 0)::integer AS stock,
        COALESCE(pv.price, p.price_base)::numeric AS price,
        c.name::text
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE pv.company_id = p_company_id
      AND p.company_id = p_company_id
      AND (
          p.name ILIKE '%' || p_search_term || '%'
          OR pv.sku ILIKE '%' || p_search_term || '%'
          OR pv.barcode = p_search_term
      )
    ORDER BY p.name
    LIMIT p_limit;
END;
$$;

-- El DROP de arriba borra los grants heredados: se restituyen explícitamente.
-- La RPC la llama la server action con `supabaseAdmin` (service_role), pero
-- `authenticated` se conserva por si el caller cambia.
GRANT EXECUTE ON FUNCTION public.tenant_search_inventory(uuid, uuid, text, integer)
    TO authenticated, service_role;
