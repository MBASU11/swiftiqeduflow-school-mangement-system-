// Bursar Pack screens. They plug into the existing Finance module as extra tabs, only for
// features the school's package includes. Money rules live in services/bursarLogic.js.
import { escapeHtml, on, qs } from '../../components/dom.js';
import { printHtml } from '../../components/printWindow.js';
import { fullName } from '../../services/studentService.js';
import { isAdmin } from '../../services/accessService.js';
import { featureEnabled } from '../../services/subscriptionService.js';
import * as L from '../../services/bursarLogic.js';
import * as B from '../../services/bursarService.js';

import { today, money, METHODS, methodLabel, sName, badge, TONE as stTone, download, errBox } from './bursarUi.js';
import { PHASE3_TABS, PHASE3_VIEWS, dashboard, reconcile, renderAwards, renderRules, renderAllocator } from './bursarTabs2.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { uuid } from '../../lib/uuid.js';

export const BURSAR_TABS = [
  ['bursar', 'Bursar dashboard', () => featureEnabled('invoice_generation') || featureEnabled('automated_receipting') || featureEnabled('refund_management')],
  ['invoices', 'Invoices', () => featureEnabled('invoice_generation')],
  ['payments', 'Payments & receipts', () => featureEnabled('automated_receipting')],
  ['reminders', 'Fee reminders', () => featureEnabled('fee_reminders')],
  ['refunds', 'Refunds', () => featureEnabled('refund_management')],
  ['charges', 'Charges & discounts', () => featureEnabled('optional_charges') || featureEnabled('sibling_discounts')],
  ['reconcile', 'Reconciliation', () => featureEnabled('payment_reconciliation')],
  ['pay', 'SwiftIQ Pay', () => featureEnabled('swiftiq_pay')],
  ['breports', 'Bursar reports', () => featureEnabled('advanced_financial_reports')],
  // Phase Three screens: demo mode until the backend phase adds their cloud tables.
  ...PHASE3_TABS.map(([k, l, on]) => [k, l, () => !isSupabaseConfigured() && on()]),
];

export async function renderBursarTab(tab, body, { initialAction = null } = {}) {
  const ctx = { flash: '', error: '' };
  let nextAction = initialAction;
  const view = { bursar: dashboard, invoices, payments, reminders, refunds, charges, reconcile, pay, breports, ...PHASE3_VIEWS }[tab];
  if (!view) {
    body.innerHTML = errBox(new Error('This Finance screen is not available in the current version.'));
    return;
  }
  async function draw() {
    body.innerHTML = '<p class="text-sm text-ink-500">Loading…</p>';
    try {
      const d = await B.loadBursar();
      body.innerHTML = `${ctx.flash ? `<div class="notice" role="status"><span>${escapeHtml(ctx.flash)}</span></div>` : ''}${ctx.error ? errBox(ctx.error) : ''}<div id="bt"></div>`;
      ctx.flash = ''; ctx.error = '';
      const action = nextAction;
      nextAction = null;
      await view(qs(body, '#bt'), d, { initialAction: action, redo: (flash, error) => { ctx.flash = flash ?? ''; ctx.error = error ?? ''; return draw(); } });
    } catch (e) { body.innerHTML = errBox(e); }
  }
  return draw();
}

