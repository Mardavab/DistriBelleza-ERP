# Fase 13 — Alinear `tenant_process_sale` con la realidad

Migración preventiva (sin cambios de datos) que **bloquea en el repo** la firma y el cuerpo de la RPC `tenant_process_sale` que está corriendo hoy en Supabase.

## Por qué existe

En octubre de 2026, el POS empezó a fallar en la confirmación de venta con el error genérico `EXTERNAL: "No se pudo conectar con el servicio externo"`. La causa era un mismatch de firma: el código TS en `app/actions/sales.ts` llamaba con `p_total_discount`, pero la RPC en producción esperaba `p_discount_amount` (renombrado en algún deploy manual que nunca quedó versionado en una migración SQL).

Esto produjo dos consecuencias:

1. **Bug funcional:** ventas no se registraban.
2. **Drift entre repo y DB:** la migración `fase-11-multi-sucursal/20261101000004_tenant_rpc_with_branch.sql` quedó declarando una firma vieja (`p_total_discount`) que ya no coincide con lo que está deployado.

Esta migración cierra el drift: **el repo pasa a ser la fuente de verdad** y refleja exactamente lo que corre hoy.

## Cambios respecto a `20261101000004_tenant_rpc_with_branch.sql`

| Parámetro | Versión vieja (repo) | Versión actual (DB y migración 13) |
|---|---|---|
| `p_total_discount` | declarado | **renombrado a `p_discount_amount`** |
| `p_received_amount` | no existía | **nuevo**, controla `v_change` (vuelto) en pagos `CASH` |
| `p_status` | no existía | **nuevo**, default `'completed'` |
| orden de `p_items`, `p_payment_method` | al final | reubicados |

> Los parámetros por nombre en PL/pgSQL son agnósticos al orden posicional, así que ningún caller existente se rompe por el reordenamiento.

## Contrato público actual (Oct 2026)

```sql
tenant_process_sale(
    p_company_id     UUID,
    p_branch_id      UUID,
    p_items          JSONB,
    p_payment_method TEXT,
    p_customer_id    UUID    DEFAULT NULL,
    p_transfer_type  TEXT    DEFAULT NULL,
    p_received_amount NUMERIC DEFAULT NULL,
    p_discount_amount NUMERIC DEFAULT 0,
    p_status         TEXT    DEFAULT 'completed'
) RETURNS JSONB
```

Comportamiento clave:
- Valida empresa activa, sucursal activa y caja abierta (por sucursal) si `payment_method = 'CASH'`.
- Recorre `p_items`, descuenta stock de `branch_stock`, inserta `sale_items` y `inventory_movements`.
- Calcula `v_change = p_received_amount - v_total_with_discount` cuando hay efectivo recibido.
- Devuelve `{success: true, sale_id, total, total_with_discount, change}` o `{success: false, error: '...'}`.

## Aplicación

```bash
psql "$DATABASE_URL" \
  -f migrations/fase-13-rpc-align/20261020000000_align_tenant_process_sale.sql
```

- **Idempotente** (usa `CREATE OR REPLACE FUNCTION`).
- **No toca datos.** Solo redefine la función en el catálogo.
- **No hay rollback** versionado: si se quiere volver a la firma vieja, replicar `20261101000004_tenant_rpc_with_branch.sql` con `CREATE OR REPLACE`.

## Verificación post-aplicación

```sql
-- Firma debería coincidir con la tabla de arriba
SELECT pg_get_function_arguments(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'tenant_process_sale';

-- Smoke test (con un sale mínimo)
SELECT tenant_process_sale(
    p_company_id := '<empresa-id>',
    p_branch_id  := '<sucursal-id>',
    p_items      := '[{"product_id":"<pid>","variant_id":"<vid>","quantity":1,"discount":0}]'::jsonb,
    p_payment_method := 'CASH',
    p_received_amount := 1000
);
```

Después de esto, el flujo POS completa ventas sin el `EXTERNAL` espurio.

## Cambio en código TS

`app/actions/sales.ts:154` pasó de `p_total_discount` a `p_discount_amount` en el mismo commit. Si vas a modificar la firma de la RPC en el futuro, alineá migración + callers en el mismo PR.
