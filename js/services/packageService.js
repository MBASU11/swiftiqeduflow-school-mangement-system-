// The subscription catalogue (packages, prices, add-ons, discounts, capacity rules) and the
// pure rules that turn a school's subscription into: what it pays, what it may use, how many
// students it may enrol, and when it renews. Nothing here is hard-coded policy — the defaults
// below are only a starting point that the Super Admin edits from the control centre.
import { StorageManager } from '../storage/StorageManager.js';
import { isSupabaseConfigured } from '../config/supabase.js';
import { MODULES, FEATURES, DEFAULT_TIER_IDS, ESSENTIAL_MODULES } from '../config/features.js';

export const CATALOGUE_KEY = 'platformCatalogue';
export const BILLING = [['monthly', 'Monthly'], ['termly', 'Per term'], ['annual', 'Per year']];
export const BILLING_LABEL = Object.fromEntries(BILLING);

const TIERS = [
  { id: 'micro', name: 'Micro', minStudents: 1, paidLimit: 100, termly: 2000, annual: 5000 },
  { id: 'starter', name: 'Starter', minStudents: 101, paidLimit: 300, termly: 4000, annual: 10000 },
  { id: 'professional', name: 'Professional', minStudents: 301, paidLimit: 800, termly: 8000, annual: 20000 },
  { id: 'advanced', name: 'Advanced', minStudents: 801, paidLimit: 1500, termly: 13500, annual: 35000 },
  { id: 'enterprise', name: 'Enterprise', minStudents: 1501, paidLimit: 3000, termly: 20000, annual: 50000 },
  { id: 'enterprise-plus', name: 'Enterprise Plus', minStudents: 3001, paidLimit: null, termly: null, annual: null, custom: true },
];
const PUBLIC_PLAN_NAMES = ['Core package', 'Core Plus', 'Growth', 'Advanced', 'Scale', 'Complete package'];

// With a rank: the modules a package of that rank includes by default (Micro = 0). Without one: every non-pack module (used only as
// a base to fill gaps). Add-on packs are never part of a package; they are bought on top.
export function defaultModulesFor(rank) {
  return Object.fromEntries(MODULES.map((m) => [m.key, !m.pack && (rank === undefined || m.essential || (m.minTier ?? 0) <= rank)]));
}
export function defaultFeaturesFor(rank) {
  return Object.fromEntries(FEATURES.map((f) => [f.key, f.minTier !== null && rank >= f.minTier]));
}

