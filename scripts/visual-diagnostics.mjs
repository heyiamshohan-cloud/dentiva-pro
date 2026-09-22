// Emits GitHub step annotations (::error / ::notice) for every failed visual
// test and its captured page diagnostics, so failures are diagnosable from
// `gh run view` even when the raw CI log / artifacts cannot be downloaded
// from the development sandbox. Run after `npm run test:visual`.
import fs from 'node:fs';

function log(line) { process.stdout.write(line + '\n'); }

let results = null;
try {
  results = JSON.parse(fs.readFileSync('test-results/results.json', 'utf8'));
} catch {
  log('::warning title=Dentiva visual diagnostics::no results.json found');
}

const flat = [];
function walk(suites) {
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        const fromErrors = (t.errors || []).map((e) => e?.message || '').join(' | ');
        const fromResults = (t.results || []).map((r) => r?.error?.message || '').join(' | ');
        flat.push({ file: (spec.file || '').split('\\').pop(), title: spec.title, status: t.status, error: fromErrors || fromResults || '' });
      }
    }
    if (suite.suites?.length) walk(suite.suites);
  }
}
walk(results?.suites);

const failed = flat.filter((t) => t.status && t.status !== 'passed' && t.status !== 'skipped');
const passed = flat.filter((t) => t.status === 'passed').length;
log(`::notice title=Dentiva visual summary::${passed} passed, ${failed.length} failed, ${flat.length - passed - failed.length} other (of ${flat.length} executed)`);

for (const t of failed.slice(0, 20)) {
  const err = (t.error || '').replace(/\s+/g, ' ').slice(0, 700);
  log(`::error title=Dentiva visual failure::[${t.file}] ${t.title} -> ${err || t.status}`);
}

let diagFiles = [];
try { diagFiles = fs.readdirSync('test-results').filter((f) => f.startsWith('diag-')); } catch {}
for (const f of diagFiles.slice(0, 20)) {
  try {
    const d = JSON.parse(fs.readFileSync(`test-results/${f}`, 'utf8'));
    const pageErrs = (d.pageErrors || []).slice(0, 3).join(' | ').slice(0, 800);
    const consoleErrs = (d.consoleErrors || []).slice(-6).join(' | ').slice(0, 600);
    const reqErrs = (d.requestFailures || []).slice(0, 4).join(' | ').slice(0, 400);
    const s = d.snapshot || {};
    const snap = `readyState=${s.readyState} title=${s.title} modal=${s.modalPresent} storeBytes=${s.storeBytes} keys=[${(s.storeKeys || []).join(',')}] appHtml=${(s.appHtml || '').replace(/\s+/g, ' ').slice(0, 400)}`;
    log(`::error title=Dentiva page state::${f} :: pageErrors=[${pageErrs || 'none'}] :: console=[${consoleErrs || 'none'}] :: requests=[${reqErrs || 'none'}] :: ${snap}`);
  } catch (error) {
    log(`::notice title=Dentiva visual diagnostics::could not parse ${f}: ${error.message}`);
  }
}
if (!failed.length && !diagFiles.length) {
  log('::notice title=Dentiva visual diagnostics::no failures and no diagnostic captures');
}
