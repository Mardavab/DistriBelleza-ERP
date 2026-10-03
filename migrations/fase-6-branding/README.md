# Fase 6 — Branding y reglas parametrizadas

Esta fase elimina los hardcodeos de "DistriBelleza" y de las constantes de comisión.

## Archivos creados

| Archivo | Propósito |
|---|---|
| `lib/company.ts` | Helper para cargar datos + settings del tenant |
| `app/actions/settings.ts` | Server actions para settings (billed_to options) |

## Archivos modificados

### Branding dinámico
- `app/layout.tsx` — título de página dinámico
- `app/login/page.tsx` — nombre de empresa dinámico
- `components/Dashboard/Sidebar.tsx` — logo + nombre dinámicos
- `app/page.tsx` — pasa `companyName` al Sidebar
- `print-service/printer.js` — header/footer de recibo desde branding
- `print-service/server.js` — auth con token + routing por tenant
- `print-service/config.json` — config multi-tenant
- `components/POS/PrintReceipt.tsx` — envía token + branding al print service
- `components/POS/POS.tsx` — pasa companyId + branding al receipt

### Comisión por tenant
- `app/actions/cash_actions.ts` — lee commission_threshold/rate de BD
- `app/actions/reports.ts` — incluye goal en summary + nueva action `getCommissionGoalFormatted()`
- `components/POS/POS.tsx` — meta de comisión dinámica

### Eliminar Norby/Marlon
- `components/Suppliers/SuppliersView.tsx` — dropdown dinámico desde `company_settings.default_customer_options`

## Configuración del print service

```
PRINT_SERVICE_TOKEN=<token-seguro-aqui>
```

Añadir a `.env.local` (mismo valor en `print-service/server.js` vía variable de entorno).

## Verificación

1. Login → el sidebar muestra el nombre del tenant (no "DistriBelleza" fijo)
2. Ir a Configuración (no aparece si no eres owner)
4. Crear una factura → dropdown muestra los valores de `company_settings.default_customer_options`
6. Imprimir → el header/footer del recibo usa el branding del tenant
7. El POS muestra la meta de comisión desde settings (no `$1.800.000` fijo)

## Hallazgos cerrados

| # | Hallazgo | Cómo |
|---|---|---|
| P1.1 | Branding hardcodeado | Branding dinámico desde `companies` + `company_settings` |
| P1.2 | Comisión hardcodeada | Comisión desde `company_settings` |
| P1.3 | Norby/Marlon hardcodeados | Dropdown desde `default_customer_options` |
| P0.6 | Print service sin auth | Token compartido + auth middleware |