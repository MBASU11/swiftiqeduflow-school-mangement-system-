// Pure Teacher Pack rules: who may see which class, lesson/scheme/homework figures,
// welfare permission, absence notices and assessment progress. No storage, no DOM.
const n = (v) => Number(v) || 0;
export const sameEmail = (a, b) => Boolean(a) && Boolean(b) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// ---------------------------------------------------------------- scope
// A teacher is linked to a staff record by email. Their classes come from explicit allocations
// plus the timetable. Everyone except the "teacher" role is unrestricted here (their own module
// permissions still apply elsewhere).
export function resolveScope({ role, email, teachers = [], assignments = [], timetable = [] }) {
  if (role && role !== 'teacher') return { unrestricted: true, linked: true, classIds: new Set(), pairs: [], teacherId: null };
  if (!role) return { unrestricted: true, linked: true, classIds: new Set(), pairs: [], teacherId: null };
  const me = teachers.find((t) => sameEmail(t.email, email));
  if (!me) return { unrestricted: false, linked: false, classIds: new Set(), pairs: [], teacherId: null };
  const pairs = new Map();
  assignments.filter((a) => a.teacherId === me.id).forEach((a) => pairs.set(`${a.classId}|${a.subjectId ?? ''}`, { classId: a.classId, subjectId: a.subjectId ?? '' }));
  timetable.filter((e) => e.teacherId === me.id && e.classId && e.subjectId).forEach((e) => pairs.set(`${e.classId}|${e.subjectId}`, { classId: e.classId, subjectId: e.subjectId }));
  const list = [...pairs.values()];
  return { unrestricted: false, linked: true, teacherId: me.id, pairs: list, classIds: new Set(list.map((p) => p.classId)) };
}
export const classAllowed = (scope, classId) => scope.unrestricted || scope.classIds.has(classId);
export const pairAllowed = (scope, classId, subjectId) => scope.unrestricted || scope.pairs.some((p) => p.classId === classId && (!p.subjectId || !subjectId || p.subjectId === subjectId));
export const studentsInScope = (scope, students) => (scope.unrestricted ? students : students.filter((s) => scope.classIds.has(s.classId)));

// ---------------------------------------------------------------- lesson plans & schemes of work
export const LESSON_STATUS = { planned: 'Planned', taught: 'Taught', postponed: 'Postponed' };
export function validateLessonPlan(p) {
  if (!p.classId) return 'Choose a class.';
  if (!p.subjectId) return 'Choose a subject.';
  if (!p.date) return 'Choose the lesson date.';
  if (!String(p.topic ?? '').trim()) return 'Enter the topic.';
  if (!String(p.objectives ?? '').trim()) return 'Enter at least one learning objective.';
  return null;
}
export function schemeProgress(weeks = []) {
  const total = weeks.length; const done = weeks.filter((w) => w.status === 'done').length;
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}
export const planningSummary = (plans) => ({ planned: plans.filter((p) => p.status === 'planned').length, taught: plans.filter((p) => p.status === 'taught').length, postponed: plans.filter((p) => p.status === 'postponed').length });

// ---------------------------------------------------------------- homework
export function validateHomework(h) {
  if (!h.classId || !h.subjectId) return 'Choose a class and subject.';
  if (!String(h.title ?? '').trim()) return 'Enter a title.';
  if (!h.dueDate) return 'Choose a due date.';
  if (h.maxMarks != null && h.maxMarks !== '' && !(n(h.maxMarks) > 0)) return 'Maximum marks must be more than zero.';
  return null;
}
// One row per student in the class; students with no submission record count as "not submitted".
export function homeworkFigures(hw, students, submissions, today) {
  const roster = students.filter((s) => s.classId === hw.classId && (s.status ?? 'active') === 'active');
  const subs = new Map(submissions.filter((x) => x.homeworkId === hw.id).map((x) => [x.studentId, x]));
  const rows = roster.map((s) => { const x = subs.get(s.id); return { student: s, submission: x, state: !x || x.status === 'pending' ? (today > hw.dueDate ? 'missing' : 'pending') : x.status }; });
  const count = (st) => rows.filter((r) => r.state === st).length;
  return { rows, total: roster.length, submitted: count('submitted') + count('late'), late: count('late'), marked: count('marked'), missing: count('missing'), pending: count('pending'), toMark: count('submitted') + count('late') };
}
export function validateMark(sub, hw) {
  if (sub.marks === '' || sub.marks == null) return null;
  const m = Number(sub.marks);
  if (Number.isNaN(m) || m < 0) return 'Marks must be a number from 0.';
  if (hw.maxMarks && m > Number(hw.maxMarks)) return `Marks cannot be more than ${hw.maxMarks}.`;
  return null;
}
// A submission handed in after the due date is "late", never silently "submitted".
export const submissionState = (hw, submittedOn) => (submittedOn > hw.dueDate ? 'late' : 'submitted');