// ---------------------------------------------------------------- documents
const payHelp = (d) => d.settings.pay.providers.filter((p) => p.enabled).map((p) => `<p style="margin:.15rem 0;"><strong>${escapeHtml(p.name)}</strong>${p.shortcode ? ` · ${escapeHtml(p.shortcode)}` : ''}${p.instructions ? ` — ${escapeHtml(p.instructions)}` : ''}</p>`).join('');
function invoiceDoc(d, inv) {
  const st = d.studentById[inv.studentId]; const f = L.invoiceFigures(inv, d.payments, today(), d.creditNotes ?? []);
  return `<div style="font-family:Arial,sans-serif;"><h2>${escapeHtml(d.school.name ?? 'School')}</h2><h3>INVOICE ${escapeHtml(inv.number ?? '')}</h3>
    <p>Student: <strong>${escapeHtml(st ? fullName(st) : '')}</strong> (${escapeHtml(st?.admissionNumber ?? '')}) · ${escapeHtml(d.classById[st?.classId]?.name ?? '')} · ${escapeHtml(d.termById[inv.termId]?.name ?? '')}<br>Issued ${escapeHtml(inv.issueDate ?? String(inv.createdAt).slice(0, 10))} · Due ${escapeHtml(inv.dueDate ?? 'on receipt')} · Status ${escapeHtml(f.status)}</p>
    <table style="width:100%;border-collapse:collapse;"><thead><tr><th style="text-align:left;border-bottom:1px solid #999;">Item</th><th style="text-align:right;border-bottom:1px solid #999;">Amount</th></tr></thead><tbody>${inv.items.map((i) => `<tr><td>${escapeHtml(i.name)}</td><td style="text-align:right;">${Number(i.amount) < 0 ? '−' : ''}${escapeHtml(money(d, Math.abs(i.amount)))}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td><strong>Total</strong></td><td style="text-align:right;"><strong>${escapeHtml(money(d, f.billed))}</strong></td></tr><tr><td>Paid (confirmed)</td><td style="text-align:right;">${escapeHtml(money(d, f.paid))}</td></tr><tr><td><strong>Balance</strong></td><td style="text-align:right;"><strong>${escapeHtml(money(d, f.outstanding))}</strong></td></tr></tfoot></table>
    <div style="margin-top:1rem;font-size:.9em;">${payHelp(d) ? `<p><strong>How to pay</strong></p>${payHelp(d).replaceAll('{admission}', escapeHtml(st?.admissionNumber ?? ''))}` : ''}</div></div>`;
}
const receiptDoc = (d, r) => `<div style="font-family:Arial,sans-serif;max-width:420px;"><h2>${escapeHtml(d.school.name ?? 'School')}</h2><h3>RECEIPT ${escapeHtml(r.number)}</h3><p>Received from the family of <strong>${escapeHtml(sName(d, r.studentId))}</strong><br>Amount <strong>${escapeHtml(money(d, r.amount))}</strong> · ${escapeHtml(methodLabel(r.method))}${r.reference ? ` · Ref ${escapeHtml(r.reference)}` : ''}<br>Date ${escapeHtml(r.date)}${r.invoiceId ? ` · Invoice ${escapeHtml(d.invoices.find((i) => i.id === r.invoiceId)?.number ?? '')}` : ''}</p><p style="font-size:.8em;">Issued for a confirmed payment.</p></div>`;

// ---------------------------------------------------------------- invoices
async function invoices(el, d, { redo, initialAction }) {
  const bulk = featureEnabled('bulk_invoicing');
  const st = { q: '', classId: '', termId: '', status: '', gen: initialAction === 'generate', scope: { mode: bulk ? 'classes' : 'students', classIds: [], streamIds: [], studentIds: [], groups: [] }, structureId: '', genTerm: d.terms.find((t) => t.isCurrent)?.id ?? '', due: '', includeOptional: true, includeTransport: featureEnabled('transport_billing'), applySibling: featureEnabled('sibling_discounts'), preview: null, invoiceEdit: null };
  function paint() {
    const rows = d.invoices.filter((i) => {
      const s = d.studentById[i.studentId]; const f = L.invoiceFigures(i, d.payments, today(), d.creditNotes ?? []);
      return (!st.classId || s?.classId === st.classId) && (!st.termId || i.termId === st.termId) && (!st.status || (st.status === 'overdue' ? f.overdue : f.status === st.status)) && (!st.q || `${i.number} ${s ? fullName(s) : ''} ${s?.admissionNumber ?? ''}`.toLowerCase().includes(st.q.toLowerCase()));
    });
    el.innerHTML = `<div class="space-y-4">
      <div class="flex flex-wrap gap-2 items-end no-print">
        <input class="input" id="f-q" placeholder="Search number, name, admission no." value="${escapeHtml(st.q)}" style="max-width:15rem;" />
        <select class="input" id="f-class" style="max-width:10rem;"><option value="">All classes</option>${d.classes.map((c) => `<option value="${c.id}" ${st.classId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
        <select class="input" id="f-term" style="max-width:10rem;"><option value="">All terms</option>${d.terms.map((t) => `<option value="${t.id}" ${st.termId === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}</select>
        <select class="input" id="f-status" style="max-width:10rem;"><option value="">Any status</option>${['unpaid', 'partial', 'paid', 'overdue', 'void'].map((s) => `<option ${st.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <button class="btn-primary" id="gen-open">Generate invoices</button><button class="btn-secondary" id="inv-csv">Export CSV</button></div>
      ${st.gen ? genPanel() : ''}
      ${invoiceEditPanel()}
      <div class="notice" role="status"><span>Invoice numbers are permanent. Correct eligible unpaid invoices with Edit; invoices are voided, never hard-deleted. Payments or credit notes lock invoice corrections.</span></div>
      <div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Number</th><th>Student</th><th>Term</th><th>Due</th><th class="text-right">Billed</th><th class="text-right">Paid</th><th class="text-right">Balance</th><th>Status</th><th></th></tr></thead><tbody>${rows.slice(0, 300).map((i) => { const f = L.invoiceFigures(i, d.payments, today(), d.creditNotes ?? []); const hasPayment = d.payments.some((p) => p.status !== 'rejected' && (p.invoiceId === i.id || (p.allocations ?? []).some((part) => part.invoiceId === i.id))); const hasCredit = d.creditNotes.some((credit) => credit.invoiceId === i.id); const canCorrect = i.status !== 'void' && !hasPayment; return `<tr><td>${escapeHtml(i.number ?? '—')}</td><td>${escapeHtml(sName(d, i.studentId))}</td><td>${escapeHtml(d.termById[i.termId]?.name ?? '—')}</td><td>${escapeHtml(i.dueDate ?? '—')}</td><td class="text-right">${escapeHtml(money(d, f.billed))}</td><td class="text-right">${escapeHtml(money(d, f.paid))}</td><td class="text-right">${escapeHtml(money(d, f.outstanding))}${f.overpaid ? ` <span class="text-xs">(+${escapeHtml(money(d, f.overpaid))} over)</span>` : ''}</td><td>${badge(stTone[f.status], f.status)}${f.overdue ? ' ' + badge('bad', 'overdue') : ''}</td><td><button class="btn-ghost btn-sm" data-print="${i.id}">Print</button>${canCorrect && !hasCredit ? `<button class="btn-ghost btn-sm" data-write-collection="invoices" data-edit-invoice="${i.id}">Edit</button>` : ''}${canCorrect ? `<button class="btn-ghost btn-sm" data-write-collection="invoices" data-void="${i.id}">Void</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="9" class="text-sm text-ink-500">No invoices match.</td></tr>'}</tbody></table></div></div>`;
    wire(rows);
  }
  function genPanel() {
    const sc = st.scope; const chk = (arr, id) => (arr.includes(id) ? 'checked' : '');
    return `<section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">Generate invoices</h3>
      ${d.feeStructures.length ? '' : '<div class="notice" role="status"><span>Create a fee structure in the Fee Structures section before generating invoices for a group of students. For a one-off invoice, use Student Accounts.</span></div>'}
      <div class="grid grid-2 lg-grid-4 gap-3">
        <div><label class="label">Fee structure</label><select class="input" id="g-struct"><option value="">Choose…</option>${d.feeStructures.map((f) => `<option value="${f.id}" ${st.structureId === f.id ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('')}</select></div>
        <div><label class="label">Term</label><select class="input" id="g-term"><option value="">—</option>${d.terms.map((t) => `<option value="${t.id}" ${st.genTerm === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}</select></div>
        <div><label class="label">Due date</label><input class="input" type="date" id="g-due" value="${st.due}" /></div>
        <div><label class="label">Bill</label><select class="input" id="g-mode">${[['students', 'Individual students'], ...(bulk ? [['all', 'Whole school'], ['classes', 'Selected classes'], ['streams', 'Selected streams'], ['groups', 'Student groups']] : [])].map(([k, l]) => `<option value="${k}" ${sc.mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      ${sc.mode === 'classes' ? `<div class="flex flex-wrap gap-3">${d.classes.map((c) => `<label class="text-sm"><input type="checkbox" data-sc="classIds:${c.id}" ${chk(sc.classIds, c.id)} /> ${escapeHtml(c.name)}</label>`).join('')}</div>` : ''}
      ${sc.mode === 'streams' ? `<div class="flex flex-wrap gap-3">${d.streams.map((s) => `<label class="text-sm"><input type="checkbox" data-sc="streamIds:${s.id}" ${chk(sc.streamIds, s.id)} /> ${escapeHtml(d.classById[s.classId]?.name ?? '')} ${escapeHtml(s.name)}</label>`).join('')}</div>` : ''}
      ${sc.mode === 'groups' ? `<div class="flex flex-wrap gap-3">${[['boarders', 'Boarders'], ['day', 'Day scholars'], ['transport', 'Transport users']].map(([k, l]) => `<label class="text-sm"><input type="checkbox" data-sc="groups:${k}" ${chk(sc.groups, k)} /> ${l}</label>`).join('')}</div>` : ''}
      ${sc.mode === 'students' ? `<select class="input" id="g-students" multiple size="6">${d.students.map((s) => `<option value="${s.id}" ${chk(sc.studentIds, s.id)}>${escapeHtml(fullName(s))} (${escapeHtml(s.admissionNumber)})</option>`).join('')}</select>` : ''}
      <div class="flex flex-wrap gap-4">${featureEnabled('optional_charges') ? `<label class="text-sm"><input type="checkbox" id="g-opt" ${st.includeOptional ? 'checked' : ''} /> Include selected optional charges</label>` : ''}${featureEnabled('transport_billing') ? `<label class="text-sm"><input type="checkbox" id="g-tr" ${st.includeTransport ? 'checked' : ''} /> Include transport fee</label>` : ''}${featureEnabled('sibling_discounts') ? `<label class="text-sm"><input type="checkbox" id="g-sib" ${st.applySibling ? 'checked' : ''} /> Apply sibling discount policy</label>` : ''}</div>
      <div class="flex gap-2"><button class="btn-secondary" id="g-preview">Preview</button>${st.preview ? `<button class="btn-primary" id="g-create">Create ${st.preview.filter((r) => !r.skipped).length} invoice(s)</button>` : ''}</div>
      ${st.preview ? `<div class="overflow-x-auto"><table class="data-table"><thead><tr><th>Student</th><th>Items</th><th class="text-right">Total</th></tr></thead><tbody>${st.preview.slice(0, 200).map((r) => `<tr><td>${escapeHtml(fullName(r.student))}</td><td class="text-sm">${r.skipped ? `<em>${escapeHtml(r.skipped)}</em>` : r.items.map((i) => escapeHtml(i.name)).join(', ') + (r.pendingApprovals.length ? ' · ' + badge('gold', 'discount awaiting approval') : '')}</td><td class="text-right">${r.skipped ? '—' : escapeHtml(money(d, r.total))}</td></tr>`).join('')}</tbody></table></div>` : ''}</section>`;
  }
  function invoiceEditPanel() {
    const draft = st.invoiceEdit;
    if (!draft) return '';
    return `<section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">Correct invoice ${escapeHtml(draft.number)}</h3>
      <div><label class="label">Due date</label><input class="input" type="date" id="ie-due" value="${escapeHtml(draft.dueDate)}" /></div>
      <div class="space-y-2">${draft.items.map((item) => `<div class="flex gap-2"><input class="input flex-1" data-ie-name="${item.tempId}" value="${escapeHtml(item.name)}" aria-label="Invoice line name" /><input class="input" type="number" step="0.01" data-ie-amount="${item.tempId}" value="${escapeHtml(item.amount)}" aria-label="Invoice line amount" />${draft.items.length > 1 ? `<button class="btn-ghost" data-ie-remove="${item.tempId}">Remove</button>` : ''}</div>`).join('')}</div>
      <button class="btn-secondary btn-sm" id="ie-add">+ Add line</button>
      <div><label class="label">Correction reason (required)</label><input class="input" id="ie-reason" value="${escapeHtml(draft.reason)}" /></div>
      <div class="flex justify-end gap-2"><button class="btn-secondary" id="ie-cancel">Cancel</button><button class="btn-primary" data-write-collection="invoices" id="ie-save">Save correction</button></div>
    </section>`;
  }
  function wire(rows) {
    const rerun = () => paint();
    qs(el, '#f-q').addEventListener('input', (e) => { st.q = e.target.value; const pos = e.target.selectionStart; rerun(); const n = qs(el, '#f-q'); n.focus(); n.setSelectionRange(pos, pos); });
    [['#f-class', 'classId'], ['#f-term', 'termId'], ['#f-status', 'status']].forEach(([sel, k]) => qs(el, sel).addEventListener('change', (e) => { st[k] = e.target.value; rerun(); }));
    qs(el, '#gen-open').addEventListener('click', () => { st.gen = !st.gen; st.preview = null; rerun(); });
    qs(el, '#inv-csv').addEventListener('click', () => download('invoices.csv', L.toCsv([['Number', 'Admission', 'Student', 'Term', 'Due', 'Billed', 'Paid', 'Outstanding', 'Status'], ...rows.map((i) => { const f = L.invoiceFigures(i, d.payments, today(), d.creditNotes ?? []); return [i.number, d.studentById[i.studentId]?.admissionNumber, sName(d, i.studentId), d.termById[i.termId]?.name, i.dueDate, f.billed, f.paid, f.outstanding, f.status]; })])));
    on(el, '[data-print]', 'click', (e) => { const inv = d.invoices.find((i) => i.id === e.currentTarget.dataset.print); printHtml(`Invoice ${inv.number ?? ''}`, invoiceDoc(d, inv)); });
    on(el, '[data-edit-invoice]', 'click', (e) => {
      const inv = d.invoices.find((item) => item.id === e.currentTarget.dataset.editInvoice);
      if (!inv) return;
      st.invoiceEdit = { id: inv.id, number: inv.number ?? '', dueDate: inv.dueDate ?? '', reason: '', items: inv.items.map((item) => ({ ...item, tempId: uuid() })) };
      paint();
    });
    on(el, '[data-void]', 'click', async (e) => { const r = prompt('Reason for voiding this invoice:'); if (!r) return; try { await B.voidInvoice(e.currentTarget.dataset.void, r); await redo('Invoice voided.'); } catch (x) { await redo('', x.message); } });
    if (st.invoiceEdit) {
      const draft = st.invoiceEdit;
      qs(el, '#ie-due').addEventListener('input', (e) => { draft.dueDate = e.target.value; });
      qs(el, '#ie-reason').addEventListener('input', (e) => { draft.reason = e.target.value; });
      on(el, '[data-ie-name]', 'input', (e) => { const item = draft.items.find((line) => line.tempId === e.currentTarget.dataset.ieName); if (item) item.name = e.target.value; });
      on(el, '[data-ie-amount]', 'input', (e) => { const item = draft.items.find((line) => line.tempId === e.currentTarget.dataset.ieAmount); if (item) item.amount = e.target.value; });
      on(el, '[data-ie-remove]', 'click', (e) => { draft.items = draft.items.filter((line) => line.tempId !== e.currentTarget.dataset.ieRemove); paint(); });
      qs(el, '#ie-add').addEventListener('click', () => { draft.items.push({ tempId: uuid(), name: '', amount: '' }); paint(); });
      qs(el, '#ie-cancel').addEventListener('click', () => { st.invoiceEdit = null; paint(); });
      qs(el, '#ie-save').addEventListener('click', async () => {
        try {
          await B.correctInvoice(draft.id, {
            dueDate: draft.dueDate,
            items: draft.items.map(({ tempId, ...item }) => ({ ...item, amount: Number(item.amount) })),
          }, draft.reason);
          st.invoiceEdit = null;
          await redo('Invoice corrected. Its original number and correction history were retained.');
        } catch (error) {
          await redo('', error.message);
        }
      });
    }
    if (!st.gen) return;
    const bind = (sel, fn, ev = 'change') => qs(el, sel)?.addEventListener(ev, fn);
    bind('#g-struct', (e) => { st.structureId = e.target.value; st.preview = null; });
    bind('#g-term', (e) => { st.genTerm = e.target.value; st.preview = null; }); bind('#g-due', (e) => { st.due = e.target.value; });
    bind('#g-mode', (e) => { st.scope.mode = e.target.value; st.preview = null; paint(); });
    bind('#g-opt', (e) => { st.includeOptional = e.target.checked; st.preview = null; }); bind('#g-tr', (e) => { st.includeTransport = e.target.checked; st.preview = null; }); bind('#g-sib', (e) => { st.applySibling = e.target.checked; st.preview = null; });
    bind('#g-students', (e) => { st.scope.studentIds = [...e.target.selectedOptions].map((o) => o.value); st.preview = null; });
    on(el, '[data-sc]', 'change', (e) => { const [k, v] = e.currentTarget.dataset.sc.split(':'); st.scope[k] = e.currentTarget.checked ? [...new Set([...st.scope[k], v])] : st.scope[k].filter((x) => x !== v); st.preview = null; });
    const opts = () => ({ scope: st.scope, structureId: st.structureId, termId: st.genTerm, dueDate: st.due, includeOptional: st.includeOptional, includeTransport: st.includeTransport, applySibling: st.applySibling, data: d });
    bind('#g-preview', async () => { try { st.preview = await B.previewInvoices(opts()); if (!st.preview.length) throw new Error('No students match that selection.'); paint(); } catch (x) { await redo('', x.message); } }, 'click');
    bind('#g-create', async () => {
      try { const r = await B.generateInvoices(opts()); await redo(`Created ${r.created.length} invoice(s)${r.skipped.length ? `, skipped ${r.skipped.length} already invoiced` : ''}${r.approvals.length ? `; ${r.approvals.length} discount(s) await approval in Charges & discounts` : ''}.`); } catch (x) { await redo('', x.message); }
    }, 'click');
  }
  paint();
}

// ---------------------------------------------------------------- payments & receipts
async function paymentsBase(el, d, { redo, initialAction }) {
  const st = { status: '', q: '', form: initialAction === 'record', paymentEdit: null };
  const open = d.invoices.filter((i) => L.invoiceFigures(i, d.payments, today(), d.creditNotes ?? []).outstanding > 0 && i.status !== 'void');
  function paint() {
    const rows = d.payments.filter((p) => (st.status === 'archived' ? Boolean(p.archivedAt) : !p.archivedAt && (!st.status || (p.status ?? 'confirmed') === st.status)) && (!st.q || `${sName(d, p.studentId)} ${p.reference ?? ''}`.toLowerCase().includes(st.q.toLowerCase())));
    const rcpt = Object.fromEntries(d.receipts.map((r) => [r.paymentId, r]));
    el.innerHTML = `<div class="space-y-4"><div class="notice"><span>Cash is receipted at once. M-Pesa, bank, cheque and SwiftIQ Pay payments stay <strong>pending</strong> until you confirm them against a statement — they never reduce a balance before that. Confirmed payments and receipts are immutable; use Refunds to correct a completed transaction. Pending/rejected records can be corrected or archived safely.</span></div>
      <div class="flex flex-wrap gap-2 no-print"><input class="input" id="p-q" placeholder="Search student or reference" value="${escapeHtml(st.q)}" style="max-width:15rem;" /><select class="input" id="p-st" style="max-width:12rem;"><option value="">All statuses</option>${Object.entries(L.PAYMENT_STATUS).map(([k, l]) => `<option value="${k}" ${st.status === k ? 'selected' : ''}>${l}</option>`).join('')}<option value="archived" ${st.status === 'archived' ? 'selected' : ''}>Archived</option></select><button class="btn-primary" id="p-new">Record payment</button></div>
      ${st.form ? (open.length
        ? `<section class="card card-p space-y-3"><div class="grid grid-2 lg-grid-4 gap-3"><div><label class="label">Invoice</label><select class="input" id="np-inv">${open.map((i) => `<option value="${i.id}">${escapeHtml(i.number ?? '—')} · ${escapeHtml(sName(d, i.studentId))} · bal ${escapeHtml(money(d, L.invoiceFigures(i, d.payments, today(), d.creditNotes ?? []).outstanding))}</option>`).join('')}</select></div>
          <div><label class="label">Amount</label><input class="input" type="number" min="1" id="np-amt" /></div><div><label class="label">Method</label><select class="input" id="np-m">${METHODS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div><div><label class="label">Reference</label><input class="input" id="np-ref" /></div></div><button class="btn-primary" id="np-save">Save payment</button></section>`
        : '<div class="notice" role="status"><span>There are no unpaid invoices to receive payment against. Create an invoice first, then record its payment.</span></div>') : ''}
      ${paymentEditPanel()}
      <div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Date</th><th>Student</th><th>Method</th><th>Reference</th><th>Status</th><th>Receipt</th><th class="text-right">Amount</th><th></th></tr></thead><tbody>${rows.slice(0, 300).map((p) => { const s = p.archivedAt ? 'archived' : (p.status ?? 'confirmed'); const r = rcpt[p.id]; return `<tr><td>${escapeHtml(p.date)}</td><td>${escapeHtml(sName(d, p.studentId))}</td><td>${escapeHtml(methodLabel(p.method))}</td><td>${escapeHtml(p.reference ?? '—')}</td><td>${p.archivedAt ? badge('muted', `Archived (${L.PAYMENT_STATUS[p.archivedFromStatus] ?? 'unconfirmed'})`) : badge(stTone[s], L.PAYMENT_STATUS[s])}</td><td>${r ? `<button class="btn-ghost btn-sm" data-rc="${r.id}">${escapeHtml(r.number)}</button>` : '—'}</td><td class="text-right">${escapeHtml(money(d, p.amount))}</td><td>${s === 'pending_verification' ? `<button class="btn-ghost btn-sm" data-write-collection="payments" data-edit-payment="${p.id}">Edit</button> <button class="btn-primary btn-sm" data-write-collection="payments" data-ok="${p.id}">Confirm</button> <button class="btn-secondary btn-sm" data-write-collection="payments" data-no="${p.id}">Reject</button> <button class="btn-ghost btn-sm" data-write-collection="payments" data-archive-payment="${p.id}">Remove</button>` : ['rejected'].includes(s) ? `<button class="btn-ghost btn-sm" data-write-collection="payments" data-archive-payment="${p.id}">Remove</button>` : p.archivedAt ? 'Retained for audit' : featureEnabled('refund_management') ? `<button class="btn-secondary btn-sm" data-write-collection="refunds" data-refund-payment="${p.id}">Request refund</button>` : 'Confirmed — correction requires refund/reversal'}</td></tr>`; }).join('') || '<tr><td colspan="8" class="text-sm text-ink-500">No payments.</td></tr>'}</tbody></table></div></div>`;
    qs(el, '#p-q').addEventListener('input', (e) => { st.q = e.target.value; const pos = e.target.selectionStart; paint(); const n = qs(el, '#p-q'); n.focus(); n.setSelectionRange(pos, pos); });
    qs(el, '#p-st').addEventListener('change', (e) => { st.status = e.target.value; paint(); });
    qs(el, '#p-new').addEventListener('click', () => { st.form = !st.form; paint(); });
    on(el, '[data-edit-payment]', 'click', (e) => {
      const payment = d.payments.find((item) => item.id === e.currentTarget.dataset.editPayment);
      if (!payment) return;
      st.paymentEdit = { id: payment.id, amount: String(payment.amount), method: payment.method, reference: payment.reference ?? '', date: payment.date, reason: '' };
      paint();
    });
    on(el, '[data-rc]', 'click', (e) => printHtml('Receipt', receiptDoc(d, d.receipts.find((r) => r.id === e.currentTarget.dataset.rc))));
    on(el, '[data-ok]', 'click', async (e) => { const n = prompt('How did you confirm it? (e.g. "Seen on M-Pesa statement")'); if (!n) return; try { await B.confirmPayment(e.currentTarget.dataset.ok, n); await redo('Payment confirmed and receipted.'); } catch (x) { await redo('', x.message); } });
    on(el, '[data-no]', 'click', async (e) => { const n = prompt('Why is this payment rejected?'); if (!n) return; try { await B.rejectPayment(e.currentTarget.dataset.no, n); await redo('Payment rejected.'); } catch (x) { await redo('', x.message); } });
    on(el, '[data-archive-payment]', 'click', async (e) => { const note = prompt('Reason for removing this unconfirmed payment from the active list:'); if (!note) return; try { await B.archivePayment(e.currentTarget.dataset.archivePayment, note); await redo('Payment archived. Its history is retained and balances are unchanged.'); } catch (x) { await redo('', x.message); } });
    on(el, '[data-refund-payment]', 'click', async (e) => {
      const payment = d.payments.find((item) => item.id === e.currentTarget.dataset.refundPayment);
      if (!payment) return;
      const amount = prompt(`Refund amount (up to ${money(d, payment.amount)}):`, String(payment.amount));
      if (!amount) return;
      const reason = prompt('Reason for requesting this refund:');
      if (!reason) return;
      try {
        await B.requestRefund({ studentId: payment.studentId, amount, reason, paymentId: payment.id, invoiceId: payment.invoiceId });
        await redo('Refund request created. The confirmed payment and receipt remain unchanged until the refund is paid out.');
      } catch (error) {
        await redo('', error.message);
      }
    });
    if (st.paymentEdit) {
      const draft = st.paymentEdit;
      [['#pe-amount', 'amount'], ['#pe-method', 'method'], ['#pe-reference', 'reference'], ['#pe-date', 'date'], ['#pe-reason', 'reason']].forEach(([selector, key]) => qs(el, selector).addEventListener('input', (e) => { draft[key] = e.target.value; }));
      qs(el, '#pe-method').addEventListener('change', (e) => { draft.method = e.target.value; });
      qs(el, '#pe-cancel').addEventListener('click', () => { st.paymentEdit = null; paint(); });
      qs(el, '#pe-save').addEventListener('click', async () => {
        try {
          await B.correctPayment(draft.id, draft, draft.reason);
          st.paymentEdit = null;
          await redo('Pending payment corrected. It remains pending verification and has no receipt.');
        } catch (error) {
          await redo('', error.message);
        }
      });
    }
    qs(el, '#np-save')?.addEventListener('click', async () => {
      const inv = d.invoices.find((i) => i.id === qs(el, '#np-inv').value);
      if (!inv) { await redo('', 'Choose an unpaid invoice before recording a payment.'); return; }
      try { const saved = await B.submitPayment({ studentId: inv.studentId, invoiceId: inv.id, amount: qs(el, '#np-amt').value, method: qs(el, '#np-m').value, reference: qs(el, '#np-ref').value, date: today() }); await redo((saved?.status ?? 'confirmed') === 'pending_verification' ? 'Saved as pending verification.' : 'Payment recorded and receipted.'); } catch (x) { await redo('', x.message); }
    });
  }
  function paymentEditPanel() {
    const draft = st.paymentEdit;
    if (!draft) return '';
    return `<section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">Correct pending payment</h3>
      <div class="grid grid-2 lg-grid-4 gap-3"><div><label class="label">Amount</label><input class="input" type="number" min="0.01" step="0.01" id="pe-amount" value="${escapeHtml(draft.amount)}" /></div>
      <div><label class="label">Method</label><select class="input" id="pe-method">${METHODS.map(([key, label]) => `<option value="${key}" ${draft.method === key ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></div>
      <div><label class="label">Reference</label><input class="input" id="pe-reference" value="${escapeHtml(draft.reference)}" /></div>
      <div><label class="label">Date</label><input class="input" type="date" id="pe-date" value="${escapeHtml(draft.date)}" /></div></div>
      <div><label class="label">Correction reason (required)</label><input class="input" id="pe-reason" value="${escapeHtml(draft.reason)}" /></div>
      <div class="flex justify-end gap-2"><button class="btn-secondary" id="pe-cancel">Cancel</button><button class="btn-primary" data-write-collection="payments" id="pe-save">Save correction</button></div></section>`;
  }
  paint();
}

// ---------------------------------------------------------------- reminders
async function reminders(el, d, { redo }) {
  const cfg = d.settings.reminders;
  const parseSched = (t) => t.split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const [when, days] = x.split(':'); return { when, days: Number(days) || 0 }; }).filter((s) => ['before', 'on', 'after'].includes(s.when));
  el.innerHTML = `<div class="space-y-4"><div class="notice"><span>Reminders are <strong>queued</strong>, not sent. No SMS, email or WhatsApp provider is connected, so nothing is shown as delivered. Use the buttons to open the message in your phone or mail app.</span></div>
    <section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">Schedule</h3>
      <label class="text-sm"><input type="checkbox" id="r-on" ${cfg.enabled ? 'checked' : ''} /> Fee reminders enabled</label>
      <div><label class="label">Schedule (before:7, on:0, after:7 — days relative to the due date)</label><input class="input" id="r-sched" value="${escapeHtml(cfg.schedule.map((s) => `${s.when}:${s.days}`).join(', '))}" /></div>
      <div class="flex gap-4">${['sms', 'email', 'whatsapp'].map((c) => `<label class="text-sm"><input type="checkbox" data-ch="${c}" ${cfg.channels.includes(c) ? 'checked' : ''} /> ${c.toUpperCase()}</label>`).join('')}</div>
      <div><label class="label">Message ({parent} {student} {amount} {invoice} {due} {school})</label><textarea class="input" id="r-tpl" rows="3">${escapeHtml(cfg.template)}</textarea></div>
      <div class="flex gap-2"><button class="btn-primary" id="r-save">Save schedule</button><button class="btn-secondary" id="r-gen">Create due reminders now</button></div></section>
    <div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Student</th><th>Stage</th><th>Message</th><th>Status</th><th></th></tr></thead><tbody>${d.feeReminders.slice().reverse().slice(0, 100).map((r) => `<tr><td>${escapeHtml(sName(d, r.studentId))}</td><td>${escapeHtml(r.stage)}</td><td class="text-sm">${escapeHtml(r.message)}</td><td>${badge(stTone[r.status], r.status === 'queued' ? 'Queued (not sent)' : 'Opened on this device')}</td><td>${r.phone && (r.channels ?? []).includes('sms') ? `<a class="btn-ghost btn-sm" data-ho="${r.id}:sms" href="sms:${encodeURIComponent(r.phone)}?body=${encodeURIComponent(r.message)}">SMS</a>` : ''}${r.phone && (r.channels ?? []).includes('whatsapp') ? `<a class="btn-ghost btn-sm" target="_blank" rel="noopener" data-ho="${r.id}:whatsapp" href="https://wa.me/${encodeURIComponent(String(r.phone).replace(/\D/g, ''))}?text=${encodeURIComponent(r.message)}">WhatsApp</a>` : ''}${r.email && (r.channels ?? []).includes('email') ? `<a class="btn-ghost btn-sm" data-ho="${r.id}:email" href="mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent('Fee balance reminder')}&body=${encodeURIComponent(r.message)}">Email</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="text-sm text-ink-500">No reminders yet.</td></tr>'}</tbody></table></div></div>`;
  qs(el, '#r-save').addEventListener('click', async () => { try { await B.saveSettings({ reminders: { enabled: qs(el, '#r-on').checked, schedule: parseSched(qs(el, '#r-sched').value), channels: [...el.querySelectorAll('[data-ch]:checked')].map((c) => c.dataset.ch), template: qs(el, '#r-tpl').value } }); await redo('Reminder settings saved.'); } catch (x) { await redo('', x.message); } });
  qs(el, '#r-gen').addEventListener('click', async () => { try { if (!cfg.enabled) throw new Error('Turn reminders on and save first.'); const made = await B.generateReminders(); await redo(made.length ? `${made.length} reminder(s) queued.` : 'Nothing is due for a reminder right now.'); } catch (x) { await redo('', x.message); } });
  on(el, '[data-ho]', 'click', (e) => { const [id, ch] = e.currentTarget.dataset.ho.split(':'); B.markReminderHandedOff(id, ch); });
}

// ---------------------------------------------------------------- refunds
async function refunds(el, d, { redo }) {
  const canApprove = featureEnabled('refund_approvals') && isAdmin();
  const by = 'Finance staff';
  el.innerHTML = `<div class="space-y-4">
    <section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">Request a refund</h3><div class="grid grid-2 lg-grid-4 gap-3">
      <div><label class="label">Student</label><select class="input" id="rf-s"><option value="">Choose…</option>${d.students.map((s) => { const m = L.refundableAmount(s.id, d.payments, d.refunds); return m > 0 ? `<option value="${s.id}">${escapeHtml(fullName(s))} (refundable ${m.toLocaleString('en-US')})</option>` : ''; }).join('')}</select></div>
      <div><label class="label">Amount</label><input class="input" type="number" min="1" id="rf-a" /></div><div style="grid-column:span 2;"><label class="label">Reason</label><input class="input" id="rf-r" /></div></div><button class="btn-primary" id="rf-go">Submit request</button></section>
    ${!canApprove ? '<div class="notice"><span>Approving refunds is limited to the school administrator when refund approvals are enabled for your package.</span></div>' : ''}
    <div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>No.</th><th>Student</th><th>Reason</th><th class="text-right">Amount</th><th>Status</th><th>History</th><th></th></tr></thead><tbody>${d.refunds.slice().reverse().map((r) => `<tr><td>${escapeHtml(r.number ?? '')}</td><td>${escapeHtml(sName(d, r.studentId))}</td><td class="text-sm">${escapeHtml(r.reason)}</td><td class="text-right">${escapeHtml(money(d, r.amount))}</td><td>${badge(stTone[r.status === 'paid' ? 'paid_out' : r.status], L.REFUND_STATUS[r.status])}${r.payoutReference ? `<div class="text-xs">Ref ${escapeHtml(r.payoutReference)}</div>` : ''}</td><td class="text-xs">${(r.history ?? []).map((h) => `${escapeHtml(String(h.at).slice(0, 10))} ${escapeHtml(h.action)} — ${escapeHtml(h.by)}${h.note ? `: ${escapeHtml(h.note)}` : ''}`).join('<br>')}</td><td>${r.status === 'requested' && canApprove ? `<button class="btn-primary btn-sm" data-m="${r.id}:approved">Approve</button> <button class="btn-secondary btn-sm" data-m="${r.id}:rejected">Reject</button>` : ''}${r.status === 'approved' ? `<button class="btn-primary btn-sm" data-m="${r.id}:paid">Mark paid out</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="text-sm text-ink-500">No refund requests.</td></tr>'}</tbody></table></div></div>`;
  qs(el, '#rf-go').addEventListener('click', async () => { try { await B.requestRefund({ studentId: qs(el, '#rf-s').value, amount: qs(el, '#rf-a').value, reason: qs(el, '#rf-r').value }, by); await redo('Refund requested.'); } catch (x) { await redo('', x.message); } });
  on(el, '[data-m]', 'click', async (e) => {
    const [id, to] = e.currentTarget.dataset.m.split(':');
    const note = to === 'rejected' ? prompt('Why is it rejected?') : to === 'paid' ? prompt('Payout reference (M-Pesa code, bank ref or cheque no.):') : '';
    if (to !== 'approved' && !note) return;
    try { await B.moveRefund(id, to, { by, note: to === 'paid' ? '' : note, reference: to === 'paid' ? note : '' }); await redo(`Refund ${to === 'paid' ? 'marked as paid out' : to}.`); } catch (x) { await redo('', x.message); }
  });
}

// ---------------------------------------------------------------- optional charges, sibling discounts, approvals
async function chargesBase(el, d, { redo }) {
  const pol = d.settings.siblingPolicy; const fam = L.siblingFamilies(d.students.filter((s) => (s.status ?? 'active') === 'active'));
  const pending = d.adjustments.filter((a) => a.status === 'pending');
  const canApprove = pol.approverRole === 'accountant' || isAdmin();
  const opt = featureEnabled('optional_charges'); const sib = featureEnabled('sibling_discounts');
  el.innerHTML = `<div class="space-y-4">
    ${opt ? `<section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">Optional charges (trips, meals, uniforms, activities…)</h3>
      <div class="grid grid-2 lg-grid-4 gap-3"><div><label class="label">Name</label><input class="input" id="oc-n" /></div><div><label class="label">Category</label><select class="input" id="oc-c">${['trip', 'meals', 'uniform', 'activity', 'transport', 'other'].map((c) => `<option>${c}</option>`).join('')}</select></div><div><label class="label">Amount (${d.currency})</label><input class="input" type="number" min="1" id="oc-a" /></div><div style="align-self:end;"><button class="btn-primary" id="oc-add">Add charge</button></div></div>
      ${d.optionalCharges.map((c) => `<div class="flex flex-wrap items-center gap-2 text-sm" style="border-top:1px solid var(--ink-100);padding-top:.5rem;"><strong>${escapeHtml(c.name)}</strong> <span class="text-ink-500">${escapeHtml(c.category)} · ${escapeHtml(money(d, c.amount))}</span> <select class="input" data-as-class="${c.id}" style="max-width:10rem;"><option value="">Assign to class…</option>${d.classes.map((k) => `<option value="${k.id}">${escapeHtml(k.name)}</option>`).join('')}</select> <select class="input" data-as-stu="${c.id}" style="max-width:14rem;"><option value="">Assign to student…</option>${d.students.map((s) => `<option value="${s.id}">${escapeHtml(fullName(s))}</option>`).join('')}</select> <span class="text-xs text-ink-500">${d.studentCharges.filter((x) => x.chargeId === c.id && x.status === 'selected').length} waiting to be invoiced</span></div>`).join('')}</section>` : ''}
    ${sib ? `<section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">Sibling discount policy</h3><div class="grid grid-2 lg-grid-4 gap-3">
      <label class="text-sm"><input type="checkbox" id="sp-on" ${pol.enabled ? 'checked' : ''} /> Policy enabled</label>
      <div><label class="label">Type</label><select class="input" id="sp-t"><option value="percent" ${pol.type === 'percent' ? 'selected' : ''}>Percent of fees</option><option value="amount" ${pol.type === 'amount' ? 'selected' : ''}>Fixed amount</option></select></div>
      <div><label class="label">Tiers (child:value, e.g. 2:10, 3:15)</label><input class="input" id="sp-tiers" value="${escapeHtml(Object.entries(pol.tiers).map(([k, v]) => `${k}:${v}`).join(', '))}" /></div>
      <div><label class="label">Approval</label><select class="input" id="sp-ap"><option value="yes" ${pol.requireApproval ? 'selected' : ''}>Approval required</option><option value="no" ${pol.requireApproval ? '' : 'selected'}>Apply automatically</option></select></div></div>
      <div><label class="label">Who approves</label><select class="input" id="sp-who" style="max-width:14rem;"><option value="school_admin" ${pol.approverRole === 'school_admin' ? 'selected' : ''}>School administrator</option><option value="accountant" ${pol.approverRole === 'accountant' ? 'selected' : ''}>Bursar</option></select></div>
      <button class="btn-primary" id="sp-save">Save policy</button>
      <p class="text-sm text-ink-600">${fam.length} sibling group(s) found (children who share a parent record). Eldest pays in full.</p>
      <div class="text-sm">${fam.slice(0, 20).map((f) => `<div>${f.map((s) => escapeHtml(fullName(s))).join(' · ')}</div>`).join('')}</div></section>
    <section class="card card-p space-y-2"><h3 class="text-sm" style="font-weight:600;">Adjustments awaiting approval (${pending.length})</h3>${!canApprove ? '<p class="text-sm text-ink-500">Only the configured approver can decide these.</p>' : ''}
      ${pending.map((a) => `<div class="flex flex-wrap justify-between gap-2 text-sm"><span>${escapeHtml(sName(d, a.studentId))} — ${escapeHtml(a.reason)} — ${escapeHtml(money(d, a.amount))} (invoice ${escapeHtml(d.invoices.find((i) => i.id === a.invoiceId)?.number ?? '')})</span>${canApprove ? `<span><button class="btn-primary btn-sm" data-adj="${a.id}:1">Approve</button> <button class="btn-secondary btn-sm" data-adj="${a.id}:0">Reject</button></span>` : ''}</div>`).join('') || '<p class="text-sm text-ink-500">None.</p>'}</section>` : ''}</div>`;
  qs(el, '#oc-add')?.addEventListener('click', async () => { const amount = Number(qs(el, '#oc-a').value); if (!qs(el, '#oc-n').value.trim() || !(amount > 0)) return redo('', 'Enter a name and an amount.'); await B.saveOptionalCharge({ name: qs(el, '#oc-n').value.trim(), category: qs(el, '#oc-c').value, amount }); await redo('Charge added.'); });
  on(el, '[data-as-class]', 'change', async (e) => { const ids = d.students.filter((s) => s.classId === e.currentTarget.value && (s.status ?? 'active') === 'active').map((s) => s.id); const n = await B.assignCharge(e.currentTarget.dataset.asClass, ids); await redo(`Assigned to ${n} student(s). It will be added to their next generated invoice.`); });
  on(el, '[data-as-stu]', 'change', async (e) => { if (!e.currentTarget.value) return; const n = await B.assignCharge(e.currentTarget.dataset.asStu, [e.currentTarget.value]); await redo(n ? 'Assigned.' : 'Already assigned.'); });
  qs(el, '#sp-save')?.addEventListener('click', async () => {
    const tiers = {}; qs(el, '#sp-tiers').value.split(',').forEach((x) => { const [k, v] = x.split(':').map((y) => Number(y.trim())); if (k >= 2 && v > 0) tiers[k] = v; });
    await B.saveSettings({ siblingPolicy: { enabled: qs(el, '#sp-on').checked, type: qs(el, '#sp-t').value, tiers, requireApproval: qs(el, '#sp-ap').value === 'yes', approverRole: qs(el, '#sp-who').value } }); await redo('Policy saved. It applies to invoices generated from now on.');
  });
  on(el, '[data-adj]', 'click', async (e) => { const [id, ok] = e.currentTarget.dataset.adj.split(':'); try { await B.decideAdjustment(id, ok === '1', ''); await redo(ok === '1' ? 'Approved and applied to the invoice.' : 'Rejected.'); } catch (x) { await redo('', x.message); } });
}

// ---------------------------------------------------------------- SwiftIQ Pay configuration
async function payBase(el, d, { redo }) {
  const ps = d.settings.pay.providers;
  el.innerHTML = `<div class="space-y-4"><div class="notice"><span><strong>Manual mode only for now.</strong> This page tells parents how to pay (it appears on invoices). Automatic M-Pesa confirmation needs a server-side callback with your Safaricom credentials, which is not connected. Until then, payments stay <em>pending</em> until verified. Never enter consumer secrets here.</span></div>
    ${ps.map((p, i) => `<section class="card card-p space-y-2"><div class="flex justify-between"><h3 class="text-sm" style="font-weight:600;">${escapeHtml(p.name)}</h3><label class="text-sm"><input type="checkbox" data-pe="${i}" ${p.enabled ? 'checked' : ''} /> Offer to parents</label></div>
      <div class="grid grid-2 gap-3"><div><label class="label">Paybill / Till / Account</label><input class="input" data-pf="${i}:shortcode" value="${escapeHtml(p.shortcode)}" /></div><div><label class="label">Account reference format</label><input class="input" data-pf="${i}:accountFormat" value="${escapeHtml(p.accountFormat)}" /></div></div>
      <div><label class="label">Instructions shown on invoices</label><input class="input" data-pf="${i}:instructions" value="${escapeHtml(p.instructions)}" /></div><p class="text-xs text-ink-500">Connection status: ${badge('muted', 'Not connected — manual verification')}</p></section>`).join('')}
    <button class="btn-primary" id="pay-save">Save payment settings</button></div>`;
  const working = JSON.parse(JSON.stringify(ps));
  on(el, '[data-pe]', 'change', (e) => { working[e.currentTarget.dataset.pe].enabled = e.currentTarget.checked; });
  on(el, '[data-pf]', 'input', (e) => { const [i, k] = e.currentTarget.dataset.pf.split(':'); working[i][k] = e.currentTarget.value; });
  qs(el, '#pay-save').addEventListener('click', async () => { await B.saveSettings({ pay: { providers: working } }); await redo('Payment settings saved.'); });
}

// ---------------------------------------------------------------- reports & analytics
async function breports(el, d) {
  const analytics = featureEnabled('advanced_financial_analytics');
  const t = today();
  const live = d.invoices.filter((i) => i.status !== 'void');
  const byClass = {}; live.forEach((i) => { const k = d.classById[d.studentById[i.studentId]?.classId]?.name ?? 'No class'; const f = L.invoiceFigures(i, d.payments, t); const r = (byClass[k] ??= { billed: 0, paid: 0, out: 0 }); r.billed += f.billed; r.paid += f.paid; r.out += f.outstanding; });
  const byMethod = {}; d.payments.filter(L.isConfirmed).forEach((p) => { byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount); });
  const aging = L.agingBuckets(live, d.payments, t);
  const refundTotal = d.refunds.filter((r) => r.status === 'paid').reduce((s, r) => s + Number(r.amount), 0);
  const discounts = live.flatMap((i) => i.items.filter((x) => Number(x.amount) < 0)).reduce((s, x) => s - Number(x.amount), 0);
  const table = (rows, heads) => `<div class="overflow-x-auto"><table class="data-table"><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td ${i ? 'class="text-right"' : ''}>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const classRows = Object.entries(byClass).map(([k, v]) => [k, money(d, v.billed), money(d, v.paid), money(d, v.out), v.billed ? `${Math.round((v.paid / v.billed) * 100)}%` : '—']);
  el.innerHTML = `<div class="space-y-4"><div class="flex gap-2 no-print"><button class="btn-secondary" id="br-print">Print</button><button class="btn-secondary" id="br-csv">Export class summary (CSV)</button></div>
    <div id="br-area" class="space-y-4"><div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Fee collection by class</h3>${table(classRows, ['Class', 'Billed', 'Collected', 'Outstanding', 'Collected %'])}</div>
    <div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Outstanding by age</h3>${table(Object.entries(aging).map(([k, v]) => [k, money(d, v)]), ['Overdue', 'Amount'])}</div>
    <div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Collections by method</h3>${table(Object.entries(byMethod).map(([k, v]) => [methodLabel(k), money(d, v)]), ['Method', 'Collected'])}</div>
    <div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Discounts and refunds</h3>${table([['Discounts and approved adjustments on invoices', money(d, discounts)], ['Refunds paid out', money(d, refundTotal)]], ['Item', 'Amount'])}</div>
    ${analytics ? `<div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Monthly collection trend</h3>${table(L.monthlyCollections(d.payments).map(([m, v]) => [m, money(d, v)]), ['Month', 'Collected'])}</div>` : '<p class="text-xs text-ink-500">Collection trends and deeper analytics are part of the Advanced package.</p>'}</div></div>`;
  qs(el, '#br-print').addEventListener('click', () => printHtml('Financial report', qs(el, '#br-area').innerHTML));
  qs(el, '#br-csv').addEventListener('click', () => download('fees-by-class.csv', L.toCsv([['Class', 'Billed', 'Collected', 'Outstanding'], ...Object.entries(byClass).map(([k, v]) => [k, v.billed, v.paid, v.out])])));
}

// ---- the original screens, with the Phase Three sections added underneath (demo mode until the backend phase)
async function payments(el, d, ctx) {
  el.innerHTML = '<div id="pm-main"></div><div id="pm-alloc" style="margin-top:1rem;"></div>';
  await paymentsBase(qs(el, '#pm-main'), d, ctx);
  if (!isSupabaseConfigured()) renderAllocator(qs(el, '#pm-alloc'), d, ctx.redo);
}
async function charges(el, d, ctx) {
  el.innerHTML = '<div id="ch-main"></div><div id="ch-awards" style="margin-top:1rem;"></div>';
  await chargesBase(qs(el, '#ch-main'), d, ctx);
  if (!isSupabaseConfigured() && featureEnabled('scholarships')) renderAwards(qs(el, '#ch-awards'), d, ctx.redo);
}
async function pay(el, d, ctx) {
  el.innerHTML = '<div id="py-main"></div><div id="py-rules" style="margin-top:1rem;"></div>';
  await payBase(qs(el, '#py-main'), d, ctx);
  if (!isSupabaseConfigured()) renderRules(qs(el, '#py-rules'), d, ctx.redo);
}
