/**
 * Dentiva Pro — workspace notification engine (shared, runtime-agnostic).
 *
 * deriveNotifications() reads live, already-indexed repo state and produces
 * the notification rows that SHOULD exist right now. reconcileNotifications()
 * then computes the minimal insert/update/delete plan so `notifications.scan`
 * converges the stored collection to that truth while preserving user state
 * (read/dismissed) per stable id. Everything here is a pure function of its
 * inputs, so the engine is fully unit-testable against LocalRepo.
 *
 * Design rules:
 *  - aggregate counts only for global signals (no patient PII in global rows);
 *  - stable ids (`auto_<kind>_<date>`) so re-scans never duplicate;
 *  - rows whose condition cleared are removed again — the centre always
 *    reflects the current truth, never stale alarms;
 *  - per-rule failures are isolated and reported, never fatal.
 */

export const NOTIFICATION_RULES = [
  { kind: 'appointments', label: 'Appointment reminders' },
  { kind: 'followups', label: 'Follow-up reminders' },
  { kind: 'payments', label: 'Pending payment alerts' },
  { kind: 'stock', label: 'Low-stock alerts' },
  { kind: 'expiry', label: 'Expiry alerts' },
  { kind: 'queue', label: 'Reception queue signals' },
  { kind: 'backup', label: 'Backup reminders' }
];

export const DEFAULT_NOTIFICATION_RULES = Object.fromEntries(NOTIFICATION_RULES.map((rule) => [rule.kind, true]));

/** Normalize any stored shape (legacy array, partial object, junk) to a kind map. */
export function normalizeNotificationRules(value) {
  const rules = { ...DEFAULT_NOTIFICATION_RULES };
  if (Array.isArray(value)) {
    // v1.3/v1.4 workspaces seeded legacy rule rows — translate their kinds.
    const legacy = { clinical: 'followups', inventory: 'stock', warning: 'payments', queue: 'queue', backup: 'backup', appointments: 'appointments', followups: 'followups', payments: 'payments', stock: 'stock', expiry: 'expiry' };
    for (const entry of value) {
      if (entry && typeof entry === 'object' && legacy[entry.kind]) rules[legacy[entry.kind]] = entry.enabled !== false;
    }
  } else if (value && typeof value === 'object') {
    for (const { kind } of NOTIFICATION_RULES) if (value[kind] !== undefined) rules[kind] = value[kind] !== false;
  }
  return rules;
}

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const moneyText = (cents) => `Tk ${(Math.round(Number(cents) || 0) / 100).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`;

const total = (result) => Number(result?.total || 0);

function notify(kind, type, priority, title, message, page, date, extra = {}) {
  return {
    id: `auto_${kind}_${isoDay(date)}`,
    kind, type, priority, title, message, page,
    date: isoDay(date), auto: true,
    read: false, dismissed: false,
    createdAt: date.toISOString(), updatedAt: date.toISOString(),
    ...extra
  };
}

/**
 * Compute the notification rows that should exist now.
 * Every read is an indexed count / bounded list — safe at 100k+ scale.
 * Returns { rows, errors } — one failure never blocks the other rules.
 */
