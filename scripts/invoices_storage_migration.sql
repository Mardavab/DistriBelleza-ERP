-- ==========================================
-- MIGRACIÓN: Soporte de archivos para proveedores
-- Ejecutar en Supabase SQL Editor
-- ==========================================

-- 1. Añadir columnas para fotos/comprobantes y datos adicionales de facturación
ALTER TABLE supplier_invoices 
ADD COLUMN IF NOT EXISTS invoice_file_url TEXT,
ADD COLUMN IF NOT EXISTS receipt_file_url TEXT,
ADD COLUMN IF NOT EXISTS billed_to VARCHAR(200),
ADD COLUMN IF NOT EXISTS invoice_type VARCHAR(50) DEFAULT 'remision';

-- 2. Crear el bucket de Storage para archivos de proveedores
INSERT INTO storage.buckets (id, name, public)
VALUES ('proveedores_archivos', 'proveedores_archivos', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Políticas de seguridad para el bucket 'proveedores_archivos'

-- Permitir lectura pública de los archivos
DROP POLICY IF EXISTS "Archivos de proveedores legibles por todos" ON storage.objects;
CREATE POLICY "Archivos de proveedores legibles por todos" 
ON storage.objects FOR SELECT
USING ( bucket_id = 'proveedores_archivos' );

-- Permitir a usuarios autenticados subir archivos
DROP POLICY IF EXISTS "Usuarios autenticados pueden subir archivos a proveedores" ON storage.objects;
CREATE POLICY "Usuarios autenticados pueden subir archivos a proveedores" 
ON storage.objects FOR INSERT 
TO authenticated 
WITH CHECK ( bucket_id = 'proveedores_archivos' );

-- Permitir a usuarios autenticados actualizar sus archivos
DROP POLICY IF EXISTS "Usuarios autenticados pueden actualizar archivos de proveedores" ON storage.objects;
CREATE POLICY "Usuarios autenticados pueden actualizar archivos de proveedores" 
ON storage.objects FOR UPDATE 
TO authenticated 
USING ( bucket_id = 'proveedores_archivos' );

-- Permitir a usuarios autenticados eliminar archivos
DROP POLICY IF EXISTS "Usuarios autenticados pueden eliminar archivos de proveedores" ON storage.objects;
CREATE POLICY "Usuarios autenticados pueden eliminar archivos de proveedores" 
ON storage.objects FOR DELETE 
TO authenticated 
USING ( bucket_id = 'proveedores_archivos' );
