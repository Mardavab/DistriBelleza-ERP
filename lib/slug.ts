/**
 * Utilidades de slug para identificadores de tenant.
 *
 * El slug es la parte legible del dominio (ej. `distribelleza`) y es la clave
 * que usa la restricción UNIQUE de `companies.slug`, así que debe ser
 * determinista y no depender de locale ni del servidor.
 */

/**
 * Convierte un nombre comercial en un slug válido para `companies.slug`.
 *
 * - Normaliza a NFD y elimina diacríticos ("Belloz" -> "belleza", "Ñandú" -> "nandu")
 * - Sustituye cualquier secuencia no alfanumérica por un único guion
 * - Recorta guiones al inicio y al final
 * - Limita a 50 caracteres, igual que el patrón del formulario
 */
export function slugify(name: string): string {
    return name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50);
}