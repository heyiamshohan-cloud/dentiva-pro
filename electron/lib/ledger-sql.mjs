// Patient financial ledger — SQL-native implementation (v1.6.0 flagship).
//
// Mirrors domain.statementEntries semantics EXACTLY (integer cents,
// invoice=debit, payment=gross credit, refund=debit, adjustment=credit,
// running balance never clamped for accumulation, display clamps at ≥0),
// but executes in SQLite so a patient with thousands of ledger events
// paginates in O(page) memory instead of materializing all three tables.
//
// Also: lifetime financial summary, monthly/yearly rollups and the
// per-visit billing rollup the Patient 360 visits tab renders.

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || min));

export const LEDGER_LIMIT = 500;

/** Union of all ledger events for a patient (invoices, payments, refunds, adjustments). */
const LEDGER_EVENTS_SQL = `
  SELECT date, reference, type, debit_cents, credit_cents, note, record_id FROM (
    SELECT i.date AS date, i.invoice_number AS reference, 'Invoice' AS type,
           i.total_cents AS debit_cents, 0 AS credit_cents,
           printf('%d item(s)', CASE WHEN json_valid(i.items) THEN json_array_length(i.items) ELSE 0 END) AS note,
           i.id AS record_id
    FROM invoices i
    WHERE i.patient_id = ? AND i.status <> 'Cancelled'
    UNION ALL
    SELECT p.date, p.receipt_number, 'Payment', 0, p.amount_cents,
           COALESCE(NULLIF(p.method,''), 'Payment'), p.id
    FROM payments p
    WHERE p.patient_id = ? AND p.status NOT IN ('Voided','Cancelled')
    UNION ALL
    SELECT COALESCE(NULLIF(a.date,''), substr(a.created_at,1,10)),
           a.id,
           'Refund', a.amount_cents, 0,
           printf('%s · %s', COALESCE(NULLIF(a.reason,''), 'Refund / reversal'),
                  COALESCE((SELECT p2.receipt_number FROM payments p2 WHERE p2.id = a.payment_id), '—')), a.id
    FROM payment_adjustments a
    WHERE a.patient_id = ? AND a.type = 'Refund'
      AND (a.payment_id IS NULL OR a.payment_id = '' OR EXISTS (
             SELECT 1 FROM payments p3 WHERE p3.id = a.payment_id AND p3.status NOT IN ('Voided','Cancelled')))
    UNION ALL
    SELECT COALESCE(NULLIF(a.date,''), substr(a.created_at,1,10)), a.id,
           'Adjustment', 0, a.amount_cents,
           COALESCE(NULLIF(a.reason,''), 'Balance adjustment'), a.id
    FROM payment_adjustments a
    WHERE a.patient_id = ? AND a.type = 'Adjustment'
  )`;

/**
 * Paginated running-balance statement for one patient.
 * @param {object} ws workspace providing .query(sql, params)
 */
