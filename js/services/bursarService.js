// Bursar Pack storage + workflows, for browser-local mode and Supabase mode alike.
// Rules live in bursarLogic.js; this file reads/writes records and calls the database
// functions that must be atomic in the cloud (document numbers, confirming a payment).
import { LocalStorageRepository } from '../storage/Repository.js';
import { SupabaseRepository } from '../storage/SupabaseRepository.js';
import { isSupabaseConfigured } from '../config/supabase.js';
import { uuid } from '../lib/uuid.js';
import * as L from './bursarLogic.js';

const remote = () => isSupabaseConfigured();
const cache = {};
const R = (c) => (cache[c] ??= remote() ? new SupabaseRepository(c) : new LocalStorageRepository(c, c));
const all = async (c) => (await R(c).getAll()) ?? [];
const today = () => new Date().toISOString().slice(0, 10);
const rpc = async (name, args) => {
  const { getSupabaseClient } = await import('./supabaseClient.js');
  const { data, error } = await (await getSupabaseClient()).rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
};

export const DEFAULT_SETTINGS = {
  id: 'bursar',
  siblingPolicy: { enabled: false, type: 'percent', tiers: { 2: 10, 3: 15, 4: 20 }, requireApproval: true, approverRole: 'school_admin' },
  reminders: { enabled: false, schedule: [{ when: 'before', days: 7 }, { when: 'on', days: 0 }, { when: 'after', days: 7 }], channels: ['sms'], template: 'Dear {parent}, {student} has an outstanding fee balance of {amount} (invoice {invoice}, due {due}). Thank you. {school}' },
  paymentRules: { allowOverpayment: false, allocation: 'oldest_first', minInstallment: 0, maxInstallments: 12, stackDiscounts: true },
  pay: { providers: [
    { id: 'mpesa', name: 'M-Pesa', enabled: false, mode: 'manual', shortcode: '', accountFormat: '{admission}', instructions: '' },
    { id: 'bank', name: 'Bank transfer', enabled: false, mode: 'manual', shortcode: '', accountFormat: '{admission}', instructions: '' },
    { id: 'card', name: 'Card (via provider)', enabled: false, mode: 'manual', shortcode: '', accountFormat: '', instructions: '' },
  ] },
};

export async function getSettings() {
  const rec = (await all('bursarSettings'))[0];
  return { ...DEFAULT_SETTINGS, ...(rec ?? {}), siblingPolicy: { ...DEFAULT_SETTINGS.siblingPolicy, ...(rec?.siblingPolicy ?? {}) }, reminders: { ...DEFAULT_SETTINGS.reminders, ...(rec?.reminders ?? {}) }, paymentRules: { ...DEFAULT_SETTINGS.paymentRules, ...(rec?.paymentRules ?? {}) }, pay: { providers: rec?.pay?.providers ?? DEFAULT_SETTINGS.pay.providers } };
}
export async function saveSettings(patch) {
  const rec = (await all('bursarSettings'))[0];
  if (rec) return R('bursarSettings').update(rec.id, patch, 'updated bursar settings');
  return R('bursarSettings').create({ ...DEFAULT_SETTINGS, ...patch }, 'created bursar settings');
}

export async function loadBursar() {
  const names = ['students', 'classes', 'streams', 'terms', 'academicYears', 'feeStructures', 'invoices', 'payments', 'receipts', 'refunds', 'optionalCharges', 'studentCharges', 'adjustments', 'feeReminders', 'routes', 'transportAssignments', 'parents', 'school', 'creditNotes', 'awards', 'sponsorPayments', 'installmentPlans', 'bankTransactions', 'expenses'];
  const rows = await Promise.all(names.map((c) => all(c).catch(() => [])));
  const d = Object.fromEntries(names.map((c, i) => [c, rows[i]]));
  d.feeStructures = d.feeStructures.filter((structure) => !structure.archivedAt);
  d.expenses = d.expenses.filter((expense) => !expense.deletedAt);
  d.settings = await getSettings();
  d.school = d.school[0] ?? {};
  d.currency = d.school.currency ?? 'KES';
  d.studentById = Object.fromEntries(d.students.map((s) => [s.id, s]));
  d.classById = Object.fromEntries(d.classes.map((c) => [c.id, c]));
  d.termById = Object.fromEntries(d.terms.map((t) => [t.id, t]));
  d.invoices.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  d.payments.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return d;
}

