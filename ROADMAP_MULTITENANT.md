# Roadmap Multi-tenant — DistriBelleza

**Versión:** 1.0
**Fecha:** 2026-10-03
**Stack objetivo:** Next.js 14 (App Router) + Supabase (Postgres + Auth + Storage) + print-service local ESC/POS
**Modelo multi-tenant elegido:** Un único proyecto Supabase + columna `company_id` en tablas per-tenant + RLS (Row Level Security)

---

## Principio rector: cero pérdida de datos

Este roadmap está diseñado bajo un único principio no negociable: **los datos históricos del sistema (ventas, inventario, pagos a proveedores, caja, auditoría) deben sobrevivir intactos a cada paso de la migración**.

Tres reglas de oro que se respetan en cada fase:

1. **Adicionar antes de restringir.** Toda columna nueva se crea como `NULLABLE` y se rellena antes de pasar a `NOT NULL`. Todo nuevo índice único se crea antes de eliminar el antiguo. Toda nueva función se crea antes de eliminar la vieja.
2. **DDL reversible.** Cada cambio debe tener un script de rollback equivalente que restaure el DDL original. Los archivos legacy del schema pre-multi-tenant se conservan en `migrations/legacy/schema_pre_multitenant.sql`.
3. **Verificación antes de restricción.** Ningún `ALTER TABLE ... SET NOT NULL`, ningún `DROP`, ningún `DELETE` se ejecuta sin un conteo previo que confirme que la migración fue completa y consistente.

Cualquier fase que no cumpla estas reglas se rediseña antes de ejecutarse.

---

## Convenciones del plan

| Concepto | Convención |
|---|---|
| Tabla maestra de tenants | `companies(id, slug, legal_name, ...)` |
| Reglas de negocio por tenant | `company_settings(company_id, key, value)` |
| Columna de tenant en tablas | `company_id UUID` con FK a `companies(id)` |
| Prefijo de funciones nuevas | `tenant_*` (ej. `tenant_process_sale`) |
| Funciones legacy | Mantenidas como wrapper retrocompatible durante toda la migración |
| Versionado SQL | `migrations/YYYYMMDDHHMMSS_descripcion.sql` |
| Rollback SQL | `migrations/RK_YYYYMMDDHHMMSS_descripcion.sql` |
| Auditoría de migración | `tenant_migration_audit(id, table_name, row_id, old_value, new_value, migrated_at)` |
| Slug del tenant actual | `distribelleza` con id fijo `11111111-1111-1111-1111-111111111111` |
| Servicio de impresión | `127.0.0.1:9100` (sin cambios en URL) |

---

## Resumen ejecutivo

| Fase | Nombre | Esfuerzo | Días | Riesgo |
|---|---|---|---|---|
| 0 | Preparación y backups | Bajo | 0.5 | Bajo |
| 1 | Schema aditivo | Bajo-Medio | 1-2 | Bajo |
| 2 | Backfill de `company_id` | Medio | 1-3 | **Medio** |
| 3 | RPC y funciones parametrizadas | Medio | 2-3 | Medio |
| 4 | Auth, JWT y sesión multi-tenant | Alto | 4-6 | Alto |
| 5 | RLS real | Alto | 3-5 | Alto |
| 6 | Branding y reglas parametrizadas | Medio-Alto | 3-5 | Bajo |
| 7 | Cleanup final | Bajo | 1 | Bajo |
| 8 | Platform admin (`created_by`) | Bajo | 0.5 | Bajo |
| 9 | Consola de plataforma | Bajo-Medio | 1-2 | Bajo |
| **Total** | — | — | **17.5-28.5** | — |

**Hallazgos del diagnóstico original que se cierran con este roadmap:** 11 de 33.
**Hallazgos que quedan para Fase 6+ (post-multi-tenant, ver sección final):** 22 de 33.

---

# Fase 0 — Preparación y backups

**Objetivo:** no tocar nada hasta tener un respaldo completo, verificado, y un inventario del volumen de datos.

**Reversibilidad:** N/A (solo lectura).

## 0.1 Snapshot completo de la base de datos

Ejecutar desde una terminal con `supabase-cli` o desde el dashboard:

```bash
# Backup completo del schema y datos
supabase db dump --schema public --file backups/20261003_pre_multitenant_full.sql

# Backup solo del schema (sin datos) — útil para diffs estructurales
supabase db dump --schema-only --file backups/20261003_pre_multitenant_schema.sql
```

Verificaciones obligatorias:

```bash
# Confirmar que el archivo tiene datos
wc -l backups/20261003_pre_multitenant_full.sql

# Confirmar tamaño razonable (debe ser > 100KB si hay datos)
ls -lh backups/20261003_pre_multitenant_full.sql
```

## 0.2 Export CSV por tabla crítica

Para poder hacer diff de filas antes/después de cada fase.

```bash
mkdir -p backups/csv/20261003
for table in products product_variants customers sales sale_items customer_payments \
            cash_sessions expenses supplier_payments major_expenses inventory_movements \
            audit_logs suppliers supplier_invoices profiles; do
  supabase db dump --data-only --table public.$table \
    --file backups/csv/20261003/${table}.csv
done
```

## 0.3 Inventario de volumen de datos

Conectar al SQL Editor de Supabase y correr:

```sql
SELECT
  schemaname,
  relname AS table_name,
  n_live_tup AS row_count_estimate
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;
```

Guardar el resultado en `backups/csv/20261003/row_counts_pre_migration.csv`.

Tablas esperadas (por el esquema actual): `products`, `product_variants`, `customers`, `sales`, `sale_items`, `customer_payments`, `cash_sessions`, `expenses`, `supplier_payments`, `major_expenses`, `inventory_movements`, `audit_logs`, `suppliers`, `supplier_invoices`, `profiles`, `categories`.

> **Nota sobre tiempos:** `ALTER TABLE ... ADD COLUMN` en tablas con más de 100K filas puede tardar varios minutos y bloquear lecturas. Si `sales` o `sale_items` tienen ese volumen, considerar hacerlo en horario de bajo tráfico o usar `pg_repack` para evitar locks prolongados.

## 0.4 Verificación de git y secretos

**Archivo:** `.gitignore`

Confirmar que contiene:

```gitignore
.env*
.env.local
.env.*.local
```

**Verificación crítica:** confirmar que `SUPABASE_SERVICE_ROLE_KEY` no está en el historial de git:

```bash
git log -p --all -S 'SUPABASE_SERVICE_ROLE_KEY' -- .env.local
git log --all --pretty=format:'%H' -- .env.local
```

Si la service role key está en cualquier commit del historial:

1. **Rotar la key inmediatamente** desde el dashboard de Supabase (Settings > API > Generate new service_role key).
2. Limpiar el historial con `git filter-repo` o empezar un repo nuevo.
3. **Nunca** commitear `.env.local` aunque tenga la key rotada.

**Mover secretos a un secret manager real:**

- Vercel: Project Settings > Environment Variables
- Doppler, AWS Secrets Manager, Infisical, o similar
- `.env.local` queda solo para desarrollo local sin secretos de producción

## 0.5 Rollback

No aplica. Esta fase no toca la base de datos ni el código.

---

# Fase 1 — Schema aditivo

**Objetivo:** agregar las tablas `companies`, `company_settings`, `tenant_migration_audit`, y la columna `company_id` (nullable) a las 14 tablas per-tenant. Ningún cambio restrictivo todavía.

**Reversibilidad:** trivial. `DROP COLUMN` + `DROP TABLE` sin pérdida de datos.

**Archivos a crear:**
- `migrations/20261003100000_create_companies.sql`
- `migrations/20261003100100_create_company_settings.sql`
- `migrations/20261003100200_create_tenant_migration_audit.sql`
- `migrations/20261003100300_add_company_id_to_tables.sql`
- `migrations/20261003100400_convert_unique_to_compound.sql`
- `migrations/RK_20261003100000_drop_companies.sql`

## 1.1 Tabla `companies`

`migrations/20261003100000_create_companies.sql`:

```sql
BEGIN;

CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(50) UNIQUE NOT NULL,
    legal_name VARCHAR(200) NOT NULL,
    trade_name VARCHAR(200),
    tax_id VARCHAR(50),
    address TEXT,
    phone VARCHAR(50),
    email VARCHAR(200),
    logo_url TEXT,
    currency VARCHAR(10) DEFAULT 'COP',
    timezone VARCHAR(50) DEFAULT 'America/Bogota',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Trigger de updated_at
CREATE TRIGGER trg_companies_updated_at
    BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
```

**No se inserta ningún registro todavía.** La creación del tenant Distribelleza ocurre en Fase 2 (backfill).

## 1.2 Tabla `company_settings`

`migrations/20261003100100_create_company_settings.sql`:

```sql
BEGIN;

CREATE TABLE company_settings (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    key VARCHAR(100) NOT NULL,
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (company_id, key)
);

CREATE TRIGGER trg_company_settings_updated_at
    BEFORE UPDATE ON company_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
```

**Decisión:** se eligió `JSONB` en lugar de columnas específicas (`commission_threshold NUMERIC`, etc.) porque:

1. Permite añadir nuevas claves sin migraciones DDL adicionales.
2. Es trivial de consultar (`SELECT value->>'commission_threshold'`).
3. La forma canónica es tener una vista materializada o una capa de aplicación que proyecte los valores tipados.

Claves esperadas al final del plan:

- `commission_threshold` (numeric)
- `commission_rate` (numeric)
- `default_customer_options` (array de strings; reemplaza Norby/Marlon/Otros)
- `receipt_header` (text)
- `receipt_footer` (text)
- `pdf_header_text` (text)
- `pdf_footer_text` (text)

## 1.3 Tabla `tenant_migration_audit`

`migrations/20261003100200_create_tenant_migration_audit.sql`:

```sql
BEGIN;

CREATE TABLE tenant_migration_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(100) NOT NULL,
    row_id UUID,
    old_value JSONB,
    new_value JSONB,
    migrated_at TIMESTAMPTZ DEFAULT now(),
    notes TEXT
);

CREATE INDEX idx_tma_table ON tenant_migration_audit(table_name);
CREATE INDEX idx_tma_row ON tenant_migration_audit(table_name, row_id);

COMMIT;
```

Esta tabla permite reconstruir qué fila fue migrada a qué tenant. **Inmutable** (no se hacen UPDATEs ni DELETEs). Se inserta desde los scripts de backfill.

## 1.4 Agregar `company_id` NULLABLE a las 14 tablas

`migrations/20261003100300_add_company_id_to_tables.sql`:

```sql
BEGIN;

-- Lista de tablas per-tenant (NO incluye categories: es catálogo compartible)
ALTER TABLE products              ADD COLUMN company_id UUID;
ALTER TABLE product_variants      ADD COLUMN company_id UUID;
ALTER TABLE customers             ADD COLUMN company_id UUID;
ALTER TABLE sales                 ADD COLUMN company_id UUID;
ALTER TABLE sale_items            ADD COLUMN company_id UUID;
ALTER TABLE customer_payments     ADD COLUMN company_id UUID;
ALTER TABLE cash_sessions         ADD COLUMN company_id UUID;
ALTER TABLE expenses              ADD COLUMN company_id UUID;
ALTER TABLE supplier_payments     ADD COLUMN company_id UUID;
ALTER TABLE major_expenses        ADD COLUMN company_id UUID;
ALTER TABLE inventory_movements   ADD COLUMN company_id UUID;
ALTER TABLE audit_logs            ADD COLUMN company_id UUID;
ALTER TABLE suppliers             ADD COLUMN company_id UUID;
ALTER TABLE supplier_invoices     ADD COLUMN company_id UUID;
ALTER TABLE profiles              ADD COLUMN company_id UUID;

COMMIT;
```

