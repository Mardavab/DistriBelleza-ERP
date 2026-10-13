# Fase 10 — Multi-empresa por usuario

Esta fase cierra la promesa del roadmap multi-tenant: un mismo `auth.users`
puede pertenecer a **varias empresas** y activar la que necesite en cada
momento, con **rol por empresa** (no global).

## Cambios principales

| Concepto | Antes | Ahora |
|---|---|---|
| ¿A qué empresas pertenezco? | `profiles.company_id` (1) | `company_memberships` (N) |
| ¿Qué rol tengo? | `profiles.role` (global) | `company_memberships.role` (por empresa) |
| ¿Cuál está activa ahora? | implícita | `company_memberships.is_default` + cookie de selección |
| ¿Cómo se detecta un técnico? | `profiles.role = 'technician'` | `profiles.is_platform_admin = true` |

## Estructura de archivos creados/modificados

### Migraciones SQL (orden estricto)

```
migrations/fase-10-multi-empresa/
├── 20261004000000_memberships_create_table.sql      # ✅ Tabla (Fase 10.0)
├── 20261004000001_memberships_backfill.sql           # ✅ Backfill (Fase 10.0)
├── 20261004000002_profiles_drop_company_id_not_null.sql  # ⏳ Fase 10.1
├── 20261004000003_rls_memberships.sql                # ⏳ Fase 10.4 (legacy, reemplazada por 10.6)
├── 20261004000004_profiles_is_platform_admin.sql     # ⏳ Fase 10.5 (paso A)
├── 20261004000005_drop_profiles_role.sql             # ⏳ Fase 10.5 (paso B — último)
├── 20261004000006_rls_exclude_platform_admins.sql    # ⏳ Fase 10.6 (recomendada sobre 10.3)
├── 20261004000007_fix_handle_new_user_trigger.sql    # ⏳ Fase 10.7 (trigger sin `role`)
├── 20261004000008_sync_platform_admin_jwt.sql        # ⏳ Fase 10.8 (JWT.role para middleware)
├── diagnose_fase10_1.sql                             # Diagnóstico
├── RK_20261004000002_restore_company_id_not_null.sql # Rollback 10.1
├── RK_20261004000003_restore_jwt_rls.sql             # Rollback 10.4
├── RK_20261004000005_restore_profiles_role.sql       # Rollback 10.5
├── RK_20261004000006_restore_membership_rls.sql      # Rollback 10.6
├── RK_20261004000007_restore_handle_new_user_trigger.sql # Rollback 10.7
└── RK_20261004000008_remove_tech_role.sql            # Rollback 10.8
```

### Código TypeScript

```
lib/supabase/
├── memberships.ts            # NUEVO — tipos CompanyMembership, AuthContext
├── membership-queries.ts     # NUEVO — getUserMemberships, getActiveMembership, setDefaultMembership, isPlatformUser
├── auth-helpers.ts           # MODIFICADO — rol de membresía, no de profiles
├── company-context.ts        # MODIFICADO — devuelve null si no hay membresía
└── server.ts                 # sin cambios

app/actions/
├── auth.ts                   # MODIFICADO — getUserProfile expone memberships + is_platform_admin
├── memberships.ts            # NUEVO — switchActiveCompanyAction
└── users.ts                  # MODIFICADO — updateUser modifica membresía, acceptInvitation crea membresía

components/Dashboard/
├── CompanySelector.tsx       # NUEVO — dropdown de empresa activa
├── Dashboard.css             # MODIFICADO — estilos del selector
└── Sidebar.tsx               # MODIFICADO — incluye CompanySelector si memberships > 1

app/
├── page.tsx                  # MODIFICADO — usa is_platform_admin
└── ...

middleware.ts                # sin cambios (sigue usando app_metadata.role del JWT)
```

## Orden de aplicación

### Prerequisitos
- Haber ejecutado las fases 1-9 del roadmap multi-tenant.
- La tabla `company_memberships` ya debe existir (Fase 10.0, ya aplicada).

### Paso 1 — Desplegar código

Desplegar el código de esta rama PRIMERO (sin las migraciones 10.1+).
El sistema sigue funcionando igual porque:
- `requireAuthContext` ahora lee el rol de `company_memberships`, pero como
  la Fase 10.0 backfilleó las membresías desde `profiles`, los datos están.
- `getCurrentCompanyId` puede devolver `null` para técnicos, pero la página
  principal ya los detecta con `is_platform_admin`.
- El selector de empresa aparece vacío si no hay membresías; no rompe nada.

### Paso 2 — Migración 10.1 (DROP NOT NULL)

```bash
psql "$DATABASE_URL" -f migrations/fase-10-multi-empresa/20261004000002_profiles_drop_company_id_not_null.sql
psql "$DATABASE_URL" -f migrations/fase-10-multi-empresa/diagnose_fase10_1.sql
```

**Verificar:**
- `diagnose_fase10_1.sql` debe mostrar 0 perfiles sin membresía.
- `profiles.company_id` ahora es nullable.

### Paso 3 — Migración 10.4 (RLS por membresía)

