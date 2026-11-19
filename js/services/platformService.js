// BUSINESS SIDE ONLY. Everything here runs on data shared across schools
// (registrations, invoices, settings). It never opens a school's data space,
// so the platform administrator cannot see students, marks, fees or any other
// school records — by design, not just by menu. Prototype authentication:
// browser-local, to be replaced by real server-side auth.

import { StorageManager } from '../storage/StorageManager.js';
import { uuid } from '../lib/uuid.js';
import { hashPassword, normalizeEmail, MIN_PASSWORD_LENGTH } from '../lib/passwords.js';
import { getPlan } from '../config/plans.js';
import { buildQuote, getCatalogue } from './packageService.js';
import { ADMIN_SESSION, listAccounts, updateAccount, clearSchoolSession } from './authService.js';
import { newSession, sessionState, touched } from '../lib/sessionPolicy.js';

const ADMINS = 'admins';
const INVOICES = 'platformInvoices';
const SETTINGS = 'platformSettings';
const COUNTER = 'invoiceCounter';

export const PAYMENT_METHODS = [
  ['mpesa', 'M-Pesa'],
  ['bank', 'Bank'],
  ['cash', 'Cash'],
  ['cheque', 'Cheque'],
  ['other', 'Other'],
];

// ---------------------------------------------------------------- admin login

function admins() {
  return StorageManager.getGlobal(ADMINS) ?? [];
}

export function adminExists() {
  return admins().length > 0;
}

// There is deliberately NO built-in administrator. The first person to open the platform console on
// a fresh install is asked to create one with their own password (see features/admin/adminAccess.js).
// Never ship a default account: a known password is a key to every school's billing and package data.

function startAdminSession(admin) {
  clearSchoolSession();
  StorageManager.setGlobal(ADMIN_SESSION, newSession({ adminId: admin.id }));
}

export function validateAdminSetup(d) {
  const errors = [];
  if (!d.name?.trim()) errors.push({ field: 'name', message: 'Enter your full name.' });
  const email = normalizeEmail(d.email);
  if (!email) errors.push({ field: 'email', message: 'Enter an email address to log in with.' });
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ field: 'email', message: "That email address doesn't look right." });
  if (!d.password || d.password.length < MIN_PASSWORD_LENGTH) {
    errors.push({ field: 'password', message: `Use at least ${MIN_PASSWORD_LENGTH} characters for the password.` });
  }
  if (d.password !== d.confirmPassword) errors.push({ field: 'confirmPassword', message: "The two passwords don't match." });
  return errors;
}

// Only the very first administrator can be created this way.
export function registerAdmin(d) {
  if (adminExists()) return undefined;
  const admin = { id: uuid(), name: d.name.trim(), email: normalizeEmail(d.email), salt: uuid(), passwordHash: '', createdAt: new Date().toISOString() };
  admin.passwordHash = hashPassword(d.password, admin.salt);
  StorageManager.setGlobal(ADMINS, [admin]);
  startAdminSession(admin);
  return publicAdmin(admin);
}

function publicAdmin(a) {
  return { id: a.id, name: a.name, email: a.email };
}

export function adminLogin(email, password) {
  const admin = admins().find((a) => a.email === normalizeEmail(email));
  if (!admin || admin.passwordHash !== hashPassword(password || '', admin.salt)) {
    return { ok: false, error: 'That email or password is incorrect.' };
  }
  startAdminSession(admin);
  return { ok: true, admin: publicAdmin(admin) };
}

export function restoreAdminSession() {
  const session = StorageManager.getGlobal(ADMIN_SESSION);
  if (session && sessionState(session, 'admin') === 'expired') { StorageManager.removeGlobal(ADMIN_SESSION); return null; }
  const admin = session && admins().find((a) => a.id === session.adminId);
  return admin ? publicAdmin(admin) : null;
}

export const hasAdminSession = () => Boolean(StorageManager.getGlobal(ADMIN_SESSION));

export function touchAdminSession() {
  const session = StorageManager.getGlobal(ADMIN_SESSION);
  if (session) StorageManager.setGlobal(ADMIN_SESSION, touched(session));
}

export function adminLogout() {
  StorageManager.removeGlobal(ADMIN_SESSION);
}

export function changeAdminPassword(adminId, current, next, confirm) {
  const list = admins();
  const admin = list.find((a) => a.id === adminId);
  if (!admin || admin.passwordHash !== hashPassword(current || '', admin.salt)) {
    return { ok: false, error: 'Your current password is incorrect.' };
  }
  if (!next || next.length < MIN_PASSWORD_LENGTH) return { ok: false, error: `Use at least ${MIN_PASSWORD_LENGTH} characters for the new password.` };
  if (next !== confirm) return { ok: false, error: "The two new passwords don't match." };
  const salt = uuid();
  StorageManager.setGlobal(ADMINS, list.map((a) => (a.id === adminId ? { ...a, salt, passwordHash: hashPassword(next, salt) } : a)));
  return { ok: true };
}

