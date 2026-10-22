# Fase 14 — Auditoría de mutaciones + JWT `is_platform_admin`

Dos cambios que se apoyan entre sí:

1. **`audit_log`** — tabla que registra cada mutación de negocio (quién, cuándo, qué).
2. **Backfill de `app_metadata.is_platform_admin`** — claim que el middleware necesita para enrutar por rol sin consultar la BD.

## 1. `audit_log`

### Por qué existe

AUDIT.md §1 tenía esto pendiente:

> *Auditoría de logs: no hay logging de acciones sensibles (cambios de precio, anulaciones). Agregar tabla `audit_log`.*

Hoy no había forma de responder "quién anuló esta venta" o "quién cambió el precio de este producto". El único rastro eran 4 `console.log` sueltos en server actions, que no persisten.

### Qué se registra

**Solo mutaciones.** Los `SELECT` no se auditan: una fila por operación exitosa.

| Columna | Contenido |
|---|---|
| `company_id` | tenant sobre el que se operó (FK a `companies`) |
| `branch_id` | sucursal, si la acción es por sucursal |
| `actor_user_id` | quién |
| `actor_role` | rol del actor **en el momento** de la acción (no se recomputa) |
| `action` | nombre estable de la server action, p.ej. `processPOSSale` |
| `entity_type` / `entity_id` | qué se tocó (`sale`, `product`, `supplier`, …) |
| `payload` | argumentos/resultados relevantes (jsonb, **sin secretos**) |

### Seguridad

- RLS habilitado. `SELECT` solo para miembros de la misma empresa (mismo `EXISTS` sobre `company_memberships` que el resto de tablas multi-tenant).
- **Sin** políticas `INSERT`/`UPDATE`/`DELETE` para `authenticated`: la escritura es exclusiva de `service_role` (las server actions usan `supabaseAdmin`). Un usuario autenticado no puede plantar ni borrar entradas.
- Los técnicos de plataforma no ven logs de tenants: no tienen membresía, así que el `EXISTS` les da 0 filas.

### Escritura: `lib/audit.ts`

```ts
await audit(ctx, 'processPOSSale', 'sale', {
  branchId,
  entityId: result.sale_id,
  payload: { paymentMethod, total },
});
```

**Nunca lanza.** Si el `INSERT` falla, la operación de negocio ya se completó y no se revierte; queda constancia con `warnSilently`. Un fallo de auditoría no debe tumbar una venta en el POS.

`options.companyId` permite auditar sobre un tenant distinto al del actor: hace falta en la consola de plataforma, donde el actor es una cuenta sin empresa y actúa sobre cualquiera.

### Cobertura actual

32 llamadas en 12 archivos de server actions: POS/ventas (`processPOSSale`, `deleteSale`), caja (`openCashSession`, `closeCashSession`, `addExpense`), inventario (4), proveedores (9), gastos mayores (2), sucursales (3), usuarios (3), membresías (2) y consola de plataforma (2).

## 2. Backfill `app_metadata.is_platform_admin`

### Por qué existe

El middleware enruta por rol leyendo el JWT (sin tocar la BD). Para detectar cuentas de plataforma usaba:

```ts
const isPlatformAdmin = user?.app_metadata?.role === 'technician'
```

Ese patrón está **prohibido** por AGENTS.md §5, y con razón: `'technician'` también es un rol válido de membresía de empresa (`branch-memberships.ts` `ALLOWED_ROLES`). Cualquier miembro con ese rol se saltaba la validación de `company_id`.

La migración `fase-10-multi-empresa/20261004000008_sync_platform_admin_jwt.sql` lo había parcheado por el lado equivocado: escribía `role: 'technician'` en el JWT para que el patrón prohibido funcionara. El problema seguía ahí, solo que no reventaba.

**Esta migración cierra el hueco de verdad:** el claim pasa a ser `is_platform_admin` (boolean), espejo de `profiles.is_platform_admin`. `middleware.ts` ya lo lee.

Sin este backfill, los platform admins existentes se verían como usuarios de empresa y el middleware los redirigiría a `/no-tenant`. El backfill es **idempotente**: solo escribe cuando el valor difiere del esperado.

El código también lo mantiene fresco en adelante: `login()`, `switchActiveCompanyAction` y `switchActiveBranchAction` escriben `is_platform_admin` cada vez que tocan `app_metadata`.

## Orden de aplicación

```
1) 20261021000000_create_audit_log.sql
2) 20261021000001_backfill_platform_admin_jwt.sql
```

Son independientes entre sí; el orden es solo por legibilidad de la fase.

## Rollback

| Archivo | Qué revierte | Advertencia |
|---|---|---|
| `RK_20261021000000_drop_audit_log.sql` | borra `audit_log` | **pierde todo el historial**. Si solo querés dejar de escribir, basta desacoplar `lib/audit.ts` en el código |
| `RK_20261021000001_remove_platform_admin_claim.sql` | quita `is_platform_admin` de `app_metadata` | el middleware deja de reconocer técnicos. Aplicar **junto con** el revert de `middleware.ts` |

## Nota sobre `fase-10-multi-empresa/20261004000008`

Esa migración deja de ser necesaria para el middleware, pero **no se borra**: escribir `role: 'technician'` en `app_metadata` sigue siendo consistente con lo que devuelve `requireAuthContext` para cuentas de plataforma, y su `RK_*` ya existe. Solo queda documentada como superseded en lo que respecta al enrutado.
