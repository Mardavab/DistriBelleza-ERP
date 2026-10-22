# Auditoría completa — DistriBelleza ERP

Auditoría integral del estado actual del repositorio, realizada el 2026-10-11.
Incluye: seguridad, calidad, deuda técnica, cosas innecesarias, mejoras
propuestas e ideas futuras.

---

## Resumen ejecutivo

| Categoría | Estado actual | Notas |
|---|---|---|
| **TypeScript** | ✅ 0 errores | `tsc --noEmit` limpio en todo el proyecto. |
| **ESLint** | ⚠️ 17 errores / 159 warnings | Ver §2. La mayoría son preexistentes. |
| **Tests (Jest)** | ⚠️ 4/5 pasan | 1 layout test falla por mock faltante. |
| **Vulnerabilidades npm** | 🔴 4 críticos / 10 altos / 22 moderados | Principalmente en `next@14` y deps. |
| **XSS** | ✅ Sin superficie | 0 usos de `dangerouslySetInnerHTML`. |
| **Secretos en cliente** | ✅ Bien aislados | `lib/supabase.ts` lanza si se importa en cliente. |
| **Console.log** | ✅ Solo errores/warns permitidos | 0 console.log, 0 console.debug. |
| **Catch vacíos** | ⚠️ 68 silenciados | Ver §4.2. |
| **Print-service** | ✅ Eliminada | `print-service/` borrada en `7f457c2`. Impresión vía WebUSB (`lib/print/`). |
| **Constantes muertas** | ✅ Eliminado | `lib/constants.ts` borrado (no tenía importadores). |

---

## 1. Seguridad

### 1.1 ✅ Lo que está bien

- **`SUPABASE_SERVICE_ROLE_KEY`** está en `lib/supabase.ts` con guard:
  ```ts
  if (typeof window !== 'undefined') {
    throw new Error('lib/supabase.ts debe usarse solo en Server Components…');
  }
  ```
  Imposible que el service role caiga al bundle del cliente.
- **No `NEXT_PUBLIC_*` exponiendo secretos** (auditado). Solo URLs y `APP_URL`.
- **Todas las server actions usan auth helpers** (`requireAuthContext`, `requireRole`, `requirePlatformRole`, `getCurrentCompanyId`). 13 archivos `app/actions/` los invocan consistentemente.
- **Multi-tenancy con RLS**: la base de datos hace el aislamiento por `company_id`; los RPCs (`tenant_*`) son `SECURITY DEFINER` y validan el tenant.
- **No `dangerouslySetInnerHTML`** en ningún archivo.

### 1.2 🔴 Vulnerabilidades npm (npm audit)

| Paquete | Severidad | Issue |
|---|---|---|
| `next@14.x` | **critical** | 25+ advisories activos. Incluye RCE sin auth en Windows, SSRF en rewrites, cache poisoning, DoS en Server Components. |
| `handlebars` | **critical** | JS injection en templates. |
| `shell-quote` | **critical** | Command injection. Usado por `concurrently` (que ya no necesitamos). |
| `postcss` | high | XSS via unescaped `</style>` y path traversal en source maps. |
| `nanoid` | high | Loop infinito en generadores custom. |
| `ws` | high | Memory disclosure + DoS. Usado por Next dev. |
| `dompurify` | moderate | XSS via IN_PLACE. Lo arrastra `@next/eslint-plugin-next`. |
| `braces` / `brace-expansion` | high | DoS recursivo. |

**Causa raíz**: `next@14.1` quedó atrás. La versión `16.x` arregla casi todos estos advisories.

**Acción**:
```bash
npm audit fix          # arregla los que no son breaking
npm audit fix --force   # actualiza next a 16.x — requiere revisar breaking changes
```

**Recomendación**: en una sesión dedicada, migrar a `next@16.x` y verificar que la app sigue funcionando. No es un cambio trivial — afecta routing, server actions, middleware.

### 1.3 Recomendaciones adicionales

