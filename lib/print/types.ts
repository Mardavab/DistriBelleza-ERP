/**
 * Tipos compartidos del módulo de impresión WebUSB.
 */

export type PrintErrorCode =
  | 'unsupported'         // El navegador no soporta WebUSB (no es Chrome/Edge).
  | 'no-device'           // No hay dispositivo autorizado/seleccionado.
  | 'permission-denied'  // El usuario canceló el diálogo o denegó el permiso.
  | 'driver-conflict'     // Windows tiene un driver que bloquea el dispositivo.
  | 'device-lost'         // El dispositivo se desconectó.
  | 'transfer-failed'     // Falló la transferencia USB.
  | 'unsupported-device'  // El dispositivo no parece ser una impresora ESC/POS.
  | 'unknown';

export interface PrintError {
  code: PrintErrorCode;
  message: string;
  cause?: unknown;
}

export function makeError(code: PrintErrorCode, message: string, cause?: unknown): PrintError {
  return { code, message, cause };
}

export type PrinterStatus =
  | 'unsupported'   // El navegador no soporta WebUSB.
  | 'disconnected'  // Aún no se conectó ninguna impresora.
  | 'denied'        // El usuario canceló/denegó el último intento.
  | 'ready';        // Impresora conectada y lista.

export interface PrinterInfo {
  status: PrinterStatus;
  productName?: string;
  manufacturerName?: string;
}