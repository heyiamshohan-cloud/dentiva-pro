import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('release identity and desktop target are configured', () => {
  assert.equal(pkg.name, 'dentiva-pro');
  assert.equal(pkg.version, '1.5.0');
  assert.equal(pkg.main, 'electron/main.mjs');
  assert.match(JSON.stringify(pkg.build), /Windows-x64/);
  assert.match(source, /Md\. Shohan Khan|helloiamshohan@gmail\.com/);
});

test('v1.4.0 architecture: async paginated renderer over a validated service layer', () => {
  assert.match(source, /createApi/);
  assert.match(source, /api\.runQuery/);
  assert.match(source, /api\.runOp/);
  assert.match(source, /listQuery\(/);
  assert.match(source, /tablePager\(/);
  const apiSource = fs.readFileSync(path.join(root, 'src/api.js'), 'utf8');
  assert.match(apiSource, /class DesktopApi/);
  assert.match(apiSource, /class LocalApi/);
  const opsSource = fs.readFileSync(path.join(root, 'src/ops.js'), 'utf8');
  const queriesSource = fs.readFileSync(path.join(root, 'src/queries.js'), 'utf8');
  assert.match(opsSource, /runOp/);
  assert.match(queriesSource, /runQuery/);
  // No synchronous whole-state IPC remains anywhere.
  const preload = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
  assert.doesNotMatch(preload, /sendSync/);
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  // Zero runtime dependencies — the engine is built-in.
  assert.deepEqual(pkg.dependencies, {});
});

test('relational storage with integer-cent money and no artificial caps', () => {
  const schema = fs.readFileSync(path.join(root, 'electron/lib/schema.mjs'), 'utf8');
  assert.match(schema, /INTEGER NOT NULL/);
  assert.match(schema, /amount_cents/);
  assert.match(schema, /total_cents/);
  assert.match(schema, /REFERENCES patients\(id\)/);
  const storage = fs.readFileSync(path.join(root, 'electron/lib/db.mjs'), 'utf8');
  assert.match(storage, /wal_checkpoint/);
  assert.doesNotMatch(storage, /MAX_STORE_BYTES|MAX_DB_BYTES|maxRecords|MAX_RECORDS/);
  assert.match(storage, /fsyncSync/);
  assert.match(storage, /renameSync/);
});

test('financial source-of-truth functions exist', () => {
  const core = fs.readFileSync(path.join(root, 'src/core.js'), 'utf8');
  assert.match(core, /export function calculateInvoice/);
  assert.match(core, /export function paymentStatusFor/);
  assert.match(core, /export function moneyToCents/);
  assert.match(core, /export function centsToMoney/);
  const domain = fs.readFileSync(path.join(root, 'src/domain.js'), 'utf8');
  assert.match(domain, /export function statementEntries/);
});

test('safety and offline guardrails exist', () => {
  assert.match(source, /No cloud required|offline-first/i);
  assert.match(source, /applicationLock|lock-workspace/);
  assert.match(source, /PBKDF2/);
  assert.match(source, /data-form="unlock"/);
  assert.match(source, /translateDom/);
  assert.match(source, /Intl\.DateTimeFormat\(locale, \{ day: 'numeric', month: 'short', year: 'numeric'/);
  assert.match(source, /Professional dental practice management for Bangladesh/);
  assert.match(source, /data-form="user-login"/);
  assert.match(source, /users\.manage/);
  assert.match(source, /function requirePermission/);
  assert.match(source, /failedAttempts/);
  assert.match(source, /lastLogin/);
  assert.match(source, /formPermissions/);
  assert.match(source, /requirePermission\('backup\.restore'\)/);
  assert.match(source, /printPatientStatement/);
  assert.match(source, /function parseCsv/);
  assert.match(source, /cycle-plan-stage/);
  assert.match(source, /convert-treatment-plan/);
  assert.match(source, /appointmentViewWeek/);
  assert.match(source, /saved-filter|save-filter/);
  assert.match(source, /move-dashboard-widget/);
  assert.match(source, /save-medication-template/);
  assert.match(source, /notification-open/);
  assert.match(source, /notificationRules/);
  assert.match(source, /documentFooter/);
  assert.match(source, /validateAttachmentFile/);
  assert.match(source, /Keep Existing/);
  assert.match(source, /Create New Copy/);
  assert.doesNotMatch(source, /sample patients|demo records|lorem ipsum/i);
});

test('Bengali locale covers release-critical surfaces and the date formatter is locale-aware', () => {
  for (const label of [
    'Dashboard', 'Patients', 'Appointments', "Today's Queue", 'Clinical Records',
    'Dental chart', 'Treatment plan', 'Prescriptions', 'Billing', 'Payments', 'Inventory', 'Suppliers',
    'Staff', 'Accounting', 'Reports', 'Backup & Restore', 'Settings', 'Security', 'Notifications',
    'Saved views', 'Save view', 'Patient views', 'Save this patient view', 'View name', 'No saved searches', 'Load', 'Done',
    'Day', 'Week', 'Month', 'Agenda', 'Upcoming agenda', 'Saved medication', 'Choose a saved medicine...',
    'Save current medicine to catalog', 'Financial statement', 'Print statement', 'Export PDF',
    'No matching records', 'No notifications', 'Validate and restore selection',
    'Create a secure user account', 'Effective permissions'
  ]) assert.match(source, new RegExp(`['\\"]${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\\"]\\s*:`), `Bengali translation missing: ${label}`);
  const coreCheck = source.includes("'bn-BD'");
  assert.ok(coreCheck, 'bn-BD locale must be referenced for Bengali formatting');
});

test('unsupported-schema protection and restore module groups', () => {
  assert.match(source, /unsupportedSchema/);
  assert.match(source, /cannot be overwritten/);
  assert.match(source, /export-unsupported-store/);
  assert.match(source, /modules\.push\('clinical'\)/);
  assert.match(source, /modules\.push\('finance'\)/);
  assert.match(source, /modules\.push\('operations'\)/);
  assert.match(source, /buildRestorePlan/);
  const main = fs.readFileSync(path.join(root, 'electron/main.mjs'), 'utf8');
  assert.match(main, /unsupportedSchema/, 'main must flag future layouts');
});

test('responsive styles and light-only design tokens', () => {
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /--teal-600/);
  assert.doesNotMatch(css, /prefers-color-scheme: dark/);
});

test('renderer has no cloud telemetry or diagnostic HTTP client', () => {
  assert.doesNotMatch(source, /fetch\s*\(|axios|firebase|sentry|posthog|segment|mixpanel/i);
  assert.doesNotMatch(source, /https:\/\/[^`'" ]+/i);
});
