// Dentiva Pro v2.0.0 — Electron main process (ESM).
//
// Owns the workspace, the migration, the session authority and every privileged
// channel. The renderer is a fully sandboxed, context-isolated document that
// talks to this process through the allowlisted preload surface only.
//
// Security boundary:
//   - contextIsolation: true, nodeIntegration: false, sandbox: true
//   - navigation locked to the bundled document itself (no other file: or
//     remote URL can ever load with the privileged preload)
//   - IPC accepted only from the main window's top-level app document
//   - webviews and new windows blocked, CSP enforced by header
//   - printing renders in an isolated, javascript-disabled window served from
//     an in-memory protocol (no URL-size limit, no temp files)
//   - no telemetry, no network client of any kind — the app is offline-first

import { app, BrowserWindow, Menu, session, dialog, protocol } from 'electron';
import path from 'node:path';
import { promises as fsp, existsSync, statSync } from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrateWorkspace } from './lib/migrate.mjs';
import { Workspace } from './lib/db.mjs';
import { SqlRepo } from './lib/repo-sql.mjs';
import { SessionManager } from './lib/auth.mjs';
import { registerIpc } from './lib/ipc.mjs';
import { DB_LAYOUT_VERSION } from './lib/schema.mjs';
import { validatePrintHtml, buildIsolatedHtml, pageSizeForPrint, pageSizeForPdf, normalizePageSize, safePdfFilename, PRINT_CSP } from './lib/print.mjs';
import { startBackupScheduler } from './lib/backup-scheduler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isSmoke = process.env.DENTIVA_SMOKE === '1';
// Development only: an unpackaged build may load a running Vite server when
// DENTIVA_DEV_URL is set (e.g. http://localhost:4173/). Otherwise the built
// dist/ document is loaded — packaged builds never use a dev server.
const devUrl = !app.isPackaged && !isSmoke && /^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(process.env.DENTIVA_DEV_URL || '') ? new URL(process.env.DENTIVA_DEV_URL).href : '';
const PRINT_SCHEME = 'dentiva-print';

let mainWindow = null;
let stopBackupScheduler = null;
let workspace = null;
let repo = null;
let sessions = null;
let migrationResult = null;
const printDocuments = new Map();

if (process.env.DENTIVA_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.DENTIVA_USER_DATA));
}

// Custom schemes must be declared before the app is ready.
protocol.registerSchemesAsPrivileged([{ scheme: PRINT_SCHEME, privileges: { standard: true, secure: true } }]);

const appDocumentUrl = () => (devUrl || pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href);

/** Strip hash + query so in-document navigation compares equal. */
function documentKey(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    return parsed.href;
  } catch {
    return '';
  }
}

/** Only the application's own document may ever be (re)loaded in the main window. */
function isAppDocument(url) {
  return Boolean(url) && documentKey(url) === documentKey(appDocumentUrl());
}

function isTrustedSender(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (event.sender !== mainWindow.webContents) return false;
  const frame = event.senderFrame;
  if (!frame || frame !== mainWindow.webContents.mainFrame) return false;
  return isAppDocument(frame.url);
}

