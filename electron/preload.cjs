const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dentivaDesktop', {
  info: () => ipcRenderer.invoke('app:info'),
  printPdf: (options) => ipcRenderer.invoke('print:pdf', options)
});
