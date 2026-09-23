// Dentiva Pro v1.4.0 — Electron main process (ESM).
//
// Owns the workspace, the migration, the session authority and every privileged
// channel. The renderer is a fully sandboxed, context-isolated document that
// talks to this process through the allowlisted preload surface only.
//
// Security boundary (v1.4.0, re-verified for the relational engine):
//   - contextIsolation: true, nodeIntegration: false, sandbox: true
//   - navigation restricted to the bundled document (dev server in development)
//   - webviews blocked, CSP enforced by header, frame-ancestors 'none'
//   - PDF printing renders in an isolated, javascript-disabled window and
//     refuses active or remote content
//   - no telemetry, no network client of any kind — the app is offline-first

import { app, BrowserWindow, ipcMain, Menu, session, dialog } from 'electron';
import path from 'node:path';
import { promises as fsp, existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrateWorkspace } from './lib/migrate.mjs';
import { Workspace } from './lib/db.mjs';
import { SqlRepo } from './lib/repo-sql.mjs';
import { SessionManager } from './lib/auth.mjs';
import { registerIpc } from './lib/ipc.mjs';
import { DB_LAYOUT_VERSION } from './lib/schema.mjs';
import { validatePrintHtml, buildIsolatedHtml, pageSizeForPrint, pageSizeForPdf, normalizePageSize, safePdfFilename } from './lib/print.mjs';
import { startBackupScheduler } from './lib/backup-scheduler.mjs';
import { diagnoseWorkspace } from './lib/diagnostics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isSmoke = process.env.DENTIVA_SMOKE === '1';
const isDev = !app.isPackaged && !isSmoke;

let mainWindow = null;
let stopBackupScheduler = null;
let workspace = null;
let repo = null;
let sessions = null;
let migrationResult = null;

if (process.env.DENTIVA_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.DENTIVA_USER_DATA));
}

function startUrl() {
  if (isDev) return 'http://localhost:5173/';
  return pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;
}

function isAllowedNavigation(url) {
  if (isDev && url.startsWith('http://localhost:')) return true;
  return url.startsWith('file:');
}

function buildMenu() {
  return Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools', visible: isDev },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#f6f8f9',
    show: false,
    autoHideMenuBar: true,
    title: 'Dentiva Pro',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  const contents = mainWindow.webContents;
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
    try { event.webContents.destroy(); } catch { /* already gone */ }
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('render-process-gone', (_event, details) => {
    console.error('Dentiva Pro renderer exited unexpectedly', details.reason);
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload(); }, 250);
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (isSmoke) {
    // Smoke-only diagnostics bridge: surfaces renderer exceptions/load failures
    // in the harness logs (installed-app phases run from a different executable
    // context than the portable phases and must not fail opaquely).
    mainWindow.webContents.on('console-message', (_event, level, message) => {
      console.log(`DENTIVA_RENDERER_CONSOLE[level=${level}] ${String(message).slice(0, 400)}`);
    });
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, url) => {
      console.error(`DENTIVA_RENDERER_LOAD_FAILED code=${errorCode} ${errorDescription} ${url}`);
    });
    mainWindow.webContents.on('dom-ready', () => {
      console.log(`DENTIVA_RENDERER_DOM_READY url=${mainWindow?.webContents.getURL?.() || '<none>'}`);
    });
  }
  mainWindow.loadURL(startUrl());
}

async function runSmokePhase() {
  if (!isSmoke || !mainWindow) return;
  const phase = process.env.DENTIVA_SMOKE_PHASE || 'verify';
  // Main-side workspace diagnostic at phase start: proves whether the data the
  // portable phases authored is visible to THIS executable before the renderer
  // probe runs (installed vs portable failure isolation).
  try {
    const dbPath = path.join(app.getPath('userData'), 'dentiva-pro.sqlite');
    const dbStat = existsSync(dbPath) ? statSync(dbPath).size : -1;
    let mainCounts = null;
    try {
      if (repo?.storageInfo) mainCounts = repo.storageInfo()?.recordCounts || null;
    } catch { /* optional capability probe */ }
    console.log(`DENTIVA_SMOKE_DIAG phase=${phase} userData=${app.getPath('userData')} dbBytes=${dbStat} migration=${migrationResult?.status || 'n/a'} mainCounts=${JSON.stringify(mainCounts)}`);
  } catch (diagError) {
    console.error('DENTIVA_SMOKE_DIAG_FAILED', diagError.message);
  }
  const script = phase === 'create' ? `(${smokeCreate.toString()})()` : `(${smokeVerify.toString()})()`;
  try {
    const result = await mainWindow.webContents.executeJavaScript(script, true);
    console.log(`DENTIVA_SMOKE_RESULT:${JSON.stringify({ phase, ...result })}`);
    setTimeout(() => app.quit(), 150);
  } catch (error) {
    console.error('DENTIVA_SMOKE_ERROR', error.message);
    setTimeout(() => app.exit(1), 150);
  }
}

