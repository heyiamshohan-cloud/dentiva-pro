import { test, expect } from '@playwright/test';

const pages = [
  ['dashboard', 'Dashboard'],
  ['patients', 'Patients'],
  ['appointments', 'Appointments'],
  ['clinical', 'Clinical Records'],
  ['billing', 'Billing'],
  ['inventory', 'Inventory'],
  ['reports', 'Reports'],
  ['settings', 'Settings'],
  ['backup', 'Backup & Restore']
];

test('key workspace surfaces render without viewport overflow', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  if (await page.locator('.modal-backdrop').isVisible()) await page.locator('.modal-backdrop [data-action="close-modal"]').first().click();
  const viewport = page.viewportSize();
  const title = await page.title();
  expect(title).toContain('Dentiva Pro');

  for (const [pageId, label] of pages) {
    if (pageId !== 'dashboard') {
      const nav = page.locator(`[data-action="navigate"][data-page="${pageId}"]`).first();
      if (await page.locator('.menu-button').isVisible()) {
        await page.locator('.menu-button').click();
      }
      await nav.click({ force: true });
    }
    await expect(page.locator('.app-shell, .lock-screen')).toBeVisible();
    if (pageId !== 'dashboard') await expect(page.locator('.breadcrumb strong')).toContainText(label);
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

test('setup and permission-facing controls have accessible names', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-form="setup"]')).toBeVisible();
  await page.locator('.modal-backdrop [data-action="close-modal"]').first().click();
  await expect(page.getByRole('button', { name: /Complete setup|Make this workspace yours/i }).first()).toBeVisible();
  await expect(page.locator('[data-action="open-search"]')).toHaveAttribute('aria-label', 'Search');
  await expect(page.locator('[data-action="open-notifications"]')).toHaveAttribute('aria-label', 'Notifications');
});
