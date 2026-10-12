import { defineConfig, devices } from '@playwright/test';

/**
 * Configuración de Playwright para tests E2E del flujo crítico de venta.
 *
 * Para correr:
 *   1. `npm run dev` en una terminal (o `npm run e2e` que lo hace solo).
 *   2. `npx playwright test` (smoke) o `RUN_E2E=1 npx playwright test` (full).
 *
 * Variables de entorno:
 *   - E2E_BASE_URL: URL de la app (default: http://localhost:3000).
 *   - RUN_E2E=1: habilita los tests que requieren backend real.
 *   - E2E_TEST_USER / E2E_TEST_PASS: credenciales del usuario de prueba.
 *
 * El flujo crítico de venta incluye:
 *   - Login → Abrir caja → Buscar producto → Agregar al carrito → Cobrar.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // Tests de POS dependen de estado compartido
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // Levanta `next dev` automáticamente si no hay servidor corriendo.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});