// Everything about a school's subscription at runtime: what it may use, how many students it
// may enrol, and the request -> payment -> VERIFIED -> active workflow. Two backends behind
// one API: browser-local (prototype) and Supabase RPCs (cloud). The pure rules live in
// packageService.js / capacityService.js; this file only stores and moves the data.
import { StorageManager } from '../storage/StorageManager.js';
import { isSupabaseConfigured } from '../config/supabase.js';
import { listAccounts, currentAccount } from './authService.js';
import { uuid } from '../lib/uuid.js';
import {
  getCatalogue, loadCatalogue, saveCatalogueLocal, setCatalogueCache, normaliseCatalogue, resolveEntitlements, effectiveLimits,
  effectiveStatus, renewalState, buildQuote, expiryFor, suggestPackage,
} from './packageService.js';
import { capacityStatus, countActiveStudents } from './capacityService.js';
import { setLimitsProvider } from './capacityGuard.js';
import { MODULE_BY_KEY, FEATURE_BY_KEY } from '../config/features.js';

const SUBS = 'schoolSubscriptions';   // { [ownerAccountId]: subscription }   (browser-local mode)
const PAYMENTS = 'subscriptionPayments';
const AUDIT = 'platformAudit';
const remote = () => isSupabaseConfigured();
const rpc = async (name, args) => {
  const { getSupabaseClient } = await import('./supabaseClient.js');
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
};

// ---------------------------------------------------------------- local stores
const localSubs = () => StorageManager.getGlobal(SUBS) ?? {};
const localPayments = () => StorageManager.getGlobal(PAYMENTS) ?? [];
function audit(schoolId, action, reason, detail, by = 'Platform administrator') {
  const log = StorageManager.getGlobal(AUDIT) ?? [];
  StorageManager.setGlobal(AUDIT, [{ id: uuid(), at: new Date().toISOString(), schoolId, action, reason: reason || null, detail: detail ?? null, by }, ...log].slice(0, 2000));
}
const ownerOfTenant = (tenantId) => listAccounts().find((a) => a.tenantId === tenantId);

// ---------------------------------------------------------------- the signed-in school
let remoteContext = null; // { schoolId, subscription, activeStudents } for the cloud school

export async function loadSubscriptionContext() {
  await loadCatalogue();
  if (!remote()) return;
  try {
    remoteContext = await rpc('get_my_subscription', {});
  } catch {
    remoteContext = null; // migration not applied yet: behave like a legacy school (nothing restricted)
  }
}

export function currentSubscription() {
  if (remote()) return remoteContext?.subscription ?? null;
  const me = currentAccount();
  const owner = me && ownerOfTenant(me.tenantId);
  return owner ? localSubs()[owner.id] ?? null : null;
}

function currentDeclared() {
  if (remote()) return undefined;
  const me = currentAccount();
  return me && ownerOfTenant(me.tenantId)?.studentCount;
}

export const currentEntitlements = () => resolveEntitlements(currentSubscription(), getCatalogue());
export const currentLimits = () => effectiveLimits(currentSubscription(), getCatalogue(), { declaredStudents: currentDeclared() });

export function moduleEnabled(key) {
  const meta = MODULE_BY_KEY[key];
  if (!meta) return true;            // unknown keys (e.g. account pages) are not package-gated
  if (meta.essential) return true;   // essential records are never switched off by a package
  return Boolean(currentEntitlements().modules[key]);
}
export function featureEnabled(key) {
  const f = FEATURE_BY_KEY[key];
  if (!f) return true;
  const ent = currentEntitlements();
  if (ent.legacy) return true;
  return Boolean(ent.features[key]) && moduleEnabled(f.module);
}

// Student count for the signed-in school (local mode only; cloud mode reads it from the server).
export const currentActiveStudents = () => (remote() ? remoteContext?.activeStudents ?? 0 : countActiveStudents(StorageManager.all('students')));

export function currentCapacity() {
  return capacityStatus(currentActiveStudents(), currentLimits());
}

// The storage layer asks this before it enrols anybody (local mode). Cloud mode is enforced by the database.
setLimitsProvider(() => (remote() ? null : currentLimits()));

