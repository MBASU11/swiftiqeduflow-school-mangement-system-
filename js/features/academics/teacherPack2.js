// Teacher Pack, Phase Four screens (demo mode until the backend phase adds their cloud tables).
// Everything a teacher sees here is limited to their own classes and subjects.
import { escapeHtml, on, qs } from '../../components/dom.js';
import { printHtml } from '../../components/printWindow.js';
import { fullName } from '../../services/studentService.js';
import { isAdmin } from '../../services/accessService.js';
import { moduleEnabled } from '../../services/subscriptionService.js';
import * as T from '../../services/teacherLogic.js';
import * as S from '../../services/teacherService.js';

const today = () => new Date().toISOString().slice(0, 10);
const badge = (tone, text) => `<span class="badge badge-${tone}">${escapeHtml(text)}</span>`;
const opt = (list, sel, label = (x) => x.name) => list.map((x) => `<option value="${escapeHtml(x.id ?? x)}" ${(x.id ?? x) === sel ? 'selected' : ''}>${escapeHtml(label(x))}</option>`).join('');
const nameOf = (map, id) => map[id]?.name ?? '—';
const table = (heads, rows, right = []) => `<div class="overflow-x-auto"><table class="data-table"><thead><tr>${heads.map((h, i) => `<th ${right.includes(i) ? 'class="text-right"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td ${right.includes(i) ? 'class="text-right"' : ''}>${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${heads.length}" class="text-sm text-ink-500">Nothing to show.</td></tr>`}</tbody></table></div>`;
const DAY_NAMES = { MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday' };

export const PHASE4_TABS = [
  ['schedule', 'Timetable & deadlines', () => moduleEnabled('teacher_pack')],
  ['classlist', 'Class lists & learners', () => moduleEnabled('teacher_pack')],
  ['results', 'Exam results', () => moduleEnabled('teacher_pack')],
  ['reportprep', 'Report-card preparation', () => moduleEnabled('teacher_pack')],
  ['announce', 'Class announcements', () => moduleEnabled('teacher_pack')],
  ['frameworks', 'Curriculum templates', () => moduleEnabled('teacher_pack') && isAdmin()],
];

// ---------------------------------------------------------------- timetable and deadlines
export async function schedule(el, d) {
  const st = { teacherId: d.scope.teacherId ?? '' };
  const teachers = d.teachers.filter((t) => t.category === 'teaching');
  if (d.scope.unrestricted && !st.teacherId) st.teacherId = teachers[0]?.id ?? '';
  function paint() {
    const t = today(); const week = T.weekFor(d.timetableEntries, st.teacherId); const todays = T.lessonsOn(d.timetableEntries, st.teacherId, t);
    const mineHw = d.scope.unrestricted ? d.homework : d.mine(d.homework);
    const figs = Object.fromEntries(mineHw.map((h) => [h.id, T.homeworkFigures(h, d.students, d.homeworkSubmissions, t)]));
    const myClassIds = d.scope.unrestricted ? new Set(d.classes.map((c) => c.id)) : d.scope.classIds;
    const deadlines = T.buildDeadlines({ today: t, homework: mineHw, homeworkFigs: figs, assessments: d.assessments.filter((a) => myClassIds.has(a.classId)), assessmentScores: d.assessmentScores, students: d.students, lessonPlans: d.mine(d.lessonPlans), liveLessons: d.mine(d.liveLessons) });
    el.innerHTML = `<div class="space-y-4">
      ${d.scope.unrestricted ? `<select class="input" id="sc-t" style="max-width:18rem;">${teachers.map((x) => `<option value="${x.id}" ${x.id === st.teacherId ? 'selected' : ''}>${escapeHtml(`${x.firstName} ${x.lastName}`)}</option>`).join('')}</select>` : ''}
      <section class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Today — ${escapeHtml(DAY_NAMES[T.dayCodeOf(t)] ?? 'No lessons on Sunday')}</h3>${todays.length ? todays.map((e) => `<p class="text-sm" style="margin:.25rem 0;"><strong>${escapeHtml(e.startTime)}–${escapeHtml(e.endTime)}</strong> · ${escapeHtml(nameOf(d.classById, e.classId))} · ${escapeHtml(nameOf(d.subjectById, e.subjectId))}</p>`).join('') : '<p class="text-sm text-ink-500">No lessons scheduled today.</p>'}</section>
      <section class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Deadlines (next 14 days, overdue first)</h3>${deadlines.length ? deadlines.map((x) => `<p class="text-sm" style="margin:.25rem 0;">${x.overdue ? badge('bad', 'overdue') : badge('muted', x.date)} ${escapeHtml(x.text)} <span class="text-xs text-ink-500">· ${escapeHtml(nameOf(d.classById, x.classId))}</span></p>`).join('') : '<p class="text-sm text-ink-500">Nothing due. All caught up.</p>'}</section>
      <section class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Weekly timetable</h3>${table(['Day', 'Lessons'], Object.entries(week).map(([day, list]) => [DAY_NAMES[day], list.length ? list.map((e) => `${escapeHtml(e.startTime)}–${escapeHtml(e.endTime)} ${escapeHtml(nameOf(d.classById, e.classId))} (${escapeHtml(nameOf(d.subjectById, e.subjectId))})`).join('<br>') : '<span class="text-ink-400">—</span>']))}
      ${Object.values(week).every((x) => !x.length) ? '<p class="text-xs text-ink-500 mt-2">No lessons are assigned to this teacher in the timetable yet.</p>' : ''}</section></div>`;
    qs(el, '#sc-t')?.addEventListener('change', (e) => { st.teacherId = e.target.value; paint(); });
  }
  paint();
}

// ---------------------------------------------------------------- class lists and learner profiles
export async function classlist(el, d) {
  const st = { classId: d.myClasses[0]?.id ?? '', studentId: '' };
  const welfare = S.hasWelfareAccess() ? await S.listWelfare() : null;
  function paint() {
    const stus = d.myStudents.filter((s) => s.classId === st.classId).sort((a, b) => String(a.admissionNumber).localeCompare(String(b.admissionNumber), undefined, { numeric: true }));
    const term = d.currentTerm; const range = term?.startDate && term?.endDate ? { from: term.startDate, to: term.endDate } : {};
    const prof = (s) => T.learnerProfile({ student: s, attendance: d.attendance, homework: d.homework, submissions: d.homeworkSubmissions, assessments: d.assessments, scores: d.assessmentScores, examScores: d.examScores, ...range });
    const sel = stus.find((s) => s.id === st.studentId);
    const pr = sel && prof(sel); const parents = sel ? (sel.parentIds ?? []).map((id) => d.parents.find((p) => p.id === id)).filter(Boolean) : [];
    const printable = `<h2>${escapeHtml(nameOf(d.classById, st.classId))} — class list</h2>${table(['#', 'Adm. no.', 'Name', 'Gender'], stus.map((s, i) => [i + 1, escapeHtml(s.admissionNumber ?? ''), escapeHtml(fullName(s)), escapeHtml(s.gender ?? '')]))}`;
    el.innerHTML = `<div class="space-y-4"><div class="flex flex-wrap gap-2 items-center"><select class="input" id="cl-c" style="max-width:14rem;">${opt(d.myClasses, st.classId)}</select><span class="text-sm text-ink-600">${stus.length} learner(s)</span><button class="btn-secondary btn-sm" id="cl-print">Print class list</button></div>
      ${table(['Adm. no.', 'Learner', 'Attendance', 'Homework', 'Assessments', ...(welfare ? ['Welfare'] : []), ''], stus.map((s) => { const p = prof(s); const open = welfare?.filter((n) => n.studentId === s.id && n.status === 'open').length; return [escapeHtml(s.admissionNumber ?? ''), `<strong>${escapeHtml(fullName(s))}</strong>`, p.attendance.rate == null ? '—' : `${p.attendance.rate}%`, p.homework.rate == null ? '—' : `${p.homework.rate}%`, p.progress.average == null ? '—' : `${p.progress.average}% (${p.progress.trend})`, ...(welfare ? [open ? badge('gold', `${open} open`) : '—'] : []), `<button class="btn-ghost btn-sm" data-open="${s.id}">Profile</button>`]; }), [])}
      ${sel ? `<section class="card card-p space-y-2"><div class="flex justify-between"><h3 class="text-sm" style="font-weight:600;">${escapeHtml(fullName(sel))}</h3><button class="btn-ghost btn-sm" id="cl-close">Close</button></div>
        <p class="text-sm text-ink-600">${escapeHtml(sel.admissionNumber ?? '')} · ${escapeHtml(nameOf(d.classById, sel.classId))}${sel.gender ? ` · ${escapeHtml(sel.gender)}` : ''}${sel.dateOfBirth ? ` · born ${escapeHtml(sel.dateOfBirth)}` : ''}</p>
        <div class="grid grid-2 lg-grid-4 gap-3 text-sm"><div class="card card-p"><p class="text-ink-500">Attendance${term ? ` (${escapeHtml(term.name)})` : ''}</p><strong>${pr.attendance.rate == null ? 'no records' : `${pr.attendance.rate}%`}</strong><p class="text-xs text-ink-500">${pr.attendance.present} present · ${pr.attendance.absent} absent · ${pr.attendance.late} late · ${pr.attendance.excused} excused</p></div>
          <div class="card card-p"><p class="text-ink-500">Homework</p><strong>${pr.homework.rate == null ? '—' : `${pr.homework.rate}%`}</strong><p class="text-xs text-ink-500">${pr.homework.handedIn} of ${pr.homework.assigned} handed in</p></div>
          <div class="card card-p"><p class="text-ink-500">Assessments</p><strong>${pr.progress.average == null ? '—' : `${pr.progress.average}%`}</strong><p class="text-xs text-ink-500">trend: ${escapeHtml(pr.progress.trend)}</p></div>
          <div class="card card-p"><p class="text-ink-500">Exam average</p><strong>${pr.examAverage == null ? '—' : `${pr.examAverage}%`}</strong><p class="text-xs text-ink-500">${pr.examSubjects} subject mark(s)</p></div></div>
        ${pr.progress.points.length ? table(['Assessment', 'Date', 'Score'], pr.progress.points.map((x) => [escapeHtml(x.name), escapeHtml(x.date), `${x.pct}%`]), [2]) : ''}
        <h4 class="text-sm" style="font-weight:600;">Parents / guardians</h4>${parents.length ? parents.map((p) => `<p class="text-sm" style="margin:.2rem 0;">${escapeHtml([p.firstName, p.lastName].filter(Boolean).join(' '))}${p.relationship ? ` (${escapeHtml(p.relationship)})` : ''}${p.phone ? ` · ${escapeHtml(p.phone)}` : ''}${p.email ? ` · ${escapeHtml(p.email)}` : ''}</p>`).join('') : '<p class="text-sm text-ink-500">No parent on record.</p>'}
        <p class="text-xs text-ink-500">Fee, health and welfare details are not shown here. Welfare notes are in their own restricted tab.</p></section>` : ''}</div>`;
    qs(el, '#cl-c').addEventListener('change', (e) => { st.classId = e.target.value; st.studentId = ''; paint(); });
    qs(el, '#cl-print').addEventListener('click', () => printHtml('Class list', printable));
    on(el, '[data-open]', 'click', (e) => { st.studentId = e.currentTarget.dataset.open; paint(); });
    qs(el, '#cl-close')?.addEventListener('click', () => { st.studentId = ''; paint(); });
  }
  paint();
}

// ---------------------------------------------------------------- exam results (the teacher's own subjects)
export async function results(el, d) {
  const st = { examId: d.examinations[0]?.id ?? '', classId: d.myClasses[0]?.id ?? '' };
  function paint() {
    const subjects = T.commentableSubjects(d.scope, st.classId, d.subjects);
    const stus = d.myStudents.filter((s) => s.classId === st.classId);
    const score = (sid, sub) => d.examScores.find((x) => x.examinationId === st.examId && x.subjectId === sub && x.studentId === sid)?.score;
    const mean = (sub) => { const v = stus.map((s) => score(s.id, sub)).filter((x) => x != null).map(Number); return v.length ? Math.round((v.reduce((t, x) => t + x, 0) / v.length) * 10) / 10 : null; };
    el.innerHTML = `<div class="space-y-4"><div class="flex flex-wrap gap-2"><select class="input" id="rs-e" style="max-width:16rem;">${d.examinations.length ? opt(d.examinations, st.examId) : '<option value="">No examinations yet</option>'}</select><select class="input" id="rs-c" style="max-width:12rem;">${opt(d.myClasses, st.classId)}</select></div>
      ${!subjects.length ? '<p class="text-sm text-ink-500">You teach no subjects in this class, so there are no results to show.</p>' : table(['Learner', ...subjects.map((s) => escapeHtml(s.name))], [...stus.map((s) => [escapeHtml(fullName(s)), ...subjects.map((sub) => { const v = score(s.id, sub.id); return v == null ? '<span class="text-ink-400">—</span>' : escapeHtml(String(v)); })]), ['<strong>Class mean</strong>', ...subjects.map((sub) => { const m = mean(sub.id); return `<strong>${m == null ? '—' : m}</strong>`; })], ['<span class="text-xs">Marks missing</span>', ...subjects.map((sub) => `<span class="text-xs">${stus.filter((s) => score(s.id, sub.id) == null).length}</span>`)]])}
      <p class="text-xs text-ink-500">Results are shown for the subjects you teach. Enter or correct marks in Mobile marks or Exams &amp; Assessments. Publishing report cards is done by the school administrator.</p></div>`;
    qs(el, '#rs-e').addEventListener('change', (e) => { st.examId = e.target.value; paint(); });
    qs(el, '#rs-c').addEventListener('change', (e) => { st.classId = e.target.value; paint(); });
  }
  paint();
}

// ---------------------------------------------------------------- report-card preparation
export async function reportprep(el, d, redo) {
  const st = { examId: d.examinations[0]?.id ?? '', classId: d.myClasses[0]?.id ?? '', flash: '' };
  function paint() {
    const subjects = T.commentableSubjects(d.scope, st.classId, d.subjects);
    const classTeacher = d.isClassTeacherFor(st.classId);
    const cardOf = (sid) => d.reportCards.find((r) => r.examinationId === st.examId && r.studentId === sid);
    const rows = T.reportReadiness({ students: d.myStudents, subjects, examScores: d.examScores, examinationId: st.examId, comments: d.reportComments, classTeacherComments: Object.fromEntries(d.myStudents.map((s) => [s.id, { text: cardOf(s.id)?.teacherComment }])), classId: st.classId });
    const done = rows.filter((r) => r.complete).length;
    el.innerHTML = `<div class="space-y-4"><div class="notice"><span>Write your comments here. They stay <strong>drafts</strong> (private to you) until you mark them <strong>ready</strong>; only ready comments appear on the report card. The administrator still approves and publishes report cards.</span></div>
      <div class="flex flex-wrap gap-2 items-center"><select class="input" id="rp-e" style="max-width:16rem;">${d.examinations.length ? opt(d.examinations, st.examId) : '<option value="">No examinations yet</option>'}</select><select class="input" id="rp-c" style="max-width:12rem;">${opt(d.myClasses, st.classId)}</select>
        <span class="text-sm text-ink-600">${done}/${rows.length} learners complete</span><button class="btn-secondary btn-sm" id="rp-ready" ${subjects.length ? '' : 'disabled'}>Mark all my drafts ready</button></div>
      ${!subjects.length && !classTeacher ? '<p class="text-sm text-ink-500">You teach no subjects in this class and are not its class teacher.</p>' : ''}
      ${st.flash ? `<div class="notice" role="status"><span>${escapeHtml(st.flash)}</span></div>` : ''}
      ${rows.map((r) => { const s = r.student; return `<section class="card card-p space-y-2" data-stu="${s.id}"><div class="flex flex-wrap justify-between gap-2"><strong>${escapeHtml(fullName(s))} <span class="text-xs text-ink-500">${escapeHtml(s.admissionNumber ?? '')}</span></strong><span>${r.marksNeeded ? badge(r.marksIn === r.marksNeeded ? 'good' : 'gold', `marks ${r.marksIn}/${r.marksNeeded}`) : ''} ${r.complete ? badge('good', 'complete') : ''}</span></div>
        ${subjects.map((sub) => { const c = d.reportComments.find((x) => x.examinationId === st.examId && x.studentId === s.id && x.subjectId === sub.id); return `<div><label class="label">${escapeHtml(sub.name)} ${c ? badge(c.status === 'ready' ? 'good' : 'gold', c.status) : ''}</label><textarea class="input" rows="2" maxlength="${T.COMMENT_MAX}" data-sub="${sub.id}" data-cls="${st.classId}">${escapeHtml(c?.text ?? '')}</textarea><div class="flex justify-between text-xs text-ink-500"><span data-count>${(c?.text ?? '').length}/${T.COMMENT_MAX}</span><button class="btn-ghost btn-sm" data-ready="${sub.id}">Save &amp; mark ready</button></div></div>`; }).join('')}
        ${classTeacher ? `<div><label class="label">Class teacher's comment</label><textarea class="input" rows="2" maxlength="${T.COMMENT_MAX}" data-classcomment>${escapeHtml(cardOf(s.id)?.teacherComment ?? '')}</textarea></div>` : ''}</section>`; }).join('')}</div>`;
    qs(el, '#rp-e').addEventListener('change', (e) => { st.examId = e.target.value; paint(); });
    qs(el, '#rp-c').addEventListener('change', (e) => { st.classId = e.target.value; paint(); });
    const save = async (ta, ready) => {
      const card = ta.closest('[data-stu]'); const base = { examinationId: st.examId, studentId: card.dataset.stu, classId: st.classId, text: ta.value };
      try { if (ta.hasAttribute('data-classcomment')) await S.saveClassTeacherComment(base); else await S.saveSubjectComment({ ...base, subjectId: ta.dataset.sub, ready }); return true; } catch (e) { await redo('', e.message); return false; }
    };
    on(el, 'textarea', 'input', (e) => { const c = e.currentTarget.parentElement.querySelector('[data-count]'); if (c) c.textContent = `${e.currentTarget.value.length}/${T.COMMENT_MAX}`; });
    on(el, 'textarea', 'change', async (e) => { if (await save(e.currentTarget, false)) { st.flash = 'Draft saved.'; } });
    on(el, '[data-ready]', 'click', async (e) => { const ta = e.currentTarget.closest('div').parentElement.querySelector('textarea'); if (await save(ta, true)) await redo('Saved and marked ready.'); });
    qs(el, '#rp-ready').addEventListener('click', async () => { try { const n = await S.markCommentsReady({ examinationId: st.examId, classId: st.classId }); await redo(n ? `${n} comment(s) marked ready.` : 'No drafts to mark ready.'); } catch (e) { await redo('', e.message); } });
  }
  paint();
}

// ---------------------------------------------------------------- class announcements
export async function announce(el, d, redo) {
  const st = { classId: d.myClasses[0]?.id ?? '', title: '', body: '', editingId: '' }; const me = S.currentUserId();
  const mine = new Set(d.myClasses.map((c) => c.id));
  const visible = d.announcements.filter((a) => a.audience === 'school' || a.audience === 'teachers' || (a.audience === 'class' && (a.audienceIds ?? []).some((id) => d.scope.unrestricted || mine.has(id)))).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 30);
  function paint() {
    el.innerHTML = `<div class="space-y-4"><section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">${st.editingId ? 'Edit class announcement' : 'Post to a class'}</h3><div class="grid grid-2 gap-3"><div><label class="label">Class</label><select class="input" data-f="classId">${opt(d.myClasses, st.classId)}</select></div><div><label class="label">Title</label><input class="input" data-f="title" maxlength="120" value="${escapeHtml(st.title)}" /></div></div>
      <div><label class="label">Message</label><textarea class="input" rows="3" data-f="body" maxlength="1500">${escapeHtml(st.body)}</textarea></div><div class="flex gap-2">${st.editingId ? '<button class="btn-secondary" id="an-cancel">Cancel</button>' : ''}<button class="btn-primary" id="an-go">${st.editingId ? 'Save changes' : 'Post announcement'}</button></div><p class="text-xs text-ink-500">This goes to the class's parents and learners through the school's announcements. It is not an SMS or WhatsApp message.</p></section>
    ${table(['Date', 'To', 'Title', 'From'], visible.map((a) => [escapeHtml(String(a.createdAt).slice(0, 10)), a.audience === 'class' ? escapeHtml((a.audienceIds ?? []).map((id) => nameOf(d.classById, id)).join(', ')) : escapeHtml(a.audience), `<strong>${escapeHtml(a.title)}</strong><div class="text-xs text-ink-500">${escapeHtml(a.body)}</div>${a.authorId === me && a.audience === 'class' ? `<div class="flex gap-2 mt-1"><button class="btn-ghost btn-sm" data-edit-announcement="${a.id}">Edit</button><button class="btn-ghost btn-sm" data-delete-announcement="${a.id}">Delete</button></div>` : ''}`, escapeHtml(a.authorId === me ? 'You' : a.authorName ?? 'School')]))}</div>`;
    on(el, '[data-f]', 'input', (e) => { st[e.currentTarget.dataset.f] = e.currentTarget.value; });
    on(el, '[data-f="classId"]', 'change', (e) => { st.classId = e.currentTarget.value; });
    qs(el, '#an-cancel')?.addEventListener('click', () => { Object.assign(st, { editingId: '', title: '', body: '', classId: d.myClasses[0]?.id ?? '' }); paint(); });
    qs(el, '#an-go').addEventListener('click', async () => { try { if (st.editingId) await S.updateClassAnnouncement(st); else await S.postClassAnnouncement(st); await redo(st.editingId ? 'Announcement updated.' : 'Announcement posted.'); } catch (e) { await redo('', e.message); } });
    on(el, '[data-edit-announcement]', 'click', (e) => {
      const a = visible.find((item) => item.id === e.currentTarget.dataset.editAnnouncement);
      if (!a || a.authorId !== me || a.audience !== 'class') return;
      Object.assign(st, { editingId: a.id, classId: a.audienceIds[0], title: a.title, body: a.body }); paint();
    });
    on(el, '[data-delete-announcement]', 'click', async (e) => {
      const a = visible.find((item) => item.id === e.currentTarget.dataset.deleteAnnouncement);
      if (!a || a.authorId !== me || a.audience !== 'class' || !globalThis.confirm?.(`Delete "${a.title}"?`)) return;
      try { await S.deleteClassAnnouncement(a.id); await redo('Announcement deleted.'); } catch (error) { await redo('', error.message); }
    });
  }
  paint();
}

// ---------------------------------------------------------------- curriculum templates (administrator)
export async function frameworks(el, d, redo) {
  const st = { curriculumId: d.curricula[0]?.id ?? '', fields: null };
  function paint() {
    if (st.fields === null) st.fields = JSON.parse(JSON.stringify(T.frameworkFor(st.curriculumId, d.planningFrameworks)));
    const used = d.classes.filter((c) => c.curriculumId === st.curriculumId).map((c) => c.name);
    el.innerHTML = `<div class="space-y-4"><div class="notice"><span>Each curriculum can have its own extra lesson-plan fields (for example strand and outcomes for a competency-based curriculum, or syllabus codes for Cambridge). Nothing is built in: choose a starting template and change it freely.</span></div>
      ${!d.curricula.length ? '<p class="text-sm text-ink-500">Add a curriculum under Academics first.</p>' : `<section class="card card-p space-y-3"><div class="grid grid-2 gap-3"><div><label class="label">Curriculum</label><select class="input" id="fw-c">${opt(d.curricula, st.curriculumId)}</select><p class="text-xs text-ink-500 mt-1">Used by: ${used.length ? escapeHtml(used.join(', ')) : 'no class yet'}</p></div>
        <div><label class="label">Start from a template</label><select class="input" id="fw-p"><option value="">Choose…</option>${Object.entries(T.FRAMEWORK_PRESETS).map(([k, v]) => `<option value="${k}">${escapeHtml(v.label)}</option>`).join('')}</select></div></div>
        ${st.fields.map((f, i) => `<div class="grid grid-2 lg-grid-4 gap-2 items-end" data-row="${i}"><div><label class="label">Key</label><input class="input" data-k="key" value="${escapeHtml(f.key)}" /></div><div><label class="label">Label shown to teachers</label><input class="input" data-k="label" value="${escapeHtml(f.label)}" /></div><label class="text-sm"><input type="checkbox" data-k="multiline" ${f.multiline ? 'checked' : ''} /> Long answer</label><button class="btn-ghost btn-sm" data-del="${i}">Remove</button></div>`).join('') || '<p class="text-sm text-ink-500">No extra fields: lesson plans use the standard fields only.</p>'}
        <div class="flex gap-2"><button class="btn-secondary btn-sm" id="fw-add">Add field</button><button class="btn-primary" id="fw-save">Save template</button></div></section>`}</div>`;
    qs(el, '#fw-c')?.addEventListener('change', (e) => { st.curriculumId = e.target.value; st.fields = null; paint(); });
    qs(el, '#fw-p')?.addEventListener('change', (e) => { const p = T.FRAMEWORK_PRESETS[e.target.value]; if (p) { st.fields = JSON.parse(JSON.stringify(p.fields)); paint(); } });
    on(el, '[data-k]', 'input', (e) => { const i = Number(e.currentTarget.closest('[data-row]').dataset.row); const k = e.currentTarget.dataset.k; st.fields[i][k] = e.currentTarget.type === 'checkbox' ? e.currentTarget.checked : e.currentTarget.value; });
    on(el, '[data-del]', 'click', (e) => { st.fields.splice(Number(e.currentTarget.dataset.del), 1); paint(); });
    qs(el, '#fw-add')?.addEventListener('click', () => { st.fields.push({ key: '', label: '', multiline: false }); paint(); });
    qs(el, '#fw-save')?.addEventListener('click', async () => { try { await S.savePlanningFramework(st.curriculumId, st.fields); await redo('Template saved. Teachers see these fields on lesson plans for this curriculum.'); } catch (e) { await redo('', e.message); } });
  }
  paint();
}

export const PHASE4_VIEWS = { schedule, classlist, results, reportprep, announce, frameworks };
