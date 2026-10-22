/**
 * Superficie pública del módulo `major-expenses`.
 *
 * Solo se exporta la vista que monta la ruta `/gastos-mayores`. El formulario
 * (`MajorExpenseFormModal`), las categorías y las actions viven dentro del
 * módulo.
 */

export { default as MajorExpensesView } from './ui/MajorExpensesView'

export type { MajorExpenseCategory, CategoryConfig } from './ui/categories'
