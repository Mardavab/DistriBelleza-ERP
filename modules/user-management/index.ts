/**
 * Superficie pública del módulo `user-management`.
 *
 * Solo se exporta la vista que monta la ruta `/configuracion`. Las server
 * actions (`app/actions/users.ts`, `app/actions/branches.ts`) NO se mueven
 * aquí: `branches.ts` lo consumen también `Dashboard/BranchManagement` y
 * `app/actions/reports.ts`, y `users.ts` alimenta el flujo de
 * `app/accept-invitation`. Un módulo solo es dueño de sus actions cuando
 * nadie más las usa.
 */

export { default as UserManagement } from './ui/UserManagement'
