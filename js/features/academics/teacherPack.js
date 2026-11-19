// Teacher Pack screens. They plug into the existing Academics module as extra tabs, only for
// features the school's package includes. A teacher only ever sees their own classes.
import { escapeHtml, on, qs } from '../../components/dom.js';
import { fullName } from '../../services/studentService.js';
import { isAdmin } from '../../services/accessService.js';
import { featureEnabled, moduleEnabled } from '../../services/subscriptionService.js';
import * as T from '../../services/teacherLogic.js';
import * as S from '../../services/teacherService.js';
import { outcomesFor } from '../../services/competencyLogic.js';
import { PHASE4_TABS, PHASE4_VIEWS } from './teacherPack2.js';
import { isSupabaseConfigured } from '../../config/supabase.js';

const today = () => new Date().toISOString().slice(0, 10);
const badge = (tone, text) => `<span class="badge badge-${tone}">${escapeHtml(text)}</span>`;
const errBox = (e) => `<div class="notice" role="alert"><span>${escapeHtml(e?.message ?? e)}</span></div>`;
const opt = (list, sel, label = (x) => x.name) => list.map((x) => `<option value="${x.id ?? x}" ${(x.id ?? x) === sel ? 'selected' : ''}>${escapeHtml(label(x))}</option>`).join('');

export const TEACHER_TABS = [
  ['teaching', 'My teaching', () => moduleEnabled('teacher_pack')],
  ['lessons', 'Lesson plans', () => featureEnabled('lesson_planning')],
  ['schemes', 'Schemes of work', () => featureEnabled('workplan_manager')],
  ['homework', 'Homework', () => featureEnabled('homework')],
  ['elearning', 'eLearning', () => featureEnabled('elearning')],
  ['live', 'Live lessons', () => featureEnabled('live_lessons')],
  ['welfare', 'Student welfare', () => featureEnabled('student_welfare') && S.hasWelfareAccess()],
  ['areports', 'Academic reports', () => featureEnabled('advanced_assessment_reports')],
  ['allocation', 'Class allocation', () => moduleEnabled('teacher_pack') && isAdmin()],
  // Phase Four screens: demo mode until the backend phase adds their cloud tables.
  ...PHASE4_TABS.map(([k, l, on]) => [k, l, () => !isSupabaseConfigured() && on()]),
];

export async function renderTeacherTab(tab, body) {
  const ctx = { flash: '', error: '' };
  const view = { teaching, lessons, schemes, homework, elearning, live, welfare, areports, allocation, ...PHASE4_VIEWS }[tab];
  async function draw() {
    body.setAttribute('data-own-permissions', '');
    body.innerHTML = '<p class="text-sm text-ink-500">Loading…</p>';
    try {
      const d = await S.loadTeacher();
      body.innerHTML = `${ctx.flash ? `<div class="notice" role="status"><span>${escapeHtml(ctx.flash)}</span></div>` : ''}${ctx.error ? errBox(ctx.error) : ''}${!d.scope.linked ? '<div class="notice"><span>Your account is not linked to a staff record, so no classes are assigned to you yet. Ask the administrator to add you under Staff with this same email address, then allocate your classes.</span></div>' : ''}<div id="tp"></div>`;
      const redo = (flash, error) => { ctx.flash = flash ?? ''; ctx.error = error ?? ''; return draw(); };
      ctx.flash = ''; ctx.error = '';
      await view(qs(body, '#tp'), d, redo);
    } catch (e) { body.innerHTML = errBox(e); }
  }
  return draw();
}