// ---------------------------------------------------------------- numbering
async function newNumber(kind, prefix, existing) {
  if (remote()) return rpc('next_document_number', { doc_kind: kind });
  return L.nextNumber(existing.map((x) => x.number), prefix, new Date().getFullYear());
}

// ---------------------------------------------------------------- payments & receipts
async function refreshInvoice(invoiceId) {
  if (!invoiceId) return;
  const [inv] = (await all('invoices')).filter((i) => i.id === invoiceId);
  if (!inv) return;
  const f = L.invoiceFigures(inv, await all('payments'), undefined, await all('creditNotes'));
  if (inv.status !== f.status) await R('invoices').update(invoiceId, { status: f.status });
}

async function issueReceipt(payment) {
  const receipts = await all('receipts');
  const existing = receipts.find((r) => r.paymentId === payment.id);
  if (existing) return existing; // one receipt per confirmed payment, never two
  return R('receipts').create({ number: await newNumber('receipt', 'RCT', receipts), paymentId: payment.id, studentId: payment.studentId, invoiceId: payment.invoiceId, amount: payment.amount, method: payment.method, reference: payment.reference, date: payment.date }, 'issued receipt');
}

export async function submitPayment({ studentId, invoiceId, amount, method, reference, date }) {
  const value = Number(amount);
  if (!studentId) throw new Error('Choose a student.');
  if (!(value > 0)) throw new Error('Enter an amount greater than zero.');
  if (L.ELECTRONIC_METHODS.includes(method) && !String(reference ?? '').trim()) throw new Error('Enter the transaction reference so the payment can be verified.');
  const refs = String(reference ?? '').trim().toLowerCase();
  if (refs && (await all('payments')).some((p) => p.status !== 'rejected' && String(p.reference ?? '').trim().toLowerCase() === refs)) throw new Error('A payment with this reference has already been recorded.');
  if (invoiceId) {
    const invoice = (await all('invoices')).find((i) => i.id === invoiceId);
    if (invoice) {
      const f = L.invoiceFigures(invoice, await all('payments'), undefined, await all('creditNotes'));
      const rule = L.checkPaymentAgainstRules(value, f.outstanding, L.rulesFrom(await getSettings()));
      if (rule && !remote()) throw new Error(rule);
    }
  }
  if (remote()) return rpc('bursar_submit_payment', { target_student: studentId, target_invoice: invoiceId || null, pay_amount: value, pay_method: method, pay_reference: String(reference ?? '').trim() || null, pay_date: date || today(), initial_status: L.initialPaymentStatus(method) });
  const status = L.initialPaymentStatus(method);
  const payment = await R('payments').create({ studentId, invoiceId: invoiceId || undefined, amount: value, method, reference: String(reference ?? '').trim() || undefined, date: date || today(), status, ...(status === 'confirmed' ? { confirmedAt: new Date().toISOString() } : {}) }, 'recorded payment');
  if (status === 'confirmed') { await issueReceipt(payment); await refreshInvoice(invoiceId); }
  return payment;
}

// The ONLY way an electronic payment becomes real money on the books.
export async function confirmPayment(paymentId, note) {
  if (!String(note ?? '').trim()) throw new Error('Say how you confirmed it (e.g. "Seen on M-Pesa statement").');
  if (remote()) return rpc('bursar_confirm_payment', { payment_id: paymentId, confirm_note: note });
  const p = (await all('payments')).find((x) => x.id === paymentId);
  if (!p) throw new Error('Payment not found.');
  if (p.status !== 'pending_verification') throw new Error('Only a payment that is pending verification can be confirmed.');
  const updated = await R('payments').update(paymentId, { status: 'confirmed', confirmedAt: new Date().toISOString(), confirmNote: note });
  await issueReceipt(updated); await refreshInvoice(p.invoiceId);
  return updated;
}
export async function rejectPayment(paymentId, note) {
  if (!String(note ?? '').trim()) throw new Error('Say why the payment is rejected.');
  const p = (await all('payments')).find((x) => x.id === paymentId);
  if (!p || p.status !== 'pending_verification') throw new Error('Only a payment that is pending verification can be rejected.');
  await R('payments').update(paymentId, { status: 'rejected', confirmNote: note, rejectedAt: new Date().toISOString() });
}

