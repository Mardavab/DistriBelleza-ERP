# Fase 11 — Multi-sucursal

Esta fase extiende la Fase 10 (multi-empresa por usuario) con la noción de **sucursal** dentro de cada empresa. Un dueño puede tener varios locales del mismo negocio, cada uno con su propio inventario, ventas, caja y operaciones.

## Modelo de datos

```
companies (1) ──< branches (N) ──< branch_memberships >── auth.users
                  │                    (sucursal asignada)
                  │
                  ├──< branch_stock >── product_variants (catálogo empresa)
                  │
                  └── en: sales, sale_items, cash_sessions,
                       inventory_movements, customer_payments,
                       expenses, supplier_payments, supplier_invoices,
                       audit_logs, major_expenses
                       (todas con branch_id NOT NULL)
```

- **Catálogo compartido** por empresa: `products`, `customers`, `suppliers`, `categories`, `company_settings`.
- **Operaciones por sucursal**: las 10 tablas de arriba con `branch_id` NOT NULL.
- **Membresía de sucursal**: `branch_memberships` (un usuario con company_membership puede tener cero o más branch_memberships en las sucursales de esa empresa).

## Cambios principales

| Concepto | Antes | Ahora |
|---|---|---|
| ¿En qué empresa estoy? | `company_memberships` | igual (Fase 10) |
| ¿En qué sucursal estoy? | implícito (toda la empresa) | `branch_memberships` + JWT `app_metadata.branch_id` |
| ¿Mi rol en cada sucursal? | implícito | `branch_memberships.role` (puede variar) |
| ¿Hay stock por sucursal? | No, stock único en `product_variants.stock` | Sí, `branch_stock` por (branch, variant) |
| ¿Cómo cambia el POS de sucursal? | No aplica | `switchActiveBranchAction` + selector en sidebar |

## Estructura de archivos

### Migraciones SQL (orden estricto)

```
migrations/fase-11-multi-sucursal/
├── 20261101000000_create_branches.sql                  # ✅ Tabla branches + RLS + backfill MAIN
├── 20261101000001_branch_memberships.sql               # ✅ Tabla branch_memberships + backfill
├── 20261101000002_create_branch_stock.sql              # ✅ Tabla branch_stock + backfill
├── 20261101000003_add_branch_id_to_tables.sql          # ✅ branch_id en 10 tablas operativas
├── 20261101000004_tenant_rpc_with_branch.sql           # ✅ RPC tenant_* parametrizados con p_branch_id
├── 20261101000005_rls_with_branches.sql                # ✅ RLS con branch_memberships
├── 20261101000006_sync_branch_id_to_jwt.sql            # ⏳ Post-deploy — sincroniza JWT con is_default
├── 20261101000007_remove_branch_stock.sql              # ✅ Remueve branch_stock (rollback de 11.2)
├── 20261101000008_invitations_branch_id.sql            # ✅ branch_id en invitations + backfill
├── RK_20261101000000_drop_branches.sql                 # Rollback
├── RK_20261101000001_drop_branch_memberships.sql       # Rollback
├── RK_20261101000002_drop_branch_stock.sql             # Rollback
├── RK_20261101000003_drop_branch_id_from_tables.sql    # Rollback
├── RK_20261101000004_restore_tenant_rpc_no_branch.sql  # Rollback
├── RK_20261101000005_restore_company_only_rls.sql      # Rollback
├── RK_20261101000006_remove_branch_from_jwt.sql        # Rollback 11.6
└── RK_20261101000008_drop_invitations_branch_id.sql    # Rollback 11.8
```

### Código TypeScript

```
lib/supabase/
├── branches.ts                          # NUEVO (Bloque B) — tipos Branch, BranchMembership
├── branch-membership-queries.ts         # NUEVO (Bloque B) — getUserBranches, getActiveBranch, setDefaultBranch, isUserInBranch, getCompanyIdForBranch
├── branch-context.ts                    # NUEVO (Bloque B) — getCurrentBranchId, getCurrentBranchIdSafe, requireBranchContext
└── (memberships.ts, company-context.ts sin cambios)

app/actions/
├── branches.ts                          # NUEVO (Bloque B) — CRUD: list, create, update, deactivate
├── branch-memberships.ts                # NUEVO (Bloque B) — assignUserToBranch, removeUserFromBranch, switchActiveBranch
└── (sales, inventory_actions, sales_history, cash_actions, reports, users) — refactor Bloque C

components/
├── Dashboard/BranchSelector.tsx         # NUEVO (Bloque C) — selector de sucursal activa
└── Dashboard/BranchManagement.tsx       # NUEVO (Bloque C) — gestión de sucursales para owners
```

