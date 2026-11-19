// Run: node tests/portal.test.mjs — parent and learner logins and portal data (demo mode).
import assert from 'node:assert/strict';
const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), get length() { return store.size; }, key: (i) => [...store.keys()][i] } };
let fail = 0; const ok = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', String(e.message).slice(0, 600)); } };
const A = await import('../js/services/authService.js');
const X = await import('../js/services/examService.js');
const P = await import('../js/services/demoPortalService.js');
const { studentRepo } = await import('../js/services/studentService.js');
const { parentRepo } = await import('../js/services/peopleService.js');
const { classRepo, subjectRepo, termRepo } = await import('../js/services/academicService.js');
const { invoiceRepo, paymentRepo } = await import('../js/services/financeService.js');
const { announcementRepo } = await import('../js/services/communicationService.js');
const { setCurrentRole } = await import('../js/services/accessService.js');
const S = await import('../js/services/reportRunService.js');

const reg = A.register({ name: 'Head', schoolName: 'P School', email: 'head@p.co', password: 'secret-pass-1', confirmPassword: 'secret-pass-1', planId: 'micro', billing: 'annual' });
A.updateAccount(reg.id, { status: 'approved' }); A.login('head@p.co', 'secret-pass-1'); setCurrentRole(null);
const g = classRepo.create({ name: 'G4', order: 4 }, 's'), g2 = classRepo.create({ name: 'G5', order: 5 }, 's');
const term = termRepo.create({ name: 'T1', isCurrent: true }, 's'); const sub = subjectRepo.create({ name: 'Maths', classIds: [g.id] }, 's');
const par = parentRepo.create({ firstName: 'Pat', lastName: 'M', phone: '0700111222' }, 's');
const mk = (n, i, c, pids) => studentRepo.create({ admissionNumber: 'A' + i, firstName: n, lastName: 'M', classId: c.id, status: 'active', parentIds: pids }, 's');
const amy = mk('Amy', 1, g, [par.id]), ben = mk('Ben', 2, g, [par.id]), cy = mk('Cy', 3, g2, []);
const gs = X.gradingSystemRepo.create({ name: 'S', isDefault: true }, 's'); X.gradeBandRepo.create({ gradingSystemId: gs.id, grade: 'A', min: 0, max: 100 }, 's');
const exam = X.examinationRepo.create({ name: 'Mid', termId: term.id, classIds: [g.id] }, 's');
[amy, ben].forEach((s) => { X.examScoreRepo.create({ examinationId: exam.id, subjectId: sub.id, studentId: s.id, score: 70 }, 's'); X.reportCommentRepo.create({ examinationId: exam.id, studentId: s.id, subjectId: sub.id, text: 'ok', status: 'ready' }, 's'); });
const inv = invoiceRepo.create({ studentId: amy.id, totalAmount: 10000, status: 'unpaid', items: [{ name: 'Tuition', amount: 10000 }], createdAt: '2026-01-01', dueDate: '2026-02-01' }, 's');
paymentRepo.create({ studentId: amy.id, invoiceId: inv.id, amount: 4000, date: '2026-01-05', status: 'confirmed' }, 's');
announcementRepo.create({ title: 'For parents', body: 'x', audience: 'parents', createdAt: '2026-01-01T00:00:00Z' }, 's');
announcementRepo.create({ title: 'For learners', body: 'x', audience: 'students', createdAt: '2026-01-02T00:00:00Z' }, 's');

console.log('Logins');
await ok('learner login by admission number, parent login by username; both only reach the portal role', () => {
  assert.ok(A.createFamilyAccount({ role: 'student', linkedId: amy.id, name: 'Amy M', username: 'A1', password: 'pass-word-1' }).ok);
  assert.ok(A.createFamilyAccount({ role: 'parent', linkedId: par.id, name: 'Pat M', username: '0700111222', password: 'pass-word-2' }).ok);
  A.logout(); assert.equal(A.login('a1', 'pass-word-1').account.role, 'student'); // case-insensitive username
  A.logout(); assert.equal(A.login('0700111222', 'pass-word-2').account.role, 'parent');
  A.logout(); assert.equal(A.login('A1', 'wrong').ok, false);
  A.login('head@p.co', 'secret-pass-1');
});
await ok('duplicate usernames and second logins for the same person are refused', () => {
  assert.equal(A.createFamilyAccount({ role: 'student', linkedId: ben.id, username: 'a1', password: 'pass-word-3' }).ok, false);
  assert.equal(A.createFamilyAccount({ role: 'student', linkedId: amy.id, username: 'other', password: 'pass-word-3' }).ok, false);
});
await ok('family logins are kept out of the staff team list', () => assert.equal(A.listTeam().length, 1));
await ok('only an administrator can create logins', () => {
  const t = A.createStaffAccount({ name: 'Tea', email: 't@p.co', role: 'teacher', password: 'teach-pass-1' }); assert.ok(t.ok);
  A.logout(); A.login('t@p.co', 'teach-pass-1');
  assert.throws(() => A.createFamilyAccount({ role: 'student', linkedId: cy.id, username: 'cy3', password: 'pass-word-4' }), /administrator/i);
  A.logout(); A.login('head@p.co', 'secret-pass-1');
});

console.log('Portal data');
const acc = (u) => A.listFamilyAccounts().find((a) => a.username === u);
await ok('parent sees only linked children, with fees; learner sees only self and no fees', async () => {
  const pp = await P.buildDemoPortal(acc('0700111222')); assert.deepEqual(pp.children.map((c) => c.name).sort(), ['Amy M', 'Ben M']);
  const amyP = pp.children.find((c) => c.name === 'Amy M'); assert.equal(amyP.fees.balance, 6000);
  const lp = await P.buildDemoPortal(acc('a1')); assert.deepEqual(lp.children.map((c) => c.name), ['Amy M']);
  assert.deepEqual([lp.children[0].fees.billed, lp.children[0].fees.invoices.length, lp.children[0].fees.receipts.length], [0, 0, 0]); assert.equal(lp.audience, 'learner');
});
await ok('notices follow the audience', async () => {
  assert.deepEqual((await P.buildDemoPortal(acc('0700111222'))).notices.map((n) => n.title), ['For parents']);
  assert.deepEqual((await P.buildDemoPortal(acc('a1'))).notices.map((n) => n.title), ['For learners']);
});
await ok('report cards appear only after the run is PUBLISHED, and unpublishing hides them again', async () => {
  assert.equal((await P.buildDemoPortal(acc('a1'))).children[0].reportCards.length, 0);
  S.act(exam.id, g.id, 'submit'); X.reportPolicyRepo.create({ separateApprover: false }, 's'); S.act(exam.id, g.id, 'approve');
  assert.equal((await P.buildDemoPortal(acc('a1'))).children[0].reportCards.length, 0);
  S.act(exam.id, g.id, 'publish');
  const c = (await P.buildDemoPortal(acc('a1'))).children[0].reportCards; assert.equal(c.length, 1); assert.equal(c[0].snapshot.student.name, 'Amy M');
  S.act(exam.id, g.id, 'unpublish', 'typo'); assert.equal((await P.buildDemoPortal(acc('a1'))).children[0].reportCards.length, 0);
});
await ok("a learner in another class gets nothing from this class's published run", async () => {
  S.act(exam.id, g.id, 'publish');
  assert.equal((await P.buildDemoPortal({ role: 'student', linkedId: cy.id, name: 'Cy' })).children[0].reportCards.length, 0);
});
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
