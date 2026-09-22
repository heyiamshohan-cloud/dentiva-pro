const { contextBridge, ipcRenderer } = require('electron');

// v1.4.0 preload: the renderer receives ONE method — an allowlisted invoke.
// No Node primitives, no arbitrary channels, no synchronous calls. The main
// process re-validates every channel and every call against the live session.

const ALLOWED_CHANNELS = [
  'auth:bootstrap', 'auth:login', 'auth:logout', 'auth:session',
  'ops:invoke', 'query:run',
  'attachment:read',
  'backup:create', 'backup:restore', 'backup:list', 'backup:delete', 'backup:validate', 'backup:prune', 'backup:restore-json', 'backup:pick-folder', 'backup:pick-file',
  'diagnostics:run', 'workspace:info', 'workspace:export',
  'app:info', 'print:pdf', 'print:html-pdf'
];

function invoke(channel, args) {
  if (!ALLOWED_CHANNELS.includes(channel)) {
    return Promise.reject(new Error('Blocked IPC channel'));
  }
  return ipcRenderer.invoke(channel, args && typeof args === 'object' ? args : {});
}

contextBridge.exposeInMainWorld('dentiva', {
  isDesktop: true,
  invoke
});
