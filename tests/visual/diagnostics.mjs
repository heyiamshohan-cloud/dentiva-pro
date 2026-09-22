import { test } from '@playwright/test';
import fs from 'node:fs';

// Captures per-test page diagnostics (JS exceptions, console errors, failed
// requests, DOM/store snapshot) so a failed run is diagnosable even when CI
// logs cannot be read from the development sandbox (blob downloads are
// TLS-blocked there). The workflow's "Surface visual failure diagnostics"
// step turns these files + the JSON report into GitHub step annotations.

test.beforeEach(async ({ page }) => {
  page._diagnostics = { pageErrors: [], consoleErrors: [], requestFailures: [] };
  page.on('pageerror', (err) => {
    page._diagnostics.pageErrors.push(String((err && err.stack) || err).slice(0, 2000));
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      page._diagnostics.consoleErrors.push(msg.text().slice(0, 500));
    }
  });
  page.on('requestfailed', (req) => {
    page._diagnostics.requestFailures.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText || 'failed'}`);
  });
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus && testInfo.status === 'passed') return;
  const d = page._diagnostics || { pageErrors: [], consoleErrors: [], requestFailures: [] };
  try {
    const snapshot = await page.evaluate(() => ({
      readyState: document.readyState,
      title: document.title,
      appHtml: (document.querySelector('#app')?.innerHTML || '').slice(0, 3000),
      bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 1200),
      modalPresent: Boolean(document.querySelector('.modal-overlay')),
      storeKeys: Object.keys(localStorage),
      storeBytes: (localStorage.getItem('dentiva-pro.store.v2') || '').length
    }));
    const diag = {
      file: testInfo.location.file.split('/').pop(),
      title: testInfo.title,
      project: testInfo.project.name,
      status: testInfo.status,
      expected: testInfo.expectedStatus,
      error: (testInfo.error?.message || '').replace(/\s+/g, ' ').slice(0, 2000),
      pageErrors: d.pageErrors.slice(0, 10),
      consoleErrors: d.consoleErrors.slice(-15),
      requestFailures: d.requestFailures.slice(0, 10),
      snapshot
    };
    fs.mkdirSync('test-results', { recursive: true });
    const safe = testInfo.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 50);
    fs.writeFileSync(`test-results/diag-${testInfo.project.name}-${safe}.json`, JSON.stringify(diag, null, 1));
    console.log(`[visual-diagnostics] captured ${safe}`);
  } catch (error) {
    console.log(`[visual-diagnostics] capture failed: ${error.message}`);
  }
});

export {};
