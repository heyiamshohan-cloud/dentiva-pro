// Automatic backup executor for the Electron main process.
//
// The main process owns the only running copy; `runScheduledBackupTick` is
// exported separately (dependency-injected) so the whole behavior — due
// computation, single-flight guard, retention prune, error recording — is
// exercised headlessly in tests.

import { backupDue } from '../../src/backup-schedule.mjs';
import { createBackup, pruneBackups } from './backup.mjs';

export async function runScheduledBackupTick({ repo, ws, now = new Date(), createBackupFn = createBackup, pruneBackupsFn = pruneBackups, state = { running: false } }) {
  const settings = repo.getSettings ? repo.getSettings() : {};
  const decision = backupDue(settings, repo.getMeta('lastBackupAt', ''), now);
  if (!decision.due) return { ran: false, reason: decision.reason };
  if (state.running) return { ran: false, reason: 'already-running' };
  state.running = true;
  try {
    // Same-second folder names are timestamp-derived; retry with a suffix so
    // back-to-back runs (tests, double-clicks, clock quirks) never collide.
    let result = null;
    for (const attempt of ['automatic', 'automatic-b', 'automatic-c']) {
      result = createBackupFn(ws, { label: attempt, createdBy: 'scheduler' });
      if (!result || result.ok === false) {
        if (/already exists/i.test(result?.error || '')) continue;
        return { ran: false, reason: 'failed', error: (repo.setMeta('lastAutoBackupStatus', JSON.stringify({ at: now.toISOString(), ok: false, error: result?.error || 'Automatic backup failed.' })), result?.error || 'Automatic backup failed.') };
      }
      break;
    }
    if (!result || result.ok === false) {
      const message = result?.error || 'Automatic backup failed.';
      repo.setMeta('lastAutoBackupStatus', JSON.stringify({ at: now.toISOString(), ok: false, error: message }));
      return { ran: false, reason: 'failed', error: message };
    }
    const pruned = pruneBackupsFn(ws, decision.schedule.retention);
    const backupName = result.path ? String(result.path).split(/[\\/]/).pop() : (result.manifest?.name || result.name || '');
    repo.setMeta('lastAutoBackupStatus', JSON.stringify({
      at: now.toISOString(), ok: true,
      name: backupName,
      pruned: Number(pruned?.removed || 0),
      kept: decision.schedule.retention
    }));
    return { ran: true, name: backupName, pruned: Number(pruned?.removed || 0) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    repo.setMeta('lastAutoBackupStatus', JSON.stringify({ at: now.toISOString(), ok: false, error: message }));
    return { ran: false, reason: 'failed', error: message };
  } finally {
    state.running = false;
  }
}

/**
 * Wire the scheduler into app lifecycle. Checks every `tickMs`; the first check
 * runs after `initialDelayMs` so migration/first-run settle first. Returns a
 * stop function.
 */
export function startBackupScheduler({ repo, ws, tickMs = 5 * 60 * 1000, initialDelayMs = 45 * 1000, log = () => {} }) {
  const state = { running: false };
  let timer = null;
  const tick = () => {
    runScheduledBackupTick({ repo, ws, state }).then((result) => {
      if (result.ran) log(`[backup-scheduler] automatic backup created: ${result.name} (pruned ${result.pruned})`);
      else if (result.reason === 'failed') log(`[backup-scheduler] automatic backup failed: ${result.error}`);
    }).catch((error) => log(`[backup-scheduler] tick error: ${error?.message || error}`));
  };
  timer = setInterval(tick, tickMs);
  setTimeout(tick, initialDelayMs);
  return () => { clearInterval(timer); };
}
