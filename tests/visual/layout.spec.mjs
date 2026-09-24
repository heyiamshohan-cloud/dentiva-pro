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

    // Opening a modal keeps dialog semantics; the footer "Done" returns to the shell
    await page.locator('[data-action="open-notifications"]').click();
    await expect(page.locator('.modal-overlay .modal-window[role="dialog"]')).toBeVisible();
    await page.locator('.modal-overlay .modal-footer [data-action="close-modal"]').click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(page.locator('#main-content .page-header')).toBeVisible();
  });
});

/**
 * v1.6.1 FLAGSHIP SCREEN AUDIT — patients list, command palette, Patient 360,
 * prescription builder + preview. Real Chromium rendering at every shipped
 * viewport (projects matrix 1280x720 → 3840x2160).
 */
test.describe('flagship screen audit (v1.6.1)', () => {
  async function createPatientViaUi(page, name) {
    await page.locator('[data-action="open-patient"]').first().click();
    const form = page.locator('form[data-form="patient"]');
    await expect(form).toBeVisible();
    await form.locator('input[name="fullName"]').fill(name);
    await form.locator('input[name="phone"]').fill('01700000111');
    await form.locator('button[type="submit"]').click();
    await expect(form).toHaveCount(0);
  }

  test('patients list: code column, toolbar, advanced + columns panels, no overflow', async ({ page }) => {
    await page.goto('/');
    await completeFirstRun(page);
    await page.locator('[data-action="navigate"][data-page="patients"]').click();
    await createPatientViaUi(page, 'ডেন্টিভা প্রিমিয়াম রোগী Long Name Patient');
    const list = page.locator('[data-action="navigate"][data-page="patients"]');
    await list.click();
    await expect(page.locator('text=DP-')).toBeVisible({ timeout: 10_000 });
    // toolbar controls exist and are operable
    await expect(page.locator('[data-change="patient-sort"]')).toBeVisible();
    await page.locator('[data-action="patient-filters-toggle"]').click();
    await expect(page.locator('[data-change="patient-tag-filter"], select.patient-filter, .filter-panel').first()).toBeVisible();
    await page.locator('[data-action="patient-columns-toggle"]').click();
    const panels = page.locator('.filter-panel');
    const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const viewWidth = (await page.viewportSize()).width;
    expect(docWidth, 'patients must not overflow horizontally').toBeLessThanOrEqual(viewWidth + 2);
    await page.screenshot({ path: 'test-results/audit-patients.png', fullPage: true });
  });

  test('command palette: actions group, keyboard navigation runs', async ({ page }) => {
    await page.goto('/');
    await completeFirstRun(page);
    await page.keyboard.press('Control+k');
    const input = page.locator('[data-input="command-search"]');
    await expect(input).toBeVisible();
    await expect(page.locator('#command-results .command-section')).not.toHaveCount(0);
    await input.fill('pat');
    await expect(page.locator('#command-results .command-row').first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#command-results .command-row.focused')).toHaveCount(1);
    await input.fill('queue');
    await page.keyboard.press('Enter');
    await expect(page.locator('h1,h2', { hasText: /queue/i }).first()).toBeVisible();
  });

  test('patient 360: identity strip, financial cards, tabs; statement shows opening balance', async ({ page }) => {
    await page.goto('/');
    await completeFirstRun(page);
    await page.locator('[data-action="navigate"][data-page="patients"]').click();
    await createPatientViaUi(page, 'ThreeSixty Test Patient ঢাকা');
    await page.locator('[data-action="navigate"][data-page="patients"]').click();
    await page.locator('tbody tr').first().click();
    await expect(page.locator('.patient-sub')).toContainText('DP-');
    const tabs = page.locator('[data-action="patient-tab"]');
    const tabCount = await tabs.count();
    expect(tabCount, 'patient 360 needs at least 6 tabs').toBeGreaterThanOrEqual(6);
    await expect(page.locator('text=Lifetime billed')).toBeVisible();
    await page.locator('[data-action="patient-tab"][data-tab="statement"]').click();
    await expect(page.locator('text=Opening balance')).toBeVisible();
    await page.locator('[data-action="patient-tab"][data-tab="visits"]').click();
    await page.screenshot({ path: 'test-results/audit-360.png', fullPage: true });
  });

  test('prescription builder: mandated C/C + O/E chips, R/E/Advice sections, money-free preview with patient code', async ({ page }) => {
    await page.goto('/');
    await completeFirstRun(page);
    await page.locator('[data-action="navigate"][data-page="prescriptions"]').click();
    await page.locator('[data-action="open-prescription"]').first().click();
    const rxForm = page.locator('form[data-form="prescription"]');
    await expect(rxForm).toBeVisible();
    // create+select a patient inline first (builder requires an existing patient)
    await rxForm.locator('button:has-text("Close"), [data-action="close-modal"]').first().click();
    await createPatientViaUi(page, 'Rx Premium Patient রোগী');
    await page.locator('[data-action="navigate"][data-page="prescriptions"]').click();
    await page.locator('[data-action="open-prescription"]').first().click();
    await expect(rxForm).toBeVisible();
    const cc = ['Pain On', 'G. Carries', 'Swelling', 'Gum Bleeding', 'Bad Breath', 'Sensitivity'];
    for (const label of cc) await expect(rxForm.locator(`[data-opt="${label}"]`)).toBeVisible();
    const oe = ['Carries / G Carries', 'BDR / BDC', 'Gingivitis', 'Parodental Pocket', 'Perio Dontitis', 'Pulpitis', 'Impected Teeth', 'Dry Socket', 'Attrition / Erosion'];
    for (const label of oe) await expect(rxForm.locator(`[data-opt="${label}"]`)).toBeVisible();
    await rxForm.locator('[data-opt="Pain On"]').click();
    await rxForm.locator('[data-opt="Swelling"]').click();
    await rxForm.locator('[data-opt="Carries / G Carries"]').click();
    await rxForm.locator('textarea[name="requiredExamination"]').fill('IOPA 46');
    await rxForm.locator('textarea[name="advice"]').fill('Warm saline rinse. দুই বেলা মুখ ধুবেন।');
    await rxForm.locator('[name="medications[0][medicine]"]').fill('Amoxicillin ক্যাপসুল');
    await rxForm.locator('[name="medications[0][quantity]"]').fill('15');
    await page.locator('[data-action="rx-preview"]').click();
    const frame = page.locator('.print-preview-frame');
    await expect(frame).toBeVisible();
    const srcdoc = await frame.getAttribute('srcdoc');
    for (const token of ['C/C', 'O/E', 'R/E', 'Advice', 'Pain On', 'Swelling', 'Carries / G Carries', 'DP-', 'ক্যাপসুল', 'Playwright Clinic', 'Dr. Ayesha Rahman']) {
      expect(srcdoc, `preview missing ${token}`).toContain(token);
    }
    const content = srcdoc.slice(srcdoc.indexOf('</style>'));
    for (const bad of ['৳', 'Paid', 'Due', 'Total', 'Tax', 'Discount', 'Payment', 'invoice', 'doc-totals']) {
      expect(content, `preview leaked ${bad}`).not.toContain(bad);
    }
    await page.screenshot({ path: 'test-results/audit-rx-preview.png', fullPage: true });
  });
});
