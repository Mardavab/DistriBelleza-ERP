/**
 * Reglas de dominio para detectar uso reciente de un tenant.
 *
 * Son funciones puras y sin dependencias de React: la consola de plataforma
 * las usa para pintar KPIs y para etiquetar cada fila de la lista, y ambas
 * necesitan exactamente el mismo criterio.
 */

/** Días sin ventas a partir de los cuales se considera una empresa sin uso. */
export const IDLE_DAYS_THRESHOLD = 30;

/** Días transcurridos desde una fecha ISO. `null` si la fecha no existe. */
export function daysSince(dateStr: string | null | undefined): number | null {
    if (!dateStr) return null;
    const then = new Date(dateStr).getTime();
    if (Number.isNaN(then)) return null;
    return Math.floor((Date.now() - then) / 86_400_000);
}

/**
 * Una empresa está "sin uso reciente" si lleva más de `IDLE_DAYS_THRESHOLD`
 * días sin ventas. Una empresa sin ninguna venta también cuenta como sin uso.
 */
export function isIdleCompany(lastSaleAt: string | null | undefined): boolean {
    const days = daysSince(lastSaleAt);
    return days === null || days > IDLE_DAYS_THRESHOLD;
}

/** "Hoy" / "hace 3 días" para la columna de última venta. */
export function formatLastSale(dateStr: string | null | undefined): string {
    const days = daysSince(dateStr);
    if (days === null) return 'Sin registros';
    if (days === 0) return 'Hoy';
    return `hace ${days} día${days === 1 ? '' : 's'}`;
}