- [ ] **CSP (Content Security Policy)** — no hay headers CSP configurados. Agregar `next.config.js` para mitigar XSS.
- [ ] **Rate limiting en login** — no hay protección contra fuerza bruta.
- [ ] **2FA** para cuentas `owner` y `technician` (administradores).
- [ ] **Auditoría de logs**: no hay logging de acciones sensibles (cambios de precio, anulaciones). Agregar tabla `audit_log`.
- [ ] **HTTPS-only cookies**: verificar `secure`, `httpOnly`, `sameSite` de las cookies de Supabase.
- [ ] **Dependabot / Renovate** — no hay config de auto-update de vulnerabilidades.
- [ ] **Penetration test profesional** antes de salir a producción con datos reales.

---

## 2. ESLint (`npx eslint .`)

**17 errores** totales, **159 warnings**.

### 2.1 Errores reales (no preexistentes)

| Archivo | Línea | Regla | Estado |
|---|---|---|---|
| `app/actions/companies.ts` | 81 | `prefer-const` | ✅ **Arreglado** en este commit |
| `components/UI/UserManagement.tsx` | 169 | `react/no-unescaped-entities` | ✅ **Arreglado** |
| `components/Platform/CreateCompanyModal.tsx` | 215 | `react/no-unescaped-entities` | ✅ **Arreglado** |

### 2.2 Errores preexistentes (no introducidos en este PR)

| Archivo | Regla | Cantidad |
|---|---|---|
| `components/POS/POS.tsx` | `use-before-declaration` (handleCheckout antes de declaración) | 1 |
| ~~`print-service/printer.js`~~ | ~~`@typescript-eslint/no-require-imports`~~ | ~~5~~ ✅ |
| ~~`print-service/server.js`~~ | ~~idem~~ | ~~5~~ ✅ |

→ Los 10 errores de `print-service/` desaparecieron al eliminar la carpeta (`7f457c2`). Ver §3.1.

### 2.4 Warnings (todos preexistentes)

- **130** `no-explicit-any` — uso de `any` en tipos. Recomendación: crear tipos compartidos en `types/` y usarlos progresivamente.
- **20** `no-unused-vars` — variables/imports no usados.
- **8** `react-hooks/set-state-in-effect` — patrones de useEffect que settean state directamente. Requieren refactor a `useAction` o patrón de suscripción.
- **Otros**: console statements, eqeqeq allow, etc.

**Acción**: configurar `lint-staged` para correr eslint en pre-commit solo en archivos modificados.

---

## 3. Cosas innecesarias / muertas

### 3.1 `print-service/` (carpeta completa) — ✅ RESUELTO

**Eliminada en `7f457c2`.** No está en el working tree ni en `git ls-files`.

Contenido que tenía (se conserva la descripción como registro):

```
print-service/
├── config.example.json
├── config.json
├── node_modules/
├── package-lock.json
├── package.json
├── printer.js
└── server.js
```

- **Ya no se usaba**. La impresión ahora es WebUSB/WebSerial/window.print del lado del cliente (`lib/print/`).
- El `dev` script ya no la arrancaba (commit `1ddbfa6`).
- Generaba ruido en lint (15 errores de `require()` en .js).

**Estado actual de la impresión:** el branding por tenant (`receipt_header` / `receipt_footer` de `company_settings`, migración fase-6) llega al recibo por `components/POS/POS.tsx` → `components/POS/PrintReceipt.tsx` → `lib/print/`. El check de salud `printing` de la consola de plataforma es informativo (WebUSB local, siempre `ok`).

### 3.2 `lib/constants.ts` — ✅ RESUELTO

**Archivo eliminado.** Contenía solo una constante comentada (`PRINT_SERVICE_URL`) y no tenía importadores.

### 3.3 Imports / variables sin usar

Detectados por ESLint en 8 archivos (POS, Reports, SuppliersView, etc.). Limpieza recomendada en pasada dedicada.

### 3.4 `__tests__/layout.test.tsx`

Test roto preexistente: importa `app/layout.tsx` que importa `lib/company.ts` que importa `lib/supabase.ts` que lanza en jsdom (`window` definido).

**Fix mínimo**:
```ts
jest.mock('../lib/supabase', () => ({
  createClient: () => ({}),
  supabaseAdmin: { from: () => ({}) },
}));
```

---

## 4. Calidad de código

### 4.1 Archivos grandes (deuda técnica)

