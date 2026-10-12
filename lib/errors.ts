/**
 * Manejo centralizado de errores.
 *
 * Patrones provistos:
 *
 * 1) **Server Actions** — usan `AppError` + `handleActionError`:
 *
 *    ```ts
 *    'use server'
 *    import { AppError, handleActionError } from '@/lib/errors';
 *
 *    export async function createCustomer(input: CustomerInput) {
 *      try {
 *        if (!ctx.user) throw new AppError('UNAUTHENTICATED', 'Falta sesión');
 *        // ...
 *      } catch (err) {
 *        return handleActionError(err, 'createCustomer');
 *      }
 *    }
 *    ```
 *
 * 2) **Client-side silencioso pero observable** — usan `warnSilently`:
 *
 *    ```ts
 *    import { warnSilently } from '@/lib/errors';
 *    fetch(...).catch((e) => warnSilently('refreshSession', e));
 *    ```
 *
 * 3) **Wrap automático con logging** — usan `withErrorLogging`:
 *
 *    ```ts
 *    const result = await withErrorLogging(
 *      () => fetchData(),
 *      'fetchData'
 *    );
 *    ```
 */

/**
 * Códigos de error canónicos de la app.
 *
 * - `UNAUTHENTICATED`: no hay sesión activa.
 * - `NO_COMPANY_CONTEXT`: sesión sin empresa (cuenta de plataforma o sin asignar).
 * - `FORBIDDEN`: el rol del usuario no permite la operación.
 * - `VALIDATION`: input inválido del usuario (formulario, parámetros).
 * - `NOT_FOUND`: recurso no existe.
 * - `CONFLICT`: conflicto (stock, duplicate key, etc).
 * - `EXTERNAL`: error de un servicio externo (Supabase, pasarela de pago, etc.).
 * - `NETWORK`: error de red (sin conexión, timeout).
 * - `UNKNOWN`: cualquier otro error.
 */
export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'NO_COMPANY_CONTEXT'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'EXTERNAL'
  | 'NETWORK'
  | 'UNKNOWN';

/**
 * Mensajes user-friendly por defecto para cada código.
 * El caller puede sobreescribirlos en el constructor.
 */
const DEFAULT_USER_MESSAGES: Record<AppErrorCode, string> = {
  UNAUTHENTICATED: 'Tu sesión expiró. Inicia sesión de nuevo.',
  NO_COMPANY_CONTEXT: 'No tenés una empresa asignada. Contactá al administrador.',
  FORBIDDEN: 'No tenés permisos para realizar esta acción.',
  VALIDATION: 'Los datos ingresados no son válidos.',
  NOT_FOUND: 'No se encontró el recurso solicitado.',
  CONFLICT: 'Otro proceso modificó este recurso. Reintentá.',
  EXTERNAL: 'No se pudo conectar con el servicio externo. Reintentá en unos segundos.',
  NETWORK: 'Sin conexión a internet. Verificá tu red.',
  UNKNOWN: 'Ocurrió un error inesperado. Reintentá.',
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;
  readonly cause?: unknown;

  constructor(
    code: AppErrorCode,
    message: string,
    options?: {
      userMessage?: string;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = options?.userMessage ?? DEFAULT_USER_MESSAGES[code];
    this.cause = options?.cause;
  }

  /**
   * Devuelve un objeto plano para serializar entre server action y client.
   */
  toJSON(): { code: AppErrorCode; message: string; userMessage: string } {
    return {
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
    };
  }
}

/**
 * Helper para detectar si algo es un AppError.
 */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Helper para detectar códigos legacy (string thrown) y normalizarlos.
 *
 * Mantiene compatibilidad con código viejo que hacía `throw new Error('UNAUTHENTICATED')`.
 */
function legacyCodeFromString(value: unknown): AppErrorCode | null {
  if (typeof value !== 'string') return null;
  const known: AppErrorCode[] = [
    'UNAUTHENTICATED',
    'NO_COMPANY_CONTEXT',
    'FORBIDDEN',
    'VALIDATION',
    'NOT_FOUND',
    'CONFLICT',
    'EXTERNAL',
    'NETWORK',
    'UNKNOWN',
  ];
  if ((known as string[]).includes(value)) return value as AppErrorCode;
  if (value.startsWith('CONFLICT_409')) return 'CONFLICT';
  return null;
}

/**
 * Loguea un error. Usar en server actions antes de devolver respuesta.
 */
function logError(context: string, error: unknown): void {
  if (typeof console === 'undefined') return;
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  // eslint-disable-next-line no-console
  console.error(`[${context}] ${message}`, stack ?? '');
}

/**
 * Handler estándar para server actions.
 *
 * Loguea el error y devuelve `{ success: false, error: <mensaje>, code: <código> }`
 * con el `userMessage` del AppError (o un mensaje genérico para unknowns).
 *
 * Para mantener compatibilidad con código que ya devolvía
 * `{ success: false, error: '...' }`, incluimos `error` y `code`.
 */
export function handleActionError(
  error: unknown,
  context: string,
): { success: false; error: string; code: AppErrorCode } {
  if (isAppError(error)) {
    logError(context, error);
    return { success: false, error: error.userMessage, code: error.code };
  }

  // Compatibilidad con strings thrown legacy (ej. throw 'UNAUTHENTICATED')
  if (typeof error === 'string') {
    const code = legacyCodeFromString(error);
    if (code) {
      logError(context, error);
      return { success: false, error: DEFAULT_USER_MESSAGES[code], code };
    }
  }

  if (error instanceof Error) {
    // Errores de Supabase u otros servicios: mensaje corto + log detallado.
    const msg = /unauthor/i.test(error.message)
      ? DEFAULT_USER_MESSAGES.UNAUTHENTICATED
      : /network|timeout|econnrefused/i.test(error.message)
        ? DEFAULT_USER_MESSAGES.NETWORK
        : DEFAULT_USER_MESSAGES.UNKNOWN;
    logError(context, error);
    return { success: false, error: msg, code: 'UNKNOWN' };
  }

  logError(context, error);
  return { success: false, error: DEFAULT_USER_MESSAGES.UNKNOWN, code: 'UNKNOWN' };
}

/**
 * Loguea un error silencioso en consola sin romper el flujo.
 *
 * Usar cuando queremos descartar un catch pero queremos saber qué pasó
 * en desarrollo/staging (ej. `fetch().catch(e => warnSilently('refresh', e))`).
 */
export function warnSilently(context: string, error: unknown): void {
  if (typeof console === 'undefined') return;
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.warn(`[${context}] ${message}`);
}

/**
 * Wrap de una promesa con logging automático de errores.
 *
 * Si la promesa rechaza, loguea y devuelve `undefined` (no rompe el flujo).
 * Si resuelve, devuelve el resultado.
 */
export async function withErrorLogging<T>(
  fn: () => Promise<T>,
  context: string,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    warnSilently(context, error);
    return undefined;
  }
}

/**
 * Helper para crear un mensaje de error rápido para `throw new AppError(...)`.
 *
 * ```ts
 *   throw err('UNAUTHENTICATED', 'No hay sesión activa');
 *   throw err('VALIDATION', 'El SKU es obligatorio', { userMessage: 'Falta el código' });
 * ```
 */
export function err(
  code: AppErrorCode,
  message: string,
  options?: { userMessage?: string; cause?: unknown },
): AppError {
  return new AppError(code, message, options);
}