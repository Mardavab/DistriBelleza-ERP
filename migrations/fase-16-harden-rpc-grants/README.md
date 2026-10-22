# Fase 16 — Endurecer los `EXECUTE` grants de las RPCs

Cierra el último hueco de seguridad de los que se detectaron: las 8 funciones
`SECURITY DEFINER` de `public` eran ejecutables **con la anon key**, o sea sin
ninguna sesión.

## El problema

`SECURITY DEFINER` hace que la función corra con los permisos de **quien la
creó** (`postgres`) y bypasee RLS. Eso es intencional: `tenant_process_sale`
necesita escribir en `sales`, `sale_items`, `product_variants` e
`inventory_movements`. El problema no es la función, es **quién puede
invocarla**.

La anon key es pública por diseño (está en `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
viaja al navegador). Con ella, cualquiera podía hacer:

```
POST https://<ref>.supabase.co/rest/v1/rpc/tenant_delete_sale
apikey: <anon key>
{"p_company_id":"…","p_branch_id":"…","p_sale_id":"…"}
```

Sin login, sin token de usuario y **sin pasar por Next.js**: se saltaba el
middleware, `requireRole`/`requireOwner` y la auditoría de la Fase 14.

| Función | Lo que permitía sin login |
|---|---|
| `tenant_delete_sale` | borrar ventas y `UPDATE product_variants SET stock = stock + qty` → inflar inventario |
| `tenant_process_sale` | crear ventas falsas con cualquier `company_id` + `branch_id` |
| `tenant_search_inventory` | leer el catálogo completo de cualquier tenant |
| `tenant_transfer_stock` | mover stock entre variantes |
| `process_sale` | legacy, sin llamadores |

**Nota de urgencia:** el hueco era teórico mientras las RPCs estaban rotas
(fallaban antes de escribir). La Fase 15 las reparó, con lo que el camino
quedó funcional — y por tanto explotable. Por eso se cierra ahora.

## Por qué un `REVOKE` simple no alcanza

`pg_default_acl` en el esquema `public` otorga `EXECUTE` a `anon` sobre **toda
función nueva**:

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
```

O sea, `anon` tiene grant **explícito** además del heredado de `PUBLIC`. Hay que
revocar de **ambos**.

Y hay que hacerlo **después** de cada `CREATE`: al recrear una función, los
default privileges le vuelven a dar `EXECUTE` a `anon`. Se observó exactamente
esto al hacer `DROP`+`CREATE` de `tenant_search_inventory` en la Fase 15 —
`anon` siguió con permiso pese al `GRANT` posterior.

```sql
SELECT p.proacl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname = 'tenant_search_inventory';
-- {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
```

## Matriz de permisos

| Función | `PUBLIC` | `anon` | `authenticated` | `service_role` | Motivo |
|---|---|---|---|---|---|
| `tenant_process_sale` | REVOKE | REVOKE | REVOKE | GRANT | solo server actions |
| `tenant_delete_sale` | REVOKE | REVOKE | REVOKE | GRANT | ídem |
| `tenant_search_inventory` | REVOKE | REVOKE | REVOKE | GRANT | ídem |
| `tenant_transfer_stock` | REVOKE | REVOKE | REVOKE | GRANT | sin llamadores |
| `process_sale` | REVOKE | REVOKE | REVOKE | GRANT | legacy, sin llamadores |
| `accept_invitation` | REVOKE | **GRANT** | GRANT | GRANT | **necesita anon** |
| `handle_new_user` | REVOKE | REVOKE | GRANT | GRANT | trigger |
| `rls_auto_enable` | REVOKE | REVOKE | GRANT | GRANT | event trigger |

### Por qué `accept_invitation` conserva `anon`

`app/accept-invitation/page.tsx:40` es un **server component** que se ejecuta
cuando el invitado **aún no tiene sesión**. Usa `createClient` de
`lib/supabase/server.ts`, que se autentica con la anon key: PostgREST lo ve
como rol `anon`. Sin este permiso se rompe la aceptación de invitaciones.

Es la única excepción, y está verificada: es el único `.rpc()` del repo que no
va por `supabaseAdmin`.

### Por qué las de trigger solo pierden `anon`

- `handle_new_user` → trigger `on_auth_user_created AFTER INSERT ON auth.users`,
  disparado por GoTrue al crear usuarios. **`anon` nunca inserta en `auth.users`.**
- `rls_auto_enable` → event trigger `ensure_rls` en `ddl_command_end`, disparado
  por quien ejecuta DDL. **`anon` nunca ejecuta DDL.**

Como `anon` no llega nunca a dispararlas, quitarle permiso es inocuo por
construcción — sin necesidad de resolver si Postgres chequea `EXECUTE` al
disparar. Se deja `authenticated` sin tocar por prudencia.

## Rutas de llamada verificadas (las 5 del repo)

| Archivo | Función | Cliente | Rol |
|---|---|---|---|
| `app/accept-invitation/page.tsx:40` | `accept_invitation` | `lib/supabase/server` (anon key) | `anon` |
| `app/actions/users.ts:382` | `accept_invitation` | `supabaseAdmin` | `service_role` |
| `app/actions/sales.ts:56` | `tenant_search_inventory` | `supabaseAdmin` | `service_role` |
| `app/actions/sales.ts:174` | `tenant_process_sale` | `supabaseAdmin` | `service_role` |
| `app/actions/sales_history.ts:66` | `tenant_delete_sale` | `supabaseAdmin` | `service_role` |

**4 de 5 van por `service_role`**, al que se le otorga explícitamente. La quinta
es `accept_invitation`, la excepción de arriba. Ningún `.rpc()` del repo pasa
por un cliente `authenticated`.

## Qué NO se toca

- **Default privileges.** Toda función nueva en `public` volverá a nacer con
  `EXECUTE` para `anon`: hay que revocarlo a mano después de crearla. Es una
  trampa silenciosa, documentada en AGENTS.md §5.
- **`SECURITY DEFINER` → `INVOKER`.** Haría que RLS bloqueara las escrituras y
  el POS dejara de funcionar.

## Rollback

`RK_20261022000000_restore_permissive_rpc_grants.sql` restaura la ACL exacta
previa (las 8 con `PUBLIC`, `anon`, `authenticated`, `service_role`). Es volver
a un estado **vulnerable**, solo para comparar. Preferir volver a aplicar la
Fase 16.

## Verificación

```sql
-- 1) anon ya no puede mutar
SELECT has_function_privilege('anon',
  'public.tenant_delete_sale(uuid,uuid,uuid)', 'EXECUTE');   -- false

-- 2) anon sí puede aceptar invitaciones
SELECT has_function_privilege('anon',
  'public.accept_invitation(text)', 'EXECUTE');              -- true

-- 3) service_role sigue pudiendo todo lo que usa la app
SELECT has_function_privilege('service_role',
  'public.tenant_process_sale(uuid,uuid,jsonb,text,uuid,text,numeric,numeric,text)', 'EXECUTE');  -- true
```

Prueba negativa desde fuera (demuestra que el hueco quedó cerrado):

```bash
curl -s -X POST "https://<ref>.supabase.co/rest/v1/rpc/tenant_delete_sale" \
  -H "apikey: <ANON_KEY>" -H "Content-Type: application/json" \
  -d '{"p_company_id":"…","p_branch_id":"…","p_sale_id":"…"}'
# -> {"code":"42501","message":"permission denied for function tenant_delete_sale"}
```

Y el smoke manual: `/accept-invitation?token=…` sin sesión debe cargar, y el POS
debe seguir registrando ventas.
