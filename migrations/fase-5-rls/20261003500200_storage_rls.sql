-- ==========================================
-- MIGRACIÓN 20261003500200 - Storage RLS con prefijo company_id
-- Fase 5 - RLS real (multi-tenant)
-- ==========================================================
-- OBJETIVO: Las políticas del bucket proveedores_archivos pasan a
--           filtrar por prefijo {company_id}/ en el path del archivo.
--           Esto aísla el storage entre tenants.
-- IDEMPOTENTE: Sí. DROP POLICY IF EXISTS + CREATE.
-- ==========================================================
-- ⚠️ IMPORTANTE:
--   - Esta migración REQUIERE que la app guarde archivos como
--     `{company_id}/{invoice_id}/{filename}` en vez de `{filename}`.
--   - Si tu app ya subió archivos sin el prefijo, esos archivos NO
--     estarán accesibles bajo las nuevas políticas (la primera carpeta
--     del path DEBE ser el company_id).
--   - Para no perder archivos: ejecuta primero una migración que copie
--     los archivos existentes a la estructura con prefijo, o ajusta la
--     app para que use el prefijo.
-- ==========================================================

BEGIN;

-- Eliminar políticas antiguas del bucket
DROP POLICY IF EXISTS "Archivos de proveedores legibles por todos"          ON storage.objects;
DROP POLICY IF EXISTS "Usuarios autenticados pueden subir archivos a proveedores" ON storage.objects;
DROP POLICY IF EXISTS "Usuarios autenticados pueden actualizar archivos de proveedores"  ON storage.objects;
DROP POLICY IF EXISTS "Usuarios autenticados pueden eliminar archivos de proveedores"    ON storage.objects;

-- Nuevas políticas con prefijo {company_id}/
CREATE POLICY "tenant_storage_read" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'proveedores_archivos'
        AND (storage.foldername(name))[1] =
            (auth.jwt() -> 'app_metadata' ->> 'company_id')::text
    );

CREATE POLICY "tenant_storage_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'proveedores_archivos'
        AND (storage.foldername(name))[1] =
            (auth.jwt() -> 'app_metadata' ->> 'company_id')::text
    );

CREATE POLICY "tenant_storage_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id = 'proveedores_archivos'
        AND (storage.foldername(name))[1] =
            (auth.jwt() -> 'app_metadata' ->> 'company_id')::text
    );

CREATE POLICY "tenant_storage_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'proveedores_archivos'
        AND (storage.foldername(name))[1] =
            (auth.jwt() -> 'app_metadata' ->> 'company_id')::text
    );

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- Debe devolver 4 políticas nuevas con prefijo 'tenant_storage_':
--
-- SELECT policyname FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects'
--   AND policyname LIKE 'tenant_storage_%'
-- ORDER BY policyname;
-- ==========================================

-- ==========================================
-- ACTUALIZACIÓN REQUERIDA EN CÓDIGO TYPESCRIPT
-- ==========================================
-- El helper uploadInvoiceFile() en app/actions/suppliers.ts debe
-- prefijar el filename con company_id:
--
--   const companyId = await getCurrentCompanyId()
--   const fileName = `${companyId}/${prefix}-${Date.now()}.${fileExt}`
--
-- Sin este cambio, los uploads nuevos fallarán con RLS.
-- ==========================================