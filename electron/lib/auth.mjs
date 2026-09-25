// Dentiva Pro v2.0.0 — server-side authentication and session authority.
//
// - PIN secrets (hash/salt/kdf) never leave the main process; the renderer only
//   ever sees sanitized user records (`hasPin` flag).
// - PBKDF2-SHA-256 with a per-user random salt. v1.3.0 renderer-side hashes
//   (kdf 'PBKDF2-SHA-256-renderer', 120k iterations) are verified with a
//   compatible derivation and transparently upgraded on successful sign-in.
// - Lockout is persisted in the users table (a reload cannot reset it) and
//   escalates on repeated lockouts: 30 s → 1 min → 5 min → 15 min (cap).
// - Sessions live in main-process memory only. Every authorization decision is
//   re-derived from the CURRENT user row, so role/permission edits and
//   deactivation take effect immediately — never at the next sign-in.
// - Inactivity expiry is enforced here. Background polling (session checks,
//   notification scans) never counts as user activity.

import crypto from 'node:crypto';
import { permissionsForRole } from '../../src/core.js';

export const KDF_ID = 'PBKDF2-SHA-256-v2';
const ITERATIONS_V2 = 210_000;
const LEGACY_ITERATIONS = 120_000;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_STEPS_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000];

function toHex(buffer) { return Buffer.from(buffer).toString('hex'); }

export function hashPin(pin, saltHex = '') {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const derived = crypto.pbkdf2Sync(String(pin), Buffer.from(salt, 'hex'), ITERATIONS_V2, 32, 'sha256');
  return { salt, hash: toHex(derived), kdf: KDF_ID, iterations: ITERATIONS_V2 };
}

export function verifyPin(pin, user) {
  if (!user?.pinHash || !user?.pinSalt) return { ok: false, reason: 'no-pin' };
  const kdf = user.kdf || 'PBKDF2-SHA-256-renderer';
  const iterations = kdf === KDF_ID ? ITERATIONS_V2 : LEGACY_ITERATIONS;
  try {
    const derived = crypto.pbkdf2Sync(String(pin), Buffer.from(user.pinSalt, 'hex'), iterations, 32, 'sha256');
    const stored = Buffer.from(user.pinHash, 'hex');
    if (derived.length !== stored.length || !crypto.timingSafeEqual(derived, stored)) return { ok: false, reason: 'mismatch' };
    return { ok: true, upgradeNeeded: kdf !== KDF_ID };
  } catch {
    return { ok: false, reason: 'invalid-kdf-material' };
  }
}

export function validatePinFormat(pin) {
  return /^\d{4,12}$/.test(String(pin || ''));
}

export function lockoutDurationMs(level) {
  const index = Math.max(0, Math.min(LOCKOUT_STEPS_MS.length - 1, Number(level) || 0));
  return LOCKOUT_STEPS_MS[index];
}

function formatWait(ms) {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 90) return `${seconds} seconds`;
  return `${Math.ceil(seconds / 60)} minutes`;
}

/**
 * Session manager. One active session per workstation window.
 * `context()` is the single authorization source for ops/queries.
 */
export class SessionManager {
  constructor({ repo, now = () => Date.now() }) {
    this.repo = repo;
    this.now = now;
    this.session = null;
    this.lastEnded = null; // { userId, userName, reason } of the most recently ended session
  }

  /** Server-side inactivity timeout in ms; 0 = disabled by the clinic. */
  timeoutMs() {
    const raw = Number(this.repo.getSettings().sessionTimeoutMinutes ?? 30);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Math.min(480, Math.round(raw)) * 60_000;
  }

  /** First-run mode: the workspace has no active PIN-protected account yet. */
  firstRun() {
    return !this.repo.anyPinSet();
  }

