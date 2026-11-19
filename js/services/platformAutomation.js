// What the Super Admin no longer has to do by hand (local/demo mode; the cloud version moves into the server in the backend phase).
//   approve a school  →  its package is allocated  →  a trial starts  →  the first invoice is issued
//   an invoice is paid in full  →  the subscription activates (or renews) by itself
//   a subscription nears its end  →  the renewal invoice is created
// Every step is written to the school's history and the platform audit log, and each automatic step can be switched off in the
// control centre (catalogue.automation). Nothing here opens a school's own records.
import { StorageManager } from '../storage/StorageManager.js';
import { getPlan } from '../config/plans.js';
import { getCatalogue, buildQuote, expiryFor, addDays, effectiveStatus, suggestPackage, enabledBilling, packageById, BILLING_LABEL } from './packageService.js';
import * as P from './platformService.js';
import * as S from './subscriptionService.js';
import { currentAccount, listAccounts } from './authService.js';

const RUN_KEY = 'platformAutomationRun';
const iso = (d = new Date()) => d.toISOString().slice(0, 10);
const AUTO = 'Automation';
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// The invoice lines for a subscription period, straight from the live catalogue.
export function subscriptionQuote({ packageId, billing, addons = [] }) {
  return buildQuote({ packageId, billing, addons, charges: [] }, getCatalogue());
}
const invoiceItemsFromQuote = (q) => q.lines.filter((l) => l.amount != null && l.amount !== 0).map((l) => ({ description: l.label, amount: l.amount }));

function billingFor(school) {
  const on = enabledBilling(getCatalogue()).map(([k]) => k);
  return on.includes(school.plan?.billing) ? school.plan.billing : on[0] ?? 'annual';
}

// Has this exact period already been invoiced (and the invoice not voided)? Prevents duplicates on repeat clicks and repeat runs.
const existingPeriodInvoice = (accountId, periodStart) => P.invoicesForAccount(accountId).find((i) => i.kind === 'subscription' && i.status !== 'void' && i.periodStart === periodStart);

function issueSubscriptionInvoice(school, { packageId, billing, addons = [], periodStart, dueDate, renewal }, actor) {
  const dup = existingPeriodInvoice(school.id, periodStart); if (dup) return { invoice: dup, reused: true };
  const q = subscriptionQuote({ packageId, billing, addons });
  if (!q.ok || q.needsQuotation || q.total <= 0) return { invoice: null, reason: q.needsQuotation ? 'Some prices are still "to be confirmed", so this needs a quotation.' : 'The package has no price set.' };
  const invoice = P.createInvoice(school.id, { items: invoiceItemsFromQuote(q), dueDate, note: renewal ? 'Subscription renewal' : 'First subscription invoice', meta: { kind: 'subscription', packageId, billing, addons, periodStart, renewal: Boolean(renewal) } }, actor);
  return { invoice, reused: false };
}

