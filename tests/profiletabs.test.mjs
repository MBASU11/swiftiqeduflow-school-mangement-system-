// Run: node tests/profiletabs.test.mjs — the student profile tabs read from the other modules, and respect who may see what.
import assert from 'node:assert/strict';
const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), get length() { return store.size; }, key: (i) => [...store.keys()][i] } };
let fail = 0; const ok = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', String(e.message).slice(0, 700)); } };
const A = await import('../js/services/authService.js'); const { setCurrentRole } = await import('../js/services/accessService.js');
const reg = A.register({ name: 'Head', schoolName: 'PT School', email: 'h@pt.co', password: 'secret-pass-1', confirmPassword: 'secret-pass-1', planId: 'micro', billing: 'annual' });
A.updateAccount(reg.id, { status: 'approved' }); A.login('h@pt.co', 'secret-pass-1'); setCurrentRole(null);
const { classRepo, subjectRepo, termRepo } = await import('../js/services/academicService.js'); const { studentRepo } = await import('../js/services/studentService.js');
const X = await import('../js/services/examService.js'); const { attendanceRepo } = await import('../js/services/attendanceService.js');
const F = await import('../js/services/financeService.js'); const D = await import('../js/services/disciplineService.js'); const T = await import('../js/services/transportService.js');
const AC = await import('../js/services/activitiesService.js'); const H = await import('../js/services/healthService.js'); const { profileTabHtml } = await import('../js/features/students/profileTabs.js');
const g = classRepo.create({ name: 'G4', order: 4 }, 's'); const term = termRepo.create({ name: 'T1' }, 's'); const maths = subjectRepo.create({ name: 'Maths', classIds: [g.id] }, 's'); const eng = subjectRepo.create({ name: 'English', classIds: [g.id] }, 's');
const amy = studentRepo.create({ admissionNumber: '1', firstName: 'Amy', lastName: 'K', classId: g.id, status: 'active', parentIds: [] }, 's'); const ben = studentRepo.create({ admissionNumber: '2', firstName: 'Ben', lastName: 'K', classId: g.id, status: 'active', parentIds: [] }, 's');
const gs = X.gradingSystemRepo.create({ name: 'S', isDefault: true }, 's'); X.gradeBandRepo.create({ gradingSystemId: gs.id, grade: 'A', min: 70, max: 100 }, 's'); X.gradeBandRepo.create({ gradingSystemId: gs.id, grade: 'B', min: 0, max: 69.99 }, 's');
const exam = X.examinationRepo.create({ name: 'Mid Term', termId: term.id, classIds: [g.id], startDate: '2026-03-01' }, 's');
[[amy, maths, 80], [amy, eng, 70], [ben, maths, 50], [ben, eng, 60]].forEach(([s, sub, v]) => X.examScoreRepo.create({ examinationId: exam.id, subjectId: sub.id, studentId: s.id, score: v }, 's'));
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
[['present', 1], ['present', 2], ['absent', 3], ['late', 4]].forEach(([st, n]) => attendanceRepo.create({ studentId: amy.id, classId: g.id, date: day(n), status: st }, 's'));
const inv = F.invoiceRepo.create({ studentId: amy.id, totalAmount: 10000, status: 'unpaid', items: [{ name: 'Tuition', amount: 10000 }], createdAt: day(5), dueDate: day(-5) }, 's'); F.recordPayment({ studentId: amy.id, invoiceId: inv.id, amount: 4000, method: 'mpesa', reference: 'QWE1', date: day(2) });
D.disciplineRepo.create({ studentId: amy.id, date: day(6), category: 'dress_code', description: 'Missing tie', status: 'open' }, 's');
const route = T.routeRepo.create({ name: 'Route A', stops: [{ id: 's1', name: 'Market' }] }, 's'); T.transportAssignmentRepo.create({ studentId: amy.id, routeId: route.id, stopId: 's1' }, 's');
const club = AC.saveActivity({ name: 'Chess Club', category: 'club' }).activity; AC.joinActivity(club.id, amy.id); AC.addAchievement(club.id, { title: 'Zone champions', date: day(10), level: 'zone', studentId: amy.id });
H.saveProfile(amy.id, { allergyStatus: 'listed', allergies: [{ substance: 'Peanuts', severity: 'severe' }], emergencyName: 'Mum', emergencyPhone: '0700111222', consentFirstAid: true });

const html = (tab, s = amy) => profileTabHtml(tab, s);
await ok('Academics: marks, average, grade and position per examination', async () => { const t = await html('Academics'); assert.match(t, /Mid Term/); assert.match(t, /Average 75/); assert.match(t, /Position 1 of 2/); assert.match(t, /Maths/); assert.match(t, /80 \(A\)/); });
await ok('Academics: honest empty state for a class with no marks', async () => { const c2 = classRepo.create({ name: 'G5', order: 5 }, 's'); const s = studentRepo.create({ admissionNumber: '9', firstName: 'Zed', lastName: 'K', classId: c2.id, status: 'active', parentIds: [] }, 's'); assert.match(await html('Academics', s), /No marks have been entered for G5/); });
await ok('Attendance: last-30-day percentage counts late as present; lists absences', async () => { const t = await html('Attendance'); assert.match(t, /<b>75%<\/b>/); assert.match(t, /1 absent/); assert.match(t, /absent/i); assert.match(await html('Attendance', ben), /No attendance has been recorded/); });
await ok('Finance: invoiced, paid, balance, invoices and payments', async () => { const t = await html('Finance'); assert.match(t, /KES 10,000/); assert.match(t, /KES 4,000/); assert.match(t, /KES 6,000/); assert.match(t, /QWE1/); });
await ok('Discipline, Transport and Activities show the learner\'s own records', async () => {
  assert.match(await html('Discipline'), /Dress code[\s\S]*Missing tie/); assert.match(await html('Discipline', ben), /No discipline records/);
  assert.match(await html('Transport'), /Route A[\s\S]*Market/); assert.match(await html('Transport', ben), /does not use school transport/);
  const a = await html('Activities'); assert.match(a, /Chess Club/); assert.match(a, /Zone champions/); assert.match(await html('Activities', ben), /not in any club/);
});
await ok('Health: summary with the severe-allergy warning, logged once per visit, and for authorised roles only', async () => {
  const t = await html('Health'); assert.match(t, /Severe allergy: Peanuts/); assert.match(t, /Mum · 0700111222/); await html('Health'); assert.equal(H.recentAccess(amy.id).length, 1);
  for (const role of ['teacher', 'accountant', 'registrar']) { setCurrentRole(role); assert.match(await html('Health'), /does not have access/, role); }
  setCurrentRole('nurse'); assert.match(await html('Health'), /Severe allergy/); setCurrentRole(null);
});
await ok('other roles: finance and discipline are restricted for teachers; the accountant cannot see discipline', async () => {
  setCurrentRole('teacher'); assert.match(await html('Finance'), /does not have access/); assert.match(await html('Attendance'), /75%/); assert.doesNotMatch(await html('Finance'), /QWE1/);
  setCurrentRole('accountant'); assert.match(await html('Finance'), /KES 6,000/); assert.match(await html('Discipline'), /does not have access/); setCurrentRole(null);
});
await ok('nothing from a learner\'s record leaks into another learner\'s tabs', async () => {
  for (const tab of ['Finance', 'Discipline', 'Transport', 'Activities', 'Health', 'Attendance']) { const t = await html(tab, ben); assert.doesNotMatch(t, /QWE1|Missing tie|Route A|Chess Club|Peanuts/, tab); }
});
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
