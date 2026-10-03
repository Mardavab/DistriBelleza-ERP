-- ==========================================
-- MIGRACIÓN DE PRUEBA - Crear usuario para Empresa B
-- ==========================================
-- PROPÓSITO: Solo para testing de aislamiento multi-tenant.
--            Crea un usuario de prueba en Empresa B con rol owner.
--            Así puedes verificar que:
--              - Empresa B no ve datos de Distribelleza
--              - Distribelleza no ve datos de Empresa B
-- ==========================================
-- ⚠️ IMPORTANTE: Este script requiere un paso manual previo en el
--   Dashboard de Supabase. Las instrucciones están abajo.
-- ==========================================

-- ============================================================
-- PASO 0: Crear el usuario en Supabase Dashboard (manual)
-- ============================================================
-- 1. Supabase Dashboard > Authentication > Users > Add user > Create new user
-- 2. Email:        test-empresa-b@distribelleza.com
-- 3. Password:     TestEmpresaB2026!
-- 4. Auto Confirm: ✓ (marcado)
-- 5. Click "Create user"
--
-- Esto crea la fila en auth.users. El trigger handle_new_user
-- (actualizado en Fase 3) crea automáticamente la fila en profiles
-- con company_id = Distribelleza (fallback). Lo vamos a corregir abajo.
--
-- ⚠️ NO ejecutes las queries de abajo hasta haber creado el usuario.
-- ============================================================

-- ============================================================
-- PASO 1: Asignar company_id = Empresa B en auth.users.app_metadata
-- ============================================================
-- (Esto actualiza el JWT del usuario al re-login)

UPDATE auth.users
SET raw_app_meta_data =
    COALESCE(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object(
        'company_id', '22222222-2222-2222-2222-222222222222',
        'role', 'owner'
    )
WHERE email = 'test-empresa-b@distribelleza.com';

-- ============================================================
-- PASO 2: Actualizar el profile del usuario
-- ============================================================

UPDATE profiles
SET
    company_id = '22222222-2222-2222-2222-222222222222',
    role = 'owner',
    full_name = 'Test Empresa B'
WHERE id = (
    SELECT id FROM auth.users
    WHERE email = 'test-empresa-b@distribelleza.com'
);

-- ============================================================
-- PASO 3: Insertar datos de prueba en Empresa B
-- ============================================================
-- (Crea productos y proveedores para Empresa B para probar aislamiento)

INSERT INTO products (company_id, name, brand, price_base, active)
VALUES
    ('22222222-2222-2222-2222-222222222222', 'Producto Secreto B1', 'MarcaB', 5000, true),
    ('22222222-2222-2222-2222-222222222222', 'Producto Secreto B2', 'MarcaB', 8000, true);

INSERT INTO suppliers (company_id, name, active)
VALUES
    ('22222222-2222-2222-2222-222222222222', 'Proveedor Exclusivo B', true);

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
-- Después de ejecutar todo:

-- 1. Verificar que el usuario tiene company_id correcto:
-- SELECT u.email, u.raw_app_meta_data->>'company_id' as company_id, p.role
-- FROM auth.users u
-- JOIN profiles p ON p.id = u.id
-- WHERE u.email = 'test-empresa-b@distribelleza.com';
-- → Debe mostrar company_id = '22222222-2222-2222-2222-222222222222'

-- 2. Verificar que Empresa B tiene sus propios datos:
-- SELECT 'Distribelleza' as empresa, COUNT(*) as productos FROM products
-- WHERE company_id = '11111111-1111-1111-1111-111111111111'
-- UNION ALL
-- SELECT 'Empresa B', COUNT(*) FROM products
-- WHERE company_id = '22222222-2222-2222-2222-222222222222';
-- → Distribelleza tiene sus productos (los que ya tenías)
-- → Empresa B tiene 2 productos

-- ============================================================
-- SIGUIENTE PASO EN TU TEST
-- ============================================================
-- 1. Logout del usuario actual (Distribelleza)
-- 2. Login como test-empresa-b@distribelleza.com / TestEmpresaB2026!
-- 3. Ve al módulo Inventario y Productos
--    → Solo debes ver "Producto Secreto B1" y "Producto Secreto B2"
--    → NO debes ver los productos de Distribelleza
-- 4. Ve al módulo Proveedores
--    → Solo debes ver "Proveedor Exclusivo B"
--    → NO debes ver los proveedores de Distribelleza
--
-- ✅ Si esto funciona, el aislamiento multi-tenant está completo.
-- ============================================================