// These smoke scripts run only when DENTIVA_SMOKE=1. They exercise the real
// renderer through Electron's webContents — setup, sign-in, patient +
// appointment creation, and create/restart persistence of the same data.
function smokeCreate() {
  const wait = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeout = 12000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (predicate()) return true;
      await wait(100);
    }
    throw new Error('Timed out waiting for the renderer smoke state.');
  };
  const field = (name, value) => {
    const element = document.querySelector(`[name="${name}"]`);
    if (!element) throw new Error(`missing field ${name}`);
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const submit = async (form = 'form[data-form]') => {
    const element = document.querySelector(form);
    if (!element) throw new Error(`missing form ${form}`);
    element.querySelector('button[type="submit"]')?.click();
    await wait();
  };
  const click = async (selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`missing action ${selector}`);
    element.click();
    await wait();
  };
  return (async () => {
    await wait(600);
    if (document.querySelector('form[data-form="setup"]')) {
      field('clinicName', 'Windows Smoke Dental');
      field('dentistName', 'Dr. Smoke Test');
      field('phone', '01700000000');
      field('address', '1 Test Road, Dhaka');
      await submit('form[data-form="setup"]');
      field('currency', 'BDT');
      field('language', 'English');
      field('adminPin', '2468');
      field('adminPinConfirm', '2468');
      await submit('form[data-form="setup"]');
      await click('[data-action="finish-setup"]');
    }
    if (document.querySelector('form[data-form="user-login"]')) {
      field('pin', '2468');
      await submit('form[data-form="user-login"]');
      await waitFor(() => !document.querySelector('form[data-form="user-login"]'));
    }
    await waitFor(() => document.querySelector('[data-action="open-patient"]'));
    await click('[data-action="open-patient"]');
    field('fullName', 'Windows Smoke Patient');
    field('phone', '01800000000');
    await submit('form[data-form="patient"]');
    await waitFor(() => !document.querySelector('form[data-form="patient"]'));
    await click('[data-action="navigate"][data-page="patients"]');
    await waitFor(() => document.body.textContent.includes('Windows Smoke Patient'));
    const patient = document.body.textContent.includes('Windows Smoke Patient');
    if (!patient) throw new Error('created patient was not rendered');
    await click('[data-action="navigate"][data-page="appointments"]');
    await waitFor(() => document.querySelector('[data-action="open-appointment"]'));
    await click('[data-action="open-appointment"]');
    field('patientId', [...document.querySelectorAll('form[data-form="appointment"] select[name="patientId"] option')].find((option) => option.textContent.includes('Windows Smoke Patient'))?.value || '');
    field('date', new Date().toISOString().slice(0, 10));
    field('time', '10:00');
    field('reason', 'Smoke appointment');
    await submit('form[data-form="appointment"]');
    await waitFor(() => !document.querySelector('form[data-form="appointment"]'));
    await click('[data-action="navigate"][data-page="backup"]');
    await waitFor(() => document.body.textContent.includes('Backup') || document.body.textContent.includes('backup'));
    const backupPage = document.body.textContent.includes('Backup') || document.body.textContent.includes('backup');
    if (!backupPage) throw new Error('backup page did not render');
    return { ok: true, patient, backupPage };
  })();
}

