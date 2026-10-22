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
- **Estructura:** Sin `src/`. Código en `app/`, `components/`, `lib/`, `modules/`, `shared/`, etc.
  - `modules/<dominio>/` — módulos de negocio independientes (`platform-admin`, `major-expenses`, `user-management`). Cada uno con `ui/`, `actions/`, `types.ts` e `index.ts` (superficie pública). Un módulo es dueño de sus server actions **solo** cuando ningún otro dominio las consume; si se comparten, se quedan en `app/actions/`.
  - `shared/ui/` — primitivos de UI compartidos entre módulos (`ModalBase`, `CustomSelect`). **Nunca** mover un primitivo dentro de un módulo.
  - `components/` — componentes de feature no modularizados todavía.
  - Los módulos de negocio **no pueden importarse entre sí** (lo frena ESLint `no-restricted-imports` en `eslint.config.mjs`, lista `BUSINESS_MODULES`).
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
- **Roles — modelo de 3 niveles (la autoridad es `middleware.ts`):**

  | Nivel | Rutas | Guardia en server actions |
  |---|---|---|
  | `owner` | las 8 rutas de empresa | `requireAuthContext()` + `requireOwner(ctx.role)` |
  | `manager` | `/`, `/pos`, `/inventario` | `requireRole(['owner', 'manager'])` |
  | `technician` | **solo** `/plataforma*` | `requirePlatformRole(['technician'])` |

  - `requireRole(allowedRoles)` recibe **solo la lista** (un argumento) y devuelve el `ctx`. Usar `const ctx = await requireRole(['owner', 'manager'])` — no hace falta un `requireAuthContext()` aparte.
  - `requireOwner(role)` es síncrono y recibe el rol: `const ctx = await requireAuthContext(); requireOwner(ctx.role)`.
  - Denegación en la URL → redirect a `/` (técnico denegado → `/plataforma`). Las páginas de rutas owner-only repiten el chequeo como doble defensa.
  - **`getFinancialReport` es la única excepción por scope:** `scope='current'` lo puede llamar un manager (alimenta `getDashboardStats` → Panel de Control); `scope='all'` y `scope=<uuid>` exigen owner.
- **Server actions multi-tenant — OBLIGATORIO validar rol y tenant:**
  - Toda server action de negocio **debe** empezar con `const ctx = await requireRole([...])` (manager+) o `const ctx = await requireAuthContext(); requireOwner(ctx.role)` (solo owner). Esto valida sesión + membrisía + rol en una sola línea.
  - **NUNCA** leer `profiles.role` directamente. El rol vive en `company_memberships.role` (multi-empresa).
  - **NUNCA** detectar platform admin con `role = 'technician'`. Usar `profiles.is_platform_admin = true` (vía `isPlatformUser(userId)` o `requirePlatformRole(['technician'])`). `'technician'` también es un rol válido de membresía de empresa, así que ese chequeo deja pasar a cualquiera con ese rol.
  - El middleware enruta por rol leyendo el JWT: `app_metadata.is_platform_admin` y `app_metadata.role`. Esos claims los escriben `login()`, `switchActiveCompanyAction` y `switchActiveBranchAction` (espejo de `profiles` / `company_memberships`). Si cambiás el rol o `is_platform_admin` por otro camino, sincronizá el claim o el enrutar se desincroniza.
- **Auditoría — OBLIGATORIO auditar toda mutación:**
  - Toda server action que **escribe** en BD llama `audit(ctx, action, entityType, options)` (`lib/audit.ts`) tras el éxito. Los `SELECT` no se auditan.
  - `audit()` **nunca lanza**: si el INSERT falla, la operación de negocio no se revierte. No condicionar el resultado de la acción a la auditoría.
  - No enviar secretos en `payload`: se guarda en una columna `jsonb` legible por owners.
  - Tabla `audit_log` (migración `fase-14-audit-log/`): RLS con `SELECT` solo para miembros de la empresa, escritura exclusiva de `service_role`.
- **RPCs `SECURITY DEFINER` — OBLIGATORIO revocar `EXECUTE` a `anon` tras cada `CREATE`:**
  - `pg_default_acl` en el esquema `public` otorga `EXECUTE` a `anon` sobre **toda función nueva**. `anon` es alcanzable sin login (la anon key es pública, está en `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
  - Como las RPCs `SECURITY DEFINER` corren con permisos de `postgres` y bypasean RLS, un caller anónimo podría mutar datos saltándose el middleware, las guardias de rol y la auditoría.
  - Patrón: después de cada `CREATE OR REPLACE FUNCTION` en `public`, hacer `REVOKE EXECUTE ... FROM PUBLIC, anon` y `GRANT ... TO service_role`. Revocar de **ambos** (`anon` tiene grant explícito además del heredado de `PUBLIC`).
  - Verificar con `has_function_privilege('anon', '<firma>', 'EXECUTE')`. Firmas con `pg_get_function_identity_arguments`, nunca a mano.
  - Las server actions llaman las RPCs con `supabaseAdmin` (`service_role`), así que revocar `authenticated` no rompe nada. Excepción conocida: `accept_invitation` necesita `anon` porque `/accept-invitation` se ejecuta con el invitado sin sesión.
  - **`search_path` fijado:** toda función debe llevar `SET search_path = public, extensions, pg_temp`. Sin eso, `pg_temp` se busca primero y un caller (que puede crear tablas temporales: `has_database_privilege(..., 'TEMP')` es `true` para `anon`) puede hacer que `FROM invitations` resuelva a su tabla falsa. Al nombrar `pg_temp` al final, `public` gana. Ver `fase-17-function-search-path/`.
  - Migraciones de referencia: `fase-16-harden-rpc-grants/`, `fase-17-function-search-path/`.
- **Resultados de server actions:** contrato canónico en `lib/errors.ts` (`ActionResult<T> = { success: true; data?: T } | { success: false; error; code }`).
  - Éxito: `return { success: true as const, data }`. Sin payload: `Promise<ActionResult<never>>`.
  - Fallo: `throw err('<AppErrorCode>', <detalle>, { userMessage })` y `return handleActionError(e, '<nombreAccion>')`. **No** devolver `{ success: false, error }` a mano: sin `code` el consumidor no puede clasificar.
  - Los helpers de guardia (`requireAuthContext`, `requireOwner`, `requireRole`, `requirePlatformRole`, `requireBranchContext`, `getCurrentCompanyId`) deben lanzar `AppError` vía `err()` para que `handleActionError` clasifique el `code`. Si agregas uno nuevo, no lances `Error` plano.
  - En componentes cliente usar los guards `isSuccess(res)` / `isFailure(res)` de `lib/errors` (narrowing de la unión discriminada), no `res.success && res.data`.
- **CSS por módulo:** un módulo con stylesheet propio hace que cada `.tsx` de su `ui/` lo importe (`import './platform-admin.css'`). Los CSS son globales (no hay CSS Modules en este repo), así que el import evita que los estilos desaparezcan con code-splitting. `user-management` no lleva stylesheet: sus clases globales viven en `app/globals.css`.
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