// ---------------------------------------------------------------- invoicing
export async function previewInvoices(opts) {
  const d = opts.data ?? (await loadBursar());
  const structure = d.feeStructures.find((f) => f.id === opts.structureId);
  if (!structure) throw new Error('Choose a fee structure.');
  const transportIds = new Set(d.transportAssignments.map((a) => a.studentId));
  let students = L.selectSegment(d.students, opts.scope, { transportStudentIds: transportIds });
  if (structure.classId) students = students.filter((s) => s.classId === structure.classId); // a class fee structure never bills other classes
  const families = L.siblingFamilies(d.students.filter((s) => (s.status ?? 'active') === 'active'));
  const routeById = Object.fromEntries(d.routes.map((r) => [r.id, r]));
  return students.map((s) => {
    if (L.isDuplicateInvoice(d.invoices, s.id, opts.termId, structure.id)) return { student: s, skipped: 'Already invoiced for this term and fee structure.' };
    const feeTotal = structure.items.reduce((t, i) => t + Number(i.amount || 0), 0);
    const optionalLines = opts.includeOptional ? d.studentCharges.filter((c) => c.studentId === s.id && c.status === 'selected').map((c) => { const ch = d.optionalCharges.find((x) => x.id === c.chargeId); return ch ? { name: ch.name, amount: ch.amount, qty: c.qty ?? 1, chargeId: ch.id, assignmentId: c.id } : null; }).filter(Boolean) : [];
    let transportLine = null;
    if (opts.includeTransport) {
      const a = d.transportAssignments.find((x) => x.studentId === s.id); const r = a && routeById[a.routeId];
      const fee = Number(r?.fee ?? r?.fare ?? r?.termFee ?? 0);
      if (r && fee > 0) transportLine = { name: `Transport — ${r.name ?? 'route'}`, amount: fee };
    }
    const feeTotalForAwards = structure.items.reduce((t, i) => t + Number(i.amount || 0), 0);
    const awards = d.awards.filter((a) => a.studentId === s.id && L.awardActive(a, today())).map((a) => L.awardDiscount(a, feeTotalForAwards)).filter(Boolean);
    const sibling = opts.applySibling ? L.siblingDiscountFor(s, families, d.settings.siblingPolicy, feeTotal) : null;
    const built = L.buildInvoiceItems({ structure, optionalLines, transportLine, sibling, awards });
    return { student: s, ...built, optionalLines };
  });
}

export async function generateInvoices(opts) {
  const d = await loadBursar();
  const rows = await previewInvoices({ ...opts, data: d });
  const created = []; const skipped = []; const approvals = [];
  let numbers = d.invoices.map((i) => ({ number: i.number }));
  for (const row of rows) {
    if (row.skipped) { skipped.push({ student: row.student, reason: row.skipped }); continue; }
    const number = await newNumber('invoice', 'INV', numbers);
    numbers = [...numbers, { number }];
    const inv = await R('invoices').create({ number, studentId: row.student.id, termId: opts.termId || undefined, structureId: opts.structureId, items: row.items.map((i) => ({ id: uuid(), ...i })), totalAmount: row.total, dueDate: opts.dueDate || undefined, status: 'unpaid', issueDate: today() }, 'generated invoice');
    created.push(inv);
    for (const o of row.optionalLines) await R('studentCharges').update(o.assignmentId, { status: 'invoiced', invoiceId: inv.id });
    for (const a of row.pendingApprovals) approvals.push(await R('adjustments').create({ ...a, studentId: row.student.id, invoiceId: inv.id, status: 'pending', requestedAt: new Date().toISOString() }, 'requested adjustment'));
  }
  return { created, skipped, approvals };
}