export function buildDefaultCatalogue() {
  return {
    version: 3,
    currency: 'KES',
    graceDays: 7, // after expiry the school keeps full access for this many days while the renewal invoice is settled
    // What happens without the Super Admin lifting a finger. Each of these can be switched off or changed in the control centre.
    automation: { startTrialOnApproval: true, invoiceOnApproval: true, invoiceDueDays: 14, autoRenewalInvoices: true, renewalWindowDays: 30 },
    termsPerYear: 3,
    termMonths: 4,
    defaultOverflow: 20,
    trialDays: 14,
    renewalReminderDays: [30, 14, 7],
    billing: { monthly: { enabled: false }, termly: { enabled: true }, annual: { enabled: true } },
    publicPricingVisible: false,
    capacity: { warnPercent: 90, excludeStatuses: ['archived', 'graduated', 'withdrawn', 'transferred'] },
    packages: TIERS.map((t, rank) => ({
      id: t.id,
      name: t.name,
      publicName: PUBLIC_PLAN_NAMES[rank] ?? 'School package',
      publicDescription: rank === 0
        ? 'The essential tools to manage your school in one connected workspace.'
        : rank === TIERS.length - 1
          ? 'A complete, tailored solution for schools with advanced or multi-campus needs.'
          : '',
      publicVisible: rank === 0 || rank === TIERS.length - 1,
      minStudents: t.minStudents,
      paidLimit: t.paidLimit,
      overflow: 20,
      custom: Boolean(t.custom),
      active: true,
      prices: { monthly: null, termly: t.termly, annual: t.annual },
      limits: { users: null, storageGb: null, campuses: null },
      modules: defaultModulesFor(rank),
      features: rank === TIERS.length - 1
        ? Object.fromEntries(FEATURES.map((f) => [f.key, !f.pack]))
        : defaultFeaturesFor(rank),
    })),
    // Optional-pack prices start unset for the Super Admin to configure.
    addons: [
      { id: 'bursar-pack', name: 'Finance Pack', module: 'bursar_pack', modules: ['finance'], features: FEATURES.filter((f) => f.pack === 'bursar_pack').map((f) => f.key), active: true, prices: { monthly: null, termly: null, annual: null }, description: 'Invoicing, receipts, reminders, refunds, statements and reconciliation.' },
      { id: 'teacher-pack', name: 'Teaching & Learning Pack', module: 'teacher_pack', modules: ['academics', 'exams', 'attendance'], features: FEATURES.filter((f) => f.pack === 'teacher_pack').map((f) => f.key), active: true, prices: { monthly: null, termly: null, annual: null }, description: 'Lesson planning, homework, eLearning, live lessons and academic support.' },
      { id: 'student-support-pack', name: 'Student Support Pack', modules: ['hostel', 'activities'], features: ['student_welfare'], active: true, prices: { monthly: null, termly: null, annual: null }, description: 'Student welfare, hostel and co-curricular activity tools.' },
      { id: 'school-operations-pack', name: 'School Operations Pack', modules: ['transport', 'library', 'inventory'], features: ['transport_expanded', 'transport_advanced_reports', 'inventory_tracking', 'inventory_advanced_reports'], active: true, prices: { monthly: null, termly: null, annual: null }, description: 'Transport, library, inventory and operational tracking.' },
      { id: 'family-engagement-pack', name: 'Family Engagement Pack', modules: ['portal', 'communication'], features: ['enhanced_communication'], active: true, prices: { monthly: null, termly: null, annual: null }, description: 'Parent and learner portals with enhanced school communication.' },
      { id: 'insights-governance-pack', name: 'Insights & Governance Pack', modules: ['reports', 'settings'], features: ['report_filters', 'workload_reports', 'advanced_staff_reports', 'multi_campus_reporting', 'workflow_permissions', 'departmental_permissions', 'multi_campus', 'advanced_audit_controls'], active: true, prices: { monthly: null, termly: null, annual: null }, description: 'Advanced reporting, permissions, audit controls and multi-campus oversight.' },
    ],
    discounts: [
      { id: 'combined-packs', name: 'Combined Finance + Teaching & Learning discount', type: 'percent', value: 0, requires: ['bursar-pack', 'teacher-pack'], appliesTo: 'addons', active: true },
    ],
    // Charged separately from the subscription. amount null = not priced yet.
    charges: [
      { id: 'setup', name: 'Setup', kind: 'one-time', amount: null },
      { id: 'training', name: 'Training', kind: 'one-time', amount: null },
      { id: 'data-migration', name: 'Data migration', kind: 'one-time', amount: null },
      { id: 'custom-development', name: 'Custom development', kind: 'quoted', amount: null },
      { id: 'sms', name: 'SMS', kind: 'per-unit', unit: 'message', amount: null },
      { id: 'whatsapp', name: 'WhatsApp', kind: 'per-unit', unit: 'message', amount: null },
      { id: 'payment-processing', name: 'Payment processing', kind: 'percent', amount: null },
    ],
  };
}

export const DEFAULT_CATALOGUE = buildDefaultCatalogue();

