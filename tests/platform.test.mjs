// Run: node tests/platform.test.mjs — package matrix, approval + invoicing automation, activation on payment, renewals, grace.
import assert from 'node:assert/strict';
const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), get length() { return store.size; }, key: (i) => [...store.keys()][i] } };
let fail = 0; const ok = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', String(e.message).slice(0, 700)); } };
const PK = await import('../js/services/packageService.js'); const F = await import('../js/config/features.js'); const PL = await import('../js/config/plans.js');
const A = await import('../js/services/authService.js'); const P = await import('../js/services/platformService.js'); const S = await import('../js/services/subscriptionService.js');
const Storage = await import('../js/storage/StorageManager.js');
const AU = await import('../js/services/platformAutomation.js');
const today = new Date().toISOString().slice(0, 10); const addDays = PK.addDays;

console.log('Packages');
await ok('default module matrix: each tier adds what the brief says, essentials and backups are never sold', () => {
  const c = PK.buildDefaultCatalogue(); const on = (id, k) => c.packages.find((p) => p.id === id).modules[k];
  for (const id of c.packages.map((p) => p.id)) for (const k of ['dashboard', 'students', 'academics', 'attendance', 'settings', 'data']) assert.equal(on(id, k), true, `${id} ${k}`);
  assert.deepEqual(['transport', 'inventory', 'discipline', 'library', 'staff', 'activities', 'health', 'hostel'].map((k) => on('micro', k)), Array(8).fill(false));
  assert.deepEqual(['transport', 'inventory', 'discipline', 'library', 'staff'].map((k) => on('starter', k)), Array(5).fill(true)); assert.deepEqual(['activities', 'health', 'hostel'].map((k) => on('starter', k)), [false, false, false]);
  assert.deepEqual(['activities', 'health', 'hostel'].map((k) => on('professional', k)), [true, true, true]);
  assert.ok(c.packages.every((p) => !p.modules.bursar_pack && !p.modules.teacher_pack));
});
await ok('public package defaults hide capacity tiers and prices while exposing only Core and Complete', () => {
  const c = PK.buildDefaultCatalogue();
  assert.equal(c.publicPricingVisible, false);
  assert.deepEqual(c.packages.filter((p) => p.publicVisible).map((p) => p.publicName), ['Core package', 'Complete package']);
  assert.equal(c.addons.length, 6);
  assert.ok(c.addons.every((a) => Array.isArray(a.modules) && Array.isArray(a.features)));
  assert.ok(c.packages.at(-1).modules.health);
  assert.ok(F.FEATURES.filter((f) => !f.pack).every((f) => c.packages.at(-1).features[f.key]));
  assert.ok(F.FEATURES.filter((f) => f.pack).every((f) => !c.packages.at(-1).features[f.key]));
  const legacy = PK.normaliseCatalogue({
    packages: c.packages.map(({ publicName, publicDescription, publicVisible, ...p }) => p),
    addons: c.addons,
  });
  assert.equal(legacy.publicPricingVisible, false);
  assert.deepEqual(legacy.packages.filter((p) => p.publicVisible).map((p) => p.publicName), ['Core package', 'Complete package']);
  const prior = PK.buildDefaultCatalogue();
  const oldComplete = PK.normaliseCatalogue({ ...prior, version: 2, packages: prior.packages.map((p) => ({ ...p, modules: { ...p.modules }, features: PK.defaultFeaturesFor(prior.packages.indexOf(p)) })) }).packages.at(-1);
  assert.ok(F.MODULES.filter((m) => !m.pack).every((m) => oldComplete.modules[m.key]));
  assert.ok(F.FEATURES.filter((f) => !f.pack).every((f) => oldComplete.features[f.key]));
  const customizedComplete = PK.normaliseCatalogue({
    ...prior,
    version: 2,
    packages: prior.packages.map((p, index) => ({
      ...p,
      modules: { ...p.modules, ...(index === prior.packages.length - 1 ? { library: false } : {}) },
      features: { ...PK.defaultFeaturesFor(index), ...(index === prior.packages.length - 1 ? { multi_campus: false } : {}) },
    })),
  }).packages.at(-1);
  assert.equal(customizedComplete.modules.library, false);
  assert.equal(customizedComplete.features.multi_campus, false);
});
await ok('each optional pack grants only its configured modules and features', () => {
  const c = PK.buildDefaultCatalogue();
  const entitlement = (id) => PK.resolveEntitlements({ status: 'active', packageId: 'micro', addons: [id] }, c);
  assert.ok(entitlement('bursar-pack').features.invoice_generation);
  assert.ok(entitlement('teacher-pack').modules.exams && entitlement('teacher-pack').features.homework);
  assert.ok(entitlement('student-support-pack').modules.hostel && entitlement('student-support-pack').modules.activities);
  assert.ok(entitlement('school-operations-pack').modules.transport && entitlement('school-operations-pack').features.transport_expanded);
  assert.ok(entitlement('family-engagement-pack').modules.portal && entitlement('family-engagement-pack').features.enhanced_communication);
  assert.ok(entitlement('insights-governance-pack').modules.reports && entitlement('insights-governance-pack').features.workflow_permissions);
});
await ok('pack module and feature selections are configurable rather than implicitly granted', () => {
  const c = PK.buildDefaultCatalogue();
  const operations = c.addons.find((a) => a.id === 'school-operations-pack');
  operations.modules = operations.modules.filter((key) => key !== 'transport');
  operations.features = operations.features.filter((key) => key !== 'transport_expanded');
  const access = PK.resolveEntitlements({ status: 'active', packageId: 'micro', addons: [operations.id] }, c);
  assert.equal(access.modules.transport, false);
  assert.equal(access.features.transport_expanded, false);
  assert.equal(access.modules.inventory, true);
});
await ok('modules only ever grow with the package (no tier has less than the one below it)', () => {
  const c = PK.buildDefaultCatalogue(); const keys = F.MODULES.map((m) => m.key);
  c.packages.slice(1).forEach((p, i) => keys.forEach((k) => assert.ok(!c.packages[i].modules[k] || p.modules[k], `${p.id} lost ${k}`)));
});
await ok('old catalogues (everything on everywhere) move to the recommended sets once; customised ones are left alone', () => {
  const c = PK.buildDefaultCatalogue(); const all = Object.fromEntries(F.MODULES.map((m) => [m.key, !m.pack]));
  const old = { version: 1, packages: c.packages.map((p) => ({ ...p, modules: { ...all } })) };
  assert.equal(PK.normaliseCatalogue(old).packages[0].modules.health, false);
  const custom = { version: 1, packages: c.packages.map((p) => ({ ...p, modules: { ...all, library: false } })) };
  assert.equal(PK.normaliseCatalogue(custom).packages[0].modules.health, true);
  assert.equal(PK.normaliseCatalogue({ ...old, version: 2 }).packages[0].modules.health, true); // already migrated: never touched again
});
await ok('landing comparison is built from the catalogue: modules, features, add-on cells', () => {
  const t = PL.comparisonTable(PK.buildDefaultCatalogue()); const row = (sec, label) => t.sections.find((s) => s.title === sec).rows.find((r) => r.label === label).cells;
  assert.deepEqual(row('Modules', 'Health'), ['no', 'no', 'soon', 'soon', 'soon', 'soon']); assert.deepEqual(row('Modules', 'Students'), Array(6).fill('yes'));
  assert.deepEqual(row('Finance', 'Fee structures'), Array(6).fill('yes')); assert.deepEqual(row('Finance', 'Bulk & segmented invoicing').slice(0, 3), ['addon', 'addon', 'yes']);
  const d = PL.packageDeltas(PK.buildDefaultCatalogue()); assert.ok(d.starter.added.includes('Transport') && d.micro.missing.includes('Health') && !d.professional.missing.includes('Health') && d.professional.added.includes('Health (coming soon)'));
});
await ok('a blocked module names the package it comes with', () => { assert.equal(PK.lowestPackageWith('health').name, 'Professional'); assert.equal(PK.lowestPackageWith('transport').name, 'Starter'); });