export async function decideAdjustment(id, approve, note) {
  const a = (await all('adjustments')).find((x) => x.id === id);
  if (!a || a.status !== 'pending') throw new Error('This adjustment is no longer pending.');
  if (!approve) return R('adjustments').update(id, { status: 'rejected', decidedAt: new Date().toISOString(), decisionNote: note ?? '' });
  const inv = (await all('invoices')).find((i) => i.id === a.invoiceId);
  if (!inv) throw new Error('The invoice for this adjustment was not found.');
  const items = [...inv.items, { id: uuid(), name: a.reason, amount: -Math.abs(a.amount), kind: 'discount', adjustmentId: a.id }];
  const total = Math.max(0, items.reduce((t, i) => t + Number(i.amount || 0), 0));
  await R('invoices').update(inv.id, { items, totalAmount: total });
  await refreshInvoice(inv.id);
  return R('adjustments').update(id, { status: 'approved', decidedAt: new Date().toISOString(), decisionNote: note ?? '' });
}

export async function voidInvoice(id, reason) {
  if (!String(reason ?? '').trim()) throw new Error('Give a reason for voiding the invoice.');
  const invoice = (await all('invoices')).find((item) => item.id === id);
  if (!invoice) throw new Error('Invoice not found.');
  if (invoice.status === 'void') throw new Error('This invoice is already void.');
  const payments = await all('payments');
  const hasPayment = payments.some((p) => p.status !== 'rejected' && (p.invoiceId === id || (p.allocations ?? []).some((part) => part.invoiceId === id)));
  if (hasPayment) throw new Error('This invoice has a pending or confirmed payment recorded against it. Resolve the payment through verification/refund or reassignment before voiding.');
  return R('invoices').update(id, {
    status: 'void',
    voidReason: reason.trim(),
    voidedAt: new Date().toISOString(),
    correctionHistory: [...(invoice.correctionHistory ?? []), { at: new Date().toISOString(), action: 'voided', reason: reason.trim(), totalAmount: invoice.totalAmount }],
  }, 'voided invoice');
}

export async function correctInvoice(id, { items, dueDate }, reason) {
  const note = String(reason ?? '').trim();
  if (!note) throw new Error('Give a reason for correcting the invoice.');
  const invoice = (await all('invoices')).find((item) => item.id === id);
  if (!invoice) throw new Error('Invoice not found.');
  if (invoice.status === 'void') throw new Error('A void invoice cannot be edited.');
  const [payments, creditNotes] = await Promise.all([all('payments'), all('creditNotes')]);
  if (payments.some((p) => p.status !== 'rejected' && (p.invoiceId === id || (p.allocations ?? []).some((part) => part.invoiceId === id)))) {
    throw new Error('This invoice has a pending or confirmed payment. Resolve it through verification/refund or reassignment before editing.');
  }
  if (creditNotes.some((credit) => credit.invoiceId === id)) {
    throw new Error('This invoice has a credit note. Use a further approved adjustment instead of changing its original lines.');
  }
  if (!Array.isArray(items) || !items.length || items.some((item) => !String(item.name ?? '').trim() || !Number.isFinite(Number(item.amount)))) {
    throw new Error('Add at least one invoice line with a name and a valid amount.');
  }
  const normalizedItems = items.map((item) => ({ ...item, name: String(item.name).trim(), amount: Number(item.amount) }));
  const totalAmount = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
  if (totalAmount < 0) throw new Error('The corrected invoice total cannot be negative.');
  const correctionHistory = [...(invoice.correctionHistory ?? []), {
    at: new Date().toISOString(),
    action: 'corrected',
    reason: note,
    previous: { items: invoice.items, totalAmount: invoice.totalAmount, dueDate: invoice.dueDate },
  }];
  const updated = await R('invoices').update(id, {
    items: normalizedItems,
    totalAmount,
    dueDate: dueDate || undefined,
    correctionHistory,
  }, 'corrected invoice');
  await refreshInvoice(id);
  return updated;
}

