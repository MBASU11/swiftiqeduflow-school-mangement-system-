// Pure Bursar Pack rules. No storage, no DOM: everything here is testable in Node.
// Money rule used throughout: a payment only counts once it is CONFIRMED. Payments entered
// before this pack existed have no status and are treated as confirmed.

export const PAYMENT_STATUS = { confirmed: 'Confirmed', pending_verification: 'Pending verification', rejected: 'Rejected' };
export const ELECTRONIC_METHODS = ['mpesa', 'bank', 'cheque', 'swiftiq_pay', 'other'];
export const isConfirmed = (p) => !p.status || p.status === 'confirmed';
const n = (v) => Number(v) || 0;
const sum = (list, f) => list.reduce((t, x) => t + n(f(x)), 0);

// A payment the bursar types in is only "confirmed" straight away when it is cash handed over the
// counter. Anything electronic (or a cheque) stays pending until it is checked against a statement.
export const initialPaymentStatus = (method) => (ELECTRONIC_METHODS.includes(method) ? 'pending_verification' : 'confirmed');

// ---------------------------------------------------------------- numbering
export const formatNumber = (prefix, year, seq) => `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
export function nextNumber(existing, prefix, year) {
  const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  const max = existing.reduce((m, x) => { const hit = re.exec(String(x ?? '')); return hit ? Math.max(m, Number(hit[1])) : m; }, 0);
  return formatNumber(prefix, year, max + 1);
}

// ---------------------------------------------------------------- invoice figures
// A payment may be tied to ONE invoice (invoiceId) or split across several (allocations). Only confirmed
// money counts. An APPROVED credit note reduces what the invoice is worth; the invoice itself never changes.
const allocatedTo = (p, invoiceId) => (Array.isArray(p.allocations) && p.allocations.length
  ? sum(p.allocations.filter((x) => x.invoiceId === invoiceId), (x) => x.amount)
  : (p.invoiceId === invoiceId ? n(p.amount) : 0));
export const paidOn = (invoice, payments) => sum(payments.filter(isConfirmed), (p) => allocatedTo(p, invoice.id));
export const creditsOn = (invoiceId, creditNotes = []) => sum(creditNotes.filter((c) => c.invoiceId === invoiceId && c.status === 'approved'), (c) => c.amount);

export function invoiceFigures(invoice, payments, today = new Date().toISOString().slice(0, 10), creditNotes = []) {
  const gross = n(invoice.totalAmount);
  const credits = creditsOn(invoice.id, creditNotes);
  const billed = Math.max(0, gross - credits);
  const paid = paidOn(invoice, payments);
  const pending = sum(payments.filter((p) => p.status === 'pending_verification'), (p) => allocatedTo(p, invoice.id));
  const outstanding = Math.max(0, billed - paid);
  const status = invoice.status === 'void' ? 'void' : gross > 0 && paid >= billed ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  return { gross, credits, billed, paid, pending, outstanding, overpaid: Math.max(0, paid - billed), status, overdue: status !== 'paid' && status !== 'void' && Boolean(invoice.dueDate) && invoice.dueDate < today && outstanding > 0 };
}

// What a family owes overall. Payments not yet tied to an invoice still count as money received.
export function studentFigures(studentId, invoices, payments, refunds = [], creditNotes = []) {
  const inv = invoices.filter((i) => i.studentId === studentId && i.status !== 'void');
  const gross = sum(inv, (i) => i.totalAmount);
  const credits = sum(inv, (i) => creditsOn(i.id, creditNotes));
  const billed = Math.max(0, gross - credits);
  const refunded = sum(refunds.filter((r) => r.studentId === studentId && r.status === 'paid'), (r) => r.amount);
  const paid = sum(payments.filter((p) => p.studentId === studentId && isConfirmed(p)), (p) => p.amount) - refunded;
  return { gross, credits, billed, paid, refunded, outstanding: Math.max(0, billed - paid), overpaid: Math.max(0, paid - billed) };
}

// ---------------------------------------------------------------- sibling discounts
// Families are students who share at least one parent record.
export function siblingFamilies(students) {
  const parent = new Map(students.map((s) => [s.id, s.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const byParent = new Map();
  students.forEach((s) => (s.parentIds ?? []).forEach((pid) => {
    if (byParent.has(pid)) parent.set(find(s.id), find(byParent.get(pid))); else byParent.set(pid, s.id);
  }));
  const families = new Map();
  students.forEach((s) => { const k = find(s.id); families.set(k, [...(families.get(k) ?? []), s]); });
  return [...families.values()].filter((f) => f.length > 1)
    .map((f) => f.sort((a, b) => String(a.dateOfBirth ?? a.admissionDate ?? '').localeCompare(String(b.dateOfBirth ?? b.admissionDate ?? '')) || String(a.admissionNumber).localeCompare(String(b.admissionNumber))));
}

// policy: { enabled, type: 'percent'|'amount', tiers: { 2: 10, 3: 15 }, requireApproval, approverRole }
// Child 1 (eldest) pays full fees; the tier for "child 2", "child 3"... applies to the child's ordinal (capped at the highest tier).
export function siblingDiscountFor(student, families, policy, baseAmount) {
  if (!policy?.enabled || baseAmount <= 0) return null;
  const fam = families.find((f) => f.some((s) => s.id === student.id));
  if (!fam) return null;
  const ordinal = fam.findIndex((s) => s.id === student.id) + 1;
  const keys = Object.keys(policy.tiers ?? {}).map(Number).sort((a, b) => a - b);
  const tierKey = [...keys].reverse().find((k) => ordinal >= k);
  if (!tierKey) return null;
  const value = n(policy.tiers[tierKey]);
  const amount = Math.min(baseAmount, Math.round(policy.type === 'amount' ? value : (baseAmount * value) / 100));
  return amount > 0 ? { ordinal, amount, label: `Sibling discount (child ${ordinal}, ${policy.type === 'amount' ? `KES ${value}` : `${value}%`})`, needsApproval: Boolean(policy.requireApproval) } : null;
}

// ---------------------------------------------------------------- segments
// scope: { mode: 'all'|'classes'|'streams'|'students'|'groups', classIds, streamIds, studentIds, groups: ['boarders','day','transport'] }
export function selectSegment(students, scope, ctx = {}) {
  const active = students.filter((s) => (s.status ?? 'active') === 'active');
  const set = (a) => new Set(a ?? []);
  switch (scope.mode) {
    case 'classes': { const c = set(scope.classIds); return active.filter((s) => c.has(s.classId)); }
    case 'streams': { const c = set(scope.streamIds); return active.filter((s) => c.has(s.streamId)); }
    case 'students': { const c = set(scope.studentIds); return active.filter((s) => c.has(s.id)); }
    case 'groups': {
      const g = set(scope.groups); const tr = ctx.transportStudentIds ?? new Set();
      return active.filter((s) => (g.has('boarders') && s.boardingStatus === 'boarder') || (g.has('day') && s.boardingStatus !== 'boarder') || (g.has('transport') && (tr.has(s.id) || s.usesTransport)));
    }
    default: return active;
  }
}

// ---------------------------------------------------------------- building invoices
// Returns the items for one student's invoice and any discounts still waiting for approval.
// awards: approved scholarships/sponsorships already worked out for this student (see awardDiscount).
// Discounts are applied in order (awards, then sibling) and each one is capped at what is still owed,
// so the bill can never go below zero and no discount line shows more than it actually removed.
export function buildInvoiceItems({ structure, optionalLines = [], transportLine = null, sibling = null, adjustments = [], awards = [] }) {
  const items = (structure?.items ?? []).map((i) => ({ name: i.name, amount: n(i.amount), kind: 'fee' }));
  optionalLines.forEach((o) => items.push({ name: o.name, amount: n(o.amount) * (o.qty ?? 1), kind: 'optional', chargeId: o.chargeId }));
  if (transportLine && n(transportLine.amount) > 0) items.push({ name: transportLine.name, amount: n(transportLine.amount), kind: 'transport' });
  adjustments.filter((a) => a.status === 'approved').forEach((a) => items.push({ name: a.reason, amount: -Math.abs(n(a.amount)), kind: 'adjustment', adjustmentId: a.id }));
  let running = sum(items, (i) => i.amount);
  const discount = (name, amount, extra) => { const take = Math.min(Math.max(0, amount), Math.max(0, running)); if (take > 0) { items.push({ name, amount: -take, ...extra }); running -= take; } };
  awards.forEach((a) => discount(a.label, a.amount, { kind: 'award', awardId: a.awardId, sponsor: a.sponsor, awardType: a.awardType }));
  const pendingApprovals = [];
  if (sibling) {
    if (sibling.needsApproval) pendingApprovals.push({ type: 'sibling_discount', amount: Math.min(sibling.amount, Math.max(0, running)), reason: sibling.label });
    else discount(sibling.label, sibling.amount, { kind: 'discount' });
  }
  return { items, total: Math.max(0, sum(items, (i) => i.amount)), pendingApprovals };
}

// Do not create the same invoice twice for the same student, term and structure.
export const isDuplicateInvoice = (invoices, studentId, termId, structureId) =>
  invoices.some((i) => i.studentId === studentId && (i.termId ?? '') === (termId ?? '') && i.structureId === structureId && i.status !== 'void');

// ---------------------------------------------------------------- reminders
// schedule: [{ when: 'before'|'on'|'after', days }]. Returns reminders not yet created, keyed so one
// invoice (or one installment) never gets the same stage twice. Nothing here claims a message was delivered.
// With an active installment plan the reminder follows the NEXT UNPAID INSTALLMENT, not the invoice due date.
export function dueReminders({ invoices, payments, schedule, existing, today, plans = [], creditNotes = [] }) {
  const out = [];
  const day = (iso, delta) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10); };
  invoices.forEach((inv) => {
    const f = invoiceFigures(inv, payments, today, creditNotes);
    if (f.outstanding <= 0 || inv.status === 'void') return;
    const plan = plans.find((p) => p.invoiceId === inv.id && p.status === 'active');
    let due = inv.dueDate; let amount = f.outstanding; let tag = '';
    if (plan) {
      const next = planProgress(plan, inv, payments, creditNotes, today).installments.find((i) => i.paid < i.amount);
      if (!next) return;
      due = next.dueDate; amount = next.amount - next.paid; tag = `:i${next.no}`;
    }
    if (!due) return;
    schedule.forEach((step) => {
      const trigger = day(due, step.when === 'before' ? -step.days : step.when === 'after' ? step.days : 0);
      const stage = `${step.when}:${step.days ?? 0}${tag}`;
      const key = `${inv.id}|${stage}`;
      if (trigger <= today && !existing.some((r) => r.key === key)) out.push({ key, invoiceId: inv.id, studentId: inv.studentId, stage, triggerDate: trigger, outstanding: amount });
    });
  });
  return out;
}

export const renderTemplate = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));

// ---------------------------------------------------------------- reconciliation
export function parseStatement(text) {
  const rows = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[,\t;](?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, '').trim()));
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const ref = col(/ref|code|receipt|transaction|trans/); const amt = col(/amount|paid in|credit|received/); const date = col(/date|time/); const acct = col(/account|narrat|detail|descri|bill|particular/);
  if (ref < 0 || amt < 0) throw new Error('The statement needs a reference/transaction-code column and an amount column in the first row.');
  return rows.slice(1).map((r) => ({ reference: r[ref] ?? '', amount: n(String(r[amt] ?? '').replace(/[^\d.-]/g, '')), date: date >= 0 ? r[date] : '', account: acct >= 0 ? (r[acct] ?? '') : '' })).filter((l) => l.reference && l.amount > 0);
}

// Matching never confirms anything by itself: it only proposes. The bursar presses "Confirm".
export function reconcile(lines, payments) {
  const pending = payments.filter((p) => p.status === 'pending_verification');
  const seen = new Set();
  return lines.map((line) => {
    const ref = line.reference.trim().toLowerCase();
    if (seen.has(ref)) return { line, result: 'duplicate_line' };
    seen.add(ref);
    const hit = pending.find((p) => String(p.reference ?? '').trim().toLowerCase() === ref);
    if (!hit) {
      const done = payments.find((p) => isConfirmed(p) && String(p.reference ?? '').trim().toLowerCase() === ref);
      return { line, result: done ? 'already_confirmed' : 'unmatched', payment: done };
    }
    return { line, payment: hit, result: Math.abs(n(hit.amount) - line.amount) < 0.005 ? 'match' : 'amount_mismatch' };
  });
}

// ---------------------------------------------------------------- refunds
export const REFUND_STATUS = { requested: 'Requested', approved: 'Approved', rejected: 'Rejected', paid: 'Paid out' };
const FLOW = { requested: ['approved', 'rejected'], approved: ['paid', 'rejected'], rejected: [], paid: [] };
export const canTransition = (from, to) => (FLOW[from] ?? []).includes(to);

// A student can only be refunded money they actually paid (confirmed) and that is not already being refunded.
export function refundableAmount(studentId, payments, refunds, invoices = []) {
  const paid = sum(payments.filter((p) => p.studentId === studentId && isConfirmed(p)), (p) => p.amount);
  const committed = sum(refunds.filter((r) => r.studentId === studentId && r.status !== 'rejected'), (r) => r.amount);
  return Math.max(0, paid - committed);
}
export function validateRefund({ studentId, amount, reason }, payments, refunds) {
  if (!studentId) return 'Choose a student.';
  if (!String(reason ?? '').trim()) return 'Give a reason for the refund.';
  const a = n(amount);
  if (a <= 0) return 'Enter an amount greater than zero.';
  const max = refundableAmount(studentId, payments, refunds);
  if (a > max) return `The most that can be refunded for this student is ${max.toLocaleString('en-US')} (confirmed payments less refunds already requested or paid).`;
  return null;
}

// ---------------------------------------------------------------- reports
export function monthlyCollections(payments) {
  const m = {};
  payments.filter(isConfirmed).forEach((p) => { const k = String(p.date).slice(0, 7); m[k] = (m[k] ?? 0) + n(p.amount); });
  return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
}
export function agingBuckets(invoices, payments, today) {
  const b = { 'Not yet due': 0, '1–30 days': 0, '31–60 days': 0, '61–90 days': 0, '90+ days': 0 };
  invoices.forEach((inv) => {
    const f = invoiceFigures(inv, payments, today);
    if (f.outstanding <= 0 || inv.status === 'void') return;
    const days = inv.dueDate ? Math.floor((Date.parse(today) - Date.parse(inv.dueDate)) / 86400000) : 0;
    const k = days <= 0 ? 'Not yet due' : days <= 30 ? '1–30 days' : days <= 60 ? '31–60 days' : days <= 90 ? '61–90 days' : '90+ days';
    b[k] += f.outstanding;
  });
  return b;
}
export const toCsv = (rows) => rows.map((r) => r.map((c) => { const s = String(c ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');

// ================================================================ Phase Three

export const DEFAULT_RULES = { allowOverpayment: false, allocation: 'oldest_first', minInstallment: 0, maxInstallments: 12, stackDiscounts: true };
export const rulesFrom = (settings) => ({ ...DEFAULT_RULES, ...(settings?.paymentRules ?? {}) });

// A payment tied to one invoice may not exceed what is still owed unless the school allows overpayment.
export function checkPaymentAgainstRules(amount, outstanding, rules = DEFAULT_RULES) {
  if (rules.allowOverpayment) return null;
  return n(amount) > outstanding + 0.005 ? `This is more than the outstanding balance of ${outstanding.toLocaleString('en-US')}. Record only what is owed, or ask an administrator to allow overpayments.` : null;
}

// ---------------------------------------------------------------- allocations
const dueOrder = (a, b) => String(a.dueDate ?? '9999').localeCompare(String(b.dueDate ?? '9999')) || String(a.number ?? a.id).localeCompare(String(b.number ?? b.id));
// Spread a payment over a family's open invoices, oldest due first. Whatever is left over is a credit balance.
export function autoAllocate(amount, openInvoices) {
  let left = n(amount); const allocations = [];
  [...openInvoices].filter((i) => i.outstanding > 0).sort(dueOrder).forEach((i) => {
    if (left <= 0) return;
    const take = Math.min(left, i.outstanding); allocations.push({ invoiceId: i.id, amount: take }); left -= take;
  });
  return { allocations, remainder: left };
}
// Manual allocation: every part positive, for this family's open invoices, never more than owed, never more than the payment.
export function validateAllocation(payment, allocations, outstandingById, rules = DEFAULT_RULES) {
  if (!allocations.length) return 'Choose at least one invoice.';
  const seen = new Set();
  for (const a of allocations) {
    if (!(n(a.amount) > 0)) return 'Each part must be more than zero.';
    if (seen.has(a.invoiceId)) return 'An invoice can only appear once.';
    seen.add(a.invoiceId);
    if (!(a.invoiceId in outstandingById)) return 'One of the invoices does not belong to this learner.';
    if (n(a.amount) > outstandingById[a.invoiceId] + 0.005 && !rules.allowOverpayment) return `A part is more than that invoice still owes (${outstandingById[a.invoiceId].toLocaleString('en-US')}).`;
  }
  if (sum(allocations, (a) => a.amount) > n(payment.amount) + 0.005) return 'The parts add up to more than the payment.';
  return null;
}

// ---------------------------------------------------------------- installment plans
export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
// Equal whole-shilling parts; the last one absorbs the rounding so the parts always add up exactly.
export function buildSchedule({ outstanding, count, firstDue, intervalMonths = 1 }, rules = DEFAULT_RULES) {
  const total = Math.round(n(outstanding));
  if (!(total > 0)) return { error: 'Nothing is owed on this invoice.' };
  if (!Number.isInteger(count) || count < 2) return { error: 'A plan needs at least 2 installments.' };
  if (count > rules.maxInstallments) return { error: `A plan can have at most ${rules.maxInstallments} installments.` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDue ?? '')) return { error: 'Choose the first due date.' };
  const base = Math.floor(total / count);
  if (base < n(rules.minInstallment)) return { error: `Each installment must be at least ${n(rules.minInstallment).toLocaleString('en-US')}.` };
  const schedule = Array.from({ length: count }, (_, i) => ({ no: i + 1, dueDate: addMonths(firstDue, i * intervalMonths), amount: i === count - 1 ? total - base * (count - 1) : base }));
  return { schedule };
}
// Money paid on the invoice SINCE the plan was made fills installments oldest first.
export function planProgress(plan, invoice, payments, creditNotes, today) {
  const paidNow = paidOn(invoice, payments);
  let pool = Math.max(0, paidNow - n(plan.basePaid));
  const installments = plan.schedule.map((i) => {
    const paid = Math.min(i.amount, pool); pool -= paid;
    const status = paid >= i.amount ? 'paid' : i.dueDate < today ? 'overdue' : paid > 0 ? 'partial' : 'upcoming';
    return { ...i, paid, status };
  });
  const f = invoiceFigures(invoice, payments, today, creditNotes);
  return { installments, completed: installments.every((i) => i.status === 'paid') || f.outstanding <= 0, overdue: installments.filter((i) => i.status === 'overdue').length, next: installments.find((i) => i.status !== 'paid') };
}

// ---------------------------------------------------------------- scholarships and sponsorships
// award: { id, type: 'scholarship'|'sponsorship', studentId, sponsor, kind: 'percent'|'amount', value, validFrom, validTo, status }
export const awardActive = (a, onDate) => a.status === 'approved' && (!a.validFrom || a.validFrom <= onDate) && (!a.validTo || a.validTo >= onDate);
export function awardDiscount(award, feeTotal) {
  const value = n(award.value);
  const amount = Math.min(Math.max(0, feeTotal), Math.round(award.kind === 'amount' ? value : (feeTotal * value) / 100));
  if (amount <= 0) return null;
  const who = award.type === 'sponsorship' && award.sponsor ? ` — ${award.sponsor}` : '';
  return { awardId: award.id, amount, sponsor: award.type === 'sponsorship' ? award.sponsor : undefined, awardType: award.type, label: `${award.type === 'sponsorship' ? 'Sponsorship' : 'Scholarship'}${who} (${award.kind === 'amount' ? `KES ${value}` : `${value}%`})` };
}
export function validateAward(a) {
  if (!a.studentId) return 'Choose a learner.';
  if (!['scholarship', 'sponsorship'].includes(a.type)) return 'Choose scholarship or sponsorship.';
  if (a.type === 'sponsorship' && !String(a.sponsor ?? '').trim()) return 'Enter the sponsor\'s name.';
  if (!(n(a.value) > 0)) return 'Enter the value.';
  if (a.kind === 'percent' && n(a.value) > 100) return 'A percentage cannot be more than 100.';
  if (a.validFrom && a.validTo && a.validTo < a.validFrom) return 'The end date is before the start date.';
  return null;
}
// What each sponsor has been billed through invoices, what they have paid, and what they still owe.
export function sponsorBalances(invoices, sponsorPayments) {
  const m = {};
  invoices.filter((i) => i.status !== 'void').forEach((i) => (i.items ?? []).filter((x) => x.kind === 'award' && x.sponsor).forEach((x) => { m[x.sponsor] ??= { sponsor: x.sponsor, claimed: 0, paid: 0 }; m[x.sponsor].claimed += Math.abs(n(x.amount)); }));
  sponsorPayments.filter(isConfirmed).forEach((p) => { m[p.sponsor] ??= { sponsor: p.sponsor, claimed: 0, paid: 0 }; m[p.sponsor].paid += n(p.amount); });
  return Object.values(m).map((r) => ({ ...r, balance: r.claimed - r.paid })).sort((a, b) => a.sponsor.localeCompare(b.sponsor));
}

// ---------------------------------------------------------------- credit notes
export const CREDIT_STATUS = { pending: 'Awaiting approval', approved: 'Approved', rejected: 'Rejected' };
export function validateCreditNote({ invoice, amount, reason }, existing = []) {
  if (!invoice) return 'Choose an invoice.';
  if (invoice.status === 'void') return 'That invoice is void.';
  if (!String(reason ?? '').trim()) return 'Give a reason for the credit note.';
  const a = n(amount);
  if (!(a > 0)) return 'Enter an amount greater than zero.';
  const used = sum(existing.filter((c) => c.invoiceId === invoice.id && c.status !== 'rejected'), (c) => c.amount);
  const room = n(invoice.totalAmount) - used;
  return a > room + 0.005 ? `A credit note cannot be more than the invoice is worth. At most ${Math.max(0, room).toLocaleString('en-US')} can still be credited.` : null;
}

// ---------------------------------------------------------------- fee statement (a ledger the family can read)
const dateOnly = (x) => String(x ?? '').slice(0, 10);
export function buildStatement({ studentId, invoices, payments, creditNotes = [], refunds = [], from = '', to = '9999-12-31' }) {
  const rows = [];
  invoices.filter((i) => i.studentId === studentId && i.status !== 'void').forEach((i) => rows.push({ date: dateOnly(i.issueDate ?? i.createdAt), order: 0, type: 'invoice', ref: i.number ?? '', description: 'Invoice', debit: n(i.totalAmount), credit: 0 }));
  payments.filter((p) => p.studentId === studentId && isConfirmed(p)).forEach((p) => rows.push({ date: dateOnly(p.date), order: 1, type: 'payment', ref: p.reference ?? '', description: `Payment (${p.method})`, debit: 0, credit: n(p.amount) }));
  creditNotes.filter((c) => c.studentId === studentId && c.status === 'approved').forEach((c) => rows.push({ date: dateOnly(c.decidedAt ?? c.createdAt), order: 1, type: 'credit_note', ref: c.number ?? '', description: `Credit note — ${c.reason}`, debit: 0, credit: n(c.amount) }));
  refunds.filter((r) => r.studentId === studentId && r.status === 'paid').forEach((r) => rows.push({ date: dateOnly(r.paidAt ?? r.updatedAt), order: 2, type: 'refund', ref: r.number ?? '', description: `Refund — ${r.reason}`, debit: n(r.amount), credit: 0 }));
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  let balance = 0; const opening = sum(rows.filter((r) => r.date < from), (r) => r.debit - r.credit);
  balance = opening;
  const lines = rows.filter((r) => r.date >= from && r.date <= to).map((r) => { balance += r.debit - r.credit; return { ...r, balance }; });
  const t = (type, f) => sum(lines.filter((l) => l.type === type), f);
  return { opening, lines, closing: balance, totals: { billed: t('invoice', (l) => l.debit), paid: t('payment', (l) => l.credit), credits: t('credit_note', (l) => l.credit), refunded: t('refund', (l) => l.debit) } };
}

// ---------------------------------------------------------------- cashbook
export const accountOfMethod = (m) => ({ cash: 'Cash', mpesa: 'M-Pesa', bank: 'Bank', cheque: 'Bank', swiftiq_pay: 'Bank' }[m] ?? 'Cash');
// Money in = confirmed receipts. Money out = refunds paid out + expenses. Running balance per day.
export function buildCashbook({ payments, refunds = [], expenses = [], sponsorPayments = [], from = '', to = '9999-12-31' }) {
  const rows = [];
  payments.filter(isConfirmed).forEach((p) => rows.push({ date: dateOnly(p.date), account: accountOfMethod(p.method), kind: 'Receipt', ref: p.reference ?? '', detail: 'Fee payment', inn: n(p.amount), out: 0 }));
  sponsorPayments.filter(isConfirmed).forEach((p) => rows.push({ date: dateOnly(p.date), account: accountOfMethod(p.method), kind: 'Sponsor', ref: p.reference ?? '', detail: p.sponsor, inn: n(p.amount), out: 0 }));
  refunds.filter((r) => r.status === 'paid').forEach((r) => rows.push({ date: dateOnly(r.paidAt ?? r.updatedAt), account: 'Cash', kind: 'Refund', ref: r.payoutReference ?? '', detail: r.reason, inn: 0, out: n(r.amount) }));
  expenses.forEach((e) => rows.push({ date: dateOnly(e.date), account: accountOfMethod(e.method), kind: 'Expense', ref: e.receiptReference ?? '', detail: [e.category, e.supplier, e.description].filter(Boolean).join(' · '), inn: 0, out: n(e.amount) }));
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const opening = sum(rows.filter((r) => r.date < from), (r) => r.inn - r.out);
  let bal = opening;
  const lines = rows.filter((r) => r.date >= from && r.date <= to).map((r) => { bal += r.inn - r.out; return { ...r, balance: bal }; });
  const byAccount = {}; lines.forEach((l) => { byAccount[l.account] ??= { inn: 0, out: 0 }; byAccount[l.account].inn += l.inn; byAccount[l.account].out += l.out; });
  return { opening, lines, closing: bal, totalIn: sum(lines, (l) => l.inn), totalOut: sum(lines, (l) => l.out), byAccount };
}

// ---------------------------------------------------------------- unmatched transactions (the manual review queue)
// Sorts every line of an imported statement into: already known, matches a pending payment, has ONE likely
// learner (by admission number in the account/narrative), has several, or has none. It only PROPOSES.
export function classifyTransactions(lines, { payments, students, known = [] }) {
  const refKey = (r) => String(r ?? '').trim().toLowerCase();
  const knownRefs = new Set([...known.map((k) => refKey(k.reference)), ...payments.filter((p) => p.status !== 'rejected' && !(p.status === 'pending_verification')).map((p) => refKey(p.reference))]);
  const pending = new Map(payments.filter((p) => p.status === 'pending_verification').map((p) => [refKey(p.reference), p]));
  const seen = new Set();
  const active = students.filter((s) => (s.status ?? 'active') === 'active' && s.admissionNumber);
  return lines.map((line) => {
    const k = refKey(line.reference);
    if (seen.has(k)) return { line, result: 'duplicate_line' };
    seen.add(k);
    if (pending.has(k)) { const p = pending.get(k); return { line, payment: p, result: Math.abs(n(p.amount) - line.amount) < 0.005 ? 'match' : 'amount_mismatch' }; }
    if (knownRefs.has(k)) return { line, result: 'already_known' };
    const text = ` ${String(line.account ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
    const hits = active.filter((s) => text.includes(` ${String(s.admissionNumber).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `));
    if (hits.length === 1) return { line, result: 'suggested', student: hits[0] };
    return { line, result: hits.length > 1 ? 'ambiguous' : 'unmatched', candidates: hits };
  });
}