export function patientLedgerSql(ws, patientId, { page = 1, pageSize = 50, from = '', to = '' } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = clamp(pageSize, 1, LEDGER_LIMIT);
  const id = String(patientId || '');
  if (!id) return { ok: false, error: 'Patient id required', rows: [], total: 0 };

  const rangeSql = `${from ? ' AND date >= ?' : ''}${to ? ' AND date <= ?' : ''}`;
  const rangeParams = [...(from ? [from] : []), ...(to ? [to] : [])];
  const base = `${LEDGER_EVENTS_SQL} WHERE 1=1${rangeSql}`;
  const params = [id, id, id, id, ...rangeParams];

  const total = ws.query(`SELECT COUNT(*) AS n FROM (${base})`, params)[0]?.n || 0;

  // Opening balance = net of all events strictly before the window.
  // Window events sort by (date, reference) — replicated 1:1 from statementEntries.
  const opening = from
    ? ws.query(`SELECT COALESCE(SUM(debit_cents - credit_cents),0) AS v FROM (${LEDGER_EVENTS_SQL} WHERE date < ?)`, [id, id, id, id, from])[0]?.v || 0
    : 0;

  const rows = ws.query(
    `SELECT date, reference, type, debit_cents, credit_cents, note, record_id,
            MAX(0, ${Number(opening) || 0} + SUM(debit_cents - credit_cents) OVER (ORDER BY date ASC, reference ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) AS balance_cents
     FROM (${LEDGER_EVENTS_SQL} WHERE 1=1${rangeSql})
     ORDER BY date ASC, reference ASC
     LIMIT ? OFFSET ?`,
    [id, id, id, id, ...rangeParams, safeSize, (safePage - 1) * safeSize]
  ).map((r) => ({
    date: r.date, type: r.type, reference: r.reference, note: r.note || '', recordId: r.record_id,
    debitCents: Number(r.debit_cents) || 0, creditCents: Number(r.credit_cents) || 0,
    balanceCents: Number(r.balance_cents) || 0,
  }));

  return { ok: true, rows, total, page: safePage, pageSize: safeSize, openingBalanceCents: Math.max(0, opening), pageTotalCents: rows.reduce((s, r) => s + r.debitCents - r.creditCents, 0) };
}

