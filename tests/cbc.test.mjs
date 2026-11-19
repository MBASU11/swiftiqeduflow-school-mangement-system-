// Run: node tests/cbc.test.mjs — CBC competency tracking: outcomes, ratings, who may rate, lock, coverage, report card, profile.
import assert from 'node:assert/strict';
const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), get length() { return store.size; }, key: (i) => [...store.keys()][i] } };
let fail = 0; const ok = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', String(e.message).slice(0, 700)); } };
const L = await import('../js/services/competencyLogic.js');
console.log('Rules');
await ok('level labels: Kenyan abbreviations by default, initials for a custom scale', () => {
  assert.deepEqual(['exceeding', 'meeting', 'approaching', 'below'].map((k) => L.shortLabel(k)), ['EE', 'ME', 'AE', 'BE']); assert.equal(L.levelLabel('meeting'), 'Meeting expectation');
  const custom = [{ key: 'low', label: 'Needs help', value: 1 }, { key: 'high', label: 'Very good', value: 2 }]; assert.equal(L.shortLabel('low', custom), 'NH'); assert.equal(L.shortLabel('nope'), '');
});
await ok('pasted outcomes: three line shapes, every bad line reported, duplicates caught', () => {
  const r = L.parseOutcomeLines('Numbers | Whole numbers | Read and write numbers up to 10,000\nNumbers | Add and subtract\nCount in tens\n\n', []);
  assert.deepEqual(r.outcomes.map((o) => [o.strand, o.subStrand, o.description]), [['Numbers', 'Whole numbers', 'Read and write numbers up to 10,000'], ['Numbers', '', 'Add and subtract'], ['', '', 'Count in tens']]); assert.deepEqual(r.errors, []);
  const bad = L.parseOutcomeLines('a | b | c | d\nGood one\ngood one\n |  | \nx | ' + 'y'.repeat(401), [{ strand: '', subStrand: '', description: 'Existing' }, ]);
  assert.equal(bad.outcomes.length, 1); assert.equal(bad.errors.length, 4); assert.match(bad.errors[0], /Line 1/); assert.match(bad.errors[1], /Line 3.*already exists/); assert.match(L.parseOutcomeLines('Existing', [{ strand: '', subStrand: '', description: 'existing' }]).errors[0], /already exists/);
});
await ok('outcomes for a class: archived and other-class outcomes are left out; no class list means every class', () => {
  const o = [{ id: 'a', subjectId: 's', classIds: ['c1'] }, { id: 'b', subjectId: 's', classIds: ['c2'] }, { id: 'c', subjectId: 's', classIds: [] }, { id: 'd', subjectId: 's', classIds: ['c1'], status: 'archived' }, { id: 'e', subjectId: 't', classIds: ['c1'] }];
  assert.deepEqual(L.outcomesFor(o, { classId: 'c1', subjectId: 's' }).map((x) => x.id), ['a', 'c']);
  assert.deepEqual(L.groupByStrand([{ strand: 'N', subStrand: 'W', description: '1' }, { description: '2' }, { strand: 'N', subStrand: 'W', description: '3' }]).map((g) => [g.strand, g.list.length]), [['N › W', 2], ['General', 1]]);
});
await ok('class overview and support list count only real ratings; the newest rating wins', () => {
  const learners = ['a', 'b', 'c'].map((id) => ({ id })); const outs = [{ id: 'o1' }, { id: 'o2' }];
  const ratings = [{ studentId: 'a', outcomeId: 'o1', termId: 't', level: 'below', date: '2026-01-01' }, { studentId: 'a', outcomeId: 'o1', termId: 't', level: 'meeting', date: '2026-02-01' }, { studentId: 'b', outcomeId: 'o1', termId: 't', level: 'approaching', date: '2026-01-05' },
    { studentId: 'b', outcomeId: 'o2', termId: 't', level: 'below', date: '2026-01-05' }, { studentId: 'c', outcomeId: 'o1', termId: 'other', level: 'below', date: '2026-01-05' }];
  const ov = L.classOverview({ learners, outcomes: outs, ratings, termId: 't' }); assert.deepEqual([ov.rows[0].rated, ov.rows[0].notRated, ov.rows[0].distribution.meeting, ov.rows[0].distribution.below], [2, 1, 1, 0]); assert.equal(ov.meetingShare, 33);
  const sup = L.learnersNeedingSupport({ learners, outcomes: outs, ratings, termId: 't' }); assert.deepEqual(sup.map((x) => [x.learner.id, x.below, x.rated]), [['b', 2, 2]]);
});

