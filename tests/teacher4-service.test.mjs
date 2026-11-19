// Run: node tests/teacher4-service.test.mjs — Phase Four workflows against stored records (demo mode).
import assert from 'node:assert/strict';
const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), get length() { return store.size; }, key: (i) => [...store.keys()][i] } };
globalThis.DOMException ??= class extends Error {}; globalThis.document = undefined;
let fail = 0; const ok = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', String(e.message).slice(0, 500)); } };

const auth = await import('../js/services/authService.js');
const access = await import('../js/services/accessService.js');
const ac = await import('../js/services/academicService.js');
const st = await import('../js/services/studentService.js');
const pe = await import('../js/services/peopleService.js');
const ex = await import('../js/services/examService.js');
const comm = await import('../js/services/communicationService.js');
const assessment = await import('../js/services/assessmentService.js');
const audit = await import('../js/services/auditService.js');
const T = await import('../js/services/teacherService.js');
const TL = await import('../js/services/teacherLogic.js');
const RC = await import('../js/services/reportCardService.js');

const acct = auth.register({ name: 'Head', schoolName: 'T4 School', email: 'h@t4.co', password: 'secret-pass-1', confirmPassword: 'secret-pass-1', planId: 'micro', billing: 'annual', studentCount: 20, acceptedTerms: true });
auth.updateAccount(acct.id, { status: 'approved' }); auth.logout(); auth.login('h@t4.co', 'secret-pass-1'); access.setCurrentRole('school_admin');
const cur = ac.curriculumRepo.create({ name: 'My Curriculum' });
const g4 = ac.classRepo.create({ name: 'Grade 4', order: 4, curriculumId: cur.id }), g5 = ac.classRepo.create({ name: 'Grade 5', order: 5 });
const term = ac.termRepo.create({ name: 'Term 1', isCurrent: true });
const math = ac.subjectRepo.create({ name: 'Mathematics', classIds: [g4.id, g5.id] }), eng = ac.subjectRepo.create({ name: 'English', classIds: [g4.id] });
const mk = (n, cls) => st.studentRepo.create({ admissionNumber: n + cls.name, firstName: n, lastName: 'K', classId: cls.id, admissionDate: '2026-01-05', status: 'active', parentIds: [] });
const amy = mk('Amy', g4), zed = mk('Zed', g5);
const tina = pe.teacherRepo.create({ firstName: 'Tina', lastName: 'T', email: 'tina@t4.co', category: 'teaching' }), tom = pe.teacherRepo.create({ firstName: 'Tom', lastName: 'T', email: 'tom@t4.co', category: 'teaching' });
const tinaAccount = auth.createStaffAccount({ name: 'Tina T', email: 'tina@t4.co', role: 'teacher', password: 'secret-pass-1' }).account;
auth.createStaffAccount({ name: 'Tom T', email: 'tom@t4.co', role: 'teacher', password: 'secret-pass-1' });
const exam = ex.examinationRepo.create({ name: 'End Term 1', termId: term.id });
await T.allocate(tina.id, g4.id, math.id, { classTeacher: true }); await T.allocate(tom.id, g4.id, eng.id);
const asTeacher = (email) => { auth.logout(); auth.login(email, 'secret-pass-1'); access.setCurrentRole('teacher'); };

console.log('Class teacher');
await ok('one class teacher per class; a second choice replaces the first', async () => {
  const tomRow = (await T.loadTeacher()).teachingAssignments.find((a) => a.teacherId === tom.id);
  await T.setClassTeacher(tomRow.id, true);
  let rows = (await T.loadTeacher()).teachingAssignments.filter((a) => a.classId === g4.id && a.classTeacher);
  assert.deepEqual(rows.map((a) => a.teacherId), [tom.id]);
  const tinaRow = (await T.loadTeacher()).teachingAssignments.find((a) => a.teacherId === tina.id); await T.setClassTeacher(tinaRow.id, true);
  rows = (await T.loadTeacher()).teachingAssignments.filter((a) => a.classId === g4.id && a.classTeacher); assert.deepEqual(rows.map((a) => a.teacherId), [tina.id]);
});

