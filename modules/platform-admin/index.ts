/**
 * Superficie pública del módulo `platform-admin`.
 *
 * Solo se exporta lo que el resto de la app necesita: las vistas que montan
 * las rutas `/plataforma*` y los tipos que consumen. Los componentes internos
 * (`CompanyList`, `CreateCompanyModal`) y las actions se importan dentro del
 * módulo; no deben salir por aquí.
 */

export { default as PlatformDashboard } from './ui/PlatformDashboard'
export { default as CompaniesPanel } from './ui/CompaniesPanel'
export { default as SystemHealth } from './ui/SystemHealth'

export type { CompanyActivity, HealthCheck, HealthStatus } from './types'
