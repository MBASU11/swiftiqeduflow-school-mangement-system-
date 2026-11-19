// The old Digischool-style plan list (Private/Public Primary & Secondary, Bronze/Silver, onboarding
// + "single or both modules") is gone. Packages are now the six size-based tiers
// (Micro → Enterprise Plus) defined in services/packageService.js and edited by the Super Admin in
// the Package & Feature Control Centre. This file only adds the small display helpers the landing
// page, sign-up form and platform screens share.
import { getCatalogue, activePackages, enabledBilling, priceFor, BILLING_LABEL } from '../services/packageService.js';
import { MODULES, FEATURES } from './features.js';

export const CURRENCY = 'KES';

export const allPlans = () => activePackages(getCatalogue());
export const getPlan = (id) => getCatalogue().packages.find((p) => p.id === id);

// "Up to 100 students", "101–300 students", "Over 3,000 students"
export function populationLabel(pkg) {
  if (!pkg) return '';
  const n = (v) => Number(v).toLocaleString('en-US');
  if (pkg.custom || pkg.paidLimit == null) return `Over ${n(Math.max(0, (pkg.minStudents ?? 3001) - 1))} students`;
  return pkg.minStudents <= 1 ? `Up to ${n(pkg.paidLimit)} students` : `${n(pkg.minStudents)}–${n(pkg.paidLimit)} students`;
}

// What each tier is for, shown on the pricing cards (from the product brief).
export const TIER_HIGHLIGHTS = {
  micro: ['Students, admissions, academics and timetable', 'Attendance and exams', 'Basic finance, communication and standard reports', 'Parents & Students Portal'],
  starter: ['Everything in Micro', 'Expanded fees, invoices and receipts', 'Configurable fee reminders', 'Expanded transport and inventory tracking'],
  professional: ['Everything in Starter', 'Bulk and segmented invoicing', 'Payment reconciliation tools', 'Advanced financial and academic reports'],
  advanced: ['Everything in Professional', 'Financial analytics and audit trails', 'Academic comparisons and trends', 'Advanced workflow and permissions'],
  enterprise: ['Everything in Advanced', 'Multi-campus management', 'Consolidated reporting', 'Advanced departmental permissions'],
  'enterprise-plus': ['Custom student and campus limits', 'Custom integrations and support', 'Tailored module entitlements', 'Quotation on request'],
};

// "KES 2,000 per term" / "Custom quotation"
export function priceText(pkg, billing, currency = getCatalogue().currency) {
  if (!pkg || pkg.custom) return 'Custom quotation';
  const v = priceFor(pkg.prices, billing);
  return v == null ? 'Price to be confirmed' : `${currency} ${Number(v).toLocaleString('en-US')} ${billing === 'annual' ? 'per year' : billing === 'termly' ? 'per term' : 'per month'}`;
}
export { enabledBilling, BILLING_LABEL };

// ---- What each package includes, worked out from the live catalogue (so the landing page can never disagree with what the
// Super Admin has switched on in the control centre) ----------------------------------------------------------------
const ON = (pkg, moduleKey) => Boolean(pkg.modules?.[moduleKey]);
const FEATURE_ON = (pkg, f) => ON(pkg, f.module) && Boolean(pkg.features?.[f.key]);

// For one package: the modules it adds over the previous one, and the modules it does not include.
export function packageDelta(pkg, prev) {
  const mods = MODULES.filter((m) => !m.pack && !m.essential);
  return {
    added: mods.filter((m) => ON(pkg, m.key) && !(prev && ON(prev, m.key))).map((m) => (m.soon ? `${m.label} (coming soon)` : m.label)),
    missing: mods.filter((m) => !ON(pkg, m.key)).map((m) => m.label),
  };
}
export function packageDeltas(cat = getCatalogue()) {
  const list = activePackages(cat);
  return Object.fromEntries(list.map((p, i) => [p.id, packageDelta(p, list[i - 1])]));
}

// The comparison table: modules first, then every feature under its module. Each cell is 'yes', 'soon' (included but not released yet), 'addon' (can be bought as a pack) or 'no'.
export function comparisonTable(cat = getCatalogue()) {
  const packages = activePackages(cat);
  const modulePack = (key) => cat.addons.find((a) => a.active && (a.module === key || a.modules?.includes(key)));
  const featurePack = (feature) => cat.addons.find((a) => a.active && a.features?.includes(feature.key));
  const sections = [{ title: 'Modules', rows: MODULES.filter((m) => !m.pack).map((m) => {
    const addon = modulePack(m.key);
    return { label: m.label, cells: packages.map((p) => (m.essential ? 'yes' : ON(p, m.key) ? (m.soon ? 'soon' : 'yes') : addon ? 'addon' : 'no')) };
  }) }];
  for (const m of MODULES.filter((x) => !x.pack)) {
    const fs = FEATURES.filter((f) => f.module === m.key);
    if (!fs.length) continue;
    sections.push({ title: m.label, rows: fs.map((f) => ({
      label: f.label, pack: featurePack(f)?.name ?? null,
      cells: packages.map((p) => (FEATURE_ON(p, f) ? (m.soon ? 'soon' : 'yes') : featurePack(f) ? 'addon' : 'no')),
    })) });
  }
  return { packages, sections, addons: cat.addons.filter((a) => a.active) };
}