console.log('Report-card preparation');
await ok('a teacher comments only on their own subject, for learners in the class; drafts stay private', async () => {
  asTeacher('tina@t4.co');
  const c = await T.saveSubjectComment({ examinationId: exam.id, studentId: amy.id, subjectId: math.id, classId: g4.id, text: 'Excellent progress' });
  assert.equal(c.status, 'draft');
  await assert.rejects(() => T.saveSubjectComment({ examinationId: exam.id, studentId: amy.id, subjectId: eng.id, classId: g4.id, text: 'x' }), /subjects you teach/);
  await assert.rejects(() => T.saveSubjectComment({ examinationId: exam.id, studentId: zed.id, subjectId: math.id, classId: g5.id, text: 'x' }), /subjects you teach/);
  await assert.rejects(() => T.saveSubjectComment({ examinationId: exam.id, studentId: zed.id, subjectId: math.id, classId: g4.id, text: 'x' }), /not in this class/);
  await assert.rejects(() => T.saveSubjectComment({ examinationId: exam.id, studentId: amy.id, subjectId: math.id, classId: g4.id, text: 'x'.repeat(301) }), /300/);
  const d = await T.loadTeacher(); assert.deepEqual(TL.readyCommentsFor(d.reportComments, exam.id, amy.id, d.subjectById), []);
});
await ok('marking ready publishes them to the report card model; re-saving the same comment edits, never duplicates', async () => {
  assert.equal(await T.markCommentsReady({ examinationId: exam.id, classId: g4.id }), 1);
  await T.saveSubjectComment({ examinationId: exam.id, studentId: amy.id, subjectId: math.id, classId: g4.id, text: 'Excellent progress, keep going', ready: true });
  const d = await T.loadTeacher(); assert.equal(d.reportComments.length, 1);
  assert.deepEqual(TL.readyCommentsFor(d.reportComments, exam.id, amy.id, d.subjectById).map((x) => [x.subject, x.text, x.by]), [['Mathematics', 'Excellent progress, keep going', 'Tina T']]);
  const model = RC.buildReportModel(await RC.loadReportData(), exam.id, g4.id, amy.id);
  assert.deepEqual(model.subjectComments.map((x) => x.text), ['Excellent progress, keep going']);
  await assert.rejects(() => T.saveSubjectComment({ examinationId: exam.id, studentId: amy.id, subjectId: math.id, classId: g4.id, text: '  ', ready: true }), /Write the comment/);
});
await ok('only the class teacher writes the class comment, and the principal\'s comment is left alone', async () => {
  const { reportCardRepo } = ex; access.setCurrentRole('school_admin'); reportCardRepo.create({ examinationId: exam.id, studentId: amy.id, teacherComment: '', principalComment: 'Principal says hi' }); asTeacher('tina@t4.co');
  await T.saveClassTeacherComment({ examinationId: exam.id, studentId: amy.id, classId: g4.id, text: 'A joy to teach' });
  const rec = reportCardRepo.getAll().find((r) => r.studentId === amy.id); assert.deepEqual([rec.teacherComment, rec.principalComment], ['A joy to teach', 'Principal says hi']);
  asTeacher('tom@t4.co'); await assert.rejects(() => T.saveClassTeacherComment({ examinationId: exam.id, studentId: amy.id, classId: g4.id, text: 'hijack' }), /class teacher/);
});

console.log('Class announcements');
await ok('teachers post to their own classes only; the post is a normal class announcement', async () => {
  asTeacher('tina@t4.co');
  await T.postClassAnnouncement({ classId: g4.id, title: 'Trip on Friday', body: 'Bring a packed lunch.' });
  const a = comm.announcementRepo.getAll().at(-1); assert.deepEqual([a.audience, a.audienceIds, a.authorName], ['class', [g4.id], 'Tina T']);
  await T.updateClassAnnouncement({ id: a.id, classId: g4.id, title: 'Trip next Friday', body: 'Bring lunch.' });
  assert.equal(comm.announcementRepo.getById(a.id).title, 'Trip next Friday');
  await assert.rejects(() => T.postClassAnnouncement({ classId: g5.id, title: 'x', body: 'y' }), /classes you teach/);
  await assert.rejects(() => T.postClassAnnouncement({ classId: g4.id, title: ' ', body: 'y' }), /title and a message/);
  asTeacher('tom@t4.co');
  await assert.rejects(() => T.updateClassAnnouncement({ id: a.id, classId: g4.id, title: 'Hijack', body: 'x' }), /person who posted/);
  await assert.rejects(() => T.deleteClassAnnouncement(a.id), /person who posted/);
  asTeacher('tina@t4.co');
  assert.equal(await T.deleteClassAnnouncement(a.id), true);
});