export async function refreshCapacity() {
  if (remote()) {
    try { remoteContext = await rpc('get_my_subscription', {}); } catch { /* keep the last known value */ }
  }
  return currentCapacity();
}

// ---------------------------------------------------------------- school-side workflow
export function suggestedPackageForSchool() {
  return suggestPackage(currentActiveStudents() || currentDeclared());
}

export async function requestSubscription(selection) {
  const quote = buildQuote(selection);
  if (!quote.ok) throw new Error(quote.error);
  if (remote()) {
    remoteContext = { ...(remoteContext ?? {}), subscription: await rpc('request_subscription', { selection, quote_json: quote }) };
    return quote;
  }
  const me = currentAccount();
  const owner = me && ownerOfTenant(me.tenantId);
  if (!owner) throw new Error('Sign in as a school first.');
  const all = localSubs();
  const cur = all[owner.id] ?? {};
  const requested = { packageId: selection.packageId, billing: selection.billing, addons: selection.addons ?? [], charges: selection.charges ?? [], quote, requestedAt: new Date().toISOString() };
  all[owner.id] = { ...cur, requested, ...(cur.status ? {} : { status: 'requested', packageId: selection.packageId, billing: selection.billing, addons: selection.addons ?? [] }) };
  StorageManager.setGlobal(SUBS, all);
  audit(owner.id, 'Subscription requested', null, selection, owner.schoolName);
  return quote;
}

// Records what the school says it paid. It never activates anything by itself.
export async function submitPayment({ method, reference, amount, note }) {
  const ref = String(reference ?? '').trim();
  if (!ref) throw new Error('Enter the payment reference.');
  const value = Number(amount);
  if (!value || value <= 0) throw new Error('Enter the amount you paid.');
  if (remote()) return rpc('submit_subscription_payment', { pay_method: method, pay_reference: ref, pay_amount: value, pay_note: note ?? null });
  const me = currentAccount();
  const owner = me && ownerOfTenant(me.tenantId);
  const sub = owner && localSubs()[owner.id];
  if (!sub?.requested) throw new Error('Choose a package and submit a subscription request first.');
  if (localPayments().some((p) => p.reference.toLowerCase() === ref.toLowerCase() && p.status !== 'rejected')) throw new Error('This payment reference has already been submitted.');
  const payment = { id: uuid(), schoolId: owner.id, schoolName: owner.schoolName, method, reference: ref, amount: value, note: note ?? null, status: 'awaiting_verification', quote: sub.requested.quote, submittedAt: new Date().toISOString() };
  StorageManager.setGlobal(PAYMENTS, [payment, ...localPayments()]);
  audit(owner.id, 'Payment submitted for verification', null, { reference: ref, amount: value, method }, owner.schoolName);
  return payment.id;
}

// Synchronous local-mode helpers for the platform automation (cloud mode does these on the server, in the backend phase).
export const localSubscriptionOf = (schoolId) => localSubs()[schoolId] ?? null;
export function localSetSubscription(schoolId, patch, reason, by) {
  const all = localSubs(); const before = all[schoolId] ?? null;
  all[schoolId] = { ...(before ?? {}), ...patch };
  StorageManager.setGlobal(SUBS, all);
  audit(schoolId, 'Subscription changed', reason, { before, after: all[schoolId] }, by);
  return all[schoolId];
}
export const localAllPayments = () => localPayments();

export async function listMyPayments() {
  if (remote()) return rpc('list_subscription_payments', { target_school: null });
  const me = currentAccount();
  const owner = me && ownerOfTenant(me.tenantId);
  return owner ? localPayments().filter((p) => p.schoolId === owner.id) : [];
}

// ---------------------------------------------------------------- platform (Super Admin) side
export async function listSchoolSubscriptions() {
  if (remote()) return rpc('list_school_subscriptions', {});
  const subs = localSubs();
  const pays = localPayments();
  return listAccounts().map((a) => ({
    schoolId: a.id,
    schoolName: a.schoolName,
    status: a.status ?? 'approved',
    declaredStudents: a.studentCount,
    activeStudents: countActiveStudents(StorageManager.peekTenantRecords(a.tenantId, 'students')),
    subscription: subs[a.id] ?? null,
    pendingPayments: pays.filter((p) => p.schoolId === a.id && p.status === 'awaiting_verification').length,
  }));
}