export async function correctPayment(id, { amount, method, reference, date }, reason) {
  const note = String(reason ?? '').trim();
  if (!note) throw new Error('Give a reason for correcting the payment.');
  const payment = (await all('payments')).find((item) => item.id === id);
  if (!payment) throw new Error('Payment not found.');
  if (payment.status !== 'pending_verification' || payment.archivedAt) {
    throw new Error('Only an active payment pending verification can be corrected. Confirmed payments and receipts are immutable; use the refund workflow.');
  }
  const value = Number(amount);
  if (!(value > 0) || !Number.isFinite(value)) throw new Error('Enter an amount greater than zero.');
  const cleanReference = String(reference ?? '').trim();
  const duplicate = cleanReference && (await all('payments')).some((p) => p.id !== id && p.status !== 'rejected' && String(p.reference ?? '').trim().toLowerCase() === cleanReference.toLowerCase());
  if (duplicate) throw new Error('A payment with this reference has already been recorded.');
  if ((await all('receipts')).some((receipt) => receipt.paymentId === id)) {
    throw new Error('This payment already has a receipt and cannot be edited.');
  }
  const correctionHistory = [...(payment.correctionHistory ?? []), {
    at: new Date().toISOString(),
    reason: note,
    previous: { amount: payment.amount, method: payment.method, reference: payment.reference, date: payment.date },
  }];
  const updated = await R('payments').update(id, {
    amount: value,
    method,
    reference: cleanReference || undefined,
    date: date || today(),
    correctionHistory,
  }, 'corrected pending payment');
  await refreshInvoice(payment.invoiceId);
  return updated;
}

export async function archivePayment(id, reason) {
  const note = String(reason ?? '').trim();
  if (!note) throw new Error('Give a reason for removing this payment from the active list.');
  const payment = (await all('payments')).find((item) => item.id === id);
  if (!payment) throw new Error('Payment not found.');
  if (!['pending_verification', 'rejected'].includes(payment.status) || payment.archivedAt) {
    throw new Error('Only an active pending or rejected payment can be removed. Confirmed payments and receipts are immutable; use the refund workflow.');
  }
  if ((await all('receipts')).some((receipt) => receipt.paymentId === id)) {
    throw new Error('This payment is linked to a receipt and cannot be removed.');
  }
  const archived = await R('payments').update(id, {
    archivedAt: new Date().toISOString(),
    archivedFromStatus: payment.status,
    archiveReason: note,
    status: 'rejected',
  }, 'archived unconfirmed payment');
  await refreshInvoice(payment.invoiceId);
  return archived;
}

// ---------------------------------------------------------------- optional charges
export const saveOptionalCharge = (c) => (c.id ? R('optionalCharges').update(c.id, c) : R('optionalCharges').create({ active: true, ...c }, 'created optional charge'));
export async function assignCharge(chargeId, studentIds, qty = 1) {
  const existing = await all('studentCharges');
  let added = 0;
  for (const studentId of studentIds) {
    if (existing.some((x) => x.studentId === studentId && x.chargeId === chargeId && x.status === 'selected')) continue;
    await R('studentCharges').create({ studentId, chargeId, qty, status: 'selected' }, 'assigned optional charge'); added += 1;
  }
  return added;
}

// ---------------------------------------------------------------- refunds (full history kept on the record)
const stamp = (action, by, note) => ({ at: new Date().toISOString(), action, by, note: note ?? '' });
export async function requestRefund({ studentId, amount, reason, paymentId, invoiceId }, by = 'Staff') {
  const d = { payments: await all('payments'), refunds: await all('refunds') };
  const err = L.validateRefund({ studentId, amount, reason }, d.payments, d.refunds);
  if (err) throw new Error(err);
  const refunds = d.refunds;
  return R('refunds').create({ number: await newNumber('refund', 'RFD', refunds), studentId, amount: Number(amount), reason: reason.trim(), paymentId: paymentId || undefined, invoiceId: invoiceId || undefined, status: 'requested', history: [stamp('Requested', by, reason)] }, 'requested refund');
}
export async function moveRefund(id, to, { by = 'Staff', note, reference } = {}) {
  const r = (await all('refunds')).find((x) => x.id === id);
  if (!r) throw new Error('Refund not found.');
  if (!L.canTransition(r.status, to)) throw new Error(`A ${r.status} refund cannot be marked ${to}.`);
  if (to === 'rejected' && !String(note ?? '').trim()) throw new Error('Say why the refund is rejected.');
  if (to === 'paid' && !String(reference ?? '').trim()) throw new Error('Enter the payment reference for the money paid out.');
  const label = { approved: 'Approved', rejected: 'Rejected', paid: 'Paid out' }[to];
  return R('refunds').update(id, { status: to, ...(to === 'paid' ? { paidAt: new Date().toISOString().slice(0, 10) } : {}), ...(reference ? { payoutReference: reference.trim() } : {}), history: [...(r.history ?? []), stamp(label, by, note ?? reference)] });
}