// ---------------------------------------------------------------- approval
// One click: approve, allocate the package the school chose, start the trial, issue the first invoice.
export function approveAndAllocate(accountId, actor = 'Administrator', opts = {}) {
  const school = P.getSchool(accountId);
  if (!school) return { ok: false, error: 'School not found.' };
  if (!['pending', 'rejected'].includes(school.status)) return { ok: false, error: 'This school is already approved or suspended.' };
  const cat = getCatalogue(); const cfg = cat.automation ?? {}; const notes = [];
  let plan = getPlan(school.plan?.planId);
  if (!plan || !plan.active) { plan = suggestPackage(school.studentCount, cat); P.changeSchoolPlan(accountId, plan.id, billingFor(school), actor); notes.push(`No valid package had been chosen, so ${plan.name} was allocated from the ${school.studentCount ?? 'declared'} students.`); }
  if (!plan.custom && school.studentCount && school.studentCount > plan.paidLimit + (plan.overflow ?? 0)) notes.push(`The school declared ${school.studentCount} students, above ${plan.name}'s limit of ${plan.paidLimit}. Consider a larger package.`);
  const billing = billingFor(school);
  const existing = S.localSubscriptionOf(accountId);
  const chosen = existing?.requested ?? { packageId: plan.id, billing, addons: [] }; // a request the school made itself wins
  const sel = { packageId: chosen.packageId ?? plan.id, billing: chosen.billing ?? billing, addons: chosen.addons ?? [] };
  const quote = subscriptionQuote(sel);
  const trial = (opts.startTrial ?? cfg.startTrialOnApproval) && Number(cat.trialDays) > 0 && !quote.needsQuotation;
  const today = iso();
  P.setSchoolStatus(accountId, 'approved', 'Approved; package allocated', actor);
  const trialUntil = trial ? addDays(today, Number(cat.trialDays)) : null;
  S.localSetSubscription(accountId, { packageId: sel.packageId, billing: sel.billing, addons: sel.addons, status: trial ? 'trial' : 'requested', trialUntil, startDate: undefined, expiryDate: undefined,
    requested: { ...sel, charges: [], quote, requestedAt: new Date().toISOString() } }, `Approved: ${packageById(sel.packageId, cat)?.name} (${sel.billing}) allocated`, actor);
  let invoice = null;
  if (opts.invoice ?? cfg.invoiceOnApproval) {
    const due = trial ? trialUntil : addDays(today, Number(cfg.invoiceDueDays ?? 14));
    const r = issueSubscriptionInvoice(P.getSchool(accountId), { ...sel, periodStart: today, dueDate: due, renewal: false }, actor);
    invoice = r.invoice; if (!invoice) notes.push(`${r.reason} No invoice was issued.`);
  }
  if (trial) notes.push(`${cat.trialDays}-day trial started; the school has full access to ${packageById(sel.packageId, cat)?.name} until ${trialUntil}.`);
  else if (!quote.needsQuotation) notes.push('No trial: the school only has its essential records until the invoice is paid.');
  return { ok: true, school: P.getSchool(accountId), packageName: packageById(sel.packageId, cat)?.name, billing: sel.billing, trial, trialUntil, invoice, notes };
}
export function approveMany(ids, actor, opts) {
  const results = ids.map((id) => ({ id, ...approveAndAllocate(id, actor, opts) }));
  return { approved: results.filter((r) => r.ok), failed: results.filter((r) => !r.ok), invoices: results.filter((r) => r.invoice).length };
}

// ---------------------------------------------------------------- payment → activation
// The first invoice starts the subscription today; a renewal invoice continues from the day after the current one ends
// (or from today if it already lapsed). Idempotent: an invoice activates at most once.
export function activateFromInvoice(invoice, actor = AUTO) {
  if (!invoice || invoice.kind !== 'subscription' || invoice.activatedAt || invoice.status !== 'paid') return null;
  const cat = getCatalogue(); const sub = S.localSubscriptionOf(invoice.accountId);
  const continues = invoice.renewal && sub?.status === 'active' && sub.expiryDate && sub.expiryDate >= addDays(iso(), -(cat.graceDays ?? 0));
  const start = continues ? invoice.periodStart : iso();
  const expiry = expiryFor(start, invoice.billing, cat);
  const ref = (invoice.payments ?? []).map((p) => p.reference).filter(Boolean).pop();
  const next = S.localSetSubscription(invoice.accountId, { status: 'active', packageId: invoice.packageId, billing: invoice.billing, addons: invoice.addons ?? sub?.addons ?? [], startDate: start, expiryDate: expiry, trialUntil: null, nextPackageId: undefined,
    requested: undefined, paymentReference: ref, activatedAt: new Date().toISOString() }, `Invoice ${invoice.number} paid in full`, actor);
  P.markInvoice(invoice.id, { activatedAt: next.activatedAt });
  return { accountId: invoice.accountId, packageId: invoice.packageId, start, expiry, renewal: Boolean(invoice.renewal), invoiceNumber: invoice.number };
}
P.onInvoicePaid((inv, actor) => activateFromInvoice(inv, actor)); // paying a subscription invoice in full activates it, wherever the payment is recorded