console.log('Approval and invoicing');
const reg = (name, planId, billing, students) => { const a = A.register({ name, schoolName: name + ' School', email: `${name.toLowerCase()}@p.co`, password: 'secret-pass-1', confirmPassword: 'secret-pass-1', planId, billing, studentCount: students }); A.logout(); return a; };
const amy = reg('Amy', 'starter', 'annual', 250), ben = reg('Ben', 'micro', 'termly', 60), cy = reg('Cy', 'enterprise-plus', 'annual', 4000), dan = reg('Dan', 'starter', 'annual', 280), eve = reg('Eve', 'micro', 'annual', 500);
await ok('one click: approved, package allocated, 14-day trial, first invoice at the catalogue price', () => {
  const r = AU.approveAndAllocate(amy.id, 'Super'); assert.ok(r.ok, r.error);
  assert.equal(P.getSchool(amy.id).status, 'approved'); assert.equal(r.packageName, 'Starter'); assert.equal(r.trial, true); assert.equal(r.trialUntil, addDays(today, 14));
  assert.equal(r.invoice.total, 10000); assert.equal(r.invoice.kind, 'subscription'); assert.equal(r.invoice.dueDate, r.trialUntil);
  const sub = S.localSubscriptionOf(amy.id); assert.deepEqual([sub.status, sub.packageId, sub.billing], ['trial', 'starter', 'annual']); assert.equal(sub.requested.quote.total, 10000);
  const ent = PK.resolveEntitlements(sub); assert.equal(ent.modules.transport, true); assert.equal(ent.modules.health, false); assert.equal(ent.restricted, false);
});
await ok('approving twice, or an unknown school, is refused; nothing is invoiced twice', () => {
  assert.equal(AU.approveAndAllocate(amy.id, 'Super').ok, false); assert.equal(AU.approveAndAllocate('nope', 'Super').ok, false); assert.equal(P.invoicesForAccount(amy.id).length, 1);
});
await ok('a school above its package limit is flagged; a custom or unpriced package gets no invoice and no trial', () => {
  const e = AU.approveAndAllocate(eve.id, 'Super'); assert.ok(e.notes.some((n) => /declared 500 students/.test(n)));
  const c = AU.approveAndAllocate(cy.id, 'Super'); assert.equal(c.invoice, null); assert.equal(c.trial, false); assert.ok(c.notes.some((n) => /quotation|to be confirmed/.test(n)));
  assert.equal(PK.resolveEntitlements(S.localSubscriptionOf(cy.id)).restricted, true); // nothing is open until it is quoted and paid
});
await ok('approve-many reports successes and failures separately', () => {
  const r = AU.approveMany([dan.id, amy.id], 'Super'); assert.equal(r.approved.length, 1); assert.equal(r.failed.length, 1); assert.equal(r.invoices, 1);
});