// Fills anything missing (e.g. a feature added in a later version) without touching what was saved.
export function normaliseCatalogue(raw) {
  const base = buildDefaultCatalogue();
  const c = { ...base, ...(raw ?? {}) };
  c.billing = { ...base.billing, ...(raw?.billing ?? {}) };
  c.publicPricingVisible = raw?.publicPricingVisible === true;
  c.capacity = { ...base.capacity, ...(raw?.capacity ?? {}) };
  c.automation = { ...base.automation, ...(raw?.automation ?? {}) };
  c.graceDays = Number.isFinite(Number(raw?.graceDays)) ? Number(raw.graceDays) : base.graceDays;
  // Catalogues saved before packages differed in what they include have every module switched on for every package.
  // Those were never a deliberate choice, so they move to the recommended sets once; anything customised is left alone.
  const untouched = (m) => m && MODULES.filter((x) => !x.pack && !x.essential).every((x) => m[x.key] !== false);
  c.packages = (raw?.packages?.length ? raw.packages : base.packages).map((p, rank) => {
    const recommendedModules = defaultModulesFor(rank);
    const recommendedFeatures = defaultFeaturesFor(rank);
    const completeUntouched = (!p.modules || MODULES.filter((m) => !m.pack).every((m) => Boolean(p.modules[m.key]) === recommendedModules[m.key]))
      && (!p.features || FEATURES.every((f) => Boolean(p.features[f.key]) === recommendedFeatures[f.key]));
    const completeMigration = (raw?.version ?? 1) < 3 && p.id === 'enterprise-plus' && completeUntouched;
    const modules = (raw?.version ?? 1) < 2 && untouched(p.modules)
      ? defaultModulesFor(rank)
      : { ...defaultModulesFor(rank), ...(p.modules ?? {}) };
    const features = { ...defaultFeaturesFor(rank), ...(p.features ?? {}) };
    if (completeMigration) {
      Object.assign(modules, defaultModulesFor());
      FEATURES.filter((f) => !f.pack).forEach((f) => { features[f.key] = true; });
    }
    return {
      overflow: c.defaultOverflow,
      custom: false,
      active: true,
      limits: { users: null, storageGb: null, campuses: null },
      ...p,
      publicName: p.publicName ?? PUBLIC_PLAN_NAMES[rank] ?? 'School package',
      publicDescription: p.publicDescription ?? '',
      publicVisible: p.publicVisible ?? (rank === 0 || rank === c.packages.length - 1),
      prices: { monthly: null, termly: null, annual: null, ...(p.prices ?? {}) },
      modules,
      features,
    };
  });
  c.version = 3;
  const savedAddons = Array.isArray(raw?.addons) ? raw.addons : [];
  c.addons = [
    ...base.addons.map((addon) => {
      const saved = savedAddons.find((item) => item.id === addon.id);
      return {
        ...addon,
        ...(saved ?? {}),
        modules: Array.isArray(saved?.modules) ? saved.modules : addon.modules,
        features: Array.isArray(saved?.features) ? saved.features : addon.features,
      };
    }),
    ...savedAddons.filter((addon) => !base.addons.some((item) => item.id === addon.id)),
  ];
  c.discounts = raw?.discounts ?? base.discounts;
  c.charges = raw?.charges ?? base.charges;
  return c;
}

// ---- Where the catalogue lives ---------------------------------------------------
let cache = null;
let publicCatalogueLoaded = false;

export function getCatalogue() {
  if (cache) return cache;
  if (isSupabaseConfigured()) return normaliseCatalogue(null);
  return normaliseCatalogue(StorageManager.getGlobal(CATALOGUE_KEY));
}
export function setCatalogueCache(raw) {
  cache = raw ? normaliseCatalogue(raw) : null;
  publicCatalogueLoaded = Boolean(raw);
  return getCatalogue();
}
export const hasPublicCatalogueLoaded = () => publicCatalogueLoaded;
export function saveCatalogueLocal(raw) {
  StorageManager.setGlobal(CATALOGUE_KEY, raw);
  cache = null;
  publicCatalogueLoaded = false;
}
// Cloud mode: fetch the Super Admin's catalogue (readable by anyone, so the pricing page and sign-up work).
export async function loadPublicCatalogue({ force = false } = {}) {
  if (!isSupabaseConfigured()) { cache = null; publicCatalogueLoaded = true; return getCatalogue(); }
  if (publicCatalogueLoaded && !force) return getCatalogue();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('The package catalogue request timed out.')), 10000);
  });
  try {
    const catalogue = await Promise.race([(async () => {
      const { getSupabaseClient } = await import('./supabaseClient.js');
      const client = await getSupabaseClient();
      const { data, error } = await client.rpc('get_platform_catalogue');
      if (error) throw error;
      return setCatalogueCache(data);
    })(), timeout]);
    publicCatalogueLoaded = true;
    return catalogue;
  } finally {
    clearTimeout(timeoutId);
  }
}
export async function loadCatalogue() {
  if (!isSupabaseConfigured()) return loadPublicCatalogue();
  try { return await loadPublicCatalogue({ force: true }); }
  catch { return getCatalogue(); }
}