// A payment the school submitted (reference + amount) is verified here. It also settles the matching open invoice, so the books agree.
export async function verifyPaymentAuto(paymentId, { approve, note, actor = 'Administrator' }) {
  const pay = S.localAllPayments().find((p) => p.id === paymentId); if (!pay) throw new Error('Payment not found.');
  const open = approve ? P.invoicesForAccount(pay.schoolId).filter((i) => i.kind === 'subscription' && ['unpaid', 'partial'].includes(i.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] : null;
  const sub = S.localSubscriptionOf(pay.schoolId);
  const continues = open?.renewal && sub?.status === 'active' && sub.expiryDate >= iso();
  const result = await S.verifyPayment(paymentId, { approve, note, startDate: continues ? open.periodStart : undefined });
  if (!approve || !open) return { subscription: result, invoice: null };
  P.markInvoice(open.id, { activatedAt: new Date().toISOString() }); // verifyPayment has just activated it; stop the paid-hook from doing it twice
  const apply = Math.min(Number(pay.amount), open.balance);
  const r = P.recordInvoicePayment(open.id, { amount: apply, method: pay.method === 'mpesa' || pay.method === 'bank' || pay.method === 'cash' ? pay.method : 'other', reference: pay.reference, date: iso() }, actor);
  return { subscription: result, invoice: r.ok ? r.invoice : null };
}

// ---------------------------------------------------------------- renewals
function renewalCandidates(now = new Date()) {
  const cat = getCatalogue(); const window = Number(cat.automation?.renewalWindowDays ?? 30); const today = iso(now);
  return P.listSchools().filter((s) => s.status === 'approved').map((s) => ({ school: s, sub: S.localSubscriptionOf(s.id) }))
    .filter(({ sub }) => sub?.status === 'active' && sub.expiryDate && daysBetween(today, sub.expiryDate) <= window)
    .map(({ school, sub }) => ({ school, sub, expiry: sub.expiryDate, periodStart: addDays(sub.expiryDate, 1), daysLeft: daysBetween(today, sub.expiryDate), invoice: existingPeriodInvoice(school.id, addDays(sub.expiryDate, 1)) ?? null }));
}
export function renewalsPending(now) { return renewalCandidates(now).filter((c) => !c.invoice); }

// Creates the renewal invoice for every subscription ending within the window that does not have one yet.
export function createRenewalInvoices(actor = AUTO, now = new Date()) {
  const created = []; const skipped = [];
  for (const c of renewalsPending(now)) {
    const next = { packageId: c.sub.nextPackageId ?? c.sub.packageId, billing: c.sub.billing, addons: c.sub.addons ?? [] }; // a downgrade chosen earlier takes effect here
    const r = issueSubscriptionInvoice(c.school, { ...next, periodStart: c.periodStart, dueDate: c.expiry, renewal: true }, actor);
    if (!r.invoice) { skipped.push({ school: c.school.schoolName, reason: r.reason }); continue; }
    // let the school submit a payment reference against the renewal, exactly as it does for the first invoice
    S.localSetSubscription(c.school.id, { requested: { ...next, charges: [], quote: subscriptionQuote(next), requestedAt: new Date().toISOString(), renewal: true } }, `Renewal invoice ${r.invoice.number} created`, actor);
    created.push({ school: c.school.schoolName, invoice: r.invoice });
  }
  return { created, skipped };
}

// Runs once a day, the first time the console is opened that day (there is no server clock in demo mode).
export function runDailyAutomation(actor = AUTO, { force = false, now = new Date() } = {}) {
  const last = StorageManager.getGlobal(RUN_KEY); const cfg = getCatalogue().automation ?? {};
  if (!force && last?.date === iso(now)) return { ran: false, last };
  const out = cfg.autoRenewalInvoices === false ? { created: [], skipped: [] } : createRenewalInvoices(actor, now);
  const record = { date: iso(now), at: new Date().toISOString(), renewalInvoices: out.created.length, skipped: out.skipped.length };
  StorageManager.setGlobal(RUN_KEY, record);
  return { ran: true, last: record, ...out };
}
export const lastRun = () => StorageManager.getGlobal(RUN_KEY) ?? null;

// ---------------------------------------------------------------- what needs the Super Admin
export function attention(now = new Date()) {
  const cat = getCatalogue(); const today = iso(now); const schools = P.listSchools(); const names = Object.fromEntries(schools.map((s) => [s.id, s.schoolName]));
  const pending = schools.filter((s) => s.status === 'pending').map((s) => {
    const plan = getPlan(s.plan?.planId); const sel = { packageId: plan?.id, billing: billingFor(s), addons: S.localSubscriptionOf(s.id)?.requested?.addons ?? [] };
    const q = plan ? subscriptionQuote(sel) : null;
    return { school: s, plan, billing: sel.billing, total: q?.total ?? 0, needsQuotation: !plan || q.needsQuotation, overBand: Boolean(plan && !plan.custom && s.studentCount && s.studentCount > plan.paidLimit + (plan.overflow ?? 0)) };
  });
  const toVerify = S.localAllPayments().filter((p) => p.status === 'awaiting_verification');
  const overdue = P.allInvoices().filter((i) => P.isOverdue(i, today)).map((i) => ({ invoice: i, schoolName: names[i.accountId] ?? 'Unknown school', daysLate: daysBetween(i.dueDate, today) }));
  const renewals = renewalCandidates(now);
  const trials = schools.map((s) => ({ school: s, sub: S.localSubscriptionOf(s.id) })).filter(({ sub }) => sub?.status === 'trial' && sub.trialUntil && daysBetween(today, sub.trialUntil) <= 5)
    .map(({ school, sub }) => ({ school, trialUntil: sub.trialUntil, daysLeft: daysBetween(today, sub.trialUntil) }));
  const nearCapacity = schools.filter((s) => s.status === 'approved').map((s) => {
    const row = { schoolId: s.id, schoolName: s.schoolName, status: s.status, declaredStudents: s.studentCount, activeStudents: countStudents(s), subscription: S.localSubscriptionOf(s.id), pendingPayments: 0 };
    const sum = S.summariseSchool(row, cat); return { school: s, level: sum.capacity.level, active: row.activeStudents, max: sum.limits.max };
  }).filter((x) => ['warn', 'warning', 'over_limit', 'full'].includes(x.level));
  return { pending, toVerify: toVerify.map((p) => ({ ...p, schoolName: names[p.schoolId] ?? p.schoolName })), overdue, overdueTotal: overdue.reduce((t, o) => t + o.invoice.balance, 0), renewals, trials, nearCapacity,
    total: pending.length + toVerify.length + overdue.length + trials.length + renewals.filter((r) => !r.invoice).length };
}
function countStudents(school) {
  const account = listAccounts().find((a) => a.id === school.id);
  try { return StorageManager.peekTenantRecords(account.tenantId, 'students').filter((s) => !['archived', 'graduated', 'withdrawn', 'transferred'].includes(s.status)).length; } catch { return 0; }
}

// A polite payment reminder, ready to paste into SMS, WhatsApp or email.
export function reminderText(invoice, school, settings = P.getPlatformSettings()) {
  const late = P.isOverdue(invoice) ? ` It was due on ${invoice.dueDate}.` : invoice.dueDate ? ` It is due on ${invoice.dueDate}.` : '';
  return `Hello ${school.name}, a reminder from ${settings.businessName}: invoice ${invoice.number} for ${getCatalogue().currency} ${invoice.balance.toLocaleString('en-US')} is still unpaid.${late}${settings.paymentInstructions ? ` ${settings.paymentInstructions}` : ''} Please send your payment reference once paid so we can activate it straight away. Thank you.`;
}

// The signed-in school's own invoices from the platform (for the Subscription page).
export function myInvoices() {
  const me = currentAccount(); const owner = me && listAccounts().find((a) => a.tenantId === me.tenantId);
  return owner ? P.invoicesForAccount(owner.id).filter((i) => i.status !== 'void') : [];
}
export { BILLING_LABEL };

// ---------------------------------------------------------------- changing a school's package
// One call does everything: the school's modules and student limit follow the new package at once, and money is handled by the rules below.
//   active, moving UP    -> takes effect now; an invoice for the pro-rated difference for the days left is issued
//   active, moving DOWN  -> takes effect at the next renewal (they have paid for the current package); the renewal invoice is at the new price
//   trial / awaiting first payment / expired -> takes effect now; the unpaid first invoice is cancelled and reissued at the new price
export function changePackage(accountId, newPackageId, actor = 'Administrator', { billing } = {}) {
  const school = P.getSchool(accountId); if (!school) return { ok: false, error: 'School not found.' };
  const cat = getCatalogue(); const pkg = packageById(newPackageId, cat);
  if (!pkg || pkg.active === false) return { ok: false, error: 'Choose an available package.' };
  const sub = S.localSubscriptionOf(accountId); const period = billing ?? sub?.billing ?? billingFor(school);
  if (sub?.packageId === newPackageId && period === sub.billing && !sub.nextPackageId) return { ok: false, error: 'The school is already on that package.' };
  const quote = subscriptionQuote({ packageId: newPackageId, billing: period, addons: sub?.addons ?? [] });
  if (pkg.custom || quote.needsQuotation) return { ok: false, error: `${pkg.name} is priced by quotation. Agree the price first, then set it in Packages.` };
  const today = iso(); const notes = [];
  const status = sub ? effectiveStatus(sub, new Date(), cat.graceDays ?? 0) : 'none';
  if (status === 'active' && sub.expiryDate) {
    const oldPrice = packageById(sub.packageId, cat)?.prices?.[sub.billing]; const newPrice = pkg.prices?.[sub.billing];
    if (period !== sub.billing) return { ok: false, error: 'To change the billing period, wait for the renewal or ask the school to renew on the new period.' };
    if (newPrice != null && oldPrice != null && newPrice > oldPrice) {
      const total = Math.max(1, daysBetween(sub.startDate ?? addDays(sub.expiryDate, -365), sub.expiryDate)); const left = Math.max(0, daysBetween(today, sub.expiryDate));
      const diff = Math.round(((newPrice - oldPrice) * left) / total);
      P.changeSchoolPlan(accountId, newPackageId, sub.billing, actor);
      S.localSetSubscription(accountId, { packageId: newPackageId, nextPackageId: undefined }, `Upgraded to ${pkg.name}`, actor);
      let invoice = null;
      if (diff > 0) invoice = P.createInvoice(accountId, { items: [{ description: `Upgrade to ${pkg.name}: difference for the ${left} days left in the period`, amount: diff }], dueDate: addDays(today, Number(getCatalogue().automation?.invoiceDueDays ?? 14)), note: 'Package upgrade', meta: { kind: 'adjustment' } }, actor);
      notes.push(`${pkg.name} is open now with its new student limit.`, invoice ? `Upgrade invoice ${invoice.number} for the remaining ${left} days issued.` : 'No extra charge: the period is almost over.');
      return { ok: true, mode: 'now', packageName: pkg.name, invoice, notes };
    }
    P.changeSchoolPlan(accountId, newPackageId, sub.billing, actor);
    S.localSetSubscription(accountId, { nextPackageId: newPackageId }, `Will move to ${pkg.name} at renewal`, actor);
    notes.push(`The school keeps ${packageById(sub.packageId, cat)?.name} until ${sub.expiryDate}, then moves to ${pkg.name}. The renewal invoice will be at the new price.`);
    return { ok: true, mode: 'at_renewal', effective: addDays(sub.expiryDate, 1), packageName: pkg.name, invoice: null, notes };
  }
  // no payment made against the current package yet: switch now and reissue the first invoice
  const open = P.invoicesForAccount(accountId).filter((i) => i.kind === 'subscription' && !i.activatedAt && ['unpaid', 'partial'].includes(i.status));
  if (open.some((i) => (i.payments ?? []).length)) return { ok: false, error: 'Part of the first invoice has already been paid. Ask the school to finish paying, then change the package.' };
  open.forEach((i) => P.voidInvoice(i.id, actor));
  P.changeSchoolPlan(accountId, newPackageId, period, actor);
  const sel = { packageId: newPackageId, billing: period, addons: sub?.addons ?? [] };
  S.localSetSubscription(accountId, { ...sel, nextPackageId: undefined, requested: { ...sel, charges: [], quote, requestedAt: new Date().toISOString() } }, `Package changed to ${pkg.name}`, actor);
  const due = sub?.status === 'trial' && sub.trialUntil ? sub.trialUntil : addDays(today, Number(getCatalogue().automation?.invoiceDueDays ?? 14));
  const r = issueSubscriptionInvoice(P.getSchool(accountId), { ...sel, periodStart: today, dueDate: due, renewal: false }, actor);
  if (open.length) notes.push(`${open.length === 1 ? 'The earlier unpaid invoice was' : 'Earlier unpaid invoices were'} cancelled.`);
  notes.push(r.invoice ? `New invoice ${r.invoice.number} for ${pkg.name} issued.` : 'No invoice was issued: the price is not set.');
  return { ok: true, mode: 'reissued', packageName: pkg.name, invoice: r.invoice, notes };
}