function smokeVerify() {
  const wait = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeout = 12000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (predicate()) return true;
      await wait(100);
    }
    return false;
  };
  const snapshot = async () => {
    let patients = [];
    let storageInfo = null;
    try {
      const list = await globalThis.dentiva?.invoke('query:run', { name: 'list', params: { collection: 'patients', page: 1, pageSize: 5 } });
      patients = (list?.rows || []).map((patient) => patient.fullName).slice(0, 4);
    } catch { /* snapshot best effort */ }
    try {
      const info = await globalThis.dentiva?.invoke('workspace:info');
      storageInfo = info?.storage ? { bytes: info.storage.bytes, recordCounts: info.storage.recordCounts } : null;
    } catch { /* snapshot best effort */ }
    // Decisive boot-failure probe: report the bundle script tag, then try to
    // fetch it exactly as the module loader would — separates "never fetched"
    // from "fetched but never evaluated".
    const scriptSrc = document.querySelector('script[type="module"]')?.src || '';
    let bundleProbe = null;
    if (scriptSrc) {
      try {
        const response = await fetch(scriptSrc);
        bundleProbe = `${response.status}:${(await response.text()).length}`;
      } catch (probeError) {
        bundleProbe = `ERR:${String(probeError?.message || probeError).slice(0, 140)}`;
      }
    }
    return {
      body: (document.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
      forms: [...document.querySelectorAll('form[data-form]')].map((form) => form.dataset.form),
      storedPatients: patients,
      storageInfo,
      location: window.location.href,
      readyState: document.readyState,
      bootStatus: window.__bootStatus || null,
      bootError: window.__bootError || null,
      bundleResources: performance.getEntriesByType('resource')
        .filter((entry) => /\/assets\/.+\.(js|css)(\?|$)/.test(entry.name))
        .map((entry) => `${entry.name.split('/').pop()}:${entry.responseEnd.toFixed(0)}`)
        .slice(0, 4),
      scriptSrc,
      bundleProbe,
      headHtml: (document.head?.innerHTML || '').slice(0, 240),
      scriptTags: [...document.getElementsByTagName('script')].map((s) => s.src || 'inline').slice(0, 4)
    };
  };
  return (async () => {
    const mark = (message, extra = '') => console.log(`SMOKE_MARK ${message} ${extra}`.trim());
    mark('verify-start', `readyState=${document.readyState} boot=${window.__bootStatus}`);
    // Session may legitimately appear as the auth screen at any point (fresh
    // process session, idle lock). Sign in whenever it appears instead of
    // treating a transient re-auth as data loss — but log every flip loudly.
    const signInIfNeeded = async (attempt) => {
      const form = document.querySelector('form[data-form="user-login"]');
      if (!form) return true;
      const pin = form.querySelector('[name="pin"]');
      if (!pin) return false;
      mark('auth-present', `attempt=${attempt}`);
      pin.value = '2468';
      pin.dispatchEvent(new Event('input', { bubbles: true }));
      form.querySelector('button[type="submit"]')?.click();
      const cleared = await waitFor(() => !document.querySelector('form[data-form="user-login"]'));
      mark('auth-cleared', `attempt=${attempt} cleared=${cleared}`);
      return cleared;
    };
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (!(await signInIfNeeded(attempt))) return { ok: false, reason: 'sign-in PIN field is missing or submission failed', attempt, ...(await snapshot()) };
      if (await waitFor(() => document.querySelector('[data-action="navigate"][data-page="patients"]'), 12000)) break;
      mark('nav-wait-failed', `attempt=${attempt}`);
      if (!document.querySelector('form[data-form="user-login"]')) {
        return { ok: false, reason: 'patients navigation was unavailable', attempt, ...(await snapshot()) };
      }
    }
    if (!document.querySelector('[data-action="navigate"][data-page="patients"]')) return { ok: false, reason: 'patients navigation was unavailable after re-auth', ...(await snapshot()) };
    mark('nav-found');
    document.querySelector('[data-action="navigate"][data-page="patients"]')?.click();
    mark('nav-clicked');
    const pollStarted = Date.now();
    let hasPatient = false;
    while (Date.now() - pollStarted < 15000) {
      if (document.querySelector('form[data-form="user-login"]')) mark('auth-reappeared-during-patient-wait', `boot=${window.__bootStatus}`);
      await signInIfNeeded(2);
      if (document.body.textContent.includes('Windows Smoke Patient')) { hasPatient = true; break; }
      await wait(400);
    }
    const patientText = document.body.textContent || '';
    if (!hasPatient) return { ok: false, reason: 'patient was not rendered after restart', hasPatient, ...(await snapshot()) };
    mark('patient-found');
    await signInIfNeeded(3);
    if (!await waitFor(() => document.querySelector('[data-action="navigate"][data-page="backup"]'))) return { ok: false, reason: 'backup navigation was unavailable', hasPatient, ...(await snapshot()) };
    document.querySelector('[data-action="navigate"][data-page="backup"]')?.click();
    mark('backup-clicked');
    const hasBackup = await waitFor(() => /Backup/i.test(document.body.textContent || ''));
    mark('verify-end', `ok=${Boolean(hasPatient && hasBackup)}`);
    const backupText = document.body.textContent || '';
    return { ok: Boolean(hasPatient && hasBackup), hasPatient, hasBackup, patientText: patientText.slice(0, 600), backupText: backupText.slice(0, 600), ...(await snapshot()) };
  })();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(buildMenu());

  const storageDirectory = app.getPath('userData');
  try {
    migrationResult = migrateWorkspace(storageDirectory, { log: (message) => console.log('[migration]', message) });
  } catch (error) {
    console.error('Migration failed; a fresh workspace will be prepared.', error.message);
    migrationResult = { status: 'fresh', errors: [error.message] };
  }
  workspace = new Workspace(storageDirectory).open();
  repo = new SqlRepo(workspace);
  sessions = new SessionManager({ repo });
  // Future-layout guard: never let an older build silently edit a newer store.
  const layoutVersion = Number(workspace.getMeta('dbLayoutVersion'));
  if (Number.isInteger(layoutVersion) && layoutVersion > DB_LAYOUT_VERSION) {
    workspace.setMeta('unsupportedSchema', true);
    workspace.setMeta('migrationError', `This workspace was created by a newer Dentiva Pro (layout v${layoutVersion}; this build supports v${DB_LAYOUT_VERSION}). Export the preserved data or upgrade the application.`);
  }
  registerIpc({ repo, ws: workspace, sessions });
  stopBackupScheduler = startBackupScheduler({ repo, ws: workspace, log: (message) => console.log(message) });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isDesktop: true,
    packaged: app.isPackaged,
    storage: 'SQLite (relational v5)',
    migration: { status: migrationResult?.status || 'unknown', errors: migrationResult?.errors || [] }
  }));

  ipcMain.handle('print:html', async (_event, payload = {}) => {
    const html = typeof payload.html === 'string' ? payload.html : '';
    const check = validatePrintHtml(html);
    if (!check.ok) throw new Error(check.error);
    const mode = payload.options?.mode === 'pdf' ? 'pdf' : 'print';
    const title = typeof payload.options?.title === 'string' && payload.options.title.trim() ? payload.options.title.trim() : 'Dentiva Pro document';
    const pageSize = normalizePageSize(payload.options?.pageSize);
    const landscape = Boolean(payload.options?.landscape);
    const printWindow = new BrowserWindow({
      show: false,
      backgroundColor: '#ffffff',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, javascript: false }
    });
    try {
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildIsolatedHtml(html))}`);
      if (mode === 'print') {
        // Native system print dialog (full printer/paper/copies control). The
        // window stays hidden; the OS supplies preview and page selection.
        return await new Promise((resolve) => {
          try {
            printWindow.webContents.print(
              { silent: false, printBackground: true, color: true, landscape, margins: { marginType: 'default' }, pageSize: pageSizeForPrint(pageSize) },
              (success, failureReason) => {
                if (success) return resolve({ ok: true, printed: true, pageSize });
                const reason = String(failureReason || '');
                if (reason.toLowerCase().includes('cancel')) return resolve({ ok: true, cancelled: true });
                return resolve({ ok: false, error: reason || 'The printer did not accept the job.' });
              }
            );
          } catch (error) {
            resolve({ ok: false, error: error?.message || 'Printing failed.' });
          }
        });
      }
      // mode === 'pdf' — render PDF then let the user pick the save location.
      const pdf = await printWindow.webContents.printToPDF({ printBackground: true, landscape, margins: { marginType: 'default' }, pageSize: pageSizeForPdf(pageSize) });
      const picked = await dialog.showSaveDialog(mainWindow, {
        title: `Save ${title}`,
        defaultPath: safePdfFilename(title),
        filters: [{ name: 'PDF document', extensions: ['pdf'] }]
      });
      if (picked.canceled || !picked.filePath) return { ok: true, cancelled: true };
      let target = String(picked.filePath);
      if (!target.toLowerCase().endsWith('.pdf')) target += '.pdf';
      await fsp.writeFile(target, pdf);
      return { ok: true, saved: true, path: target, bytes: pdf.length };
    } catch (error) {
      return { ok: false, error: error?.message || 'Document export failed.' };
    } finally {
      try { if (!printWindow.isDestroyed()) printWindow.destroy(); } catch { /* window already gone */ }
    }
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = "default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://localhost:*; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none';";
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });

  createWindow();
  if (isSmoke) mainWindow.webContents.once('did-finish-load', runSmokePhase);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (!isSmoke && process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  try { if (stopBackupScheduler) stopBackupScheduler(); } catch { /* timer already gone */ }
  try {
    if (workspace) {
      // Persist a health snapshot alongside the shutdown for crash forensics.
      try {
        const report = diagnoseWorkspace(workspace);
        workspace.setMeta('lastShutdown', { at: new Date().toISOString(), ok: report.ok, issues: report.issues.length });
      } catch { /* diagnostics are best effort */ }
      workspace.close();
    }
  } catch { /* best effort */ }
});