// ---------------------------------------------------------- business settings

export function getPlatformSettings() {
  return { businessName: 'SwiftIQ Enterprise', paymentInstructions: '', contactLine: 'Nairobi, Kenya · 0742 210 099 · swiftiqenterprise@gmail.com', legalName: 'SwiftIQ Enterprise', registeredAddress: 'Nairobi, Kenya', privacyEmail: 'swiftiqenterprise@gmail.com', privacyPhone: '0742 210 099', dpoName: '', odpcRegistration: '', dataLocation: '', subProcessors: '', retentionDays: 90, legalReviewedOn: '', ...(StorageManager.getGlobal(SETTINGS) ?? {}) };
}

export function savePlatformSettings(patch) {
  StorageManager.setGlobal(SETTINGS, { ...getPlatformSettings(), ...patch });
}

// ------------------------------------------------------------------- invoices

function invoices() {
  return StorageManager.getGlobal(INVOICES) ?? [];
}

function saveInvoices(list) {
  StorageManager.setGlobal(INVOICES, list);
}

export function invoiceTotals(invoice) {
  const total = invoice.items.reduce((sum, i) => sum + Number(i.amount || 0), 0);
  const paid = (invoice.payments ?? []).reduce((sum, p) => sum + p.amount, 0);
  return { total, paid, balance: total - paid };
}

function invoiceStatus(invoice) {
  if (invoice.voided) return 'void';
  const { total, paid } = invoiceTotals(invoice);
  if (total > 0 && paid >= total) return 'paid';
  return paid > 0 ? 'partial' : 'unpaid';
}

function withStatus(invoice) {
  return { ...invoice, status: invoiceStatus(invoice), ...invoiceTotals(invoice) };
}

