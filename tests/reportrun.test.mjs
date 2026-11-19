// Run: node tests/reportrun.test.mjs — the report-run workflow: rules, marks lock, share gate, signature.
import assert from 'node:assert/strict';
const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), get length() { return store.size; }, key: (i) => [...store.keys()][i] } };
let fail = 0; const ok = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', String(e.message).slice(0, 600)); } };
const { StorageManager } = await import('../js/storage/StorageManager.js'); StorageManager.setTenant('test');
const E = await import('../js/services/academicEngine.js');
const X = await import('../js/services/examService.js');
const S = await import('../js/services/reportRunService.js');
const { studentRepo } = await import('../js/services/studentService.js');
const { saveScores, assessmentRepo, assessmentScoreRepo } = await import('../js/services/assessmentService.js');
const { setCurrentRole } = await import('../js/services/accessService.js');
const { createLocalTransport, createProcessedLog } = await import('../js/offline/localTransport.js');

console.log('Engine rules');
await ok('applyAction stamps submit/approve/publish and return wipes them', () => {
  let r = E.emptyRun('ex', 'c1'); const a = { name: 'Ann' }, b = { name: 'Bob', title: 'Principal' };
  r = E.applyAction(r, 'submit', a); assert.equal(r.status, 'in_moderation'); assert.equal(r.submittedBy, 'Ann');
  r = E.applyAction(r, 'approve', b); assert.equal([r.approvedBy, r.approverTitle].join('|'), 'Bob|Principal');
  r = E.applyAction(r, 'publish', b); assert.equal(r.status, 'published');
  r = E.applyAction(r, 'unpublish', b, { note: 'typo' }); assert.equal(`${r.status}|${r.publishedAt}`, 'approved|undefined');
  r = E.applyAction(r, 'reopen', b, { note: 'fix' }); assert.equal(`${r.status}|${r.approvedBy}|${r.submittedBy}`, 'draft|undefined|undefined'); assert.equal(r.history.length, 5);
});
await ok('share gate: closed until published, open when switched off', () => {
  assert.equal(E.shareGate({ status: 'approved' }).ok, false);
  assert.equal(E.shareGate({ status: 'published' }).ok, true);
  assert.equal(E.shareGate({ status: 'draft' }, { ...E.DEFAULT_POLICY, enforceWorkflow: false }).ok, true);
  assert.equal(E.shareGate(undefined).ok, false);
});

console.log('Service (demo storage)');
const put = (repo, rec) => repo.create(rec, 'seed');
const cls = 'c1';
const stu = put(studentRepo, { firstName: 'Amy', lastName: 'K', classId: cls, status: 'active' });
const { subjectRepo, termRepo } = await import('../js/services/academicService.js');
const sub = put(subjectRepo, { name: 'Maths', classIds: [cls] });
const term = put(termRepo, { name: 'T1', startDate: '2026-01-01', endDate: '2026-04-30' });
const exam = put(X.examinationRepo, { name: 'Mid', termId: term.id, classIds: [cls] });
const gs = put(X.gradingSystemRepo, { name: 'Std', isDefault: true });
put(X.gradeBandRepo, { gradingSystemId: gs.id, grade: 'A', min: 0, max: 100 });
setCurrentRole(null);

await ok('cannot submit while marks or comments are missing', () => {
  assert.throws(() => S.act(exam.id, cls, 'submit'), /missing marks/);
});
await ok('submit works once marks and comments are in; marks then lock', () => {
  X.saveExamScores(exam.id, sub.id, { [stu.id]: '80' });
  put(X.reportCommentRepo, { examinationId: exam.id, studentId: stu.id, subjectId: sub.id, text: 'Good', status: 'ready' });
  S.act(exam.id, cls, 'submit');
  assert.equal(S.getRun(exam.id, cls).status, 'in_moderation');
  assert.throws(() => X.saveExamScores(exam.id, sub.id, { [stu.id]: '10' }), /locked/);
  assert.equal(X.getExamScoresFor(exam.id, sub.id).get(stu.id).score, 80);
});
await ok('submitter cannot approve their own report (default policy)', () => {
  assert.throws(() => S.act(exam.id, cls, 'approve'), /cannot also approve/);
});
await ok('another administrator approves; principal comment still editable, teacher comment not', () => {
  const r = S.getRun(exam.id, cls); X.reportRunRepo.update(r.id, { submittedBy: 'Someone Else' }, 'test');
  S.act(exam.id, cls, 'approve');
  X.saveReportCardComment(exam.id, stu.id, { principalComment: 'Well done' });
  assert.throws(() => X.saveReportCardComment(exam.id, stu.id, { teacherComment: 'changed' }), /locked/);
});
await ok('return needs a reason, reopens marks, and clears the approval', () => {
  assert.throws(() => S.act(exam.id, cls, 'reopen', ''), /reason/i);
  S.act(exam.id, cls, 'reopen', 'wrong mark');
  assert.equal(S.getRun(exam.id, cls).approvedBy, undefined);
  X.saveExamScores(exam.id, sub.id, { [stu.id]: '85' });
});
await ok('a teacher can submit but not approve or publish', () => {
  setCurrentRole('teacher');
  const acts = S.availableActions(exam.id, cls); assert.equal(acts.find((a) => a.action === 'submit').ok, true);
  setCurrentRole(null);
  S.act(exam.id, cls, 'submit'); setCurrentRole('teacher');
  assert.equal(S.availableActions(exam.id, cls).filter((a) => a.ok).length, 0);
  setCurrentRole(null);
});
await ok('assessments inside the term are locked too; outside it are not', () => {
  const a = put(assessmentRepo, { name: 'CAT', classId: cls, subjectId: sub.id, date: '2026-02-10', maxScore: 50 });
  const b = put(assessmentRepo, { name: 'Later', classId: cls, subjectId: sub.id, date: '2026-08-10', maxScore: 50 });
  assert.throws(() => saveScores(a.id, { [stu.id]: '10' }), /locked/);
  saveScores(b.id, { [stu.id]: '10' });
});
await ok('offline transport refuses a locked exam mark from another device', async () => {
  const t = createLocalTransport({ repos: { attendance: null, assessments: assessmentRepo, assessmentScores: assessmentScoreRepo, examinations: X.examinationRepo, examScores: X.examScoreRepo }, canWrite: () => true, classAllowed: () => true, isLocked: S.lockReasonForWrite, processed: createProcessedLog({ read: () => ({}), write: () => {} }) });
  const r = await t.push({ opId: 'o1', kind: 'examScore', baseVersion: 0, deviceId: 'd', payload: { examinationId: exam.id, subjectId: sub.id, studentId: stu.id, classId: cls, score: 5 } });
  assert.equal(r.status, 'rejected'); assert.match(r.reason, /locked/);
});

console.log(fail ? `\n${fail} FAILED` : '\nAll passed');
process.exitCode = fail ? 1 : 0;