// ---------------------------------------------------------------- reminders
export async function generateReminders() {
  const d = await loadBursar();
  const cfg = d.settings.reminders;
  const due = L.dueReminders({ invoices: d.invoices, payments: d.payments, schedule: cfg.schedule, existing: d.feeReminders, today: today(), plans: d.installmentPlans, creditNotes: d.creditNotes });
  const parentsById = Object.fromEntries(d.parents.map((p) => [p.id, p]));
  const made = [];
  for (const r of due) {
    const st = d.studentById[r.studentId]; if (!st || (st.status ?? 'active') !== 'active') continue;
    const inv = d.invoices.find((i) => i.id === r.invoiceId);
    const parent = parentsById[(st.parentIds ?? [])[0]];
    const parentName = parent ? [parent.firstName, parent.lastName].filter(Boolean).join(' ') : 'Parent/Guardian';
    const message = L.renderTemplate(cfg.template, { parent: parentName, student: [st.firstName, st.lastName].join(' '), amount: `${d.currency} ${r.outstanding.toLocaleString('en-US')}`, invoice: inv?.number ?? '', due: inv?.dueDate ?? '', school: d.school.name ?? '' });
    // "queued" is the most we can honestly say: no provider has confirmed delivery.
    made.push(await R('feeReminders').create({ ...r, message, phone: parent?.phone ?? '', email: parent?.email ?? '', channels: cfg.channels, status: 'queued' }, 'queued fee reminder'));
  }
  return made;
}
export const markReminderHandedOff = (id, channel) => R('feeReminders').update(id, { status: 'handed_to_device', handedOffVia: channel, handedOffAt: new Date().toISOString() });

// ================================================================ Phase Three
const who = (by) => by || 'Finance staff';

// ---------------------------------------------------------------- credit notes
export async function requestCreditNote({ invoiceId, amount, reason, type = 'correction' }, by) {
  const invoice = (await all('invoices')).find((i) => i.id === invoiceId);
  const existing = await all('creditNotes');
  const err = L.validateCreditNote({ invoice, amount, reason }, existing);
  if (err) throw new Error(err);
  return R('creditNotes').create({ number: await newNumber('credit_note', 'CN', existing), studentId: invoice.studentId, invoiceId, amount: Number(amount), reason: reason.trim(), type, status: 'pending', history: [stamp('Requested', who(by), reason)] }, 'requested credit note');
}
export async function decideCreditNote(id, approve, { by, note } = {}) {
  const cn = (await all('creditNotes')).find((c) => c.id === id);
  if (!cn || cn.status !== 'pending') throw new Error('This credit note is no longer waiting for a decision.');
  if (!approve && !String(note ?? '').trim()) throw new Error('Say why the credit note is rejected.');
  if (approve) {
    // Re-check at approval time: other credit notes may have been approved since it was requested.
    const invoice = (await all('invoices')).find((i) => i.id === cn.invoiceId);
    const others = (await all('creditNotes')).filter((c) => c.id !== id);
    const err = L.validateCreditNote({ invoice, amount: cn.amount, reason: cn.reason }, others);
    if (err) throw new Error(err);
  }
  const updated = await R('creditNotes').update(id, { status: approve ? 'approved' : 'rejected', decidedAt: new Date().toISOString(), history: [...(cn.history ?? []), stamp(approve ? 'Approved' : 'Rejected', who(by), note)] });
  await refreshInvoice(cn.invoiceId);
  return updated;
}

