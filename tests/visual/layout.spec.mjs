import { test, expect } from '@playwright/test';
import './diagnostics.mjs';

const ADMIN_PIN = '2468';

/**
 * v1.4.0 first-run contract: a fresh profile boots into the app shell with
 * the 3-step setup modal auto-opened (no session yet, no login screen).
 * The workspace is only reachable after:
 *   step 1 (clinic identity) -> step 2 (language/currency + first admin PIN)
 *   -> step 3 (enter workspace) -> local PIN sign-in.
 * This helper drives that real flow so layout tests exercise the signed-in
 * shell. PBKDF2 (210k iterations, WebCrypto) runs inside the browser during
 * user.create and login, so the flow is a little slower than a plain click.
 */
async function completeFirstRun(page) {
  const setup = page.locator('[data-form="setup"]');
  await expect(setup).toBeVisible({ timeout: 15_000 });

  // Step 1 — clinic identity
  await setup.locator('input[name="clinicName"]').fill('Playwright Clinic');
  await setup.locator('input[name="dentistName"]').fill('Dr. Ayesha Rahman');
  await setup.locator('input[name="phone"]').fill('+880 1712-345678');
  await setup.locator('textarea[name="address"]').fill('12 Playwright Road');
  await setup.locator('.modal-footer .btn-primary').click(); // Continue

  // Step 2 — language, currency, first administrator PIN
  await expect(page.locator('input[name="adminPin"]')).toBeVisible();
  await page.locator('input[name="adminPin"]').fill(ADMIN_PIN);
  await page.locator('input[name="adminPinConfirm"]').fill(ADMIN_PIN);
  await page.locator('.modal-footer .btn-primary').click(); // Finish setup

  // Step 3 — enter workspace
  await expect(page.locator('.setup-success')).toBeVisible();
  await page.locator('[data-action="finish-setup"]').click();

  // First run ends on the local sign-in screen
  await expect(page.locator('form[data-form="user-login"]')).toBeVisible();
  await page.locator('form[data-form="user-login"] input[name="pin"]').fill(ADMIN_PIN);
  await page.locator('form[data-form="user-login"] button[type="submit"]').click();

  // A signed-in session adds the topbar controls and renders the dashboard
  await expect(page.locator('[data-action="open-notifications"]')).toBeVisible();
  await expect(page.locator('#main-content .page-header')).toBeVisible();
}

test.describe('v1.4.0 workspace layout', () => {
  test.describe.configure({ timeout: 90_000 });

  // One surface per navigation group: Workspace, Clinical, Finance,
  // Operations, Insights, System.
  const pages = [
    ['dashboard', 'Dashboard'],
    ['patients', 'Patients'],
    ['appointments', 'Appointments'],
    ['queue', "Today's Queue"],
    ['clinical', 'Clinical Records'],
    ['dental', 'Dental Chart'],
    ['billing', 'Billing'],
    ['payments', 'Payments'],
    ['accounting', 'Accounting'],
    ['inventory', 'Inventory'],
    ['staff', 'Staff'],
    ['reports', 'Reports'],
    ['analytics', 'Analytics'],
    ['backup', 'Backup & Restore'],
    ['users', 'User Accounts'],
    ['settings', 'Settings']
  ];

  test('key workspace surfaces render without viewport overflow', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.locator('#app')).toBeVisible();
    const title = await page.title();
    expect(title).toContain('Dentiva Pro');

    await completeFirstRun(page);
    const viewport = page.viewportSize();

    for (const [pageId, label] of pages) {
      if (pageId !== 'dashboard') {
        const nav = page.locator(`.sidebar [data-action="navigate"][data-page="${pageId}"]`);
        if (await page.locator('[data-action="toggle-mobile-nav"]').isVisible()) {
          await page.locator('[data-action="toggle-mobile-nav"]').click();
        }
        await nav.click();
      }
      await expect(page.locator('#main-content .page-header')).toBeVisible();
      // The dashboard header is a greeting ("Good morning/afternoon/evening, <name>"),
      // not the navigation label; every other page uses the label verbatim.
      if (pageId !== 'dashboard') await expect(page.locator('#main-content .page-header h1')).toHaveText(label);
      // A thrown page renderer shows this fallback — fail loudly instead of
      // screenshotting an error state as if it were the real page.
      await expect(page.locator('#main-content .empty-state h3', { hasText: 'View could not be loaded' })).toHaveCount(0);

      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        appWidth: document.querySelector('#app')?.scrollWidth || 0,
        visibleText: document.querySelector('#app')?.innerText?.length || 0
      }));
      expect(layout.visibleText, `${pageId} rendered no useful surface`).toBeGreaterThan(20);
      expect(layout.documentWidth, `${pageId} overflows horizontally`).toBeLessThanOrEqual(viewport.width + 2);
      expect(layout.bodyWidth, `${pageId} body overflows horizontally`).toBeLessThanOrEqual(viewport.width + 2);
      await page.screenshot({ path: `test-results/${testInfo.project.name}-${pageId}.png`, fullPage: true });
    }
  });

  test('setup, navigation and session controls have accessible names', async ({ page }) => {
    await page.goto('/');
    // The auto-opened first-run modal is a labelled dialog
    await expect(page.locator('.modal-overlay .modal-window[role="dialog"][aria-modal="true"]')).toBeVisible();

    await completeFirstRun(page);

    await expect(page.locator('.sidebar')).toHaveAttribute('aria-label', 'Primary navigation');
    await expect(page.locator('[data-action="open-notifications"]')).toHaveAttribute('aria-label', 'Notifications');
    await expect(page.locator('[data-action="lock-workspace"]')).toHaveAttribute('aria-label', 'Lock workspace');
    await expect(page.locator('input[data-input="global-search"]')).toHaveAttribute('aria-label', 'Search your workspace');

    // Opening a modal keeps dialog semantics; Done returns to the shell
    await page.locator('[data-action="open-notifications"]').click();
    await expect(page.locator('.modal-overlay .modal-window[role="dialog"]')).toBeVisible();
    await page.locator('.modal-overlay [data-action="close-modal"]').click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(page.locator('#main-content .page-header')).toBeVisible();
  });
});