// A reusable class + subject (+ term) picker kept in step with what the person may teach.
function picker(d, st, { term = false } = {}) {
  const subs = st.classId ? d.subjectsFor(st.classId) : [];
  if (st.classId && !subs.some((s) => s.id === st.subjectId)) st.subjectId = subs[0]?.id ?? '';
  return `<div><label class="label">Class</label><select class="input" data-f="classId"><option value="">Choose…</option>${opt(d.myClasses, st.classId)}</select></div>
    <div><label class="label">Subject</label><select class="input" data-f="subjectId">${opt(subs, st.subjectId)}</select></div>
    ${term ? `<div><label class="label">Term</label><select class="input" data-f="termId"><option value="">—</option>${opt(d.terms, st.termId ?? d.currentTerm?.id)}</select></div>` : ''}`;
}
// Wires data-f inputs to a state object; class changes redraw so the subject list follows.
function bindForm(root, st, repaint) {
  on(root, '[data-f]', 'input', (e) => { const el = e.currentTarget; st[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; });
  on(root, '[data-f="classId"]', 'change', (e) => { st.classId = e.currentTarget.value; st.subjectId = ''; repaint(); });
}
const name = (d, id, map) => d[map][id]?.name ?? '—';

// ---------------------------------------------------------------- dashboard
async function teaching(el, d) {
  const t = today();
  // The timetable stores days as MO/TU/WE…, so convert today's date to that code (this used to compare day names and always came back empty).
  const todays = d.scope.teacherId ? T.lessonsOn(d.timetableEntries, d.scope.teacherId, t) : [];
  const marked = new Set(d.attendance.filter((a) => a.date === t).map((a) => a.classId));
  const attendanceTasks = d.myClasses.filter((c) => !marked.has(c.id));
  const plans = d.mine(d.lessonPlans).filter((p) => p.date >= t && p.status === 'planned').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const hws = d.mine(d.homework);
  const figs = hws.map((h) => ({ h, f: T.homeworkFigures(h, d.students, d.homeworkSubmissions, t) }));
  const toMark = figs.filter((x) => x.f.toMark > 0);
  const live = d.mine(d.liveLessons).filter((l) => l.status === 'scheduled' && l.date >= t).sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)).slice(0, 4);
  const progress = d.myClasses.map((c) => { const as = d.assessments.filter((a) => a.classId === c.id); const avgs = as.map((a) => T.assessmentResults(a, d.assessmentScores, d.students).average).filter((x) => x != null); return { c, n: as.length, avg: avgs.length ? Math.round((avgs.reduce((x, y) => x + y, 0) / avgs.length) * 10) / 10 : null }; });
  const card = (l, v) => `<div class="card card-p"><p class="text-sm text-ink-500">${l}</p><p class="stat-num" style="font-size:1.3rem;">${v}</p></div>`;
  const list = (rows) => rows.length ? rows.join('') : '<p class="text-sm text-ink-400">Nothing right now.</p>';
  const notices = d.attendanceNotices.filter((n) => n.queuedStatus === 'queued' && (d.scope.unrestricted || d.scope.classIds.has(n.classId)));
  el.innerHTML = `<div class="space-y-4"><div class="grid grid-2 lg-grid-4 gap-4">${card('My classes', d.myClasses.length)}${card('Students', d.myStudents.length)}${card('Attendance still to mark today', attendanceTasks.length)}${card('Homework awaiting marking', toMark.reduce((s, x) => s + x.f.toMark, 0))}</div>
    <div class="grid grid-2 gap-4">
    <div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">My classes & subjects</h3>${list((d.scope.unrestricted ? d.classes.map((c) => ({ classId: c.id, subjectId: '' })) : d.scope.pairs).map((p) => `<p class="text-sm" style="margin:.2rem 0;">${escapeHtml(name(d, p.classId, 'classById'))}${p.subjectId ? ` · ${escapeHtml(name(d, p.subjectId, 'subjectById'))}` : ''}</p>`))}</div>
    <div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Today's timetable</h3>${list(todays.map((e) => `<p class="text-sm" style="margin:.2rem 0;">${escapeHtml(e.startTime ?? '')}–${escapeHtml(e.endTime ?? '')} · ${escapeHtml(name(d, e.classId, 'classById'))} · ${escapeHtml(name(d, e.subjectId, 'subjectById'))}</p>`))}</div>
    <div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Attendance tasks today</h3>${list(attendanceTasks.map((c) => `<p class="text-sm" style="margin:.2rem 0;"><a href="#/attendance">Mark ${escapeHtml(c.name)}</a></p>`))}</div>
    <div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Upcoming lessons</h3>${list(plans.map((p) => `<p class="text-sm" style="margin:.2rem 0;">${escapeHtml(p.date)} · ${escapeHtml(name(d, p.classId, 'classById'))} · ${escapeHtml(p.topic)}</p>`))}</div>
    <div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Homework to mark / student submissions</h3>${list(toMark.map(({ h, f }) => `<p class="text-sm" style="margin:.2rem 0;">${escapeHtml(h.title)} · ${escapeHtml(name(d, h.classId, 'classById'))} — ${f.toMark} to mark of ${f.total}</p>`))}</div>
    <div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Scheduled live lessons</h3>${list(live.map((l) => `<p class="text-sm" style="margin:.2rem 0;">${escapeHtml(l.date)} ${escapeHtml(l.startTime)} · ${escapeHtml(l.title)}</p>`))}</div>
    <div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Academic progress</h3>${list(progress.map((x) => `<p class="text-sm" style="margin:.2rem 0;">${escapeHtml(x.c.name)} — ${x.avg == null ? 'no results yet' : `${x.avg}% average over ${x.n} assessment(s)`}</p>`))}</div>
    <div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Academic notifications</h3>${list([...notices.map((n) => `<p class="text-sm" style="margin:.2rem 0;">Absence notice queued for ${escapeHtml(d.studentById[n.studentId] ? fullName(d.studentById[n.studentId]) : '')}</p>`), ...figs.filter((x) => x.h.dueDate === t).map((x) => `<p class="text-sm" style="margin:.2rem 0;">Homework due today: ${escapeHtml(x.h.title)}</p>`)])}</div></div></div>`;
}