// ---------------------------------------------------------------- welfare
export const WELFARE_CATEGORIES = ['academic', 'behaviour', 'attendance', 'health', 'home circumstances', 'other'];
export const canViewWelfare = ({ role, accountId, grants = [] }) => !role || role === 'school_admin' || grants.some((g) => g.accountId === accountId || g.userId === accountId);
export function validateWelfare(w) {
  if (!w.studentId) return 'Choose a student.';
  if (!String(w.observation ?? '').trim()) return 'Write the observation.';
  return null;
}

// ---------------------------------------------------------------- attendance notices
// Notices are queued, never "sent": no provider confirms delivery. One notice per student per day.
export function absenceNotices({ records, students, parents, existing, date, template, school = '' }) {
  const stById = Object.fromEntries(students.map((s) => [s.id, s])); const pById = Object.fromEntries(parents.map((p) => [p.id, p]));
  return records.filter((r) => r.date === date && ['absent', 'late'].includes(r.status)).flatMap((r) => {
    if (existing.some((e) => e.studentId === r.studentId && e.date === date)) return [];
    const s = stById[r.studentId]; if (!s) return [];
    const parent = pById[(s.parentIds ?? [])[0]];
    const parentName = parent ? `${parent.firstName ?? ''} ${parent.lastName ?? ''}`.trim() : 'Parent/Guardian';
    const message = String(template).replace(/\{(\w+)\}/g, (_, k) => ({ parent: parentName, student: `${s.firstName} ${s.lastName}`, status: r.status === 'late' ? 'late' : 'absent', date, school }[k] ?? `{${k}}`));
    return [{ studentId: s.id, classId: r.classId, date, status: r.status, message, phone: parent?.phone ?? '', email: parent?.email ?? '', queuedStatus: 'queued', noContact: !parent?.phone && !parent?.email }];
  });
}
export function attendanceSummary(records) {
  const c = { present: 0, absent: 0, late: 0, excused: 0 }; records.forEach((r) => { if (r.status in c) c[r.status] += 1; });
  const total = records.length; return { ...c, total, rate: total ? Math.round(((c.present + c.late) / total) * 100) : null };
}

