// Run: node tests/auth.test.mjs
import assert from 'node:assert/strict';
const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), get length() { return store.size; }, key: (i) => [...store.keys()][i] } };
Object.defineProperty(globalThis.window.localStorage, 'length', { get: () => store.size });
globalThis.DOMException ??= class extends Error {}; globalThis.document = undefined;
let fail = 0; const ok = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', e.message); } };

const policy = await import('../js/lib/sessionPolicy.js');
const { StorageManager } = await import('../js/storage/StorageManager.js');
const auth = await import('../js/services/authService.js');
const plat = await import('../js/services/platformService.js');
const access = await import('../js/services/accessService.js');
const MIN = 60 * 1000;
const T0 = 1_700_000_000_000; // a realistic clock; 0 would look like "no timestamp"

console.log('Session policy');
await ok('fresh session is valid', () => assert.equal(policy.sessionState(policy.newSession({}, T0), 'school', T0 + 5 * MIN), 'valid'));
await ok('school session expires after 60 idle minutes; admin after 20', () => {
  const s = policy.newSession({}, T0);
  assert.equal(policy.sessionState(s, 'school', T0 + 59 * MIN), 'valid'); assert.equal(policy.sessionState(s, 'school', T0 + 61 * MIN), 'expired');
  assert.equal(policy.sessionState(s, 'admin', T0 + 19 * MIN), 'valid'); assert.equal(policy.sessionState(s, 'admin', T0 + 21 * MIN), 'expired');
});
await ok('activity extends the idle window but never the absolute cap (school 12h, admin 4h)', () => {
  let s = policy.newSession({}, T0);
  for (let t = 10 * MIN; t < 4 * 60 * MIN; t += 10 * MIN) s = policy.touched(s, T0 + t);
  assert.equal(policy.sessionState(s, 'admin', T0 + 4 * 60 * MIN - MIN), 'valid');
  assert.equal(policy.sessionState(policy.touched(s, T0 + 4 * 60 * MIN + 5 * MIN), 'admin', T0 + 4 * 60 * MIN + 6 * MIN), 'expired');
});
await ok('sessions without timestamps (old format) are treated as expired', () => assert.equal(policy.sessionState({ accountId: 'x' }, 'school'), 'expired'));

console.log('No default administrator');
await ok('a fresh install has no platform administrator and no seeded password', () => {
  assert.equal(plat.adminExists(), false); assert.equal(plat.ensureDefaultAdmin, undefined);
  const r = plat.adminLogin('swiftiqenterprise@gmail.com', '12345'); assert.equal(r.ok, false);
});
await ok('the first administrator is created with their own password and can sign in', () => {
  const d = { name: 'Owner', email: 'owner@example.co', password: 'a-long-passphrase-1', confirmPassword: 'a-long-passphrase-1' };
  assert.deepEqual(plat.validateAdminSetup(d), []); plat.registerAdmin(d);
  assert.equal(plat.adminLogin('owner@example.co', 'wrong-password').ok, false); assert.equal(plat.adminLogin('owner@example.co', d.password).ok, true);
});

console.log('School sessions');
let acct;
await ok('register + login create a timestamped session', () => {
  acct = auth.register({ name: 'Head', schoolName: 'A School', email: 'a@a.co', password: 'secret-pass-1', confirmPassword: 'secret-pass-1', planId: 'micro', billing: 'annual', studentCount: 40, acceptedTerms: true });
  auth.updateAccount(acct.id, { status: 'approved' }); auth.logout();
  assert.equal(auth.login('a@a.co', 'bad-password').ok, false); assert.equal(auth.login('a@a.co', 'secret-pass-1').ok, true);
  const s = StorageManager.getGlobal('session'); assert.ok(s.startedAt && s.lastActive);
});
await ok('reloading the page does not restart the session clock', () => {
  const before = StorageManager.getGlobal('session').startedAt;
  assert.ok(auth.restoreSession()); assert.ok(auth.restoreSession());
  assert.equal(StorageManager.getGlobal('session').startedAt, before);
});
await ok('an idle session is ended on restore and the school data space is closed', () => {
  const s = StorageManager.getGlobal('session'); StorageManager.setGlobal('session', { ...s, lastActive: Date.now() - 61 * MIN });
  assert.equal(auth.restoreSession(), undefined); assert.equal(auth.hasSchoolSession(), false); assert.equal(StorageManager.hasTenant(), false);
});

console.log('Role permissions and school separation');
await ok('a teacher cannot write finance records; an accountant cannot write students', () => {
  access.setCurrentRole('teacher'); assert.equal(access.canWriteCollection('invoices'), false); assert.equal(access.canWriteCollection('attendance'), true);
  access.setCurrentRole('accountant'); assert.equal(access.canWriteCollection('students'), false); assert.equal(access.canWriteCollection('payments'), true);
  access.setCurrentRole(null);
});
await ok('records saved in school A are invisible from school B', () => {
  const b = auth.register({ name: 'Other', schoolName: 'B School', email: 'b@b.co', password: 'secret-pass-2', confirmPassword: 'secret-pass-2', planId: 'micro', billing: 'annual', studentCount: 10, acceptedTerms: true });
  auth.updateAccount(b.id, { status: 'approved' });
  const a = auth.listAccounts().find((x) => x.email === 'a@a.co');
  StorageManager.setTenant(a.tenantId); StorageManager.set('students', 's1', { id: 's1', firstName: 'Only-in-A' });
  StorageManager.setTenant(b.tenantId); assert.equal(StorageManager.all('students').length, 0);
  StorageManager.setTenant(a.tenantId); assert.equal(StorageManager.all('students').length, 1);
});
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