## Orden de aplicación

### Prerequisitos
- Fase 10 cerrada (`company_memberships` existe, `profiles.role` eliminado, RLS por membrisía activo).
- Bloque B aplicado (branches, branch_memberships, branch_stock existen con backfill).
- Branch_id NOT NULL en las 10 tablas operativas.
- Project ID Supabase: `rphfzkmzvitgfimcrzkb`.

### Pasos (Bloque B + C, en este orden EXACTO)

```bash
# BLOQUE B
# 1. Crear tabla branches + backfill MAIN por empresa
psql "$DATABASE_URL" -f migrations/fase-11-multi-sucursal/20261101000000_create_branches.sql

# 2. Crear branch_memberships + backfill (1 membrisía por company_membership en MAIN)
psql "$DATABASE_URL" -f migrations/fase-11-multi-sucursal/20261101000001_branch_memberships.sql

# 3. Crear branch_stock + backfill (stock inicial en MAIN)
psql "$DATABASE_URL" -f migrations/fase-11-multi-sucursal/20261101000002_create_branch_stock.sql

# 4. branch_id en 10 tablas operativas (requiere disable temporal de triggers inmutables)
psql "$DATABASE_URL" -f migrations/fase-11-multi-sucursal/20261101000003_add_branch_id_to_tables.sql

# BLOQUE C
# 5. RPC tenant_* parametrizados con p_branch_id (cambia firma de las funciones)
psql "$DATABASE_URL" -f migrations/fase-11-multi-sucursal/20261101000004_tenant_rpc_with_branch.sql

# 6. RLS con branch_memberships (cierra el filtro a nivel de sucursal)
psql "$DATABASE_URL" -f migrations/fase-11-multi-sucursal/20261101000005_rls_with_branches.sql

# POST-DEPLOY (puede aplicarse en cualquier momento tras 11.1)
# 7. Sincronizar app_metadata.branch_id en JWTs para usuarios existentes.
#    Idempotente. Los JWTs cacheados en el cliente NO se refrescan solos:
#    el usuario debe cerrar sesión y volver a entrar, o el cliente debe
#    llamar supabase.auth.refreshSession().
#    El código TS tiene un fallback automático (branch-context.ts) que
#    usa is_default mientras el JWT no traiga branch_id, por lo que
#    la app sigue funcionando hasta el próximo refresh.
psql "$DATABASE_URL" -f migrations/fase-11-multi-sucursal/20261101000006_sync_branch_id_to_jwt.sql

# 8. (Opcional, recomendado) branch_id en invitations.
#    Backfillea la sucursal MAIN para invitaciones pendientes.
#    Habilita el flujo "invitar a UNA sucursal" del Commit 3.
psql "$DATABASE_URL" -f migrations/fase-11-multi-sucursal/20261101000008_invitations_branch_id.sql
```

### Verificación post-aplicación

```sql
-- Esperado: 2 sucursales MAIN (1 por empresa), 3 branch_memberships, 125 branch_stock
SELECT
  (SELECT COUNT(*) FROM branches WHERE is_main = true) AS main_branches,
  (SELECT COUNT(*) FROM branch_memberships WHERE is_default) AS default_branch_memberships,
  (SELECT COUNT(*) FROM branch_stock) AS branch_stock_rows,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'branch_id'
     AND is_nullable = 'NO'
     AND table_name IN ('sales','sale_items','cash_sessions','inventory_movements',
                        'customer_payments','expenses','supplier_payments',
                        'supplier_invoices','audit_logs','major_expenses')
  ) AS tables_with_branch_id_not_null;
```

## Limitaciones conocidas

