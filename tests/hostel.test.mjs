// Run: node tests/hostel.test.mjs — boarding: beds, exeats and roll call.
import assert from 'node:assert/strict';
const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), get length() { return store.size; }, key: (i) => [...store.keys()][i] } };
let fail = 0; const ok = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', String(e.message).slice(0, 600)); } };
const L = await import('../js/services/hostelLogic.js');
console.log('Rules');
await ok('beds: gender, capacity, one bed per learner, archived hostels', () => {
  const boys = { id: 'h1', name: 'Simba', gender: 'boys' }, rooms = [{ id: 'r1', hostelId: 'h1', name: '1', capacity: 1 }, { id: 'r2', hostelId: 'h1', name: '2', capacity: 2 }];
  const base = { hostel: boys, rooms, hostels: [boys], allocations: [{ roomId: 'r1', studentId: 'a', status: 'active' }] };
  assert.match(L.allocateCheck({ ...base, room: rooms[0], student: { id: 'b', gender: 'male' } }).reason, /full/);
  assert.match(L.allocateCheck({ ...base, room: rooms[1], student: { id: 'g', gender: 'female' } }).reason, /boys' hostel/);
  assert.match(L.allocateCheck({ ...base, room: rooms[1], student: { id: 'a', gender: 'male' } }).reason, /Already has a bed in Simba/);
  assert.equal(L.allocateCheck({ ...base, room: rooms[1], student: { id: 'x', gender: '' } }).ok, true); // gender not recorded: not blocked
  assert.match(L.allocateCheck({ ...base, hostel: { ...boys, status: 'archived' }, room: rooms[1], student: { id: 'x' } }).reason, /not in use/);
  assert.match(L.allocateCheck({ ...base, room: rooms[1], student: { id: 'x', status: 'left' } }).reason, /current learners/);
});
await ok('exeat request validation', () => {
  const x = { studentId: 's', type: 'exeat', fromDate: '2026-03-06', returnDate: '2026-03-08', reason: 'Wedding', guardianContact: 'Mum 0700' };
  assert.deepEqual(L.validateExeat(x, { allocated: true }), []);
  assert.ok(L.validateExeat(x, { allocated: false })[0].includes('boarders'));
  assert.ok(L.validateExeat({ ...x, returnDate: '2026-03-01' }, { allocated: true }).some((e) => /before the leaving/.test(e)));
  assert.ok(L.validateExeat({ ...x, reason: ' ', guardianContact: '' }, { allocated: true }).length === 2);
  assert.ok(L.validateExeat(x, { allocated: true, existing: [{ id: 'o', studentId: 's', status: 'approved', fromDate: '2026-03-07', returnDate: '2026-03-09' }] }).some((e) => /overlaps/.test(e)));
  assert.deepEqual(L.validateExeat(x, { allocated: true, existing: [{ id: 'o', studentId: 's', status: 'rejected', fromDate: '2026-03-07', returnDate: '2026-03-09' }] }), []);
});
await ok('exeat moves: legal order, reason for rejection, no early release, warden-only decisions', () => {
  let x = { status: 'requested', fromDate: '2026-03-06', returnDate: '2026-03-08' };
  assert.equal(L.exeatAction(x, 'checkout').ok, false); assert.equal(L.exeatAction(x, 'reject', { note: '' }).ok, false);
  assert.equal(L.exeatAction(x, 'approve', { canApprove: false }).ok, false);
  const a = L.exeatAction(x, 'approve'); assert.equal(a.patch.status, 'approved'); x = { ...x, ...a.patch };
  assert.match(L.exeatAction(x, 'checkout', { today: '2026-03-05' }).reason, /cannot be released earlier/);
  const o = L.exeatAction(x, 'checkout', { today: '2026-03-06' }); assert.equal(o.patch.outDate, '2026-03-06'); x = { ...x, ...o.patch };
  assert.equal(L.isOverdue(x, '2026-03-09'), true); assert.equal(L.isOverdue(x, '2026-03-08'), false);
  assert.equal(L.exeatAction(x, 'cancel').ok, false); assert.equal(L.exeatAction(x, 'return', { today: '2026-03-09' }).patch.returnedDate, '2026-03-09');
});
await ok('roll call separates present, on exeat and unaccounted', () => {
  const b = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const r = L.rollCall({ boarders: b, presentIds: ['a'], exeats: [{ studentId: 'b', status: 'out' }, { studentId: 'c', status: 'approved' }] });
  assert.deepEqual([r.present, r.onExeat, r.missing].map((x) => x.map((s) => s.id)), [['a'], ['b'], ['c', 'd']]);
});

console.log('Service (demo storage)');
const { StorageManager } = await import('../js/storage/StorageManager.js'); StorageManager.setTenant('host'); // replaced below once the school account signs in
const S = await import('../js/services/hostelService.js'); const { studentRepo } = await import('../js/services/studentService.js'); const { setCurrentRole } = await import('../js/services/accessService.js');
const A = await import('../js/services/authService.js'); const { teacherRepo } = await import('../js/services/peopleService.js');
const reg = A.register({ name: 'Head', schoolName: 'H School', email: 'head@h.co', password: 'secret-pass-1', confirmPassword: 'secret-pass-1', planId: 'micro', billing: 'annual' });
A.updateAccount(reg.id, { status: 'approved' }); A.login('head@h.co', 'secret-pass-1'); setCurrentRole(null);
const kid = (n, g) => studentRepo.create({ admissionNumber: n, firstName: n, lastName: 'K', classId: 'c', gender: g, status: 'active', parentIds: [] }, 's');
const [amy, ben, cy] = [kid('Amy', 'female'), kid('Ben', 'male'), kid('Cy', 'male')];
let boys, girls, r1, r2;
await ok('hostels, rooms and allocation through the service', () => {
  boys = S.saveHostel({ name: 'Simba', gender: 'boys' }).hostel; girls = S.saveHostel({ name: 'Zuri', gender: 'girls' }).hostel;
  assert.equal(S.saveHostel({ name: 'simba', gender: 'boys' }).ok, false);
  r1 = S.saveRoom(boys.id, { name: '1', capacity: '1' }).room; r2 = S.saveRoom(boys.id, { name: '2', capacity: '2' }).room;
  assert.equal(S.saveRoom(boys.id, { name: '1', capacity: '3' }).ok, false);
  assert.ok(S.allocate(r1.id, ben.id).ok); assert.match(S.allocate(r1.id, cy.id).reason, /full/); assert.match(S.allocate(r2.id, amy.id).reason, /boys' hostel/);
  assert.match(S.allocate(r2.id, ben.id).reason, /Already has a bed/);
  assert.equal(S.saveRoom(boys.id, { name: '1', capacity: '0' }, r1.id).ok, false);
});
await ok('move frees the old bed; a full or wrong-gender target is refused; hostel with boarders cannot be archived', () => {
  assert.ok(S.move(ben.id, r2.id).ok); assert.equal(S.allocate(r1.id, cy.id).ok, true);
  assert.match(S.move(ben.id, r1.id).reason, /full/); assert.equal(S.archiveHostel(boys.id).ok, false); assert.equal(S.removeRoom(r1.id).ok, false);
});
let ex;
await ok('exeat lifecycle through the service; checkout of a learner who is out is refused', () => {
  const day = new Date().toISOString().slice(0, 10);
  assert.equal(S.requestExeat({ studentId: amy.id, type: 'exeat', fromDate: day, returnDate: day, reason: 'x', guardianContact: 'y' }).ok, false); // Amy is not boarding
  ex = S.requestExeat({ studentId: ben.id, type: 'exeat', fromDate: day, returnDate: day, reason: 'Wedding', guardianContact: 'Mum 0700' }).exeat;
  assert.ok(S.actOnExeat(ex.id, 'approve').ok); assert.ok(S.actOnExeat(ex.id, 'checkout').ok);
  assert.match(S.checkOut(ben.id).reason, /out on an exeat/);
});
await ok('roll call counts the learner on exeat as accounted for; replaced on re-save', () => {
  const day = new Date().toISOString().slice(0, 10);
  const r = S.recordRoll(boys.id, { date: day, session: 'evening', presentIds: [] }); assert.deepEqual([r.result.onExeat.length, r.result.missing.map((s) => s.firstName)], [1, ['Cy']]);
  S.recordRoll(boys.id, { date: day, session: 'evening', presentIds: [cy.id] }); assert.equal(S.rollRepo.getAll().length, 1);
  assert.equal(S.recordRoll(boys.id, { date: day, session: 'evening', presentIds: [amy.id] }).ok, false);
  assert.equal(S.recordRoll(boys.id, { date: '2999-01-01', session: 'evening', presentIds: [] }).ok, false);
});
await ok('return, then check-out cancels pending exeats and frees the bed', () => {
  assert.ok(S.actOnExeat(ex.id, 'return').ok);
  const day = new Date().toISOString().slice(0, 10); const e2 = S.requestExeat({ studentId: ben.id, type: 'weekend', fromDate: day, returnDate: day, reason: 'Home', guardianContact: 'Dad 0711' }).exeat;
  assert.ok(S.checkOut(ben.id).ok); assert.equal(S.exeatRepo.getById(e2.id).status, 'cancelled'); assert.equal(S.occupancy().find((o) => o.name === 'Simba').taken, 1);
});
await ok('only the administrator or the hostel warden may decide an exeat', () => {
  const warden = teacherRepo.create({ firstName: 'War', lastName: 'Den', email: 'warden@h.co', isActive: true }, 's'); S.saveHostel({ ...boys, wardenId: warden.id }, boys.id);
  assert.ok(A.createStaffAccount({ name: 'War Den', email: 'warden@h.co', role: 'teacher', password: 'teach-pass-1' }).ok); assert.ok(A.createStaffAccount({ name: 'Oth Er', email: 'other@h.co', role: 'teacher', password: 'teach-pass-2' }).ok);
  const al = S.allocate(r2.id, ben.id); assert.ok(al.ok, al.reason); const day = new Date().toISOString().slice(0, 10);
  const e3 = S.requestExeat({ studentId: ben.id, type: 'exeat', fromDate: day, returnDate: day, reason: 'Clinic', guardianContact: 'Mum 0700' }).exeat;
  A.logout(); A.login('other@h.co', 'teach-pass-2'); setCurrentRole('teacher'); assert.match(S.actOnExeat(e3.id, 'approve').reason, /warden/);
  A.logout(); A.login('warden@h.co', 'teach-pass-1'); setCurrentRole('teacher'); assert.ok(S.actOnExeat(e3.id, 'approve').ok);
  setCurrentRole(null);
});
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