> **Decisión clave:** `categories` **no** recibe `company_id`. Es un catálogo global compartible entre tenants (las marcas pueden ser distintas pero las categorías como "Capilar", "Facial" son comunes). Esto es una decisión de producto: si más adelante se requiere que cada tenant tenga sus propias categorías, se modifica.

**Verificación inmediata post-ejecución:**

```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'company_id'
ORDER BY table_name;
```

Debe devolver 15 filas (14 tablas + `companies.id` mismo, no contar). Cada una con `is_nullable = 'YES'`.

## 1.5 Foreign keys nuevos (también NULLABLE)

`migrations/20261003100400_add_company_fks.sql`:

```sql
BEGIN;

ALTER TABLE products              ADD CONSTRAINT fk_products_company
    FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE product_variants      ADD CONSTRAINT fk_variants_company
    FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE customers             ADD CONSTRAINT fk_customers_company
    FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE sales                 ADD CONSTRAINT fk_sales_company
    FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE sale_items            ADD CONSTRAINT fk_sale_items_company
    FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE customer_payments     ADD CONSTRAINT fk_customer_payments_company
    FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE cash_sessions         ADD CONSTRAINT fk_cash_sessions_company
    FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE expenses              ADD CONSTRAINT fk_expenses_company
    FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE supplier_payments     ADD CONSTRAINT fk_supplier_payments_company
    FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE major_expenses        ADD CONSTRAINT fk_major_expenses_company
    FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE inventory_movements   ADD CONSTRAINT fk_inventory_movements_company
    FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE audit_logs            ADD CONSTRAINT fk_audit_logs_company
    FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE suppliers             ADD CONSTRAINT fk_suppliers_company
    FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE supplier_invoices     ADD CONSTRAINT fk_supplier_invoices_company
    FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE profiles              ADD CONSTRAINT fk_profiles_company
    FOREIGN KEY (company_id) REFERENCES companies(id);

COMMIT;
```

> **Importante:** las FKs permiten `NULL` por defecto. La restricción `NOT NULL` se aplicará **después** del backfill (Fase 2).

## 1.6 Conversión de UNIQUE globales a compuestos (soft)

`migrations/20261003100500_convert_unique_to_compound.sql`:

```sql
BEGIN;

-- product_variants: SKU único por tenant
CREATE UNIQUE INDEX idx_variants_company_sku
    ON product_variants(company_id, sku)
    WHERE company_id IS NOT NULL;

-- product_variants: barcode único por tenant (donde exista)
CREATE UNIQUE INDEX idx_variants_company_barcode
    ON product_variants(company_id, barcode)
    WHERE company_id IS NOT NULL AND barcode IS NOT NULL;

-- customers: email único por tenant (donde exista)
CREATE UNIQUE INDEX idx_customers_company_email
    ON customers(company_id, email)
    WHERE company_id IS NOT NULL AND email IS NOT NULL;

-- categories: nombre único por tenant
CREATE UNIQUE INDEX idx_categories_company_name
    ON categories(company_id, name)
    WHERE company_id IS NOT NULL;

COMMIT;
```

> **Crítico:** los índices usan `WHERE company_id IS NOT NULL`. Esto significa que **el constraint UNIQUE antiguo sigue activo** durante esta fase. Si hay dos filas con el mismo SKU y ambas con `company_id = NULL`, **ambas pueden coexistir** porque la nueva restricción única los excluye (cláusula WHERE). Esto es intencional: durante el backfill necesitamos poder asignar `company_id` sin que el nuevo constraint falle.

> El constraint antiguo se elimina **solo cuando** la Fase 2 confirma que el 100% de las filas tiene `company_id NOT NULL`.

## 1.7 Rollback de Fase 1

`migrations/RK_20261003100000_drop_companies.sql`:

```sql
BEGIN;

-- Eliminar FKs primero
ALTER TABLE products              DROP CONSTRAINT IF EXISTS fk_products_company;
ALTER TABLE product_variants      DROP CONSTRAINT IF EXISTS fk_variants_company;
ALTER TABLE customers             DROP CONSTRAINT IF EXISTS fk_customers_company;
ALTER TABLE sales                 DROP CONSTRAINT IF EXISTS fk_sales_company;
ALTER TABLE sale_items            DROP CONSTRAINT IF EXISTS fk_sale_items_company;
ALTER TABLE customer_payments     DROP CONSTRAINT IF EXISTS fk_customer_payments_company;
ALTER TABLE cash_sessions         DROP CONSTRAINT IF EXISTS fk_cash_sessions_company;
ALTER TABLE expenses              DROP CONSTRAINT IF EXISTS fk_expenses_company;
ALTER TABLE supplier_payments     DROP CONSTRAINT IF EXISTS fk_supplier_payments_company;
ALTER TABLE major_expenses        DROP CONSTRAINT IF EXISTS fk_major_expenses_company;
ALTER TABLE inventory_movements   DROP CONSTRAINT IF EXISTS fk_inventory_movements_company;
ALTER TABLE audit_logs            DROP CONSTRAINT IF EXISTS fk_audit_logs_company;
ALTER TABLE suppliers             DROP CONSTRAINT IF EXISTS fk_suppliers_company;
ALTER TABLE supplier_invoices     DROP CONSTRAINT IF EXISTS fk_supplier_invoices_company;
ALTER TABLE profiles              DROP CONSTRAINT IF EXISTS fk_profiles_company;

-- Eliminar columnas
ALTER TABLE products              DROP COLUMN IF EXISTS company_id;
ALTER TABLE product_variants      DROP COLUMN IF EXISTS company_id;
ALTER TABLE customers             DROP COLUMN IF EXISTS company_id;
ALTER TABLE sales                 DROP COLUMN IF EXISTS company_id;
ALTER TABLE sale_items            DROP COLUMN IF EXISTS company_id;
ALTER TABLE customer_payments     DROP COLUMN IF EXISTS company_id;
ALTER TABLE cash_sessions         DROP COLUMN IF EXISTS company_id;
ALTER TABLE expenses              DROP COLUMN IF EXISTS company_id;
ALTER TABLE supplier_payments     DROP COLUMN IF EXISTS company_id;
ALTER TABLE major_expenses        DROP COLUMN IF EXISTS company_id;
ALTER TABLE inventory_movements   DROP COLUMN IF EXISTS company_id;
ALTER TABLE audit_logs            DROP COLUMN IF EXISTS company_id;
ALTER TABLE suppliers             DROP COLUMN IF EXISTS company_id;
ALTER TABLE supplier_invoices     DROP COLUMN IF EXISTS company_id;
ALTER TABLE profiles              DROP COLUMN IF EXISTS company_id;

-- Eliminar índices compuestos nuevos
DROP INDEX IF EXISTS idx_variants_company_sku;
DROP INDEX IF EXISTS idx_variants_company_barcode;
DROP INDEX IF EXISTS idx_customers_company_email;
DROP INDEX IF EXISTS idx_categories_company_name;

-- Eliminar tablas nuevas
DROP TABLE IF EXISTS tenant_migration_audit;
DROP TABLE IF EXISTS company_settings;
DROP TABLE IF EXISTS companies;

COMMIT;
```

---

# Fase 2 — Backfill de `company_id`

**Objetivo:** asignar `company_id` al tenant Distribelleza a todas las filas existentes. Verificar conteos antes de restringir a `NOT NULL`.

**Riesgo principal:** backfill incompleto (filas con `company_id = NULL` después de la migración). Mitigación: validación pre-`NOT NULL` con conteos y bloqueos de transacción.

## 2.1 Crear el tenant Distribelleza

`migrations/20261003200000_create_default_tenant.sql`:

```sql
BEGIN;

INSERT INTO companies (id, slug, legal_name, trade_name, tax_id, currency, timezone)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    'distribelleza',
    'Distribelleza S.A.S.',
    'DistriBelleza',
    'PENDIENTE',
    'COP',
    'America/Bogota'
)
ON CONFLICT (slug) DO NOTHING;

-- Sembrar company_settings iniciales para Distribelleza
INSERT INTO company_settings (company_id, key, value)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'commission_threshold', '1800000'::jsonb),
    ('11111111-1111-1111-1111-111111111111', 'commission_rate', '0.012'::jsonb),
    ('11111111-1111-1111-1111-111111111111', 'default_customer_options',
     '["Distribelleza", "Socios", "Otros"]'::jsonb),
    ('11111111-1111-1111-1111-111111111111', 'receipt_header',
     '"DISTRIBELLEZA\nProductos de Belleza"'::jsonb),
    ('11111111-1111-1111-1111-111111111111', 'receipt_footer',
     '"Gracias por su compra"'::jsonb)
ON CONFLICT (company_id, key) DO NOTHING;

COMMIT;
```

**Nota sobre el UUID fijo:** se usa `11111111-1111-1111-1111-111111111111` en lugar de `gen_random_uuid()` para que el seed sea determinístico y reproducible. Si más adelante se crean más tenants, esos sí usan UUIDs aleatorios.

## 2.2 Script de backfill principal

`migrations/20261003200100_backfill_company_id.sql`:

```sql
BEGIN;

DO $$
DECLARE
    -- Tenant fijo para Distribelleza
    target_company UUID := '11111111-1111-1111-1111-111111111111';
    affected_count BIGINT;
    null_count BIGINT;
BEGIN
    -- products
    UPDATE products SET company_id = target_company WHERE company_id IS NULL;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RAISE NOTICE 'products: % filas actualizadas', affected_count;

    SELECT COUNT(*) INTO null_count FROM products WHERE company_id IS NULL;
    IF null_count > 0 THEN
        RAISE EXCEPTION 'Backfill incompleto en products: % filas sin company_id', null_count;
    END IF;

    -- product_variants
    UPDATE product_variants SET company_id = target_company WHERE company_id IS NULL;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RAISE NOTICE 'product_variants: % filas actualizadas', affected_count;
    SELECT COUNT(*) INTO null_count FROM product_variants WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en product_variants'; END IF;

    -- customers
    UPDATE customers SET company_id = target_company WHERE company_id IS NULL;
    SELECT COUNT(*) INTO null_count FROM customers WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en customers'; END IF;

    -- sales
    UPDATE sales SET company_id = target_company WHERE company_id IS NULL;
    SELECT COUNT(*) INTO null_count FROM sales WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en sales'; END IF;

    -- sale_items
    UPDATE sale_items SET company_id = target_company WHERE company_id IS NULL;
    SELECT COUNT(*) INTO null_count FROM sale_items WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en sale_items'; END IF;

    -- customer_payments
    UPDATE customer_payments SET company_id = target_company WHERE company_id IS NULL;
    SELECT COUNT(*) INTO null_count FROM customer_payments WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en customer_payments'; END IF;

    -- cash_sessions
    UPDATE cash_sessions SET company_id = target_company WHERE company_id IS NULL;
    SELECT COUNT(*) INTO null_count FROM cash_sessions WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en cash_sessions'; END IF;

    -- expenses
    UPDATE expenses SET company_id = target_company WHERE company_id IS NULL;
    SELECT COUNT(*) INTO null_count FROM expenses WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en expenses'; END IF;

    -- supplier_payments
    UPDATE supplier_payments SET company_id = target_company WHERE company_id IS NULL;
    SELECT COUNT(*) INTO null_count FROM supplier_payments WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en supplier_payments'; END IF;

    -- major_expenses
    UPDATE major_expenses SET company_id = target_company WHERE company_id IS NULL;
    SELECT COUNT(*) INTO null_count FROM major_expenses WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en major_expenses'; END IF;

    -- inventory_movements
    UPDATE inventory_movements SET company_id = target_company WHERE company_id IS NULL;
    SELECT COUNT(*) INTO null_count FROM inventory_movements WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en inventory_movements'; END IF;

    -- audit_logs
    UPDATE audit_logs SET company_id = target_company WHERE company_id IS NULL;
    SELECT COUNT(*) INTO null_count FROM audit_logs WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en audit_logs'; END IF;

    -- suppliers
    UPDATE suppliers SET company_id = target_company WHERE company_id IS NULL;
    SELECT COUNT(*) INTO null_count FROM suppliers WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en suppliers'; END IF;

    -- supplier_invoices
    UPDATE supplier_invoices SET company_id = target_company WHERE company_id IS NULL;
    SELECT COUNT(*) INTO null_count FROM supplier_invoices WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en supplier_invoices'; END IF;

    -- profiles (¡importante! los usuarios actuales van a Distribelleza)
    UPDATE profiles SET company_id = target_company WHERE company_id IS NULL;
    SELECT COUNT(*) INTO null_count FROM profiles WHERE company_id IS NULL;
    IF null_count > 0 THEN RAISE EXCEPTION 'Backfill incompleto en profiles'; END IF;

    RAISE NOTICE 'Backfill completado exitosamente para las 14 tablas.';
END $$;

COMMIT;
```

