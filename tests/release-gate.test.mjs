import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflow = fs.readFileSync(path.join(root, '.github/workflows/windows-release.yml'), 'utf8');
const smoke = fs.readFileSync(path.join(root, 'scripts/windows-smoke.ps1'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');

test('release workflow blocks on portable persistence, not the deferred installed-app smoke', () => {
  assert.match(workflow, /Run Windows portable launch and restart persistence smoke/);
  assert.match(workflow, /-PortableOnly/);
  assert.doesNotMatch(workflow, /Run Windows install, launch, restart and uninstall smoke/);
  assert.match(workflow, /Build portable and installer packages/);
  assert.match(workflow, /Verify Windows PE artifacts/);
  assert.match(workflow, /Publish GitHub release assets/);
  assert.match(smoke, /\[switch\]\$PortableOnly/);
  assert.match(smoke, /Portable create\/restart persistence smoke passed/);
  assert.match(smoke, /Installed-app launch\/restart\/uninstall remains manual user verification/);
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
  assert.match(renderer, /Intl\.DateTimeFormat\(state\.settings\.language === 'Bengali' \? 'bn-BD'/);
});

test('release workflow retains the exact current-version artifact contract', () => {
  for (const name of [
    'Dentiva-Pro-$version-Windows-x64.exe',
    'Dentiva-Pro-$version-Windows-x64-Setup.exe',
    'Dentiva-Pro-$version-Windows-x64.zip',
    'Dentiva-Pro-$version-checksums.txt'
  ]) assert.match(workflow, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
