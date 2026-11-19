// Run: node tests/teacher4.test.mjs — Phase Four teacher rules.
import assert from 'node:assert/strict';
import * as t from '../js/services/teacherLogic.js';
let fail = 0; const ok = (name, fn) => { try { fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', e.message); } };

console.log('Timetable');
ok('dates map to the timetable\'s two-letter day codes (the bug that left "Today" empty)', () => {
  assert.equal(t.dayCodeOf('2026-03-02'), 'MO'); assert.equal(t.dayCodeOf('2026-03-06'), 'FR'); assert.equal(t.dayCodeOf('2026-03-08'), 'SU'); assert.equal(t.dayCodeOf('2026-03-04'), 'WE');
});
const entries = [{ teacherId: 't', day: 'MO', startTime: '10:00', endTime: '11:00', classId: 'c1', subjectId: 's1' }, { teacherId: 't', day: 'MO', startTime: '08:00', endTime: '09:00', classId: 'c2', subjectId: 's1' }, { teacherId: 't', day: 'MO', kind: 'break', startTime: '09:30', endTime: '09:50' }, { teacherId: 'other', day: 'MO', startTime: '08:00', endTime: '09:00' }, { teacherId: 't', day: 'TU', startTime: '08:00', endTime: '09:00', classId: 'c1', subjectId: 's2' }];
ok('today = this teacher\'s lessons only, in time order, breaks excluded', () => assert.deepEqual(t.lessonsOn(entries, 't', '2026-03-02').map((e) => e.startTime), ['08:00', '10:00']));
ok('week grid has Monday–Saturday and only the teacher\'s lessons', () => { const w = t.weekFor(entries, 't'); assert.deepEqual(Object.keys(w), ['MO', 'TU', 'WE', 'TH', 'FR', 'SA']); assert.equal(w.MO.length, 2); assert.equal(w.TU.length, 1); assert.equal(w.WE.length, 0); });

console.log('Deadlines');
ok('overdue work comes first, then by date; far-future items are left out', () => {
  const d = t.buildDeadlines({ today: '2026-03-10', horizonDays: 14,
    homework: [{ id: 'h1', title: 'Fractions', dueDate: '2026-03-12', classId: 'c' }, { id: 'h2', title: 'Old', dueDate: '2026-03-05', classId: 'c' }, { id: 'h3', title: 'Far', dueDate: '2026-06-01', classId: 'c' }],
    homeworkFigs: { h2: { toMark: 3 } },
    assessments: [{ id: 'a1', name: 'CAT 1', date: '2026-03-08', classId: 'c' }, { id: 'a2', name: 'CAT 2', date: '2026-03-15', classId: 'c' }],
    assessmentScores: [{ assessmentId: 'a1', studentId: 's1', score: 10 }], students: [{ id: 's1', classId: 'c' }, { id: 's2', classId: 'c' }],
    lessonPlans: [{ status: 'planned', date: '2026-03-09', topic: 'Past', classId: 'c' }, { status: 'taught', date: '2026-03-09', topic: 'Done', classId: 'c' }, { status: 'planned', date: '2026-03-11', topic: 'Next', classId: 'c' }],
    liveLessons: [{ status: 'scheduled', date: '2026-03-13', title: 'Live', startTime: '09:00', classId: 'c' }, { status: 'cancelled', date: '2026-03-13', title: 'No', startTime: '09:00' }] });
  assert.deepEqual(d.map((x) => x.kind), ['homework-mark', 'marks-missing', 'plan-overdue', 'lesson', 'homework-due', 'live', 'assessment']);
  assert.ok(d.slice(0, 3).every((x) => x.overdue) && d.slice(3).every((x) => !x.overdue)); assert.ok(!d.some((x) => /Far|Done|No$/.test(x.text)));
  assert.equal(d.find((x) => x.kind === 'marks-missing').text, '1 mark(s) still missing: CAT 1');
});

console.log('Learner profile');
ok('profile pulls attendance, homework and assessment progress for ONE learner', () => {
  const stu = { id: 's', classId: 'c' };
  const p = t.learnerProfile({ student: stu, attendance: [{ studentId: 's', status: 'present', date: '2026-03-01' }, { studentId: 's', status: 'absent', date: '2026-03-02' }, { studentId: 'x', status: 'absent', date: '2026-03-02' }, { studentId: 's', status: 'late', date: '2025-01-01' }], from: '2026-01-01',
    homework: [{ id: 'h1', classId: 'c' }, { id: 'h2', classId: 'c' }, { id: 'h3', classId: 'other' }], submissions: [{ homeworkId: 'h1', studentId: 's', status: 'marked' }, { homeworkId: 'h2', studentId: 's', status: 'pending' }],
    assessments: [{ id: 'a1', classId: 'c', maxScore: 50, name: 'A', date: '1' }, { id: 'a2', classId: 'c', maxScore: 50, name: 'B', date: '2' }], scores: [{ assessmentId: 'a1', studentId: 's', score: 25 }, { assessmentId: 'a2', studentId: 's', score: 40 }], examScores: [{ studentId: 's', score: 70 }, { studentId: 's', score: 80 }, { studentId: 'x', score: 10 }, { studentId: 's', score: null }] });
  assert.deepEqual([p.attendance.present, p.attendance.absent, p.attendance.total, p.attendance.rate], [1, 1, 2, 50]);
  assert.deepEqual(p.homework, { assigned: 2, handedIn: 1, rate: 50 }); assert.equal(p.progress.average, 65); assert.equal(p.progress.trend, 'improving'); assert.deepEqual([p.examAverage, p.examSubjects], [75, 2]);
});

console.log('Class teacher and report-card preparation');
ok('class teacher is a flag on an allocation, for that class only', () => {
  const a = [{ teacherId: 't', classId: 'c1', classTeacher: true }, { teacherId: 't', classId: 'c2' }, { teacherId: 'u', classId: 'c2', classTeacher: true }];
  assert.equal(t.isClassTeacher(a, 't', 'c1'), true); assert.equal(t.isClassTeacher(a, 't', 'c2'), false);
});
ok('comments are limited to 300 characters; blank is allowed (clears it)', () => { assert.equal(t.validateComment(''), null); assert.equal(t.validateComment('x'.repeat(300)), null); assert.match(t.validateComment('x'.repeat(301)), /300/); });
const subjects = [{ id: 'math', name: 'Maths', classIds: ['c1'] }, { id: 'eng', name: 'English', classIds: ['c1'] }, { id: 'sci', name: 'Science', classIds: ['c2'] }];
ok('a teacher may comment only on subjects they teach in that class', () => {
  const scope = t.resolveScope({ role: 'teacher', email: 'a@b.c', teachers: [{ id: 't', email: 'a@b.c' }], assignments: [{ teacherId: 't', classId: 'c1', subjectId: 'math' }], timetable: [] });
  assert.deepEqual(t.commentableSubjects(scope, 'c1', subjects).map((s) => s.id), ['math']);
  assert.deepEqual(t.commentableSubjects({ unrestricted: true }, 'c1', subjects).map((s) => s.id), ['math', 'eng']);
});
ok('readiness: marks in, comments written vs marked ready, per learner; withdrawn learners excluded', () => {
  const students = [{ id: 'a', classId: 'c1' }, { id: 'b', classId: 'c1' }, { id: 'w', classId: 'c1', status: 'withdrawn' }, { id: 'z', classId: 'c2' }];
  const examScores = [{ examinationId: 'e', subjectId: 'math', studentId: 'a', score: 50 }, { examinationId: 'e', subjectId: 'eng', studentId: 'a', score: 60 }, { examinationId: 'e', subjectId: 'math', studentId: 'b', score: 70 }, { examinationId: 'e', subjectId: 'eng', studentId: 'b', score: null }];
  const comments = [{ examinationId: 'e', studentId: 'a', subjectId: 'math', text: 'Good', status: 'ready' }, { examinationId: 'e', studentId: 'a', subjectId: 'eng', text: 'Fine', status: 'ready' }, { examinationId: 'e', studentId: 'b', subjectId: 'math', text: 'Draft', status: 'draft' }];
  const r = t.reportReadiness({ students, subjects: subjects.slice(0, 2), examScores, examinationId: 'e', comments, classTeacherComments: { a: { text: 'Well done' } }, classId: 'c1' });
  assert.deepEqual(r.map((x) => [x.student.id, x.marksIn, x.commentsWritten, x.commentsReady, x.classComment, x.complete]), [['a', 2, 2, 2, true, true], ['b', 1, 1, 0, false, false]]);
});
ok('only comments marked READY reach the report card; drafts and blanks stay private', () => {
  const by = { math: { name: 'Maths' }, eng: { name: 'English' } };
  const r = t.readyCommentsFor([{ examinationId: 'e', studentId: 'a', subjectId: 'math', text: ' Great ', status: 'ready', authorName: 'Tina' }, { examinationId: 'e', studentId: 'a', subjectId: 'eng', text: 'Draft', status: 'draft' }, { examinationId: 'e', studentId: 'a', subjectId: 'eng', text: ' ', status: 'ready' }, { examinationId: 'other', studentId: 'a', subjectId: 'math', text: 'x', status: 'ready' }], 'e', 'a', by);
  assert.deepEqual(r, [{ subject: 'Maths', text: 'Great', by: 'Tina' }]);
});

console.log('Curriculum planning frameworks');
ok('frameworks are configurable data: validated, per curriculum, and presets are only templates', () => {
  assert.equal(t.validateFramework(t.FRAMEWORK_PRESETS.competency.fields), null); assert.equal(t.validateFramework([]), null);
  assert.match(t.validateFramework([{ key: 'Bad Key', label: 'x' }]), /not a valid/); assert.match(t.validateFramework([{ key: 'a1', label: 'x' }, { key: 'a1', label: 'y' }]), /twice/); assert.match(t.validateFramework([{ key: 'a1', label: ' ' }]), /label/);
  assert.match(t.validateFramework(Array.from({ length: 13 }, (_, i) => ({ key: `f${i}x`, label: 'x' }))), /at most 12/);
  assert.deepEqual(t.frameworkFor('cur1', [{ curriculumId: 'cur1', fields: [{ key: 'a1', label: 'A' }] }]), [{ key: 'a1', label: 'A' }]); assert.deepEqual(t.frameworkFor('none', []), []);
});
ok('only fields the framework defines are kept, trimmed; blanks dropped', () => assert.deepEqual(t.cleanExtra({ strand: ' Numbers ', junk: 'x', outcomes: '  ' }, [{ key: 'strand' }, { key: 'outcomes' }]), { strand: 'Numbers' }));
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
