// Clubs, sports and societies (demo mode). A list of activities; open one to manage members, record sessions and log achievements.
import { escapeHtml, on, qs } from '../../components/dom.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { canWriteModule } from '../../services/accessService.js';
import { studentRepo, fullName } from '../../services/studentService.js';
import { teacherRepo, teacherFullName } from '../../services/peopleService.js';
import { classRepo } from '../../services/academicService.js';
import * as S from '../../services/activitiesService.js';
import { CATEGORIES, DAYS, LEVELS } from '../../services/activitiesLogic.js';

const label = (list, key) => list.find(([k]) => k === key)?.[1] ?? '';
const when = (a) => (a.meetingDay ? `${a.meetingDay}${a.startTime ? ` ${a.startTime}${a.endTime ? `–${a.endTime}` : ''}` : ''}` : 'No fixed time');
const opts = (list, cur, blank) => `${blank ? `<option value="">${blank}</option>` : ''}${list.map(([k, v]) => `<option value="${escapeHtml(k)}" ${k === cur ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('')}`;

export function renderActivities(container) {
  if (isSupabaseConfigured()) { container.innerHTML = '<div class="notice" role="status"><span>Activities runs in demo mode for now. The cloud version arrives with the backend phase.</span></div>'; return; }
  const write = canWriteModule('activities');
  const st = { view: 'list', id: null, tab: 'members', form: false, errors: [], warn: [], msg: '', showArchived: false, edit: false, fd: null };

  const draw = () => (st.view === 'list' ? drawList() : drawDetail());
  const errs = () => `${st.errors.map((e) => `<p class="field-error" role="alert">${escapeHtml(e)}</p>`).join('')}${st.warn.map((w) => `<p class="text-xs text-warn">⚠ ${escapeHtml(w)}</p>`).join('')}${st.msg ? `<div class="notice" role="status"><span>${escapeHtml(st.msg)}</span></div>` : ''}`;
  const clear = () => { st.errors = []; st.warn = []; st.msg = ''; };

  function formHtml(a0 = {}) {
    const a = st.fd ? { ...a0, ...st.fd } : a0;
    const teachers = teacherRepo.getAll().filter((t) => t.isActive);
    return `<section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">${a.id ? 'Edit activity' : 'New activity'}</h3>${errs()}
      <div class="grid grid-2 gap-3">
        <div><label class="label">Name</label><input class="input" id="f-name" value="${escapeHtml(a.name ?? '')}" /></div>
        <div><label class="label">Category</label><select class="input" id="f-cat">${opts(CATEGORIES, a.category ?? 'club')}</select></div>
        <div><label class="label">Coordinator</label><select class="input" id="f-coord"><option value="">None yet</option>${teachers.map((t) => `<option value="${t.id}" ${t.id === a.coordinatorId ? 'selected' : ''}>${escapeHtml(teacherFullName(t))}</option>`).join('')}</select></div>
        <div><label class="label">Capacity (empty = no limit)</label><input class="input" id="f-cap" inputmode="numeric" value="${escapeHtml(a.capacity ?? '')}" /></div>
        <div><label class="label">Meets on</label><select class="input" id="f-day">${opts(DAYS.map((d) => [d, d]), a.meetingDay, 'No fixed day')}</select></div>
        <div><label class="label">Venue</label><input class="input" id="f-venue" value="${escapeHtml(a.venue ?? '')}" /></div>
        <div><label class="label">From</label><input class="input" id="f-start" type="time" value="${escapeHtml(a.startTime ?? '')}" /></div>
        <div><label class="label">To</label><input class="input" id="f-end" type="time" value="${escapeHtml(a.endTime ?? '')}" /></div></div>
      <div class="flex gap-2"><button class="btn-primary btn-sm" id="f-save">Save</button><button class="btn-secondary btn-sm" id="f-cancel">Cancel</button></div></section>`;
  }
  const readForm = () => ({ name: qs(container, '#f-name').value, category: qs(container, '#f-cat').value, coordinatorId: qs(container, '#f-coord').value, capacity: qs(container, '#f-cap').value.trim(), meetingDay: qs(container, '#f-day').value, venue: qs(container, '#f-venue').value, startTime: qs(container, '#f-start').value, endTime: qs(container, '#f-end').value });
  function wireForm(id) {
    qs(container, '#f-cancel').addEventListener('click', () => { clear(); st.form = false; st.edit = false; st.fd = null; draw(); });
    qs(container, '#f-save').addEventListener('click', () => { st.fd = readForm(); const r = S.saveActivity(st.fd, id); if (!r.ok) { st.errors = r.errors; return draw(); } clear(); st.form = false; st.edit = false; st.fd = null; if (!id) { st.view = 'detail'; st.id = r.activity.id; st.tab = 'members'; } draw(); });
  }

  function drawList() {
    const all = S.activityRepo.getAll(); const shown = all.filter((a) => st.showArchived || a.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name));
    const p = S.participationNow(); const teachers = Object.fromEntries(teacherRepo.getAll().map((t) => [t.id, teacherFullName(t)]));
    container.innerHTML = `<div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2"><div><h1 class="text-2xl" style="font-weight:600;">Activities</h1><p class="text-sm text-ink-500">${p.total ? `${p.taking} of ${p.total} learners (${p.pct}%) take part in at least one activity.` : 'Clubs, sports and societies.'}</p></div>${write ? '<button class="btn-primary" id="new-act">+ New activity</button>' : ''}</div>
      ${st.form ? formHtml() : errs()}
      ${all.some((a) => a.status === 'archived') ? `<label class="text-sm"><input type="checkbox" id="show-arch" ${st.showArchived ? 'checked' : ''}/> Show archived</label>` : ''}
      ${shown.length ? `<div class="grid grid-2 gap-3">${shown.map((a) => `<button class="card card-p" data-open="${a.id}" style="text-align:left;cursor:pointer;${a.status === 'archived' ? 'opacity:.6;' : ''}"><p class="text-sm" style="font-weight:600;">${escapeHtml(a.name)}${a.status === 'archived' ? ' (archived)' : ''}</p><p class="text-xs text-ink-500">${escapeHtml(label(CATEGORIES, a.category))} · ${escapeHtml(when(a))}</p><p class="text-xs text-ink-400 mt-1">${S.membersOf(a.id).length}${a.capacity ? ` / ${a.capacity}` : ''} members${a.coordinatorId && teachers[a.coordinatorId] ? ` · ${escapeHtml(teachers[a.coordinatorId])}` : ''}</p></button>`).join('')}</div>` : `<div class="card card-p"><p class="text-sm text-ink-500">${write ? 'No activities yet. Add the first club, sport or society.' : 'No activities have been set up yet.'}</p></div>`}</div>`;
    qs(container, '#new-act')?.addEventListener('click', () => { clear(); st.fd = null; st.form = true; draw(); });
    qs(container, '#show-arch')?.addEventListener('change', (e) => { st.showArchived = e.target.checked; draw(); });
    if (st.form) wireForm();
    on(container, '[data-open]', 'click', (e) => { clear(); st.view = 'detail'; st.id = e.currentTarget.dataset.open; st.tab = 'members'; draw(); });
  }

  function drawDetail() {
    const a = S.activityRepo.getById(st.id); if (!a) { st.view = 'list'; return draw(); }
    const live = a.status !== 'archived'; const can = write && live;
    container.innerHTML = `<div class="space-y-4">
      <button class="btn-ghost btn-sm" id="back">← All activities</button>
      <div><h1 class="text-2xl" style="font-weight:600;">${escapeHtml(a.name)}${live ? '' : ' (archived)'}</h1><p class="text-sm text-ink-500">${escapeHtml(label(CATEGORIES, a.category))} · ${escapeHtml(when(a))}${a.venue ? ` · ${escapeHtml(a.venue)}` : ''}</p>
        ${write ? `<p class="mt-2"><button class="btn-secondary btn-sm" id="edit-act">Edit</button> <button class="btn-secondary btn-sm" id="arch-act">${live ? 'Archive' : 'Reopen'}</button></p>` : ''}</div>
      ${st.edit ? formHtml(a) : errs()}
      <div class="pill-group">${[['members', 'Members'], ['sessions', 'Sessions'], ['wins', 'Achievements']].map(([k, v]) => `<button class="pill ${st.tab === k ? 'active' : ''}" data-tab="${k}">${v}</button>`).join('')}</div>
      <div id="tab-body">${st.tab === 'members' ? membersTab(a, can) : st.tab === 'sessions' ? sessionsTab(a, can) : winsTab(a, can)}</div></div>`;
    qs(container, '#back').addEventListener('click', () => { clear(); st.view = 'list'; draw(); });
    qs(container, '#edit-act')?.addEventListener('click', () => { clear(); st.fd = null; st.edit = true; draw(); });
    qs(container, '#arch-act')?.addEventListener('click', () => { if (live && !confirm('Archive this activity? Members and records are kept, but it stops appearing as running.')) return; live ? S.archiveActivity(a.id) : S.reopenActivity(a.id); clear(); draw(); });
    if (st.edit) wireForm(a.id);
    on(container, '[data-tab]', 'click', (e) => { clear(); st.tab = e.currentTarget.dataset.tab; draw(); });
    wireTab(a);
  }

  const students = () => studentRepo.getAll().filter((s) => (s.status ?? 'active') === 'active');
  const className = (s) => classRepo.getById(s.classId)?.name ?? '';
  function membersTab(a, can) {
    const members = S.membersOf(a.id); const byId = Object.fromEntries(studentRepo.getAll().map((s) => [s.id, s])); const ids = new Set(members.map((m) => m.studentId));
    return `${can ? `<div class="card card-p space-y-2"><label class="label">Add a learner</label><div class="flex gap-2"><select class="input" id="add-who"><option value="">Choose…</option>${students().filter((s) => !ids.has(s.id)).sort((x, y) => fullName(x).localeCompare(fullName(y))).map((s) => `<option value="${s.id}">${escapeHtml(fullName(s))} (${escapeHtml(className(s))})</option>`).join('')}</select><button class="btn-primary btn-sm" id="add-btn">Add</button></div></div>` : ''}
      <div class="card card-p">${members.length ? members.map((m) => { const s = byId[m.studentId]; const att = S.memberAttendance(m); return `<div class="flex flex-wrap items-center justify-between gap-2 text-sm" style="border-top:1px solid var(--ink-100);padding:.5rem 0;"><span><b>${escapeHtml(s ? fullName(s) : 'Unknown learner')}</b> <span class="text-ink-500">${escapeHtml(s ? className(s) : '')}${m.role !== 'member' ? ` · ${escapeHtml(m.role)}` : ''}</span><br/><span class="text-xs text-ink-400">Attended ${att.attended} of ${att.total} sessions${att.pct === null ? '' : ` (${att.pct}%)`}</span></span>${can ? `<span><select class="input" style="width:auto;padding:.25rem;" data-role="${m.id}">${['member', 'captain', 'leader', 'secretary'].map((r) => `<option ${r === m.role ? 'selected' : ''}>${r}</option>`).join('')}</select> <button class="btn-ghost btn-sm" data-leave="${m.id}">Remove</button></span>` : ''}</div>`; }).join('') : '<p class="text-sm text-ink-500">No members yet.</p>'}</div>`;
  }
  function sessionsTab(a, can) {
    const members = S.membersOf(a.id); const byId = Object.fromEntries(studentRepo.getAll().map((s) => [s.id, s])); const sessions = S.sessionsOf(a.id);
    const sel = st.sessionDate ?? new Date().toISOString().slice(0, 10); const existing = sessions.find((s) => s.date === sel); const present = new Set(existing?.presentIds ?? []);
    return `${can ? `<div class="card card-p space-y-2"><label class="label">Record a session</label><input class="input" type="date" id="s-date" value="${sel}" max="${new Date().toISOString().slice(0, 10)}" />${existing ? '<p class="text-xs text-ink-500">A session on this date already exists. Saving will replace it.</p>' : ''}
      ${members.length ? members.map((m) => `<label class="text-sm" style="display:block;padding:.25rem 0;"><input type="checkbox" data-present="${m.studentId}" ${present.has(m.studentId) ? 'checked' : ''}/> ${escapeHtml(byId[m.studentId] ? fullName(byId[m.studentId]) : 'Unknown learner')}</label>`).join('') : '<p class="text-sm text-ink-500">Add members before recording a session.</p>'}
      <input class="input" id="s-note" placeholder="Note (optional)" value="${escapeHtml(existing?.note ?? '')}" /><button class="btn-primary btn-sm" id="s-save" ${members.length ? '' : 'disabled'}>Save session</button></div>` : ''}
      <div class="card card-p">${sessions.length ? sessions.map((s) => `<div class="flex justify-between gap-2 text-sm" style="border-top:1px solid var(--ink-100);padding:.4rem 0;"><span>${escapeHtml(s.date)} · ${(s.presentIds ?? []).length} present${s.note ? ` · ${escapeHtml(s.note)}` : ''}</span>${can ? `<button class="btn-ghost btn-sm" data-rmsession="${s.id}">Remove</button>` : ''}</div>`).join('') : '<p class="text-sm text-ink-500">No sessions recorded yet.</p>'}</div>`;
  }
  function winsTab(a, can) {
    const members = S.membersOf(a.id); const byId = Object.fromEntries(studentRepo.getAll().map((s) => [s.id, s])); const wins = S.achievementsOf(a.id);
    return `${can ? `<div class="card card-p space-y-2"><label class="label">Log an achievement</label><input class="input" id="w-title" placeholder="e.g. Second place, county drama festival" /><div class="grid grid-2 gap-2"><input class="input" type="date" id="w-date" value="${new Date().toISOString().slice(0, 10)}" /><select class="input" id="w-level">${opts(LEVELS, 'school')}</select></div>
      <select class="input" id="w-who"><option value="">The whole group</option>${members.map((m) => `<option value="${m.studentId}">${escapeHtml(byId[m.studentId] ? fullName(byId[m.studentId]) : '')}</option>`).join('')}</select><button class="btn-primary btn-sm" id="w-save">Save</button></div>` : ''}
      <div class="card card-p">${wins.length ? wins.map((w) => `<div class="flex justify-between gap-2 text-sm" style="border-top:1px solid var(--ink-100);padding:.4rem 0;"><span><b>${escapeHtml(w.title)}</b><br/><span class="text-xs text-ink-500">${escapeHtml(w.date)} · ${escapeHtml(label(LEVELS, w.level))}${w.studentId && byId[w.studentId] ? ` · ${escapeHtml(fullName(byId[w.studentId]))}` : ' · whole group'}</span></span>${can ? `<button class="btn-ghost btn-sm" data-rmwin="${w.id}">Remove</button>` : ''}</div>`).join('') : '<p class="text-sm text-ink-500">No achievements logged yet.</p>'}</div>`;
  }

  function wireTab(a) {
    qs(container, '#add-btn')?.addEventListener('click', () => { const id = qs(container, '#add-who').value; if (!id) return; const r = S.joinActivity(a.id, id); clear(); if (!r.ok) st.errors = [r.reason]; else st.warn = r.warnings; draw(); });
    on(container, '[data-role]', 'change', (e) => { S.setRole(e.currentTarget.dataset.role, e.currentTarget.value); draw(); });
    on(container, '[data-leave]', 'click', (e) => { if (confirm('Remove this learner from the activity? Their past attendance is kept.')) { S.leaveActivity(e.currentTarget.dataset.leave); clear(); draw(); } });
    qs(container, '#s-date')?.addEventListener('change', (e) => { st.sessionDate = e.target.value; draw(); });
    qs(container, '#s-save')?.addEventListener('click', () => { const date = qs(container, '#s-date').value; const existing = S.sessionsOf(a.id).find((session) => session.date === date); if (existing && !confirm('Replace the attendance for this session? The change will be logged.')) return; const presentIds = [...container.querySelectorAll('[data-present]:checked')].map((x) => x.dataset.present); const r = S.recordSession(a.id, { date, presentIds, note: qs(container, '#s-note').value }); clear(); if (!r.ok) st.errors = r.errors; else st.msg = 'Session saved.'; draw(); });
    on(container, '[data-rmsession]', 'click', (e) => { if (!confirm('Remove this activity session and its attendance record?')) return; S.removeSession(e.currentTarget.dataset.rmsession); clear(); draw(); });
    qs(container, '#w-save')?.addEventListener('click', () => { const r = S.addAchievement(a.id, { title: qs(container, '#w-title').value, date: qs(container, '#w-date').value, level: qs(container, '#w-level').value, studentId: qs(container, '#w-who').value }); clear(); if (!r.ok) st.errors = r.errors; else st.msg = 'Achievement saved.'; draw(); });
    on(container, '[data-rmwin]', 'click', (e) => { if (confirm('Remove this achievement?')) { S.removeAchievement(e.currentTarget.dataset.rmwin); draw(); } });
  }
  draw();
}