| Archivo | Líneas | Riesgo | Acción |
|---|---|---|---|
| `components/Suppliers/SuppliersView.tsx` | 1173 | 🟠 Medio | Dividir: tabla, formulario, modal pago, KPIs. |
| `components/POS/POS.tsx` | 646 | 🟡 Bajo | OK por dominio complejo, pero extraer subcomponentes. |
| `components/Inventory/InventoryView.tsx` | 557 | 🟡 Bajo | Extraer `<InventoryTable>` y `<InventoryForm>`. |
| `components/UI/UserManagement.tsx` | 466 | 🟢 Bajo | OK. |
| `components/Reports/ReportsView.tsx` | 361 | 🟢 Bajo | OK. |

### 4.2 68 catch vacíos

```
grep -c "catch.*{}" components/ app/ lib/ → 68
```

Muchos silencian errores sin logging ni notificación al usuario. Patrones típicos:
```ts
.catch(() => {});                          // API call falló, no sabemos
} catch { /* ignore */ }                   // mismo
} catch (e) { console.error(...) }         // OK si logueamos
```

**Recomendación**: crear helper `lib/errors.ts` con `silenceWithWarn(error, context)` que loguee con `console.warn` + contexto, en vez de ignorar.

### 4.3 `console.error` permitidos (45 instancias)

Todos los console statements son `.error` o `.warn` (no `console.log`). Bien.

### 4.4 TypeScript `any` (130 ocurrencias)

Uso extensivo de `any` en lugar de tipos específicos. Causa:
- Falta de tipos compartidos para respuestas RPC de Supabase
- Falta de tipos para `event`, `error` en handlers

**Acción**: crear `types/supabase.ts` con tipos generados (`supabase gen types typescript`).

### 4.5 TODO pendiente

Solo 1 TODO real en el código:
```
app/actions/users.ts:77: // TODO: enviar email con el link de invitación
```

El sistema genera invitaciones pero NO envía el email. Hoy el admin tiene que copiar el link manualmente. **Esto es funcional, no es deuda técnica**, pero limita UX.

---

## 5. Tests

| Suite | Estado | Notas |
|---|---|---|
| `__tests__/timezone.test.ts` | ✅ Pasa | Tests de utilidades de timezone. |
| `__tests__/layout.test.tsx` | ❌ Falla | Mock de supabase faltante. |
| `components/POS/*` | ❌ Sin tests | Componente más crítico sin cobertura. |
| `app/actions/*` | ❌ Sin tests | Lógica de negocio sin cobertura. |
| `lib/print/*` | ❌ Sin tests | Lógica de impresión sin cobertura. |
| `lib/supabase/*` | ❌ Sin tests | Auth helpers sin tests. |

**Cobertura actual**: prácticamente 0%. El único test de utilidad pasa; el de layout falla.

**Recomendación** (priorizado):
1. **Tests de server actions** (`processPOSSale`, `tenant_search_inventory`, etc.) — son el corazón del negocio.
2. **Tests de auth helpers** — porque la seguridad depende de ellos.
3. **Tests de `lib/print/escpos.ts`** — la lógica de bytes ESC/POS es pura y testeable sin DOM.
4. **Tests de integración de POS** — mockear Supabase y verificar flujo completo.

---

## 6. Performance

### 6.1 Bundle size

- `node_modules` pesa 238MB (incluye next, supabase, jest, eslint, etc.).
- `.next/cache` también pesado.

### 6.2 Patrones de render

- **Sin memoización agresiva**: la mayoría de componentes re-renderizan en cada cambio de state. Para POS con cart que cambia mucho, considerar `useMemo` en cálculos de totales.
- **Sin lazy loading**: todos los componentes se cargan eagerly. Para el módulo de Reportes (PDF pesado), usar `dynamic()`.

### 6.3 Queries N+1

- En `InventoryView`, los modales cargan categorías por separado del listado.
- En `SuppliersView`, similar patrón.
- Considerar join/select con relaciones en Supabase.

---

## 7. UX / producto

### 7.1 Problemas conocidos

- **Impresión WebUSB** solo funciona en Chrome/Edge sobre HTTPS. En Safari/Firefox no hay opción.
- **Cajón de dinero** solo automático con WebUSB directo. Si la PC no tiene driver reemplazado, cajón manual.
- **No hay modo offline**: si se cae internet a mitad de venta, la venta queda incompleta.
- **No hay confirmación de stock** al agregar al carrito — solo al cobrar.

