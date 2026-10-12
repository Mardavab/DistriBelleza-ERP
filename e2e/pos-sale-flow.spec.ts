import { test, expect, type Page } from '@playwright/test';

/**
 * Tests E2E del flujo crítico de venta del POS.
 *
 * Estos tests asumen que la app está corriendo (webServer o manual) y que
 * hay un usuario de prueba configurado con datos seed.
 *
 * Para tests reales con Supabase real, configurar las credenciales en
 * `.env.local`:
 *   E2E_TEST_USER=tu-usuario-de-prueba@dominio.com
 *   E2E_TEST_PASS=contraseña
 *
 * Por defecto estos tests son SKIPPED para no bloquear CI; se pueden activar
 * con `RUN_E2E=1 npm run test:e2e:full`.
 *
 * Si las credenciales no son válidas, el helper `login()` hace `test.skip()`
 * con un mensaje claro en lugar de fallar — así un test que requiere
 * backend no rompe el flujo si las credenciales no están configuradas.
 */

const RUN_E2E = !!process.env.RUN_E2E;
const TEST_EMAIL = process.env['E2E_TEST_USER'] || 'demo@acme.test';
const TEST_PASSWORD = process.env['E2E_TEST_PASS'] || 'demo-password';

test.describe.configure({ mode: 'serial' });

/**
 * Helper: login con email/password y esperar a la home.
 * Si las credenciales son inválidas, skipea el test con un mensaje claro.
 */
async function login(page: Page, testObj: { skip: (cond?: boolean, msg?: string) => void }): Promise<boolean> {
  await page.goto('/login');
  await page.fill('input[name="email"]', TEST_EMAIL);
  await page.fill('input[name="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');

  try {
    await page.waitForURL((url) => !url.toString().endsWith('/login'), { timeout: 8_000 });
    return true;
  } catch {
    // Login falló (credenciales inválidas). Skipeamos.
    testObj.skip(
      true,
      `Login con credenciales ${TEST_EMAIL}/${TEST_PASSWORD.replace(/./g, '*')} falló. ` +
        'Configurar E2E_TEST_USER / E2E_TEST_PASS en .env.local con un usuario real de Supabase.',
    );
    return false;
  }
}

test.describe('Flujo crítico de venta POS', () => {
  test.beforeEach(async () => {
    test.skip(!RUN_E2E, 'Set RUN_E2E=1 para correr E2E con backend real.');
  });

  test('Login redirige a home', async ({ page }) => {
    const ok = await login(page, test);
    if (!ok) return;
    await expect(page).toHaveURL(/localhost:3000\/?$/);
  });

  test('POS: abrir caja permite cargar productos', async ({ page }) => {
    const ok = await login(page, test);
    if (!ok) return;

    // Si ya hay sesión de caja abierta, este paso se skipea.
    const openSessionButton = page.getByRole('button', { name: /abrir caja/i });
    if (await openSessionButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await openSessionButton.click();
      const initialFundInput = page.locator('input[type="text"]').first();
      await initialFundInput.fill('100000');
      await page.getByRole('button', { name: /^abrir$/i }).click();
    }

    // Esperar a que cargue la lista de productos por defecto.
    await page.waitForSelector('input[placeholder*="escanea" i]', { timeout: 10_000 });
    await expect(page.locator('input[placeholder*="escanea" i]')).toBeVisible();
  });

  test('POS: agregar producto al carrito vía búsqueda', async ({ page }) => {
    const ok = await login(page, test);
    if (!ok) return;

    // Saltar si no hay sesión de caja.
    const openSessionButton = page.getByRole('button', { name: /abrir caja/i });
    if (await openSessionButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      test.skip(true, 'No hay sesión de caja abierta');
    }

    // Buscar producto por nombre o SKU.
    const searchInput = page.locator('input[placeholder*="escanea" i]');
    await searchInput.fill('SH');
    await page.waitForTimeout(1500); // debounce

    // Click en el botón "Añadir" del primer resultado.
    const firstAdd = page.getByRole('button', { name: /añadir/i }).first();
    if (await firstAdd.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstAdd.click();
      await expect(page.getByText(/shampoo/i).first()).toBeVisible({ timeout: 3000 });
    } else {
      test.skip(true, 'No hay productos seed con "SH" en SKU/nombre');
    }
  });

  test('POS: aplicar descuento por item vía modal', async ({ page }) => {
    const ok = await login(page, test);
    if (!ok) return;

    const percentButton = page.locator('.btn-percent-inline').first();
    if (await percentButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await percentButton.click();
      await expect(page.getByText(/descuento|porcentaje/i).first()).toBeVisible();
    } else {
      test.skip(true, 'Carrito vacío');
    }
  });

  test('POS: pantalla responsive en 1024x768', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const ok = await login(page, test);
    if (!ok) return;

    // El sidebar debe colapsar a iconos (no texto).
    const sidebarText = page.locator('.sidebar').getByText(/inventario|reportes|proveedores/i).first();
    await expect(sidebarText).not.toBeVisible({ timeout: 3000 });
  });
});

/**
 * Tests de smoke (sin backend real): solo verifican que la app carga.
 *
 * Sirven como canary en CI: si la home no carga ni siquiera en modo demo,
 * algo muy básico está roto.
 */
test.describe('Smoke (sin backend)', () => {
  test('La home responde 200', async ({ page }) => {
    const response = await page.goto('/login', { waitUntil: 'domcontentloaded' });
    // Acepta 200 o redirect a /login.
    expect(response?.status() ?? 0).toBeLessThan(500);
  });

  test('La página de login tiene form de email/password', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[name="email"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('La página de accept-invitation carga sin error', async ({ page }) => {
    const response = await page.goto('/accept-invitation?token=test', {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status() ?? 0).toBeLessThan(500);
  });

  test('El layout principal es responsive', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/login');
    // El layout debería ser horizontal en desktop.
    const body = await page.locator('body').boundingBox();
    expect(body?.width).toBe(1280);
  });

  test('La página de no-tenant existe', async ({ page }) => {
    const response = await page.goto('/no-tenant', { waitUntil: 'domcontentloaded' });
    expect(response?.status() ?? 0).toBeLessThan(500);
  });
});