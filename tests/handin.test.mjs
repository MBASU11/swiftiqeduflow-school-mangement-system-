// Run: node tests/handin.test.mjs — learners handing in homework (demo mode).
import assert from 'node:assert/strict';
const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), get length() { return store.size; }, key: (i) => [...store.keys()][i] } };
let fail = 0; const ok = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', String(e.message).slice(0, 600)); } };
const L = await import('../js/services/handInLogic.js');
console.log('Rules');
const hw = { id: 'h', classId: 'c', dueDate: '2026-03-10', status: 'published' }; const stu = { id: 's', classId: 'c' };
await ok('before the deadline: allowed, can change; after: first hand-in allowed (late) but a made hand-in is frozen; marked is frozen', () => {
  assert.deepEqual(L.handInCheck({ homework: hw, student: stu, submission: undefined, today: '2026-03-09' }), { ok: true, reason: '', late: false });
  assert.equal(L.handInCheck({ homework: hw, student: stu, submission: { status: 'submitted' }, today: '2026-03-10' }).ok, true);
  const l = L.handInCheck({ homework: hw, student: stu, submission: undefined, today: '2026-03-11' }); assert.deepEqual([l.ok, l.late], [true, true]);
  assert.match(L.handInCheck({ homework: hw, student: stu, submission: { status: 'late' }, today: '2026-03-11' }).reason, /deadline has passed/);
  assert.match(L.handInCheck({ homework: hw, student: stu, submission: { status: 'marked' }, today: '2026-03-01' }).reason, /already marked/);
  assert.match(L.handInCheck({ homework: hw, student: { id: 'x', classId: 'other' }, submission: undefined, today: '2026-03-01' }).reason, /not for your class/);
  assert.match(L.handInCheck({ homework: { ...hw, status: 'draft' }, student: stu, submission: undefined, today: '2026-03-01' }).reason, /not available/);
});
await ok('answer validation: needs text or file; type, size and data URL checked', () => {
  assert.ok(L.validateAnswer({ text: '  ' }).some((e) => /Write your answer/.test(e)));
  assert.deepEqual(L.validateAnswer({ text: 'x' }), []);
  const f = { name: 'a.png', type: 'image/png', size: 100, dataUrl: 'data:image/png;base64,AAAA' };
  assert.deepEqual(L.validateAnswer({ attachment: f }), []);
  assert.ok(L.validateAnswer({ attachment: { ...f, type: 'application/x-msdownload', dataUrl: 'data:application/x-msdownload;base64,AAAA' } })[0].includes('PNG or JPEG'));
  assert.ok(L.validateAnswer({ attachment: { ...f, size: 400 * 1024 } }).some((e) => /smaller than 300 KB/.test(e)));
  assert.ok(L.validateAnswer({ attachment: { ...f, dataUrl: 'data:text/html;base64,AAAA' } }).some((e) => /could not be read/.test(e)));
  assert.ok(L.validateAnswer({ attachment: { ...f, dataUrl: 'data:image/png;base64,<script>' } }).some((e) => /could not be read/.test(e)));
  assert.ok(L.validateAnswer({ text: 'x'.repeat(5001) }).some((e) => /under 5,000/.test(e)));
});