  #end(reason) {
    if (this.session) this.lastEnded = { userId: this.session.userId, userName: this.session.userName, reason };
    this.session = null;
  }

  /**
   * Resolve the live session. Expires idle sessions, re-reads the user row
   * (deactivated/deleted users are signed out; role edits apply at once) and
   * refreshes activity only when `touch` is true.
   */
  #live({ touch = true } = {}) {
    if (!this.session) return null;
    const timeout = this.timeoutMs();
    if (timeout && this.now() - this.session.lastActivity > timeout) {
      this.#end('expired');
      return null;
    }
    const user = this.repo.userGet(this.session.userId);
    if (!user || user.active === false || !user.hasPin) {
      this.#end(user ? 'account-disabled' : 'account-removed');
      return null;
    }
    this.session.userName = user.name;
    this.session.role = user.role;
    this.session.permissions = permissionsForRole(user.role, user.permissions);
    if (touch) this.session.lastActivity = this.now();
    return this.session;
  }

  login(userId, pin) {
    const user = this.repo.userGet(userId, { includeSecrets: true });
    if (!user) return { ok: false, error: 'That local account is unavailable.' };
    if (!user.active) return { ok: false, error: 'This account is deactivated. Contact an Administrator.' };
    if (!user.pinHash) return { ok: false, error: 'This account has no PIN set. Ask an Administrator to assign one.' };
    if (user.lockedUntil > this.now()) {
      return { ok: false, lockedOut: true, error: `This account is temporarily locked. Try again in ${formatWait(user.lockedUntil - this.now())}.` };
    }
    if (!validatePinFormat(pin)) return { ok: false, error: 'Enter your 4–12 digit local PIN.' };
    const verification = verifyPin(pin, user);
    if (!verification.ok) {
      const attempts = Number(user.failedAttempts || 0) + 1;
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        const level = Number(user.lockoutCount || 0);
        const duration = lockoutDurationMs(level);
        this.repo.setUserSecrets(userId, { failedAttempts: 0, lockedUntil: this.now() + duration, lockoutCount: level + 1 });
        return { ok: false, lockedOut: true, remaining: 0, error: `Too many failed attempts. This account is locked for ${formatWait(duration)}.` };
      }
      this.repo.setUserSecrets(userId, { failedAttempts: attempts, lockedUntil: 0 });
      return { ok: false, lockedOut: false, error: 'That PIN is not correct.', remaining: Math.max(0, MAX_FAILED_ATTEMPTS - attempts) };
    }
    const secrets = { failedAttempts: 0, lockedUntil: 0, lockoutCount: 0, lastLogin: new Date(this.now()).toISOString() };
    if (verification.upgradeNeeded) {
      const upgraded = hashPin(pin, user.pinSalt);
      secrets.pinHash = upgraded.hash;
      secrets.pinSalt = upgraded.salt;
      secrets.kdf = KDF_ID;
    }
    this.repo.setUserSecrets(userId, secrets);
    this.session = {
      userId: user.id,
      userName: user.name,
      role: user.role,
      permissions: permissionsForRole(user.role, user.permissions),
      startedAt: this.now(),
      lastActivity: this.now(),
      upgradedKdf: Boolean(verification.upgradeNeeded)
    };
    this.lastEnded = null;
    return { ok: true, session: this.publicSession({ touch: false }) };
  }

  logout(reason = 'user') {
    const had = this.session;
    this.#end(reason);
    return { ok: true, userId: had?.userId || null, reason };
  }

  /** Renderer-safe session summary. Polling it never extends the session. */
  publicSession({ touch = false } = {}) {
    const session = this.#live({ touch });
    if (!session) return null;
    return {
      userId: session.userId,
      userName: session.userName,
      role: session.role,
      permissions: session.permissions,
      startedAt: session.startedAt,
      timeoutMinutes: Math.round(this.timeoutMs() / 60000)
    };
  }

  /**
   * Authorization context handed to the operation/query layer, or null when
   * the caller is not authenticated. First-run (no PIN account exists yet)
   * yields the setup context so the first Administrator can be created.
   */
  context({ touch = true } = {}) {
    const session = this.#live({ touch });
    if (session) {
      return { userId: session.userId, userName: session.userName, role: session.role, permissions: session.permissions, firstRun: false };
    }
    if (this.firstRun()) {
      return { userId: '', userName: 'Setup', role: 'Administrator', permissions: permissionsForRole('Administrator'), firstRun: true };
    }
    return null;
  }

  expireForTests() {
    if (this.session) this.session.lastActivity = this.now() - (this.timeoutMs() || 60_000) - 1;
  }
}
