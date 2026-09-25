// Dentiva Pro — packaged-app smoke harness (loaded ONLY when DENTIVA_SMOKE=1).
//
// Each phase function is serialized with Function#toString() and executed in
// the real renderer through webContents.executeJavaScript, driving the actual
// UI (setup, sign-in, patient/appointment creation, documents, persistence).
// It never runs in normal use and adds no production code paths.

// These smoke scripts run only when DENTIVA_SMOKE=1. They exercise the real
// renderer through Electron's webContents — setup, sign-in, patient +
// appointment creation, and create/restart persistence of the same data.
export function smokeCreate() {
  const wait = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeout = 12000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (predicate()) return true;
      await wait(100);
    }
    throw new Error('Timed out waiting for the renderer smoke state.');
  };
  const field = (name, value) => {
    const element = document.querySelector(`[name="${name}"]`);
    if (!element) throw new Error(`missing field ${name}`);
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const submit = async (form = 'form[data-form]') => {
    const element = document.querySelector(form);
    if (!element) throw new Error(`missing form ${form}`);
    element.querySelector('button[type="submit"]')?.click();
    await wait();
  };
  const click = async (selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`missing action ${selector}`);
    element.click();
    await wait();
  };
  return (async () => {
    await wait(600);
    if (document.querySelector('form[data-form="setup"]')) {
      field('clinicName', 'Windows Smoke Dental');
      field('dentistName', 'Dr. Smoke Test');
      field('phone', '01700000000');
      field('address', '1 Test Road, Dhaka');
      await submit('form[data-form="setup"]');
      field('currency', 'BDT');
      field('language', 'English');
      field('adminPin', '2468');
      field('adminPinConfirm', '2468');
      await submit('form[data-form="setup"]');
      await click('[data-action="finish-setup"]');
    }
    if (document.querySelector('form[data-form="user-login"]')) {
      field('pin', '2468');
      await submit('form[data-form="user-login"]');
      await waitFor(() => !document.querySelector('form[data-form="user-login"]'));
    }
    await waitFor(() => document.querySelector('[data-action="open-patient"]'));
    await click('[data-action="open-patient"]');
    field('fullName', 'Windows Smoke Patient');
    field('phone', '01800000000');
    await submit('form[data-form="patient"]');
    await waitFor(() => !document.querySelector('form[data-form="patient"]'));
    await click('[data-action="navigate"][data-page="patients"]');
    await waitFor(() => document.body.textContent.includes('Windows Smoke Patient'));
    const patient = document.body.textContent.includes('Windows Smoke Patient');
    if (!patient) throw new Error('created patient was not rendered');
    await click('[data-action="navigate"][data-page="appointments"]');
    await waitFor(() => document.querySelector('[data-action="open-appointment"]'));
    await click('[data-action="open-appointment"]');
    field('patientId', [...document.querySelectorAll('form[data-form="appointment"] select[name="patientId"] option')].find((option) => option.textContent.includes('Windows Smoke Patient'))?.value || '');
    field('date', new Date().toISOString().slice(0, 10));
    field('time', '10:00');
    field('reason', 'Smoke appointment');
    await submit('form[data-form="appointment"]');
    await waitFor(() => !document.querySelector('form[data-form="appointment"]'));
    await click('[data-action="navigate"][data-page="backup"]');
    await waitFor(() => document.body.textContent.includes('Backup') || document.body.textContent.includes('backup'));
    const backupPage = document.body.textContent.includes('Backup') || document.body.textContent.includes('backup');
    if (!backupPage) throw new Error('backup page did not render');
    return { ok: true, patient, backupPage };
  })();
}