console.log('Payment activates');
await ok('a part payment does nothing; paying in full activates the subscription from today for one billing period', () => {
  const inv = P.invoicesForAccount(amy.id)[0];
  assert.equal(P.recordInvoicePayment(inv.id, { amount: 4000, method: 'mpesa', reference: 'A1', date: today }, 'Super').automation.length, 0); assert.equal(S.localSubscriptionOf(amy.id).status, 'trial');
  const r = P.recordInvoicePayment(inv.id, { amount: 6000, method: 'mpesa', reference: 'A2', date: today }, 'Super'); assert.equal(r.automation.length, 1);
  const sub = S.localSubscriptionOf(amy.id); assert.deepEqual([sub.status, sub.startDate, sub.expiryDate, sub.trialUntil, sub.requested], ['active', today, PK.expiryFor(today, 'annual'), null, undefined]);
  assert.equal(P.getInvoice(inv.id).status, 'paid'); assert.ok(P.getInvoice(inv.id).activatedAt);
  assert.equal(AU.activateFromInvoice(P.getInvoice(inv.id)), null); // never twice
});
await ok('an expired trial is restricted; paying the invoice afterwards activates it again', () => {
  const sub = S.localSubscriptionOf(dan.id); S.localSetSubscription(dan.id, { trialUntil: addDays(today, -1) }, 'test');
  assert.equal(PK.effectiveStatus(S.localSubscriptionOf(dan.id)), 'expired'); assert.equal(PK.resolveEntitlements(S.localSubscriptionOf(dan.id)).restricted, true);
  P.recordInvoicePayment(P.invoicesForAccount(dan.id)[0].id, { amount: 10000, method: 'bank', reference: 'B1', date: today }, 'Super'); assert.equal(PK.effectiveStatus(S.localSubscriptionOf(dan.id)), 'active');
});
await ok('a payment the school submits is verified in one step and settles the invoice, with no double activation', async () => {
  const bAppr = AU.approveAndAllocate(ben.id, 'Super'); assert.equal(bAppr.invoice.total, 2000);
  A.login('ben@p.co', 'secret-pass-1'); const pid = await S.submitPayment({ method: 'mpesa', reference: 'QWE123', amount: 2000 }); A.logout();
  const r = await AU.verifyPaymentAuto(pid, { approve: true, actor: 'Super' });
  const sub = S.localSubscriptionOf(ben.id); assert.deepEqual([sub.status, sub.expiryDate], ['active', PK.expiryFor(today, 'termly')]); assert.equal(r.invoice.status, 'paid');
  assert.equal(P.invoicesForAccount(ben.id)[0].payments.length, 1);
});

