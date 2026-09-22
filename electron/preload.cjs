const { contextBridge, ipcRenderer } = require('electron');

// Keep the renderer API intentionally small. No Node primitives or arbitrary IPC channels
// are exposed to the application UI.
contextBridge.exposeInMainWorld('dentivaDesktop', {
  info: () => ipcRenderer.invoke('app:info'),
  printPdf: (options) => ipcRenderer.invoke('print:pdf', options),
  printHtmlPdf: (html, options) => ipcRenderer.invoke('print:html-pdf', { html, options }),
  storeLoad: () => ipcRenderer.sendSync('store:load'),
  storeSave: (payload) => ipcRenderer.sendSync('store:save', payload),
  storeReset: () => ipcRenderer.sendSync('store:reset'),
  storeInfo: () => ipcRenderer.sendSync('store:info')
});