// ---- Lookups -------------------------------------------------------------------------
export const packageById = (id, cat = getCatalogue()) => cat.packages.find((p) => p.id === id);
export const activePackages = (cat = getCatalogue()) => cat.packages.filter((p) => p.active);
export const enabledBilling = (cat = getCatalogue()) => BILLING.filter(([key]) => cat.billing[key]?.enabled);
export const priceFor = (prices, billing) => (prices && typeof prices[billing] === 'number' ? prices[billing] : null);
export const money = (cat, n) => `${cat.currency} ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

// The smallest package whose paid limit covers this many students (custom package for very large schools).
export function suggestPackage(students, cat = getCatalogue()) {
  const n = Number(students);
  const fixed = activePackages(cat).filter((p) => !p.custom && p.paidLimit != null).sort((a, b) => a.paidLimit - b.paidLimit);
  if (Number.isFinite(n) && n > 0) {
    const fit = fixed.find((p) => n <= p.paidLimit);
    if (fit) return fit;
    return activePackages(cat).find((p) => p.custom) ?? fixed[fixed.length - 1];
  }
  return fixed[0] ?? cat.packages[0];
}

// ---- What a school pays ----------------------------------------------------------------
// Every line is shown and the total is stated; nothing is stacked silently. A line without a
// price makes the quote "to be confirmed" instead of silently counting as zero.
export function buildQuote(selection, cat = getCatalogue()) {
  const pkg = packageById(selection.packageId, cat);
  const billing = selection.billing ?? 'annual';
  if (!pkg) return { ok: false, error: 'Choose a package.', lines: [], total: 0, needsQuotation: true, currency: cat.currency, billing };
  const lines = [];
  const notes = [];
  let needsQuotation = false;

  const pkgPrice = pkg.custom ? null : priceFor(pkg.prices, billing);
  if (pkgPrice == null) needsQuotation = true;
  lines.push({ kind: 'package', id: pkg.id, label: `${pkg.name} package — ${BILLING_LABEL[billing]?.toLowerCase() ?? billing}`, amount: pkgPrice });

  const addonLines = [];
  (selection.addons ?? []).forEach((id) => {
    const addon = cat.addons.find((a) => a.id === id && a.active);
    if (!addon) return;
    const price = priceFor(addon.prices, billing);
    if (price == null) { needsQuotation = true; notes.push(`${addon.name}: price to be confirmed.`); }
    const line = { kind: 'addon', id: addon.id, label: addon.name, amount: price };
    addonLines.push(line); lines.push(line);
  });

  const picked = new Set(selection.addons ?? []);
  let discountTotal = 0;
  cat.discounts.filter((d) => d.active && Number(d.value) > 0 && (d.requires ?? []).every((r) => picked.has(r))).forEach((d) => {
    const base = d.appliesTo === 'subtotal'
      ? lines.reduce((s, l) => s + (l.amount ?? 0), 0)
      : addonLines.reduce((s, l) => s + (l.amount ?? 0), 0);
    const amount = d.type === 'percent' ? Math.round((base * Number(d.value)) / 100) : Math.min(Number(d.value), base);
    if (amount > 0) { discountTotal += amount; lines.push({ kind: 'discount', id: d.id, label: d.name, amount: -amount }); }
  });

  (selection.charges ?? []).forEach((id) => {
    const charge = cat.charges.find((c) => c.id === id && c.kind === 'one-time');
    if (!charge) return;
    if (charge.amount == null) { needsQuotation = true; notes.push(`${charge.name}: price to be confirmed.`); }
    lines.push({ kind: 'charge', id: charge.id, label: `${charge.name} (one-time)`, amount: charge.amount });
  });

  cat.charges.filter((c) => c.kind !== 'one-time' && c.amount != null).forEach((c) => {
    notes.push(`${c.name}: ${c.kind === 'percent' ? `${c.amount}%` : `${cat.currency} ${c.amount}${c.unit ? ` per ${c.unit}` : ''}`} — billed separately, not included in the total.`);
  });

  const subtotal = lines.filter((l) => l.amount != null && l.amount > 0).reduce((s, l) => s + l.amount, 0);
  return { ok: true, currency: cat.currency, billing, packageId: pkg.id, packageName: pkg.name, lines, subtotal, discountTotal, total: subtotal - discountTotal, needsQuotation, notes };
}

// ---- What a school may use ------------------------------------------------------------------
const today = (now = new Date()) => now.toISOString().slice(0, 10);
export const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);

// requested = chosen but payment not yet verified; trial / active / expired / suspended as named.
export function effectiveStatus(sub, now = new Date(), graceDays = 0) {
  if (!sub) return 'none';
  const t = today(now);
  if (sub.status === 'active' && sub.expiryDate && t > addDays(sub.expiryDate, graceDays)) return 'expired';
  if (sub.status === 'trial' && sub.trialUntil && t > sub.trialUntil) return 'expired';
  return sub.status ?? 'requested';
}

export function resolveEntitlements(sub, cat = getCatalogue(), now = new Date()) {
  const allModules = (value) => Object.fromEntries(MODULES.map((m) => [m.key, m.pack ? false : value]));
  // Schools created before packages existed keep everything they already had.
  if (!sub) {
    return { status: 'none', legacy: true, restricted: false, modules: allModules(true), features: Object.fromEntries(FEATURES.map((f) => [f.key, f.minTier !== null])) };
  }
  const status = effectiveStatus(sub, now, cat.graceDays ?? 0);
  const pkg = packageById(sub.packageId, cat) ?? cat.packages[0];
  let modules = { ...defaultModulesFor(), ...pkg.modules };
  let features = { ...pkg.features };

  (sub.addons ?? []).forEach((id) => {
    const addon = cat.addons.find((a) => a.id === id);
    if (!addon) return;
    if (addon.module) {
      modules[addon.module] = true;
      if (!Array.isArray(addon.features)) {
        FEATURES.filter((f) => f.pack === addon.module).forEach((f) => { features[f.key] = true; });
      }
    }
    (addon.modules ?? []).forEach((key) => { modules[key] = true; });
    (addon.features ?? []).forEach((key) => { features[key] = true; });
  });
  Object.entries(sub.overrides?.modules ?? {}).forEach(([k, v]) => { modules[k] = Boolean(v); });
  Object.entries(sub.overrides?.features ?? {}).forEach(([k, v]) => { features[k] = Boolean(v); });

  // Until payment is verified, or after expiry/suspension, only the essential school records stay open.
  const restricted = ['requested', 'expired', 'suspended'].includes(status);
  if (restricted) { modules = Object.fromEntries(MODULES.map((m) => [m.key, false])); features = {}; }
  ESSENTIAL_MODULES.forEach((k) => { modules[k] = true; });
  return { status, legacy: false, restricted, modules, features };
}

// ---- How many students ---------------------------------------------------------------------
export function effectiveLimits(sub, cat = getCatalogue(), { declaredStudents, now = new Date() } = {}) {
  if (!sub) return { unlimited: true, paidLimit: null, overflow: 0, max: null, source: 'none' };
  const pkg = packageById(sub.packageId, cat) ?? suggestPackage(declaredStudents, cat);
  const o = sub.limits ?? {};
  const paidLimit = o.paidLimit ?? pkg?.paidLimit ?? null;
  const overflow = o.overflow ?? pkg?.overflow ?? cat.defaultOverflow ?? 20;
  let max = paidLimit == null ? null : paidLimit + overflow;
  const exceptionActive = o.max != null && (!o.exceptionUntil || today(now) <= o.exceptionUntil);
  if (exceptionActive) max = o.max;
  return { unlimited: max == null, paidLimit, overflow, max, exceptionUntil: exceptionActive ? o.exceptionUntil ?? null : null, source: o.max != null || o.paidLimit != null || o.overflow != null ? 'override' : 'package' };
}

// ---- Dates -------------------------------------------------------------------------------------
export function periodMonths(billing, cat = getCatalogue()) {
  return billing === 'monthly' ? 1 : billing === 'termly' ? cat.termMonths ?? 4 : 12;
}
// start + one billing period, minus a day: the last day the subscription is valid.
export function expiryFor(startISO, billing, cat = getCatalogue()) {
  const [y, m, d] = startISO.split('-').map(Number);
  const months = periodMonths(billing, cat);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, lastDay)));
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

const daysBetween = (fromISO, toISO) => Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86400000);

// Reminders are *generated* here; they are only delivered when a messaging service is configured.
export function renewalState(sub, cat = getCatalogue(), now = new Date()) {
  const status = effectiveStatus(sub, now, cat.graceDays ?? 0);
  if (!sub) return { status: 'none', label: 'No package assigned', reminders: [] };
  const expiry = sub.status === 'trial' ? sub.trialUntil : sub.expiryDate;
  if (status === 'requested') return { status, label: 'Awaiting verified payment', reminders: [] };
  if (!expiry) return { status, label: status === 'suspended' ? 'Suspended' : '—', reminders: [] };
  const daysLeft = daysBetween(today(now), expiry);
  const reminders = (cat.renewalReminderDays ?? []).map((d) => {
    const dueOn = new Date(Date.parse(expiry) - d * 86400000).toISOString().slice(0, 10);
    return { daysBefore: d, dueOn, state: today(now) >= dueOn ? 'due' : 'scheduled', delivered: false };
  });
  if (status === 'expired') return { status, daysLeft, expiry, label: `Expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago`, reminders };
  if (sub.status === 'active' && daysLeft < 0) return { status, daysLeft, expiry, inGrace: true, due: true, label: `Expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago. In grace period until ${addDays(expiry, cat.graceDays ?? 0)}`, reminders };
  const window = Math.max(0, ...(cat.renewalReminderDays ?? [30]));
  return { status, daysLeft, expiry, label: daysLeft <= window ? `Renewal due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : `Active until ${expiry}`, due: daysLeft <= window, reminders };
}