console.log('Renewals and grace');
await ok('renewal invoices are created once, for the next period, and paying one continues the subscription without a gap', () => {
  const end = addDays(today, 10); S.localSetSubscription(amy.id, { startDate: addDays(end, -364), expiryDate: end }, 'test');
  assert.equal(AU.renewalsPending().length >= 1, true);
  const first = AU.createRenewalInvoices('Auto'); const mine = first.created.find((c) => c.school === 'Amy School'); assert.ok(mine); assert.equal(mine.invoice.periodStart, addDays(end, 1)); assert.equal(mine.invoice.total, 10000); assert.equal(mine.invoice.dueDate, end);
  assert.equal(AU.createRenewalInvoices('Auto').created.filter((c) => c.school === 'Amy School').length, 0); // idempotent
  assert.equal(S.localSubscriptionOf(amy.id).requested.renewal, true);
  P.recordInvoicePayment(mine.invoice.id, { amount: 10000, method: 'mpesa', reference: 'R1', date: today }, 'Super');
  const sub = S.localSubscriptionOf(amy.id); assert.deepEqual([sub.status, sub.startDate, sub.expiryDate], ['active', addDays(end, 1), PK.expiryFor(addDays(end, 1), 'annual')]);
});
await ok('grace: full access for graceDays after expiry, then restricted; the label says so', () => {
  const cat = PK.getCatalogue(); const sub = { status: 'active', packageId: 'starter', billing: 'annual', expiryDate: addDays(today, -3) };
  assert.equal(PK.effectiveStatus(sub, new Date(), 0), 'expired'); assert.equal(PK.effectiveStatus(sub, new Date(), cat.graceDays), 'active');
  assert.equal(PK.resolveEntitlements(sub, cat).restricted, false); assert.match(PK.renewalState(sub, cat).label, /grace period/);
  assert.equal(PK.resolveEntitlements({ ...sub, expiryDate: addDays(today, -cat.graceDays - 1) }, cat).restricted, true);
});
await ok('daily automation runs once a day, and can be switched off', () => {
  const a = AU.runDailyAutomation('Auto', { force: true }); assert.equal(a.ran, true); assert.equal(AU.runDailyAutomation('Auto').ran, false);
});