export function invoicesForAccount(accountId) {
  return invoices().filter((i) => i.accountId === accountId).map(withStatus).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function allInvoices() {
  return invoices().map(withStatus).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getInvoice(id) {
  const found = invoices().find((i) => i.id === id);
  return found ? withStatus(found) : undefined;
}

// The package invoice, built from the live catalogue: the package price for the school's billing
// frequency, plus any add-ons it holds, less discounts — every line shown, total stated. Items still
// "to be confirmed" come through as zero so the administrator must type the agreed amount.
// Setup, training, data migration etc. are separate charges the administrator adds on purpose.
export function defaultInvoiceItems(account, extra = {}) {
  const pkg = getPlan(account.plan?.planId);
  if (!pkg) return [{ description: 'Package', amount: 0 }];
  const quote = buildQuote({ packageId: pkg.id, billing: account.plan?.billing ?? 'annual', addons: extra.addons ?? [], charges: extra.charges ?? [] }, getCatalogue());
  return quote.lines.map((l) => ({ description: l.amount == null ? `${l.label} (price to be confirmed)` : l.label, amount: l.amount ?? 0 }));
}

export function validateInvoice(items, dueDate) {
  const errors = [];
  const cleaned = items.filter((i) => String(i.description).trim() !== '' || String(i.amount).trim() !== '');
  if (cleaned.length === 0) errors.push('Add at least one line to the invoice.');
  cleaned.forEach((i, n) => {
    if (!String(i.description).trim()) errors.push(`Line ${n + 1} needs a description.`);
    if (String(i.amount).trim() === '' || Number.isNaN(Number(i.amount))) errors.push(`Line ${n + 1} needs an amount.`);
  });
  if (cleaned.length > 0 && cleaned.reduce((sum, i) => sum + Number(i.amount || 0), 0) <= 0) errors.push('The invoice total must be more than zero.');
  if (dueDate && Number.isNaN(Date.parse(dueDate))) errors.push('The due date is not a valid date.');
  return { errors, items: cleaned.map((i) => ({ description: String(i.description).trim(), amount: Number(i.amount) })) };
}

function nextInvoiceNumber() {
  const n = (StorageManager.getGlobal(COUNTER) ?? 0) + 1;
  StorageManager.setGlobal(COUNTER, n);
  return `INV-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`;
}

// meta (optional) marks an invoice as the subscription's own: { kind: 'subscription', packageId, billing, periodStart, renewal }.
// Paying such an invoice in full activates (or renews) the school's subscription by itself.
export function createInvoice(accountId, { items, dueDate, note, meta }, actorName) {
  const now = new Date().toISOString();
  const invoice = {
    id: uuid(),
    number: nextInvoiceNumber(),
    accountId,
    items,
    issueDate: now.slice(0, 10),
    dueDate: dueDate || undefined,
    note: note?.trim() || undefined,
    payments: [],
    voided: false,
    createdAt: now,
    ...(meta ?? {}),
  };
  saveInvoices([...invoices(), invoice]);
  addHistory(accountId, `Issued invoice ${invoice.number}`, actorName);
  return withStatus(invoice);
}

// Things that must happen when an invoice becomes fully paid (the automation registers itself here). Each hook returns a result or nothing.
const paidHooks = [];
export const onInvoicePaid = (fn) => { if (!paidHooks.includes(fn)) paidHooks.push(fn); };
export function markInvoice(invoiceId, patch) {
  saveInvoices(invoices().map((i) => (i.id === invoiceId ? { ...i, ...patch } : i)));
}
export const isOverdue = (invoice, today = new Date().toISOString().slice(0, 10)) => ['unpaid', 'partial'].includes(invoice.status) && Boolean(invoice.dueDate) && invoice.dueDate < today;

export function recordInvoicePayment(invoiceId, { amount, method, reference, date }, actorName) {
  const invoice = invoices().find((i) => i.id === invoiceId);
  if (!invoice) return { ok: false, error: 'This invoice could not be found.' };
  const value = Number(amount);
  const { balance } = invoiceTotals(invoice);
  if (invoice.voided) return { ok: false, error: 'This invoice has been voided.' };
  if (!value || value <= 0) return { ok: false, error: 'Enter the amount received.' };
  if (value > balance) return { ok: false, error: `That is more than the balance of ${balance.toLocaleString('en-US')}.` };
  if (!date || Number.isNaN(Date.parse(date))) return { ok: false, error: 'Enter the date the payment was received.' };
  const payment = { id: uuid(), amount: value, method, reference: reference?.trim() || undefined, date, recordedBy: actorName };
  saveInvoices(invoices().map((i) => (i.id === invoiceId ? { ...i, payments: [...(i.payments ?? []), payment] } : i)));
  addHistory(invoice.accountId, `Confirmed payment of ${value.toLocaleString('en-US')} on ${invoice.number}`, actorName);
  const after = getInvoice(invoiceId);
  const results = after.status === 'paid' ? paidHooks.map((h) => h(after, actorName)).filter(Boolean) : [];
  return { ok: true, invoice: after, automation: results };
}

export function voidInvoice(invoiceId, actorName) {
  const invoice = invoices().find((i) => i.id === invoiceId);
  if (!invoice) return;
  saveInvoices(invoices().map((i) => (i.id === invoiceId ? { ...i, voided: true } : i)));
  addHistory(invoice.accountId, `Voided invoice ${invoice.number}`, actorName);
}

// -------------------------------------------------------------------- schools

// Registration details only. The password hash, salt and the school's storage
// key are deliberately left out — the administrator never gets a handle on
// the school's data.
function sanitize(account) {
  const { salt, passwordHash, tenantId, ...safe } = account;
  return { ...safe, status: safe.status ?? 'approved', history: safe.history ?? [] };
}

export function paymentState(accountId) {
  const live = invoicesForAccount(accountId).filter((i) => i.status !== 'void');
  if (live.length === 0) return { state: 'none', invoiced: 0, paid: 0, balance: 0 };
  const invoiced = live.reduce((sum, i) => sum + i.total, 0);
  const paid = live.reduce((sum, i) => sum + i.paid, 0);
  const state = live.every((i) => i.status === 'paid') ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  return { state, invoiced, paid, balance: invoiced - paid };
}

function withPayment(school) {
  return { ...school, payment: paymentState(school.id) };
}

export function listSchools() {
  return listAccounts().map(sanitize).map(withPayment).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getSchool(id) {
  const account = listAccounts().find((a) => a.id === id);
  return account ? withPayment(sanitize(account)) : undefined;
}

export function deleteSchool() {
  throw new Error('School deletion is unavailable in demo mode.');
}

function addHistory(accountId, action, by) {
  const account = listAccounts().find((a) => a.id === accountId);
  if (!account) return;
  updateAccount(accountId, { history: [...(account.history ?? []), { at: new Date().toISOString(), action, by: by ?? 'Administrator' }] });
}

const STATUS_ACTION = {
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
};

export function setSchoolStatus(accountId, status, note, actorName) {
  const patch = { status, statusNote: note?.trim() || undefined };
  if (status === 'approved') patch.approvedAt = new Date().toISOString();
  updateAccount(accountId, patch);
  addHistory(accountId, `${STATUS_ACTION[status] ?? status}${note ? ` — ${note.trim()}` : ''}`, actorName);
}

export function changeSchoolPlan(accountId, planId, billing, actorName) {
  const plan = getPlan(planId);
  if (!plan) return false;
  const b = ['monthly', 'termly', 'annual'].includes(billing) ? billing : 'annual';
  updateAccount(accountId, { plan: { planId: plan.id, name: plan.name, billing: b } });
  addHistory(accountId, `Changed package to ${plan.name} (billed ${b})`, actorName);
  return true;
}