// ---------------------------------------------------------------- allocating payments across invoices
async function openInvoicesFor(studentId, exceptPaymentId) {
  const [invoices, payments, credits] = await Promise.all([all('invoices'), all('payments'), all('creditNotes')]);
  const others = payments.filter((p) => p.id !== exceptPaymentId);
  return invoices.filter((i) => i.studentId === studentId && i.status !== 'void').map((i) => ({ ...i, outstanding: L.invoiceFigures(i, others, undefined, credits).outstanding })).filter((i) => i.outstanding > 0);
}
export async function allocatePayment(paymentId, allocations, by) {
  const pay = (await all('payments')).find((p) => p.id === paymentId);
  if (!pay) throw new Error('Payment not found.');
  if (!L.isConfirmed(pay)) throw new Error('Only a confirmed payment can be allocated to invoices.');
  const open = await openInvoicesFor(pay.studentId, paymentId);
  const rules = L.rulesFrom(await getSettings());
  let parts = allocations;
  if (!parts) { const r = L.autoAllocate(pay.amount, open); parts = r.allocations; if (!parts.length) throw new Error('This learner has no unpaid invoices to allocate to.'); }
  const err = L.validateAllocation(pay, parts, Object.fromEntries(open.map((i) => [i.id, i.outstanding])), rules);
  if (err) throw new Error(err);
  const touched = new Set([...(pay.allocations ?? []).map((x) => x.invoiceId), pay.invoiceId, ...parts.map((x) => x.invoiceId)].filter(Boolean));
  const updated = await R('payments').update(paymentId, { allocations: parts, invoiceId: parts.length === 1 ? parts[0].invoiceId : undefined, allocatedBy: who(by), allocatedAt: new Date().toISOString() }, 'allocated payment');
  for (const id of touched) await refreshInvoice(id);
  return updated;
}
export async function unallocatedPayments() {
  const [payments] = await Promise.all([all('payments')]);
  return payments.filter((p) => L.isConfirmed(p) && !p.invoiceId && !(p.allocations ?? []).length);
}

// ---------------------------------------------------------------- installment plans
export async function createPlan({ invoiceId, count, firstDue, intervalMonths = 1 }, by) {
  const [invoices, payments, credits, plans, settings] = await Promise.all([all('invoices'), all('payments'), all('creditNotes'), all('installmentPlans'), getSettings()]);
  const invoice = invoices.find((i) => i.id === invoiceId);
  if (!invoice || invoice.status === 'void') throw new Error('Choose an open invoice.');
  if (plans.some((p) => p.invoiceId === invoiceId && p.status === 'active')) throw new Error('This invoice already has an active plan. Cancel it first.');
  const f = L.invoiceFigures(invoice, payments, undefined, credits);
  const built = L.buildSchedule({ outstanding: f.outstanding, count: Number(count), firstDue, intervalMonths: Number(intervalMonths) || 1 }, L.rulesFrom(settings));
  if (built.error) throw new Error(built.error);
  const plan = await R('installmentPlans').create({ invoiceId, studentId: invoice.studentId, schedule: built.schedule, basePaid: f.paid, status: 'active', createdBy: who(by) }, 'created installment plan');
  // The invoice is not "overdue" until the LAST installment passes.
  await R('invoices').update(invoiceId, { dueDate: built.schedule.at(-1).dueDate, planId: plan.id });
  return plan;
}
export async function cancelPlan(id, by) {
  const plan = (await all('installmentPlans')).find((p) => p.id === id);
  if (!plan || plan.status !== 'active') throw new Error('That plan is not active.');
  return R('installmentPlans').update(id, { status: 'cancelled', cancelledBy: who(by), cancelledAt: new Date().toISOString() });
}