console.log('What needs attention');
await ok('attention lists pending approvals, verifications, overdue invoices; reminders are ready to paste', async () => {
  const gus = reg('Gus', 'professional', 'termly', 500); const f0 = AU.attention();
  assert.ok(f0.pending.some((p) => p.school.id === gus.id && p.total === 8000));
  const inv = P.createInvoice(amy.id, { items: [{ description: 'Extra', amount: 500 }], dueDate: addDays(today, -4) }, 'Super');
  const f1 = AU.attention(); const o = f1.overdue.find((x) => x.invoice.id === inv.id); assert.equal(o.daysLate, 4); assert.ok(f1.overdueTotal >= 500);
  const text = AU.reminderText(P.getInvoice(inv.id), P.getSchool(amy.id)); assert.match(text, /INV-\d{4}-\d{4}/); assert.match(text, /due on/);
});
await ok('a school close to its student limit is listed, with its real student count', async () => {
  const { StorageManager } = await import('../js/storage/StorageManager.js'); const { studentRepo } = await import('../js/services/studentService.js');
  StorageManager.setTenant(ben.tenantId); for (let i = 0; i < 95; i++) studentRepo.create({ admissionNumber: 'N' + i, firstName: 'S' + i, lastName: 'K', classId: 'c', status: 'active', parentIds: [] }, 's'); StorageManager.setTenant(null);
  const near = AU.attention().nearCapacity.find((x) => x.school.id === ben.id); assert.ok(near, 'Ben School should be near its limit'); assert.equal(near.active, 95); assert.equal(near.level, 'warning');
});
await ok("a school sees its own invoices, and only its own", () => {
  A.login('amy@p.co', 'secret-pass-1'); const mine = AU.myInvoices(); assert.ok(mine.length >= 2 && mine.every((i) => i.accountId === amy.id)); A.logout();
});

