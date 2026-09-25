/**
 * Document engine (v1.6.0 flagship).
 *
 * One document definition drives preview, print AND PDF — never three
 * drifting builders. String-only, renderer-agnostic: tables, headers,
 * patient blocks, totals and signatures are pure functions of a spec.
 * Numbers/dates arrive PRE-FORMATTED by the renderer (currency()/date()/age()),
 * so this module never formats money or dates itself; the print font stack is
 * English-only and defined once, below.
 */

import { PRINT_PAGE_SIZES } from '../electron/lib/print.mjs';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const esc = escapeHtml;

const PAGE_SIZES = [...PRINT_PAGE_SIZES];
export function normalizeDocPageSize(size) {
  if (size === 'Receipt' || size === '80mm') return 'Receipt80';
  return PAGE_SIZES.includes(size) ? size : 'A4';
}

const DEFAULT_LABELS = {
  patient: 'Patient', patientId: 'Patient ID', age: 'Age', sex: 'Sex',
  phone: 'Phone', address: 'Address', date: 'Date', doctor: 'Doctor',
  cc: 'C/C', oe: 'O/E', re: 'R/E', diagnosis: 'Diagnosis', advice: 'Advice', followUp: 'Follow-up',
  rx: 'Rx', medicine: 'Medicine', dose: 'Dose', frequency: 'Frequency', duration: 'Duration', qty: 'Qty',
  item: 'Item', unitPrice: 'Unit price', discount: 'Discount', tax: 'Tax', subtotal: 'Subtotal',
  total: 'Total', paid: 'Paid', due: 'Due', grandTotal: 'Grand total',
  charges: 'Charges', balance: 'Balance', statementPeriod: 'Statement period',
  openingBalance: 'Opening balance', closingBalance: 'Closing balance',
  reference: 'Reference', description: 'Description', debit: 'Debit', credit: 'Credit',
  signature: 'Signature', regNo: 'Reg. no',
  visitsSummary: 'Visit summary', notes: 'Notes', generatedOn: 'Generated on'
};

/** Clinic identity header: logo, name, prescriber identity, registration, contact. */
export function clinicHeader({ settings = {}, labels = {}, title = '', docRef = '', docDate = '', receipt = false }) {
  const L = { ...DEFAULT_LABELS, ...labels };
  const brand = settings.clinicName || 'Dentiva Pro';
  const prescriber = [settings.dentistName, settings.professionalTitle].filter(Boolean).join(', ');
  const regLine = settings.dentistRegistration ? `${L.regNo}: ${settings.dentistRegistration}` : '';
  const contact = [
    settings.chamberName,
    [settings.address, settings.city, settings.district].filter(Boolean).join(', '),
    [settings.phone, settings.secondaryPhone].filter(Boolean).join(' / '),
    [settings.email, settings.clinicWebsite].filter(Boolean).join(' · ')
  ].filter(Boolean);
  const logo = settings.logo && /^data:image\/(png|jpeg|webp);base64,/i.test(settings.logo)
    ? `<img class="doc-logo" src="${settings.logo}" alt="" />` : '';
  return `<header class="doc-header">
    <div class="doc-brand">${logo}
      <div><div class="doc-brand-name">${esc(brand)}</div>
      ${prescriber ? `<div class="doc-prescriber">${esc(prescriber)}</div>` : ''}
      ${regLine ? `<div class="doc-regline">${esc(regLine)}</div>` : ''}
      ${contact.map((line) => `<div class="doc-contact">${esc(line)}</div>`).join('')}</div>
    </div>
    <div class="doc-title"><h1>${esc(title)}</h1>
      ${docRef ? `<div class="doc-ref">${esc(docRef)}</div>` : ''}
      ${docDate ? `<div class="doc-ref">${esc(docDate)}</div>` : ''}
    </div>
  </header>`;
}

