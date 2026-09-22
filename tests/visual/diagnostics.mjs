import { test } from '@playwright/test';
import fs from 'node:fs';

// Captures per-test page diagnostics (JS exceptions, console errors, failed
// requests, DOM/store snapshot) so a failed run is diagnosable even when CI
// logs cannot be read from the development sandbox (blob storage is
// TLS-blocked there). On failure the hook itself emits GitHub step
// annotations (::error on stdout) — the only channel visible via
// `gh run view`/the checks API from that sandbox. A JSON file is also
// written for the HTML/JSON reports and scripts/visual-diagnostics.mjs.

function sanitize(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/\n/g, ' ')
    .replace(/%/g, '%25')
    .replace(/,/g, ' and')
    .replace(/::/g, '--')
    .replace(/\s+/g, ' ')
    .trim();
}

test.beforeEach(async ({ page }) => {
  page._diagnostics = { pageErrors: [], consoleErrors: [], requestFailures: [] };
  page.on('pageerror', (err) => {
    page._diagnostics.pageErrors.push(String((err && err.stack) || err).slice(0, 1500));
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      page._diagnostics.consoleErrors.push(msg.text().slice(0, 400));
    }
  });
  page.on('requestfailed', (req) => {
    page._diagnostics.requestFailures.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText || 'failed'}`);
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const failed = testInfo.status !== testInfo.expectedStatus;
  const d = page._diagnostics || { pageErrors: [], consoleErrors: [], requestFailures: [] };
  let snapshot = null;
  try {
    snapshot = await page.evaluate(() => {
      const out = {};
      try { out.readyState = document.readyState; } catch (e) { out.readyState = String(e); }
      try { out.title = document.title; } catch (e) { out.title = String(e); }
      try { out.appHtml = (document.querySelector('#app')?.innerHTML || '').slice(0, 2000); } catch (e) { out.appHtml = String(e); }
      try { out.bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 800); } catch (e) { out.bodyText = String(e); }
      try { out.modalPresent = Boolean(document.querySelector('.modal-overlay')); } catch (e) { out.modalPresent = String(e); }
      try { out.setupForm = Boolean(document.querySelector('[data-form="setup"]')); } catch (e) { out.setupForm = String(e); }
      try { out.storeKeys = Object.keys(localStorage); out.storeBytes = (localStorage.getItem('dentiva-pro.store.v2') || '').length; } catch (e) { out.storeError = String(e); }
      return out;
    });
  } catch (error) {
    snapshot = { evaluateError: String(error).slice(0, 500) };
  }
  const errText = String((testInfo.error && (testInfo.error.stack || testInfo.error.message)) || testInfo.status || '').slice(0, 1400);

  if (failed) {
    const label = sanitize(`${testInfo.project.name} :: ${testInfo.title}`);
    process.stdout.write(`::error title=visual-fail ${sanitize(label)}::status=${sanitize(testInfo.status)} :: ${sanitize(errText)}\n`);
    process.stdout.write(`::error title=page-state ${sanitize(label)}::pageErrors=[${sanitize((d.pageErrors || []).slice(0, 3).join(' | ')).slice(0, 600)}] console=[${sanitize((d.consoleErrors || []).slice(-5).join(' | ')).slice(0, 400)}] requests=[${sanitize((d.requestFailures || []).slice(0, 3).join(' | ')).slice(0, 300)}] :: ${sanitize(JSON.stringify(snapshot)).slice(0, 1100)}\n`);
  }

  try {
    fs.mkdirSync('test-results', { recursive: true });
    const safe = sanitize(`${testInfo.project.name}-${testInfo.title}`).replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
    fs.writeFileSync(`test-results/diag-${safe}.json`, JSON.stringify({
      file: String(testInfo.location.file).split(/[\\/]/).pop(),
      title: testInfo.title,
      project: testInfo.project.name,
      status: testInfo.status,
      expected: testInfo.expectedStatus,
      error: errText,
      pageErrors: d.pageErrors.slice(0, 10),
      consoleErrors: d.consoleErrors.slice(-15),
      requestFailures: d.requestFailures.slice(0, 10),
      snapshot
    }, null, 1));
  } catch { /* the stdout annotations above already carry the diagnostics */ }
});

export {};
