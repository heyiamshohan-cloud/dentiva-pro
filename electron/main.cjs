const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const isDev = !app.isPackaged;
const MAX_STORE_BYTES = 200 * 1024 * 1024;
let mainWindow;
let storePath;
let storeBackupPath;

function initialiseStorePaths() {
  const directory = app.getPath('userData');
  fs.mkdirSync(directory, { recursive: true });
  storePath = path.join(directory, 'dentiva-pro-store.json');
  storeBackupPath = `${storePath}.bak`;
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const text = fs.readFileSync(filePath, 'utf8');
    if (!text.trim()) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    console.error('Dentiva Pro store read failed', error.message);
    return null;
  }
}

function loadStore() {
  return readJsonFile(storePath) || readJsonFile(storeBackupPath);
}

function saveStore(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, error: 'Store payload must be an object.' };
  const text = JSON.stringify(payload);
  if (Buffer.byteLength(text, 'utf8') > MAX_STORE_BYTES) return { ok: false, error: 'Local store exceeds the safe size limit. Export a backup and remove large attachments.' };
  const temporaryPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    const descriptor = fs.openSync(temporaryPath, 'w');
    try {
      fs.writeFileSync(descriptor, text, 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (fs.existsSync(storePath) && readJsonFile(storePath)) fs.copyFileSync(storePath, storeBackupPath);
    fs.rmSync(storePath, { force: true });
    fs.renameSync(temporaryPath, storePath);
    return { ok: true, bytes: Buffer.byteLength(text, 'utf8') };
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    console.error('Dentiva Pro store write failed', error.message);
    return { ok: false, error: 'The local store could not be written. Your last saved copy is preserved.' };
  }
}

function resetStore() {
  try {
    fs.rmSync(storePath, { force: true });
    fs.rmSync(storeBackupPath, { force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: 'The local store could not be reset.' };
  }
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

  const startUrl = isDev
    ? (process.env.DENTIVA_DEV_SERVER || 'http://localhost:4173')
    : pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).toString();
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

app.whenReady().then(() => {
  initialiseStorePaths();

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isDesktop: true,
    packaged: app.isPackaged
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
  ipcMain.on('store:info', (event) => {
    let bytes = 0;
    try { bytes = fs.statSync(storePath).size; } catch { /* empty store */ }
    event.returnValue = { path: storePath, bytes, backupPath: storeBackupPath };
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://localhost:*; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none';";
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
