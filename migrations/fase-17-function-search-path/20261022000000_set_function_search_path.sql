-- ============================================================
-- Fase 17 — Fijar `search_path` en las funciones de `public`
-- ============================================================
--
-- Contexto:
--   El advisor de seguridad marcaba 9 funciones con `search_path` mutable
--   (`function_search_path_mutable`). Como 7 de ellas son SECURITY DEFINER,
--   el problema es de escalación de privilegios, no solo de estilo.
--
-- EL VECTOR (verificado en vivo, no teórico):
--   Cuando una función no fija `search_path`, Postgres usa el del rol que la
--   llama y busca en `pg_temp` PRIMERO (a menos que `pg_temp` se nombre
--   explícitamente en el search_path).
--
--   Medido en esta base:
--       has_database_privilege('anon', db, 'TEMP') = true
--       has_database_privilege('authenticated', db, 'TEMP') = true
--
--   O sea: `anon` (alcanzable sin login con la anon key) PUEDE crear tablas
--   temporales. Con eso basta para el ataque:
--
--     1. El atacante entra con la anon key.
--     2. CREATE TEMP TABLE invitations (token text, company_id uuid, role text,
--        email text, expires_at timestamptz, used_at timestamptz);
--        INSERT INTO invitations VALUES ('x', '<uuid>', 'owner', 'a@evil.com',
--                                       now() + interval '1 day', NULL);
--     3. Llama accept_invitation('x'), que hace
--            SELECT * INTO v_invitation FROM invitations WHERE token = p_token
--        Sin calificar el esquema, `invitations` resuelve a la tabla del
--        atacante (pg_temp se busca primero).
--     4. La función corre como `postgres` (SECURITY DEFINER) y devuelve
--        {"success": true, "role": "owner", ...} FORJADO.
--
--   El mismo truco sirve contra `tenant_process_sale` para leer precios de
--   una tabla `products`/`product_variants` falsa y así emitir ventas con
--   importes arbitrarios sin descontar stock real.
--
-- IMPACTO REAL HOY (por qué no es urgente pero sí hay que arreglarlo):
--   * La Fase 16 quitó `EXECUTE` a `anon` sobre las 5 RPCs de negocio. Sin
--     permiso de ejecución, no hay ataque sobre esas.
--   * `accept_invitation` sigue siendo invocable por `anon` (necesita serlo),
--     pero la creación real del usuario pasa por `acceptInvitationAction`
--     (app/actions/users.ts), que llama la RPC con `supabaseAdmin` EN OTRA
--     SESIÓN, donde no existen las tablas temporales del atacante. El forjado
--     no se propaga: el atacante solo logra engañarse a sí mismo.
--   * La Fase 17 es DEFENSA EN PROFUNDIDAD: cierra el vector para las
--     funciones actuales y para cualquier refactor futuro que exponga otra.
--
-- LA SOLUCIÓN:
--     SET search_path = public, extensions, pg_temp
--
--   Al NOMBRAR `pg_temp` explícitamente al final, deja de buscarse primero y
--   pasa a resolverse DESPUÉS de `public`. Entonces `FROM invitations` encuentra
--   `public.invitations` antes que `pg_temp.invitations`.
--
--   Se conservan `public` y `extensions` (que están en el search_path del
--     servidor: `"$user", public, extensions`) para no romper la resolución de
--   objetos existentes. No se usa `SET search_path = ''` porque los cuerpos
--   referencian tablas sin calificar esquema.
--
-- Las 9 funciones:
--   7 SECURITY DEFINER (el riesgo real):
--     accept_invitation, handle_new_user, process_sale, tenant_delete_sale,
--     tenant_process_sale, tenant_search_inventory, tenant_transfer_stock
--   2 SECURITY INVOKER (triggers, riesgo menor — corren como quien dispara):
--     prevent_modification, update_updated_at_column
--   rls_auto_enable ya lo tenía; no se toca.
--
-- REVERSIBLE: Sí, vía RK_20261022000000_unset_function_search_path.sql,
--             que vuelve a dejar el search_path resuelto por el rol llamador.
--
-- IDEMPOTENTE: Sí. ALTER FUNCTION ... SET es idempotente.
-- ============================================================

ALTER FUNCTION public.accept_invitation(text)
    SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.handle_new_user()
    SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.process_sale(uuid, jsonb, payment_method, transfer_type, numeric, uuid)
    SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.tenant_delete_sale(uuid, uuid, uuid)
    SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.tenant_process_sale(uuid, uuid, jsonb, text, uuid, text, numeric, numeric, text)
    SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.tenant_search_inventory(uuid, uuid, text, integer)
    SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.tenant_transfer_stock(uuid, uuid, uuid, integer)
    SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.prevent_modification()
    SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.update_updated_at_column()
    SET search_path = public, extensions, pg_temp;