console.log('Service and portal (demo storage)');
const A = await import('../js/services/authService.js'); const { setCurrentRole } = await import('../js/services/accessService.js');
const { studentRepo } = await import('../js/services/studentService.js'); const { classRepo, subjectRepo } = await import('../js/services/academicService.js');
const reg = A.register({ name: 'Head', schoolName: 'HW School', email: 'head@hw.co', password: 'secret-pass-1', confirmPassword: 'secret-pass-1', planId: 'micro', billing: 'annual' });
A.updateAccount(reg.id, { status: 'approved' }); A.login('head@hw.co', 'secret-pass-1'); setCurrentRole(null);
const { LocalStorageRepository } = await import('../js/storage/Repository.js'); const H = new LocalStorageRepository('homework', 'homework'); const SUBS = new LocalStorageRepository('homeworkSubmissions', 'submission');
const g = classRepo.create({ name: 'G4', order: 4 }, 's'), g2 = classRepo.create({ name: 'G5', order: 5 }, 's'); const sub = subjectRepo.create({ name: 'Maths', classIds: [g.id] }, 's');
const amy = studentRepo.create({ admissionNumber: 'A1', firstName: 'Amy', lastName: 'K', classId: g.id, status: 'active', parentIds: [] }, 's');
const cy = studentRepo.create({ admissionNumber: 'A3', firstName: 'Cy', lastName: 'K', classId: g2.id, status: 'active', parentIds: [] }, 's');
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const open = H.create({ classId: g.id, subjectId: sub.id, title: 'Fractions', dueDate: day(3), maxMarks: 10, status: 'published', instructions: 'Do page 4' }, 's');
const past = H.create({ classId: g.id, subjectId: sub.id, title: 'Old one', dueDate: day(-3), status: 'published' }, 's');
for (const [l, n, u, pw] of [[amy.id, 'Amy K', 'A1', 'learner-pass-1'], [cy.id, 'Cy K', 'A3', 'learner-pass-3']]) { const r = A.createFamilyAccount({ role: 'student', linkedId: l, name: n, username: u, password: pw }); if (!r.ok) throw new Error(r.errors.join(' ')); }
const F = (u) => A.listFamilyAccounts().find((a) => a.username === u.toLowerCase());
const HI = await import('../js/services/handInService.js'); const P = await import('../js/services/demoPortalService.js'); const T = await import('../js/services/teacherService.js');
const acct = (u) => ({ ...F(u), role: 'student' });
await ok('learner hands in text, then changes it before the deadline; the first date and status are kept', () => {
  const r = HI.handIn(acct('A1'), open.id, { text: 'Answer v1' }); assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.submission.status, 'submitted'); assert.equal(r.submission.handedInBy, 'learner');
  const r2 = HI.handIn(acct('A1'), open.id, { text: 'Answer v2', attachment: { name: 'work.png', type: 'image/png', size: 10, dataUrl: 'data:image/png;base64,AAAA' } }); assert.ok(r2.ok);
  assert.equal(SUBS.getAll().length, 1); assert.equal(SUBS.getAll()[0].text, 'Answer v2'); assert.equal(SUBS.getAll()[0].attachment.name, 'work.png');
  assert.equal(HI.handIn(acct('A1'), open.id, { text: 'Answer v3' }).ok, true); assert.equal(SUBS.getAll()[0].attachment.name, 'work.png'); // attachment kept when not mentioned
  assert.equal(HI.handIn(acct('A1'), open.id, { text: 'Answer v4', attachment: null }).ok, true); assert.equal(SUBS.getAll()[0].attachment, null);
});
await ok('a late first hand-in is recorded as late; once handed in, a past deadline freezes it', () => {
  assert.equal(HI.handIn(acct('A1'), past.id, { text: 'Sorry' }).submission.status, 'late');
  assert.match(HI.handIn(acct('A1'), past.id, { text: 'Edit' }).errors[0], /deadline has passed/);
});
await ok("a learner cannot hand in for another class, as a parent, or without an answer", () => {
  assert.match(HI.handIn(acct('A3'), open.id, { text: 'x' }).errors[0], /not for your class/);
  assert.match(HI.handIn({ ...F('A1'), role: 'parent' }, open.id, { text: 'x' }).errors[0], /Only the learner/);
  assert.match(HI.handIn(acct('A1'), open.id, { text: ' ' }).errors[0], /Write your answer/);
});
await ok("a teacher marking keeps the learner's answer, and the portal hides marks until feedback is published", async () => {
  const hw = H.getById(open.id);
  await T.saveSubmission({ homework: hw, studentId: amy.id, status: 'marked', marks: 8, feedback: 'Good work' });
  const s = SUBS.getAll().find((x) => x.homeworkId === open.id); assert.equal(s.text, 'Answer v4'); assert.equal(s.status, 'marked');
  let row = (await P.buildDemoPortal(acct('A1'))).children[0].homework.find((h) => h.id === open.id);
  assert.deepEqual([row.marks, row.feedback, row.state, row.canHandIn], [undefined, undefined, 'submitted', false]);
  assert.match(HI.handIn(acct('A1'), open.id, { text: 'late edit' }).errors[0], /already marked/);
  await T.publishFeedback(s.id, true);
  row = (await P.buildDemoPortal(acct('A1'))).children[0].homework.find((h) => h.id === open.id); assert.deepEqual([row.marks, row.feedback, row.state], [8, 'Good work', 'marked']);
});
await ok("a parent's portal shows status but offers no hand-in", async () => {
  const par = (await import('../js/services/peopleService.js')).parentRepo.create({ firstName: 'Pat', lastName: 'K' }, 's'); studentRepo.update(amy.id, { parentIds: [par.id] }, 's');
  const pp = await P.buildDemoPortal({ role: 'parent', linkedId: par.id, name: 'Pat' }); const row = pp.children[0].homework.find((h) => h.id === past.id);
  assert.equal(row.canHandIn, undefined); assert.equal(row.answer, undefined);
});
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
