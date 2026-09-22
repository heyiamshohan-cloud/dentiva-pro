const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

const isDev = !app.isPackaged;
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#f7f8f8',
    show: false,
    title: 'Dentiva Pro',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  const startUrl = isDev
    ? 'http://localhost:4173'
    : `file://${path.join(__dirname, '..', 'dist', 'index.html')}`;
  mainWindow.loadURL(startUrl);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, isDesktop: true }));
  ipcMain.handle('print:pdf', async (_event, options = {}) => {
    if (!mainWindow) throw new Error('Window unavailable');
    const data = await mainWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: options.pageSize || 'A4',
      landscape: Boolean(options.landscape),
      margins: { marginType: 'default' }
    });
    return data.toString('base64');
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