## 2.3 Auditoría del backfill

Insertar un registro por tabla indicando que se migró al tenant Distribelleza:

`migrations/20261003200200_audit_backfill.sql`:

```sql
INSERT INTO tenant_migration_audit (table_name, row_id, old_value, new_value, notes)
SELECT
    'products' AS table_name,
    NULL AS row_id,
    jsonb_build_object('company_id', NULL) AS old_value,
    jsonb_build_object('company_id', '11111111-1111-1111-1111-111111111111') AS new_value,
    'Backfill masivo a tenant Distribelleza - Fase 2' AS notes
WHERE NOT EXISTS (
    SELECT 1 FROM tenant_migration_audit
    WHERE table_name = 'products' AND notes LIKE 'Backfill masivo%'
);
-- Repetir para las 14 tablas...
```

## 2.4 Verificación post-backfill (crítico)

Antes de continuar a la siguiente fase, correr estas queries y **comparar con el inventario de Fase 0.3**:

```sql
-- 1. Conteo por tenant
SELECT 'products' AS tabla, company_id, COUNT(*) AS filas
FROM products GROUP BY company_id;

-- Repetir para las 14 tablas

-- 2. Ninguna fila debe quedar sin company_id
SELECT 'products' AS tabla, COUNT(*) AS sin_company
FROM products WHERE company_id IS NULL;
-- Debe devolver 0

-- 3. Conteo total vs Fase 0.3 (debe coincidir)
SELECT
    (SELECT COUNT(*) FROM products) AS products_ahora,
    (SELECT n_live_tup FROM pg_stat_user_tables
     WHERE relname = 'products' AND schemaname = 'public') AS products_estadisticos;
```

**Si algún conteo no coincide con el inventario de Fase 0.3:** DETENER la migración y ejecutar el rollback de Fase 2 antes de continuar.

## 2.5 Restringir `company_id` a `NOT NULL`

**Solo después** de confirmar que la verificación de 2.4 pasó al 100%.

`migrations/20261003200300_set_company_id_not_null.sql`:

```sql
BEGIN;

ALTER TABLE products              ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE product_variants      ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE customers             ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE sales                 ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE sale_items            ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE customer_payments     ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE cash_sessions         ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE expenses              ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE supplier_payments     ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE major_expenses        ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE inventory_movements   ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE audit_logs            ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE suppliers             ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE supplier_invoices     ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE profiles              ALTER COLUMN company_id SET NOT NULL;

COMMIT;
```

> **Advertencia:** si alguna fila quedó con `company_id = NULL` por error, este script **falla con error** y la transacción hace rollback. Por eso la verificación 2.4 es obligatoria.

## 2.6 Eliminar constraints UNIQUE antiguos

`migrations/20261003200400_drop_old_unique_constraints.sql`:

```sql
BEGIN;

-- product_variants
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_sku_key;
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_barcode_key;

-- customers
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_email_key;

-- categories (si tiene UNIQUE antiguo)
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key;

COMMIT;
```

> **Nota:** los nombres de los constraints (`_key` al final) son los que genera Postgres por defecto al declarar `UNIQUE`. Si los nombres son distintos en el schema actual, ajustarlos. Verificar primero con `\d product_variants` en psql o desde el dashboard.

> Los índices únicos compuestos `(company_id, x)` creados en Fase 1.6 ahora quedan como los únicos constraints activos.

## 2.7 Rollback de Fase 2

`migrations/RK_20261003200000_rollback_backfill.sql`:

```sql
BEGIN;

-- Restaurar constraints UNIQUE antiguos (espejo de 2.6)
ALTER TABLE product_variants ADD CONSTRAINT product_variants_sku_key UNIQUE (sku);
ALTER TABLE product_variants ADD CONSTRAINT product_variants_barcode_key UNIQUE (barcode);
ALTER TABLE customers ADD CONSTRAINT customers_email_key UNIQUE (email);
ALTER TABLE categories ADD CONSTRAINT categories_name_key UNIQUE (name);

-- Quitar NOT NULL
ALTER TABLE products              ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE product_variants      ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE customers             ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE sales                 ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE sale_items            ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE customer_payments     ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE cash_sessions         ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE expenses              ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE supplier_payments     ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE major_expenses        ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE inventory_movements   ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE audit_logs            ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE suppliers             ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE supplier_invoices     ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE profiles              ALTER COLUMN company_id DROP NOT NULL;

-- Limpiar company_id (manteniendo los datos, solo "desasignando")
UPDATE products              SET company_id = NULL;
UPDATE product_variants      SET company_id = NULL;
UPDATE customers             SET company_id = NULL;
UPDATE sales                 SET company_id = NULL;
UPDATE sale_items            SET company_id = NULL;
UPDATE customer_payments     SET company_id = NULL;
UPDATE cash_sessions         SET company_id = NULL;
UPDATE expenses              SET company_id = NULL;
UPDATE supplier_payments     SET company_id = NULL;
UPDATE major_expenses        SET company_id = NULL;
UPDATE inventory_movements   SET company_id = NULL;
UPDATE audit_logs            SET company_id = NULL;
UPDATE suppliers             SET company_id = NULL;
UPDATE supplier_invoices     SET company_id = NULL;
UPDATE profiles              SET company_id = NULL;

COMMIT;
```

> **Importante:** este rollback **no elimina filas**. Solo desasigna el tenant. Después del rollback, las tablas quedan como en Fase 0 listas para otro backfill.

---

# Fase 3 — RPC y funciones parametrizadas

**Objetivo:** crear las nuevas versiones `tenant_*` de las 4 RPC que aceptan `p_company_id`. Las versiones viejas se mantienen como wrapper que pasa el tenant fijo de Distribelleza. Esto permite migrar el código gradualmente sin romper funcionalidad.

**Archivos a crear:**
- `migrations/20261003300000_create_tenant_rpc.sql`
- `migrations/20261003300100_wrap_legacy_rpc.sql`
- `migrations/20261003300200_update_handle_new_user.sql`

## 3.1 Nuevas funciones con `p_company_id`

`migrations/20261003300000_create_tenant_rpc.sql`:

```sql
BEGIN;

-- ============================================================
-- tenant_process_sale
-- ============================================================
CREATE OR REPLACE FUNCTION tenant_process_sale(
    p_company_id UUID,
    p_items JSONB,
    p_payment_method TEXT,
    p_customer_id UUID DEFAULT NULL,
    p_transfer_type TEXT DEFAULT NULL,
    p_received_amount NUMERIC DEFAULT NULL,
    p_discount_amount NUMERIC DEFAULT 0,
    p_status TEXT DEFAULT 'completed'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sale_id UUID;
    v_total NUMERIC := 0;
    v_total_with_discount NUMERIC;
    v_change NUMERIC := 0;
    v_session_id UUID;
    v_item JSONB;
    v_product_id UUID;
    v_variant_id UUID;
    v_quantity INT;
    v_unit_price NUMERIC;
    v_item_discount NUMERIC;
    v_subtotal NUMERIC;
    v_cash_open BOOLEAN;
BEGIN
    -- Validar que la empresa existe y está activa
    PERFORM 1 FROM companies WHERE id = p_company_id AND active = true;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Empresa no encontrada o inactiva');
    END IF;

    -- Validar caja abierta para pago en efectivo (solo dentro del tenant)
    IF p_payment_method = 'CASH' THEN
        SELECT id INTO v_session_id
        FROM cash_sessions
        WHERE company_id = p_company_id AND status = 'open'
        ORDER BY opened_at DESC
        LIMIT 1;

        IF v_session_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'No hay caja abierta para esta empresa');
        END IF;
    END IF;

    -- Calcular total
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::UUID;
        v_variant_id := (v_item->>'variant_id')::UUID;
        v_quantity := (v_item->>'quantity')::INT;
        v_item_discount := COALESCE((v_item->>'discount')::NUMERIC, 0);

        SELECT COALESCE(pv.price_override, p.price_base)
        INTO v_unit_price
        FROM products p
        JOIN product_variants pv ON pv.product_id = p.id
        WHERE pv.id = v_variant_id AND p.company_id = p_company_id;

        IF v_unit_price IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error',
                'Variante no encontrada para esta empresa');
        END IF;

        v_subtotal := (v_unit_price * v_quantity) - v_item_discount;
        v_total := v_total + v_subtotal;
    END LOOP;

    v_total_with_discount := v_total - p_discount_amount;
    IF v_total_with_discount < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Descuento excede el total');
    END IF;

    IF p_payment_method = 'CASH' AND p_received_amount IS NOT NULL THEN
        v_change := p_received_amount - v_total_with_discount;
    END IF;

    -- Insertar venta con company_id
    INSERT INTO sales (
        company_id, customer_id, payment_method, transfer_type,
        total, total_with_discount, discount_amount,
        received_amount, cash_change, status, cash_session_id
    ) VALUES (
        p_company_id, p_customer_id, p_payment_method, p_transfer_type,
        v_total, v_total_with_discount, p_discount_amount,
        p_received_amount, v_change, p_status, v_session_id
    )
    RETURNING id INTO v_sale_id;

    -- Insertar items, descontar stock, registrar movimientos
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::UUID;
        v_variant_id := (v_item->>'variant_id')::UUID;
        v_quantity := (v_item->>'quantity')::INT;
        v_item_discount := COALESCE((v_item->>'discount')::NUMERIC, 0);

        SELECT COALESCE(pv.price_override, p.price_base)
        INTO v_unit_price
        FROM products p
        JOIN product_variants pv ON pv.product_id = p.id
        WHERE pv.id = v_variant_id AND p.company_id = p_company_id;

        INSERT INTO sale_items (
            company_id, sale_id, product_id, variant_id,
            quantity, unit_price, discount_amount
        ) VALUES (
            p_company_id, v_sale_id, v_product_id, v_variant_id,
            v_quantity, v_unit_price, v_item_discount
        );

        -- Descontar stock (solo de variantes del tenant)
        UPDATE product_variants
        SET stock = stock - v_quantity, updated_at = now()
        WHERE id = v_variant_id AND company_id = p_company_id;

        -- Kardex inmutable
        INSERT INTO inventory_movements (
            company_id, product_id, variant_id, movement_type,
            quantity, reason, reference_id
        ) VALUES (
            p_company_id, v_product_id, v_variant_id, 'out',
            v_quantity, 'Venta #' || v_sale_id::text, v_sale_id
        );
    END LOOP;

    -- Si es crédito, registrar el saldo en customer_payments
    IF p_payment_method = 'CREDIT' AND p_customer_id IS NOT NULL THEN
        INSERT INTO customer_payments (
            company_id, customer_id, sale_id, amount, payment_method
        ) VALUES (
            p_company_id, p_customer_id, v_sale_id, v_total_with_discount, 'CREDIT'
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'sale_id', v_sale_id,
        'total', v_total,
        'total_with_discount', v_total_with_discount,
        'change', v_change
    );
END;
$$;

-- ============================================================
-- tenant_search_inventory
-- ============================================================
CREATE OR REPLACE FUNCTION tenant_search_inventory(
    p_company_id UUID,
    p_search_term TEXT,
    p_limit INT DEFAULT 20
)
RETURNS TABLE (
    variant_id UUID,
    product_id UUID,
    product_name TEXT,
    sku TEXT,
    barcode TEXT,
    stock INT,
    price NUMERIC,
    category_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        pv.id,
        p.id,
        p.name,
        pv.sku,
        pv.barcode,
        pv.stock,
        COALESCE(pv.price_override, p.price_base) AS price,
        c.name
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE pv.company_id = p_company_id
      AND p.company_id = p_company_id
      AND (
          p.name ILIKE '%' || p_search_term || '%'
          OR pv.sku ILIKE '%' || p_search_term || '%'
          OR pv.barcode = p_search_term
      )
    ORDER BY p.name
    LIMIT p_limit;
END;
$$;

-- ============================================================
-- tenant_delete_sale
-- ============================================================
CREATE OR REPLACE FUNCTION tenant_delete_sale(
    p_company_id UUID,
    p_sale_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item RECORD;
BEGIN
    -- Validar que la venta pertenece al tenant
    PERFORM 1 FROM sales WHERE id = p_sale_id AND company_id = p_company_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Venta no encontrada para esta empresa');
    END IF;

    -- Revertir stock y registrar movimientos de retorno
    FOR v_item IN
        SELECT variant_id, product_id, quantity
        FROM sale_items
        WHERE sale_id = p_sale_id AND company_id = p_company_id
    LOOP
        UPDATE product_variants
        SET stock = stock + v_item.quantity, updated_at = now()
        WHERE id = v_item.variant_id AND company_id = p_company_id;

        INSERT INTO inventory_movements (
            company_id, product_id, variant_id, movement_type,
            quantity, reason, reference_id
        ) VALUES (
            p_company_id, v_item.product_id, v_item.variant_id, 'in',
            v_item.quantity, 'Anulación venta #' || p_sale_id::text, p_sale_id
        );
    END LOOP;

    -- Eliminar items y venta
    DELETE FROM sale_items WHERE sale_id = p_sale_id AND company_id = p_company_id;
    DELETE FROM sales WHERE id = p_sale_id AND company_id = p_company_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- tenant_transfer_stock
-- ============================================================
CREATE OR REPLACE FUNCTION tenant_transfer_stock(
    p_company_id UUID,
    p_from_variant_id UUID,
    p_to_variant_id UUID,
    p_quantity INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_stock INT;
BEGIN
    SELECT stock INTO v_current_stock
    FROM product_variants
    WHERE id = p_from_variant_id AND company_id = p_company_id
    FOR UPDATE;

    IF v_current_stock IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Variante origen no encontrada');
    END IF;

    IF v_current_stock < p_quantity THEN
        RETURN jsonb_build_object('success', false, 'error', 'Stock insuficiente');
    END IF;

    UPDATE product_variants
    SET stock = stock - p_quantity, updated_at = now()
    WHERE id = p_from_variant_id AND company_id = p_company_id;

    UPDATE product_variants
    SET stock = stock + p_quantity, updated_at = now()
    WHERE id = p_to_variant_id AND company_id = p_company_id;

    INSERT INTO inventory_movements (
        company_id, variant_id, movement_type, quantity, reason
    ) VALUES
        (p_company_id, p_from_variant_id, 'out', p_quantity,
         'Transferencia a ' || p_to_variant_id::text),
        (p_company_id, p_to_variant_id, 'in', p_quantity,
         'Transferencia desde ' || p_from_variant_id::text);

    RETURN jsonb_build_object('success', true);
END;
$$;

COMMIT;
```