// `patch` replaces whole top-level keys (package, billing, limits, overrides, status, trialUntil...).
export async function adminSetSubscription(schoolId, patch, reason) {
  if (!String(reason ?? '').trim()) throw new Error('Record a reason for this change.');
  if (remote()) return rpc('admin_set_subscription', { target_school: schoolId, patch, reason_text: reason });
  const all = localSubs();
  const before = all[schoolId] ?? null;
  all[schoolId] = { ...(before ?? {}), ...patch };
  StorageManager.setGlobal(SUBS, all);
  audit(schoolId, 'Subscription changed', reason, { before, after: all[schoolId] });
  return all[schoolId];
}

export async function saveCatalogue(raw, reason) {
  const next = normaliseCatalogue(raw);
  if (remote()) {
    await rpc('save_platform_catalogue', { new_catalogue: next, reason_text: reason ?? null });
    setCatalogueCache(next);
    return next;
  }
  saveCatalogueLocal(next);
  audit(null, 'Catalogue updated', reason, null);
  return next;
}

export async function listPayments() {
  if (remote()) return rpc('list_subscription_payments', { target_school: null });
  return localPayments();
}

// The ONLY path from "requested" to "active". A reference or screenshot alone never gets here.
export async function verifyPayment(paymentId, { approve, note, startDate }) {
  const start = startDate || new Date().toISOString().slice(0, 10);
  if (remote()) return rpc('verify_subscription_payment', { payment_id: paymentId, approve, verify_text: note ?? null, start_on: start });
  const pays = localPayments();
  const pay = pays.find((p) => p.id === paymentId);
  if (!pay) throw new Error('Payment not found.');
  if (pay.status !== 'awaiting_verification') throw new Error(`This payment has already been ${pay.status}.`);
  pay.status = approve ? 'verified' : 'rejected';
  pay.verifiedAt = new Date().toISOString();
  pay.verifyNote = note ?? null;
  if (!approve) {
    StorageManager.setGlobal(PAYMENTS, pays);
    audit(pay.schoolId, 'Payment rejected', note, { reference: pay.reference });
    return null;
  }
  const all = localSubs();
  const sub = all[pay.schoolId];
  const req = sub?.requested;
  if (!req) throw new Error('There is no subscription request to activate.');
  const { requested, ...rest } = sub;
  const expiryDate = expiryFor(start, req.billing);
  all[pay.schoolId] = { ...rest, status: 'active', packageId: req.packageId, billing: req.billing, addons: req.addons ?? [], startDate: start, expiryDate, quote: req.quote, paymentReference: pay.reference, activatedAt: pay.verifiedAt };
  StorageManager.setGlobal(SUBS, all);
  StorageManager.setGlobal(PAYMENTS, pays);
  audit(pay.schoolId, 'Payment verified and subscription activated', note, { reference: pay.reference, startDate: start, expiryDate, packageId: req.packageId });
  return all[pay.schoolId];
}

export async function listAudit() {
  if (remote()) return rpc('list_platform_audit', { limit_rows: 200 });
  const names = Object.fromEntries(listAccounts().map((a) => [a.id, a.schoolName]));
  return (StorageManager.getGlobal(AUDIT) ?? []).map((a) => ({ ...a, schoolName: a.schoolId ? names[a.schoolId] : null }));
}

// One row of everything the control centre shows for a school (all derived, nothing stored twice).
export function summariseSchool(row, cat = getCatalogue()) {
  const sub = row.subscription;
  const limits = effectiveLimits(sub, cat, { declaredStudents: row.declaredStudents });
  const cap = capacityStatus(row.activeStudents ?? 0, limits, cat);
  const ent = resolveEntitlements(sub, cat);
  return { ...row, limits, capacity: cap, entitlements: ent, subscriptionStatus: effectiveStatus(sub, new Date(), cat.graceDays ?? 0), renewal: renewalState(sub, cat), activeModules: Object.entries(ent.modules).filter(([, v]) => v).map(([k]) => k) };
}
