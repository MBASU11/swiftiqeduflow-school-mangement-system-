// Teacher Pack storage + workflows for browser-local and Supabase modes alike.
// Rules live in teacherLogic.js. Who may see what is decided by the teacher's class scope
// (email-linked staff record + allocations + timetable) and, for welfare, an explicit grant.
import { LocalStorageRepository } from '../storage/Repository.js';
import { SupabaseRepository } from '../storage/SupabaseRepository.js';
import { isSupabaseConfigured } from '../config/supabase.js';
import { currentAccount, listTeam } from './authService.js';
import { getCurrentRole, setCollectionOverride } from './accessService.js';
import { StorageManager } from '../storage/StorageManager.js';
import * as T from './teacherLogic.js';
import { setClassScope } from './classScope.js';
import { moduleEnabled } from './subscriptionService.js';

const remote = () => isSupabaseConfigured();
const cache = {};
const R = (c) => (cache[c] ??= remote() ? new SupabaseRepository(c) : new LocalStorageRepository(c, c));
const all = async (c) => { try { return (await R(c).getAll()) ?? []; } catch { return []; } };
const today = () => new Date().toISOString().slice(0, 10);
export const allRecords = all; // read any collection through the same local/cloud switch
export const currentPerson = () => me();

// ---------------------------------------------------------------- who am I
let identity = null; // cloud mode: { id, email }
let grantCache = [];
export const currentUserId = () => me()?.id;
export const setTeacherIdentity = (i) => { identity = i; };
const me = () => (remote() ? identity : (() => { const a = currentAccount(); return a ? { id: a.id, email: a.email } : null; })());

// Welfare notes: administrators, or a person the administrator has named. Everyone else gets nothing,
// whatever their role. (The database applies the same rule; this keeps the screens honest.)
setCollectionOverride((collection) => {
  if (collection !== 'welfareNotes' && collection !== 'welfareGrants') return undefined;
  const role = getCurrentRole(); const who = me();
  const grants = remote() ? grantCache : StorageManager.all('welfareGrants');
  if (T.canViewWelfare({ role, accountId: who?.id, grants })) return role === 'teacher' && collection === 'welfareGrants' ? 'read' : 'write';
  return collection === 'welfareGrants' && role === 'teacher' ? 'read' : 'none';
});
export const hasWelfareAccess = () => { const who = me(); return T.canViewWelfare({ role: getCurrentRole(), accountId: who?.id, grants: remote() ? grantCache : StorageManager.all('welfareGrants') }); };

// Called by the router before each page: limits class pickers/lists to a teacher's own classes.
export async function refreshClassScope() {
  if (getCurrentRole() !== 'teacher' || !moduleEnabled('teacher_pack')) { setClassScope(null); return; }
  const [teachers, assignments, timetable] = await Promise.all([all('teachers'), all('teachingAssignments'), all('timetableEntries')]);
  const scope = T.resolveScope({ role: 'teacher', email: me()?.email, teachers, assignments, timetable });
  setClassScope(scope.unrestricted ? null : scope.classIds);
}

// For screens that must ALWAYS limit a teacher to their own classes, whatever package the school has.
// Returns { scope, classes } where classes is the subset the person may use (everything for administrators).
export async function myClasses(allClasses) {
  const [teachers, assignments, timetable] = await Promise.all([all('teachers'), all('teachingAssignments'), all('timetableEntries')]);
  const scope = T.resolveScope({ role: getCurrentRole(), email: me()?.email, teachers, assignments, timetable });
  return { scope, classes: allClasses.filter((c) => T.classAllowed(scope, c.id)) };
}

