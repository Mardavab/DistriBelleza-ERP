# Fase 17 — Fijar `search_path` en las funciones de `public`

Cierra el vector de escalación de privilegios que el advisor marcaba como
`function_search_path_mutable` sobre 9 funciones.

## El problema

Cuando una función no fija `search_path`, Postgres usa el del rol que la llama
y busca en **`pg_temp` primero** (a menos que `pg_temp` se nombre explícitamente
en el `search_path`).

En esta base se verificó que el vector es usable:

```sql
SELECT has_database_privilege('anon', current_database(), 'TEMP');          -- true
SELECT has_database_privilege('authenticated', current_database(), 'TEMP'); -- true
```

`anon` es alcanzable sin login con la anon key (pública, está en
`NEXT_PUBLIC_SUPABASE_ANON_KEY`). Así que cualquiera puede hacer:

```sql
CREATE TEMP TABLE invitations (
  token text, company_id uuid, role text, email text,
  expires_at timestamptz, used_at timestamptz
);
INSERT INTO invitations VALUES ('x', '<uuid>', 'owner', 'a@evil.com',
                               now() + interval '1 day', NULL);
```

y luego llamar `accept_invitation('x')`. Como esa función hace:

```sql
SELECT * INTO v_invitation FROM invitations WHERE token = p_token
```

sin calificar el esquema, `invitations` resuelve a **la tabla del atacante**. La
función corre como `postgres` (SECURITY DEFINER) y devuelve
`{"success": true, "role": "owner", ...}` forjado.

El mismo truco aplica contra `tenant_process_sale`: se puede hacer que lea
precios de `products`/`product_variants` falsas y así emitir ventas con
importes arbitrarios sin descontar stock real.

## Impacto real hoy

**Bajo, pero no por mérito nuestro:**

- La **Fase 16** quitó `EXECUTE` a `anon` sobre las 5 RPCs de negocio. Sin
  permiso de ejecución, no hay ataque sobre esas.
- `accept_invitation` sigue siendo invocable por `anon` (necesita serlo para que
  el invitado pueda aceptar), pero la creación real del usuario pasa por
  `acceptInvitationAction` (`app/actions/users.ts:382`), que llama la RPC con
  `supabaseAdmin` **en otra sesión** — donde no existen las tablas temporales del
  atacante. El forjado no se propaga: el atacante solo logra engañarse a sí mismo.

Esta fase es **defensa en profundidad**: cierra el vector para las funciones
actuales y para cualquier refactor futuro que exponga otra.

## La solución

```sql
ALTER FUNCTION public.accept_invitation(text)
    SET search_path = public, extensions, pg_temp;
```

Al **nombrar `pg_temp` explícitamente al final**, deja de buscarse primero y
pasa a resolverse **después** de `public`. Entonces `FROM invitations` encuentra
`public.invitations` antes que `pg_temp.invitations`.

Se conservan `public` y `extensions` (que ya están en el `search_path` del
servidor: `"$user", public, extensions`) para no romper la resolución de objetos
existentes. No se usa `SET search_path = ''` porque los cuerpos referencian
tablas sin calificar esquema.

## Las 9 funciones

| Función | Modo | Riesgo |
|---|---|---|
| `accept_invitation` | SECURITY DEFINER | **alto** — invocable por `anon` |
| `tenant_process_sale` | SECURITY DEFINER | alto (ya sin `EXECUTE` para `anon` desde fase-16) |
| `tenant_delete_sale` | SECURITY DEFINER | alto (ídem) |
| `tenant_search_inventory` | SECURITY DEFINER | alto (ídem) |
| `tenant_transfer_stock` | SECURITY DEFINER | medio (sin llamadores) |
| `process_sale` | SECURITY DEFINER | medio (legacy) |
| `handle_new_user` | SECURITY DEFINER | medio (trigger de `auth.users`) |
| `prevent_modification` | SECURITY INVOKER | bajo (trigger, corre como quien dispara) |
| `update_updated_at_column` | SECURITY INVOKER | bajo (ídem) |

`rls_auto_enable()` **ya traía** `SET search_path` y no se toca.

## Verificación

```sql
-- 1) las 9 quedan con search_path fijado
SELECT p.proname,
       pg_get_functiondef(p.oid) LIKE '%SET search_path%' AS fijado
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname IN (...);

-- 2) prueba de ataque: una tabla temporal ya no sombrea a la real
BEGIN;
SET LOCAL ROLE anon;
CREATE TEMP TABLE invitations (token text, company_id uuid, role text,
                               email text, expires_at timestamptz, used_at timestamptz);
INSERT INTO invitations VALUES ('x','00000000-0000-0000-0000-000000000000',
                               'owner','a@evil.com', now() + interval '1 day', NULL);
SELECT accept_invitation('x');   -- debe devolver "Invitación inválida o expirada"
ROLLBACK;                        -- NO {"success":true, "role":"owner"}
```

Con la tabla temporal presente y el `search_path` fijado, `FROM invitations`
resuelve a `public.invitations` y el token forjado no existe → la función
rechaza. Eso demuestra que el sombreado quedó neutralizado.

## Rollback

`RK_20261022000000_unset_function_search_path.sql` hace `RESET search_path` en
las 9. Reabre el vector: es solo para comparar comportamientos. Preferir volver
a aplicar la Fase 17.