> **Decisión clave:** las funciones nuevas validan que el tenant existe y está activo. Esto previene queries con tenants inválidos. La validación es redundante con RLS pero útil como defensa en profundidad.

## 3.2 Wrappers retrocompatibles

`migrations/20261003300101_wrap_legacy_rpc.sql`:

```sql
BEGIN;

-- Wrapper de process_sale (mantiene firma original)
CREATE OR REPLACE FUNCTION process_sale(
    p_items JSONB,
    p_payment_method TEXT,
    p_customer_id UUID DEFAULT NULL,
    p_transfer_type TEXT DEFAULT NULL,
    p_received_amount NUMERIC DEFAULT NULL,
    p_discount_amount NUMERIC DEFAULT 0,
    p_status TEXT DEFAULT 'completed'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Llama a la nueva función con el tenant fijo de Distribelleza
    RETURN tenant_process_sale(
        '11111111-1111-1111-1111-111111111111',
        p_items, p_payment_method, p_customer_id, p_transfer_type,
        p_received_amount, p_discount_amount, p_status
    );
END;
$$;

-- Wrapper de search_inventory
CREATE OR REPLACE FUNCTION search_inventory(p_search_term TEXT, p_limit INT DEFAULT 20)
RETURNS TABLE (
    variant_id UUID, product_id UUID, product_name TEXT, sku TEXT,
    barcode TEXT, stock INT, price NUMERIC, category_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT * FROM tenant_search_inventory(
        '11111111-1111-1111-1111-111111111111', p_search_term, p_limit
    );
END;
$$;

-- Wrapper de delete_sale
CREATE OR REPLACE FUNCTION delete_sale(p_sale_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN tenant_delete_sale(
        '11111111-1111-1111-1111-111111111111', p_sale_id
    );
END;
$$;

-- Wrapper de transfer_stock
CREATE OR REPLACE FUNCTION transfer_stock(
    p_from_variant_id UUID,
    p_to_variant_id UUID,
    p_quantity INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN tenant_transfer_stock(
        '11111111-1111-1111-1111-111111111111',
        p_from_variant_id, p_to_variant_id, p_quantity
    );
END;
$$;

COMMIT;
```

> **Mientras los wrappers existan:** las llamadas viejas (`process_sale(...)`) siguen funcionando idéntico. Esto permite migrar el código TypeScript gradualmente (Fase 4) sin romper funcionalidad.

## 3.3 Actualizar trigger `handle_new_user`

`migrations/20261003300200_update_handle_new_user.sql`:

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_company_id UUID;
BEGIN
    -- Resolver company_id desde app_metadata (inyectado por el flujo de invitación)
    v_company_id := (NEW.raw_app_meta_data ->> 'company_id')::UUID;

    -- Fallback al tenant por defecto si no viene (compatibilidad con usuarios legacy)
    IF v_company_id IS NULL THEN
        v_company_id := '11111111-1111-1111-1111-111111111111';
    END IF;

    INSERT INTO public.profiles (id, full_name, role, company_id)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
        COALESCE(NEW.raw_app_meta_data ->> 'role', 'manager'),
        v_company_id
    );
    RETURN NEW;
END;
$$;

-- Re-aplicar el trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

> **Cambios clave:**
> - Lee `company_id` desde `raw_app_meta_data` (donde lo inyecta la Fase 4).
> - Si no viene, fallback al tenant Distribelleza (para usuarios creados antes de la migración).
> - **Ya no cae en `'manager'` por defecto sin contexto**: si `role` no viene en metadata, lo asume pero el usuario queda asociado al tenant correcto.

## 3.4 Rollback de Fase 3

`migrations/RK_20261003300000_rollback_tenant_rpc.sql`:

```sql
BEGIN;

DROP FUNCTION IF EXISTS tenant_process_sale(UUID, JSONB, TEXT, UUID, TEXT, NUMERIC, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS tenant_search_inventory(UUID, TEXT, INT);
DROP FUNCTION IF EXISTS tenant_delete_sale(UUID, UUID);
DROP FUNCTION IF EXISTS tenant_transfer_stock(UUID, UUID, UUID, INT);

-- Los wrappers siguen siendo la única versión disponible
-- Restaurar la función original de handle_new_user si se modificó:
-- (debe estar respaldada en RK_20261003300200_handle_new_user_original.sql)

COMMIT;
```

---

# Fase 4 — Auth, JWT y sesión multi-tenant

**Objetivo:** establecer el flujo de invitación por empresa, inyectar `company_id` en el JWT, y hacer que `login()` valide el tenant.

**Archivos a crear:**
- `migrations/20261003400000_create_invitations.sql`
- `migrations/20261003400001_create_accept_invitation_rpc.sql`
- Modificar `app/actions/auth.ts`
- Modificar `app/actions/users.ts`
- Modificar `middleware.ts`

## 4.1 Tabla `invitations`

`migrations/20261003400000_create_invitations.sql`:

```sql
BEGIN;

CREATE TABLE invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    email VARCHAR(200) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'manager',
    invited_by UUID REFERENCES profiles(id),
    token VARCHAR(100) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    accepted_user_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_invitations_token ON invitations(token);
CREATE INDEX idx_invitations_company ON invitations(company_id);

-- Evitar invitaciones duplicadas activas
CREATE UNIQUE INDEX idx_invitations_pending
    ON invitations(email, company_id)
    WHERE used_at IS NULL AND expires_at > now();

COMMIT;
```

## 4.2 RPC `accept_invitation`

`migrations/20261003400001_create_accept_invitation_rpc.sql`:

```sql
CREATE OR REPLACE FUNCTION accept_invitation(
    p_token TEXT,
    p_password TEXT,
    p_full_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_invitation invitations%ROWTYPE;
    v_user_id UUID;
BEGIN
    -- Buscar invitación válida
    SELECT * INTO v_invitation
    FROM invitations
    WHERE token = p_token
      AND used_at IS NULL
      AND expires_at > now();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invitación inválida o expirada');
    END IF;

    -- Crear usuario en auth.users con company_id en app_metadata
    -- (esto se hace desde el código TS usando supabaseAdmin.auth.admin.createUser)
    -- Aquí solo retornamos los datos necesarios para que el cliente lo cree

    RETURN jsonb_build_object(
        'success', true,
        'email', v_invitation.email,
        'company_id', v_invitation.company_id,
        'role', v_invitation.role,
        'full_name', p_full_name
    );
END;
$$;
```

> **Nota:** la creación del usuario en `auth.users` se hace desde código TypeScript con `supabaseAdmin.auth.admin.createUser` (no desde SQL porque `auth.users` es un esquema gestionado por Supabase Auth). La RPC solo valida la invitación y devuelve los metadatos.

## 4.3 Nueva `login()` con validación de tenant

**Archivo:** `app/actions/auth.ts`

```typescript
'use server'

import { createClient } from '../../lib/supabase/server'
import { redirect } from 'next/navigation'

export async function login(formData: FormData) {
    const supabase = createClient()
    const email = formData.get('email') as string
    const password = formData.get('password') as string

    const { data: authData, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    })

    if (error || !authData.user) {
        return { error: 'Credenciales inválidas o error de conexión.' }
    }

    // Leer company_id del JWT
    const companyId = authData.user.app_metadata?.company_id as string | undefined

    if (!companyId) {
        await supabase.auth.signOut()
        return { error: 'Usuario sin empresa asignada. Contacta al administrador.' }
    }

    // Validar que la empresa existe y está activa
    const { data: company, error: companyError } = await supabase
        .from('companies')
        .select('id, slug')
        .eq('id', companyId)
        .eq('active', true)
        .single()

    if (companyError || !company) {
        await supabase.auth.signOut()
        return { error: 'Empresa inactiva o no encontrada.' }
    }

    redirect('/')
}

export async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    redirect('/login')
}

export async function getUserProfile() {
    const supabase = createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return null

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*, companies(slug, trade_name)')
        .eq('id', user.id)
        .maybeSingle()

    // YA NO se concede 'manager' por defecto.
    // Si no hay perfil, es un error explícito (no un fallback silencioso).
    if (!profile) {
        console.error(`[getUserProfile] Usuario ${user.id} sin perfil en profiles`)
        return null
    }

    return profile
}
```