export function deriveNotifications(repo, settings = {}, { now = new Date(), threshold = Number(settings.lowStockThreshold) || 5 } = {}) {
  const rules = normalizeNotificationRules(settings.notificationRules);
  const today = isoDay(now);
  const rows = [];
  const errors = [];
  const guarded = (kind, fn) => {
    if (rules[kind] === false) return;
    try { const produced = fn(); if (produced) rows.push(...(Array.isArray(produced) ? produced : [produced])); }
    catch (error) { errors.push({ kind, error: error instanceof Error ? error.message : String(error) }); }
  };

  guarded('appointments', () => {
    const scheduled = total(repo.listCollection('appointments', { page: 1, pageSize: 1, filters: { date: today, status: 'Scheduled' } }));
    const confirmed = total(repo.listCollection('appointments', { page: 1, pageSize: 1, filters: { date: today, status: 'Confirmed' } }));
    const count = scheduled + confirmed;
    if (!count) return null;
    return notify('appointments', 'bell', 'normal', `${count} appointment${count === 1 ? '' : 's'} scheduled today`,
      `${scheduled} scheduled and ${confirmed} confirmed for ${today}. Keep the chair moving — check patients in from Today’s Queue.`,
      'queue', now);
  });

  guarded('followups', () => {
    const due = total(repo.listCollection('followUpTasks', { page: 1, pageSize: 1, filters: { dueBefore: today, status: 'Open' } }));
    if (!due) return null;
    return notify('followups', 'warning', 'high', `${due} clinical follow-up${due === 1 ? '' : 's'} due`,
      `Follow-up tasks with a due date on or before ${today} need a call or a booked visit.`,
      'patients', now);
  });

  guarded('payments', () => {
    const stats = repo.reportStats('outstanding', '', '') || {};
    const open = Number(stats.openInvoices || 0);
    const dueCents = Number(stats.dueCents || 0);
    if (!open || !dueCents) return null;
    return notify('payments', 'warning', 'high', `${open} invoice${open === 1 ? '' : 's'} awaiting payment`,
      `Outstanding balance totals ${moneyText(dueCents)} across ${open} unpaid or partially paid invoice${open === 1 ? '' : 's'}.`,
      'billing', now);
  });

  guarded('stock', () => {
    const low = total(repo.listInventory({ page: 1, pageSize: 1, lowStock: true, lowStockThreshold: threshold }));
    if (!low) return null;
    return notify('stock', 'warning', 'high', `${low} item${low === 1 ? '' : 's'} at or below low-stock level`,
      `${low} inventory item${low === 1 ? '' : 's'} reached the threshold of ${threshold}. Reorder before treatment is blocked.`,
      'inventory', now);
  });

  guarded('expiry', () => {
    const windowEnd = isoDay(new Date(now.getTime() + 30 * 86400000));
    const expiring = total(repo.listInventory({ page: 1, pageSize: 1, expiringBefore: windowEnd }));
    if (!expiring) return null;
    return notify('expiry', 'warning', 'normal', `${expiring} item${expiring === 1 ? '' : 's'} expired or expiring within 30 days`,
      `Batch expiry dates fall on or before ${windowEnd}. Quarantine expired stock and plan replacements.`,
      'inventory', now);
  });

  guarded('queue', () => {
    const checkedIn = total(repo.listCollection('appointments', { page: 1, pageSize: 1, filters: { date: today, status: 'Checked In' } }));
    const waiting = total(repo.listCollection('appointments', { page: 1, pageSize: 1, filters: { date: today, status: 'Waiting' } }));
    const count = checkedIn + waiting;
    if (!count) return null;
    return notify('queue', 'bell', 'normal', `${count} patient${count === 1 ? '' : 's'} waiting in reception`,
      'Checked-in patients are waiting. Call the next patient from Today’s Queue.',
      'queue', now);
  });

  guarded('backup', () => {
    if (settings.backupEnabled === false) return null;
    const lastBackupAt = repo.getMeta('lastBackupAt', '');
    if (lastBackupAt) {
      const ageDays = Math.floor((now.getTime() - new Date(lastBackupAt).getTime()) / 86400000);
      if (Number.isFinite(ageDays) && ageDays < 7) return null;
      return notify('backup', 'backup', 'normal', 'Backup is overdue',
        `The latest backup is ${ageDays} day${ageDays === 1 ? '' : 's'} old. Create a fresh backup from Backup & Restore.`,
        'backup', now);
    }
    // Only nag once real data exists — a fresh empty workspace needs no backup.
    const patients = total(repo.listCollection('patients', { page: 1, pageSize: 1 }));
    if (!patients) return null;
    return notify('backup', 'backup', 'normal', 'No backup yet — protect this workspace',
      'Patient data exists but no backup has ever been created here. Create the first backup now.',
      'backup', now);
  });

  return { rows, errors };
}

/**
 * Minimal convergence plan for the notifications collection.
 * `drafts` = rows that should exist; `existing` = every stored row.
 * Manual rows (id not auto_*) are never touched.
 */
export function reconcileNotifications(drafts, existing, { now = new Date() } = {}) {
  const insert = [];
  const update = [];
  const remove = [];
  const draftById = new Map(drafts.map((row) => [row.id, row]));
  for (const row of existing || []) {
    if (!row || !String(row.id || '').startsWith('auto_')) continue;
    const draft = draftById.get(row.id);
    if (!draft) { remove.push(row.id); continue; }
    draftById.delete(row.id);
    const changed = draft.title !== row.title || draft.message !== row.message || draft.type !== row.type || draft.priority !== row.priority || draft.page !== row.page;
    if (changed) {
      update.push({ ...row, ...draft, id: row.id, read: Boolean(row.read), dismissed: Boolean(row.dismissed), createdAt: row.createdAt || draft.createdAt, updatedAt: now.toISOString() });
    }
  }
  for (const draft of draftById.values()) insert.push(draft);
  return { insert, update, remove };
}
