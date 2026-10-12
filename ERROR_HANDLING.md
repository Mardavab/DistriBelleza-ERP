# Manejo de Errores — DistriBelleza

Patrón canónico para manejo de errores en server actions, helpers de auth
y código de cliente.

## TL;DR

| Capa | Helper | Ejemplo |
| --- | --- | --- |
| Server actions | `handleActionError(err, context)` | `try { ... } catch (e) { return handleActionError(e, 'processPOSSale'); }` |
| Helpers puros | `withErrorLogging(fn, ctx)` | `await withErrorLogging(() => fetchData(), 'refresh')` |
| Cliente silencioso | `warnSilently(ctx, err)` | `fetch(...).catch((e) => warnSilently('refresh', e))` |
| Lanzar errores tipados | `err(code, msg, opts)` | `throw err('NOT_FOUND', 'Customer 123 not found')` |

## Tipos

`AppError` es la clase canónica para errores de negocio. Tiene:

- `code`: `AppErrorCode` (ver lista abajo).
- `message`: mensaje técnico (para logs).
- `userMessage`: mensaje user-friendly (para mostrar al usuario).
- `cause`: error original (opcional).

```ts
import { AppError, err } from '@/lib/errors';

throw err('UNAUTHENTICATED', 'No hay sesión activa');
throw err('VALIDATION', 'El SKU es requerido', {
  userMessage: 'Falta el código del producto',
});
```

### `AppErrorCode` permitidos

| Código | Cuándo usarlo | Default user message |
| --- | --- | --- |
| `UNAUTHENTICATED` | Sesión expirada / no hay usuario | "Tu sesión expiró. Inicia sesión de nuevo." |
| `NO_COMPANY_CONTEXT` | Usuario sin empresa asignada | "No tenés una empresa asignada. Contactá al administrador." |
| `FORBIDDEN` | Rol no permite la acción | "No tenés permisos para realizar esta acción." |
| `VALIDATION` | Input del usuario inválido | "Los datos ingresados no son válidos." |
| `NOT_FOUND` | Recurso no existe | "No se encontró el recurso solicitado." |
| `CONFLICT` | Conflicto (stock, duplicate key) | "Otro proceso modificó este recurso. Reintentá." |
| `EXTERNAL` | Error de un servicio externo | "No se pudo conectar con el servicio externo. Reintentá en unos segundos." |
| `NETWORK` | Sin red / timeout | "Sin conexión a internet. Verificá tu red." |
| `UNKNOWN` | Cualquier otro | "Ocurrió un error inesperado. Reintentá." |

## Server Actions

### Patrón estándar

```ts
'use server';

import { handleActionError, err } from '@/lib/errors';

export async function createCustomer(input: CustomerInput) {
  try {
    if (!ctx.user) throw err('UNAUTHENTICATED', 'No user in createCustomer');
    if (!input.email) throw err('VALIDATION', 'Email requerido', {
      userMessage: 'El email es obligatorio.',
    });
    const { data, error } = await supabase.from('customers').insert(input);
    if (error) throw err('EXTERNAL', `insert: ${error.message}`, { cause: error });
    return { success: true, data };
  } catch (caught) {
    return handleActionError(caught, 'createCustomer');
  }
}
```

### Compatibilidad con código legacy

Si el código existente hace `throw 'UNAUTHENTICATED'` o `throw new Error('UNAUTHENTICATED')`,
`handleActionError` lo detecta y devuelve el mensaje correcto. Esto permite
migrar gradualmente sin romper consumidores.

### Respuesta uniforme

Toda server action devuelve:

```ts
type Result<T> = { success: true; data?: T } | { success: false; error: string; code: AppErrorCode };
```

Los clientes pueden:

1. Usar `if (res.success)` para narrowing (cuando TS no logra narrow, usar `isSuccess(res)` / `isFailure(res)`).
2. Mostrar `res.error` al usuario (es el `userMessage` del AppError o el fallback).

## Cliente

### Narrowing con helpers

```ts
import { isFailure } from '@/app/actions/cash_actions'; // ejemplo

if (res.success) {
  // usar res.data
} else if (isFailure(res)) {
  setError(res.error);
}
```

`isSuccess<T>(res)` y `isFailure<T>(res)` son type guards que resuelven el
discriminated union sin depender del narrowing automático de TS (que a veces
falla con `setState<any>`).

### Silenciar errores no críticos

```ts
import { warnSilently } from '@/lib/errors';

fetch('/api/branding')
  .then(setBranding)
  .catch((e) => warnSilently('loadBranding', e));
```

Esto loguea en consola con `console.warn` con un contexto, en vez de tragar
el error sin dejar rastro.

### Wrap automático

```ts
import { withErrorLogging } from '@/lib/errors';

const result = await withErrorLogging(() => loadInitialData(), 'refresh');
if (result === undefined) {
  // falló, ya está logueado
}
```

## Decisiones de diseño

- **No usamos `react-query` ni SWR** (aún). Los catches se manejan manualmente con los helpers. Si en el futuro se agrega cache de cliente, los helpers siguen funcionando.
- **No usamos Sentry u otro APM** (aún). Los logs van a `console.error/warn`. Cuando se integre un servicio de logging, basta cambiar `logError` y `warnSilently` en `lib/errors.ts`.
- **Los `console.log` no se permiten** (regla de ESLint). Para debugging usar `console.warn` con contexto.
- **Los `try/catch` silenciosos están prohibidos en server actions** — siempre usar `handleActionError`. En cliente se permite `warnSilently` para errores no críticos.

## Tests

Los helpers son puros y testeables. Tests pendientes (ver `AUDIT.md`):
- `lib/errors.test.ts` con casos para `AppError`, `handleActionError`, `warnSilently`.

## Migración gradual

Estado actual:
- ✅ `app/actions/sales.ts` migrado (`processPOSSale`).
- ✅ `app/actions/cash_actions.ts` migrado (todas las funciones).
- ✅ `components/Reports/ReportsView.tsx` — catches críticos usan `warnSilently`.
- ✅ `components/Suppliers/SuppliersView.tsx` — catches críticos usan `warnSilently`.
- ⏳ Resto de archivos con `catch {}` — pendiente, pero usando el helper sin
  riesgos. El lint no falla porque el código viejo sigue compilando.

Cuando migres una server action más:
1. Importar `handleActionError` y `err` desde `@/lib/errors`.
2. Reemplazar el bloque `catch (error: any) { ... console.error ... return { success: false, error: ... } }` por `catch (caught) { return handleActionError(caught, 'nombreFuncion'); }`.
3. Reemplazar `throw new Error('MENSAJE')` por `throw err('CODE', 'mensaje', { userMessage, cause })` cuando aplique.
4. Si el archivo no tiene tipo de retorno explícito, agregarlo (ver `ProcessPOSSaleResult` en `sales.ts` como ejemplo).