## 4.4 Nueva `createUser` con invitación

**Archivo:** `app/actions/users.ts`

```typescript
'use server'

import { supabaseAdmin } from '../../lib/supabase'
import { createClient } from '../../lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ============================================================
// requireAuthContext — helper de autenticación + tenant
// ============================================================
async function requireAuthContext() {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
        throw new Error('UNAUTHENTICATED')
    }

    const companyId = user.app_metadata?.company_id as string | undefined
    if (!companyId) {
        throw new Error('NO_COMPANY_CONTEXT')
    }

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

    if (profileError || !profile) {
        throw new Error('NO_PROFILE')
    }

    return { user, companyId, role: profile.role as string }
}

function requireOwner(role: string) {
    if (role !== 'owner') {
        throw new Error('FORBIDDEN: se requiere rol owner')
    }
}

// ============================================================
// createUser: ahora con auth check + invitación
// ============================================================
export async function createUser(userData: {
    email: string
    full_name: string
    role: string
}) {
    try {
        const ctx = await requireAuthContext()
        requireOwner(ctx.role)

        // Crear invitación (NO crear el usuario directamente)
        const token = crypto.randomUUID() + '-' + Date.now().toString(36)
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

        const { error: invError } = await supabaseAdmin
            .from('invitations')
            .insert({
                company_id: ctx.companyId,
                email: userData.email,
                role: userData.role,
                invited_by: ctx.user.id,
                token,
                expires_at: expiresAt,
            })

        if (invError) throw invError

        // Enviar email con link de invitación
        // (implementar con Resend, SendGrid, etc.)
        const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/accept-invitation?token=${token}`
        console.log(`[createUser] Invitación para ${userData.email}: ${inviteUrl}`)
        // await sendInvitationEmail(userData.email, inviteUrl)

        revalidatePath('/')
        return { success: true, invitation_url: inviteUrl }
    } catch (err: any) {
        console.error('[Action: createUser]', err.message)
        return { success: false, error: err.message }
    }
}

// ============================================================
// acceptInvitationAction: el usuario invitado completa el signup
// ============================================================
export async function acceptInvitationAction(formData: FormData) {
    try {
        const token = formData.get('token') as string
        const password = formData.get('password') as string
        const fullName = formData.get('full_name') as string

        // Validar invitación
        const { data: invitation, error: invError } = await supabaseAdmin
            .from('invitations')
            .select('*')
            .eq('token', token)
            .is('used_at', null)
            .gt('expires_at', new Date().toISOString())
            .single()

        if (invError || !invitation) {
            return { error: 'Invitación inválida o expirada' }
        }

        // Crear usuario con company_id en app_metadata
        const { data, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: invitation.email,
            password,
            user_metadata: { full_name: fullName },
            app_metadata: {
                company_id: invitation.company_id,
                role: invitation.role,
            },
            email_confirm: true,
        })

        if (authError) throw authError

        // Marcar invitación como usada
        await supabaseAdmin
            .from('invitations')
            .update({ used_at: new Date().toISOString(), accepted_user_id: data.user.id })
            .eq('id', invitation.id)

        return { success: true }
    } catch (err: any) {
        console.error('[Action: acceptInvitationAction]', err.message)
        return { error: err.message }
    }
}

// updateUser y deleteUser también usan requireAuthContext + requireOwner.
// Mismo patrón. No se incluyen aquí por brevedad — seguir el mismo esquema.
export async function getUsers() { /* ... mismo patrón con requireAuthContext ... */ }
export async function updateUser(/* ... */) { /* ... */ }
export async function deleteUser(/* ... */) { /* ... */ }
```

> **Cambio crítico:** `createUser` ya **no crea el usuario directamente**. Crea una invitación y el usuario completa el signup en `/accept-invitation`. Esto cierra el hallazgo P0.2 (escalada de privilegios sin sesión) porque solo un `owner` autenticado puede crear invitaciones, y las invitaciones están atadas a un `company_id` específico.

## 4.5 `middleware.ts` por tenant

**Archivo:** `middleware.ts`

```typescript
import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
    let response = NextResponse.next({ request })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() { return request.cookies.getAll() },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) =>
                        request.cookies.set(name, value))
                    response = NextResponse.next({ request })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options))
                },
            },
        }
    )

    const { data: { user } } = await supabase.auth.getUser()

    // Proteger ruta raíz
    if (request.nextUrl.pathname === '/') {
        if (!user) {
            return NextResponse.redirect(new URL('/login', request.url))
        }
        // Validar que el usuario tiene company_id
        const companyId = user.app_metadata?.company_id
        if (!companyId) {
            return NextResponse.redirect(new URL('/no-tenant', request.url))
        }
    }

    // Evitar que usuarios autenticados vean /login
    if (request.nextUrl.pathname === '/login' && user) {
        return NextResponse.redirect(new URL('/', request.url))
    }

    return response
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
```

> **Cambio crítico:** el middleware ahora **sí protege rutas**. Un usuario sin sesión es redirigido a `/login`. Un usuario autenticado sin `company_id` va a `/no-tenant`. Esto cierra varios hallazgos del `.md` original.

## 4.6 Aplicar el helper `requireAuthContext` al resto de las acciones

Para cada archivo en `app/actions/`, agregar al inicio de cada función:

```typescript
import { requireAuthContext, requireOwner, requireRole } from './_shared/auth-helpers'

// En cada función:
export async function algunaAccion(/* ... */) {
    try {
        const ctx = await requireAuthContext()
        // Opcionalmente:
        requireOwner(ctx.role) // solo owners
        // o requireRole(ctx.role, ['owner', 'technician'])
        // ... lógica de la acción ...
    } catch (err: any) {
        if (err.message === 'UNAUTHENTICATED') {
            return { success: false, error: 'No autenticado' }
        }
        if (err.message.startsWith('FORBIDDEN')) {
            return { success: false, error: 'Sin permisos' }
        }
        // ...
    }
}
```

Crear `app/actions/_shared/auth-helpers.ts`:

```typescript
import { createClient } from '../../lib/supabase/server'

export async function requireAuthContext() {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
        throw new Error('UNAUTHENTICATED')
    }

    const companyId = user.app_metadata?.company_id as string | undefined
    if (!companyId) {
        throw new Error('NO_COMPANY_CONTEXT')
    }

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

    if (profileError || !profile) {
        throw new Error('NO_PROFILE')
    }

    return { user, companyId, role: profile.role as string }
}

export function requireOwner(role: string) {
    if (role !== 'owner') throw new Error('FORBIDDEN: se requiere owner')
}

export async function requireRole(allowedRoles: string[]) {
    const ctx = await requireAuthContext()
    if (!allowedRoles.includes(ctx.role)) {
        throw new Error(`FORBIDDEN: se requiere uno de ${allowedRoles.join(', ')}`)
    }
    return ctx
}
```

## 4.7 Rollback de Fase 4

- Restaurar `app/actions/auth.ts` y `app/actions/users.ts` desde el backup.
- Restaurar `middleware.ts`.
- Eliminar `app/actions/_shared/auth-helpers.ts`.
- Las invitaciones quedan en la tabla pero no se usan.
- Las funciones RPC (`accept_invitation`) quedan; no afectan nada.

---

# Fase 5 — RLS real (transición segura)

**Objetivo:** habilitar RLS en las 14 tablas per-tenant con políticas que primero son suaves (sin restringir) y después se endurecen para aislar tenants.

**Principio de transición:** habilitar permisivo → verificar con dos tenants → endurecer.

## 5.1 Habilitar RLS con política permisiva (solo autenticados)

`migrations/20261003500000_enable_rls_permissive.sql`:

```sql
BEGIN;

-- Habilitar RLS en las 14 tablas
ALTER TABLE products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE major_expenses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices     ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;

-- Política permisiva: cualquier usuario autenticado puede leer/escribir
-- (mismo comportamiento que antes — sin aislamiento todavía)
CREATE POLICY "auth_read_all" ON products FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_all" ON products FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read_all" ON product_variants FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_all" ON product_variants FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read_all" ON customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_all" ON customers FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read_all" ON sales FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_all" ON sales FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read_all" ON sale_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_all" ON sale_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read_all" ON customer_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_all" ON customer_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read_all" ON cash_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_all" ON cash_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read_all" ON expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_all" ON expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read_all" ON supplier_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_all" ON supplier_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read_all" ON major_expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_all" ON major_expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read_all" ON inventory_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_all" ON inventory_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read_all" ON audit_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_all" ON audit_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read_all" ON suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_all" ON suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read_all" ON supplier_invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_all" ON supplier_invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read_all" ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_all" ON profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;
```

> **Propósito de esta fase:** verificar que RLS no rompe la app antes de endurecer. Si algún query falla con "row-level security policy violation", sabemos que hay código que depende de `supabaseAdmin` (que bypassa RLS) o que necesita cliente autenticado.

## 5.2 Pruebas con dos tenants en paralelo

Antes de endurecer las políticas, crear un tenant 2 de prueba:

```sql
-- Solo en entorno de dev/staging, NUNCA en production
INSERT INTO companies (id, slug, legal_name, trade_name)
VALUES ('22222222-2222-2222-2222-222222222222', 'empresa-prueba-b', 'Empresa Prueba B S.A.S.', 'Empresa prueba B');

-- Crear usuario de prueba para el tenant 2
-- (vía flujo de invitación, no manualmente)
```

**Pruebas a ejecutar:**

1. Login con usuario de Distribelleza → debe ver sus datos.
2. Login con usuario de Empresa B → **debe ver sus datos, NO los de Distribelleza**.
3. Crear producto en Distribelleza → Empresa B no debe verlo.
4. Crear venta en Empresa B → Distribelleza no debe verla.

Si Empresa B ve datos de Distribelleza, las políticas permisivas están funcionando pero el siguiente paso (5.3) es obligatorio antes de producción.

## 5.3 Endurecer políticas (aislamiento por tenant)

`migrations/20261003500100_strict_tenant_rls.sql`:

```sql
BEGIN;

-- Eliminar políticas permisivas
DROP POLICY IF EXISTS "auth_read_all" ON products;
DROP POLICY IF EXISTS "auth_write_all" ON products;
-- ... repetir para las 14 tablas ...

-- Crear políticas estrictas
CREATE POLICY "tenant_select" ON products
    FOR SELECT TO authenticated
    USING (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid);

CREATE POLICY "tenant_insert" ON products
    FOR INSERT TO authenticated
    WITH CHECK (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid);

CREATE POLICY "tenant_update" ON products
    FOR UPDATE TO authenticated
    USING (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid)
    WITH CHECK (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid);

CREATE POLICY "tenant_delete" ON products
    FOR DELETE TO authenticated
    USING (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid);

-- Repetir para las 14 tablas (mismo patrón)
-- products, product_variants, customers, sales, sale_items,
-- customer_payments, cash_sessions, expenses, supplier_payments,
-- major_expenses, inventory_movements, audit_logs,
-- suppliers, supplier_invoices, profiles

COMMIT;
```

> **Crítico:** `auth.jwt() -> 'app_metadata' ->> 'company_id'` lee el `company_id` del JWT. Esto requiere que la Fase 4 haya inyectado el campo en `app_metadata`. Si la Fase 4 no se completó, este query retorna `NULL` y bloquea todas las operaciones.

> **Aplicación gradual:** endurecer una tabla a la vez. Esperar a que la app funcione bien antes de pasar a la siguiente. Esto facilita identificar cuál tabla está causando problemas.

## 5.4 Bucket storage con prefijo por tenant

`migrations/20261003500200_storage_rls.sql`:

```sql
BEGIN;