console.log('Simple package editing and changing a school\'s package');
await ok('simple package edits: validated, never mutate the original, and tiers must stay in order', () => {
  const cat = PK.buildDefaultCatalogue(); const before = JSON.stringify(cat); const st = cat.packages.find((p) => p.id === 'starter'); const mi = cat.packages.find((p) => p.id === 'micro');
  const good = PK.applyPackageBasics(cat, { starter: { paidLimit: '350', prices: { annual: '12000', termly: '' } } }); assert.equal(good.ok, true, good.errors.join(' '));
  const p = good.catalogue.packages.find((x) => x.id === 'starter'); assert.deepEqual([p.paidLimit, p.prices.annual, p.prices.termly], [350, 12000, null]); assert.equal(JSON.stringify(cat), before);
  assert.match(PK.applyPackageBasics(cat, { starter: { paidLimit: '12.5', prices: {} } }).errors[0], /whole number/);
  assert.match(PK.applyPackageBasics(cat, { starter: { paidLimit: '300', prices: { annual: '-5' } } }).errors[0], /price/);
  assert.match(PK.applyPackageBasics(cat, { starter: { paidLimit: String(mi.paidLimit), prices: {} } }).errors.join(' '), /must allow more students than Micro/);
  assert.match(PK.applyPackageBasics(cat, { starter: { paidLimit: String(st.paidLimit), prices: { annual: String(mi.prices.annual - 1) } } }).errors.join(' '), /costs less than Micro/);
  assert.equal(PK.applyPackageBasics(cat, { 'enterprise-plus': { paidLimit: 'x', prices: {} } }).ok, true); // custom packages have no fixed limit
});
const ann = (id) => PK.packageById(id).prices.annual; const diffDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const activeSchool = async (name, planId, billing = 'annual') => { const a = reg(name, planId, billing, 80); AU.approveAndAllocate(a.id, 'Super'); const inv = P.invoicesForAccount(a.id)[0]; P.recordInvoicePayment(inv.id, { amount: inv.total, method: 'mpesa', reference: name + '1', date: today }, 'Super'); return a; };
await ok('moving UP: takes effect now, the student limit and modules follow, and a pro-rated invoice is issued that does not touch the subscription dates', async () => {
  const hal = await activeSchool('Hal', 'micro'); const before = S.localSubscriptionOf(hal.id);
  const r = AU.changePackage(hal.id, 'starter', 'Super'); assert.deepEqual([r.ok, r.mode], [true, 'now']);
  const total = diffDays(before.startDate, before.expiryDate); const left = diffDays(today, before.expiryDate); assert.equal(r.invoice.total, Math.round(((ann('starter') - ann('micro')) * left) / total)); assert.equal(r.invoice.kind, 'adjustment');
  const sub = S.localSubscriptionOf(hal.id); assert.deepEqual([sub.packageId, PK.resolveEntitlements(sub).modules.transport], ['starter', true]);
  assert.equal(S.summariseSchool({ schoolId: hal.id, schoolName: 'Hal', status: 'approved', declaredStudents: 80, activeStudents: 80, subscription: sub }).capacity.paidLimit, PK.packageById('starter').paidLimit);
  P.recordInvoicePayment(r.invoice.id, { amount: r.invoice.total, method: 'mpesa', reference: 'UP1', date: today }, 'Super'); const after = S.localSubscriptionOf(hal.id); assert.deepEqual([after.startDate, after.expiryDate], [before.startDate, before.expiryDate]);
});
await ok('moving DOWN: the school keeps what it paid for until renewal, then the renewal invoice is at the new price', async () => {
  const ivy = await activeSchool('Ivy', 'starter'); const r = AU.changePackage(ivy.id, 'micro', 'Super'); assert.deepEqual([r.ok, r.mode, r.invoice], [true, 'at_renewal', null]);
  let sub = S.localSubscriptionOf(ivy.id); assert.deepEqual([sub.packageId, sub.nextPackageId, PK.resolveEntitlements(sub).modules.transport], ['starter', 'micro', true]);
  S.localSetSubscription(ivy.id, { startDate: addDays(today, -355), expiryDate: addDays(today, 10) }, 'test');
  const made = AU.createRenewalInvoices('Auto').created.find((c) => c.school === 'Ivy School'); assert.equal(made.invoice.total, ann('micro')); assert.equal(made.invoice.packageId, 'micro');
  P.recordInvoicePayment(made.invoice.id, { amount: made.invoice.total, method: 'mpesa', reference: 'DN1', date: today }, 'Super'); sub = S.localSubscriptionOf(ivy.id); assert.deepEqual([sub.packageId, sub.nextPackageId, PK.resolveEntitlements(sub).modules.transport], ['micro', undefined, false]);
});
await ok('before the first payment: the unpaid invoice is cancelled and reissued at the new price; a part-paid one blocks the change', async () => {
  const jon = reg('Jon', 'starter', 'annual', 80); AU.approveAndAllocate(jon.id, 'Super'); const old = P.invoicesForAccount(jon.id)[0];
  const r = AU.changePackage(jon.id, 'professional', 'Super'); assert.deepEqual([r.ok, r.mode], [true, 'reissued']); assert.equal(P.getInvoice(old.id).status, 'void'); assert.equal(r.invoice.total, ann('professional')); assert.equal(S.localSubscriptionOf(jon.id).status, 'trial');
  P.recordInvoicePayment(r.invoice.id, { amount: 1000, method: 'mpesa', reference: 'PP1', date: today }, 'Super'); assert.match(AU.changePackage(jon.id, 'micro', 'Super').error, /Part of the first invoice/);
});
await ok('changes that cannot be automatic are refused with a reason', async () => {
  const kim = await activeSchool('Kim', 'micro'); assert.match(AU.changePackage(kim.id, 'enterprise-plus', 'Super').error, /quotation/); assert.match(AU.changePackage(kim.id, 'micro', 'Super').error, /already on that package/); assert.match(AU.changePackage(kim.id, 'nope', 'Super').error, /available package/);
  assert.match(AU.changePackage(kim.id, 'starter', 'Super', { billing: 'termly' }).error, /billing period/);
});
await ok('school deletion is blocked in demo mode and leaves all local data intact', () => {
  const gone = reg('Gone', 'micro', 'annual', 80);
  A.updateAccount(gone.id, { status: 'approved' });
  assert.equal(A.login(gone.email, 'secret-pass-1').ok, true);
  Storage.StorageManager.set('students', 'student-1', { id: 'student-1', name: 'Learner' });
  A.logout();
  const invoice = P.createInvoice(gone.id, { items: [{ description: 'Package', amount: 100 }], dueDate: today });
  S.localSetSubscription(gone.id, { status: 'active', packageId: 'micro' }, 'test');
  assert.ok(invoice);
  assert.ok(S.localSubscriptionOf(gone.id));
  assert.throws(() => P.deleteSchool(gone.id, 'Super'), /unavailable in demo mode/);
  assert.ok(P.getSchool(gone.id));
  assert.ok(P.getInvoice(invoice.id));
  assert.ok(S.localSubscriptionOf(gone.id));
  assert.equal(A.listAccounts().some((account) => account.id === gone.id), true);
  assert.equal(store.has(`swiftIQEduFlow:t_${gone.tenantId}:students`), true);
});
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
