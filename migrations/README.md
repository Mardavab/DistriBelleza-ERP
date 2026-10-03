# Migrations — Multi-tenant DistriBelleza

Esta carpeta contiene los archivos SQL versionados del roadmap multi-tenant.
Cada archivo es idempotente (puede re-ejecutarse sin errores) y reversible
(tiene su correspondiente archivo `RK_*` para rollback).

## Estructura

```
migrations/
├── README.md                                       # Este archivo
├── fase-1-schema-aditivo/                          # ✅ COMPLETADA
│   ├── 20261003100000_create_companies.sql
│   ├── 20261003100100_create_company_settings.sql
│   ├── 20261003100200_create_tenant_migration_audit.sql
│   ├── 20261003100300_add_company_id_to_tables.sql
│   ├── 20261003100400_add_company_fks.sql
│   ├── 20261003100500_convert_unique_to_compound.sql
│   └── RK_20261003100000_drop_companies.sql
│
├── fase-2-backfill/                                # 📍 SIGUIENTE
│   ├── 20261003200000_create_default_tenant.sql
│   ├── 20261003200100_backfill_company_id.sql
│   ├── 20261003200200_audit_backfill.sql
│   ├── 20261003200300_set_company_id_not_null.sql
│   ├── 20261003200400_drop_old_unique_constraints.sql
│   └── RK_20261003200000_rollback_backfill.sql
│
├── tools/                                          # Scripts de soporte
│   ├── diagnose_quick.sql                          # Diagnóstico único consolidado
│   ├── diagnose_fase1_state.sql                     # Diagnóstico detallado Fase 1
│   └── cleanup_brutal_fase1.sql                    # Limpieza de emergencia Fase 1
│
└── legacy/                                         # Schema original pre-multi-tenant
    ├── schema_pre_multitenant.sql
    ├── suppliers_migration.sql
    └── invoices_storage_migration.sql
```

## Convención de nombres

- **Forward:** `YYYYMMDDHHMMSS_descripcion.sql`
- **Rollback:** `RK_YYYYMMDDHHMMSS_descripcion.sql`

## Cómo aplicar una fase

Ejecutar desde el **SQL Editor de Supabase Dashboard** o con `psql`:

```bash
# Opción A: pegar cada archivo en el SQL Editor uno por uno
# Opción B: ejecutar desde terminal
psql "$DATABASE_URL" -f migrations/fase-X/20261003100000_*.sql
```

## Estado actual

- [x] Fase 0 — Backups y preparación
- [x] Fase 1 — Schema aditivo (3 tablas, 16 columnas company_id, 15 FKs, 4 índices únicos, 2 triggers)
- [ ] **Fase 2 — Backfill de `company_id`** ← estás aquí
- [ ] Fase 3 — RPC parametrizadas
- [ ] Fase 4 — Auth multi-tenant
- [ ] Fase 5 — RLS real
- [ ] Fase 6 — Branding y reglas
- [ ] Fase 7 — Cleanup

## ⚠️ Fase 2 — Orden estricto y verificación

Fase 2 es el paso más delicado del multi-tenant. Cualquier fila sin `company_id`
después del backfill causará que el `SET NOT NULL` (paso 2.4) falle con un
error de constraint.

### Orden de ejecución

```
1. 20261003200000_create_default_tenant.sql
   → Crea Distribelleza + 7 settings iniciales.
   → Verificar: SELECT COUNT(*) FROM company_settings WHERE company_id = '11111111-1111-1111-1111-111111111111'; debe devolver 7.

2. 20261003200100_backfill_company_id.sql
   → Asigna company_id a las 15 tablas.
   → Si CUALQUIER tabla tiene NULL restantes, la transacción aborta con RAISE EXCEPTION.
   → El script imprime el conteo de filas actualizadas por tabla.
   → Verificar: la query al final debe devolver 0 filas (sin NULL).

3. 20261003200200_audit_backfill.sql
   → Registra el backfill en tenant_migration_audit.
   → Verificar: SELECT COUNT(*) FROM tenant_migration_audit; debe devolver 15.

4. 20261003200300_set_company_id_not_null.sql
   → SET NOT NULL en 15 columnas.
   → ⚠️ FALLA si hay NULLs. Si falla, ejecutar RK_20261003200000_rollback_backfill.sql.

5. 20261003200400_drop_old_unique_constraints.sql
   → Elimina UNIQUE antiguos (sku, barcode, email, name).
   → Verificar: queries al final deben mostrar 0 constraints UNIQUE antiguos.
```

## Tools — Cuándo usar cada script

### `tools/diagnose_quick.sql`
**Uso principal.** Query único consolidado que muestra el estado completo de
Fase 1. Ejecutar después de aplicar Fase 1 o cuando sospeches que algo está mal.
Devuelve conteos esperados para cada tipo de objeto.

### `tools/diagnose_fase1_state.sql`
Diagnóstico alternativo más detallado, separado por query. Útil cuando
`diagnose_quick.sql` no es suficiente.

### `tools/cleanup_brutal_fase1.sql`
**Solo en emergencia.** Limpieza 100% garantizada de objetos de Fase 1 sin
importar el estado parcial. Usar si una migración quedó a medias y no puedes
continuar. Incluye queries de verificación al final.

## Rollback de emergencia

Si Fase 2 falla y no puedes continuar:

```bash
psql "$DATABASE_URL" -f migrations/fase-2-backfill/RK_20261003200000_rollback_backfill.sql
```

Si Fase 1 falla (después de Fase 0 pero antes de Fase 2):

```bash
psql "$DATABASE_URL" -f migrations/fase-1-schema-aditivo/RK_20261003100000_drop_companies.sql
```

Ambos rollback preservan todos los datos (solo "desasignan" el tenant).

## Próxima fase

Después de Fase 2: **Fase 3 — RPC parametrizadas** (crear funciones `tenant_*`
con `p_company_id`, mantener las viejas como wrapper retrocompatible).