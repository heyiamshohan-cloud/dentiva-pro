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
import { promises as fsp } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrateWorkspace } from './lib/migrate.mjs';
import { Workspace } from './lib/db.mjs';
import { SqlRepo } from './lib/repo-sql.mjs';
import { SessionManager } from './lib/auth.mjs';
import { registerIpc } from './lib/ipc.mjs';
import { DB_LAYOUT_VERSION } from './lib/schema.mjs';
import { validatePrintHtml, buildIsolatedHtml, pageSizeForPrint, pageSizeForPdf, normalizePageSize, safePdfFilename } from './lib/print.mjs';
import { diagnoseWorkspace } from './lib/diagnostics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isSmoke = process.env.DENTIVA_SMOKE === '1';
const isDev = !app.isPackaged && !isSmoke;

let mainWindow = null;
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
  mainWindow.loadURL(startUrl());
}

async function runSmokePhase() {
  if (!isSmoke || !mainWindow) return;
  const phase = process.env.DENTIVA_SMOKE_PHASE || 'verify';
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
    return {
      body: (document.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
      forms: [...document.querySelectorAll('form[data-form]')].map((form) => form.dataset.form),
      storedPatients: patients,
      storageInfo,
      location: window.location.href
    };
  };
  return (async () => {
    if (document.querySelector('form[data-form="user-login"]')) {
      const pin = document.querySelector('[name="pin"]');
      if (!pin) return { ok: false, reason: 'sign-in PIN field is missing', ...(await snapshot()) };
      pin.value = '2468';
      pin.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form[data-form="user-login"] button[type="submit"]')?.click();
      if (!await waitFor(() => !document.querySelector('form[data-form="user-login"]'))) return { ok: false, reason: 'sign-in did not complete', ...(await snapshot()) };
    }
    if (!await waitFor(() => document.querySelector('[data-action="navigate"][data-page="patients"]'))) return { ok: false, reason: 'patients navigation was unavailable', ...(await snapshot()) };
    document.querySelector('[data-action="navigate"][data-page="patients"]')?.click();
    const hasPatient = await waitFor(() => document.body.textContent.includes('Windows Smoke Patient'));
    const patientText = document.body.textContent || '';
    if (!hasPatient) return { ok: false, reason: 'patient was not rendered after restart', hasPatient, ...(await snapshot()) };
    if (!await waitFor(() => document.querySelector('[data-action="navigate"][data-page="backup"]'))) return { ok: false, reason: 'backup navigation was unavailable', hasPatient, ...(await snapshot()) };
    document.querySelector('[data-action="navigate"][data-page="backup"]')?.click();
    const hasBackup = await waitFor(() => /Backup/i.test(document.body.textContent || ''));
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
