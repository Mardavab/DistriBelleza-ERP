# Fase 15 — Reparar las RPCs del POS

Corrige tres funciones que estaban rotas contra el esquema real y que dejaban
el POS sin poder registrar ventas, anularlas ni buscar productos.

## Síntoma

> "Conecto la impresora, aparece en verde, pero al confirmar una venta me dice
> *No se pudo conectar con el servicio externo. Reintenta en unos segundos*."

Ese mensaje es `DEFAULT_USER_MESSAGES.EXTERNAL` (`lib/errors.ts`). **No tiene
nada que ver con la impresora**: el verde es WebUSB y funciona. La venta falla
en la base de datos, y `handleActionError` traduce el error de la RPC a
`EXTERNAL`.

## Línea de tiempo

```
2026-10-12 17:23   última venta exitosa (55 ventas, todos los totales correctos)
2026-10-20         fase-13-rpc-align se aplica en producción
hoy                0 ventas desde entonces
```

`fase-13` se vendió como *"recrear la función con la firma y cuerpo exactos que
están en producción hoy"*. Alineó la **firma** y rompió el **cuerpo**.

## Defectos encontrados (verificados en vivo)

| # | En el cuerpo instalado | Realidad |
|---|---|---|
| 1 | `COALESCE(pv.price_override, p.price_base)` | `price_override` no existe. El precio es `pv.price` |
| 2 | `INSERT INTO sales (… total, …)` | la columna es `total_amount` |
| 3 | `INSERT INTO sales (… received_amount, …)` | la columna es `paid_amount` |
| 4 | `INSERT INTO sales (… cash_change, …)` | la columna es `pending_balance` |
| 5 | `UPDATE branch_stock SET stock = stock ± …` | `branch_stock` **no existe** |
| 6 | `INSERT INTO inventory_movements (… variant_id, movement_type, reference_id …)` | esas columnas no existen. El tipo de movimiento es la columna **`type`** (enum `movement_type`: `in \| out \| adjustment`) |
| 7 | `INSERT INTO customer_payments (… payment_method …)` | la columna es **`method`** (enum `payment_method`) |
| 8 | `tenant_search_inventory`: `varchar` sin cast a `text` en el `RETURN QUERY` | Postgres exige coincidencia exacta de tipos del `RETURNS TABLE` (`42P04: structure of query does not match function result type`) |

El #1 es el primero que revienta en `tenant_process_sale`. Se capturó así:

```sql
BEGIN;
SELECT tenant_process_sale('…', '…', '[…]', 'CASH');
ROLLBACK;
-- ERROR:  42703: column pv.price_override does not exist
-- CONTEXT: PL/pgSQL function tenant_process_sale(...) line 55
```

Los #6–#8 salieron al ir verificando en vivo cada tramo: el #6 revienta recién
al insertar movimientos, después de crear la venta. Por eso es importante
probar la función entera y no solo el primer error.

Los archivos de origen (`migrations/legacy/schema_pre_multitenant.sql`,
`migrations/fase-3-rpc/`) **sí** tienen los nombres correctos. Es decir, el
drift lo introdujo fase-13.

## Qué arregla cada migración

| Archivo | Función | Qué corrige |
|---|---|---|
| `20261022000000` | `tenant_process_sale` | #1–#7, más atomicidad |
| `20261022000001` | `tenant_delete_sale` | #5 y #6 (devolver stock y movimientos) + atomicidad |
| `20261022000002` | `tenant_search_inventory` | #1, #5 y #8. Además el `RETURNS TABLE` gana `brand` y `variant_name` |

> `tenant_search_inventory` exige `DROP FUNCTION` antes que `CREATE`: Postgres
> no deja cambiar el tipo de retorno de una función existente
> (`42P13: cannot change return type of existing function`). El `DROP` borra los
> grants, que se restituyen explícitamente al final del archivo.

### Atomicidad (arreglo adicional)

El cuerpo anterior hacía `RETURN jsonb_build_object('success', false, …)` tras
haber insertado la venta si el stock no alcanzaba. Como la función terminaba
"bien", PostgREST confirmaba la transacción y **quedaba una venta huérfana**
sin items y con stock descontado a medias. Ahora:

- el stock se valida **antes** de escribir nada, y
- los writes viven en un bloque `BEGIN … EXCEPTION WHEN OTHERS` que revierte
  el subtransaction completo.

## Semántica de dinero (sin columnas nuevas)

`sales` no tiene columna de vuelto, y no se añade. Todo se deriva:

```
paid_amount     = COALESCE(p_received_amount, total_with_discount)
pending_balance = GREATEST(total_with_discount - paid_amount, 0)   si CREDIT
                  0                                                si no
vuelto          = GREATEST(paid_amount - total_with_discount, 0)
```

El vuelto se devuelve en el JSON (`'change'`) para que el recibo siga
funcionando; `processPOSSale` ya lo lee.

## Modelo de stock (por qué NO crear `branch_stock`)

Bloque D cerró esto a propósito: **las sucursales comparten inventario**, el
stock es global de la empresa en `product_variants.stock`. Ya está alineado en
el código TS:

- `getDefaultProducts` filtra por `product_variants.stock > 0`
- `searchPOSProducts` comenta literalmente *"NO por `branch_stock`, que ya no
  existe"*

Crear `branch_stock` de nuevo reabriría un modelo que se descartó. La RPC era
lo que quedó desactualizada.

## Segundo hallazgo: el carrito perdía `product_id`

El POS enviaba `{variant_id, quantity, expected_updated_at, discount}` — **sin
`product_id`**. Consecuencia: `sale_items.product_id` y
`inventory_movements.product_id` quedaban `NULL`, perdiendo el vínculo
venta↔producto para reportes.

La RPC ahora resuelve `product_id` desde la variante si no llega, pero el fix
completo es que el carrito lo mande (tipos `CartItem` y `POSSearchResult`,
`getDefaultProducts`, `ProductSearch`, `POS.tsx`).

## Tercer hallazgo: el error se perdía en silencio

`searchPOSProducts` hacía `if (error) return []`. Como la búsqueda fallaba por
`branch_stock`, devolvía vacío sin dejar rastro: el POS mostraba la lista por
defecto y parecía que simplemente "no encontraba" el producto. Ahora se
registra con `warnSilently`.

## Orden de aplicación

```
1) 20261022000000_fix_tenant_process_sale.sql
2) 20261022000001_fix_tenant_delete_sale.sql
3) 20261022000002_fix_tenant_search_inventory.sql
```

## Rollback

`RK_20261022000000_restore_broken_tenant_rpcs.sql` restaura el cuerpo de
fase-13, **que está roto**. Solo sirve para volver exactamente a como estaba y
comparar; no es un estado operativo. Preferir volver a aplicar la Fase 15.

## Verificación tras aplicar

```sql
BEGIN;
SELECT tenant_process_sale(<company_id>, <branch_id>,
  '[{"product_id":"…","variant_id":"…","quantity":1,"discount":0}]', 'CASH');
ROLLBACK;   -- o confirmar y comprobar product_variants.stock
```

Debe devolver `{"success": true, "sale_id": …, …}`. Luego verificar que
`product_variants.stock` se descontó y que `tenant_delete_sale` lo devuelve.

## Nota sobre las ventas históricas

Las 55 ventas existentes tienen `sale_items.product_id` en `NULL`. No se
backfillea: sería adivinar el producto desde la variante (aunque es posible
vía `product_variants.product_id`), y queda como decisión aparte.