console.log('Homework corrections');
await ok('edits retain submissions, unsafe changes are blocked, and assignments with linked work cannot be deleted', async () => {
  asTeacher('tina@t4.co');
  const h = await T.saveHomework({ classId: g4.id, subjectId: math.id, title: 'Fractions', dueDate: '2026-03-20', maxMarks: 10 });
  await T.saveSubmission({ homework: h, studentId: amy.id, status: 'marked', marks: '8', feedback: 'Good work' });
  await assert.rejects(() => T.deleteHomework(h.id), /1 linked submission/);
  await assert.rejects(() => T.saveHomework({ ...h, maxMarks: 7 }), /cannot be reduced/);
  await assert.rejects(() => T.saveHomework({ ...h, classId: g5.id }), /cannot be changed/);
  const edited = await T.saveHomework({ ...h, title: 'Fractions revision' });
  assert.equal(edited.title, 'Fractions revision');
  assert.equal((await T.loadTeacher()).homeworkSubmissions.find((s) => s.homeworkId === h.id).marks, 8);
  const empty = await T.saveHomework({ classId: g4.id, subjectId: math.id, title: 'Unused draft', dueDate: '2026-03-25' });
  assert.equal(await T.deleteHomework(empty.id), true);
});

console.log('Welfare record controls');
await ok('only permitted users can delete, and deletion is recorded by the local repository audit', async () => {
  access.setCurrentRole('school_admin');
  await T.setWelfareGrant(tinaAccount.id, 'Tina T', true);
  asTeacher('tina@t4.co');
  const note = await T.saveWelfare({ studentId: amy.id, category: 'attendance', observation: 'Follow up with family.' });
  const before = audit.getAuditLog().length;
  asTeacher('tom@t4.co');
  await assert.rejects(() => T.deleteWelfare(note.id), /permission/);
  asTeacher('tina@t4.co');
  assert.equal(await T.deleteWelfare(note.id), true);
  assert.equal(audit.getAuditLog().length, before + 1);
  assert.match(audit.getAuditLog()[0].action, /removed welfare note/);
});

console.log('Assessment definitions');
await ok('max-score reductions below saved marks and deletion with linked scores are refused', async () => {
  access.setCurrentRole('school_admin');
  const def = assessment.assessmentRepo.create({ name: 'CAT', classId: g4.id, subjectId: math.id, maxScore: 20 });
  assessment.assessmentScoreRepo.create({ assessmentId: def.id, studentId: amy.id, score: 15 });
  assert.throws(() => assessment.updateAssessmentDefinition(def.id, { maxScore: 14 }), /cannot be reduced below a saved mark/);
  assert.throws(() => assessment.updateAssessmentDefinition(def.id, { classId: g5.id }), /Class cannot be changed/);
  assert.throws(() => assessment.deleteAssessmentDefinition(def.id), /linked score record/);
  assert.equal(assessment.updateAssessmentDefinition(def.id, { name: 'CAT updated', maxScore: 15 }).name, 'CAT updated');
  const empty = assessment.assessmentRepo.create({ name: 'Empty', classId: g4.id, subjectId: math.id, maxScore: 20 });
  assert.equal(assessment.deleteAssessmentDefinition(empty.id), true);
});

console.log('Curriculum planning frameworks');
await ok('only an administrator sets a framework; lesson plans keep exactly the fields their curriculum defines', async () => {
  asTeacher('tina@t4.co'); await assert.rejects(() => T.savePlanningFramework(cur.id, [{ key: 'strand', label: 'Strand' }]), /can.?t change/i);
  access.setCurrentRole('school_admin'); await T.savePlanningFramework(cur.id, [{ key: 'strand', label: 'Strand' }, { key: 'outcomes', label: 'Outcomes', multiline: true }]);
  await assert.rejects(() => T.savePlanningFramework(cur.id, [{ key: 'Bad Key', label: 'x' }]), /not a valid/);
  asTeacher('tina@t4.co');
  const plan = await T.saveLessonPlan({ classId: g4.id, subjectId: math.id, date: '2026-03-02', topic: 'Fractions', objectives: 'Add', extra: { strand: ' Numbers ', outcomes: '', sneaky: 'x' } });
  assert.deepEqual(plan.extra, { strand: 'Numbers' });
  const d = await T.loadTeacher(); assert.deepEqual(d.frameworkFor(g4.id).map((f) => f.key), ['strand', 'outcomes']); assert.deepEqual(d.frameworkFor(g5.id), []);
});
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