// ---------------------------------------------------------------- assessments & progress
export function assessmentResults(assessment, scores, students) {
  const sc = new Map(scores.filter((s) => s.assessmentId === assessment.id).map((s) => [s.studentId, s.score]));
  const rows = students.filter((s) => s.classId === assessment.classId).map((s) => ({ student: s, score: sc.has(s.id) ? Number(sc.get(s.id)) : null }));
  const entered = rows.filter((r) => r.score != null);
  const max = n(assessment.maxScore) || 100;
  return { rows: rows.map((r) => ({ ...r, pct: r.score == null ? null : Math.round((r.score / max) * 1000) / 10 })), entered: entered.length, missing: rows.length - entered.length, average: entered.length ? Math.round((entered.reduce((t, r) => t + r.score, 0) / entered.length / max) * 1000) / 10 : null };
}
export function studentProgress(studentId, assessments, scores) {
  const pts = assessments.map((a) => { const s = scores.find((x) => x.assessmentId === a.id && x.studentId === studentId); return s ? { name: a.name, date: a.date ?? '', pct: Math.round((Number(s.score) / (n(a.maxScore) || 100)) * 1000) / 10 } : null; }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  const avg = pts.length ? Math.round((pts.reduce((t, p) => t + p.pct, 0) / pts.length) * 10) / 10 : null;
  let trend = 'not enough results';
  if (pts.length >= 2) { const h = Math.floor(pts.length / 2); const first = pts.slice(0, h).reduce((t, p) => t + p.pct, 0) / h; const last = pts.slice(h).reduce((t, p) => t + p.pct, 0) / (pts.length - h); trend = last - first > 3 ? 'improving' : first - last > 3 ? 'declining' : 'steady'; }
  return { points: pts, average: avg, trend };
}

// ================================================================ Phase Four

// ---------------------------------------------------------------- timetable
// The timetable stores days as two-letter codes (MO TU WE TH FR SA). JS dates give 0=Sunday.
export const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
export const dayCodeOf = (iso) => DAY_CODES[new Date(`${iso}T12:00:00Z`).getUTCDay()];
const byStart = (a, b) => String(a.startTime).localeCompare(String(b.startTime));
export const lessonsOn = (entries, teacherId, iso) => entries.filter((e) => e.teacherId === teacherId && e.day === dayCodeOf(iso) && e.kind !== 'break').sort(byStart);
export function weekFor(entries, teacherId) {
  const week = {}; ['MO', 'TU', 'WE', 'TH', 'FR', 'SA'].forEach((d) => { week[d] = entries.filter((e) => e.teacherId === teacherId && e.day === d && e.kind !== 'break').sort(byStart); });
  return week;
}

// ---------------------------------------------------------------- deadlines
// One list of everything a teacher must do soon, soonest first. Nothing is invented: every item comes from a record.
export function buildDeadlines({ today, horizonDays = 14, homework = [], homeworkFigs = {}, assessments = [], assessmentScores = [], students = [], lessonPlans = [], liveLessons = [] }) {
  const end = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + horizonDays); return d.toISOString().slice(0, 10); })();
  const out = [];
  homework.forEach((h) => {
    const f = homeworkFigs[h.id];
    if (h.dueDate >= today && h.dueDate <= end) out.push({ date: h.dueDate, kind: 'homework-due', text: `Homework due: ${h.title}`, classId: h.classId });
    if (f?.toMark > 0 && h.dueDate <= today) out.push({ date: h.dueDate, kind: 'homework-mark', text: `${f.toMark} submission(s) to mark: ${h.title}`, classId: h.classId, overdue: true });
  });
  assessments.forEach((a) => {
    const roster = students.filter((s) => s.classId === a.classId && (s.status ?? 'active') === 'active');
    const entered = new Set(assessmentScores.filter((x) => x.assessmentId === a.id && x.score != null).map((x) => x.studentId));
    const missing = roster.filter((s) => !entered.has(s.id)).length;
    if (a.date && a.date >= today && a.date <= end) out.push({ date: a.date, kind: 'assessment', text: `Assessment: ${a.name}`, classId: a.classId });
    if (a.date && a.date < today && missing > 0 && roster.length) out.push({ date: a.date, kind: 'marks-missing', text: `${missing} mark(s) still missing: ${a.name}`, classId: a.classId, overdue: true });
  });
  lessonPlans.forEach((p) => { if (p.status === 'planned' && p.date < today) out.push({ date: p.date, kind: 'plan-overdue', text: `Lesson not marked taught: ${p.topic}`, classId: p.classId, overdue: true }); else if (p.status === 'planned' && p.date <= end) out.push({ date: p.date, kind: 'lesson', text: `Lesson: ${p.topic}`, classId: p.classId }); });
  liveLessons.forEach((l) => { if (l.status === 'scheduled' && l.date >= today && l.date <= end) out.push({ date: l.date, kind: 'live', text: `Live lesson: ${l.title} (${l.startTime})`, classId: l.classId }); });
  return out.sort((a, b) => Number(Boolean(b.overdue)) - Number(Boolean(a.overdue)) || a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- learner profile (only what a teacher is authorised to see)
export function learnerProfile({ student, attendance = [], homework = [], submissions = [], assessments = [], scores = [], examScores = [], from = '', to = '9999-12-31' }) {
  const att = attendanceSummary(attendance.filter((r) => r.studentId === student.id && r.date >= from && r.date <= to));
  const myHw = homework.filter((h) => h.classId === student.classId);
  const sub = (h) => submissions.find((x) => x.homeworkId === h.id && x.studentId === student.id);
  const done = myHw.filter((h) => ['submitted', 'late', 'marked'].includes(sub(h)?.status)).length;
  const classAssessments = assessments.filter((a) => a.classId === student.classId);
  const progress = studentProgress(student.id, classAssessments, scores);
  const exam = examScores.filter((x) => x.studentId === student.id && x.score != null);
  return { attendance: att, homework: { assigned: myHw.length, handedIn: done, rate: myHw.length ? Math.round((done / myHw.length) * 100) : null }, progress, examAverage: exam.length ? Math.round((exam.reduce((t, x) => t + Number(x.score), 0) / exam.length) * 10) / 10 : null, examSubjects: exam.length };
}

// ---------------------------------------------------------------- class teacher
export const isClassTeacher = (assignments, teacherId, classId) => assignments.some((a) => a.teacherId === teacherId && a.classId === classId && a.classTeacher === true);

// ---------------------------------------------------------------- report-card preparation
export const COMMENT_MAX = 300;
export function validateComment(text) {
  const t = String(text ?? '').trim();
  if (t.length > COMMENT_MAX) return `Keep comments to ${COMMENT_MAX} characters (this one is ${t.length}).`;
  return null;
}
// Which subjects may this teacher comment on for this class? Their own subjects; the class teacher sees every subject's marks but comments only on their own.
export const commentableSubjects = (scope, classId, subjects) => subjects.filter((s) => pairAllowed(scope, classId, s.id) && (s.classIds ?? []).includes(classId));
// Per learner: are the marks in, are the comments written, is it marked ready?
export function reportReadiness({ students, subjects, examScores, examinationId, comments, classTeacherComments = {}, classId }) {
  const roster = students.filter((s) => s.classId === classId && (s.status ?? 'active') === 'active');
  return roster.map((s) => {
    const marks = subjects.filter((sub) => examScores.some((x) => x.examinationId === examinationId && x.subjectId === sub.id && x.studentId === s.id && x.score != null)).length;
    const mine = subjects.map((sub) => comments.find((c) => c.examinationId === examinationId && c.studentId === s.id && c.subjectId === sub.id));
    const written = mine.filter((c) => c && String(c.text ?? '').trim()).length; const ready = mine.filter((c) => c?.status === 'ready' && String(c.text ?? '').trim()).length;
    const cls = classTeacherComments[s.id];
    return { student: s, marksIn: marks, marksNeeded: subjects.length, commentsWritten: written, commentsReady: ready, commentsNeeded: subjects.length, classComment: Boolean(cls?.text?.trim()), complete: marks === subjects.length && ready === subjects.length };
  });
}
// Only comments the teacher marked ready reach the report card; drafts stay private.
export const readyCommentsFor = (comments, examinationId, studentId, subjectById) => comments
  .filter((c) => c.examinationId === examinationId && c.studentId === studentId && c.status === 'ready' && String(c.text ?? '').trim())
  .map((c) => ({ subject: subjectById[c.subjectId]?.name ?? '', text: c.text.trim(), by: c.authorName ?? '' }))
  .sort((a, b) => a.subject.localeCompare(b.subject));

// ---------------------------------------------------------------- curriculum planning frameworks (configurable, never hard-coded)
// Presets are only STARTING POINTS an administrator can copy and edit; nothing in the app depends on their names.
export const FRAMEWORK_PRESETS = {
  generic: { label: 'Generic', fields: [{ key: 'resources', label: 'Teaching resources', multiline: true }, { key: 'assessment', label: 'How learning is assessed', multiline: true }] },
  competency: { label: 'Competency-based (e.g. CBC/CBE)', fields: [{ key: 'strand', label: 'Strand' }, { key: 'substrand', label: 'Sub-strand' }, { key: 'outcomes', label: 'Specific learning outcomes', multiline: true }, { key: 'competencies', label: 'Core competencies', multiline: true }, { key: 'values', label: 'Values' }, { key: 'inquiry', label: 'Key inquiry questions', multiline: true }, { key: 'assessment', label: 'Assessment', multiline: true }] },
  syllabus: { label: 'Syllabus-based (e.g. Cambridge, 8-4-4)', fields: [{ key: 'syllabus_ref', label: 'Syllabus reference / code' }, { key: 'objectives_ref', label: 'Learning objective codes' }, { key: 'differentiation', label: 'Differentiation', multiline: true }, { key: 'assessment', label: 'Assessment for learning', multiline: true }] },
};
export function validateFramework(fields) {
  if (!Array.isArray(fields)) return 'Fields must be a list.';
  const keys = new Set();
  for (const f of fields) {
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(f.key ?? '')) return `"${f.key ?? ''}" is not a valid field key (lowercase letters, numbers, underscore).`;
    if (keys.has(f.key)) return `The field "${f.key}" appears twice.`;
    keys.add(f.key);
    if (!String(f.label ?? '').trim()) return `Field "${f.key}" needs a label.`;
  }
  return fields.length > 12 ? 'Use at most 12 extra fields.' : null;
}
export const frameworkFor = (curriculumId, frameworks) => frameworks.find((f) => f.curriculumId === curriculumId)?.fields ?? [];
// Keep only values for fields the framework defines, trimmed.
export const cleanExtra = (extra, fields) => Object.fromEntries(fields.filter((f) => String(extra?.[f.key] ?? '').trim()).map((f) => [f.key, String(extra[f.key]).trim()]));