// smokeDocs (phase=docs): real Windows-build verification of the four production
// document workflows — prescription, invoice, receipt, statement — through the
// REAL renderer UI paths (modals, preview modal, print:html) on THIS build.
// The PDF save uses the smoke-only deterministic temp path; print goes through
// the identical engine markup (native print dialogs cannot be automated).
export function smokeDocs() {
  const wait = (ms = 320) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeout = 15000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) { if (predicate()) return true; await wait(120); }
    return false;
  };
  const mark = (m, e = '') => console.log(`SMOKE_MARK ${m} ${e}`.trim());
  const invoke = (channel, payload) => globalThis.dentiva.invoke(channel, payload);
  const op = (name, payload) => invoke('ops:invoke', { name, payload: { ...payload, confirmConflict: true } });
  const query = (name, params = {}) => invoke('query:run', { name, params });
  const setField = (form, name, value) => {
    const el = form.querySelector(`[name="${name}"]`);
    if (!el) throw new Error(`docs-flow missing field ${name}`);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const clickEl = async (el, label) => { if (!el) throw new Error(`docs-flow missing ${label}`); el.click(); await wait(); };
  const previewHtml = () => document.querySelector('.print-preview-frame')?.getAttribute('srcdoc') || '';
  const pdfFor = async (title, pageSize) => {
    const html = previewHtml();
    if (!html) throw new Error(`preview markup missing for ${title}`);
    const result = await invoke('print:html', { html, options: { mode: 'pdf', pageSize, title } });
    if (!(result && result.ok && result.saved && result.bytes > 1500)) throw new Error(`pdf save failed for ${title}: ${JSON.stringify(result && result.ok === false ? result : { ok: result && result.ok, bytes: result && result.bytes })}`);
    return result;
  };
  const closePreview = async () => {
    for (let i = 0; i < 3; i += 1) {
      document.querySelector('[data-action="close-modal"]')?.click();
      await wait(220);
      if (!document.querySelector('.modal-overlay, .modal-backdrop, [data-action="close-modal"]')) return;
    }
  };
  const signInIfNeeded = async () => {
    const form = document.querySelector('form[data-form="user-login"]');
    if (!form) return true;
    form.querySelector('[name="pin"]').value = '2468';
    form.querySelector('[name="pin"]').dispatchEvent(new Event('input', { bubbles: true }));
    form.querySelector('button[type="submit"]')?.click();
    return waitFor(() => !document.querySelector('form[data-form="user-login"]'));
  };
  return (async () => {
    mark('docs-start');
    await wait(500);
    await signInIfNeeded();
    if (!(await waitFor(() => document.querySelector('[data-action="navigate"][data-page="patients"]')))) throw new Error('docs-flow: app shell did not render');

    // Patient created through the REAL Add-patient UI (also refreshes the
    // renderer directory cache — a raw-ops seed would leave the Rx modal's
    // patient select unable to bind; CI smoke error "prescription missing
    // 'DP-…'" surfaced exactly that).
    const longName = 'ডেন্টিভা স্মোক রোগী আব্দুল্লাহ আল মামুন পাটোয়ারী স্পেশাল ডকুমেন্ট টেস্ট';
    document.querySelector('[data-action="navigate"][data-page="patients"]')?.click();
    if (!(await waitFor(() => document.querySelector('[data-action="open-patient"]')))) throw new Error('docs-flow: patients page did not render');
    await clickEl(document.querySelector('[data-action="open-patient"]'), 'open-patient');
    if (!(await waitFor(() => document.querySelector('form[data-form="patient"]')))) throw new Error('docs-flow: patient form did not open');
    const pForm = document.querySelector('form[data-form="patient"]');
    setField(pForm, 'fullName', longName);
    setField(pForm, 'phone', '01900000000');
    setField(pForm, 'address', '৫/ক টেস্ট রোড, ধানমন্ডি, ঢাকা — a very long address line to stress the document header wrapping across lines');
    await clickEl(pForm.querySelector('button[type="submit"]'), 'patient-submit');
    if (!(await waitFor(() => document.querySelector('.patient-sub'), 15000))) throw new Error('docs-flow: patient 360 did not open after create');
    const codeMatch = (document.querySelector('.patient-sub')?.textContent || '').match(/DP-\d+/);
    if (!codeMatch) throw new Error('docs-flow: patient code not visible on profile');
    const found = await query('list', { collection: 'patients', page: 1, pageSize: 5 });
    const patient = (found.rows || []).find((r) => r.fullName === longName);
    if (!patient || patient.patientCode !== codeMatch[0]) throw new Error('docs-flow: created patient lookup mismatch');
    mark('docs-patient', patient.patientCode);
    const visit = await op('visit.create', { patientId: patient.id, date: '2026-09-24', reason: 'Doc flow', chiefComplaint: 'Pain On', diagnosis: 'Pulpitis 46' });
    if (!visit?.ok) throw new Error('docs-flow visit.create failed');
    const invoiceItems = Array.from({ length: 18 }, (_, i) => ({ name: `${i % 2 ? 'কনসালট' : 'RCT'} item ${i + 1}`, quantity: 1 + (i % 3), unitPrice: 500 + i * 25 }));
    const invoice = await op('invoice.create', { patientId: patient.id, date: '2026-09-24', items: invoiceItems, discount: 100, notes: 'Doc-flow invoice — বাংলা নোট' });
    if (!invoice?.ok) throw new Error(`docs-flow invoice.create: ${invoice?.error}`);
    // Anchor the invoice by its CREATE response id directly — re-querying the
    // list here is fragile (sort/filter drift) and cost us "receipt missing
    // 'Remaining due'".
    const invId = invoice.record.id;
    if (!invId) throw new Error('docs-flow invoice.create returned no record id');
    const payment = await op('payment.record', { patientId: patient.id, invoiceId: invId, date: '2026-09-24', amount: 1200, method: 'bKash', reference: 'TX9AB12XYZ34' });
    if (!payment?.ok) throw new Error(`docs-flow payment.record: ${payment?.error}`);
    if (String(payment.record?.invoiceId || '') !== String(invId)) throw new Error('SMOKE-PROBE paymentLink ' + JSON.stringify({ invId, stored: payment.record?.invoiceId }));

    // ── 1. PRESCRIPTION through the real modal + chips + preview ──────────
    document.querySelector('[data-action="navigate"][data-page="prescriptions"]')?.click();
    if (!(await waitFor(() => document.querySelector('[data-action="open-prescription"]')))) throw new Error('prescriptions page did not render');
    await clickEl(document.querySelector('[data-action="open-prescription"]'), 'open-prescription');
    const rxForm = document.querySelector('form[data-form="prescription"]');
    if (!rxForm) throw new Error('prescription builder did not open');
    setField(rxForm, 'patientId', patient.id);
    setField(rxForm, 'requiredExamination', 'IOPA X-ray 46');
    setField(rxForm, 'diagnosis', 'Irreversible pulpitis 46 — ডায়াগনোসিস');
    setField(rxForm, 'advice', 'Warm saline rinse তিন বার দৈনিক. Follow instructions carefully.');
    rxForm.querySelector('[data-action="rx-opt-toggle"][data-opt="Pain On"]')?.click();
    rxForm.querySelector('[data-action="rx-opt-toggle"][data-opt="G. Carries"]')?.click();
    rxForm.querySelector('[data-action="rx-opt-toggle"][data-opt="Perio Dontitis"]')?.click();
    setField(rxForm, 'medications[0][medicine]', 'Amoxicillin ট্যাবলেট Very-Long-Brand-Name');
    setField(rxForm, 'medications[0][form]', 'Tablet');
    setField(rxForm, 'medications[0][strength]', '500mg');
    setField(rxForm, 'medications[0][dosage]', '1');
    setField(rxForm, 'medications[0][frequency]', '1-1-1');
    setField(rxForm, 'medications[0][durationValue]', '5');
    setField(rxForm, 'medications[0][durationUnit]', 'days');
    setField(rxForm, 'medications[0][foodRelation]', 'After food');
    setField(rxForm, 'medications[0][quantity]', '15');
    setField(rxForm, 'medications[0][instructions]', 'প্রতিদিন খাবারের পরে — with plenty of water');
    document.querySelector('[data-action="rx-row-add"]')?.click();
    await wait(150);
    setField(rxForm, 'medications[1][medicine]', 'Mefenamic Acid ক্যাপসুল');
    setField(rxForm, 'medications[1][frequency]', 'SOS');
    setField(rxForm, 'medications[1][foodRelation]', 'With food');
    mark('docs-rx-filled');
    await clickEl(document.querySelector('[data-action="rx-preview"]'), 'rx-preview');
    if (!(await waitFor(() => previewHtml().length > 500))) throw new Error('prescription preview did not render');
    const rxHtml = previewHtml();
    const rxNeeds = ['C/C', 'O/E', 'R/E', 'Advice', 'Pain On', 'G. Carries', 'Perio Dontitis', 'Windows Smoke Dental', 'Dr. Smoke Test', patient.patientCode, 'Long-Brand-Name', 'ট্যাবলেট', 'ক্যাপসুল', 'প্রতিদিন'];
    for (const token of rxNeeds) if (!rxHtml.includes(token)) throw new Error(`prescription missing '${token}'`);
    const rxContent = rxHtml.slice(rxHtml.indexOf('</style>'));
    for (const bad of ['৳', 'Paid', 'Due', 'Total', 'Tax', 'Discount', 'Payment method', 'Grand total', 'Unit price', 'doc-totals']) {
      if (rxContent.includes(bad)) throw new Error(`prescription leaked financial token '${bad}'`);
    }
    mark('docs-rx-content-ok');
    await pdfFor('docs-rx-A4', 'A4');
    mark('docs-rx-pdf-a4');
    await pdfFor('docs-rx-A5', 'A5');
    mark('docs-rx-pdf-a5');
    await closePreview();

    // ── 2. INVOICE preview + PDF (18 rows, Bengali, discount) ─────────────
    const invRec = await query('record', { collection: 'invoices', id: invId });
    const inv = invRec.record;
    if (!inv) throw new Error('invoice not found for preview');
    document.querySelector('[data-action="navigate"][data-page="billing"]')?.click();
    if (!(await waitFor(() => document.querySelector(`[data-action="print-invoice"][data-id="${invId}"]`)))) throw new Error('billing list row for invoice missing');
    await clickEl(document.querySelector(`[data-action="print-invoice"][data-id="${invId}"]`), 'print-invoice');
    if (!(await waitFor(() => previewHtml().length > 500))) throw new Error('invoice preview did not render');
    const invHtml = previewHtml();
    for (const token of [inv.invoiceNumber, patient.patientCode, 'কনসালট', 'Subtotal', 'Discount', 'Total']) {
      if (!invHtml.includes(token)) throw new Error(`invoice missing '${token}'`);
    }
    mark('docs-invoice-content-ok');
    await pdfFor('docs-invoice-A4', 'A4');
    await pdfFor('docs-invoice-Letter', 'Letter');
    mark('docs-invoice-pdf-ok');
    await closePreview();

    // ── 3. RECEIPT preview + PDF (80mm) ────────────────────────────────────
    document.querySelector('[data-action="navigate"][data-page="payments"]')?.click();
    const receiptRowSel = `[data-action="print-payment"][data-id="${payment.record.id}"]`;
    if (!(await waitFor(() => document.querySelector(receiptRowSel)))) throw new Error('payments list row missing');
    await clickEl(document.querySelector(receiptRowSel), 'print-payment');
    if (!(await waitFor(() => previewHtml().length > 400))) throw new Error('receipt preview did not render');
    const rcHtml = previewHtml();
    for (const token of [payment.record.receiptNumber, patient.patientCode, 'bKash', 'TX9AB12XYZ34']) {
      if (!rcHtml.includes(token)) throw new Error(`receipt missing '${token}'`);
    }
    // 'Remaining due' is localized at print-time (clinic language); accept Bangla too
    if (!(rcHtml.includes('Remaining due') || rcHtml.includes('বাকি টাকা'))) throw new Error(`receipt missing remaining-due row (en/bn)`);
    mark('docs-receipt-content-ok');
    await pdfFor('docs-receipt-80mm', 'Receipt80');
    await pdfFor('docs-receipt-A5', 'A5');
    mark('docs-receipt-pdf-ok');
    await closePreview();

    // ── 4. STATEMENT via patient 360 + PDF ─────────────────────────────────
    document.querySelector('[data-action="navigate"][data-page="patients"]')?.click();
    if (!(await waitFor(() => document.body.textContent.includes(patient.patientCode)))) throw new Error('patient list does not show the new patient code');
    const rowBtn = [...document.querySelectorAll('[data-action="open-patient-profile"]')].find((b) => b.closest('tr')?.textContent.includes(patient.patientCode));
    await clickEl(rowBtn || document.querySelector(`[data-action="open-patient-profile"][data-id="${patient.id}"]`), 'open-patient-profile');
    if (!(await waitFor(() => document.querySelector('[data-tab="statement"], [data-action="patient-tab"][data-tab="statement"]'), 8000))) throw new Error('patient 360 tabs missing');
    (document.querySelector('[data-action="patient-tab"][data-tab="statement"]') || document.querySelector('[data-tab="statement"]'))?.click();
    if (!(await waitFor(() => document.body.textContent.includes('Opening balance') || document.body.textContent.includes('Statement'), 8000))) throw new Error('statement tab did not render');
    const stmtBtn = document.querySelector('[data-action="print-patient-statement"]');
    await clickEl(stmtBtn, 'print-patient-statement');
    if (!(await waitFor(() => previewHtml().length > 400))) throw new Error('statement preview did not render');
    const stHtml = previewHtml();
    for (const token of [patient.patientCode, longName, 'balance', 'bKash']) {
      if (!stHtml.toLowerCase().includes(token.toLowerCase())) throw new Error(`statement missing '${token}'`);
    }
    mark('docs-statement-content-ok');
    await pdfFor('docs-statement-A4', 'A4');
    mark('docs-statement-pdf-ok');
    await closePreview();

    return { ok: true, patientCode: patient.patientCode, pdfs: 7 };
  })();
}

