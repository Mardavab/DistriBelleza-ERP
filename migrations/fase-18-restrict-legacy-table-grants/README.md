# Fase 18 — Revocar grants sobre tablas con RLS y sin policy

Cierra la trampa que marcaba el advisor `rls_enabled_no_policy`: tres tablas
con RLS habilitado y **0 políticas**, pero con grants que prometían acceso.

## El problema

En Postgres, **RLS sin policies = denegación total** para los roles que no son
el dueño ni tienen `BYPASSRLS`. La tabla está cerrada. Pero el GRANT decía lo
contrario:

```
{postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm}
                                     ↑ SELECT/INSERT/UPDATE/DELETE/
                                       TRUNCATE/REFERENCES/TRIGGER
```

Consecuencia, medida:

| Operación con cliente de usuario | Resultado |
|---|---|
| `SELECT * FROM categories` | **0 filas** (RLS filtra todo) — sin error |
| `INSERT INTO categories ...` | error de RLS |

**No es un error de permisos, es un vacío silencioso.** Un desarrollador que
escriba `createClient().from('categories').select('*')` en vez de
`supabaseAdmin` verá una lista vacía y no sabrá por qué. Es justo el tipo de
bug que cuesta un día entero.

Las tablas: `categories`, `invitations`, `tenant_migration_audit`.

## Por qué revocar en vez de añadir policies

Verifiqué los 7 accesos del código: **todos van por `supabaseAdmin`**
(`service_role`, bypasea RLS).

```
inventory_actions.ts:59,68,290   supabaseAdmin.from('categories')
users.ts:193,410,548             supabaseAdmin.from('invitations')
companies.ts:126                 supabaseAdmin.from('invitations')
```

`tenant_migration_audit` no se usa desde el código (es de la fase 1).

Si todo va a propósito por `service_role`, la denegación debe ser **explícita**
(error de permisos) y no silenciosa (0 filas). Revocar es más barato que diseñar
policies y elimina la trampa.

Si en el futuro hace falta leer `categories` con sesión de usuario, ahí sí se
diseñan policies por membresía (como las de `audit_log`, que usa un `EXISTS`
sobre `company_memberships`).

## Qué NO se toca

- **RLS sigue habilitado.** Es una segunda barrera, no se desactiva.
- **No se borra ninguna tabla.**
- **Las funciones `SECURITY DEFINER` siguen funcionando:** `accept_invitation`
  (lee `invitations`) y `tenant_search_inventory` (lee `categories`) corren como
  `postgres`, que es el **dueño** de las tablas. Los dueños no necesitan grants.

## Verificado antes de aplicar

- `categories` tiene 1 trigger (`tr_categories_updated_at`, `BEFORE UPDATE`,
  `SECURITY INVOKER`) — solo lo dispara quien actualice, que tras este cambio es
  `service_role`/`postgres`.
- Ninguna vista ni materialized view depende de estas 3 tablas.
- Ninguna policy de otras tablas las referencia.

## Matriz de permisos

| Tabla | `anon` | `authenticated` | `service_role` | `postgres` |
|---|---|---|---|---|
| `categories` | REVOKE | REVOKE | GRANT | dueño |
| `invitations` | REVOKE | REVOKE | GRANT | dueño |
| `tenant_migration_audit` | REVOKE | REVOKE | GRANT | dueño |

RLS queda habilitado en las 3, sin policies (coherente con el hecho de que solo
`service_role` las toca).

## Verificación

```sql
-- 1) el GRANT ya no promete lo que RLS no cumple
SELECT relname, relacl FROM pg_class
 WHERE relname IN ('categories','invitations','tenant_migration_audit');
-- {postgres=arwdDxtm/postgres, service_role=arwdDxtm/postgres}

-- 2) anon y authenticated reciben error de permisos, no 0 filas
BEGIN;
SET LOCAL ROLE authenticated;
SELECT count(*) FROM categories;   -- -> 42501: permission denied for table categories
ROLLBACK;

-- 3) service_role sigue funcionando
BEGIN;
SET LOCAL ROLE service_role;
SELECT count(*) FROM categories;
ROLLBACK;
```

La diferencia entre el punto 2 antes y después es exactamente lo que se busca:
antes `count(*) = 0`, ahora `42501: permission denied`. El problema deja de ser
invisible.

## Rollback

`RK_20261022000000_restore_legacy_table_grants.sql` restaura los grants
permisivos. Vuelve a la trampa silenciosa: es solo para comparar. Preferir
volver a aplicar la Fase 18.
