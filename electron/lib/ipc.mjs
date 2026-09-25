// Dentiva Pro v2.0.0 — Electron IPC registration.
//
// All request handling lives in ipc-handlers.mjs (Electron-free, shared with
// the dev/test server). This module only:
//   - binds each allowlisted channel to ipcMain,
//   - rejects requests that do not come from the application's own top-level
//     document in the main window (defence in depth behind the navigation lock),
//   - converts unexpected exceptions into safe error values.

import { ipcMain, BrowserWindow, dialog } from 'electron';
import { createIpcHandlers, HANDLER_CHANNELS, friendlyStorageError } from './ipc-handlers.mjs';

export const ELECTRON_ONLY_CHANNELS = ['app:info', 'print:html'];
export const ALL_CHANNELS = [...HANDLER_CHANNELS, ...ELECTRON_ONLY_CHANNELS];

export function registerIpc({ repo, ws, sessions, isTrustedSender, extraHandlers = {}, log = () => {} }) {
  const handlers = {
    ...createIpcHandlers({
      repo, ws, sessions, log,
      dialogs: {
        showOpenDialog: (event, options) => dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), options)
      }
    }),
    ...extraHandlers
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    if (!ALL_CHANNELS.includes(channel)) throw new Error(`IPC channel not allowlisted: ${channel}`);
    ipcMain.handle(channel, async (event, args) => {
      if (typeof isTrustedSender === 'function' && !isTrustedSender(event)) {
        log(`rejected ${channel} from untrusted sender ${event?.senderFrame?.url || 'unknown'}`);
        return { ok: false, code: 'untrusted-sender', error: 'Request rejected.' };
      }
      try {
        return await handler(event, args && typeof args === 'object' ? args : {});
      } catch (error) {
        log(`${channel} failed: ${error?.stack || error?.message || error}`);
        return { ok: false, code: 'internal-error', error: friendlyStorageError(error) };
      }
    });
  }
  return handlers;
}
