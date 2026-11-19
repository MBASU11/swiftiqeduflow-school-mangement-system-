// Run: node tests/capacity.test.mjs   (no packages needed)
import assert from 'node:assert/strict';
const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
globalThis.DOMException ??= class extends Error {};
globalThis.document = undefined;

const { StorageManager } = await import('../js/storage/StorageManager.js');
const { register } = await import('../js/services/authService.js');
const sub = await import('../js/services/subscriptionService.js');
const { studentRepo } = await import('../js/services/studentService.js');
const { CapacityError } = await import('../js/services/capacityService.js');
const { buildQuote, expiryFor, resolveEntitlements, getCatalogue } = await import('../js/services/packageService.js');

let n = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => console.log('  ✓', name), (e) => { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; });
const mk = (i, extra = {}) => ({ admissionNumber: `A${i}`, firstName: 'S', lastName: String(i), classId: 'c1', admissionDate: '2026-01-05', status: 'active', ...extra });

console.log('Capacity rules (paid 300 + overflow 20 = 320)');
const res = register({ schoolName: 'Test School', name: 'Admin', email: 'a@t.co', password: 'secret-pass-1', phone: '0700000000', planId: 'micro', billing: 'annual', studentCount: 250 });
const acct = res; const { updateAccount } = await import('../js/services/authService.js'); updateAccount(acct.id, { status: 'approved' });
await ok('school registered in local mode', () => assert.ok(StorageManager.hasTenant() || acct));
// make sure a tenant is open (approved owner)
const tenant = (await sub.listSchoolSubscriptions())[0];
const schoolId = tenant.schoolId;
await sub.adminSetSubscription(schoolId, { status: 'active', packageId: 'starter', billing: 'annual', addons: [], startDate: '2026-01-01', expiryDate: '2026-12-31' }, 'test setup');
const { listAccounts } = await import('../js/services/authService.js');
StorageManager.setTenant(listAccounts()[0].tenantId);
const { setCurrentRole } = await import('../js/services/accessService.js');
setCurrentRole(null);
// authService.currentAccount needs a session

const { effectiveLimits } = await import('../js/services/packageService.js');
const subRow = (await sub.listSchoolSubscriptions())[0].subscription;
await ok('effectiveLimits starter = 300 + 20', () => { const l = effectiveLimits(subRow); assert.equal(l.paidLimit, 300); assert.equal(l.max, 320); });

// Drive the guard directly with the real provider swapped for this school's limits.
const { setLimitsProvider } = await import('../js/services/capacityGuard.js');
setLimitsProvider(() => effectiveLimits(subRow));

for (let i = 1; i <= 320; i++) studentRepo.create(mk(i));
await ok('320 students can be registered (301–320 over-limit but allowed)', () => assert.equal(StorageManager.all('students').length, 320));
await ok('student 321 is rejected with the standard message', () => {
  assert.throws(() => studentRepo.create(mk(321)), (e) => e instanceof CapacityError && /maximum permitted population of 320 students/.test(e.message) && /upgrade your subscription/.test(e.message));
  assert.equal(StorageManager.all('students').length, 320);
});
await ok('bulk import that would pass the maximum is refused whole', () => {
  assert.throws(() => studentRepo.createMany([mk(400), mk(401)]), CapacityError);
  assert.equal(StorageManager.all('students').length, 320);
});
await ok('existing records can still be updated at capacity', () => {
  const s = StorageManager.all('students')[0];
  assert.ok(studentRepo.update(s.id, { firstName: 'Renamed' }));
});
await ok('re-activating an archived student at the maximum is refused', () => {
  const s = StorageManager.all('students')[1];
  studentRepo.update(s.id, { status: 'archived' });   // withdrawing/archiving is never blocked
  studentRepo.create(mk(321));                         // frees a seat -> room again
  assert.throws(() => studentRepo.update(s.id, { status: 'active' }), CapacityError);
});
await ok('graduating / withdrawing frees capacity (recalculated)', () => {
  const s = StorageManager.all('students').find((x) => x.status === 'active');
  studentRepo.update(s.id, { status: 'graduated' });
  studentRepo.create(mk(322));
});
await ok('same admission number never counts twice', () => {
  const active = StorageManager.all('students').filter((x) => x.status === 'active');
  const dupAdm = active[2].admissionNumber;
  // 320 active now; a record repeating an existing admission number adds nobody
  studentRepo.create(mk(0, { admissionNumber: dupAdm }));
});

console.log('Package rules');
await ok('quote lists every line and states the total', () => {
  const q = buildQuote({ packageId: 'professional', billing: 'termly' });
  assert.equal(q.total, 8000); assert.equal(q.lines[0].amount, 8000); assert.equal(q.currency, 'KES');
});
await ok('annual prices from the brief', () => {
  const t = Object.fromEntries(getCatalogue().packages.map((p) => [p.id, p.prices.annual]));
  assert.deepEqual(t, { micro: 5000, starter: 10000, professional: 20000, advanced: 35000, enterprise: 50000, 'enterprise-plus': null });
});
await ok('unpriced add-ons make the quote "to be confirmed", never silently free', () => {
  const q = buildQuote({ packageId: 'micro', billing: 'annual', addons: ['bursar-pack'] });
  assert.equal(q.needsQuotation, true);
});
await ok('expiry = start + one period − 1 day', () => {
  assert.equal(expiryFor('2026-01-01', 'annual'), '2026-12-31');
  assert.equal(expiryFor('2026-01-31', 'monthly'), '2026-02-27');
});
await ok('unverified (requested) subscription restricts to essential modules only', () => {
  const e = resolveEntitlements({ status: 'requested', packageId: 'micro' });
  assert.equal(e.modules.students, true); assert.equal(e.modules.finance, false);
});

console.log('Verification workflow');
await ok('submitting a reference does NOT activate; verifying does', async () => {
  const { currentAccount } = await import('../js/services/authService.js');
  // act as the school: set session
  StorageManager.setGlobal('session', { accountId: listAccounts()[0].id });
  const before = (await sub.listSchoolSubscriptions())[0].subscription;
  await sub.requestSubscription({ packageId: 'professional', billing: 'annual', addons: [] });
  await sub.submitPayment({ method: 'mpesa', reference: 'QWE123', amount: 20000 });
  let s = (await sub.listSchoolSubscriptions())[0].subscription;
  assert.equal(s.packageId, before.packageId, 'package unchanged until verified');
  assert.equal((await sub.listSchoolSubscriptions())[0].pendingPayments, 1);
  await assert.rejects(() => sub.submitPayment({ method: 'mpesa', reference: 'qwe123', amount: 20000 }), /already been submitted/);
  const pay = (await sub.listPayments())[0];
  await sub.verifyPayment(pay.id, { approve: true, note: 'Seen in bank statement', startDate: '2026-02-01' });
  s = (await sub.listSchoolSubscriptions())[0].subscription;
  assert.equal(s.packageId, 'professional'); assert.equal(s.status, 'active'); assert.equal(s.expiryDate, '2027-01-31');
  await assert.rejects(() => sub.verifyPayment(pay.id, { approve: true }), /already been verified/);
});
await ok('every change is audited with a reason; a reason is required', async () => {
  await assert.rejects(() => sub.adminSetSubscription(schoolId, { limits: { overflow: 30 } }, ''), /reason/i);
  await sub.adminSetSubscription(schoolId, { limits: { overflow: 30 } }, 'Temporary growth');
  const log = await sub.listAudit();
  assert.ok(log.some((l) => l.action === 'Subscription changed' && l.reason === 'Temporary growth'));
});
console.log(process.exitCode ? '\nFAILED' : '\nAll passed');
