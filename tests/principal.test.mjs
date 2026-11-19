// Run: node tests/principal.test.mjs — the principal's view: attention items and the snapshot from real school data.
import assert from 'node:assert/strict';
const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), get length() { return store.size; }, key: (i) => [...store.keys()][i] } };
let fail = 0; const ok = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', String(e.message).slice(0, 600)); } };
const L = await import('../js/services/principalLogic.js');
console.log('Logic');
await ok('collection rate is capped and null with nothing billed', () => { assert.equal(L.collectionRate(1000, 250), 25); assert.equal(L.collectionRate(1000, 2000), 100); assert.equal(L.collectionRate(0, 0), null); });
await ok('low attendance: below the line only, lowest first, no-record classes ignored', () => {
  const r = L.lowAttendanceClasses([{ className: 'A', averagePercentage: 80 }, { className: 'B', averagePercentage: 95 }, { className: 'C', averagePercentage: 60 }, { className: 'D', averagePercentage: null }]);
  assert.deepEqual(r.map((x) => x.className), ['C', 'A']);
});
await ok('attention items: decisions first, wording singular/plural, nothing when all clear', () => {
  const none = L.attentionItems({ inModeration: 0, approved: 0, enquiries: 0, toAdmit: 0, lowAttendance: [], arrearsCount: 0, lowStock: 0, currency: 'KES' }); assert.deepEqual(none, []);
  const items = L.attentionItems({ inModeration: 1, approved: 2, enquiries: 0, toAdmit: 1, lowAttendance: [{ className: 'G4', averagePercentage: 70 }], arrearsCount: 3, arrearsTotal: 12500, lowStock: 0, currency: 'KES' });
  assert.equal(items[0].text, '1 class report waiting for your approval'); assert.equal(items[1].text, '2 approved reports not yet published to parents');
  assert.ok(items.slice(0, 2).every((i) => i.level === 'act') && items.slice(2).every((i) => i.level === 'watch'));
  assert.ok(items.some((i) => i.text === 'G4 attendance is 70% over the last 30 days')); assert.ok(items.some((i) => i.text === '3 learners have unpaid fees, KES 12,500 in total'));
});
await ok('report board defaults a class with no run to draft', () => assert.deepEqual(L.reportBoard([{ id: 'c1', name: 'G4' }, { id: 'c2', name: 'G5' }], [{ examinationId: 'e', classId: 'c1', status: 'published' }], 'e').map((b) => b.status), ['published', 'draft']));

console.log('Snapshot (demo storage)');
const { StorageManager } = await import('../js/storage/StorageManager.js'); StorageManager.setTenant('p7');
const X = await import('../js/services/examService.js');
const { classRepo, subjectRepo, termRepo } = await import('../js/services/academicService.js');
const { studentRepo } = await import('../js/services/studentService.js');
const { attendanceRepo } = await import('../js/services/attendanceService.js');
const { invoiceRepo, paymentRepo } = await import('../js/services/financeService.js');
const { admissionRepo } = await import('../js/services/admissionsService.js');
const S = await import('../js/services/reportRunService.js'); const { setCurrentRole } = await import('../js/services/accessService.js');
const { principalSnapshot } = await import('../js/services/principalService.js');
setCurrentRole(null);
const g = classRepo.create({ name: 'G4', order: 4 }, 's'); const term = termRepo.create({ name: 'T1' }, 's'); const sub = subjectRepo.create({ name: 'M', classIds: [g.id] }, 's');
const st = ['a', 'b'].map((n, i) => studentRepo.create({ admissionNumber: 'S' + i, firstName: n, lastName: 'K', classId: g.id, status: 'active', parentIds: [] }, 's'));
const gs = X.gradingSystemRepo.create({ name: 'S', isDefault: true }, 's'); X.gradeBandRepo.create({ gradingSystemId: gs.id, grade: 'A', min: 50, max: 100 }, 's'); X.gradeBandRepo.create({ gradingSystemId: gs.id, grade: 'E', min: 0, max: 49.99 }, 's');
const exam = X.examinationRepo.create({ name: 'Mid', termId: term.id, classIds: [g.id] }, 's');
[[st[0], 80], [st[1], 40]].forEach(([s, v]) => { X.examScoreRepo.create({ examinationId: exam.id, subjectId: sub.id, studentId: s.id, score: v }, 's'); X.reportCommentRepo.create({ examinationId: exam.id, studentId: s.id, subjectId: sub.id, text: 'ok', status: 'ready' }, 's'); });
const today = new Date().toISOString().slice(0, 10);
st.forEach((s, i) => attendanceRepo.create({ studentId: s.id, classId: g.id, date: today, status: i === 0 ? 'present' : 'absent' }, 's'));
const inv = invoiceRepo.create({ studentId: st[0].id, totalAmount: 10000, status: 'unpaid', items: [{ name: 'T', amount: 10000 }], createdAt: today, dueDate: today }, 's');
paymentRepo.create({ studentId: st[0].id, invoiceId: inv.id, amount: 4000, date: today, status: 'confirmed' }, 's');
admissionRepo.create({ childName: 'New Kid', stage: 'application', createdAt: today }, 's');
await ok('snapshot: counts, attendance, fees, performance and attention come from real data', async () => {
  S.act(exam.id, g.id, 'submit');
  const s = await principalSnapshot();
  assert.equal(s.students, 2); assert.equal(s.attendanceToday, 50); assert.equal(s.collected30d, 4000); assert.equal(s.outstanding, 6000); assert.equal(s.collectionRate, 40);
  assert.deepEqual(s.academics.map((a) => [a.className, a.learners, a.mean, a.passRate]), [['G4', 2, 60, 50]]);
  assert.equal(s.board[0].status, 'in_moderation');
  const t = s.attention.map((a) => a.text);
  assert.ok(t.includes('1 class report waiting for your approval')); assert.ok(t.includes('1 admission application waiting for a decision'));
  assert.ok(t.includes('G4 attendance is 50% over the last 30 days')); assert.ok(t.includes('1 learner has unpaid fees, KES 6,000 in total'));
});
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
