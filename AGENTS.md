# AGENTS.md — DistriBelleza (GlowCosmetics)

Este archivo define reglas y contexto para todos los agentes/asistentes que trabajen en este repositorio. **Aplica únicamente a este proyecto.**

## 1. Identidad del proyecto

- **Nombre del proyecto (repo):** DistriBelleza
- **Nombre de la app/package:** `glow-cosmetics` (package.json)
- **Proyecto Supabase:** **GlowCosmetics**
- **Project ID (obligatorio):** `rphfzkmzvitgfimcrzkb`
- **Project Ref:** `rphfzkmzvitgfimcrzkb`
- **Supabase URL:** `https://rphfzkmzvitgfimcrzkb.supabase.co`
- **Fuente de verdad:** `.supabase-project.json` (raíz). **Nunca inventar** otro project_id/ref.

## 2. Stack y entorno

- **Lenguaje:** TypeScript `^5.3.3` — `strict: false` (ver `tsconfig.json`)
- **Framework:** Next.js `^14.1.0` con **App Router** (React `^18.2.0`)
- **Build:** SWC (Next.js). Config en `next.config.js`
- **Gestor de paquetes:** **npm** (`package-lock.json` presente)
- **Estructura:** Sin `src/`. Código en `app/`, `components/`, `lib/`, etc.
- **Base de datos:** Supabase (Postgres 17)

## 3. Comandos (build, test, lint, typecheck)

| Acción | Comando | Notas |
|---|---|---|
| Desarrollo | `npm run dev` | Next dev server |
| Build | `npm run build` | Build de producción |
| Start (prod) | `npm run start` | Servir `.next/` |
| Lint | `npm run lint` | ESLint v9 flat (`eslint.config.mjs`) |
| Tests unitarios | `npm run test` | Jest (jsdom). Ignora `e2e/` |
| Tests watch | `npm run test:watch` | Jest watch |
| E2E (smoke) | `npm run test:e2e` | Playwright. Auto-arranca `npm run dev` |
| E2E completo | `npm run test:e2e:full` | `RUN_E2E=1 playwright test` (contra backend real) |
| **Typecheck** | `npx tsc --noEmit` | **No existe script `typecheck`**. Usar este comando para verificar tipos (TS con `noEmit: true`). |

**Regla:** Tras cambios no triviales, ejecutar lint y typecheck cuando corresponda. Verificar tests relevantes si existen.

## 4. Supabase — Reglas obligatorias

- **Usar SIEMPRE** `project_id = "rphfzkmzvitgfimcrzkb"` para este proyecto (GlowCosmetics).
- **Fuente de verdad:** `.supabase-project.json` (raíz). Leerlo antes de cualquier acción con Supabase.
- **Clientes:** usar `@supabase/ssr` (`lib/supabase/server.ts` browser/server). Nunca importar `service_role` en código cliente.
- **Service role:** solo en server-side (server actions, route handlers, scripts internos). `lib/supabase.ts` marca `supabaseAdmin` como server-only.
- **RPCs multi-tenant:** `tenant_process_sale`, `tenant_search_inventory`, `tenant_delete_sale`, `tenant_transfer_stock`. Revisar migraciones en `migrations/fase-*/` antes de modificar.
- **Migraciones:** por fases (`YYYYMMDDHHMMSS_desc.sql`), con rollback `RK_*`. Workflow manual (SQL Editor/psql), no es CLI estándar en este repo (ver `migrations/README.md`).

## 5. Seguridad y convenciones

- **Nunca exponer claves secretas.** `.env.local` contiene `SUPABASE_SERVICE_ROLE_KEY` y ANON (gitignored). No commitear `.env*` con valores reales. **No crear `.env.example`** en este repo (decisión actual).
- **No hardcodear URLs/IDs.** Leer de env vars (`NEXT_PUBLIC_SUPABASE_URL`, etc.) o `.supabase-project.json`.
- **Multi-tenancy:** **Fase 10 cerrada.** Respetar `company_id` y RLS. Revisar contexto empresa (`lib/supabase/company-context.ts`) y membrisías (`lib/supabase/membership-queries.ts`).
- **Server actions multi-tenant — OBLIGATORIO usar `requireAuthContext`:**
  - Toda server action de negocio (POS, inventario, ventas, reportes, etc.) **debe** empezar con `const ctx = await requireAuthContext()`. Esto valida sesión + membrisía + rol en una sola línea.
  - Después, según la acción: `requireOwner(ctx.role)` (solo owners) o `requireRole(ctx.role, ['owner', 'manager'])` (owners + managers).
  - **NUNCA** leer `profiles.role` directamente. El rol vive en `company_memberships.role` (multi-empresa).
  - **NUNCA** detectar platform admin con `role = 'technician'`. Usar `profiles.is_platform_admin = true` (vía `isPlatformUser(userId)` o `requirePlatformRole(['technician'])`).
- **Estilo:** TypeScript no-strict, App Router. No añadir comentarios innecesarios. Seguir patrones existentes en el código.

## 6. Estado del repositorio

- **Fase 10 multi-empresa cerrada** (Bloque A listo para deploy — migraciones pendientes de aplicar en Supabase).
- **Multi-sucursal (Fase 11)**: pendiente, en planificación (ROADMAP_MULTISUCURSAL.md por crear).
- **Working tree sucio** (cambios sin commitear del Bloque A: migraciones 10.6–10.8, refactor en 4 archivos, 53 tests nuevos).
- `migrations/fase-10-multi-empresa/README.md` documenta el orden exacto de aplicación de las migraciones de la fase 10.

## 7. Reglas para agentes

- Leer `.supabase-project.json` antes de cualquier operación de Supabase.
- Usar `npx tsc --noEmit` para typecheck (no asumir script dedicado).
- No inventar `project_id`, URLs o claves. Usar únicamente fuentes existentes.
- No commitear cambios a menos que el usuario lo pida explícitamente.
- Trabajar con el MCP de Supabase configurado (`opencode.json` raíz) y respetar estas reglas.