// ---------------------------------------------------------------- scholarships and sponsorships
export async function saveAward(a, by) {
  const err = L.validateAward(a); if (err) throw new Error(err);
  return R('awards').create({ ...a, value: Number(a.value), status: 'pending', createdBy: who(by) }, 'requested award');
}
export async function decideAward(id, approve, by) {
  const a = (await all('awards')).find((x) => x.id === id);
  if (!a || a.status !== 'pending') throw new Error('This award is no longer waiting for a decision.');
  return R('awards').update(id, { status: approve ? 'approved' : 'revoked', decidedBy: who(by), decidedAt: new Date().toISOString() });
}
export const revokeAward = (id, by) => R('awards').update(id, { status: 'revoked', decidedBy: who(by), decidedAt: new Date().toISOString() });
export async function recordSponsorPayment({ sponsor, amount, method, reference, date }) {
  if (!String(sponsor ?? '').trim()) throw new Error('Choose the sponsor.');
  if (!(Number(amount) > 0)) throw new Error('Enter an amount greater than zero.');
  if (L.ELECTRONIC_METHODS.includes(method) && !String(reference ?? '').trim()) throw new Error('Enter the transaction reference so the payment can be verified.');
  const status = L.initialPaymentStatus(method);
  return R('sponsorPayments').create({ sponsor: sponsor.trim(), amount: Number(amount), method, reference: String(reference ?? '').trim() || undefined, date: date || today(), status }, 'recorded sponsor payment');
}
export async function confirmSponsorPayment(id, note) {
  if (!String(note ?? '').trim()) throw new Error('Say how you confirmed it.');
  return R('sponsorPayments').update(id, { status: 'confirmed', confirmNote: note, confirmedAt: new Date().toISOString() });
}

// ---------------------------------------------------------------- statement import and the unmatched queue
export async function importStatementLines(lines) {
  const d = await loadBursar();
  const results = L.classifyTransactions(lines, { payments: d.payments, students: d.students, known: d.bankTransactions });
  let queued = 0;
  for (const r of results) {
    if (!['suggested', 'ambiguous', 'unmatched'].includes(r.result)) continue;
    await R('bankTransactions').create({ reference: r.line.reference.trim(), amount: r.line.amount, date: r.line.date || today(), account: r.line.account ?? '', status: r.result, suggestedStudentId: r.student?.id, candidateIds: (r.candidates ?? []).map((s) => s.id), source: 'statement import' }, 'queued unmatched transaction');
    queued += 1;
  }
  return { results, queued };
}
// The bursar decides who a bank/M-Pesa line belongs to. The statement line is the evidence; the payment
// is created ONCE (the reference is unique) and gets its own receipt.
export async function assignTransaction(txId, { studentId, invoiceId, method = 'bank' }, by) {
  const tx = (await all('bankTransactions')).find((t) => t.id === txId);
  if (!tx || !['unmatched', 'ambiguous', 'suggested'].includes(tx.status)) throw new Error('This transaction has already been dealt with.');
  if (!studentId) throw new Error('Choose the learner this payment belongs to.');
  const refs = tx.reference.toLowerCase();
  if ((await all('payments')).some((p) => p.status !== 'rejected' && String(p.reference ?? '').trim().toLowerCase() === refs)) throw new Error('A payment with this reference already exists.');
  const payment = await R('payments').create({ studentId, invoiceId: invoiceId || undefined, amount: tx.amount, method, reference: tx.reference, date: String(tx.date).slice(0, 10), status: 'confirmed', confirmedAt: new Date().toISOString(), confirmNote: `Assigned from imported statement by ${who(by)}` }, 'assigned bank transaction');
  await issueReceipt(payment);
  if (invoiceId) await refreshInvoice(invoiceId); else { try { await allocatePayment(payment.id, undefined, by); } catch { /* stays an unallocated credit; the bursar can allocate it later */ } }
  return R('bankTransactions').update(txId, { status: 'assigned', assignedStudentId: studentId, paymentId: payment.id, decidedBy: who(by), decidedAt: new Date().toISOString() });
}
export async function ignoreTransaction(txId, reason, by) {
  if (!String(reason ?? '').trim()) throw new Error('Say why this transaction is not a fee payment.');
  return R('bankTransactions').update(txId, { status: 'ignored', note: reason.trim(), decidedBy: who(by), decidedAt: new Date().toISOString() });
}

export const savePaymentRules = (rules) => saveSettings({ paymentRules: { ...L.DEFAULT_RULES, ...rules } });
