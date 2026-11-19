// Bursar Pack, Phase Three screens. Demo mode for now: the cloud versions arrive with the backend phase.
import { escapeHtml, on, qs } from '../../components/dom.js';
import { printHtml } from '../../components/printWindow.js';
import { fullName } from '../../services/studentService.js';
import { isAdmin } from '../../services/accessService.js';
import { getAuditLog } from '../../services/auditService.js';
import { featureEnabled } from '../../services/subscriptionService.js';
import * as L from '../../services/bursarLogic.js';
import * as B from '../../services/bursarService.js';
import { today, money, METHODS, methodLabel, sName, badge, TONE, download, errBox, opt, studentOptions } from './bursarUi.js';

const credits = (d) => d.creditNotes ?? [];
const figOf = (d, i) => L.invoiceFigures(i, d.payments, today(), credits(d));
const approver = (d) => d.settings.siblingPolicy.approverRole === 'accountant' || isAdmin();
const num = (v) => Number(v) || 0;
const table = (heads, rows, right = []) => `<div class="overflow-x-auto"><table class="data-table"><thead><tr>${heads.map((h, i) => `<th ${right.includes(i) ? 'class="text-right"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td ${right.includes(i) ? 'class="text-right"' : ''}>${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${heads.length}" class="text-sm text-ink-500">Nothing to show.</td></tr>`}</tbody></table></div>`;

export const PHASE3_TABS = [
  ['statements', 'Fee statements', () => featureEnabled('fee_statements')],
  ['plans', 'Installment plans', () => featureEnabled('installment_plans')],
  ['credits', 'Credit notes', () => featureEnabled('credit_notes')],
  ['cashbook', 'Cashbook', () => featureEnabled('cashbook')],
  ['faudit', 'Financial audit', () => featureEnabled('finance_audit_trail')],
];

// ---------------------------------------------------------------- dashboard
export async function dashboard(el, d) {
  const m = L.bursarMetrics({ invoices: d.invoices, payments: d.payments, refunds: d.refunds, creditNotes: credits(d), bankTx: d.bankTransactions ?? [], today: today() });
  const trend = L.monthlyCollections(d.payments).slice(-6); const max = Math.max(1, ...trend.map(([, v]) => v));
  const byClass = L.summaryBy(d.invoices, d.payments, credits(d), (i) => d.classById[d.studentById[i.studentId]?.classId]?.name);
  const byTerm = L.summaryBy(d.invoices, d.payments, credits(d), (i) => d.termById[i.termId]?.name ?? 'No term');
  const openCredits = credits(d).filter((c) => c.status === 'pending').length;
  const card = (l, v, sub = '') => `<div class="card card-p"><p class="text-sm text-ink-500">${l}</p><p class="stat-num" style="font-size:1.3rem;">${v}</p>${sub ? `<p class="text-xs text-ink-400">${sub}</p>` : ''}</div>`;
  const summary = (rows) => table(['', 'Billed', 'Paid', 'Owing', 'Collected'], rows.map((r) => [escapeHtml(r.key), money(d, r.billed), money(d, r.paid), money(d, r.outstanding), r.pct == null ? '—' : `${r.pct}%`]), [1, 2, 3, 4]);
  el.innerHTML = `<div class="space-y-4">
    <div class="grid grid-2 lg-grid-4 gap-4">${card('Expected fees', money(d, m.expected), 'billed, less approved credit notes')}${card('Collected', money(d, m.collected), 'confirmed payments only')}${card('Outstanding', money(d, m.outstanding))}${card('Collection rate', m.collectionPct == null ? '—' : `${m.collectionPct}%`)}
      ${card('Overdue invoices', m.overdue)}${card('Pending verification', m.pending)}${card('Unmatched payments', m.unmatched, m.unmatched ? money(d, m.unmatchedAmount) : 'none waiting')}${card('Pending refunds / credit notes', `${m.pendingRefunds} / ${openCredits}`)}</div>
    <div class="grid grid-2 gap-4">
      <div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Daily transactions (last 7 days with payments)</h3>${table(['Date', 'Payments', 'Total'], m.daily.map((x) => [x.date, x.count, money(d, x.total)]), [1, 2])}</div>
      <div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Collection trend (6 months)</h3>${trend.length ? trend.map(([mo, v]) => `<div class="flex items-center gap-2 text-sm" style="margin:.25rem 0;"><span style="width:4.5rem;">${mo}</span><div style="flex:1;background:var(--ink-100);border-radius:4px;"><div style="width:${Math.round((v / max) * 100)}%;background:var(--brand-700);height:.7rem;border-radius:4px;"></div></div><span>${escapeHtml(money(d, v))}</span></div>`).join('') : '<p class="text-sm text-ink-400">No confirmed payments yet.</p>'}</div></div>
    <div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">By class</h3>${summary(byClass)}</div>
    <div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">By term</h3>${summary(byTerm)}</div>
    <div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Recent payments</h3>${table(['Date', 'Learner', 'Method', 'Status', 'Amount'], d.payments.slice(0, 8).map((p) => [escapeHtml(p.date), escapeHtml(sName(d, p.studentId)), escapeHtml(methodLabel(p.method)), badge(TONE[p.status ?? 'confirmed'], L.PAYMENT_STATUS[p.status ?? 'confirmed']), money(d, p.amount)]), [4])}</div></div>`;
}

// ---------------------------------------------------------------- statements
export async function statements(el, d) {
  const st = { studentId: '', from: '', to: today() };
  function paint() {
    const s = st.studentId ? L.buildStatement({ studentId: st.studentId, invoices: d.invoices, payments: d.payments, creditNotes: credits(d), refunds: d.refunds, from: st.from, to: st.to }) : null;
    const stu = d.studentById[st.studentId];
    const doc = s && `<div style="font-family:Arial,sans-serif;"><h2>${escapeHtml(d.school.name ?? 'School')}</h2><h3>FEE STATEMENT</h3><p><strong>${escapeHtml(fullName(stu))}</strong> (${escapeHtml(stu.admissionNumber)}) · ${escapeHtml(d.classById[stu.classId]?.name ?? '')}<br>${st.from ? `From ${escapeHtml(st.from)} ` : ''}to ${escapeHtml(st.to)} · printed ${today()}</p>
      ${table(['Date', 'Document', 'Description', 'Charged', 'Paid / credited', 'Balance'], [...(s.opening ? [['', '', 'Balance brought forward', '', '', money(d, s.opening)]] : []), ...s.lines.map((l) => [escapeHtml(l.date), escapeHtml(l.ref), escapeHtml(l.description), l.debit ? money(d, l.debit) : '', l.credit ? money(d, l.credit) : '', money(d, l.balance)])], [3, 4, 5])}
      <p><strong>${s.closing > 0 ? `Amount due: ${money(d, s.closing)}` : s.closing < 0 ? `Credit balance: ${money(d, -s.closing)}` : 'Fully paid — nothing owing'}</strong></p><p style="font-size:.85em;">Only confirmed payments are shown.</p></div>`;
    el.innerHTML = `<div class="space-y-4"><div class="flex flex-wrap gap-2 items-end no-print"><div><label class="label">Learner</label><select class="input" id="sx-s" style="min-width:16rem;">${studentOptions(d, st.studentId)}</select></div><div><label class="label">From</label><input class="input" type="date" id="sx-f" value="${st.from}" /></div><div><label class="label">To</label><input class="input" type="date" id="sx-t" value="${st.to}" />${''}</div>${s ? '<button class="btn-secondary" id="sx-print">Print</button><button class="btn-secondary" id="sx-csv">Export CSV</button>' : ''}</div>${doc ?? '<p class="text-sm text-ink-500">Choose a learner to see their statement.</p>'}</div>`;
    qs(el, '#sx-s').addEventListener('change', (e) => { st.studentId = e.target.value; paint(); });
    qs(el, '#sx-f').addEventListener('change', (e) => { st.from = e.target.value; paint(); }); qs(el, '#sx-t').addEventListener('change', (e) => { st.to = e.target.value || today(); paint(); });
    qs(el, '#sx-print')?.addEventListener('click', () => printHtml('Fee statement', doc));
    qs(el, '#sx-csv')?.addEventListener('click', () => download(`statement-${stu.admissionNumber}.csv`, L.toCsv([['Date', 'Document', 'Description', 'Charged', 'Paid/credited', 'Balance'], ...s.lines.map((l) => [l.date, l.ref, l.description, l.debit, l.credit, l.balance])])));
  }
  paint();
}

// ---------------------------------------------------------------- installment plans
export async function plans(el, d, { redo }) {
  const rules = L.rulesFrom(d.settings);
  const st = { invoiceId: '', count: 3, firstDue: '', interval: 1 };
  const withPlan = new Set(d.installmentPlans.filter((p) => p.status === 'active').map((p) => p.invoiceId));
  const open = d.invoices.filter((i) => i.status !== 'void' && !withPlan.has(i.id) && figOf(d, i).outstanding > 0);
  function paint() {
    const inv = open.find((i) => i.id === st.invoiceId);
    const prev = inv ? L.buildSchedule({ outstanding: figOf(d, inv).outstanding, count: num(st.count), firstDue: st.firstDue, intervalMonths: num(st.interval) || 1 }, rules) : null;
    el.innerHTML = `<div class="space-y-4"><section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">New installment plan</h3><div class="grid grid-2 lg-grid-4 gap-3">
        <div style="grid-column:span 2;"><label class="label">Invoice</label><select class="input" data-f="invoiceId"><option value="">Choose…</option>${open.map((i) => `<option value="${i.id}" ${i.id === st.invoiceId ? 'selected' : ''}>${escapeHtml(i.number ?? '—')} · ${escapeHtml(sName(d, i.studentId))} · owes ${escapeHtml(money(d, figOf(d, i).outstanding))}</option>`).join('')}</select></div>
        <div><label class="label">Installments (2–${rules.maxInstallments})</label><input class="input" type="number" min="2" max="${rules.maxInstallments}" data-f="count" value="${st.count}" /></div>
        <div><label class="label">First due</label><input class="input" type="date" data-f="firstDue" value="${st.firstDue}" /></div>
        <div><label class="label">Months between</label><input class="input" type="number" min="1" max="6" data-f="interval" value="${st.interval}" /></div></div>
      ${prev?.error ? `<p class="text-sm" style="color:var(--bad);">${escapeHtml(prev.error)}</p>` : prev ? table(['#', 'Due', 'Amount'], prev.schedule.map((x) => [x.no, x.dueDate, money(d, x.amount)]), [2]) : ''}
      <button class="btn-primary" id="pl-save" ${prev?.schedule ? '' : 'disabled'}>Create plan</button></section>
    ${d.installmentPlans.slice().reverse().map((p) => { const invoice = d.invoices.find((i) => i.id === p.invoiceId); const pr = invoice ? L.planProgress(p, invoice, d.payments, credits(d), today()) : null; return `<section class="card card-p space-y-2"><div class="flex flex-wrap justify-between gap-2"><strong>${escapeHtml(invoice?.number ?? '—')} · ${escapeHtml(sName(d, p.studentId))}</strong><span>${badge(TONE[p.status], p.status === 'active' && pr?.completed ? 'completed' : p.status)}${pr?.overdue ? ' ' + badge('bad', `${pr.overdue} overdue`) : ''}</span></div>
        ${pr ? table(['#', 'Due', 'Amount', 'Paid', 'Status'], pr.installments.map((x) => [x.no, x.dueDate, money(d, x.amount), money(d, x.paid), badge(TONE[x.status], x.status)]), [2, 3]) : ''}
        ${p.status === 'active' ? `<button class="btn-ghost btn-sm" data-cancel="${p.id}">Cancel plan</button>` : ''}</section>`; }).join('') || '<p class="text-sm text-ink-500">No installment plans yet.</p>'}</div>`;
    on(el, '[data-f]', 'input', (e) => { st[e.currentTarget.dataset.f] = e.currentTarget.value; });
    on(el, '[data-f]', 'change', paint);
    qs(el, '#pl-save')?.addEventListener('click', async () => { try { await B.createPlan({ invoiceId: st.invoiceId, count: num(st.count), firstDue: st.firstDue, intervalMonths: num(st.interval) || 1 }, 'Bursar'); await redo('Installment plan created.'); } catch (e) { await redo('', e.message); } });
    on(el, '[data-cancel]', 'click', async (e) => { if (confirm('Cancel this plan? The invoice keeps its balance and due date.')) { try { await B.cancelPlan(e.currentTarget.dataset.cancel, 'Bursar'); await redo('Plan cancelled.'); } catch (x) { await redo('', x.message); } } });
  }
  paint();
}

// ---------------------------------------------------------------- credit notes
export async function creditNotes(el, d, { redo }) {
  const canDecide = approver(d); const st = { invoiceId: '', amount: '', reason: '', type: 'correction' };
  const open = d.invoices.filter((i) => i.status !== 'void');
  const doc = (c) => `<div style="font-family:Arial,sans-serif;max-width:420px;"><h2>${escapeHtml(d.school.name ?? 'School')}</h2><h3>CREDIT NOTE ${escapeHtml(c.number)}</h3><p>Learner: <strong>${escapeHtml(sName(d, c.studentId))}</strong><br>Against invoice ${escapeHtml(d.invoices.find((i) => i.id === c.invoiceId)?.number ?? '')}<br>Amount <strong>${escapeHtml(money(d, c.amount))}</strong><br>Reason: ${escapeHtml(c.reason)}<br>Status: ${escapeHtml(L.CREDIT_STATUS[c.status])}</p></div>`;
  el.innerHTML = `<div class="space-y-4"><div class="notice"><span>A credit note lowers what an invoice is worth without changing the invoice itself. It only takes effect once approved${canDecide ? '' : ' by the approver'}.</span></div>
    <section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">Request a credit note</h3><div class="grid grid-2 lg-grid-4 gap-3">
      <div style="grid-column:span 2;"><label class="label">Invoice</label><select class="input" data-f="invoiceId"><option value="">Choose…</option>${open.map((i) => `<option value="${i.id}">${escapeHtml(i.number ?? '—')} · ${escapeHtml(sName(d, i.studentId))} · ${escapeHtml(money(d, i.totalAmount))}</option>`).join('')}</select></div>
      <div><label class="label">Amount</label><input class="input" type="number" min="1" data-f="amount" /></div><div><label class="label">Type</label><select class="input" data-f="type"><option value="correction">Billing correction</option><option value="write_off">Write-off</option><option value="bursary">Bursary / waiver</option><option value="other">Other</option></select></div>
      <div style="grid-column:span 4;"><label class="label">Reason</label><input class="input" data-f="reason" /></div></div><button class="btn-primary" id="cn-go">Submit for approval</button></section>
    ${table(['No.', 'Learner', 'Invoice', 'Reason', 'Amount', 'Status', 'History', ''], credits(d).slice().reverse().map((c) => [escapeHtml(c.number), escapeHtml(sName(d, c.studentId)), escapeHtml(d.invoices.find((i) => i.id === c.invoiceId)?.number ?? ''), escapeHtml(c.reason), money(d, c.amount), badge(TONE[c.status === 'approved' ? 'approved' : c.status === 'rejected' ? 'rejected' : 'pending'], L.CREDIT_STATUS[c.status]), `<span class="text-xs">${(c.history ?? []).map((h) => `${escapeHtml(String(h.at).slice(0, 10))} ${escapeHtml(h.action)} — ${escapeHtml(h.by)}${h.note ? `: ${escapeHtml(h.note)}` : ''}`).join('<br>')}</span>`, `${c.status === 'pending' && canDecide ? `<button class="btn-primary btn-sm" data-ap="${c.id}:1">Approve</button> <button class="btn-secondary btn-sm" data-ap="${c.id}:0">Reject</button>` : ''}<button class="btn-ghost btn-sm" data-print="${c.id}">Print</button>`]), [4])}</div>`;
  on(el, '[data-f]', 'input', (e) => { st[e.currentTarget.dataset.f] = e.currentTarget.value; });
  qs(el, '#cn-go').addEventListener('click', async () => { try { await B.requestCreditNote({ invoiceId: st.invoiceId, amount: st.amount, reason: st.reason, type: st.type }, 'Bursar'); await redo('Credit note submitted for approval.'); } catch (e) { await redo('', e.message); } });
  on(el, '[data-ap]', 'click', async (e) => { const [id, ok] = e.currentTarget.dataset.ap.split(':'); const note = ok === '1' ? '' : prompt('Why is it rejected?'); if (ok !== '1' && !note) return; try { await B.decideCreditNote(id, ok === '1', { by: 'Approver', note }); await redo(ok === '1' ? 'Approved. The invoice balance has been reduced.' : 'Rejected.'); } catch (x) { await redo('', x.message); } });
  on(el, '[data-print]', 'click', (e) => printHtml('Credit note', doc(credits(d).find((c) => c.id === e.currentTarget.dataset.print))));
}

// ---------------------------------------------------------------- cashbook
export async function cashbook(el, d) {
  const st = { from: today().slice(0, 8) + '01', to: today(), account: '' };
  function paint() {
    const cb = L.buildCashbook({ payments: d.payments, refunds: d.refunds, expenses: d.expenses ?? [], sponsorPayments: d.sponsorPayments ?? [], from: st.from, to: st.to });
    const lines = cb.lines.filter((l) => !st.account || l.account === st.account);
    el.innerHTML = `<div class="space-y-4"><div class="flex flex-wrap gap-2 items-end no-print"><div><label class="label">From</label><input class="input" type="date" data-f="from" value="${st.from}" /></div><div><label class="label">To</label><input class="input" type="date" data-f="to" value="${st.to}" /></div>
      <div><label class="label">Account</label><select class="input" data-f="account"><option value="">All</option>${['Cash', 'M-Pesa', 'Bank'].map((a) => `<option ${st.account === a ? 'selected' : ''}>${a}</option>`).join('')}</select></div><button class="btn-secondary" id="cb-print">Print</button><button class="btn-secondary" id="cb-csv">Export CSV</button></div>
      <div id="cb-area" class="space-y-3"><div class="grid grid-2 lg-grid-4 gap-3">${[['Opening balance', cb.opening], ['Money in', cb.totalIn], ['Money out', cb.totalOut], ['Closing balance', cb.closing]].map(([l, v]) => `<div class="card card-p"><p class="text-sm text-ink-500">${l}</p><p class="stat-num" style="font-size:1.2rem;">${escapeHtml(money(d, v))}</p></div>`).join('')}</div>
      ${table(['Account', 'In', 'Out'], Object.entries(cb.byAccount).map(([a, v]) => [a, money(d, v.inn), money(d, v.out)]), [1, 2])}
      ${table(['Date', 'Account', 'Type', 'Reference', 'Details', 'In', 'Out', 'Balance'], lines.map((l) => [l.date, l.account, l.kind, escapeHtml(l.ref), escapeHtml(l.detail), l.inn ? money(d, l.inn) : '', l.out ? money(d, l.out) : '', money(d, l.balance)]), [5, 6, 7])}</div>
      <p class="text-xs text-ink-500">Receipts are confirmed payments only. Expenses come from the Expenses tab; their payment method defaults to cash when not recorded.</p></div>`;
    on(el, '[data-f]', 'change', (e) => { st[e.currentTarget.dataset.f] = e.currentTarget.value || (e.currentTarget.dataset.f === 'to' ? today() : ''); paint(); });
    qs(el, '#cb-print').addEventListener('click', () => printHtml('Cashbook', qs(el, '#cb-area').innerHTML));
    qs(el, '#cb-csv').addEventListener('click', () => download('cashbook.csv', L.toCsv([['Date', 'Account', 'Type', 'Reference', 'Details', 'In', 'Out', 'Balance'], ...lines.map((l) => [l.date, l.account, l.kind, l.ref, l.detail, l.inn, l.out, l.balance])])));
  }
  paint();
}

// ---------------------------------------------------------------- financial audit trail
export async function financeAuditTab(el) {
  const st = { q: '' };
  const all = L.financeAudit(getAuditLog());
  function paint() {
    const rows = all.filter((e) => !st.q || `${e.action} ${e.userName} ${e.entityType}`.toLowerCase().includes(st.q.toLowerCase())).slice(0, 300);
    el.innerHTML = `<div class="space-y-3"><input class="input" id="fa-q" placeholder="Search action, person or record type" value="${escapeHtml(st.q)}" style="max-width:20rem;" />${table(['When', 'Who', 'What', 'Record type'], rows.map((e) => [escapeHtml(String(e.createdAt).replace('T', ' ').slice(0, 16)), escapeHtml(e.userName ?? ''), escapeHtml(e.action), escapeHtml(e.entityType)]))}<p class="text-xs text-ink-500">Every create, update, approval and payout on invoices, payments, receipts, credit notes, refunds, awards and plans is recorded with the signed-in person's name. Approval decisions also keep their own history on each record.</p></div>`;
    qs(el, '#fa-q').addEventListener('input', (e) => { st.q = e.target.value; const p = e.target.selectionStart; paint(); const n = qs(el, '#fa-q'); n.focus(); n.setSelectionRange(p, p); });
  }
  paint();
}

// ---------------------------------------------------------------- reconciliation with a review queue for unmatched transactions
// Remembered across redraws, so the result of an import stays on screen after the screen refreshes.
const keep = { results: null, text: '', note: '' };
export async function reconcile(el, d, { redo }) {
  const stillPending = (p) => d.payments.some((x) => x.id === p?.id && x.status === 'pending_verification');
  let results = keep.results?.map((r) => (['match', 'amount_mismatch'].includes(r.result) && !stillPending(r.payment) ? { ...r, result: 'already_known' } : r)) ?? null;
  let text = keep.text; let queuedNote = keep.note;
  const trail = featureEnabled('reconciliation_audit_trail');
  const L_ = { match: ['good', 'Matches a pending payment'], amount_mismatch: ['bad', 'Amount differs'], suggested: ['gold', 'One learner suggested'], ambiguous: ['gold', 'Several learners possible'], unmatched: ['bad', 'No learner found'], already_known: ['muted', 'Already recorded'], duplicate_line: ['bad', 'Duplicate line'] };
  const openQueue = (d.bankTransactions ?? []).filter((t) => ['unmatched', 'ambiguous', 'suggested'].includes(t.status));
  const closedQueue = (d.bankTransactions ?? []).filter((t) => ['assigned', 'ignored'].includes(t.status)).slice(-15).reverse();
  const openInvoicesOf = (sid) => d.invoices.filter((i) => i.studentId === sid && i.status !== 'void' && figOf(d, i).outstanding > 0);
  function paint() {
    el.innerHTML = `<div class="space-y-4"><div class="notice"><span>Paste or upload an M-Pesa or bank statement (CSV). Matching only <em>proposes</em>. Lines that match nothing go to the <strong>review queue</strong> below, where you decide who each payment belongs to. A payment is confirmed only when you press the button.</span></div>
      <section class="card card-p space-y-3"><input type="file" id="rc-file" accept=".csv,text/csv,text/plain" /><textarea class="input" id="rc-text" rows="5" placeholder="Date,Transaction Code,Amount,Account">${escapeHtml(text)}</textarea><button class="btn-primary" id="rc-run">Match and queue</button></section>
      ${queuedNote ? `<div class="notice" role="status"><span>${escapeHtml(queuedNote)}</span></div>` : ''}
      ${results ? table(['Reference', 'Statement', 'Result', 'Learner', ''], results.map((r, i) => [escapeHtml(r.line.reference), money(d, r.line.amount), badge(...L_[r.result]) + (r.result === 'amount_mismatch' ? `<div class="text-xs">Recorded ${escapeHtml(money(d, r.payment.amount))}</div>` : ''), escapeHtml(r.payment ? sName(d, r.payment.studentId) : r.student ? fullName(r.student) : '—'), r.result === 'match' ? `<button class="btn-primary btn-sm" data-cf="${i}">Confirm</button>` : '']), [1]) : ''}
      ${results?.some((r) => r.result === 'match') ? '<button class="btn-secondary" id="rc-all">Confirm all matches</button>' : ''}
      <section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">Review queue (${openQueue.length})</h3>
        ${openQueue.map((t) => { const cands = (t.candidateIds?.length ? t.candidateIds : t.suggestedStudentId ? [t.suggestedStudentId] : []); const pre = cands.length === 1 ? cands[0] : ''; return `<div class="space-y-2" data-tx="${t.id}" style="border-top:1px solid var(--ink-100);padding-top:.6rem;"><div class="flex flex-wrap justify-between gap-2"><span><strong>${escapeHtml(t.reference)}</strong> · ${escapeHtml(money(d, t.amount))} · ${escapeHtml(String(t.date).slice(0, 10))}<span class="text-xs text-ink-500" style="display:block;">${escapeHtml(t.account || 'no account text')}</span></span>${badge(TONE[t.status], t.status)}</div>
          <div class="flex flex-wrap gap-2"><select class="input" data-stu style="max-width:15rem;">${studentOptions(d, pre)}</select><select class="input" data-inv style="max-width:12rem;"><option value="">Auto-allocate</option></select><select class="input" data-m style="max-width:8rem;"><option value="bank">Bank</option><option value="mpesa">M-Pesa</option></select><button class="btn-primary btn-sm" data-assign="${t.id}">Assign and receipt</button><button class="btn-ghost btn-sm" data-ignore="${t.id}">Not a fee payment</button></div></div>`; }).join('') || '<p class="text-sm text-ink-500">Nothing waiting for review.</p>'}</section>
      ${closedQueue.length ? `<div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Recently decided</h3>${table(['Reference', 'Amount', 'Outcome', 'Note'], closedQueue.map((t) => [escapeHtml(t.reference), money(d, t.amount), badge(TONE[t.status], t.status), escapeHtml(t.status === 'assigned' ? `to ${sName(d, t.assignedStudentId)}` : t.note ?? '')]), [1])}</div>` : ''}
      <div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Still pending (${d.payments.filter((p) => p.status === 'pending_verification').length})</h3>${d.payments.filter((p) => p.status === 'pending_verification').slice(0, 50).map((p) => `<p class="text-sm" style="margin:.2rem 0;">${escapeHtml(p.date)} · ${escapeHtml(sName(d, p.studentId))} · ${escapeHtml(p.reference ?? '')} · ${escapeHtml(money(d, p.amount))}</p>`).join('') || '<p class="text-sm text-ink-500">Everything is reconciled.</p>'}</div>
      ${trail ? `<div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Audit trail</h3>${d.payments.filter((p) => p.confirmedAt && p.confirmNote).slice(-30).reverse().map((p) => `<p class="text-xs" style="margin:.15rem 0;">${escapeHtml(String(p.confirmedAt).slice(0, 16).replace('T', ' '))} · ${escapeHtml(p.reference ?? '')} · ${escapeHtml(p.confirmNote)}</p>`).join('') || '<p class="text-sm text-ink-500">No confirmations yet.</p>'}</div>` : ''}</div>`;
    qs(el, '#rc-file').addEventListener('change', async (e) => { text = await e.target.files[0].text(); paint(); });
    qs(el, '#rc-run').addEventListener('click', async () => {
      text = qs(el, '#rc-text').value;
      try { const lines = L.parseStatement(text); const r = await B.importStatementLines(lines); keep.results = r.results; keep.text = text; keep.note = r.queued ? `${r.queued} line(s) added to the review queue below.` : 'No new lines needed review.'; await redo('', ''); } catch (x) { await redo('', x.message); }
    });
    const confirm1 = (r) => B.confirmPayment(r.payment.id, `Matched to statement line ${r.line.reference} (${r.line.amount})`);
    on(el, '[data-cf]', 'click', async (e) => { try { await confirm1(results[Number(e.currentTarget.dataset.cf)]); await redo('Confirmed and receipted.'); } catch (x) { await redo('', x.message); } });
    qs(el, '#rc-all')?.addEventListener('click', async () => { try { for (const r of results.filter((x) => x.result === 'match')) await confirm1(r); await redo('All matches confirmed and receipted.'); } catch (x) { await redo('', x.message); } });
    on(el, '[data-stu]', 'change', (e) => { const row = e.currentTarget.closest('[data-tx]'); const sel = qs(row, '[data-inv]'); sel.innerHTML = '<option value="">Auto-allocate</option>' + openInvoicesOf(e.currentTarget.value).map((i) => `<option value="${i.id}">${escapeHtml(i.number ?? '—')} · owes ${escapeHtml(money(d, figOf(d, i).outstanding))}</option>`).join(''); });
    el.querySelectorAll('[data-stu]').forEach((s) => s.value && s.dispatchEvent(new Event('change')));
    on(el, '[data-assign]', 'click', async (e) => { const row = e.currentTarget.closest('[data-tx]'); try { await B.assignTransaction(e.currentTarget.dataset.assign, { studentId: qs(row, '[data-stu]').value, invoiceId: qs(row, '[data-inv]').value, method: qs(row, '[data-m]').value }, 'Bursar'); await redo('Assigned. A confirmed payment and receipt were created.'); } catch (x) { await redo('', x.message); } });
    on(el, '[data-ignore]', 'click', async (e) => { const why = prompt('Why is this not a fee payment?'); if (!why) return; try { await B.ignoreTransaction(e.currentTarget.dataset.ignore, why, 'Bursar'); await redo('Marked as not a fee payment.'); } catch (x) { await redo('', x.message); } });
  }
  paint();
}

// ---------------------------------------------------------------- scholarships and sponsorships (part of Charges & discounts)
export function renderAwards(el, d, redo) {
  const canDecide = approver(d); const st = { studentId: '', type: 'scholarship', sponsor: '', kind: 'percent', value: '', validFrom: '', validTo: '' };
  const bal = L.sponsorBalances(d.invoices, d.sponsorPayments ?? []);
  const sp = { sponsor: '', amount: '', method: 'bank', reference: '' };
  el.innerHTML = `<section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">Scholarships and sponsorships</h3><p class="text-xs text-ink-500">Approved awards are applied automatically to the learner's next generated invoice. A sponsorship also builds up an amount to claim from the sponsor.</p>
    <div class="grid grid-2 lg-grid-4 gap-3"><div style="grid-column:span 2;"><label class="label">Learner</label><select class="input" data-a="studentId">${studentOptions(d)}</select></div><div><label class="label">Type</label><select class="input" data-a="type"><option value="scholarship">Scholarship</option><option value="sponsorship">Sponsorship</option></select></div><div><label class="label">Sponsor (sponsorship)</label><input class="input" data-a="sponsor" /></div>
      <div><label class="label">Kind</label><select class="input" data-a="kind"><option value="percent">Percent of fees</option><option value="amount">Fixed amount</option></select></div><div><label class="label">Value</label><input class="input" type="number" min="1" data-a="value" /></div><div><label class="label">From</label><input class="input" type="date" data-a="validFrom" /></div><div><label class="label">To</label><input class="input" type="date" data-a="validTo" /></div></div>
    <button class="btn-primary" id="aw-go">Submit for approval</button>
    ${table(['Learner', 'Type', 'Sponsor', 'Value', 'Valid', 'Status', ''], (d.awards ?? []).slice().reverse().map((a) => [escapeHtml(sName(d, a.studentId)), a.type, escapeHtml(a.sponsor ?? ''), a.kind === 'percent' ? `${a.value}%` : money(d, a.value), `${escapeHtml(a.validFrom ?? '…')} → ${escapeHtml(a.validTo ?? '…')}`, badge(TONE[a.status === 'approved' ? 'approved' : a.status === 'revoked' ? 'rejected' : 'pending'], a.status), `${a.status === 'pending' && canDecide ? `<button class="btn-primary btn-sm" data-aw="${a.id}:1">Approve</button> <button class="btn-secondary btn-sm" data-aw="${a.id}:0">Decline</button>` : ''}${a.status === 'approved' && canDecide ? `<button class="btn-ghost btn-sm" data-rev="${a.id}">Revoke</button>` : ''}`]))}
    <h4 class="text-sm" style="font-weight:600;">Owed by sponsors</h4>${table(['Sponsor', 'Claimed', 'Paid', 'Balance'], bal.map((b) => [escapeHtml(b.sponsor), money(d, b.claimed), money(d, b.paid), money(d, b.balance)]), [1, 2, 3])}
    <div class="grid grid-2 lg-grid-4 gap-3"><div><label class="label">Sponsor paid</label><input class="input" list="sp-list" data-s="sponsor" /><datalist id="sp-list">${bal.map((b) => `<option value="${escapeHtml(b.sponsor)}">`).join('')}</datalist></div><div><label class="label">Amount</label><input class="input" type="number" min="1" data-s="amount" /></div><div><label class="label">Method</label><select class="input" data-s="method">${METHODS.map(([k, l]) => `<option value="${k}" ${k === 'bank' ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div><label class="label">Reference</label><input class="input" data-s="reference" /></div></div><button class="btn-secondary" id="sp-go">Record sponsor payment</button>
    ${(d.sponsorPayments ?? []).filter((p) => p.status === 'pending_verification').map((p) => `<p class="text-sm" style="margin:.2rem 0;">${escapeHtml(p.sponsor)} · ${escapeHtml(money(d, p.amount))} · ref ${escapeHtml(p.reference ?? '')} ${badge('gold', 'pending verification')} <button class="btn-primary btn-sm" data-spc="${p.id}">Confirm</button></p>`).join('')}</section>`;
  on(el, '[data-a]', 'input', (e) => { st[e.currentTarget.dataset.a] = e.currentTarget.value; });
  on(el, '[data-s]', 'input', (e) => { sp[e.currentTarget.dataset.s] = e.currentTarget.value; });
  qs(el, '#aw-go').addEventListener('click', async () => { try { await B.saveAward({ ...st, validFrom: st.validFrom || undefined, validTo: st.validTo || undefined }, 'Bursar'); await redo('Award submitted for approval.'); } catch (e) { await redo('', e.message); } });
  on(el, '[data-aw]', 'click', async (e) => { const [id, ok] = e.currentTarget.dataset.aw.split(':'); try { await B.decideAward(id, ok === '1', 'Approver'); await redo(ok === '1' ? 'Approved.' : 'Declined.'); } catch (x) { await redo('', x.message); } });
  on(el, '[data-rev]', 'click', async (e) => { if (confirm('Revoke this award? Future invoices will no longer include it.')) { await B.revokeAward(e.currentTarget.dataset.rev, 'Approver'); await redo('Revoked.'); } });
  qs(el, '#sp-go').addEventListener('click', async () => { try { await B.recordSponsorPayment(sp); await redo('Sponsor payment recorded.'); } catch (e) { await redo('', e.message); } });
  on(el, '[data-spc]', 'click', async (e) => { const n = prompt('How did you confirm it?'); if (!n) return; try { await B.confirmSponsorPayment(e.currentTarget.dataset.spc, n); await redo('Confirmed.'); } catch (x) { await redo('', x.message); } });
}

// ---------------------------------------------------------------- payment rules (part of SwiftIQ Pay)
export function renderRules(el, d, redo) {
  const r = L.rulesFrom(d.settings);
  el.innerHTML = `<section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">Payment rules</h3><div class="grid grid-2 lg-grid-4 gap-3">
    <div><label class="label">Overpaying an invoice</label><select class="input" id="pr-over"><option value="no" ${r.allowOverpayment ? '' : 'selected'}>Not allowed</option><option value="yes" ${r.allowOverpayment ? 'selected' : ''}>Allowed (kept as credit)</option></select></div>
    <div><label class="label">Most installments</label><input class="input" type="number" min="2" max="24" id="pr-max" value="${r.maxInstallments}" /></div><div><label class="label">Smallest installment (${d.currency})</label><input class="input" type="number" min="0" id="pr-min" value="${r.minInstallment}" /></div></div>
    <p class="text-xs text-ink-500">Unallocated payments are spread over a learner's invoices oldest-due first.</p><button class="btn-primary" id="pr-save">Save rules</button></section>`;
  qs(el, '#pr-save').addEventListener('click', async () => { await B.savePaymentRules({ allowOverpayment: qs(el, '#pr-over').value === 'yes', maxInstallments: Math.max(2, num(qs(el, '#pr-max').value)), minInstallment: Math.max(0, num(qs(el, '#pr-min').value)) }); await redo('Payment rules saved.'); });
}

// ---------------------------------------------------------------- allocating a payment to invoices (part of Payments & receipts)
export function renderAllocator(el, d, redo) {
  const loose = d.payments.filter((p) => L.isConfirmed(p) && !p.invoiceId && !(p.allocations ?? []).length);
  if (!loose.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">Payments not yet applied to an invoice (${loose.length})</h3>${loose.map((p) => {
    const open = d.invoices.filter((i) => i.studentId === p.studentId && i.status !== 'void').map((i) => ({ ...i, outstanding: L.invoiceFigures(i, d.payments.filter((x) => x.id !== p.id), today(), credits(d)).outstanding })).filter((i) => i.outstanding > 0);
    const auto = L.autoAllocate(p.amount, open);
    return `<div class="space-y-2" data-pay="${p.id}" style="border-top:1px solid var(--ink-100);padding-top:.6rem;"><strong>${escapeHtml(sName(d, p.studentId))}</strong> · ${escapeHtml(money(d, p.amount))} · ${escapeHtml(p.date)} ${p.reference ? `· ${escapeHtml(p.reference)}` : ''}
      ${open.length ? open.map((i) => `<div class="flex flex-wrap items-center gap-2 text-sm"><span style="min-width:14rem;">${escapeHtml(i.number ?? '—')} · owes ${escapeHtml(money(d, i.outstanding))}</span><input class="input" type="number" min="0" data-part="${i.id}" value="${auto.allocations.find((a) => a.invoiceId === i.id)?.amount ?? 0}" style="max-width:9rem;" /></div>`).join('') + (auto.remainder ? `<p class="text-xs text-ink-500">${escapeHtml(money(d, auto.remainder))} would stay as credit on the learner's account.</p>` : '') + '<button class="btn-primary btn-sm" data-save-alloc>Apply to invoices</button>' : '<p class="text-sm text-ink-500">This learner has no unpaid invoices, so the money stays as credit.</p>'}</div>`; }).join('')}</section>`;
  on(el, '[data-save-alloc]', 'click', async (e) => { const row = e.currentTarget.closest('[data-pay]'); const parts = [...row.querySelectorAll('[data-part]')].map((i) => ({ invoiceId: i.dataset.part, amount: num(i.value) })).filter((x) => x.amount > 0); try { await B.allocatePayment(row.dataset.pay, parts, 'Bursar'); await redo('Payment applied to the invoices.'); } catch (x) { await redo('', x.message); } });
}

export const PHASE3_VIEWS = { statements, plans, credits: creditNotes, cashbook, faudit: financeAuditTab };