export async function loadTeacher() {
  const names = ['students', 'classes', 'streams', 'subjects', 'terms', 'teachers', 'parents', 'timetableEntries', 'teachingAssignments', 'lessonPlans', 'schemesOfWork', 'homework', 'homeworkSubmissions', 'learningMaterials', 'liveLessons', 'attendance', 'attendanceNotices', 'assessments', 'assessmentScores', 'school', 'reportComments', 'planningFrameworks', 'announcements', 'examinations', 'examScores', 'reportCards', 'curricula', 'parents', 'learningOutcomes'];
  const rows = await Promise.all(names.map((c) => all(c)));
  const d = Object.fromEntries(names.map((c, i) => [c, rows[i]]));
  d.school = d.school[0] ?? {};
  grantCache = await all('welfareGrants');
  d.scope = T.resolveScope({ role: getCurrentRole(), email: me()?.email, teachers: d.teachers, assignments: d.teachingAssignments, timetable: d.timetableEntries });
  const ok = (c) => T.classAllowed(d.scope, c);
  d.myClasses = d.classes.filter((c) => ok(c.id));
  d.myStudents = T.studentsInScope(d.scope, d.students.filter((s) => (s.status ?? 'active') === 'active'));
  d.studentById = Object.fromEntries(d.students.map((s) => [s.id, s]));
  d.classById = Object.fromEntries(d.classes.map((c) => [c.id, c]));
  d.subjectById = Object.fromEntries(d.subjects.map((s) => [s.id, s]));
  d.termById = Object.fromEntries(d.terms.map((t) => [t.id, t]));
  d.currentTerm = d.terms.find((t) => t.isCurrent);
  d.curriculumById = Object.fromEntries(d.curricula.map((c) => [c.id, c]));
  // The class teacher flag lives on an allocation; administrators may act as class teacher for any class.
  d.isClassTeacherFor = (classId) => d.scope.unrestricted || T.isClassTeacher(d.teachingAssignments, d.scope.teacherId, classId);
  d.frameworkFor = (classId) => T.frameworkFor(d.classById[classId]?.curriculumId, d.planningFrameworks);
  // Subjects a teacher may choose for a class: their allocations for it (all subjects if they teach the whole class).
  d.subjectsFor = (classId) => d.subjects.filter((s) => T.pairAllowed(d.scope, classId, s.id) && (s.classIds ?? []).includes(classId));
  // Everything shown to a teacher is limited to their own classes; admins see all.
  d.mine = (list) => list.filter((x) => ok(x.classId));
  return d;
}

// ---------------------------------------------------------------- generic saves
const stamp = (d) => ({ ...d, ownerId: d.ownerId ?? me()?.id });
export async function saveRecord(collection, data, label) {
  if (data.classId && !T.pairAllowed((await loadTeacher()).scope, data.classId, data.subjectId)) throw new Error('You can only do this for classes and subjects you are assigned to.');
  return data.id ? R(collection).update(data.id, data, label) : R(collection).create(stamp(data), label);
}
export const removeRecord = (collection, id) => R(collection).remove(id);