/** Patient identity block (label/value pairs in a bordered strip). */
export function patientBlock({ patient = {}, labels = {}, pairs = [] }) {
  const L = { ...DEFAULT_LABELS, ...labels };
  const rows = pairs.length
    ? pairs
    : [
        [L.patient, patient.fullName], [L.patientId, patient.patientCode],
        [L.age, patient.age], [L.sex, patient.gender],
        [L.phone, patient.phone], [L.address, patient.address]
      ];
  const cells = rows.filter(([, v]) => v).map(([k, v]) => `<div class="doc-pair"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
  return cells ? `<section class="doc-patient">${cells}</section>` : '';
}

/** Labelled clinical text section (C/C, O/E, advice…). */
export function clinicalSection(label, text, { compact = false } = {}) {
  if (!text) return '';
  return `<div class="doc-section${compact ? ' doc-section-compact' : ''}"><span class="doc-section-label">${esc(label)}</span><p>${esc(text).replace(/\n/g, '<br>')}</p></div>`;
}

/** Structured medication table — supports the v1.6.0 row shape AND legacy rows. */
export function medicationTable({ medications = [], labels = {} }) {
  const L = { ...DEFAULT_LABELS, ...labels };
  if (!medications.length) return '';
  const row = (m, i) => {
    const name = [m.form ? `${m.form} ` : '', m.medicine].join('');
    const strength = [m.strength, m.genericName ? `(${m.genericName})` : ''].filter(Boolean).join(' ');
    const freq = [m.frequency, m.foodRelation && ![m.frequency || ''].includes(m.foodRelation) ? m.foodRelation : ''].filter(Boolean).join(' — ');
    const instr = [m.instructions, m.quantity ? `Qty ${m.quantity}` : ''].filter(Boolean).join(' · ');
    return `<tr>
      <td class="med-num">${i + 1}</td>
      <td><strong>${esc(name)}</strong>${strength ? `<br><span class="med-sub">${esc(strength)}</span>` : ''}</td>
      <td>${esc(m.dosage || '—')}</td>
      <td>${esc(freq || '—')}</td>
      <td>${esc(m.duration || '—')}</td>
      <td class="med-instr">${esc(instr)}</td>
    </tr>`;
  };
  return `<section class="med-table-wrap"><div class="doc-rx-symbol">℞</div>
    <table class="doc-table med-table"><thead><tr>
      <th>#</th><th>${esc(L.medicine)}</th><th>${esc(L.dose)}</th><th>${esc(L.frequency)}</th><th>${esc(L.duration)}</th><th></th>
    </tr></thead><tbody>${medications.map(row).join('')}</tbody></table></section>`;
}

/** Invoice line items + payment status chips. */
export function invoiceLines({ items = [], labels = {}, formatMoney = (v) => String(v) }) {
  const L = { ...DEFAULT_LABELS, ...labels };
  const rows = items.map((item, i) => `<tr>
    <td class="med-num">${i + 1}</td>
    <td><strong>${esc(item.name || item.description || '—')}</strong>${item.category ? `<br><span class="med-sub">${esc(item.category)}</span>` : ''}${item.toothNumber ? `<span class="med-sub"> · Tooth ${esc(String(item.toothNumber))}</span>` : ''}</td>
    <td class="num">${esc(String(item.quantity ?? 1))}</td>
    <td class="num">${esc(formatMoney(item.unitPriceCents !== undefined ? item.unitPriceCents / 100 : item.unitPrice))}</td>
    <td class="num">${esc(formatMoney(item.lineTotalCents !== undefined ? item.lineTotalCents / 100 : (Number(item.quantity || 1) * Number(item.unitPrice || 0))))}</td>
  </tr>`).join('');
  return `<table class="doc-table inv-table"><thead><tr>
    <th>#</th><th>${esc(L.item)}</th><th class="num">×</th><th class="num">${esc(L.unitPrice)}</th><th class="num">${esc(L.total)}</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

/** Financial totals block rendered from pre-formatted pairs. */
export function totalsSection({ pairs = [], total = null, receipts = [] }) {
  const lines = pairs.map(([k, v]) => `<div class="doc-total-row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
  const receiptsHtml = receipts.length
    ? `<div class="doc-receipts">${receipts.map((r) => `<div class="doc-total-row med-sub"><span>${esc(r.receiptNumber)} · ${esc(r.date || '')}${r.method ? ` · ${esc(r.method)}` : ''}</span><strong>${esc(r.amount)}</strong></div>`).join('')}</div>` : '';
  return `<section class="doc-totals">${lines}${total ? `<div class="doc-total-row doc-grand"><span>${esc(total[0])}</span><strong>${esc(total[1])}</strong></div>` : ''}${receiptsHtml}</section>`;
}

/** Running-balance statement table. */
export function statementTable({ rows = [], summary = [], labels = {}, formatMoney = (v) => String(v) }) {
  const L = { ...DEFAULT_LABELS, ...labels };
  const body = rows.map((r) => `<tr>
    <td>${esc(r.date || '')}</td>
    <td><strong>${esc(r.reference || '')}</strong><br><span class="med-sub">${esc(r.type || '')}${r.note ? ` · ${esc(r.note)}` : ''}</span></td>
    <td class="num">${r.debitCents ? esc(formatMoney(r.debitCents / 100)) : '—'}</td>
    <td class="num">${r.creditCents ? esc(formatMoney(r.creditCents / 100)) : '—'}</td>
    <td class="num"><strong>${esc(formatMoney((r.balanceCents || 0) / 100))}</strong></td>
  </tr>`).join('');
  return `<table class="doc-table stmt-table"><thead><tr>
    <th>${esc(L.date)}</th><th>${esc(L.description)}</th><th class="num">${esc(L.debit)}</th><th class="num">${esc(L.credit)}</th><th class="num">${esc(L.balance)}</th>
  </tr></thead>${rows.length ? `<tbody>${body}</tbody>` : `<tbody><tr><td colspan="5" class="muted">No ledger activity in this period.</td></tr></tbody>`}
  ${summary.length ? `<tfoot>${summary.map(([k, v]) => `<tr><td colspan="4">${esc(k)}</td><td class="num"><strong>${esc(v)}</strong></td></tr>`).join('')}</tfoot>` : ''}</table>`;
}

/** Signature block — therapist identity, registration, ruled line. */
export function signatureBlock({ settings = {}, labels = {} }) {
  const L = { ...DEFAULT_LABELS, ...labels };
  const name = settings.dentistName || '';
  const quals = settings.professionalTitle || '';
  const reg = settings.dentistRegistration || '';
  if (!name && !reg) return '';
  return `<section class="doc-signature"><div class="doc-sign-box">
    ${name ? `<strong>${esc(name)}</strong>` : ''}
    ${quals ? `<span>${esc(quals)}</span>` : ''}
    ${reg ? `<span>${esc(L.regNo)}: ${esc(reg)}</span>` : ''}
  </div><span class="doc-sign-label">${esc(L.signature)}</span></section>`;
}

/** Footer — clinic-configured note + generation stamp. */
export function documentFooter({ settings = {}, generatedOn = '', labels = {} }) {
  const L = { ...DEFAULT_LABELS, ...labels };
  const footer = settings.documentTemplate?.footer || '';
  const parts = [];
  if (footer) parts.push(`<div>${esc(footer)}</div>`);
  if (generatedOn) parts.push(`<div class="doc-stamp">${esc(L.generatedOn)} ${esc(generatedOn)}</div>`);
  return parts.length ? `<footer class="doc-footer">${parts.join('')}</footer>` : '';
}

const PAGE_CSS = {
  A4: '210mm 297mm', A5: '148mm 210mm', Letter: '8.5in 11in', Legal: '8.5in 14in', Receipt80: '80mm 200mm'
};

/**
 * Assemble a complete printable+HTML document.
 * @returns {{html: string}} full standalone HTML for preview/print/PDF.
 */
export function buildDocument({ kind = 'document', settings = {}, labels = {}, title = '', docRef = '', docDate = '', patientPairs = [], clinicalSections = [], body = '', totals = null, signature = true, footerStamp = '', pageSize = 'A4', lang = 'en' } = {}) {
  const size = normalizeDocPageSize(pageSize);
  const receipt = size === 'Receipt80';
  const patient = patientPairs.length ? patientBlock({ pairs: patientPairs, labels }) : '';
  const clinical = clinicalSections.filter(Boolean).map(({ label, text, compact }) => clinicalSection(label, text, { compact })).join('');
  const fontChain = "'Segoe UI',Arial,Helvetica,'Segoe UI Symbol',sans-serif";
  const html = `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8">
<title>${esc(title || kind)}</title><style>
:root{ --ink:#142b2e; --muted:#5c6f6f; --accent:#0c6b70; --line:#d8e3e3; --fill:#f4f8f8; --hair:#e6eeee; }
*{ box-sizing:border-box; }
html,body{ margin:0; padding:${receipt ? '3mm' : '12mm'}; color:var(--ink); background:#fff;
  font-size:${receipt ? '11px' : '13px'}; line-height:1.5; font-family:${fontChain}; }
.doc-header{ display:flex; justify-content:space-between; align-items:flex-start; gap:${receipt ? '6px' : '18px'};
  padding-bottom:${receipt ? '7px' : '12px'}; border-bottom:${receipt ? '1px' : '2.5px'} solid var(--accent); margin-bottom:${receipt ? '8px' : '16px'}; }
.doc-brand{ display:flex; gap:${receipt ? '6px' : '12px'}; align-items:flex-start; }
.doc-logo{ max-height:${receipt ? '30px' : '52px'}; max-width:${receipt ? '70px' : '120px'}; object-fit:contain; }
.doc-brand-name{ font-size:${receipt ? '14px' : '19px'}; font-weight:800; color:var(--accent); letter-spacing:-.01em; }
.doc-prescriber{ font-size:${receipt ? '9.5px' : '11px'}; font-weight:600; color:var(--ink); margin-top:1px; }
.doc-regline{ font-size:${receipt ? '8.5px' : '10px'}; color:var(--muted); }
.doc-contact{ font-size:${receipt ? '8.5px' : '10.5px'}; color:var(--muted); }
.doc-title{ text-align:right; flex-shrink:0; }
.doc-title h1{ font-size:${receipt ? '13px' : '20px'}; margin:0 0 3px; color:var(--ink); letter-spacing:-.01em; }
.doc-ref{ font-size:${receipt ? '8.5px' : '10.5px'}; color:var(--muted); }
.doc-patient{ display:flex; flex-wrap:wrap; gap:${receipt ? '4px 10px' : '6px 22px'}; padding:${receipt ? '6px 8px' : '10px 14px'};
  background:var(--fill); border:1px solid var(--line); border-radius:${receipt ? '4px' : '10px'}; margin-bottom:${receipt ? '8px' : '14px'}; }
.doc-pair{ font-size:${receipt ? '9.5px' : '11.5px'}; }
.doc-pair span{ display:block; color:var(--muted); font-size:${receipt ? '8px' : '9px'}; text-transform:uppercase; letter-spacing:.06em; }
.doc-pair strong{ font-weight:700; }
.doc-section{ margin:${receipt ? '5px 0' : '9px 0'}; }
.doc-section-label{ display:inline-block; min-width:${receipt ? '34px' : '52px'}; margin-right:6px; font-weight:800; color:var(--accent);
  text-transform:uppercase; font-size:${receipt ? '9px' : '10px'}; letter-spacing:.04em; }
.doc-section p{ display:inline; margin:0; }
.doc-section-compact p{ color:var(--muted); }
.med-table-wrap{ position:relative; margin:${receipt ? '8px 0' : '14px 0'}; }
.doc-rx-symbol{ font-family:'Times New Roman',serif; font-size:${receipt ? '19px' : '30px'}; font-weight:800; color:var(--accent); margin-bottom:2px; }
.doc-table{ width:100%; border-collapse:collapse; margin:${receipt ? '5px 0' : '10px 0'}; }
.doc-table thead{ display:table-header-group; }
.doc-table tr{ page-break-inside:avoid; }
.doc-table th{ background:var(--fill); text-transform:uppercase; font-size:${receipt ? '8px' : '9px'}; letter-spacing:.05em;
  color:var(--muted); text-align:left; padding:${receipt ? '3px 5px' : '6px 9px'}; border-bottom:1.5px solid var(--accent); }
.doc-table td{ text-align:left; padding:${receipt ? '3.5px 5px' : '7px 9px'}; border-bottom:1px solid var(--line); vertical-align:top; }
.doc-table td.num, .doc-table th.num{ text-align:right; font-variant-numeric:tabular-nums; }
.med-num{ width:${receipt ? '14px' : '22px'}; color:var(--muted); }
.med-sub{ color:var(--muted); font-size:${receipt ? '8.5px' : '10px'}; }
.med-instr{ color:var(--ink); font-size:${receipt ? '9px' : '10.5px'}; }
.doc-totals{ width:${receipt ? '100%' : '62%'}; margin-left:auto; margin-top:${receipt ? '6px' : '12px'}; page-break-inside:avoid; }
.doc-total-row{ display:flex; justify-content:space-between; padding:${receipt ? '2.5px 0' : '4px 0'}; font-size:${receipt ? '10px' : '11.5px'}; border-bottom:1px dashed var(--hair, #e6eeee); }
.doc-total-row.doc-grand{ border-top:2px solid var(--accent); border-bottom:none; margin-top:4px; padding-top:6px; font-size:${receipt ? '11.5px' : '13.5px'}; font-weight:800; color:var(--accent); }
.doc-receipts{ margin-top:6px; }
.stmt-table tfoot td{ border-top:2px solid var(--accent); padding-top:6px; font-weight:700; }
.doc-signature{ margin-top:${receipt ? '16px' : '40px'}; display:flex; flex-direction:column; align-items:flex-end; page-break-inside:avoid; }
.doc-sign-box{ min-width:${receipt ? '120px' : '220px'}; border-top:1.5px solid var(--ink); padding-top:5px; text-align:center; display:flex; flex-direction:column; gap:1px; }
.doc-sign-box strong{ font-size:${receipt ? '10.5px' : '12.5px'}; }
.doc-sign-box span{ font-size:${receipt ? '8.5px' : '10px'}; color:var(--muted); }
.doc-sign-label{ font-size:${receipt ? '8px' : '9px'}; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-top:3px; }
.doc-footer{ margin-top:${receipt ? '10px' : '26px'}; padding-top:${receipt ? '5px' : '10px'}; border-top:1px solid var(--line);
  font-size:${receipt ? '8.5px' : '10px'}; color:var(--muted); page-break-inside:avoid; }
.doc-stamp{ opacity:.75; }
.muted{ color:var(--muted); }
@page{ size:${PAGE_CSS[size] || PAGE_CSS.A4}; margin:${receipt ? '3mm' : '9mm'}; }
@media print{ body{ padding:0 } .doc-table thead{ display:table-header-group } }
</style></head><body>${clinicHeader({ settings, labels, title, docRef, docDate, receipt })}${[patient, clinical, body, typeof totals === 'string' ? totals : (totals ? totalsSection(totals) : ''), signature && !receipt ? signatureBlock({ settings, labels }) : ''].join('')}
${documentFooter({ settings, generatedOn: footerStamp, labels })}
</body></html>`;
  return { html, pageSize: size };
}