```bash
psql "$DATABASE_URL" -f migrations/fase-10-multi-empresa/20261004000003_rls_memberships.sql
```

**Smoke test crítico:**

1. Login con un usuario de Distribelleza → sigue viendo los datos.
2. Crear un usuario de prueba en otra empresa (Empresa B) y darle membresía
   en A y B.
3. Login con ese usuario → debe ver datos de A y B (selector de empresa
   debería mostrar ambas).
4. Cambiar de empresa en el sidebar → debe actualizar la vista.

**Si falla:** ejecutar `RK_20261004000003_restore_jwt_rls.sql` para volver
a las políticas basadas en JWT.

> ℹ️ **Recomendado:** saltar 10.3 y aplicar directamente 10.6
> (`20261004000006_rls_exclude_platform_admins.sql`). Es un superset
> de 10.3 que además excluye platform admins de las políticas `membership_*`,
> evitando el agujero P0.5 descrito en el código de la migración.

### Paso 4 — Migración 10.5A (is_platform_admin)

```bash
psql "$DATABASE_URL" -f migrations/fase-10-multi-empresa/20261004000004_profiles_is_platform_admin.sql
```

**Verificar:**
- `SELECT is_platform_admin, COUNT(*) FROM profiles GROUP BY is_platform_admin;`
- Debe haber técnicos en `is_platform_admin = true`.

### Paso 5 — Migración 10.6 (RLS defensiva con exclusión de platform admins)

```bash
psql "$DATABASE_URL" -f migrations/fase-10-multi-empresa/20261004000006_rls_exclude_platform_admins.sql
```

Re-aplica las políticas RLS de 10.3 con la condición adicional
`AND NOT EXISTS(... is_platform_admin ...)` para que los técnicos
NO accedan a tablas per-tenant vía cliente autenticado. Acceden vía
`supabaseAdmin` (server actions de plataforma) que bypasea RLS.

### Paso 6 — Migración 10.8 (sincronizar JWT para platform admins)

```bash
psql "$DATABASE_URL" -f migrations/fase-10-multi-empresa/20261004000008_sync_platform_admin_jwt.sql
```

Puebla `app_metadata.role = 'technician'` en el `auth.users` de los
platform admins. Cierra el redirect loop `/` → `/no-tenant` → `/` que
sufrirían los técnicos si el middleware (que detecta por JWT) no
encontrara el claim.

### Paso 7 — Migración 10.7 (arreglar trigger `handle_new_user`)

```bash
psql "$DATABASE_URL" -f migrations/fase-10-multi-empresa/20261004000007_fix_handle_new_user_trigger.sql
```

⚠️ **DEBE correr antes de 10.5.** Reescribe la función del trigger para
que NO inserte la columna `role`. Si se ejecuta 10.5 antes que 10.7, todo
nuevo registro de usuario fallará con `column "role" does not exist`
(incluyendo el flujo de invitación `acceptInvitationAction`).

### Paso 8 — Migración 10.5B (DROP COLUMN role)

```bash
psql "$DATABASE_URL" -f migrations/fase-10-multi-empresa/20261004000005_drop_profiles_role.sql
```

⚠️ **Antes de ejecutar:** verificar que ningún código lee `profiles.role`.

```bash
grep -rn "profile\.role\|profiles\.role" --include="*.ts" --include="*.tsx" app components lib
```

El resultado debe ser 0 (excepto comentarios JSDoc que documenten la fase).

**Verificar:**
- `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role';`
- Debe devolver 0 filas.

## Rollback

Cada paso tiene su archivo `RK_*.sql` que revierte los cambios estructurales.
Los datos de membresías NO se borran en los rollbacks (son reversibles).

**Orden de rollback (si todo falla):**
1. `RK_20261004000005_restore_profiles_role.sql`
2. `RK_20261004000008_remove_tech_role.sql`
3. `RK_20261004000007_restore_handle_new_user_trigger.sql`
4. `RK_20261004000006_restore_membership_rls.sql` (o `RK_20261004000003_restore_jwt_rls.sql` si no se aplicó 10.6)
5. `RK_20261004000002_restore_company_id_not_null.sql`
6. Las membresías quedan en la tabla pero no se usan (reversible de forma trivial con `TRUNCATE company_memberships` si se quiere empezar de cero).

## Limitaciones conocidas

- **El JWT sigue cargando un único `company_id` activo.** Cambiar de empresa
  actualiza el JWT via `supabaseAdmin.auth.admin.updateUserById` y refresca
  la sesión del cliente (`window.location.reload()`).
- **El selector NO muestra empresas inactivas** (filtro pendiente en sub-fase futura).
- **No hay endpoint para que un owner agregue usuarios a su tenant directamente** (las invitaciones siguen siendo el único flujo).
- **El storage RLS sigue usando JWT company_id**, no membresías. Es
  coherente porque el JWT siempre lleva una empresa donde el usuario
  tiene membresía.
- **No se enviaron emails de invitación** (TODO pre-existente en
  `app/actions/users.ts:77`).