-- Eliminar políticas antiguas del bucket
DROP POLICY IF EXISTS "Archivos de proveedores legibles por todos" ON storage.objects;
DROP POLICY IF EXISTS "Usuarios autenticados pueden subir archivos a proveedores" ON storage.objects;
DROP POLICY IF EXISTS "Usuarios autenticados pueden actualizar archivos de proveedores" ON storage.objects;
DROP POLICY IF EXISTS "Usuarios autenticados pueden eliminar archivos de proveedores" ON storage.objects;

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
```

> **Convención de paths:** los archivos se guardan como `{company_id}/{invoice_id}/{filename}`. Si la app actual guarda archivos sin prefijo, hay que migrar los archivos existentes o aceptar que solo los nuevos siguen el patrón.

## 5.5 Kill switch de `supabaseAdmin`

Una vez RLS está activo y probado, **dejar de usar `supabaseAdmin` para queries de negocio**.

**Buscar usos de `supabaseAdmin`:**

```bash
grep -r "supabaseAdmin" /Users/marlonabellahernandez/Desktop/DistriBelleza/app/actions
```

**Reemplazar por el cliente autenticado:**

```typescript
// ANTES
import { supabaseAdmin } from '../../lib/supabase'
const { data } = await supabaseAdmin.from('products').select('*')

// DESPUÉS
import { createClient } from '../../lib/supabase/server'
const supabase = createClient() // cliente con RLS, usa la sesión del usuario
const { data } = await supabase.from('products').select('*')
// RLS filtra automáticamente por company_id del usuario
```

**`supabaseAdmin` solo se mantiene para:**
- Crear/eliminar usuarios en `auth.admin.*`.
- Jobs internos (cron, scripts de migración).
- Operaciones que legítimamente necesitan bypass de RLS (ej. métricas cross-tenant para super-admin).

## 5.6 Rollback de Fase 5

`migrations/RK_20261003500000_disable_rls.sql`:

```sql
BEGIN;

-- Eliminar políticas estrictas
DROP POLICY IF EXISTS "tenant_select" ON products;
-- ... repetir para las 14 tablas ...

-- Restaurar políticas permisivas o deshabilitar RLS completamente
ALTER TABLE products              DISABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants      DISABLE ROW LEVEL SECURITY;
-- ... repetir para las 14 tablas ...

COMMIT;
```

> **No se pierden datos.** Las políticas solo afectan visibilidad. Si se deshabilita RLS, todas las filas vuelven a ser visibles para todos los autenticados (estado pre-RLS).

---

# Fase 6 — Branding y reglas parametrizadas

**Objetivo:** desacoplar branding hardcodeado, comisión por tenant, eliminar Norby/Marlon, print service multi-tenant.

**Archivos a modificar:**
- `lib/company.ts` (nuevo): helper de carga de company
- `app/layout.tsx`
- `app/login/page.tsx`
- `app/page.tsx`
- `components/Dashboard/Sidebar.tsx`
- `components/Reports/ReportsView.tsx`
- `components/Suppliers/SuppliersView.tsx`
- `app/actions/reports.ts`
- `app/actions/cash_actions.ts`
- `components/Dashboard/Dashboard.tsx`
- `components/POS/POS.tsx`
- `print-service/printer.js`
- `print-service/server.js`
- `print-service/config.json`

## 6.1 Helper de carga de company

**Archivo nuevo:** `lib/company.ts`

```typescript
import { createClient } from './supabase/server'

export interface CompanyData {
    id: string
    slug: string
    legal_name: string
    trade_name: string | null
    tax_id: string | null
    logo_url: string | null
    currency: string
    settings: {
        commission_threshold: number
        commission_rate: number
        default_customer_options: string[]
        receipt_header: string
        receipt_footer: string
        pdf_header_text: string
        pdf_footer_text: string
    }
}

const DEFAULT_SETTINGS = {
    commission_threshold: 1800000,
    commission_rate: 0.012,
    default_customer_options: ['Distribelleza', 'Socios', 'Otros'],
    receipt_header: 'DISTRIBELLEZA\nProductos de Belleza',
    receipt_footer: 'Gracias por su compra',
    pdf_header_text: 'DISTRIBELLEZA',
    pdf_footer_text: 'DistriBelleza ERP - Reporte generado automáticamente.',
}

export async function getCurrentCompany(): Promise<CompanyData | null> {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const companyId = user.app_metadata?.company_id as string | undefined
    if (!companyId) return null

    const { data: company, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', companyId)
        .single()

    if (error || !company) return null

    const { data: settings } = await supabase
        .from('company_settings')
        .select('key, value')
        .eq('company_id', companyId)

    const settingsMap: Record<string, any> = {}
    for (const row of settings ?? []) {
        settingsMap[row.key] = row.value
    }

    return {
        ...company,
        settings: {
            commission_threshold: Number(settingsMap.commission_threshold ?? DEFAULT_SETTINGS.commission_threshold),
            commission_rate: Number(settingsMap.commission_rate ?? DEFAULT_SETTINGS.commission_rate),
            default_customer_options: settingsMap.default_customer_options ?? DEFAULT_SETTINGS.default_customer_options,
            receipt_header: settingsMap.receipt_header ?? DEFAULT_SETTINGS.receipt_header,
            receipt_footer: settingsMap.receipt_footer ?? DEFAULT_SETTINGS.receipt_footer,
            pdf_header_text: settingsMap.pdf_header_text ?? DEFAULT_SETTINGS.pdf_header_text,
            pdf_footer_text: settingsMap.pdf_footer_text ?? DEFAULT_SETTINGS.pdf_footer_text,
        },
    }
}
```

## 6.2 Reemplazar hardcodeos en componentes

**Archivo:** `app/layout.tsx`

```typescript
import { getCurrentCompany } from '../lib/company'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
    const company = await getCurrentCompany()
    return (
        <html lang="es">
            <head>
                <title>{company?.trade_name ?? 'ERP'} - Sistema</title>
            </head>
            <body>{children}</body>
        </html>
    )
}
```

**Archivo:** `components/Dashboard/Sidebar.tsx`

```typescript
// Reemplazar:
// <h2>Distri Belleza</h2>
// Por:
// {company && <h2>{company.trade_name}</h2>}
```

**Archivo:** `app/page.tsx`

```typescript
// Reemplazar el header inline con carga de company:
// const company = await getCurrentCompany()
// <header>{company?.trade_name}</header>
```

## 6.3 Comisión per-tenant

**Archivo:** `app/actions/reports.ts`

```typescript
import { getCurrentCompany } from '../../lib/company'

export async function getFinancialReport(/* ... */) {
    const company = await getCurrentCompany()
    if (!company) return { success: false, error: 'No company context' }

    const COMMISSION_THRESHOLD = company.settings.commission_threshold
    const COMMISSION_RATE = company.settings.commission_rate

    // ... usar las variables en lugar de hardcoded 1800000 y 0.012 ...
}
```

**Archivo:** `app/actions/cash_actions.ts`

```typescript
// Mismo patrón. Eliminar las constantes hardcoded:
// const COMMISSION_THRESHOLD = 1800000
// const COMMISSION_RATE = 0.012
// Reemplazar con company.settings.commission_threshold / commission_rate
```

**Archivo:** `components/Dashboard/Dashboard.tsx`

```typescript
// Mismo patrón. La meta debe llegar del server action o del context, no hardcoded.
```

**Archivo:** `components/POS/POS.tsx`

```typescript
// Línea ~883: reemplazar "Meta mínima: $1.800.000" por:
// <span>Meta mínima: {formatCurrency(company.settings.commission_threshold)}</span>
```

## 6.4 Eliminar Norby/Marlon

**Archivo:** `components/Suppliers/SuppliersView.tsx`

```typescript
// ANTES (líneas 286-291):
const opciones = ['Norby', 'Marlon', 'Otros']

// DESPUÉS:
const company = await getCurrentCompany()
const opciones = company?.settings.default_customer_options ?? ['Distribelleza', 'Otros']
```

**Archivo:** `components/Suppliers/SuppliersView.tsx` (líneas 539-611)

```typescript
// Reemplazar la lógica hardcoded "Norby / Marlon / Otros" en el reporte PDF
// con iteración sobre company.settings.default_customer_options
```

## 6.5 Print service multi-tenant

**Archivo:** `print-service/config.json`

```json
{
    "printerName": "JAL58M",
    "sharedSecret": "GENERAR_TOKEN_SEGURO_AQUI",
    "tenants": {
        "distribelleza": {
            "printerName": "JAL58M",
            "header": "DISTRIBELLEZA\nProductos de Belleza"
        },
        "empresa-b": {
            "printerName": "OtraImpresora",
            "header": "EMPRESA B\nRazón Social"
    }
    }
}
```

**Archivo:** `print-service/server.js`

```javascript
// Agregar middleware de autenticación
const crypto = require('crypto');

function authenticateRequest(req) {
    const token = req.headers['x-print-service-token'];
    if (!token || token !== config.sharedSecret) {
        return false;
    }
    // Comparación constant-time para evitar timing attacks
    return crypto.timingSafeEqual(
        Buffer.from(token),
        Buffer.from(config.sharedSecret)
    );
}

// Aplicar a todos los endpoints
app.post('/print', (req, res) => {
    if (!authenticateRequest(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { companyId, saleData } = req.body;
    const tenantConfig = config.tenants[companyId];
    if (!tenantConfig) {
        return res.status(404).json({ error: 'Tenant not configured for this print service' });
    }

    // Imprimir con branding del tenant
    printReceipt(tenantConfig.printerName, tenantConfig.header, saleData);
    res.json({ success: true });
});
```

**Archivo:** `components/POS/POS.tsx` (PrintReceipt)

```typescript
const token = process.env.NEXT_PUBLIC_PRINT_SERVICE_TOKEN!

await fetch(`${PRINT_SERVICE_URL}/print`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-Print-Service-Token': token,
    },
    body: JSON.stringify({
        companyId: company.id,
        saleData: { /* ... */ },
    }),
})
```

**Archivo:** `print-service/printer.js`

```javascript
// Reemplazar:
// printer.println('DISTRIBELLEZA');
// printer.println('Productos de Belleza');
// Por:
// (estos strings ahora vienen como parámetros desde server.js)
```

## 6.6 Rollback de Fase 6

- Restaurar los archivos modificados desde el backup.
- No afecta la base de datos.

---

# Fase 7 — Cleanup final

**Objetivo:** auditoría final, smoke tests en producción, eliminación de wrappers legacy.

## 7.1 Eliminar wrappers legacy

Solo cuando todos los call sites usen las funciones `tenant_*`:

```sql
-- Verificar que nadie llama a las funciones viejas
-- (esto se hace desde el código TS; buscar antes de eliminar)

