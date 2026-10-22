-- ============================================================
-- ROLLBACK RK_20261022000000_unset_function_search_path.sql (Fase 17)
-- ============================================================
-- Revierte 20261022000000_set_function_search_path.sql quitando el
-- `search_path` fijado en las 9 funciones de `public`.
--
-- ⚠️  ADVERTENCIA — ESTE ROLLBACK REABRE EL VECTOR DE ESCALACIÓN.
--
-- Sin `SET search_path`, las funciones vuelven a resolver los nombres de
-- objetos usando el search_path del rol que las llama, con `pg_temp` buscándose
-- PRIMERO. Como `anon` y `authenticated` pueden crear tablas temporales
-- (has_database_privilege(..., 'TEMP') = true), un caller puede hacer que
-- `FROM invitations` resuelva a su propia tabla temporal y forjar respuestas de
-- `accept_invitation`, o leer precios de `products`/`product_variants` falsas
-- para emitir ventas con importes arbitrarios.
--
-- Es un "volver exactamente a como estaba" para comparar comportamientos, no un
-- estado operativo. Preferir volver a aplicar la Fase 17.
--
-- La función `rls_auto_enable()` no se toca en ningún sentido: ya traía
-- `SET search_path` antes de esta fase.
-- ============================================================

ALTER FUNCTION public.accept_invitation(text) RESET search_path;
ALTER FUNCTION public.handle_new_user() RESET search_path;
ALTER FUNCTION public.process_sale(uuid, jsonb, payment_method, transfer_type, numeric, uuid) RESET search_path;
ALTER FUNCTION public.tenant_delete_sale(uuid, uuid, uuid) RESET search_path;
ALTER FUNCTION public.tenant_process_sale(uuid, uuid, jsonb, text, uuid, text, numeric, numeric, text) RESET search_path;
ALTER FUNCTION public.tenant_search_inventory(uuid, uuid, text, integer) RESET search_path;
ALTER FUNCTION public.tenant_transfer_stock(uuid, uuid, uuid, integer) RESET search_path;
ALTER FUNCTION public.prevent_modification() RESET search_path;
ALTER FUNCTION public.update_updated_at_column() RESET search_path;
