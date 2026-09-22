// Server-side authentication and session authority (§36, §50).
//
// - PIN secrets (hash/salt) never leave the main process; the renderer only ever
//   sees sanitized user records (`hasPin` flag).
// - PBKDF2-SHA-256 with per-user random salt. v1.3.0 renderer-side hashes
//   (kdf 'PBKDF2-SHA-256-renderer', 120k iterations, hex salt) are verified with a
//   compatible derivation and transparently upgraded to the v1.4.0 parameters on
//   successful sign-in — no user is locked out by the upgrade.
// - Lockout after repeated failures is persisted in the users table, so reloading
//   the renderer cannot reset it (a v1.3.0 weakness).
// - Sessions live in main-process memory only; every operation carries the session
//   identity used for RBAC and audit attribution.

import crypto from 'node:crypto';
import { permissionsForRole } from '../../src/core.js';

export const KDF_ID = 'PBKDF2-SHA-256-v2';
const ITERATIONS_V2 = 210_000;
const LEGACY_ITERATIONS = 120_000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;

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
    const a = Buffer.from(toHex(derived));
    const b = Buffer.from(user.pinHash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'mismatch' };
    return { ok: true, upgradeNeeded: kdf !== KDF_ID };
  } catch {
    return { ok: false, reason: 'invalid-kdf-material' };
  }
}

export function validatePinFormat(pin) {
  return /^\d{4,12}$/.test(String(pin || ''));
}

/**
 * Session manager. One active session per renderer window (single-workstation app).
 * Inactivity timeout is enforced here — not by renderer timers alone.
 */
export class SessionManager {
  constructor({ repo, now = () => Date.now() }) {
    this.repo = repo;
    this.now = now;
    this.session = null;
  }

  timeoutMs() {
    const minutes = Number(this.repo.getSettings().sessionTimeoutMinutes ?? 30);
    return Math.max(1, minutes) * 60_000;
  }

  /** First-run mode: workspace has no PIN-protected accounts yet. */
  firstRun() {
    return !this.repo.anyPinSet();
  }

  current() {
    if (!this.session) return null;
    if (this.now() - this.session.lastActivity > this.timeoutMs()) {
      const expired = this.session;
      this.session = null;
      return { expired: true, userId: expired.userId, userName: expired.userName };
    }
    this.session.lastActivity = this.now();
    return this.session;
  }

  ping() {
    const session = this.current();
    return session && !session.expired ? { ok: true, userId: session.userId } : { ok: false };
  }

  login(userId, pin) {
    const user = this.repo.userGet(userId, { includeSecrets: true });
    if (!user) return { ok: false, error: 'That local account is unavailable.' };
    if (!user.active) return { ok: false, error: 'This account is deactivated. Contact an Administrator.' };
    if (!user.pinHash) return { ok: false, error: 'This account has no PIN set. Ask an Administrator to assign one.' };
    if (user.lockedUntil > this.now()) {
      const seconds = Math.ceil((user.lockedUntil - this.now()) / 1000);
      return { ok: false, error: `This account is temporarily locked. Try again in ${seconds} seconds.` };
    }
    if (!validatePinFormat(pin)) return { ok: false, error: 'Enter your 4–12 digit local PIN.' };
    const verification = verifyPin(pin, user);
    if (!verification.ok) {
      const attempts = Number(user.failedAttempts || 0) + 1;
      const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? this.now() + LOCKOUT_MS : 0;
      this.repo.setUserSecrets(userId, { failedAttempts: lockedUntil ? 0 : attempts, lockedUntil });
      return {
        ok: false,
        error: lockedUntil
          ? 'Too many failed attempts. This account is locked for 30 seconds.'
          : 'That PIN is not correct.',
        remaining: Math.max(0, MAX_FAILED_ATTEMPTS - attempts)
      };
    }
    const secrets = { failedAttempts: 0, lockedUntil: 0, lastLogin: new Date(this.now()).toISOString() };
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
      customPermissions: user.permissions || [],
      startedAt: this.now(),
      lastActivity: this.now(),
      upgradedKdf: Boolean(verification.upgradeNeeded)
    };
    return { ok: true, session: this.publicSession() };
  }

  logout(reason = 'user') {
    const had = this.session;
    this.session = null;
    return { ok: true, userId: had?.userId || null, reason };
  }

  publicSession() {
    if (!this.session) return null;
    return {
      userId: this.session.userId,
      userName: this.session.userName,
      role: this.session.role,
      permissions: this.session.permissions,
      startedAt: this.session.startedAt,
      timeoutMinutes: Math.round(this.timeoutMs() / 60000)
    };
  }

  /** Authorization context handed to the operation layer. */
  context() {
    if (this.session && !this.session.expired) {
      return { userId: this.session.userId, userName: this.session.userName, role: this.session.role, permissions: this.session.permissions, firstRun: false };
    }
    if (this.firstRun()) {
      return { userId: '', userName: 'Setup', role: 'Administrator', permissions: permissionsForRole('Administrator'), firstRun: true };
    }
    return null; // not authenticated
  }

  expireForTests() {
    if (this.session) this.session.lastActivity = this.now() - this.timeoutMs() - 1;
  }
}