/** Lifetime financial summary + counts for Patient 360 overview cards. */
export function patientFinancialSummarySql(ws, patientId) {
  const id = String(patientId || '');
  if (!id) return { ok: false, error: 'Patient id required' };
  const inv = ws.query(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN status <> 'Cancelled' THEN total_cents ELSE 0 END),0) AS billed,
            COALESCE(SUM(CASE WHEN status <> 'Cancelled' THEN discount_cents ELSE 0 END),0) AS discounts,
            COALESCE(SUM(CASE WHEN status <> 'Cancelled' THEN tax_cents ELSE 0 END),0) AS tax,
            COALESCE(SUM(CASE WHEN status NOT IN ('Cancelled','Paid') THEN due_cents ELSE 0 END),0) AS outstanding
     FROM invoices WHERE patient_id = ?`, [id])[0] || {};
  const pay = ws.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS paid,
            COALESCE(SUM(refunded_cents),0) AS refunded
     FROM payments WHERE patient_id = ? AND status NOT IN ('Voided','Cancelled')`, [id])[0] || {};
  const refunds = ws.query(`SELECT COUNT(*) AS n FROM payment_adjustments WHERE patient_id = ? AND type = 'Refund'`, [id])[0] || {};
  const adj = ws.query(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS v FROM payment_adjustments WHERE patient_id = ? AND type = 'Adjustment'`, [id])[0] || {};
  const last = ws.query(
    `SELECT date, receipt_number, amount_cents, method FROM payments
     WHERE patient_id = ? AND status NOT IN ('Voided','Cancelled') ORDER BY date DESC, created_at DESC LIMIT 1`, [id])[0] || null;
  const visitCount = ws.query(`SELECT COUNT(*) AS n FROM visits WHERE patient_id = ?`, [id])[0]?.n || 0;
  const billed = Number(inv.billed) || 0;
  const paid = Number(pay.paid) || 0;
  const refunded = Number(pay.refunded) || 0;
  const adjusted = Number(adj.v) || 0;
  return {
    ok: true,
    billedCents: billed, paidCents: paid, refundedCents: refunded, adjustedCents: adjusted,
    discountCents: Number(inv.discounts) || 0, taxCents: Number(inv.tax) || 0,
    netPaidCents: Math.max(0, paid - refunded),
    dueCents: Math.max(0, billed + adjusted - paid + refunded) === Math.max(0, Number(inv.outstanding) || 0)
      ? Math.max(0, Number(inv.outstanding) || 0) // trust invoice due_cents denorm; fallback formula matches if ledger intact
      : Math.max(0, billed + adjusted - paid + refunded),
    invoiceCount: Number(inv.n) || 0, paymentCount: Number(pay.n) || 0,
    refundCount: Number(refunds.n) || 0, adjustmentCount: Number(adj.n) || 0,
    visitCount: Number(visitCount) || 0,
    lastPayment: last ? { date: last.date, receiptNumber: last.receipt_number, amountCents: Number(last.amount_cents) || 0, method: last.method || '' } : null,
  };
}

/** Monthly (and yearly) nets for the patient financial summary tab. */
export function patientLedgerRollupsSql(ws, patientId, months = 12, years = 5) {
  const id = String(patientId || '');
  if (!id) return { monthly: [], yearly: [] };
  const monthly = ws.query(
    `SELECT strftime('%Y-%m', date) AS bucket,
            SUM(debit_cents) AS billed, SUM(credit_cents) AS received, SUM(debit_cents - credit_cents) AS net
     FROM (${LEDGER_EVENTS_SQL}) WHERE date >= date('now','start of month', '-11 months')
     GROUP BY bucket ORDER BY bucket DESC LIMIT ${Math.max(1, months)}`,
    [id, id, id, id]
  );
  const yearly = ws.query(
    `SELECT strftime('%Y', date) AS bucket,
            SUM(debit_cents) AS billed, SUM(credit_cents) AS received, SUM(debit_cents - credit_cents) AS net
     FROM (${LEDGER_EVENTS_SQL})
     GROUP BY bucket ORDER BY bucket DESC LIMIT ${Math.max(1, years)}`,
    [id, id, id, id]
  );
  const shape = (rows) => rows.map((r) => ({ bucket: r.bucket, billedCents: Number(r.billed) || 0, receivedCents: Number(r.received) || 0, netCents: Number(r.net) || 0 }));
  return { monthly: shape(monthly), yearly: shape(yearly) };
}

/**
 * Per-visit billing rollup for a page of visit ids (Patient 360 visits tab).
 * One bounded IN-query per source; no N+1.
 */
export function visitBillingForSql(ws, visitIds = []) {
  const ids = visitIds.map((v) => String(v)).filter(Boolean).slice(0, 100);
  if (!ids.length) return {};
  const ph = ids.map(() => '?').join(',');
  const invoices = ws.query(
    `SELECT id, visit_id, invoice_number, date, status, total_cents, paid_cents, due_cents
     FROM invoices WHERE visit_id IN (${ph}) AND status <> 'Cancelled'`, ids);
  const invoiceIds = invoices.map((i) => i.id);
  const payments = invoiceIds.length
    ? ws.query(`SELECT id, invoice_id, receipt_number, date, amount_cents, method, status
                FROM payments WHERE invoice_id IN (${invoiceIds.map(() => '?').join(',')}) AND status NOT IN ('Voided','Cancelled')`, invoiceIds)
    : [];
  const byVisit = {};
  for (const inv of invoices) {
    const key = inv.visit_id;
    byVisit[key] ||= { invoices: [], payments: [], billedCents: 0, paidCents: 0, dueCents: 0 };
    byVisit[key].invoices.push({ id: inv.id, invoiceNumber: inv.invoice_number, date: inv.date, status: inv.status, totalCents: Number(inv.total_cents) || 0, paidCents: Number(inv.paid_cents) || 0, dueCents: Number(inv.due_cents) || 0 });
    byVisit[key].billedCents += Number(inv.total_cents) || 0;
    byVisit[key].dueCents += Number(inv.due_cents) || 0;
  }
  for (const pay of payments) {
    const inv = invoices.find((i) => i.id === pay.invoice_id);
    if (!inv) continue;
    byVisit[inv.visit_id].payments.push({ id: pay.id, receiptNumber: pay.receipt_number, date: pay.date, amountCents: Number(pay.amount_cents) || 0, method: pay.method || '' });
    byVisit[inv.visit_id].paidCents += Number(pay.amount_cents) || 0;
  }
  for (const key of Object.keys(byVisit)) byVisit[key].dueCents = Math.max(0, byVisit[key].billedCents - byVisit[key].paidCents);
  return byVisit;
}
