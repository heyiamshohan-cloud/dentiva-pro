/**
 * Automatic backup scheduling decision logic — pure and shared.
 * Electron main executes the decision; the renderer displays it.
 */

export function normalizeBackupSchedule(settings = {}) {
  return {
    enabled: settings.backupEnabled !== false,
    intervalHours: Math.min(720, Math.max(1, Math.round(Number(settings.backupIntervalHours) || 24))),
    retention: Math.min(365, Math.max(1, Math.round(Number(settings.backupRetention) || 10)))
  };
}

/**
 * Is an automatic backup due?
 * @returns {{ due: boolean, reason: string, overdueByHours: number }}
 */
export function backupDue(settings = {}, lastBackupAt = '', now = new Date()) {
  const schedule = normalizeBackupSchedule(settings);
  if (!schedule.enabled) return { due: false, reason: 'disabled', overdueByHours: 0, schedule };
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!lastBackupAt) return { due: true, reason: 'never-backed-up', overdueByHours: Infinity, schedule };
  const lastMs = new Date(lastBackupAt).getTime();
  if (!Number.isFinite(lastMs) || lastMs > nowMs) return { due: true, reason: 'invalid-timestamp', overdueByHours: Infinity, schedule };
  const ageHours = (nowMs - lastMs) / 3600000;
  const overdue = ageHours >= schedule.intervalHours;
  return { due: overdue, reason: overdue ? 'interval-elapsed' : 'fresh', overdueByHours: Math.max(0, ageHours - schedule.intervalHours), schedule };
}

/** Next automatic backup time (ISO string), or '' when scheduling is off. */
export function nextBackupAt(settings = {}, lastBackupAt = '', now = new Date()) {
  const schedule = normalizeBackupSchedule(settings);
  if (!schedule.enabled) return '';
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const base = lastBackupAt && Number.isFinite(new Date(lastBackupAt).getTime()) ? new Date(lastBackupAt).getTime() : nowMs;
  return new Date(base + schedule.intervalHours * 3600000).toISOString();
}