console.log('Service (demo storage)');
const A = await import('../js/services/authService.js'); const { setCurrentRole } = await import('../js/services/accessService.js');
const reg = A.register({ name: 'Head', schoolName: 'CBC School', email: 'h@c.co', password: 'secret-pass-1', confirmPassword: 'secret-pass-1', planId: 'micro', billing: 'annual' });
A.updateAccount(reg.id, { status: 'approved' }); A.login('h@c.co', 'secret-pass-1'); setCurrentRole(null);
const { classRepo, subjectRepo, termRepo, curriculumRepo } = await import('../js/services/academicService.js'); const { studentRepo } = await import('../js/services/studentService.js'); const { teacherRepo } = await import('../js/services/peopleService.js');
const X = await import('../js/services/examService.js'); const T = await import('../js/services/teacherService.js'); const C = await import('../js/services/competencyService.js');
const cur = curriculumRepo.create({ name: 'CBC', type: 'cbc' }, 's'); const g4 = classRepo.create({ name: 'G4', order: 4, curriculumId: cur.id }, 's'); const g5 = classRepo.create({ name: 'G5', order: 5, curriculumId: cur.id }, 's');
const t1 = termRepo.create({ name: 'Term 1', isCurrent: true }, 's'); const t2 = termRepo.create({ name: 'Term 2' }, 's');
const maths = subjectRepo.create({ name: 'Maths', classIds: [g4.id, g5.id] }, 's'); const eng = subjectRepo.create({ name: 'English', classIds: [g4.id, g5.id] }, 's');
const amy = studentRepo.create({ admissionNumber: '1', firstName: 'Amy', lastName: 'K', classId: g4.id, status: 'active', parentIds: [] }, 's'); const ben = studentRepo.create({ admissionNumber: '2', firstName: 'Ben', lastName: 'K', classId: g4.id, status: 'active', parentIds: [] }, 's'); const cy = studentRepo.create({ admissionNumber: '3', firstName: 'Cy', lastName: 'K', classId: g5.id, status: 'active', parentIds: [] }, 's');
const teacher = teacherRepo.create({ firstName: 'Tea', lastName: 'Cher', email: 'tea@c.co', isActive: true }, 's'); await T.allocate(teacher.id, g4.id, maths.id);
A.createStaffAccount({ name: 'Tea Cher', email: 'tea@c.co', role: 'teacher', password: 'teach-pass-1' });
let d = await C.loadCompetency();
await ok('administrator pastes outcomes for a class; a bad line saves nothing; duplicates are refused', async () => {
  const bad = await C.addOutcomes(d, { text: 'Numbers | Count in tens\n| | ', curriculumId: cur.id, subjectId: maths.id, classIds: [g4.id] }); assert.equal(bad.ok, false); assert.equal((await C.loadCompetency()).outcomes.length, 0);
  const r = await C.addOutcomes(d, { text: 'Numbers | Whole numbers | Read numbers to 10,000\nNumbers | Whole numbers | Add and subtract\nMeasurement | Tell the time', curriculumId: cur.id, subjectId: maths.id, classIds: [g4.id] }); assert.deepEqual([r.ok, r.added], [true, 3]);
  assert.equal((await C.addOutcomes(d, { text: 'Measurement | Tell the time', curriculumId: cur.id, subjectId: maths.id, classIds: [g4.id] })).ok, false);
  assert.equal((await C.addOutcomes(d, { text: 'Reading | Read a short story', curriculumId: cur.id, subjectId: eng.id, classIds: [g4.id, g5.id] })).added, 1); d = await C.loadCompetency(); assert.equal(d.outcomes.length, 4);
});
const mO = () => d.outcomes.filter((o) => o.subjectId === maths.id); const engO = () => d.outcomes.find((o) => o.subjectId === eng.id);
await ok('rate: saves, same level is a no-op, a new level becomes the current one and the history is kept', async () => {
  const o = mO()[0]; const r1 = await C.rate(d, { studentId: amy.id, outcomeId: o.id, termId: t1.id, level: 'approaching' }); assert.deepEqual([r1.ok, r1.changed], [true, true]);
  const r2 = await C.rate(d, { studentId: amy.id, outcomeId: o.id, termId: t1.id, level: 'approaching' }); assert.equal(r2.changed, false); assert.equal(d.ratings.length, 1);
  await C.rate(d, { studentId: amy.id, outcomeId: o.id, termId: t1.id, level: 'meeting' }); d = await C.loadCompetency(); assert.equal(d.ratings.length, 2);
  assert.equal(L.latestRatings(d.ratings).find((r) => r.studentId === amy.id).level, 'meeting');
  await C.rate(d, { studentId: amy.id, outcomeId: o.id, termId: t2.id, level: 'below' }); d = await C.loadCompetency(); assert.equal(L.latestRatings(d.ratings).filter((r) => r.studentId === amy.id).length, 2); // a new term starts afresh
});
await ok('rate: refuses an unknown level, a missing term, the wrong class, and archived outcomes', async () => {
  const o = mO()[1]; const go = (x) => C.rate(d, { studentId: amy.id, outcomeId: o.id, termId: t1.id, level: 'meeting', ...x });
  assert.match((await go({ level: 'great' })).reason, /Choose a rating/); assert.match((await go({ termId: '' })).reason, /term/);
  assert.match((await go({ studentId: cy.id })).reason, /not for that learner's class/);
  await C.setOutcomeStatus(o, 'archived'); d = await C.loadCompetency(); assert.match((await go({})).reason, /archived/); await C.setOutcomeStatus(d.outcomes.find((x) => x.id === o.id), 'active'); d = await C.loadCompetency();
});
await ok('a teacher can rate only the class and subject they are allocated to', async () => {
  A.logout(); A.login('tea@c.co', 'teach-pass-1'); setCurrentRole('teacher'); const td = await C.loadCompetency();
  const good = await C.rate(td, { studentId: ben.id, outcomeId: mO()[0].id, termId: t1.id, level: 'exceeding' }); assert.equal(good.ok, true);
  assert.match((await C.rate(td, { studentId: ben.id, outcomeId: engO().id, termId: t1.id, level: 'meeting' })).reason, /not allocated/);
  assert.match((await C.rate(td, { studentId: cy.id, outcomeId: engO().id, termId: t1.id, level: 'meeting' })).reason, /not allocated/);
  assert.match((await C.addOutcomes(td, { text: 'Sneaky', curriculumId: cur.id, subjectId: eng.id, classIds: [g4.id] })).errors[0], /not allocated/);
  assert.equal((await C.addOutcomes(td, { text: 'Tell the time to the minute', curriculumId: cur.id, subjectId: maths.id, classIds: [g4.id] })).ok, true);
  assert.deepEqual(td.myClasses.map((c) => c.name), ['G4']);
  A.logout(); A.login('h@c.co', 'secret-pass-1'); setCurrentRole(null); d = await C.loadCompetency();
});
await ok('ratings freeze for that class and term once its report is submitted, and unfreeze if it is returned', async () => {
  const exam = X.examinationRepo.create({ name: 'Mid', termId: t1.id, classIds: [g4.id] }, 's'); const run = X.reportRunRepo.create({ examinationId: exam.id, classId: g4.id, status: 'in_moderation', history: [] }, 's');
  assert.match((await C.rate(d, { studentId: amy.id, outcomeId: mO()[0].id, termId: t1.id, level: 'exceeding' })).reason, /locked/);
  assert.equal((await C.rate(d, { studentId: amy.id, outcomeId: mO()[0].id, termId: t2.id, level: 'meeting' })).ok, true); // another term is not frozen
  assert.equal((await C.rate(d, { studentId: cy.id, outcomeId: engO().id, termId: t1.id, level: 'meeting' })).ok, true); // another class is not frozen
  X.reportRunRepo.update(run.id, { status: 'draft' }, 's'); assert.equal((await C.rate(d, { studentId: amy.id, outcomeId: mO()[0].id, termId: t1.id, level: 'exceeding' })).ok, true);
  X.reportRunRepo.update(run.id, { status: 'in_moderation' }, 's');
});
await ok('coverage: outcomes taught, planned and not covered, from lesson plans; scheme weeks done', async () => {
  const [o1, o2, o3] = mO(); const { LocalStorageRepository } = await import('../js/storage/Repository.js'); const lp = new LocalStorageRepository('lessonPlans', 'lp'); const sw = new LocalStorageRepository('schemesOfWork', 'sw');
  lp.create({ classId: g4.id, subjectId: maths.id, termId: t1.id, date: '2026-02-01', status: 'taught', outcomeIds: [o1.id] }, 's'); lp.create({ classId: g4.id, subjectId: maths.id, termId: t1.id, date: '2026-02-08', status: 'planned', outcomeIds: [o2.id] }, 's');
  sw.create({ classId: g4.id, subjectId: maths.id, termId: t1.id, title: 'T1', weeks: [{ status: 'done' }, { status: 'done' }, { status: 'planned' }, { status: 'planned' }] }, 's'); d = await C.loadCompetency();
  const cov = C.coverageFor(d, { classId: g4.id, subjectId: maths.id, termId: t1.id }); assert.deepEqual([cov.outcomes.total, cov.outcomes.taught, cov.outcomes.planned, cov.scheme.pct], [4, 1, 1, 50]);
  assert.equal(cov.outcomes.rows.find((r) => r.outcome.id === o3.id).state, 'not covered');
});
await ok('the report card carries a competency summary for that term and learner only', async () => {
  const { loadReportData, buildClassResults, buildReportModel } = await import('../js/services/reportCardService.js');
  const gs = X.gradingSystemRepo.create({ name: 'S', isDefault: true }, 's'); X.gradeBandRepo.create({ gradingSystemId: gs.id, grade: 'A', min: 0, max: 100 }, 's');
  const exam = X.examinationRepo.getAll().find((e) => e.name === 'Mid'); X.examScoreRepo.create({ examinationId: exam.id, subjectId: maths.id, studentId: amy.id, score: 70 }, 's'); X.examScoreRepo.create({ examinationId: exam.id, subjectId: maths.id, studentId: ben.id, score: 60 }, 's');
  const data = await loadReportData(); const res = buildClassResults(data, exam.id, g4.id);
  const a = buildReportModel(data, exam.id, g4.id, amy.id, res).competencies; assert.equal(a.length, 1); assert.deepEqual([a[0].subject, a[0].total, a[0].rated, a[0].counts.exceeding, a[0].counts.meeting], ['Maths', 4, 1, 1, 0]); // Amy's newest Term 1 rating is Exceeding
  assert.equal(buildReportModel(data, exam.id, g4.id, ben.id, res).competencies[0].counts.exceeding, 1);
  const { reportCardHtml } = await import('../js/components/reportCardDocument.js').catch(() => ({})); if (reportCardHtml) assert.match(reportCardHtml(buildReportModel(data, exam.id, g4.id, amy.id, res)), /Competencies \(CBC\)/);
});
await ok('the learner profile tab summarises the current term; it is closed to roles without access', async () => {
  const { profileTabHtml } = await import('../js/features/students/profileTabs.js'); const t = await profileTabHtml('Competencies', amy);
  assert.match(t, /Competencies, Term 1/); assert.match(t, /Maths/); assert.match(t, /reached 1 of 4/);
  setCurrentRole('accountant'); assert.match(await profileTabHtml('Competencies', amy), /does not have access/); setCurrentRole(null);
});
await ok("a published report shows competencies in the learner's portal; unpublished does not", async () => {
  const P = await import('../js/services/demoPortalService.js'); const exam = X.examinationRepo.getAll().find((e) => e.name === 'Mid'); const run = X.reportRunRepo.getAll().find((r) => r.examinationId === exam.id);
  A.createFamilyAccount({ role: 'student', linkedId: amy.id, name: 'Amy K', username: 'amyk', password: 'learner-pass-1' }); const acct = { ...A.listFamilyAccounts().find((a) => a.username === 'amyk'), role: 'student' };
  assert.equal((await P.buildDemoPortal(acct)).children[0].reportCards.length, 0);
  X.reportRunRepo.update(run.id, { status: 'published', publishedAt: new Date().toISOString() }, 's'); const cards = (await P.buildDemoPortal(acct)).children[0].reportCards; assert.equal(cards.length, 1); assert.equal(cards[0].snapshot.competencies[0].subject, 'Maths');
});
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