// ---------------------------------------------------------------- lesson plans
async function lessons(el, d, redo) {
  const st = { open: false, classId: d.myClasses[0]?.id ?? '', subjectId: '', termId: d.currentTerm?.id ?? '', date: today(), topic: '', subtopic: '', objectives: '', activities: '', resources: '', status: 'planned', extra: {}, outcomeIds: [] };
  const plans = d.mine(d.lessonPlans).sort((a, b) => b.date.localeCompare(a.date));
  const sum = T.planningSummary(plans);
  function paint() {
    el.innerHTML = `<div class="space-y-4"><div class="flex flex-wrap justify-between gap-2"><p class="text-sm text-ink-600">${sum.planned} planned · ${sum.taught} taught · ${sum.postponed} postponed</p><button class="btn-primary" id="lp-new">New lesson plan</button></div>
      ${st.open ? `<section class="card card-p space-y-3"><div class="grid grid-2 lg-grid-4 gap-3">${picker(d, st, { term: true })}<div><label class="label">Date</label><input class="input" type="date" data-f="date" value="${st.date}" /></div></div>
        <div class="grid grid-2 gap-3"><div><label class="label">Topic</label><input class="input" data-f="topic" value="${escapeHtml(st.topic)}" /></div><div><label class="label">Subtopic</label><input class="input" data-f="subtopic" value="${escapeHtml(st.subtopic)}" /></div></div>
        ${[['objectives', 'Learning objectives'], ['activities', 'Learning activities'], ['resources', 'Teaching resources']].map(([k, l]) => `<div><label class="label">${l}</label><textarea class="input" rows="2" data-f="${k}">${escapeHtml(st[k])}</textarea></div>`).join('')}
        ${(() => { const outs = featureEnabled('competency_ratings') ? outcomesFor(d.learningOutcomes ?? [], { classId: st.classId, subjectId: st.subjectId }) : []; return outs.length ? `<fieldset style="border:1px solid var(--ink-100);border-radius:.6rem;padding:.5rem .75rem;"><legend class="text-sm" style="font-weight:600;">Learning outcomes this lesson covers</legend>${outs.map((o) => `<label class="text-sm" style="display:block;padding:.2rem 0;"><input type="checkbox" data-oc="${escapeHtml(o.id)}" ${st.outcomeIds.includes(o.id) ? 'checked' : ''} /> ${escapeHtml(o.description)}</label>`).join('')}</fieldset>` : ''; })()}
        ${d.frameworkFor(st.classId).map((f) => `<div><label class="label">${escapeHtml(f.label)}</label>${f.multiline ? `<textarea class="input" rows="2" data-x="${escapeHtml(f.key)}">${escapeHtml(st.extra[f.key] ?? '')}</textarea>` : `<input class="input" data-x="${escapeHtml(f.key)}" value="${escapeHtml(st.extra[f.key] ?? '')}" />`}</div>`).join('')}
        <button class="btn-primary" id="lp-save">Save lesson plan</button></section>` : ''}
      <div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Date</th><th>Class</th><th>Subject</th><th>Topic</th><th>Status</th><th></th></tr></thead><tbody>${plans.map((p) => `<tr><td>${escapeHtml(p.date)}</td><td>${escapeHtml(name(d, p.classId, 'classById'))}</td><td>${escapeHtml(name(d, p.subjectId, 'subjectById'))}</td><td><strong>${escapeHtml(p.topic)}</strong>${p.subtopic ? `<div class="text-xs text-ink-500">${escapeHtml(p.subtopic)}</div>` : ''}<div class="text-xs text-ink-500">${escapeHtml(p.objectives)}</div>${Object.entries(p.extra ?? {}).map(([k, v]) => `<div class="text-xs text-ink-500"><strong>${escapeHtml(d.frameworkFor(p.classId).find((f) => f.key === k)?.label ?? k)}:</strong> ${escapeHtml(v)}</div>`).join('')}</td><td>${badge(p.status === 'taught' ? 'good' : p.status === 'postponed' ? 'bad' : 'gold', T.LESSON_STATUS[p.status])}</td><td>${p.status !== 'taught' ? `<button class="btn-ghost btn-sm" data-ls="${p.id}:taught">Taught</button>` : ''}${p.status === 'planned' ? `<button class="btn-ghost btn-sm" data-ls="${p.id}:postponed">Postpone</button>` : ''}<button class="btn-ghost btn-sm" data-rm="${p.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="6" class="text-sm text-ink-500">No lesson plans yet.</td></tr>'}</tbody></table></div></div>`;
    qs(el, '#lp-new').addEventListener('click', () => { st.open = !st.open; paint(); });
    bindForm(el, st, paint);
    on(el, '[data-x]', 'input', (e) => { st.extra[e.currentTarget.dataset.x] = e.currentTarget.value; });
    on(el, '[data-oc]', 'change', (e) => { const id = e.currentTarget.dataset.oc; st.outcomeIds = e.currentTarget.checked ? [...new Set([...st.outcomeIds, id])] : st.outcomeIds.filter((x) => x !== id); });
    qs(el, '#lp-save')?.addEventListener('click', async () => { try { await S.saveLessonPlan({ classId: st.classId, subjectId: st.subjectId, termId: st.termId, date: st.date, topic: st.topic, subtopic: st.subtopic, objectives: st.objectives, activities: st.activities, resources: st.resources, status: 'planned', extra: st.extra, outcomeIds: st.outcomeIds.filter((id) => outcomesFor(d.learningOutcomes ?? [], { classId: st.classId, subjectId: st.subjectId }).some((o) => o.id === id)) }); await redo('Lesson plan saved.'); } catch (e) { await redo('', e.message); } });
    on(el, '[data-ls]', 'click', async (e) => { const [id, s] = e.currentTarget.dataset.ls.split(':'); const p = plans.find((x) => x.id === id); try { await S.saveRecord('lessonPlans', { ...p, status: s }, 'updated lesson status'); await redo(`Marked ${s}.`); } catch (x) { await redo('', x.message); } });
    on(el, '[data-rm]', 'click', async (e) => { if (confirm('Delete this lesson plan?')) { await S.removeRecord('lessonPlans', e.currentTarget.dataset.rm); await redo('Deleted.'); } });
  }
  paint();
}

// ---------------------------------------------------------------- schemes of work
async function schemes(el, d, redo) {
  const st = { open: false, classId: d.myClasses[0]?.id ?? '', subjectId: '', termId: d.currentTerm?.id ?? '', title: '', lines: '' };
  const list = d.mine(d.schemesOfWork);
  function paint() {
    el.innerHTML = `<div class="space-y-4"><div class="flex justify-between"><p class="text-sm text-ink-600">Term plans: one row per week, tick each week as it is completed.</p><button class="btn-primary" id="sw-new">New scheme of work</button></div>
      ${st.open ? `<section class="card card-p space-y-3"><div class="grid grid-2 lg-grid-4 gap-3">${picker(d, st, { term: true })}<div><label class="label">Title</label><input class="input" data-f="title" value="${escapeHtml(st.title)}" placeholder="e.g. Term 1 Mathematics" /></div></div>
        <div><label class="label">Weeks — one per line: topic | objective | activities</label><textarea class="input" rows="6" data-f="lines" placeholder="Fractions | Add and subtract fractions | Group work with fraction strips">${escapeHtml(st.lines)}</textarea></div><button class="btn-primary" id="sw-save">Save scheme</button></section>` : ''}
      ${list.map((s) => { const pr = T.schemeProgress(s.weeks); return `<section class="card card-p space-y-2"><div class="flex flex-wrap justify-between gap-2"><strong>${escapeHtml(s.title)}</strong><span class="text-sm text-ink-500">${escapeHtml(name(d, s.classId, 'classById'))} · ${escapeHtml(name(d, s.subjectId, 'subjectById'))} · ${pr.done}/${pr.total} weeks (${pr.pct}%)</span></div><div style="background:var(--ink-100);border-radius:99px;height:.5rem;"><div style="width:${pr.pct}%;background:var(--brand-700);height:100%;border-radius:99px;"></div></div>
        ${s.weeks.map((w, i) => `<label class="text-sm" style="display:block;"><input type="checkbox" data-wk="${s.id}:${i}" ${w.status === 'done' ? 'checked' : ''} /> Week ${w.week}: <strong>${escapeHtml(w.topic)}</strong> <span class="text-ink-500">${escapeHtml(w.objectives)}${w.activities ? ` · ${escapeHtml(w.activities)}` : ''}</span></label>`).join('')}<button class="btn-ghost btn-sm" data-rm="${s.id}">Delete scheme</button></section>`; }).join('') || '<p class="text-sm text-ink-500">No schemes of work yet.</p>'}</div>`;
    qs(el, '#sw-new').addEventListener('click', () => { st.open = !st.open; paint(); });
    bindForm(el, st, paint);
    qs(el, '#sw-save')?.addEventListener('click', async () => {
      const weeks = st.lines.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l, i) => { const [topic, objectives, activities] = l.split('|').map((x) => x.trim()); return { week: i + 1, topic, objectives: objectives ?? '', activities: activities ?? '', status: 'planned' }; });
      try { if (!st.classId || !st.subjectId) throw new Error('Choose a class and subject.'); if (!st.title.trim()) throw new Error('Enter a title.'); if (!weeks.length) throw new Error('Add at least one week.'); await S.saveRecord('schemesOfWork', { classId: st.classId, subjectId: st.subjectId, termId: st.termId, title: st.title.trim(), weeks }, 'saved scheme of work'); await redo('Scheme saved.'); } catch (e) { await redo('', e.message); }
    });
    on(el, '[data-wk]', 'change', async (e) => { const [id, i] = e.currentTarget.dataset.wk.split(':'); const s = list.find((x) => x.id === id); const weeks = s.weeks.map((w, k) => (k === Number(i) ? { ...w, status: e.currentTarget.checked ? 'done' : 'planned' } : w)); await S.saveRecord('schemesOfWork', { ...s, weeks }, 'updated scheme progress'); await redo('Progress updated.'); });
    on(el, '[data-rm]', 'click', async (e) => { if (confirm('Delete this scheme of work?')) { await S.removeRecord('schemesOfWork', e.currentTarget.dataset.rm); await redo('Deleted.'); } });
  }
  paint();
}

