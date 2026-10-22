-- ============================================================
-- ROLLBACK RK_20261022000000_restore_permissive_rpc_grants.sql (Fase 16)
-- ============================================================
-- Revierte 20261022000000_harden_rpc_execute_grants.sql restaurando la ACL
-- que tenían las 8 funciones SECURITY DEFINER de `public`:
--
--     {=X/postgres, postgres=X/postgres, anon=X/postgres,
--      authenticated=X/postgres, service_role=X/postgres}
--
-- ⚠️  ADVERTENCIA — ESTE ROLLBACK VUELVE A UN ESTADO VULNERABLE.
--
-- Habilita de nuevo la ejecución anónima de `tenant_delete_sale` (borra ventas
-- e infla inventario) y `tenant_process_sale` (crea ventas falsas) directamente
-- contra PostgREST, sin login y sin pasar por las server actions. Es un "volver
-- exactamente a como estaba" para comparar comportamientos, no un estado
-- operativo.
--
-- Para revertir de verdad, preferir volver a aplicar la Fase 16.
--
-- Verificado: el snapshot previo a aplicar la Fase 16 es idéntico al que
-- restaura este archivo (todas las 8 con la misma ACL).
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.tenant_process_sale(uuid, uuid, jsonb, text, uuid, text, numeric, numeric, text)
    FROM authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.tenant_process_sale(uuid, uuid, jsonb, text, uuid, text, numeric, numeric, text)
    TO PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.tenant_delete_sale(uuid, uuid, uuid)
    FROM authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.tenant_delete_sale(uuid, uuid, uuid)
    TO PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.tenant_search_inventory(uuid, uuid, text, integer)
    FROM authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.tenant_search_inventory(uuid, uuid, text, integer)
    TO PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.tenant_transfer_stock(uuid, uuid, uuid, integer)
    FROM authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.tenant_transfer_stock(uuid, uuid, uuid, integer)
    TO PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.process_sale(uuid, jsonb, payment_method, transfer_type, numeric, uuid)
    FROM authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.process_sale(uuid, jsonb, payment_method, transfer_type, numeric, uuid)
    TO PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.accept_invitation(text)
    FROM anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.accept_invitation(text)
    TO PUBLIC;

REVOKE EXECUTE ON FUNCTION public.handle_new_user()
    FROM authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.handle_new_user()
    TO PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()
    FROM authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.rls_auto_enable()
    TO PUBLIC, anon;