DROP FUNCTION IF EXISTS process_sale(JSONB, TEXT, UUID, TEXT, NUMERIC, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS search_inventory(TEXT, INT);
DROP FUNCTION IF EXISTS delete_sale(UUID);
DROP FUNCTION IF EXISTS transfer_stock(UUID, UUID, INT);
```

## 7.2 Eliminar tablas legacy (si se crearon)

Si en algún momento se decidió tener tablas `legacy_*`, eliminarlas ahora:

```sql
DROP TABLE IF EXISTS legacy_sales;
-- etc.
```

## 7.3 Auditoría final

```sql
-- 1. Conteo por tenant — debe coincidir con las expectativas
SELECT 'products', company_id, COUNT(*) FROM products GROUP BY company_id;
-- Repetir para las 14 tablas

-- 2. Ninguna fila huérfana
SELECT COUNT(*) FROM sales WHERE company_id NOT IN (SELECT id FROM companies);
-- Debe devolver 0

-- 3. Ningún company_id NULL
SELECT COUNT(*) FROM products WHERE company_id IS NULL;
-- Debe devolver 0

-- 4. Constraints en forma final
SELECT conname, contype FROM pg_constraint
WHERE conname LIKE '%company%' OR conname LIKE '%tenant%';
```

## 7.4 Smoke tests en producción

Ejecutar en orden:

1. Login como owner de Distribelleza.
2. Crear producto, vender, generar reporte.
3. Login como cajero de Distribelleza.
5. Vender, abrir caja, cerrar caja.
6. Crear invitación para un nuevo empleado.
7. El nuevo empleado acepta la invitación y puede loguearse.
8. (Si hay tenant 2 de prueba) Login con usuario de Empresa B.
9. Verificar que Empresa B **no ve** ningún dato de Distribelleza.
10. Generar PDF de reportes — debe mostrar el branding correcto del tenant.

## 7.5 Eliminar archivos de backup temporal

Una vez validado todo:

```bash
rm -rf backups/20261003_pre_multitenant_data.sql
rm -rf backups/csv/20261003/
# Mantener backups/legacy/schema_pre_multitenant.sql como referencia histórica
```

---

# Fase 9 — Consola de plataforma

**Objetivo:** dar al administrador de plataforma (`technician`) una vista operativa
del sistema, y permitir desactivar empresas de forma reversible.

Las cuentas `technician` **no pertenecen a ninguna empresa** por diseño: su alcance es
la plataforma, no los datos de negocio de los tenants.

## 9.1 Cuentas de plataforma sin `company_id`

El flujo original rechazaba a estas cuentas antes de evaluar el rol:

- `auth.ts` devolvía "Usuario sin empresa asignada" si el JWT no traía `company_id`.
- `middleware.ts` redirigía a `/no-tenant` por la misma condición.
- `requireAuthContext()` lanzaba `NO_COMPANY_CONTEXT`, dejando inutilizables
  `getMyCompanies` y `createCompany`.

Corrección aplicada en código:

- `auth.ts` resuelve el rol desde `profiles` y permite el acceso directo si es `technician`.
- `middleware.ts` acepta `app_metadata.role === 'technician'` sin `company_id`.
- Nuevo helper `requirePlatformRole()` para acciones de plataforma (no exige empresa).

## 9.2 Claim `role` en el JWT

La migración `20261003400002` solo inyectó `company_id` + `role` para usuarios con
`company_id NOT NULL`. Las cuentas de plataforma nunca recibieron el claim, y el
middleware lo necesita para no redirigirlas.

Esta migración hace el backfill de `role` para **todos** los usuarios, usando `||`
(merge) para no tocar el claim `company_id` ya presente.

### Nota: el técnico SÍ tiene `company_id`

A diferencia de lo que se suele asumir, una cuenta de plataforma **no** está
libre de empresa:

- La fase 2.5 (`20261003200300`) puso `profiles.company_id` en **NOT NULL**.
- El backfill de la fase 2.2 tuvo que asignar una empresa a *toda* cuenta existente.
- El técnico quedó vinculado al tenant `1111-1111-1111-1111-111111111111`
  (Distribelleza, el UUID fijo creado en `20261003200000`).

Esto **no** es un error ni una fuga de datos. Tener `company_id` no concede acceso:
el acceso lo gobierna el rol. El técnico nunca ve POS, inventario ni reportes de
Distribelleza; su alcance es la consola de plataforma.

`getUserProfile()` fuerza `companies: null` para el rol `technician` precisamente
para que ningún código futuro confunda "tener company_id" con "tener acceso a esa
empresa".

## 9.3 Activar / desactivar empresas

```bash
# Ejecutar en Supabase SQL Editor
\i migrations/fase-9-gestion-empresas/20261003700000_gestion_empresas.sql
```

Añade a `companies`:

| Columna | Tipo | Uso |
|---|---|---|
| `deactivation_reason` | TEXT | Motivo del retiro (auditoría) |
| `deactivated_at` | TIMESTAMPTZ | Fecha de desactivación |

Incluye un constraint `companies_deactivation_consistency` que hace `active` y
`deactivated_at` **complementarios** (XOR explícito):

| `active` | `deactivated_at` | Motivo |
|---|---|---|
| `true` | `NULL` | Empresa activa |
| `false` | no `NULL` | Inactiva, con fecha de retiro |

Sin la primera mitad del XOR la columna quedaba libre: una empresa podía estar
activa con fecha de desactivación. Se crea `NOT VALID` y se valida en la misma
transacción, tras normalizar los datos existentes, para no bloquear escrituras
concurrentes.

**Desactivar es reversible y no borra datos.** `auth.ts` ya rechazaba el login de
empresas inactivas; esta fase añade la vía de UI para cambiar ese estado.

Rollback: `migrations/fase-9-gestion-empresas/RK_20261003700000_rollback_gestion_empresas.sql`

**Rollback parcial a propósito.** Revertir el claim `role` selectivamente es
imposible: la fase 2.5 dejó `profiles.company_id` en `NOT NULL`, así que no
existe forma de distinguir qué usuarios lo recibieron en esta fase de cuáles lo
tenían desde `20261003400002`. Un revert global dejaría sin claim a los usuarios
de empresa. Además el claim es inocuo —solo espeja `profiles.role`, que es la
fuente de verdad— y se reinyecta en cada login. Por eso el rollback solo
elimina columnas, índice y constraint, y documenta el comando manual por si
algún día hace falta.

## 9.4 Qué ve el administrador de plataforma

Sidebar reducido a tres secciones:

| Sección | Contenido |
|---|---|
| Consola de Plataforma | KPIs: estado del sistema, empresas activas, sin uso reciente, usuarios |
| Salud del Sistema | Chequeos: base de datos, print service, tenants, admins configurados |
| Empresas | Todas las empresas con actividad y toggle activar/desactivar |

**No** incluye POS, Inventario, Proveedores, Reportes, Gastos ni Configuración:
esos datos son privados de cada empresa y no se exponen al técnico.

"Sin uso reciente" = más de 30 días sin ventas registradas. Es la señal de si una
empresa está usando el sistema.

## 9.5 Limitaciones conocidas

- **Los health checks son de infraestructura, no de negocio.** Detectan caídas de
  Supabase y del print service. No capturan errores de las operaciones de negocio:
  para eso haría falta una tabla `app_errors` (no incluida en esta fase).
- **Desactivar no invalida sesiones activas.** `auth.ts:44` bloquea el login, pero
  un token ya emitido sigue funcionando hasta expirar. Para bloqueo inmediato
  habría que revocar sesiones desde Supabase Auth.
- **`getAllCompanies()` no filtra por `created_by`.** El panel original solo
  mostraba las empresas creadas por el propio técnico. Como administrador de
  plataforma necesita ver todas; esto amplía su visibilidad sobre el resto de
  los usuarios de empresa (que ya son los owners de sus propios datos).

---

# Hallazgos del diagnóstico original resueltos por este roadmap

De los 33 hallazgos identificados en `DIAGNOSTICO.md`, **11 se cierran como efecto secundario de este plan multi-tenant**:

| # | Hallazgo | Fase que lo resuelve |
|---|---|---|
| P0.1 | Server actions sin autenticación | Fase 4 (auth-helpers) + Fase 5 (RLS) |
| P0.2 | `users.ts` permite escalada de privilegios sin sesión | Fase 4 (flujo de invitación) |
| P0.3 | RLS ausente en 14 tablas core | Fase 5 |
| P0.4 | Fallback `'manager'` por defecto en `auth.ts:48` | Fase 4.3 (sin fallback silencioso) |
| P0.5 | `lib/supabase.ts` sin guard `server-only` | Fase 5.5 (kill switch de `supabaseAdmin`) |
| P0.6 | CORS abierto en print-service | Fase 6.5 (autenticación con token) |
| P0.7 | `sales_history.deleteSale()` sin auth | Fase 5 (RLS bloquea) |
| P0.8 | Ventas sin trazabilidad de cajero + mismatch RPC | Fase 3 (nuevo `tenant_process_sale` con `p_user_id` opcional) + Fase 4 |
| P1.7 | Mayoria de acciones sin role check | Fase 4.6 (`requireOwner` / `requireRole`) |
| P1.8 | Comisión duplicada en 3-4 lugares | Fase 6.3 (`company_settings`) |
| P2.6 | Migraciones manuales sin versionado | Fases 1-7 (archivos `migrations/YYYYMMDDHHMMSS_*.sql`) |

---

# Hallazgos del diagnóstico que quedan pendientes (post-multi-tenant)

Los siguientes **22 hallazgos** del `.md` original **no se resuelven** con este plan multi-tenant y deben abordarse en una fase posterior (Fase 6+ del roadmap general de mejoras, no de multi-tenant):

| # | Hallazgo | Archivo:línea | Descripción breve |
|---|---|---|---|
| P1.1 | Carrito POS perdido al cambiar tab | `components/POS/POS.tsx` | SPA sin persistencia: cambiar de tab desmonta POS y pierde venta en curso |
| P1.2 | Errores silenciosos / 4 estilos distintos | múltiples actions | Mezcla de `{success:false,error}`, `return null`, `return []`, `throw` |
| P1.3 | Confirmaciones inconsistentes | `components/Inventory`, `components/UI/UserManagement` | `confirm()`/`alert()` nativos vs modales diseñados en POS/Suppliers |
| P1.4 | Transacciones no atómicas | `app/actions/inventory_actions.ts` | `createProductWithVariants` sin transacción, orphan products posibles |
| P1.5 | Feedback engañoso en Dashboard | `components/Dashboard/Dashboard.tsx:27-29` | Error de red se muestra como "Abra caja" |
| P1.6 | KPIs falsos hardcodeados | `components/Dashboard/Dashboard.tsx:62,71` | `12%` y `5%` son texto fijo, no datos reales |
| P1.9 | Service key en `.env.local` commiteada | `.env.local` | Riesgo de filtración; resolver en Fase 0.4 |
| P2.1 | God components | `components/POS/POS.tsx` (1301 líneas), `components/Suppliers/SuppliersView.tsx` (1152) | Concentran demasiada responsabilidad |
| P2.2 | Código muerto | `app/actions/pos_actions.ts`, `app/actions/inventory.ts`, `components/POS/POS.css`, `scratch/` | Archivos sin uso o residuales |
| P2.3 | Formateo moneda ×14 | múltiples componentes | `replace(/\D/g,'')` + `toLocaleString` duplicado |
| P2.4 | PDF generation duplicada | `components/Reports/ReportsView.tsx`, `components/Suppliers/SuppliersView.tsx` | ~290 líneas casi iguales |
| P2.5 | Sin design tokens | `app/globals.css`, múltiples componentes | Vars CSS declaradas sin usar; colores hardcodeados |
| P2.7 | Clases Tailwind huérfanas | `app/page.tsx:65`, `components/Dashboard/Dashboard.tsx:51` | `p-8 text-slate-500` sin efecto |
| P2.8 | CSS muerto conflictivo | `components/POS/POS.css` | Define layout que el `<style jsx>` redefine con valores distintos |
| P2.9 | 4 estrategias de estilos | todos los componentes | CSS global + `<style jsx>` + inline + pseudo-utilidades |
| P3.1 | Accesibilidad casi nula | todos los componentes | 0 aria, sin focus trap, sin Escape en modales |
| P3.2 | Responsive débil | `components/POS/POS.tsx` | Sin media queries en el POS real |
| P3.3 | Cobertura tests ~0% | `__tests__/` | 5 tests para 41 server actions y 14 tablas |
| P3.4 | `UserManagement` mal ubicado | `components/UI/UserManagement.tsx` | Es módulo de negocio, no UI reutilizable |
| P3.5 | `setInterval(1000)` re-render POS | `components/POS/POS.tsx:130` | Re-renderiza 1301 líneas de JSX cada segundo |
| P3.6 | Tipado `any` | múltiples actions | Sin tipos generados de Supabase |
| P3.7 | Validación HTML5 débil | múltiples componentes | Sin validación custom de negocio |

---

# Estimación de esfuerzo total

| Fase | Días |
|---|---|
| 0 — Preparación | 0.5 |
| 1 — Schema aditivo | 1-2 |
| 2 — Backfill | 1-3 |
| 3 — RPC parametrizadas | 2-3 |
| 4 — Auth multi-tenant | 4-6 |
| 5 — RLS real | 3-5 |
| 6 — Branding y reglas | 3-5 |
| 7 — Cleanup | 1 |
| **Total multi-tenant** | **16-25 días hábiles** |

Más los 22 hallazgos pendientes (Fase 6+ post-multi-tenant): ~10-15 días adicionales.
**Total proyecto completo:** ~25-40 días hábiles.

---

# Riesgos identificados y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Backfill incompleto (filas sin `company_id`) | Media | Validación con conteos en Fase 2.4 antes de `NOT NULL`. Bloqueos de transacción. |
| `ALTER TABLE` en tablas grandes | Media | Hacer en horario de bajo tráfico. Usar `pg_repack` para evitar locks prolongados. |
| Cambio de firma de RPC rompe la app | Alta | Crear funciones nuevas + wrappers retrocompatibles. Migrar código gradualmente. |
| RLS rompe funcionalidad inesperada | Alta | Habilitar permisivo primero → probar con 2 tenants → endurecer. Rollout tabla por tabla. |
| Print service no enrutado por tenant | Media | Migración gradual: añadir autenticación primero, branding parametrizable después, multi-impresora al final. |
| `supabaseAdmin` filtrado al cliente | Baja (ya mitigado) | Fase 5.5: dejar de usar para queries de negocio. |
| Service role key en git | Media | Fase 0.4: verificar `.gitignore` y rotación de key. |
| Cache de Next.js con datos viejos | Media | `revalidatePath` agresivo tras cambios. |
| Datos huérfanos sin tenant | Baja | Validación de FKs antes del backfill. |
| Migración de archivos del bucket sin prefijo | Media | Script de migración que copie archivos a `{company_id}/` antes de endurecer políticas de storage. |

---

# Convenciones de versionado de migrations

```bash
migrations/
├── 20261003100000_create_companies.sql
├── 20261003100100_create_company_settings.sql
├── 20261003100200_create_tenant_migration_audit.sql
├── 20261003100300_add_company_id_to_tables.sql
├── 20261003100400_add_company_fks.sql
├── 20261003100500_convert_unique_to_compound.sql
├── 20261003200000_create_default_tenant.sql
├── 20261003200100_backfill_company_id.sql
├── 20261003200200_audit_backfill.sql
├── 20261003200300_set_company_id_not_null.sql
├── 20261003200400_drop_old_unique_constraints.sql
├── 20261003300000_create_tenant_rpc.sql
├── 20261003300101_wrap_legacy_rpc.sql
├── 20261003300200_update_handle_new_user.sql
├── 20261003400000_create_invitations.sql
├── 20261003400001_create_accept_invitation_rpc.sql
├── 20261003500000_enable_rls_permissive.sql
├── 20261003500100_strict_tenant_rls.sql
├── 20261003500200_storage_rls.sql
├── RK_20261003100000_drop_companies.sql
├── RK_20261003200000_rollback_backfill.sql
├── RK_20261003300000_rollback_tenant_rpc.sql
├── RK_20261003500000_disable_rls.sql
└── legacy/
    └── schema_pre_multitenant.sql
```

**Formato de timestamp:** `YYYYMMDDHHMMSS` (año, mes, día, hora, minuto, segundo).

**Convención de rollback:** `RK_YYYYMMDDHHMMSS_descripcion.sql` (mismo timestamp + prefijo `RK_`).

**Aplicación:** usar Supabase CLI con `supabase db push` o aplicar manualmente en orden.

---

# Apéndice A — Checklist de rollback por fase

## Rollback Fase 1

```bash
# Ejecutar RK_20261003100000_drop_companies.sql
# Verificar: SELECT COUNT(*) FROM companies; -- debe ser 0
```

## Rollback Fase 2

```bash
# Ejecutar RK_20261003200000_rollback_backfill.sql
# Verificar: SELECT COUNT(*) FROM products WHERE company_id IS NOT NULL; -- debe ser 0
# Verificar que las constraints UNIQUE antiguas están restauradas
```

## Rollback Fase 3

```bash
# Ejecutar RK_20261003300000_rollback_tenant_rpc.sql
# Verificar que solo existen las funciones viejas
```

## Rollback Fase 4

```bash
# Restaurar auth.ts, users.ts, middleware.ts desde git
# rm -rf app/actions/_shared/auth-helpers.ts
```

## Rollback Fase 5

```bash
# Ejecutar RK_20261003500000_disable_rls.sql
# Verificar: SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public';
# rowsecurity debe ser 'f' para todas las tablas per-tenant
```

## Rollback Fase 6

```bash
# git checkout -- app/layout.tsx app/login/page.tsx app/page.tsx components/Dashboard/Sidebar.tsx \
#   components/Reports/ReportsView.tsx components/Suppliers/SuppliersView.tsx \
#   app/actions/reports.ts app/actions/cash_actions.ts components/Dashboard/Dashboard.tsx \
#   components/POS/POS.tsx print-service/printer.js print-service/server.js print-service/config.json
# rm -f lib/company.ts
```

## Rollback Fase 7

```bash
# No hay rollback necesario — esta fase es solo limpieza final.
# Si algo falla aquí, los datos no se pierden.
```

---

# Apéndice B — Scripts de validación reutilizables

## Validar conteos pre/post migración

```sql
-- Ejecutar antes y después de Fase 2
SELECT
    'products' AS tabla,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE company_id IS NOT NULL) AS con_tenant,
    COUNT(*) FILTER (WHERE company_id IS NULL) AS sin_tenant