// ---------------------------------------------------------------- dashboard figures
export function summaryBy(invoices, payments, creditNotes, keyOf) {
  const m = {};
  invoices.filter((i) => i.status !== 'void').forEach((i) => {
    const k = keyOf(i) ?? 'Other'; const f = invoiceFigures(i, payments, '9999-12-31', creditNotes);
    const r = (m[k] ??= { key: k, billed: 0, paid: 0, outstanding: 0 }); r.billed += f.billed; r.paid += f.paid - f.overpaid; r.outstanding += f.outstanding;
  });
  return Object.values(m).map((r) => ({ ...r, pct: r.billed ? Math.round((r.paid / r.billed) * 100) : null })).sort((a, b) => String(a.key).localeCompare(String(b.key)));
}
export function bursarMetrics({ invoices, payments, refunds = [], creditNotes = [], bankTx = [], today }) {
  const live = invoices.filter((i) => i.status !== 'void');
  const figs = live.map((i) => invoiceFigures(i, payments, today, creditNotes));
  const expected = sum(figs, (f) => f.billed);
  const collected = sum(payments.filter(isConfirmed), (p) => p.amount);
  const open = bankTx.filter((t) => ['unmatched', 'ambiguous', 'suggested'].includes(t.status));
  const days = {}; payments.filter(isConfirmed).forEach((p) => { const d = dateOnly(p.date); days[d] = days[d] ?? { count: 0, total: 0 }; days[d].count += 1; days[d].total += n(p.amount); });
  return {
    expected, collected, outstanding: sum(figs, (f) => f.outstanding), overpaid: sum(figs, (f) => f.overpaid),
    collectionPct: expected > 0 ? Math.round((Math.min(collected, expected) / expected) * 1000) / 10 : null,
    overdue: figs.filter((f) => f.overdue).length, pending: payments.filter((p) => p.status === 'pending_verification').length,
    unmatched: open.length, unmatchedAmount: sum(open, (t) => t.amount), pendingRefunds: refunds.filter((r) => ['requested', 'approved'].includes(r.status)).length,
    daily: Object.entries(days).sort(([a], [b]) => b.localeCompare(a)).slice(0, 7).map(([date, v]) => ({ date, ...v })),
  };
}

// ---------------------------------------------------------------- financial audit trail
export const FINANCE_COLLECTIONS = new Set(['invoices', 'payments', 'receipts', 'refunds', 'creditNotes', 'awards', 'sponsorPayments', 'installmentPlans', 'bankTransactions', 'adjustments', 'feeStructures', 'optionalCharges', 'studentCharges', 'expenses', 'bursarSettings']);
export const financeAudit = (entries) => entries.filter((e) => FINANCE_COLLECTIONS.has(e.entityType));
