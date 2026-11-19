// Run: node tests/activities.test.mjs — clubs, sports and societies: rules and service.
import assert from 'node:assert/strict';
const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), get length() { return store.size; }, key: (i) => [...store.keys()][i] } };
let fail = 0; const ok = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', String(e.message).slice(0, 600)); } };
const L = await import('../js/services/activitiesLogic.js');
console.log('Rules');
await ok('activity validation', () => {
  assert.deepEqual(L.validateActivity({ name: 'Chess', category: 'club', capacity: '', meetingDay: 'Friday', startTime: '16:00', endTime: '17:00' }), []);
  const e = L.validateActivity({ name: ' ', category: 'x', capacity: '0', meetingDay: 'Sunday', startTime: '17:00', endTime: '16:00' });
  assert.ok(e.length >= 4); assert.ok(e.some((x) => /end time/.test(x)) && e.some((x) => /Capacity/.test(x)));
});
await ok('join: refuses full, duplicate, archived, non-current; warns on a timetable clash', () => {
  const a = { id: 'a', name: 'Chess', capacity: 1, status: 'active', meetingDay: 'Friday', startTime: '16:00', endTime: '17:00' };
  const b = { id: 'b', name: 'Drama', status: 'active', meetingDay: 'Friday', startTime: '16:30', endTime: '17:30' };
  const s1 = { id: 's1', status: 'active' }, s2 = { id: 's2', status: 'active' };
  const members = [{ activityId: 'a', studentId: 's1', status: 'active' }];
  assert.match(L.joinCheck({ activity: a, student: s2, members, activities: [a, b] }).reason, /Full/);
  assert.match(L.joinCheck({ activity: a, student: s1, members, activities: [a, b] }).reason, /Already/);
  assert.match(L.joinCheck({ activity: { ...a, status: 'archived' }, student: s2, members: [], activities: [a] }).reason, /no longer/);
  assert.match(L.joinCheck({ activity: b, student: { id: 's9', status: 'left' }, members: [], activities: [b] }).reason, /current learners/);
  const c = L.joinCheck({ activity: b, student: s1, members, activities: [a, b] }); assert.equal(c.ok, true); assert.match(c.warnings[0], /Clashes with Chess/);
});
await ok('attendance counts only sessions while a member', () => {
  const sessions = [{ date: '2026-01-01', presentIds: ['s'] }, { date: '2026-02-01', presentIds: ['s'] }, { date: '2026-03-01', presentIds: [] }, { date: '2026-04-01', presentIds: ['s'] }];
  assert.deepEqual(L.attendanceFor(sessions, { studentId: 's', joinedDate: '2026-02-01', leftDate: '2026-03-15' }), { attended: 1, total: 2, pct: 50 });
  assert.equal(L.attendanceFor([], { studentId: 's', joinedDate: '2026-01-01' }).pct, null);
});
await ok('session validation: no future dates, only members', () => {
  assert.ok(L.validateSession({ date: '2999-01-01', presentIds: [], memberIds: [] }).length);
  assert.ok(L.validateSession({ date: '2026-01-01', presentIds: ['x'], memberIds: ['y'] }).some((x) => /Only members/.test(x)));
});
await ok('participation ignores archived activities and learners who left', () => {
  const p = L.participation([{ id: '1' }, { id: '2' }, { id: '3', status: 'left' }], [{ activityId: 'a', studentId: '1', status: 'active' }, { activityId: 'x', studentId: '2', status: 'active' }], [{ id: 'a' }, { id: 'x', status: 'archived' }]);
  assert.deepEqual([p.total, p.taking, p.pct, p.none.map((s) => s.id)], [2, 1, 50, ['2']]);
});

console.log('Service (demo storage)');
const { StorageManager } = await import('../js/storage/StorageManager.js'); StorageManager.setTenant('act');
const S = await import('../js/services/activitiesService.js'); const { studentRepo } = await import('../js/services/studentService.js'); const { setCurrentRole } = await import('../js/services/accessService.js');
setCurrentRole(null);
const kids = ['A', 'B', 'C'].map((n, i) => studentRepo.create({ admissionNumber: 'X' + i, firstName: n, lastName: 'K', classId: 'c', status: 'active', parentIds: [] }, 's'));
let act;
await ok('create, reject duplicate name, capacity cannot drop below members', () => {
  const r = S.saveActivity({ name: 'Chess Club', category: 'club', capacity: '2', meetingDay: 'Friday', startTime: '16:00', endTime: '17:00' }); assert.ok(r.ok); act = r.activity;
  assert.equal(S.saveActivity({ name: 'chess club', category: 'club' }).ok, false);
  S.joinActivity(act.id, kids[0].id); S.joinActivity(act.id, kids[1].id);
  assert.match(S.saveActivity({ ...act, capacity: '1' }, act.id).errors[0], /capacity cannot be below/);
});
await ok('capacity enforced; leaving frees a place; rejoining reuses the record', () => {
  assert.match(S.joinActivity(act.id, kids[2].id).reason, /Full/);
  const m = S.membersOf(act.id).find((x) => x.studentId === kids[1].id); S.leaveActivity(m.id);
  assert.equal(S.joinActivity(act.id, kids[2].id).ok, true);
  const before = S.memberRepo.getAll().length; S.leaveActivity(S.membersOf(act.id).find((x) => x.studentId === kids[2].id).id); S.joinActivity(act.id, kids[1].id);
  assert.equal(S.memberRepo.getAll().length, before);
});
await ok('a session is replaced when recorded again for the same date; non-members refused', () => {
  const d = new Date().toISOString().slice(0, 10);
  assert.ok(S.recordSession(act.id, { date: d, presentIds: [kids[0].id] }).ok); assert.ok(S.recordSession(act.id, { date: d, presentIds: [kids[0].id, kids[1].id], note: 'x' }).ok);
  assert.equal(S.sessionsOf(act.id).length, 1); assert.equal(S.sessionsOf(act.id)[0].presentIds.length, 2);
  assert.equal(S.recordSession(act.id, { date: d, presentIds: [kids[2].id] }).ok, false);
});
await ok('achievements need a title, date and level', () => {
  assert.equal(S.addAchievement(act.id, { title: '', date: '2026-01-01', level: 'school' }).ok, false);
  assert.ok(S.addAchievement(act.id, { title: 'County finalists', date: '2026-05-01', level: 'county', studentId: kids[0].id }).ok); assert.equal(S.achievementsOf(act.id).length, 1);
});
await ok("a learner's activities list and archive hides it from participation", () => {
  assert.equal(S.activitiesOfStudent(kids[0].id).length, 1); assert.equal(S.participationNow().taking, 2);
  S.archiveActivity(act.id); assert.equal(S.activitiesOfStudent(kids[0].id).length, 0); assert.equal(S.participationNow().taking, 0);
  assert.equal(S.joinActivity(act.id, kids[2].id).ok, false);
});
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
