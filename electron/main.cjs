const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { createSQLiteStore } = require('./storage.cjs');

const isDev = !app.isPackaged;
const isSmoke = process.env.DENTIVA_SMOKE === '1';
let mainWindow;
let durableStore;

if (process.env.DENTIVA_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.DENTIVA_USER_DATA));
}

function loadStore() {
  return durableStore?.load?.() || null;
}

function saveStore(payload) {
  return durableStore?.save?.(payload) || { ok: false, error: 'The local database is not ready.' };
}

function resetStore() {
  return durableStore?.reset?.() || { ok: false, error: 'The local database is not ready.' };
}

function isAllowedNavigation(url) {
  if (isDev && url.startsWith('http://localhost:')) return true;
  return url.startsWith('file:');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#f7f8f8',
    show: false,
    autoHideMenuBar: true,
    title: 'Dentiva Pro',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  const startUrl = isSmoke || !isDev
    ? pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).toString()
    : (process.env.DENTIVA_DEV_SERVER || 'http://localhost:4173');
  mainWindow.loadURL(startUrl);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.on('devtools-opened', () => {
    if (!isDev) mainWindow.webContents.closeDevTools();
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || mainWindow?.isDestroyed()) return;
    console.error('Dentiva Pro renderer exited unexpectedly', details.reason);
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload(); }, 250);
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

async function runSmokePhase() {
  if (!isSmoke || !mainWindow) return;
  const phase = process.env.DENTIVA_SMOKE_PHASE || 'verify';
  const script = phase === 'create'
    ? `(${smokeCreate.toString()})()`
    : `(${smokeVerify.toString()})()`;
  try {
    const result = await mainWindow.webContents.executeJavaScript(script, true);
    console.log(`DENTIVA_SMOKE_RESULT:${JSON.stringify({ phase, ...result })}`);
    setTimeout(() => app.exit(result?.ok ? 0 : 1), 150);
  } catch (error) {
    console.error('DENTIVA_SMOKE_ERROR', error.message);
    setTimeout(() => app.exit(1), 150);
  }
}

// These smoke scripts run only when DENTIVA_SMOKE=1. They exercise the real renderer
// through Electron's webContents, not a mocked DOM or a source-only assertion.
function smokeCreate() {
  const wait = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeout = 12000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (predicate()) return;
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
    await wait(500);
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
    const patient = [...document.querySelectorAll('.clickable-row, [data-id]')].some((row) => row.textContent?.includes('Windows Smoke Patient')) || document.body.textContent.includes('Windows Smoke Patient');
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
  const snapshot = () => {
    const stored = globalThis.dentivaDesktop?.storeLoad?.() || {};
    return {
      body: (document.body.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 1200),
      forms: [...document.querySelectorAll('form[data-form]')].map((form) => form.dataset.form),
      storedPatients: Array.isArray(stored.patients) ? stored.patients.map((patient) => patient.fullName).slice(0, 4) : [],
      storedUsers: Array.isArray(stored.users) ? stored.users.map((user) => ({ name: user.name, active: user.active, hasPin: Boolean(user.pinHash) })).slice(0, 4) : []
    };
  };
  return (async () => {
    if (document.querySelector('form[data-form="user-login"]')) {
      const pin = document.querySelector('[name="pin"]');
      if (!pin) return { ok: false, reason: 'sign-in PIN field is missing', ...snapshot() };
      pin.value = '2468';
      pin.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form[data-form="user-login"] button[type="submit"]')?.click();
      if (!await waitFor(() => !document.querySelector('form[data-form="user-login"]'))) return { ok: false, reason: 'sign-in did not complete', ...snapshot() };
    }
    if (!await waitFor(() => document.querySelector('[data-action="navigate"][data-page="patients"]'))) return { ok: false, reason: 'patients navigation was unavailable', ...snapshot() };
    document.querySelector('[data-action="navigate"][data-page="patients"]')?.click();
    const hasPatient = await waitFor(() => document.body.textContent.includes('Windows Smoke Patient'));
    const patientText = document.body.textContent || '';
    if (!hasPatient) return { ok: false, reason: 'patient was not rendered after restart', hasPatient, ...snapshot() };
    if (!await waitFor(() => document.querySelector('[data-action="navigate"][data-page="backup"]'))) return { ok: false, reason: 'backup navigation was unavailable', hasPatient, ...snapshot() };
    document.querySelector('[data-action="navigate"][data-page="backup"]')?.click();
    const hasBackup = await waitFor(() => /Backup/i.test(document.body.textContent || ''));
    const backupText = document.body.textContent || '';
    return { ok: hasPatient && hasBackup, hasPatient, hasBackup, patientText: patientText.slice(0, 600), backupText: backupText.slice(0, 600), ...snapshot() };
  })();
}