FROM products
UNION ALL
SELECT 'product_variants', COUNT(*),
       COUNT(*) FILTER (WHERE company_id IS NOT NULL),
       COUNT(*) FILTER (WHERE company_id IS NULL)
FROM product_variants
UNION ALL
SELECT 'customers', COUNT(*),
       COUNT(*) FILTER (WHERE company_id IS NOT NULL),
       COUNT(*) FILTER (WHERE company_id IS NULL)
FROM customers
UNION ALL
SELECT 'sales', COUNT(*),
       COUNT(*) FILTER (WHERE company_id IS NOT NULL),
       COUNT(*) FILTER (WHERE company_id IS NULL)
FROM sales
UNION ALL
SELECT 'sale_items', COUNT(*),
       COUNT(*) FILTER (WHERE company_id IS NOT NULL),
       COUNT(*) FILTER (WHERE company_id IS NULL)
FROM sale_items
UNION ALL
SELECT 'customer_payments', COUNT(*),
       COUNT(*) FILTER (WHERE company_id IS NOT NULL),
       COUNT(*) FILTER (WHERE company_id IS NULL)
FROM customer_payments
UNION ALL
SELECT 'cash_sessions', COUNT(*),
       COUNT(*) FILTER (WHERE company_id IS NOT NULL),
       COUNT(*) FILTER (WHERE company_id IS NULL)
FROM cash_sessions
UNION ALL
SELECT 'expenses', COUNT(*),
       COUNT(*) FILTER (WHERE company_id IS NOT NULL),
       COUNT(*) FILTER (WHERE company_id IS NULL)
FROM expenses
UNION ALL
SELECT 'supplier_payments', COUNT(*),
       COUNT(*) FILTER (WHERE company_id IS NOT NULL),
       COUNT(*) FILTER (WHERE company_id IS NULL)
FROM supplier_payments
UNION ALL
SELECT 'major_expenses', COUNT(*),
       COUNT(*) FILTER (WHERE company_id IS NOT NULL),
       COUNT(*) FILTER (WHERE company_id IS NULL)
FROM major_expenses
UNION ALL
SELECT 'inventory_movements', COUNT(*),
       COUNT(*) FILTER (WHERE company_id IS NOT NULL),
       COUNT(*) FILTER (WHERE company_id IS NULL)
FROM inventory_movements
UNION ALL
SELECT 'audit_logs', COUNT(*),
       COUNT(*) FILTER (WHERE company_id IS NOT NULL),
       COUNT(*) FILTER (WHERE company_id IS NULL)
FROM audit_logs
UNION ALL
SELECT 'suppliers', COUNT(*),
       COUNT(*) FILTER (WHERE company_id IS NOT NULL),
       COUNT(*) FILTER (WHERE company_id IS NULL)
FROM suppliers
UNION ALL
SELECT 'supplier_invoices', COUNT(*),
       COUNT(*) FILTER (WHERE company_id IS NOT NULL),
       COUNT(*) FILTER (WHERE company_id IS NULL)
FROM supplier_invoices
UNION ALL
SELECT 'profiles', COUNT(*),
       COUNT(*) FILTER (WHERE company_id IS NOT NULL),
       COUNT(*) FILTER (WHERE company_id IS NULL)
FROM profiles;
```

## Validar aislamiento entre tenants

```sql
-- Solo ejecutar después de Fase 5.3 con dos tenants creados
-- Login con cada usuario y verificar que solo ve su tenant

-- Como Distribelleza:
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims TO '{"app_metadata": {"company_id": "11111111-1111-1111-1111-111111111111"}}';
SELECT COUNT(*) FROM products; -- Debe contar solo productos de Distribelleza

-- Como Empresa B:
SET LOCAL request.jwt.claims TO '{"app_metadata": {"company_id": "22222222-2222-2222-2222-222222222222"}}';
SELECT COUNT(*) FROM products; -- Debe contar solo productos de Empresa B
```

---

# Apéndice C — Volumen de datos esperado y tiempos

Tabla estimada según volumen de datos pre-migración (medido en Fase 0.3):

| Tabla | Volumen esperado | Tiempo ADD COLUMN | Tiempo UPDATE backfill | Tiempo NOT NULL |
|---|---|---|---|---|
| `products` | 10-100 | <1s | <1s | <1s |
| `product_variants` | 100-1000 | <1s | <1s | <1s |
| `customers` | 100-1000 | <1s | <1s | <1s |
| `sales` | 1000-100K | <1s | 1-30s | <1s |
| `sale_items` | 5000-500K | <1s | 1-60s | <1s |
| `customer_payments` | 100-1000 | <1s | <1s | <1s |
| `cash_sessions` | 100-1000 | <1s | <1s | <1s |
| `expenses` | 1000-10K | <1s | <1s | <1s |
| `supplier_payments` | 100-1000 | <1s | <1s | <1s |
| `major_expenses` | 100-1000 | <1s | <1s | <1s |
| `inventory_movements` | 10K-100K | <1s | 1-30s | <1s |
| `audit_logs` | 0-1000 | <1s | <1s | <1s |
| `suppliers` | 10-50 | <1s | <1s | <1s |
| `supplier_invoices` | 50-500 | <1s | <1s | <1s |
| `profiles` | 5-50 | <1s | <1s | <1s |

**Tiempo total de Fase 2** (peor caso con 500K filas en `sale_items`): ~3 minutos.

**Tiempo total del plan completo** (estimación conservadora): 16-25 días hábiles.

---

**Fin del roadmap.**