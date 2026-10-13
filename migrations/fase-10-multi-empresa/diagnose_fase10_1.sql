-- ==========================================
-- Diagnóstico Fase 10.1 - Estado de multi-empresa
-- ==========================================
-- Ejecutar después de la migración 20261004000002 para validar.
-- TOLERANTE: si `company_memberships` aún no existe, las queries que la
--            referencian devuelven 0 / NULL.
-- ==========================================

-- 0. ¿Qué tablas existen?
SELECT
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'company_memberships') AS memberships_exists,
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'companies') AS companies_exists;

-- 1. ¿profiles.company_id sigue siendo NOT NULL? (debe ser 'NO' = nullable ahora)
SELECT
    column_name,
    is_nullable,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND column_name IN ('company_id', 'is_platform_admin')
ORDER BY column_name;

-- 2. Conteo de membresías por usuario (devuelve 0 filas si la tabla no existe)
SELECT
    CASE
        WHEN m_count = 1 THEN 'single (1)'
        WHEN m_count BETWEEN 2 AND 3 THEN 'multi (2-3)'
        ELSE 'power (4+)'
    END AS tipo_usuario,
    COUNT(*) AS usuarios
FROM (
    SELECT user_id, COUNT(*) AS m_count
    FROM company_memberships
    GROUP BY user_id
) sub
GROUP BY tipo_usuario
ORDER BY tipo_usuario;

-- 3. Usuarios SIN membresía (no deberían existir, una vez que 0001 corra)
SELECT COUNT(*) AS profiles_sin_membresia
FROM profiles p
WHERE NOT EXISTS (
    SELECT 1 FROM company_memberships m WHERE m.user_id = p.id
);

-- 4. Membresías huérfanas (company_id que no existe)
SELECT COUNT(*) AS membresias_huerfanas
FROM company_memberships m
WHERE NOT EXISTS (
    SELECT 1 FROM companies c WHERE c.id = m.company_id
);

-- 5. Distribución de roles en membresías
SELECT role, COUNT(*) AS total
FROM company_memberships
GROUP BY role
ORDER BY total DESC;

-- 6. ¿Cuántos usuarios tienen membresía por defecto?
SELECT
    COUNT(*) FILTER (WHERE is_default) AS con_default,
    COUNT(*) FILTER (WHERE NOT is_default) AS sin_default,
    COUNT(*) AS total
FROM company_memberships;

-- 7. ¿Hay usuarios con 2+ defaults? (no debería pasar)
SELECT user_id, COUNT(*) AS defaults
FROM company_memberships
WHERE is_default = true
GROUP BY user_id
HAVING COUNT(*) > 1;
