// Run: node tests/teacher.test.mjs
import assert from 'node:assert/strict';
import * as t from '../js/services/teacherLogic.js';
let fail = 0; const ok = (name, fn) => { try { fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', e.message); } };
const teachers = [{ id: 't1', email: 'Jane@School.co' }, { id: 't2', email: 'bob@school.co' }];
const assignments = [{ teacherId: 't1', classId: 'c1', subjectId: 'math' }];
const timetable = [{ teacherId: 't1', classId: 'c2', subjectId: 'eng' }, { teacherId: 't2', classId: 'c3', subjectId: 'sci' }];

console.log('Who sees which class');
ok('teacher sees explicit allocations plus timetable classes — and nothing else', () => {
  const s = t.resolveScope({ role: 'teacher', email: 'jane@school.co', teachers, assignments, timetable });
  assert.deepEqual([...s.classIds].sort(), ['c1', 'c2']); assert.equal(s.unrestricted, false);
  assert.equal(t.classAllowed(s, 'c3'), false); assert.equal(t.pairAllowed(s, 'c1', 'math'), true); assert.equal(t.pairAllowed(s, 'c1', 'eng'), false);
});
ok('a teacher whose email matches no staff record sees no classes (not everything)', () => {
  const s = t.resolveScope({ role: 'teacher', email: 'x@y.z', teachers, assignments, timetable });
  assert.equal(s.linked, false); assert.equal(t.classAllowed(s, 'c1'), false); assert.equal(t.studentsInScope(s, [{ id: 's', classId: 'c1' }]).length, 0);
});
ok('administrators / principal / no-role are unrestricted', () => {
  ['school_admin', null, 'accountant'].forEach((role) => assert.equal(t.resolveScope({ role, email: '', teachers }).unrestricted, true));
});

console.log('Lesson plans & schemes');
ok('lesson plan needs class, subject, date, topic and objectives', () => {
  assert.match(t.validateLessonPlan({}), /class/); assert.match(t.validateLessonPlan({ classId: 'c', subjectId: 's', date: 'd', topic: 'x' }), /objective/);
  assert.equal(t.validateLessonPlan({ classId: 'c', subjectId: 's', date: '2026-01-01', topic: 'Fractions', objectives: 'Add fractions' }), null);
});
ok('scheme progress counts completed weeks', () => assert.deepEqual(t.schemeProgress([{ status: 'done' }, { status: 'done' }, { status: 'planned' }, {}]), { total: 4, done: 2, pct: 50 }));

console.log('Homework');
const hw = { id: 'h', classId: 'c1', dueDate: '2026-03-10', maxMarks: 20 };
const studs = [{ id: 'a', classId: 'c1' }, { id: 'b', classId: 'c1' }, { id: 'c', classId: 'c1' }, { id: 'd', classId: 'c1' }, { id: 'x', classId: 'c9' }, { id: 'w', classId: 'c1', status: 'withdrawn' }];
ok('figures: students with no submission are pending before the due date, missing after', () => {
  const subs = [{ homeworkId: 'h', studentId: 'a', status: 'submitted' }, { homeworkId: 'h', studentId: 'b', status: 'marked' }, { homeworkId: 'h', studentId: 'c', status: 'late' }];
  const before = t.homeworkFigures(hw, studs, subs, '2026-03-09'); const after = t.homeworkFigures(hw, studs, subs, '2026-03-11');
  assert.equal(before.total, 4); assert.deepEqual([before.pending, before.missing, before.toMark, before.marked], [1, 0, 2, 1]); assert.equal(after.missing, 1);
});
ok('marks are bounded by the maximum; late hand-in is labelled late', () => {
  assert.match(t.validateMark({ marks: 25 }, hw), /more than 20/); assert.equal(t.validateMark({ marks: 20 }, hw), null); assert.match(t.validateMark({ marks: -1 }, hw), /from 0/);
  assert.equal(t.submissionState(hw, '2026-03-11'), 'late'); assert.equal(t.submissionState(hw, '2026-03-10'), 'submitted');
});
ok('homework needs class, subject, title and due date', () => { assert.ok(t.validateHomework({ classId: 'c' })); assert.equal(t.validateHomework({ classId: 'c', subjectId: 's', title: 'T', dueDate: '2026-01-01' }), null); });

console.log('Welfare');
ok('only administrators and explicitly granted staff can open welfare records', () => {
  assert.equal(t.canViewWelfare({ role: 'teacher', accountId: 'u1', grants: [] }), false);
  assert.equal(t.canViewWelfare({ role: 'teacher', accountId: 'u1', grants: [{ accountId: 'u1' }] }), true);
  assert.equal(t.canViewWelfare({ role: 'accountant', accountId: 'u9', grants: [] }), false);
  assert.equal(t.canViewWelfare({ role: 'school_admin', accountId: 'u', grants: [] }), true);
});

console.log('Attendance notices');
ok('queues one notice per absent/late student per day; flags missing contacts; never says sent', () => {
  const students = [{ id: 's1', firstName: 'Amy', lastName: 'K', parentIds: ['p1'] }, { id: 's2', firstName: 'Ben', lastName: 'K', parentIds: [] }, { id: 's3', firstName: 'Cy', lastName: 'K', parentIds: ['p1'] }];
  const parents = [{ id: 'p1', firstName: 'Ann', lastName: 'K', phone: '0700' }];
  const records = [{ studentId: 's1', status: 'absent', date: 'D', classId: 'c' }, { studentId: 's2', status: 'late', date: 'D', classId: 'c' }, { studentId: 's3', status: 'present', date: 'D', classId: 'c' }];
  const tpl = 'Dear {parent}, {student} was {status} on {date}.';
  const made = t.absenceNotices({ records, students, parents, existing: [], date: 'D', template: tpl });
  assert.equal(made.length, 2); assert.equal(made[0].message, 'Dear Ann K, Amy K was absent on D.'); assert.equal(made[1].noContact, true);
  assert.ok(made.every((m) => m.queuedStatus === 'queued'));
  assert.equal(t.absenceNotices({ records, students, parents, existing: [{ studentId: 's1', date: 'D' }], date: 'D', template: tpl }).length, 1);
  assert.deepEqual(t.attendanceSummary(records), { present: 1, absent: 1, late: 1, excused: 0, total: 3, rate: 67 });
});

console.log('Assessments & progress');
ok('class results average and missing scores; progress trend', () => {
  const a = { id: 'a1', classId: 'c1', maxScore: 50, name: 'CAT1', date: '2026-01-10' };
  const r = t.assessmentResults(a, [{ assessmentId: 'a1', studentId: 'a', score: 40 }, { assessmentId: 'a1', studentId: 'b', score: 20 }], studs.filter((s) => s.classId === 'c1'));
  assert.equal(r.average, 60); assert.equal(r.missing, 3); assert.equal(r.rows[0].pct, 80);
  const as = [{ id: '1', maxScore: 100, name: 'A', date: '1' }, { id: '2', maxScore: 100, name: 'B', date: '2' }, { id: '3', maxScore: 100, name: 'C', date: '3' }, { id: '4', maxScore: 100, name: 'D', date: '4' }];
  const sc = [50, 55, 70, 80].map((v, i) => ({ assessmentId: String(i + 1), studentId: 'a', score: v }));
  assert.deepEqual([t.studentProgress('a', as, sc).average, t.studentProgress('a', as, sc).trend], [63.8, 'improving']);
  assert.equal(t.studentProgress('zz', as, sc).trend, 'not enough results');
});
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