function buildMenu() {
  return Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(devUrl ? [{ role: 'toggleDevTools' }] : []),
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

const crashTimes = [];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#f5f7f8',
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
    if (!isAppDocument(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAppDocument(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('render-process-gone', (_event, details) => {
    console.error('Dentiva Pro renderer exited unexpectedly', details.reason);
    const now = Date.now();
    crashTimes.push(now);
    while (crashTimes.length && now - crashTimes[0] > 60_000) crashTimes.shift();
    if (crashTimes.length > 3) {
      // Never loop: after repeated crashes, stop and tell the user.
      dialog.showMessageBox({
        type: 'error',
        title: 'Dentiva Pro',
        message: 'The Dentiva Pro window stopped responding several times in a row.',
        detail: 'Your data is saved in the local workspace. Close the application and start it again. If this keeps happening, restore from a recent backup.'
      }).catch(() => {});
      return;
    }
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload(); }, 250);
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (isSmoke) {
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
  mainWindow.loadURL(appDocumentUrl());
}

async function runSmokePhase() {
  if (!isSmoke || !mainWindow) return;
  const phase = process.env.DENTIVA_SMOKE_PHASE || 'verify';
  try {
    const dbPath = path.join(app.getPath('userData'), 'dentiva-pro.sqlite');
    const dbStat = existsSync(dbPath) ? statSync(dbPath).size : -1;
    let mainCounts = null;
    try { mainCounts = repo?.counts ? repo.counts() : null; } catch { /* optional capability probe */ }
    console.log(`DENTIVA_SMOKE_DIAG phase=${phase} userData=${app.getPath('userData')} dbBytes=${dbStat} migration=${migrationResult?.status || 'n/a'} layout=${workspace?.getMeta('dbLayoutVersion')} mainCounts=${JSON.stringify(mainCounts)}`);
  } catch (diagError) {
    console.error('DENTIVA_SMOKE_DIAG_FAILED', diagError.message);
  }
  const smoke = await import('./smoke.mjs');
  const fn = phase === 'create' ? smoke.smokeCreate : phase === 'docs' ? smoke.smokeDocs : smoke.smokeVerify;
  try {
    const result = await mainWindow.webContents.executeJavaScript(`(${fn.toString()})()`, true);
    console.log(`DENTIVA_SMOKE_RESULT:${JSON.stringify({ phase, ...result })}`);
    setTimeout(() => app.quit(), 150);
  } catch (error) {
    console.error('DENTIVA_SMOKE_ERROR', error.message);
    setTimeout(() => app.exit(1), 150);
  }
}

function printSession() {
  const printSes = session.fromPartition('dentiva-print-isolated');
  if (!printSes.__dentivaPrintReady) {
    printSes.protocol.handle(PRINT_SCHEME, (request) => {
      const token = new URL(request.url).pathname.replace(/^\/+/, '');
      const html = printDocuments.get(token);
      if (!html) return new Response('Not found', { status: 404 });
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PRINT_CSP } });
    });
    printSes.webRequest.onBeforeRequest((details, callback) => {
      // The isolated document may only load itself and inline data: images.
      callback({ cancel: !(details.url.startsWith(`${PRINT_SCHEME}://`) || details.url.startsWith('data:')) });
    });
    printSes.__dentivaPrintReady = true;
  }
  return printSes;
}

async function handlePrint(_event, payload = {}) {
  const html = typeof payload.html === 'string' ? payload.html : '';
  const check = validatePrintHtml(html);
  if (!check.ok) return { ok: false, error: check.error };
  const mode = payload.options?.mode === 'pdf' ? 'pdf' : 'print';
  const title = typeof payload.options?.title === 'string' && payload.options.title.trim() ? payload.options.title.trim() : 'Dentiva Pro document';
  const pageSize = normalizePageSize(payload.options?.pageSize);
  const landscape = Boolean(payload.options?.landscape);
  const token = crypto.randomUUID();
  printDocuments.set(token, buildIsolatedHtml(html));
  const printWindow = new BrowserWindow({
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, javascript: false, session: printSession() }
  });
  printWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await printWindow.loadURL(`${PRINT_SCHEME}://document/${token}`);
    if (mode === 'print') {
      // Native system print dialog (printer, paper, copies, page range).
      return await new Promise((resolve) => {
        try {
          printWindow.webContents.print(
            { silent: false, printBackground: true, color: true, landscape, margins: { marginType: 'none' }, pageSize: pageSizeForPrint(pageSize) },
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
    // PDF: the document's own @page rule (size + margins) governs geometry, so
    // preview, print and PDF share one layout definition.
    let pdf;
    try {
      pdf = await printWindow.webContents.printToPDF({ printBackground: true, landscape, preferCSSPageSize: true, margins: { marginType: 'none' }, pageSize: pageSizeForPdf(pageSize) });
    } catch {
      pdf = await printWindow.webContents.printToPDF({ printBackground: true, landscape, preferCSSPageSize: true, margins: { marginType: 'none' } });
    }
    if (isSmoke) {
      const smokeDir = path.join(os.tmpdir(), 'dentiva-smoke-pdf');
      await fsp.mkdir(smokeDir, { recursive: true });
      const target = path.join(smokeDir, safePdfFilename(title));
      await fsp.writeFile(target, pdf);
      return { ok: true, saved: true, path: target, bytes: pdf.length, pageSize };
    }
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
    printDocuments.delete(token);
    try { if (!printWindow.isDestroyed()) printWindow.destroy(); } catch { /* window already gone */ }
  }
}

function openWorkspace(storageDirectory) {
  try {
    migrationResult = migrateWorkspace(storageDirectory, { log: (message) => console.log('[migration]', message) });
  } catch (error) {
    migrationResult = { status: 'failed', errors: [error.message] };
    console.error('[migration] failed:', error.message);
  }
  try {
    workspace = new Workspace(storageDirectory).open();
  } catch (error) {
    // Never stamp a new schema onto a store we could not migrate: stop and tell the user where the data is.
    dialog.showErrorBox('Dentiva Pro could not open your workspace',
      `${error.code === 'foreign-layout' ? 'The workspace database uses an older or unrecognised layout and could not be upgraded automatically.' : `The workspace database could not be opened (${error.message}).`}\n\nNothing was deleted. Your data folder is:\n${storageDirectory}\n\n${(migrationResult?.errors || []).join('\n')}\n\nContact support with this message, or restore a backup on another installation.`);
    app.exit(1);
    return false;
  }
  repo = new SqlRepo(workspace);
  sessions = new SessionManager({ repo });
  const layoutVersion = Number(workspace.getMeta('dbLayoutVersion'));
  if (Number.isInteger(layoutVersion) && layoutVersion > DB_LAYOUT_VERSION) {
    workspace.setMeta('unsupportedSchema', true);
    workspace.setMeta('migrationError', `This workspace was created by a newer Dentiva Pro (layout v${layoutVersion}; this build supports v${DB_LAYOUT_VERSION}). Install the newer version to continue.`);
  } else if (workspace.getMeta('unsupportedSchema', false)) {
    workspace.setMeta('unsupportedSchema', false);
    workspace.setMeta('migrationError', '');
  }
  const previous = workspace.getMeta('runningSession', null);
  if (previous && previous.pid) {
    // The last session ended without a clean shutdown (crash, power loss).
    const quick = workspace.quickCheck();
    workspace.setMeta('lastUncleanShutdown', { detectedAt: new Date().toISOString(), previous, quickCheck: quick.integrity });
    console.warn(`[startup] previous session ended uncleanly; quick_check=${quick.integrity}`);
  }
  workspace.setMeta('runningSession', { pid: process.pid, startedAt: new Date().toISOString(), version: app.getVersion() });
  workspace.setMeta('appVersion', app.getVersion());
  return true;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another instance owns the workspace: exit immediately without touching it.
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(buildMenu());
    if (!openWorkspace(app.getPath('userData'))) return;

    registerIpc({
      repo, ws: workspace, sessions, isTrustedSender,
      log: (message) => console.error('[ipc]', message),
      extraHandlers: {
        'app:info': () => ({
          ok: true,
          version: app.getVersion(),
          platform: process.platform,
          arch: process.arch,
          isDesktop: true,
          packaged: app.isPackaged,
          electron: process.versions.electron,
          storage: workspace.storageInfo({ includeCounts: false }).storage,
          migration: { status: migrationResult?.status || 'unknown', errors: migrationResult?.errors || [], applied: workspace.appliedMigrations || [] }
        }),
        'print:html': handlePrint
      }
    });
    stopBackupScheduler = startBackupScheduler({ repo, ws: workspace, log: (message) => console.log(message) });

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const connect = devUrl ? `'self' ${new URL(devUrl).origin} ws://${new URL(devUrl).host}` : "'self'";
      const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src ${connect}; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; frame-src 'self' about: data:;`;
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
    });
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

    createWindow();
    if (isSmoke) mainWindow.webContents.once('did-finish-load', runSmokePhase);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => { if (!isSmoke && process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => {
    try { if (stopBackupScheduler) stopBackupScheduler(); } catch { /* timer already gone */ }
    try {
      if (workspace && workspace.db) {
        workspace.setMeta('lastShutdown', { at: new Date().toISOString(), clean: true, version: app.getVersion() });
        workspace.setMeta('runningSession', null);
        workspace.close();
      }
    } catch { /* best effort */ }
  });
}
