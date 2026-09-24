import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflow = fs.readFileSync(path.join(root, '.github/workflows/windows-release.yml'), 'utf8');
const smoke = fs.readFileSync(path.join(root, 'scripts/windows-smoke.ps1'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');

test('release workflow blocks on the full installed-app packaging gate (v1.5.1 hotfix contract)', () => {
  // The release pipeline must inspect the real app.asar AND install the real
  // installer + launch the installed executable. The old '-PortableOnly'
  // invocation shipped v1.5.0 while the installed app crashed on startup, so
  // this contract forbids ever reverting to portable-only gating.
  assert.match(workflow, /Verify packaged ASAR contains the complete runtime module closure/);
  assert.match(workflow, /node scripts\/verify-packaged-runtime\.mjs/);
  assert.match(workflow, /Build portable and installer packages/);
  assert.match(workflow, /Verify Windows PE artifacts/);
  assert.match(workflow, /Run Windows portable AND installed app launch smoke/);
  assert.match(workflow, /Publish GitHub release assets/);
  // The smoke invocation must NOT pass -PortableOnly (portable-only gating masked v1.5.0).
  const smokeInvocation = workflow.split('\n').filter((line) => line.includes('windows-smoke.ps1') && !line.trim().startsWith('#'));
  assert.ok(smokeInvocation.length >= 1, 'workflow must invoke windows-smoke.ps1');
  for (const line of smokeInvocation) assert.ok(!line.includes('-PortableOnly'), `workflow smoke invocation must not pass -PortableOnly: ${line.trim()}`);
  // The smoke script itself must refuse startup module-load errors loudly and
  // must verify the INSTALLED app.asar module closure before launching it.
  assert.match(smoke, /ERR_MODULE_NOT_FOUND\|ERR_REQUIRE/);
  assert.match(smoke, /verify-packaged-runtime\.mjs/);
  assert.match(smoke, /Installed application is missing resources\/app\.asar/);
  // -PortableOnly stays available for local debugging, but must carry a loud warning.
  assert.match(smoke, /\*\*|-PortableOnly skips the installed-app gate|\$PortableOnly/);
  assert.match(smoke, /NOT sufficient for release verification/);
});

test('dateFormat setting is wired into the renderer date helper (no dead settings)', () => {
  // A settings control that claims UI behavior must change it. dateFormat was
  // a free-text dead control; it is now a select with two real formats mapped
  // into the single date() helper that renders every list/table date.
  assert.match(renderer, /selectField\('Date format', 'dateFormat', \[\['short', '23 Sep 2026'\], \['dmy', '23\/09\/2026'\]\]/);
  assert.match(renderer, /appState\.settings\.dateFormat === 'dmy'/);
  assert.match(renderer, /Intl\.DateTimeFormat\('en-GB'\)/);
  assert.doesNotMatch(renderer, /field\('Date format', 'dateFormat'/);
});

test('in-app APP_VERSION cannot drift from the package version', () => {
  const migrate = fs.readFileSync(path.join(root, 'src', 'migrate-state.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(migrate, new RegExp(`APP_VERSION = ['\"]${pkg.version}['\"]`),
    'src/migrate-state.js APP_VERSION must equal package.json version (in-app version + upgrade target drift otherwise)');
});

test('Bengali locale covers the release-critical document and workflow surfaces', () => {
  for (const label of [
    'Dashboard', 'Patients', 'Patient timeline', 'Appointments', 'Today’s Queue', 'Clinical records',
    'Dental chart', 'Treatment plan', 'Prescriptions', 'Billing', 'Payments', 'Inventory', 'Suppliers',
    'Staff', 'Accounting', 'Reports', 'Backup & restore', 'Settings', 'Security', 'Notifications',
    'Saved views', 'Save view', 'Patient views', 'Save this patient view', 'View name', 'No saved searches', 'Load', 'Done', 'Day', 'Week', 'Month', 'Agenda', 'Upcoming agenda', 'Saved medication', 'Choose a saved medicine...', 'Save current medicine to catalog',
    'Financial statement', 'Print statement', 'Export PDF', 'No matching records', 'No notifications',
    'Validate and restore selection', 'Create a secure user account', 'Effective permissions'
  ]) assert.match(renderer, new RegExp(`['\\"]${label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}['\\"]\\s*:`), `Bengali translation missing: ${label}`);
  assert.match(renderer, /function translateDom/);
  assert.match(renderer, /'bn-BD'/);
  assert.match(renderer, /new Intl\.NumberFormat\(appState\.settings\.language === 'Bengali' \? 'bn-BD' : 'en-BD'/);
});

test('release workflow retains the exact current-version artifact contract', () => {
  for (const name of [
    'Dentiva-Pro-$version-Windows-x64.exe',
    'Dentiva-Pro-$version-Windows-x64-Setup.exe',
    'Dentiva-Pro-$version-Windows-x64.zip',
    'Dentiva-Pro-$version-checksums.txt'
  ]) assert.match(workflow, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