### 7.2 Mejoras rápidas

- [ ] **Búsqueda con highlighting** en resultados de productos.
- [ ] **Atajos de teclado** documentados (F2 búsqueda, F4 cobrar).
- [ ] **Sonido al cobrar** (beep de éxito).
- [ ] **Sonido de error** diferenciable.
- [ ] **Modo oscuro** (todo el sistema usa light slate).
- [ ] **Impresión de factura con IVA desglosado** (hoy solo total final).

---

## 9. Ideas futuras

### 9.1 Corto plazo (1-2 sprints)

- [ ] **Migrar a next@16.x** — cerrar vulnerabilities.
- [ ] **Setup Storybook** con los componentes base (`ui-btn`, `ui-card`, `ui-modal`, etc.) para documentar visualmente.
- [ ] **CI con GitHub Actions**: lint + typecheck + audit en cada PR.
- [ ] **Tests E2E con Playwright** para POS flow crítico (login → open cash → add to cart → checkout → print).
- [ ] **Migrar archivos grandes** (`SuppliersView`, `POS.tsx`, `InventoryView`) a subcomponentes.

### 9.2 Mediano plazo (1 trimestre)

- [ ] **Reportes avanzados**: ventas por categoría, comparativa mes vs mes, productos más vendidos.
- [ ] **Multi-idioma**: español + inglés (hoy hardcoded).
- [ ] **Multi-moneda**: tipo de cambio automático.
- [ ] **Exportación contable** a Excel / CSV / formato DIAN.
- [ ] **Notificaciones en tiempo real** (Supabase Realtime) cuando otra caja abre/cierra.
- [ ] **Backups automáticos** de la BD (point-in-time recovery habilitado).

### 9.3 Largo plazo (visión)

- [ ] **App móvil nativa** (React Native) para vendedores ambulantes.
- [ ] **Loyalty program** (puntos por compra, descuentos automáticos).
- [ ] **Integración con marketplaces** (MercadoLibre, Falabella).
- [ ] **BI / Analytics** con dashboards personalizables.
- [ ] **Multi-país** con reglas fiscales por región.
- [ ] **IA predictiva** para forecast de ventas e inventario.

---

## 10. Comando de auditoría rápida

Para repetir este análisis:

```bash
# TypeScript
npx tsc --noEmit

# ESLint (necesario npx directo porque `npm run lint` requiere setup)
npx eslint .

# Tests
npx jest

# Vulnerabilidades npm
npm audit
npm audit --json | jq '.metadata.vulnerabilities'

# Cosas innecivas
grep -rn "console\.log\|console\.debug" components/ app/ --include="*.tsx" --include="*.ts"
grep -rn "catch.*{}" components/ app/ lib/ --include="*.tsx" --include="*.ts" | wc -l
grep -rn "TODO\|FIXME" components/ app/ lib/ --include="*.tsx" --include="*.ts"

# Archivos grandes
find components/ -name "*.tsx" -exec wc -l {} \; | sort -rn
```

---

## 11. Lo que se hizo en este commit

- ✅ `app/actions/companies.ts:81` — `let company` → `const company` (prefer-const).
- ✅ `components/UI/UserManagement.tsx:169` — `"Nuevo Empleado"` → {`"Nuevo Empleado"`}.
- ✅ `components/Platform/CreateCompanyModal.tsx:215` — `{success.trade_name}` escapado.
- ✅ `lib/constants.ts` — archivo eliminado (cero importadores).

**4 errores de lint eliminados**.

---

## Próxima sesión sugerida

Orden recomendado de trabajo futuro:
1. ~~**Eliminar `print-service/`** (carpeta muerta).~~ ✅ Hecho en `7f457c2`.
2. **Arreglar `__tests__/layout.test.tsx`** (mock de supabase).
3. **Tests de server actions críticos** (`processPOSSale`).
4. **Migrar a next@16.x** (cierra 30+ advisories de npm).
5. **Refactor de `SuppliersView.tsx`** (1173 líneas).

---

**Mantener este documento vivo**: actualizar después de cada sprint con nuevos hallazgos.