- **El JWT sigue cargando un único `branch_id` activo.** Cambiar de sucursal actualiza el JWT via `supabaseAdmin.auth.admin.updateUserById` y refresca la sesión.
- **Las primeras cargas de la app tras Fase 11 no tienen `branch_id` en el JWT** (campo nuevo). El sistema tolera el null mediante un fallback automático en `branch-context.ts`: si el JWT no trae `branch_id`, se usa la membrisía `is_default = true` (Fase 11.6). Como side-effect, el JWT se sincroniza en background para que el próximo refresh de sesión ya traiga el claim.
- **Los JWTs cacheados en el navegador NO se actualizan automáticamente** tras aplicar la migración 11.6. El usuario debe cerrar sesión y volver a entrar, o el cliente debe llamar `supabase.auth.refreshSession()`. Hasta que lo haga, el fallback de `branch-context.ts` mantiene la app funcional.
- **El catálogo (products, customers, suppliers) sigue siendo compartido por empresa.** Multi-sucursal no crea catálogo por sucursal.
- **El stock se concentra en MAIN tras el backfill.** Para repartirlo entre sucursales nuevas, se usa `tenant_transfer_stock` (RPC de Fase 3, sigue transfiriendo entre variantes de la misma empresa; no entre sucursales). La distribución inicial entre sucursales se hace manualmente con updates a `branch_stock`.
- **server actions sin cobertura Bloque C** (fuera del scope del refactor pero afectadas por `branch_id` NOT NULL): `app/actions/major_expenses.ts` (insert/update sin branch_id), `app/actions/suppliers.ts` (acciones que escriben en tablas con branch_id como expenses, supplier_invoices). Estas acciones ROMPEN al ejecutarse contra la nueva estructura hasta que se parcheen. PENDIENTE: Bloque D o siguiente commit.

## Bloque C — Estado al cierre

✅ RPCs parametrizados con `p_branch_id` (migración 11.4)
✅ RLS con `branch_memberships` (migración 11.5)
✅ Code TS refactor: sales, inventory, sales_history, cash_actions, reports, users (acceptInvitationAction con `branch_ids`)
✅ UI: `BranchSelector` (debajo de CompanySelector, label estático si solo 1 sucursal)
✅ UI: `BranchManagement` (tab nuevo en sidebar, solo owners)
✅ Reportes: toggle "Sucursal actual" / "Empresa completa" (solo owners)
✅ Fallback de `branch_id` desde `is_default` (Fase 11.6 — `branch-context.ts`)
✅ Migración 11.6 para sincronizar JWTs pre-existentes con `is_default`
✅ Migración 11.7 (`branch_sync_needed` en `getUserProfile` + reload defensivo en `app/page.tsx`)
✅ Migración 11.8 (`branch_id` en `invitations` + fallback MAIN + invitación a UNA sucursal)

## Post-Fase 11.6 — Notas operativas

**Bug pre-11.6:** los usuarios existentes (pre-Fase 11) tienen JWTs cacheados sin `app_metadata.branch_id`, lo que hacía que `requireBranchContext()` lanzara `NO_BRANCH_CONTEXT` y todas las páginas fallaran.

**Fix (Fase 11.6):**

1. **Migración SQL `20261101000006_sync_branch_id_to_jwt.sql`**: puebla `app_metadata.branch_id` para todos los usuarios con `branch_memberships.is_default=true`. Idempotente.

2. **Fallback en `branch-context.ts`**: cuando el JWT no trae `branch_id`, se usa la membrisía `is_default`. Como side-effect, el JWT se sincroniza via `supabaseAdmin.auth.admin.updateUserById` para que el próximo refresh ya traiga el claim. Preserva `company_id` y `role` del app_metadata existente (no los pisa).

3. **Helper `getUserDefaultBranchId(userId)`**: exportado para callers que necesiten resolver el default sin pasar por la lógica JWT.

**Importante:** los JWTs cacheados en navegadores NO se invalidan automáticamente. Los usuarios deben refrescar sesión (logout/login o `supabase.auth.refreshSession()`) para que el claim aparezca en el JWT. Hasta entonces, el fallback mantiene la app funcional.
