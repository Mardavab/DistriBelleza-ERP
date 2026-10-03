/**
 * Utilidades de formateo centralizadas.
 *
 * Antes: estas funciones estaban duplicadas en 4+ componentes
 * (POS.tsx, SuppliersView.tsx, InventoryView.tsx, MajorExpensesView.tsx).
 * Ahora: una sola fuente de verdad.
 *
 * Convenciones:
 * - formatCurrency(amount): "$ 1.234.567" (con separador de miles)
 * - formatNumber(amount): "1.234.567" (sin símbolo)
 * - parseCurrencyInput(value): extrae solo dígitos, retorna número
 * - formatCurrencyInput(value): formatea con separadores para mostrar en input
 */

const CURRENCY_LOCALE = 'es-CO'
const CURRENCY_CODE = 'COP'

/**
 * Formatea un número como moneda COP.
 * Ej: 1800000 → "$ 1.800.000"
 */
export function formatCurrency(amount: number | string | null | undefined): string {
    if (amount === null || amount === undefined || amount === '') return '$ 0'
    const num = typeof amount === 'string' ? parseFloat(amount) : amount
    if (isNaN(num)) return '$ 0'
    return new Intl.NumberFormat(CURRENCY_LOCALE, {
        style: 'currency',
        currency: CURRENCY_CODE,
        maximumFractionDigits: 0,
    }).format(num)
}

/**
 * Formatea un número con separador de miles, sin símbolo.
 * Ej: 1800000 → "1.800.000"
 */
export function formatNumber(amount: number | string | null | undefined): string {
    if (amount === null || amount === undefined || amount === '') return '0'
    const num = typeof amount === 'string' ? parseFloat(amount) : amount
    if (isNaN(num)) return '0'
    return new Intl.NumberFormat(CURRENCY_LOCALE, {
        maximumFractionDigits: 0,
    }).format(num)
}

/**
 * Parsea un input de moneda (con comas, puntos, espacios, etc.) a número.
 * Ej: "1.800.000" → 1800000, "$1,500" → 1500, "" → 0
 */
export function parseCurrencyInput(value: string | number | null | undefined): number {
    if (value === null || value === undefined || value === '') return 0
    const str = String(value).replace(/\D/g, '')
    if (!str) return 0
    return parseInt(str, 10)
}

/**
 * Formatea un número para mostrar en un input mientras el usuario escribe.
 * Ej: 1800000 → "1.800.000", 1500 → "1.500"
 */
export function formatCurrencyInput(value: number | string | null | undefined): string {
    const num = parseCurrencyInput(value)
    if (num === 0) return ''
    return new Intl.NumberFormat(CURRENCY_LOCALE, {
        maximumFractionDigits: 0,
    }).format(num)
}

/**
 * Formatea una fecha ISO (YYYY-MM-DD) o Date a formato colombiano corto.
 * Ej: "2026-10-03" → "3 oct 2026"
 */
export function formatDate(date: string | Date | null | undefined): string {
    if (!date) return ''
    const d = typeof date === 'string'
        ? new Date(date.includes('T') ? date : date + 'T12:00:00')
        : date
    return d.toLocaleDateString(CURRENCY_LOCALE, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    })
}

/**
 * Formatea fecha + hora.
 * Ej: "2026-10-03T15:30:00" → "3 oct 2026, 3:30 p. m."
 */
export function formatDateTime(date: string | Date | null | undefined): string {
    if (!date) return ''
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toLocaleString(CURRENCY_LOCALE, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

/**
 * Formatea solo hora.
 * Ej: "2026-10-03T15:30:00" → "3:30 p. m."
 */
export function formatTime(date: string | Date | null | undefined): string {
    if (!date) return ''
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toLocaleTimeString(CURRENCY_LOCALE, {
        hour: '2-digit',
        minute: '2-digit',
    })
}

/**
 * Formatea un número de cédula / teléfono / id con puntos de miles.
 * Para campos que NO son dinero pero se ven mejor con separadores.
 */
export function formatWithThousands(value: string | number): string {
    const str = String(value).replace(/\D/g, '')
    if (!str) return ''
    return new Intl.NumberFormat(CURRENCY_LOCALE).format(parseInt(str, 10))
}