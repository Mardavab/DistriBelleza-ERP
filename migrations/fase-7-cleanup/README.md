# Fase 7 — Cleanup final

Última fase del roadmap multi-tenant. Elimina wrappers retrocompatibles,
código muerto y deja el proyecto en estado limpio.

## Archivos eliminados

| Archivo | Razón |
|---|---|
| `app/actions/pos_actions.ts` | Placeholder de 5 líneas sin funciones reales |
| `app/actions/inventory.ts` | 97 líneas, no importado. La lógica está en `inventory_actions.ts` |
| `scratch/` (17 archivos) | Scripts de diagnóstico ad-hoc con credenciales reales |

## Archivos creados

| Archivo | Propósito |
|---|---|
| `migrations/fase-3-rpc/20261003300300_drop_legacy_wrappers.sql` | DROP de las 4 funciones wrapper |

## SQL ejecutado en Fase 7

`20261003300300_drop_legacy_wrappers.sql` elimina:
- `process_sale(...)` → reemplazado por `tenant_process_sale(p_company_id, ...)`
- `search_inventory(TEXT)` → reemplazado por `tenant_search_inventory(p_company_id, search_term)`
- `delete_sale(UUID)` → reemplazado por `tenant_delete_sale(p_company_id, p_sale_id)`
- `transfer_stock(...)` → reemplazado por `tenant_transfer_stock(p_company_id, ...)`

## Verificación post-Fase 7

### SQL
```sql
-- Solo deben quedar las 4 funciones tenant_*:
SELECT proname FROM pg_proc
WHERE proname LIKE '%_process_sale' OR proname LIKE 'search_inventory%'
   OR proname LIKE 'delete_sale%' OR proname LIKE 'transfer_stock%'
ORDER BY proname;
-- Esperado: tenant_process_sale, tenant_search_inventory, tenant_delete_sale, tenant_transfer_stock
```

### Smoke tests manuales

1. **Login**: ✓ tu usuario actual entra sin problemas
2. **POS - Venta nueva**: crear una venta y verificar que aparece en historial
3. **POS - Anular venta**: verificar que el stock vuelve
4. **Inventario - Crear producto**: con variantes
5. **Proveedores - Crear factura**: dropdown muestra Norby/Marlon/Otros
6. **Reportes - Ver reporte del día**: cálculo de cierre de caja
7. **Configuración - Crear invitación**: genera link
8. **Multi-tenant - Empresa B**: login con test-empresa-b y verificar que solo ve sus datos

## Hallazgos del `.md` original cerrados por multi-tenant

✅ P0.1 (server actions sin auth) → requireAuthContext
✅ P0.2 (escalada de privilegios users.ts) → flujo de invitaciones
✅ P0.3 (RLS ausente) → políticas estrictas
✅ P0.4 (fallback 'manager') → estricto sin fallback
✅ P0.5 (sin server-only guard) → check runtime en lib/supabase.ts
✅ P0.6 (CORS abierto print-service) → token auth
✅ P0.7 (deleteSale sin auth) → RLS protege
✅ P0.8 (ventas sin trazabilidad) → tenant_process_sale con p_company_id
✅ P1.7 (mayoria sin role check) → helpers + invitaciones
✅ P1.8 (comisión duplicada) → company_settings
✅ P2.6 (migraciones sin versionado) → carpeta migrations/

**Total: 11 de 33 hallazgos cerrados.**

## Hallazgos restantes (post multi-tenant)

22 hallazgos que son trabajo de **mejoras de calidad/UX**, no de multi-tenant:
- P1.1 carrito perdido al cambiar tab
- P1.2 errores silenciosos
- P1.3 confirmaciones inconsistentes
- P1.4 transacciones no atómicas
- P1.5 feedback engañoso Dashboard
- P1.6 KPIs falsos hardcoded
- P2.1 god components (POS.tsx, SuppliersView.tsx)
- P2.2 código muerto (limpio en Fase 7)
- P2.3 formateo moneda ×14
- P2.4 PDF generation duplicado
- P2.5 design tokens
- P2.7 clases Tailwind huérfanas
- P2.8 CSS conflictivo
- P2.9 4 estrategias de estilos
- P3.1 accesibilidad
- P3.2 responsive débil
- P3.3 cobertura tests
- P3.4 UserManagement mal ubicado
- P3.5 setInterval re-render
- P3.6 tipado any
- P3.7 validación HTML5