app.whenReady().then(async () => {
  const storageDirectory = process.env.DENTIVA_USER_DATA ? path.resolve(process.env.DENTIVA_USER_DATA) : app.getPath('userData');
  durableStore = await createSQLiteStore(storageDirectory);

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isDesktop: true,
    packaged: app.isPackaged,
    storage: durableStore.info().storage
  }));
  ipcMain.handle('print:pdf', async (_event, options = {}) => {
    if (!mainWindow) throw new Error('Window unavailable');
    const pageSize = ['A4', 'Letter', 'Legal', 'A3', 'A5', 'Receipt'].includes(options.pageSize) ? options.pageSize : 'A4';
    const pdfOptions = { printBackground: true, landscape: Boolean(options.landscape), margins: { marginType: 'default' } };
    if (pageSize === 'Receipt') pdfOptions.pageSize = { width: 80000, height: 180000 };
    else pdfOptions.pageSize = pageSize;
    const data = await mainWindow.webContents.printToPDF(pdfOptions);
    return data.toString('base64');
  });
  ipcMain.handle('print:html-pdf', async (_event, payload = {}) => {
    const html = typeof payload.html === 'string' ? payload.html : '';
    if (!html || html.length > 30 * 1024 * 1024) throw new Error('PDF document is empty or too large.');
    if (/<\/?script\b|<iframe\b|<object\b|<embed\b|javascript:|src\s*=\s*['"]https?:/i.test(html)) throw new Error('PDF document contains a blocked active or remote resource.');
    const pageSize = ['A4', 'Letter', 'Legal', 'A3', 'A5', 'Receipt'].includes(payload.options?.pageSize) ? payload.options.pageSize : 'A4';
    const isolatedHtml = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:;"><style>html,body{background:#fff;color:#111}body{margin:24px;font-family:Arial,sans-serif}</style></head><body>${html}</body></html>`;
    const pdfWindow = new BrowserWindow({
      show: false,
      backgroundColor: '#ffffff',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, javascript: false }
    });
    try {
      await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(isolatedHtml)}`);
      const pdfOptions = { printBackground: true, landscape: Boolean(payload.options?.landscape), margins: { marginType: 'default' } };
      pdfOptions.pageSize = pageSize === 'Receipt' ? { width: 80000, height: 180000 } : pageSize;
      const data = await pdfWindow.webContents.printToPDF(pdfOptions);
      return data.toString('base64');
    } finally {
      if (!pdfWindow.isDestroyed()) pdfWindow.destroy();
    }
  });
  ipcMain.on('store:load', (event) => { event.returnValue = loadStore(); });
  ipcMain.on('store:save', (event, payload) => { event.returnValue = saveStore(payload); });
  ipcMain.on('store:reset', (event) => { event.returnValue = resetStore(); });
  ipcMain.on('store:info', (event) => { event.returnValue = durableStore.info(); });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = "default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://localhost:*; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none';";
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });

  createWindow();
  if (isSmoke) mainWindow.webContents.once('did-finish-load', runSmokePhase);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (!isSmoke && process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { try { durableStore?.close?.(); } catch { /* best effort */ } });