// The two numbers that really differ between packages day to day: the student limit and the prices. Everything else (which modules and
// features a package includes, the extra allowance, trials, grace) follows the recommended defaults and is edited only in the advanced editor.
// edits: { [packageId]: { paidLimit, prices: { termly, annual, ... } } }. Returns { ok, errors, catalogue } and never changes `cat` itself.
export function applyPackageBasics(cat, edits) {
  const next = JSON.parse(JSON.stringify(cat)); const errors = [];
  for (const p of next.packages) {
    const e = edits[p.id]; if (!e) continue;
    if (!p.custom) {
      const lim = Number(e.paidLimit);
      if (!Number.isInteger(lim) || lim < 1 || lim > 1000000) errors.push(`${p.name}: the student limit must be a whole number from 1.`); else p.paidLimit = lim;
    }
    for (const [k, v] of Object.entries(e.prices ?? {})) {
      if (String(v ?? '').trim() === '') { p.prices[k] = null; continue; }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100000000) errors.push(`${p.name}: the ${(BILLING_LABEL[k] ?? k).toLowerCase()} price must be a number of 0 or more, or empty if it is quoted.`); else p.prices[k] = Math.round(n * 100) / 100;
    }
  }
  const live = next.packages.filter((p) => p.active !== false && !p.custom);
  live.slice(1).forEach((p, i) => {
    const lower = live[i];
    if (p.paidLimit <= lower.paidLimit) errors.push(`${p.name} must allow more students than ${lower.name} (${lower.paidLimit}).`);
    for (const [k] of BILLING) if (p.prices[k] != null && lower.prices[k] != null && p.prices[k] < lower.prices[k]) errors.push(`${p.name} costs less than ${lower.name} for ${(BILLING_LABEL[k] ?? k).toLowerCase()} billing.`);
  });
  return { ok: !errors.length, errors, catalogue: next };
}

// The cheapest active package that includes this module, so "not in your package" can say where to find it.
export function lowestPackageWith(moduleKey, cat = getCatalogue()) {
  return activePackages(cat).find((p) => p.modules?.[moduleKey]) ?? null;
}

export const TIER_IDS = DEFAULT_TIER_IDS;