export async function saveLessonPlan(p) {
  const e = T.validateLessonPlan(p); if (e) throw new Error(e);
  const fields = T.frameworkFor((await all('classes')).find((c) => c.id === p.classId)?.curriculumId, await all('planningFrameworks'));
  return saveRecord('lessonPlans', { status: 'planned', ...p, extra: T.cleanExtra(p.extra, fields) }, 'saved lesson plan');
}
export async function saveHomework(h) {
  const e = T.validateHomework(h); if (e) throw new Error(e);
  const scope = (await loadTeacher()).scope;
  if (h.id) {
    const existing = await R('homework').getById(h.id);
    if (!existing) throw new Error('That homework assignment no longer exists.');
    if (!T.pairAllowed(scope, existing.classId, existing.subjectId)) throw new Error('You can only do this for classes and subjects you are assigned to.');
    const submissions = await R('homeworkSubmissions').getAll();
    const linked = submissions.filter((submission) => submission.homeworkId === h.id);
    if (linked.length && (h.classId !== existing.classId || h.subjectId !== existing.subjectId)) throw new Error('Class or subject cannot be changed while submissions are linked. The original submissions have been kept.');
    const maxMarks = h.maxMarks === '' || h.maxMarks == null ? null : Number(h.maxMarks);
    const overMax = linked.find((submission) => submission.marks != null && maxMarks != null && Number(submission.marks) > maxMarks);
    if (overMax) throw new Error(`Maximum marks cannot be reduced below a saved mark (${overMax.marks}). Correct the saved mark first.`);
  }
  if (!T.pairAllowed(scope, h.classId, h.subjectId)) throw new Error('You can only do this for classes and subjects you are assigned to.');
  return saveRecord('homework', { status: 'published', ...h, maxMarks: h.maxMarks ? Number(h.maxMarks) : undefined }, 'saved homework');
}
export async function deleteHomework(id) {
  const d = await loadTeacher();
  const homework = await R('homework').getById(id);
  if (!homework) throw new Error('That homework assignment no longer exists.');
  if (!T.pairAllowed(d.scope, homework.classId, homework.subjectId)) throw new Error('You can only delete homework for classes and subjects you are assigned to.');
  const submissions = await R('homeworkSubmissions').getAll();
  const linked = submissions.filter((submission) => submission.homeworkId === id);
  if (linked.length) throw new Error(`This assignment has ${linked.length} linked submission(s). Delete is disabled so learner work and marks are not lost. You can edit the assignment instead.`);
  return R('homework').remove(id, 'removed homework assignment');
}
export async function saveMaterial(m) {
  if (!m.classId || !m.subjectId || !String(m.title ?? '').trim()) throw new Error('Choose a class and subject and enter a title.');
  if (m.type === 'link' && !/^https?:\/\//i.test(m.url ?? '')) throw new Error('Links must start with http:// or https://');
  return saveRecord('learningMaterials', { published: true, ...m }, 'saved learning material');
}
export async function saveLiveLesson(l) {
  if (!l.classId || !l.subjectId || !l.date || !l.startTime || !String(l.title ?? '').trim()) throw new Error('Enter a title, class, subject, date and start time.');
  if (l.meetingLink && !/^https?:\/\//i.test(l.meetingLink)) throw new Error('The meeting link must start with http:// or https://');
  if (l.endTime && l.endTime <= l.startTime) throw new Error('The end time must be after the start time.');
  return saveRecord('liveLessons', { status: 'scheduled', ...l }, 'scheduled live lesson');
}

// Marking a submission is only possible for homework the teacher owns/is assigned to.
export async function saveSubmission({ homework, studentId, status, marks, feedback, text }) {
  const d = await loadTeacher();
  if (!T.pairAllowed(d.scope, homework.classId, homework.subjectId)) throw new Error('This homework is not for one of your classes.');
  const sub = d.homeworkSubmissions.find((x) => x.homeworkId === homework.id && x.studentId === studentId);
  const patch = { homeworkId: homework.id, studentId, classId: homework.classId, status, marks: marks === '' || marks == null ? undefined : Number(marks), feedback: feedback ?? '', ...(text !== undefined ? { text } : {}) }; // a learner's own answer (and attachment) is never overwritten when a teacher marks
  const err = T.validateMark(patch, homework); if (err) throw new Error(err);
  if (status === 'marked' && patch.marks == null && !patch.feedback.trim()) throw new Error('Enter marks or feedback before marking.');
  if (['submitted', 'late'].includes(status)) { patch.submittedAt = sub?.submittedAt ?? today(); patch.status = T.submissionState(homework, patch.submittedAt); }
  return sub ? R('homeworkSubmissions').update(sub.id, patch, 'updated submission') : R('homeworkSubmissions').create(patch, 'recorded submission');
}
export const publishFeedback = (id, on = true) => R('homeworkSubmissions').update(id, { feedbackPublished: on }, 'published feedback');

// ---------------------------------------------------------------- allocation (administrator)
export async function allocate(teacherId, classId, subjectId, { classTeacher = false } = {}) {
  const ex = (await all('teachingAssignments')).find((a) => a.teacherId === teacherId && a.classId === classId && (a.subjectId ?? '') === (subjectId ?? ''));
  const made = ex ?? await R('teachingAssignments').create({ teacherId, classId, subjectId: subjectId || '' }, 'allocated class');
  if (classTeacher) await setClassTeacher(made.id, true);
  return made;
}
// One class teacher per class: choosing a new one quietly removes the flag from the previous one.
export async function setClassTeacher(assignmentId, on = true) {
  const rows = await all('teachingAssignments');
  const row = rows.find((a) => a.id === assignmentId);
  if (!row) throw new Error('That allocation no longer exists.');
  if (on) for (const other of rows.filter((a) => a.classId === row.classId && a.classTeacher && a.id !== assignmentId)) await R('teachingAssignments').update(other.id, { classTeacher: false }, 'changed class teacher');
  return R('teachingAssignments').update(assignmentId, { classTeacher: Boolean(on) }, on ? 'set class teacher' : 'removed class teacher');
}
export const deallocate = (id) => R("teachingAssignments").remove(id);

// ---------------------------------------------------------------- welfare
export async function listWelfare() { return hasWelfareAccess() ? all('welfareNotes') : []; }
export async function saveWelfare(w) {
  if (!hasWelfareAccess()) throw new Error('You do not have permission to use student welfare records.');
  const e = T.validateWelfare(w); if (e) throw new Error(e);
  const d = await loadTeacher();
  if (w.id) {
    const existing = await R('welfareNotes').getById(w.id);
    if (!existing) throw new Error('That welfare note no longer exists.');
    if (!d.scope.unrestricted && !T.classAllowed(d.scope, d.studentById[existing.studentId]?.classId)) throw new Error('You can only manage welfare notes for students in your classes.');
  }
  if (!d.scope.unrestricted && !T.classAllowed(d.scope, d.studentById[w.studentId]?.classId)) throw new Error('You can only record welfare notes for students in your classes.');
  return w.id ? R('welfareNotes').update(w.id, w, 'updated welfare note') : R('welfareNotes').create({ status: 'open', category: 'other', ...w, authorId: me()?.id, authorName: currentAccount()?.name ?? '' }, 'recorded welfare note');
}
export async function deleteWelfare(id) {
  if (!hasWelfareAccess()) throw new Error('You do not have permission to use student welfare records.');
  const note = await R('welfareNotes').getById(id);
  if (!note) throw new Error('That welfare note no longer exists.');
  const d = await loadTeacher();
  if (!d.scope.unrestricted && !T.classAllowed(d.scope, d.studentById[note.studentId]?.classId)) throw new Error('You can only manage welfare notes for students in your classes.');
  return R('welfareNotes').remove(id, 'removed welfare note');
}
export async function listTeamForGrants() {
  if (remote()) { const { loadRemoteTeam } = await import('./supabaseTeamService.js'); return (await loadRemoteTeam()).members.filter((m) => m.role === 'teacher'); }
  return listTeam().filter((m) => m.role === 'teacher');
}
export async function setWelfareGrant(accountId, name, on) {
  const ex = (await all('welfareGrants')).find((g) => g.accountId === accountId);
  if (on && !ex) await R('welfareGrants').create({ accountId, name }, 'granted welfare access');
  if (!on && ex) await R("welfareGrants").remove(ex.id);
  grantCache = await all('welfareGrants');
}

// ---------------------------------------------------------------- attendance notices (queued, never "sent")
export const DEFAULT_NOTICE = 'Dear {parent}, {student} was marked {status} on {date}. Please contact the school if this is unexpected. {school}';
export async function queueAbsenceNotices(date, classId) {
  const d = await loadTeacher();
  if (!T.classAllowed(d.scope, classId)) throw new Error('You can only send notices for your own classes.');
  const made = T.absenceNotices({ records: d.attendance.filter((r) => r.classId === classId), students: d.students, parents: await all('parents'), existing: d.attendanceNotices, date, template: DEFAULT_NOTICE, school: d.school.name ?? '' });
  for (const m of made) await R('attendanceNotices').create(m, 'queued attendance notice');
  return made;
}
export const markNoticeOpened = (id, via) => R('attendanceNotices').update(id, { queuedStatus: 'handed_to_device', via, openedAt: new Date().toISOString() });
export async function hasGrant(accountId) { return (await all('welfareGrants')).some((g) => g.accountId === accountId); }

// ================================================================ Phase Four

// ---------------------------------------------------------------- report-card preparation
const authorName = () => currentAccount()?.name ?? getCurrentRole() ?? 'Teacher';
// Teachers write a subject comment only for classes and subjects they are assigned to. It stays a draft
// (private to the teacher) until marked ready, and only ready comments reach the report card.
export async function saveSubjectComment({ examinationId, studentId, subjectId, classId, text, ready = false }) {
  const err = T.validateComment(text); if (err) throw new Error(err);
  const d = await loadTeacher();
  if (!T.pairAllowed(d.scope, classId, subjectId)) throw new Error('You can only comment on subjects you teach in this class.');
  const student = d.studentById[studentId];
  if (!student || student.classId !== classId) throw new Error('That learner is not in this class.');
  const trimmed = String(text ?? '').trim();
  const existing = d.reportComments.find((c) => c.examinationId === examinationId && c.studentId === studentId && c.subjectId === subjectId);
  if (ready && !trimmed) throw new Error('Write the comment before marking it ready.');
  if (!existing && !trimmed) return null;
  const patch = { text: trimmed, status: ready ? 'ready' : 'draft', authorId: me()?.id, authorName: authorName() };
  return existing ? R('reportComments').update(existing.id, patch, 'updated report comment') : R('reportComments').create({ examinationId, studentId, subjectId, classId, ...patch }, 'wrote report comment');
}
export async function markCommentsReady({ examinationId, classId }) {
  const d = await loadTeacher();
  const mine = d.reportComments.filter((c) => c.examinationId === examinationId && c.classId === classId && c.status === 'draft' && String(c.text ?? '').trim() && T.pairAllowed(d.scope, classId, c.subjectId));
  for (const c of mine) await R('reportComments').update(c.id, { status: 'ready' }, 'marked report comment ready');
  return mine.length;
}
// The class teacher's comment lives in the existing report-card record (so the printed card is unchanged).
export async function saveClassTeacherComment({ examinationId, studentId, classId, text }) {
  const err = T.validateComment(text); if (err) throw new Error(err);
  const d = await loadTeacher();
  if (!d.isClassTeacherFor(classId)) throw new Error('Only the class teacher can write this comment.');
  if (d.studentById[studentId]?.classId !== classId) throw new Error('That learner is not in this class.');
  const existing = d.reportCards.find((r) => r.examinationId === examinationId && r.studentId === studentId);
  const patch = { teacherComment: String(text ?? '').trim() };
  return existing ? R('reportCards').update(existing.id, patch, 'updated class teacher comment') : R('reportCards').create({ examinationId, studentId, principalComment: '', ...patch }, 'added class teacher comment');
}

// ---------------------------------------------------------------- class announcements
export async function postClassAnnouncement({ classId, title, body }) {
  validateClassAnnouncement({ classId, title, body });
  const d = await loadTeacher();
  if (!classId || !T.classAllowed(d.scope, classId)) throw new Error('You can only post to classes you teach.');
  return R('announcements').create({ title: title.trim(), body: body.trim(), audience: 'class', audienceIds: [classId], authorId: me()?.id, authorName: authorName() }, 'posted class announcement');
}

function validateClassAnnouncement({ classId, title, body }) {
  if (!String(title ?? '').trim() || !String(body ?? '').trim()) throw new Error('Enter a title and a message.');
  if (title.trim().length > 120) throw new Error('Keep the title under 120 characters.');
  if (body.trim().length > 1500) throw new Error('Keep the message under 1,500 characters.');
  if (!classId) throw new Error('Choose a class.');
  return true;
}

async function editableClassAnnouncement(id, classId) {
  const [announcement, d] = await Promise.all([R('announcements').getById(id), loadTeacher()]);
  if (!announcement || announcement.authorId !== me()?.id) throw new Error('Only the person who posted this announcement can change it.');
  if (announcement.audience !== 'class' || !(announcement.audienceIds ?? []).includes(classId)) throw new Error('That announcement is not for this class.');
  if (!T.classAllowed(d.scope, classId)) throw new Error('You can only manage announcements for classes you teach.');
  return announcement;
}

export async function updateClassAnnouncement({ id, classId, title, body }) {
  validateClassAnnouncement({ classId, title, body });
  await editableClassAnnouncement(id, classId);
  return R('announcements').update(id, { title: title.trim(), body: body.trim() }, 'updated class announcement');
}

export async function deleteClassAnnouncement(id) {
  const announcement = await R('announcements').getById(id);
  if (!announcement || announcement.authorId !== me()?.id) throw new Error('Only the person who posted this announcement can delete it.');
  const classId = (announcement.audienceIds ?? [])[0];
  const d = await loadTeacher();
  if (announcement.audience !== 'class' || !classId || !T.classAllowed(d.scope, classId)) throw new Error('You can only manage announcements for classes you teach.');
  return R('announcements').remove(id, 'removed class announcement');
}



// ---------------------------------------------------------------- curriculum planning frameworks (administrator)
export async function savePlanningFramework(curriculumId, fields) {
  if (!curriculumId) throw new Error('Choose a curriculum.');
  const err = T.validateFramework(fields); if (err) throw new Error(err);
  const clean = fields.map((f) => ({ key: f.key, label: f.label.trim(), multiline: Boolean(f.multiline) }));
  const existing = (await all('planningFrameworks')).find((f) => f.curriculumId === curriculumId);
  return existing ? R('planningFrameworks').update(existing.id, { fields: clean }, 'updated planning framework') : R('planningFrameworks').create({ curriculumId, fields: clean }, 'created planning framework');
}