export function smokeVerify() {
  const wait = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeout = 12000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (predicate()) return true;
      await wait(100);
    }
    return false;
  };
  const snapshot = async () => {
    let patients = [];
    let storageInfo = null;
    try {
      const list = await globalThis.dentiva?.invoke('query:run', { name: 'list', params: { collection: 'patients', page: 1, pageSize: 5 } });
      patients = (list?.rows || []).map((patient) => patient.fullName).slice(0, 4);
    } catch { /* snapshot best effort */ }
    try {
      const info = await globalThis.dentiva?.invoke('workspace:info');
      storageInfo = info?.storage ? { bytes: info.storage.bytes, recordCounts: info.storage.recordCounts } : null;
    } catch { /* snapshot best effort */ }
    // Decisive boot-failure probe: report the bundle script tag, then try to
    // fetch it exactly as the module loader would — separates "never fetched"
    // from "fetched but never evaluated".
    const scriptSrc = document.querySelector('script[type="module"]')?.src || '';
    let bundleProbe = null;
    if (scriptSrc) {
      try {
        const response = await fetch(scriptSrc);
        bundleProbe = `${response.status}:${(await response.text()).length}`;
      } catch (probeError) {
        bundleProbe = `ERR:${String(probeError?.message || probeError).slice(0, 140)}`;
      }
    }
    return {
      body: (document.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
      forms: [...document.querySelectorAll('form[data-form]')].map((form) => form.dataset.form),
      storedPatients: patients,
      storageInfo,
      location: window.location.href,
      readyState: document.readyState,
      bootStatus: window.__bootStatus || null,
      bootError: window.__bootError || null,
      bundleResources: performance.getEntriesByType('resource')
        .filter((entry) => /\/assets\/.+\.(js|css)(\?|$)/.test(entry.name))
        .map((entry) => `${entry.name.split('/').pop()}:${entry.responseEnd.toFixed(0)}`)
        .slice(0, 4),
      scriptSrc,
      bundleProbe,
      headHtml: (document.head?.innerHTML || '').slice(0, 240),
      scriptTags: [...document.getElementsByTagName('script')].map((s) => s.src || 'inline').slice(0, 4)
    };
  };
  return (async () => {
    const mark = (message, extra = '') => console.log(`SMOKE_MARK ${message} ${extra}`.trim());
    mark('verify-start', `readyState=${document.readyState} boot=${window.__bootStatus}`);
    // Session may legitimately appear as the auth screen at any point (fresh
    // process session, idle lock). Sign in whenever it appears instead of
    // treating a transient re-auth as data loss — but log every flip loudly.
    const signInIfNeeded = async (attempt) => {
      const form = document.querySelector('form[data-form="user-login"]');
      if (!form) return true;
      const pin = form.querySelector('[name="pin"]');
      if (!pin) return false;
      mark('auth-present', `attempt=${attempt}`);
      pin.value = '2468';
      pin.dispatchEvent(new Event('input', { bubbles: true }));
      form.querySelector('button[type="submit"]')?.click();
      const cleared = await waitFor(() => !document.querySelector('form[data-form="user-login"]'));
      mark('auth-cleared', `attempt=${attempt} cleared=${cleared}`);
      return cleared;
    };
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (!(await signInIfNeeded(attempt))) return { ok: false, reason: 'sign-in PIN field is missing or submission failed', attempt, ...(await snapshot()) };
      if (await waitFor(() => document.querySelector('[data-action="navigate"][data-page="patients"]'), 12000)) break;
      mark('nav-wait-failed', `attempt=${attempt}`);
      if (!document.querySelector('form[data-form="user-login"]')) {
        return { ok: false, reason: 'patients navigation was unavailable', attempt, ...(await snapshot()) };
      }
    }
    if (!document.querySelector('[data-action="navigate"][data-page="patients"]')) return { ok: false, reason: 'patients navigation was unavailable after re-auth', ...(await snapshot()) };
    mark('nav-found');
    document.querySelector('[data-action="navigate"][data-page="patients"]')?.click();
    mark('nav-clicked');
    const pollStarted = Date.now();
    let hasPatient = false;
    while (Date.now() - pollStarted < 15000) {
      if (document.querySelector('form[data-form="user-login"]')) mark('auth-reappeared-during-patient-wait', `boot=${window.__bootStatus}`);
      await signInIfNeeded(2);
      if (document.body.textContent.includes('Windows Smoke Patient')) { hasPatient = true; break; }
      await wait(400);
    }
    const patientText = document.body.textContent || '';
    if (!hasPatient) return { ok: false, reason: 'patient was not rendered after restart', hasPatient, ...(await snapshot()) };
    mark('patient-found');
    await signInIfNeeded(3);
    if (!await waitFor(() => document.querySelector('[data-action="navigate"][data-page="backup"]'))) return { ok: false, reason: 'backup navigation was unavailable', hasPatient, ...(await snapshot()) };
    document.querySelector('[data-action="navigate"][data-page="backup"]')?.click();
    mark('backup-clicked');
    const hasBackup = await waitFor(() => /Backup/i.test(document.body.textContent || ''));
    mark('verify-end', `ok=${Boolean(hasPatient && hasBackup)}`);
    const backupText = document.body.textContent || '';
    return { ok: Boolean(hasPatient && hasBackup), hasPatient, hasBackup, patientText: patientText.slice(0, 600), backupText: backupText.slice(0, 600), ...(await snapshot()) };
  })();
}