// ---------------------------------------------------------------- homework
async function homework(el, d, redo) {
  const st = { open: false, view: '', editingId: '', classId: d.myClasses[0]?.id ?? '', subjectId: '', title: '', instructions: '', dueDate: today(), maxMarks: '', links: '' };
  const hws = d.mine(d.homework).sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  function paint() {
    const hw = hws.find((h) => h.id === st.view);
    if (hw) return detail(hw);
    el.innerHTML = `<div class="space-y-4"><div class="flex justify-end"><button class="btn-primary" id="hw-new">New homework</button></div>
      ${st.open ? `<section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">${st.editingId ? 'Edit homework' : 'New homework'}</h3><div class="grid grid-2 lg-grid-4 gap-3">${picker(d, st)}<div><label class="label">Due date</label><input class="input" type="date" data-f="dueDate" value="${st.dueDate}" /></div><div><label class="label">Max marks (optional)</label><input class="input" type="number" min="1" data-f="maxMarks" value="${escapeHtml(st.maxMarks)}" /></div></div>
        <div><label class="label">Title</label><input class="input" data-f="title" value="${escapeHtml(st.title)}" /></div><div><label class="label">Instructions</label><textarea class="input" rows="3" data-f="instructions">${escapeHtml(st.instructions)}</textarea></div>
        <div><label class="label">Attachment links (one per line, http/https)</label><textarea class="input" rows="2" data-f="links">${escapeHtml(st.links)}</textarea></div><div class="flex gap-2"><button class="btn-secondary" id="hw-cancel">Cancel</button><button class="btn-primary" id="hw-save">${st.editingId ? 'Save changes' : 'Publish homework'}</button></div></section>` : ''}
      <div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Title</th><th>Class</th><th>Due</th><th>Submitted</th><th>To mark</th><th>Marked</th><th>Missing</th><th></th></tr></thead><tbody>${hws.map((h) => { const f = T.homeworkFigures(h, d.students, d.homeworkSubmissions, today()); return `<tr><td><strong>${escapeHtml(h.title)}</strong><div class="text-xs text-ink-500">${escapeHtml(name(d, h.subjectId, 'subjectById'))}</div></td><td>${escapeHtml(name(d, h.classId, 'classById'))}</td><td>${escapeHtml(h.dueDate)}</td><td>${f.submitted + f.marked}/${f.total}</td><td>${f.toMark}</td><td>${f.marked}</td><td>${f.missing}</td><td><button class="btn-secondary btn-sm" data-open="${h.id}">Open</button> <button class="btn-ghost btn-sm" data-edit-hw="${h.id}">Edit</button> <button class="btn-ghost btn-sm" data-delete-hw="${h.id}">Delete</button></td></tr>`; }).join('') || '<tr><td colspan="8" class="text-sm text-ink-500">No homework yet.</td></tr>'}</tbody></table></div></div>`;
    qs(el, '#hw-new').addEventListener('click', () => { st.open = !st.open; st.editingId = ''; paint(); });
    qs(el, '#hw-cancel')?.addEventListener('click', () => { st.open = false; st.editingId = ''; paint(); });
    bindForm(el, st, paint);
    on(el, '[data-open]', 'click', (e) => { st.view = e.currentTarget.dataset.open; paint(); });
    on(el, '[data-edit-hw]', 'click', (e) => {
      const h = hws.find((item) => item.id === e.currentTarget.dataset.editHw);
      if (!h) return;
      Object.assign(st, { open: true, editingId: h.id, classId: h.classId, subjectId: h.subjectId, title: h.title, instructions: h.instructions ?? '', dueDate: h.dueDate, maxMarks: h.maxMarks ?? '', links: (h.links ?? []).join('\n'), view: '' });
      paint();
    });
    on(el, '[data-delete-hw]', 'click', async (e) => {
      const h = hws.find((item) => item.id === e.currentTarget.dataset.deleteHw);
      if (!h || !globalThis.confirm?.(`Delete "${h.title}"? Assignments with submissions cannot be deleted.`)) return;
      try { await S.deleteHomework(h.id); await redo('Homework deleted.'); } catch (error) { await redo('', error.message); }
    });
    qs(el, '#hw-save')?.addEventListener('click', async () => { const links = st.links.split(/\r?\n/).map((x) => x.trim()).filter(Boolean); try { if (links.some((l) => !/^https?:\/\//i.test(l))) throw new Error('Attachment links must start with http:// or https://'); await S.saveHomework({ id: st.editingId || undefined, classId: st.classId, subjectId: st.subjectId, title: st.title, instructions: st.instructions, dueDate: st.dueDate, maxMarks: st.maxMarks, links }); await redo(st.editingId ? 'Homework updated; linked submissions were kept.' : 'Homework published.'); } catch (e) { await redo('', e.message); } });
  }
  function detail(h) {
    const f = T.homeworkFigures(h, d.students, d.homeworkSubmissions, today());
    const STATE = { pending: ['muted', 'Not yet due'], missing: ['bad', 'Missing'], submitted: ['gold', 'Submitted'], late: ['gold', 'Late'], marked: ['good', 'Marked'] };
    el.innerHTML = `<div class="space-y-4"><button class="btn-ghost" id="hw-back">← All homework</button><div><h3 class="text-lg" style="font-weight:600;">${escapeHtml(h.title)}</h3><p class="text-sm text-ink-600">${escapeHtml(name(d, h.classId, 'classById'))} · ${escapeHtml(name(d, h.subjectId, 'subjectById'))} · due ${escapeHtml(h.dueDate)}${h.maxMarks ? ` · out of ${h.maxMarks}` : ''}</p><p class="text-sm" style="white-space:pre-wrap;">${escapeHtml(h.instructions ?? '')}</p>${(h.links ?? []).map((l) => `<a class="text-sm" href="${escapeHtml(l)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l)}</a>`).join('<br>')}</div>
      <p class="text-sm text-ink-600">${f.submitted + f.marked} of ${f.total} handed in · ${f.toMark} waiting to be marked · ${f.missing} missing</p>
      <div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Student</th><th>Status</th><th>Marks</th><th>Feedback</th><th></th></tr></thead><tbody>${f.rows.map((r) => { const s = r.submission ?? {}; return `<tr data-row="${r.student.id}"><td>${escapeHtml(fullName(r.student))}${r.submission?.text || r.submission?.attachment ? `<details style="margin-top:.25rem;"><summary class="text-xs" style="cursor:pointer;">Learner's answer${r.submission?.attachment ? ' + file' : ''}</summary><p class="text-sm" style="white-space:pre-wrap;max-width:28rem;">${escapeHtml(r.submission?.text ?? '')}</p>${r.submission?.attachment ? `<a class="text-sm" download="${escapeHtml(r.submission?.attachment.name)}" href="${escapeHtml(r.submission?.attachment.dataUrl)}">Download ${escapeHtml(r.submission?.attachment.name)}</a>` : ''}${r.submission?.handedInBy === 'learner' ? `<p class="text-xs text-ink-400">Handed in by the learner${r.submission?.lastEditedAt ? ` · last changed ${escapeHtml(String(r.submission?.lastEditedAt).slice(0, 16).replace('T', ' '))}` : ''}</p>` : ''}</details>` : ''}</td><td>${badge(...STATE[r.state])}<select class="input" data-st style="max-width:9rem;margin-top:.25rem;"><option value="pending" ${r.state === 'pending' || r.state === 'missing' ? 'selected' : ''}>Not handed in</option><option value="submitted" ${r.state === 'submitted' || r.state === 'late' ? 'selected' : ''}>Handed in</option><option value="marked" ${r.state === 'marked' ? 'selected' : ''}>Marked</option></select></td><td><input class="input" type="number" min="0" data-mk value="${s.marks ?? ''}" style="max-width:6rem;" /></td><td><input class="input" data-fb value="${escapeHtml(s.feedback ?? '')}" /></td><td><button class="btn-primary btn-sm" data-sv>Save</button>${s.id && s.feedback ? `<label class="text-xs" style="display:block;"><input type="checkbox" data-pub="${s.id}" ${s.feedbackPublished ? 'checked' : ''} /> Share with parent</label>` : ''}</td></tr>`; }).join('')}</tbody></table></div></div>`;
    qs(el, '#hw-back').addEventListener('click', () => { st.view = ''; paint(); });
    on(el, '[data-sv]', 'click', async (e) => { const row = e.currentTarget.closest('[data-row]'); try { await S.saveSubmission({ homework: h, studentId: row.dataset.row, status: qs(row, '[data-st]').value, marks: qs(row, '[data-mk]').value, feedback: qs(row, '[data-fb]').value }); st.view = h.id; await redo('Saved.'); } catch (x) { await redo('', x.message); } });
    on(el, '[data-pub]', 'change', async (e) => { await S.publishFeedback(e.currentTarget.dataset.pub, e.currentTarget.checked); });
  }
  paint();
}

// ---------------------------------------------------------------- eLearning
async function elearning(el, d, redo) {
  const st = { open: false, classId: d.myClasses[0]?.id ?? '', subjectId: '', title: '', type: 'note', body: '', url: '' };
  const items = d.mine(d.learningMaterials);
  const materials = items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const all = materials;
  function paint() {
    el.innerHTML = `<div class="space-y-4"><div class="flex justify-between flex-wrap gap-2"><p class="text-sm text-ink-600">Publish notes and links for a class. Quizzes are not available yet.</p><button class="btn-primary" id="el-new">New material</button></div>
      ${st.open ? `<section class="card card-p space-y-3"><div class="grid grid-2 lg-grid-4 gap-3">${picker(d, st)}<div><label class="label">Type</label><select class="input" data-f="type"><option value="note" ${st.type === 'note' ? 'selected' : ''}>Notes</option><option value="link" ${st.type === 'link' ? 'selected' : ''}>Link (document, video, site)</option></select></div></div>
        <div><label class="label">Title</label><input class="input" data-f="title" value="${escapeHtml(st.title)}" /></div>${st.type === 'link' ? `<div><label class="label">Link</label><input class="input" data-f="url" value="${escapeHtml(st.url)}" placeholder="https://" /></div>` : `<div><label class="label">Notes</label><textarea class="input" rows="5" data-f="body">${escapeHtml(st.body)}</textarea></div>`}
        <button class="btn-primary" id="el-save">Publish to class</button></section>` : ''}
      <div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Title</th><th>Class</th><th>Subject</th><th>Type</th><th>Visible to parents</th><th></th></tr></thead><tbody>${all.map((m) => `<tr><td>${m.url ? `<a href="${escapeHtml(m.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(m.title)}</a>` : escapeHtml(m.title)}</td><td>${escapeHtml(name(d, m.classId, 'classById'))}</td><td>${escapeHtml(name(d, m.subjectId, 'subjectById'))}</td><td>${escapeHtml(m.type)}</td><td><input type="checkbox" data-pub="${m.id}" ${m.published ? 'checked' : ''} /></td><td><button class="btn-ghost btn-sm" data-rm="${m.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="6" class="text-sm text-ink-500">Nothing published yet.</td></tr>'}</tbody></table></div></div>`;
    qs(el, '#el-new').addEventListener('click', () => { st.open = !st.open; paint(); });
    bindForm(el, st, paint);
    on(el, '[data-f="type"]', 'change', paint);
    qs(el, '#el-save')?.addEventListener('click', async () => { try { await S.saveMaterial({ classId: st.classId, subjectId: st.subjectId, title: st.title, type: st.type, body: st.body, url: st.url }); await redo('Published.'); } catch (e) { await redo('', e.message); } });
    on(el, '[data-pub]', 'change', async (e) => { const m = all.find((x) => x.id === e.currentTarget.dataset.pub); await S.saveRecord('learningMaterials', { ...m, published: e.currentTarget.checked }, 'changed material visibility'); });
    on(el, '[data-rm]', 'click', async (e) => { if (confirm('Delete this material?')) { await S.removeRecord('learningMaterials', e.currentTarget.dataset.rm); await redo('Deleted.'); } });
  }
  paint();
}

// ---------------------------------------------------------------- live lessons
async function live(el, d, redo) {
  const st = { open: false, classId: d.myClasses[0]?.id ?? '', subjectId: '', title: '', date: today(), startTime: '09:00', endTime: '', meetingLink: '', notes: '' };
  const lessons = d.mine(d.liveLessons).sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  function paint() {
    el.innerHTML = `<div class="space-y-4"><div class="notice"><span>This schedules the lesson and shares your meeting link (Google Meet, Zoom, Teams…). SwiftIQ EduFlow does not host video itself.</span></div><div class="flex justify-end"><button class="btn-primary" id="ll-new">Schedule live lesson</button></div>
      ${st.open ? `<section class="card card-p space-y-3"><div class="grid grid-2 lg-grid-4 gap-3">${picker(d, st)}<div><label class="label">Date</label><input class="input" type="date" data-f="date" value="${st.date}" /></div><div><label class="label">Start</label><input class="input" type="time" data-f="startTime" value="${st.startTime}" /></div><div><label class="label">End</label><input class="input" type="time" data-f="endTime" value="${st.endTime}" /></div></div>
        <div class="grid grid-2 gap-3"><div><label class="label">Title</label><input class="input" data-f="title" value="${escapeHtml(st.title)}" /></div><div><label class="label">Meeting link</label><input class="input" data-f="meetingLink" value="${escapeHtml(st.meetingLink)}" placeholder="https://" /></div></div><button class="btn-primary" id="ll-save">Schedule</button></section>` : ''}
      <div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>When</th><th>Lesson</th><th>Class</th><th>Status</th><th></th></tr></thead><tbody>${lessons.map((l) => `<tr><td>${escapeHtml(l.date)} ${escapeHtml(l.startTime)}${l.endTime ? `–${escapeHtml(l.endTime)}` : ''}</td><td>${escapeHtml(l.title)}<div class="text-xs text-ink-500">${escapeHtml(name(d, l.subjectId, 'subjectById'))}</div></td><td>${escapeHtml(name(d, l.classId, 'classById'))}</td><td>${badge(l.status === 'scheduled' ? 'gold' : 'muted', l.status)}</td><td>${l.meetingLink ? `<a class="btn-secondary btn-sm" href="${escapeHtml(l.meetingLink)}" target="_blank" rel="noopener noreferrer">Join</a>` : '<span class="text-xs text-ink-400">No link</span>'} ${l.status === 'scheduled' ? `<button class="btn-ghost btn-sm" data-cx="${l.id}">Cancel</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="text-sm text-ink-500">No live lessons scheduled.</td></tr>'}</tbody></table></div></div>`;
    qs(el, '#ll-new').addEventListener('click', () => { st.open = !st.open; paint(); });
    bindForm(el, st, paint);
    qs(el, '#ll-save')?.addEventListener('click', async () => { try { await S.saveLiveLesson({ classId: st.classId, subjectId: st.subjectId, title: st.title, date: st.date, startTime: st.startTime, endTime: st.endTime, meetingLink: st.meetingLink }); await redo('Live lesson scheduled.'); } catch (e) { await redo('', e.message); } });
    on(el, '[data-cx]', 'click', async (e) => { const l = lessons.find((x) => x.id === e.currentTarget.dataset.cx); await S.saveRecord('liveLessons', { ...l, status: 'cancelled' }, 'cancelled live lesson'); await redo('Cancelled.'); });
  }
  paint();
}

// ---------------------------------------------------------------- student welfare (explicit permission)
async function welfare(el, d, redo) {
  if (!S.hasWelfareAccess()) { el.innerHTML = errBox('You do not have permission to use student welfare records.'); return; }
  const st = { open: false, editingId: '', studentId: '', category: 'other', observation: '', followUp: '', followUpDate: '' };
  const notes = (await S.listWelfare()).filter((n) => d.scope.unrestricted || d.scope.classIds.has(d.studentById[n.studentId]?.classId)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const team = isAdmin() ? await S.listTeamForGrants() : [];
  function paint() {
    const welfareStudents = st.studentId && !d.myStudents.some((s) => s.id === st.studentId) && d.studentById[st.studentId]
      ? [d.studentById[st.studentId], ...d.myStudents]
      : d.myStudents;
    el.innerHTML = `<div class="space-y-4"><div class="notice"><span>Confidential. Only the administrator and teachers they have named can open these notes.</span></div>
      <div class="flex justify-end"><button class="btn-primary" id="wf-new">New welfare note</button></div>
      ${st.open ? `<section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">${st.editingId ? 'Edit welfare note' : 'New welfare note'}</h3><div class="grid grid-2 gap-3"><div><label class="label">Student</label><select class="input" data-f="studentId"><option value="">Choose…</option>${welfareStudents.map((s) => `<option value="${s.id}" ${st.studentId === s.id ? 'selected' : ''}>${escapeHtml(fullName(s))}</option>`).join('')}</select></div><div><label class="label">Category</label><select class="input" data-f="category">${T.WELFARE_CATEGORIES.map((c) => `<option ${st.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div></div>
        <div><label class="label">Observation</label><textarea class="input" rows="3" data-f="observation">${escapeHtml(st.observation)}</textarea></div><div class="grid grid-2 gap-3"><div><label class="label">Follow-up action</label><input class="input" data-f="followUp" value="${escapeHtml(st.followUp)}" /></div><div><label class="label">Follow up by</label><input class="input" type="date" data-f="followUpDate" value="${st.followUpDate}" /></div></div>
        <div class="flex gap-2"><button class="btn-secondary" id="wf-cancel">Cancel</button><button class="btn-primary" id="wf-save">${st.editingId ? 'Save changes' : 'Save note'}</button></div></section>` : ''}
      <div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Date</th><th>Student</th><th>Category</th><th>Observation</th><th>Follow-up</th><th>Status</th><th></th></tr></thead><tbody>${notes.map((n) => `<tr><td>${escapeHtml(String(n.createdAt).slice(0, 10))}</td><td>${escapeHtml(d.studentById[n.studentId] ? fullName(d.studentById[n.studentId]) : '')}</td><td>${escapeHtml(n.category)}</td><td class="text-sm">${escapeHtml(n.observation)}<div class="text-xs text-ink-400">by ${escapeHtml(n.authorName ?? '')}</div></td><td class="text-sm">${escapeHtml(n.followUp ?? '')}${n.followUpDate ? ` (by ${escapeHtml(n.followUpDate)})` : ''}</td><td>${badge(n.status === 'open' ? 'gold' : 'good', n.status)}</td><td><div class="flex gap-1"><button class="btn-ghost btn-sm" data-edit-welfare="${n.id}">Edit</button>${n.status === 'open' ? `<button class="btn-ghost btn-sm" data-close="${n.id}">Close</button>` : ''}<button class="btn-ghost btn-sm" data-delete-welfare="${n.id}">Delete</button></div></td></tr>`).join('') || '<tr><td colspan="7" class="text-sm text-ink-500">No notes.</td></tr>'}</tbody></table></div>
      ${isAdmin() ? `<section class="card card-p space-y-2" id="grants"><h3 class="text-sm" style="font-weight:600;">Who may use welfare records</h3><p class="text-xs text-ink-500">Tick a teacher to give them access. Without a tick they cannot open or add welfare notes.</p>${team.map((m) => `<label class="text-sm" style="display:block;"><input type="checkbox" data-grant="${m.id}" data-name="${escapeHtml(m.name)}" /> ${escapeHtml(m.name || m.email)}</label>`).join('') || '<p class="text-sm text-ink-500">No teacher accounts yet.</p>'}</section>` : ''}</div>`;
    qs(el, '#wf-new').addEventListener('click', () => { st.open = !st.open; st.editingId = ''; paint(); });
    qs(el, '#wf-cancel')?.addEventListener('click', () => { Object.assign(st, { open: false, editingId: '', studentId: '', category: 'other', observation: '', followUp: '', followUpDate: '' }); paint(); });
    bindForm(el, st, paint);
    qs(el, '#wf-save')?.addEventListener('click', async () => { try { await S.saveWelfare({ ...st, open: undefined, id: st.editingId || undefined }); await redo(st.editingId ? 'Note updated.' : 'Note saved.'); } catch (e) { await redo('', e.message); } });
    on(el, '[data-edit-welfare]', 'click', (e) => { const n = notes.find((x) => x.id === e.currentTarget.dataset.editWelfare); if (!n) return; Object.assign(st, { open: true, editingId: n.id, studentId: n.studentId, category: n.category, observation: n.observation, followUp: n.followUp ?? '', followUpDate: n.followUpDate ?? '' }); paint(); });
    on(el, '[data-close]', 'click', async (e) => { const n = notes.find((x) => x.id === e.currentTarget.dataset.close); if (!n || !globalThis.confirm?.(`Close this confidential welfare note for ${d.studentById[n.studentId] ? fullName(d.studentById[n.studentId]) : 'the learner'}?`)) return; try { await S.saveWelfare({ ...n, status: 'closed' }); await redo('Note closed.'); } catch (error) { await redo('', error.message); } });
    on(el, '[data-delete-welfare]', 'click', async (e) => { const n = notes.find((x) => x.id === e.currentTarget.dataset.deleteWelfare); if (!n || !globalThis.confirm?.('Permanently delete this confidential welfare note? This action is recorded in the audit log and cannot be undone.')) return; try { await S.deleteWelfare(n.id); await redo('Note deleted.'); } catch (error) { await redo('', error.message); } });
    if (isAdmin()) {
      el.querySelectorAll('[data-grant]').forEach(async (box) => { box.checked = await S.hasGrant(box.dataset.grant); });
      on(el, '[data-grant]', 'change', async (e) => { await S.setWelfareGrant(e.currentTarget.dataset.grant, e.currentTarget.dataset.name, e.currentTarget.checked); });
    }
  }
  paint();
}

// ---------------------------------------------------------------- academic reports
async function areports(el, d) {
  const st = { classId: d.myClasses[0]?.id ?? '', studentId: '' };
  function paint() {
    const as = d.assessments.filter((a) => a.classId === st.classId).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const students = d.myStudents.filter((s) => s.classId === st.classId);
    const results = as.map((a) => ({ a, r: T.assessmentResults(a, d.assessmentScores, students) }));
    const prog = st.studentId ? T.studentProgress(st.studentId, as, d.assessmentScores) : null;
    el.innerHTML = `<div class="space-y-4"><div class="flex flex-wrap gap-2"><select class="input" data-f="classId" style="max-width:12rem;">${opt(d.myClasses, st.classId)}</select><select class="input" id="ar-st" style="max-width:16rem;"><option value="">Student progress…</option>${students.map((s) => `<option value="${s.id}" ${st.studentId === s.id ? 'selected' : ''}>${escapeHtml(fullName(s))}</option>`).join('')}</select><button class="btn-secondary" id="ar-print">Print</button></div>
      <div id="ar-area" class="space-y-4"><div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Class results</h3><table class="data-table"><thead><tr><th>Assessment</th><th>Date</th><th class="text-right">Average</th><th class="text-right">Entered</th><th class="text-right">Missing</th></tr></thead><tbody>${results.map(({ a, r }) => `<tr><td>${escapeHtml(a.name)}</td><td>${escapeHtml(a.date ?? '')}</td><td class="text-right">${r.average == null ? '—' : `${r.average}%`}</td><td class="text-right">${r.entered}</td><td class="text-right">${r.missing}</td></tr>`).join('') || '<tr><td colspan="5" class="text-sm text-ink-500">No assessments for this class yet.</td></tr>'}</tbody></table></div>
      ${prog ? `<div class="card card-p"><h3 class="text-sm mb-2" style="font-weight:600;">Progress — ${escapeHtml(fullName(d.studentById[st.studentId]))}</h3><p class="text-sm">Average ${prog.average ?? '—'}% · trend: <strong>${prog.trend}</strong></p><table class="data-table"><tbody>${prog.points.map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.date)}</td><td class="text-right">${p.pct}%</td></tr>`).join('')}</tbody></table></div>` : ''}</div></div>`;
    on(el, '[data-f="classId"]', 'change', (e) => { st.classId = e.currentTarget.value; st.studentId = ''; paint(); });
    qs(el, '#ar-st').addEventListener('change', (e) => { st.studentId = e.target.value; paint(); });
    qs(el, '#ar-print').addEventListener('click', async () => (await import('../../components/printWindow.js')).printHtml('Academic report', qs(el, '#ar-area').innerHTML));
  }
  paint();
}

// ---------------------------------------------------------------- class allocation (administrator)
async function allocation(el, d, redo) {
  const subjectsAll = d.subjects;
  const rows = d.teachingAssignments;
  const teachers = d.teachers.filter((t) => t.category === 'teaching' || t.category === undefined || t.isActive !== false);
  el.innerHTML = `<div class="space-y-4"><div class="notice"><span>A teacher's login is linked to their staff record by <strong>email address</strong>. Allocations here, plus the timetable, decide which classes they see.</span></div>
    <section class="card card-p space-y-3"><div class="grid grid-2 lg-grid-4 gap-3"><div><label class="label">Teacher</label><select class="input" id="al-t">${teachers.map((t) => `<option value="${t.id}">${escapeHtml(`${t.firstName} ${t.lastName}`)}${t.email ? '' : ' (no email)'}</option>`).join('')}</select></div><div><label class="label">Class</label><select class="input" id="al-c">${opt(d.classes, '')}</select></div><div><label class="label">Subject (optional)</label><select class="input" id="al-s"><option value="">All subjects</option>${opt(subjectsAll, '')}</select></div><div style="align-self:end;"><label class="text-sm" style="display:block;"><input type="checkbox" id="al-ct" /> Class teacher</label><button class="btn-primary" id="al-add">Allocate</button></div></div></section>
    <div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Teacher</th><th>Class</th><th>Subject</th><th>Class teacher</th><th></th></tr></thead><tbody>${rows.map((a) => { const t = d.teachers.find((x) => x.id === a.teacherId); return `<tr><td>${escapeHtml(t ? `${t.firstName} ${t.lastName}` : '—')}</td><td>${escapeHtml(name(d, a.classId, 'classById'))}</td><td>${escapeHtml(a.subjectId ? name(d, a.subjectId, 'subjectById') : 'All')}</td><td><label class="text-sm"><input type="checkbox" data-ct="${a.id}" ${a.classTeacher ? 'checked' : ''} /> ${a.classTeacher ? 'Yes' : ''}</label></td><td><button class="btn-ghost btn-sm" data-rm="${a.id}">Remove</button></td></tr>`; }).join('') || '<tr><td colspan="4" class="text-sm text-ink-500">No allocations yet.</td></tr>'}</tbody></table></div></div>`;
  qs(el, '#al-add').addEventListener('click', async () => { if (!qs(el, '#al-t').value || !qs(el, '#al-c').value) return redo('', 'Choose a teacher and a class.'); await S.allocate(qs(el, '#al-t').value, qs(el, '#al-c').value, qs(el, '#al-s').value, { classTeacher: qs(el, '#al-ct').checked }); await redo('Allocated.'); });
  on(el, '[data-ct]', 'change', async (e) => { try { await S.setClassTeacher(e.currentTarget.dataset.ct, e.currentTarget.checked); await redo(e.currentTarget.checked ? 'Class teacher set. Any previous class teacher for that class was replaced.' : 'Class teacher removed.'); } catch (x) { await redo('', x.message); } });
  on(el, '[data-rm]', 'click', async (e) => { await S.deallocate(e.currentTarget.dataset.rm); await redo('Removed.'); });
}
