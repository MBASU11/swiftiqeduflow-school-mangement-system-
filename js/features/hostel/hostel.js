// Boarding (demo mode): hostels and beds, exeats, and roll call.
import { escapeHtml, on, qs } from '../../components/dom.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { canWriteModule } from '../../services/accessService.js';
import { studentRepo, fullName } from '../../services/studentService.js';
import { teacherRepo, teacherFullName } from '../../services/peopleService.js';
import { classRepo } from '../../services/academicService.js';
import * as S from '../../services/hostelService.js';
import { GENDERS, EXEAT_TYPES, EXEAT_STATUS, EXEAT_ACTIONS, isOverdue } from '../../services/hostelLogic.js';

const lab = (list, k) => list.find(([x]) => x === k)?.[1] ?? '';
const todayISO = () => new Date().toISOString().slice(0, 10);
const options = (list, cur, blank) => `${blank ? `<option value="">${blank}</option>` : ''}${list.map(([k, v]) => `<option value="${escapeHtml(k)}" ${k === cur ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('')}`;

export function renderHostel(container) {
  if (isSupabaseConfigured()) { container.innerHTML = '<div class="notice" role="status"><span>Boarding runs in demo mode for now. The cloud version arrives with the backend phase.</span></div>'; return; }
  const write = canWriteModule('hostel') || canWriteModule('hostels');
  const st = { tab: 'hostels', hostelId: null, form: false, roomForm: false, roomEditId: '', errors: [], msg: '', filter: '', rollHostel: '', rollDate: todayISO(), rollSession: 'evening', rollResult: null, xForm: false, edit: false, xd: {}, hd: null, rd: {} };
  const clear = () => { st.errors = []; st.msg = ''; };
  const errs = () => `${st.errors.map((e) => `<p class="field-error" role="alert">${escapeHtml(e)}</p>`).join('')}${st.msg ? `<div class="notice" role="status"><span>${escapeHtml(st.msg)}</span></div>` : ''}`;
  const sName = (id) => { const s = studentRepo.getById(id); return s ? fullName(s) : 'Unknown learner'; };
  const clsName = (s) => classRepo.getById(s?.classId)?.name ?? '';
  const hostelsLive = () => S.hostelRepo.getAll().filter((h) => h.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name));
  const wardens = () => Object.fromEntries(teacherRepo.getAll().map((t) => [t.id, teacherFullName(t)]));

  function draw() {
    const overdue = S.overdueExeats();
    container.innerHTML = `<div class="space-y-4"><div><h1 class="text-2xl" style="font-weight:600;">Hostel &amp; boarding</h1>
      <p class="text-sm text-ink-500">${S.occupancy().map((o) => `${escapeHtml(o.name)}: ${o.taken}/${o.beds} beds`).join(' · ') || 'Set up your first hostel to start allocating beds.'}</p></div>
      ${overdue.length ? `<div class="notice" role="alert"><span>🔴 ${overdue.length} learner${overdue.length === 1 ? ' is' : 's are'} overdue back from exeat: ${overdue.map((x) => escapeHtml(sName(x.studentId))).join(', ')}.</span></div>` : ''}
      <div class="pill-group">${[['hostels', 'Hostels & beds'], ['exeats', 'Exeats'], ['roll', 'Roll call']].map(([k, v]) => `<button class="pill ${st.tab === k ? 'active' : ''}" data-tab="${k}">${v}</button>`).join('')}</div>
      <div id="body">${st.tab === 'hostels' ? (st.hostelId ? detail() : hostelsList()) : st.tab === 'exeats' ? exeats() : roll()}</div></div>`;
    on(container, '[data-tab]', 'click', (e) => { clear(); st.tab = e.currentTarget.dataset.tab; st.hostelId = null; st.form = st.xForm = false; draw(); });
    wire();
  }

  // ---------- hostels & beds ----------
  function hostelForm(h0 = {}) {
    const h = st.hd ? { ...h0, ...st.hd } : h0;
    return `<section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">${h.id ? 'Edit hostel' : 'New hostel'}</h3>${errs()}<div class="grid grid-2 gap-3">
      <div><label class="label">Name</label><input class="input" id="h-name" value="${escapeHtml(h.name ?? '')}"/></div>
      <div><label class="label">For</label><select class="input" id="h-gender">${options(GENDERS, h.gender ?? 'boys')}</select></div>
      <div><label class="label">Warden</label><select class="input" id="h-warden"><option value="">None yet</option>${teacherRepo.getAll().filter((t) => t.isActive).map((t) => `<option value="${t.id}" ${t.id === h.wardenId ? 'selected' : ''}>${escapeHtml(teacherFullName(t))}</option>`).join('')}</select></div></div>
      <div class="flex gap-2"><button class="btn-primary btn-sm" id="h-save" data-id="${h.id ?? ''}">Save</button><button class="btn-secondary btn-sm" id="h-cancel">Cancel</button></div></section>`;
  }
  function hostelsList() {
    const occ = Object.fromEntries(S.occupancy().map((o) => [o.hostelId, o])); const w = wardens(); const list = hostelsLive();
    return `${write ? '<button class="btn-primary btn-sm" id="new-h">+ New hostel</button>' : ''}${st.form ? hostelForm() : errs()}
      ${list.length ? `<div class="grid grid-2 gap-3">${list.map((h) => `<button class="card card-p" data-open="${h.id}" style="text-align:left;cursor:pointer;"><p class="text-sm" style="font-weight:600;">${escapeHtml(h.name)}</p><p class="text-xs text-ink-500">${escapeHtml(lab(GENDERS, h.gender))}${h.wardenId && w[h.wardenId] ? ` · Warden: ${escapeHtml(w[h.wardenId])}` : ''}</p><p class="text-xs text-ink-400 mt-1">${occ[h.id]?.taken ?? 0} of ${occ[h.id]?.beds ?? 0} beds taken</p></button>`).join('')}</div>` : '<div class="card card-p"><p class="text-sm text-ink-500">No hostels yet.</p></div>'}`;
  }
  function detail() {
    const h = S.hostelRepo.getById(st.hostelId); if (!h) { st.hostelId = null; return hostelsList(); }
    const rooms = S.roomsOf(h.id); const boarders = S.boardersIn(h.id); const boardingIds = new Set(S.allocationRepo.getAll().filter((a) => a.status !== 'left').map((a) => a.studentId));
    const eligible = studentRepo.getAll().filter((s) => (s.status ?? 'active') === 'active' && !boardingIds.has(s.id) && !(h.gender === 'boys' && s.gender === 'female') && !(h.gender === 'girls' && s.gender === 'male')).sort((a, b) => fullName(a).localeCompare(fullName(b)));
    const allRooms = S.roomRepo.getAll();
    return `<button class="btn-ghost btn-sm" id="back">← All hostels</button><h2 class="text-lg mt-2" style="font-weight:600;">${escapeHtml(h.name)} <span class="text-sm text-ink-500">${escapeHtml(lab(GENDERS, h.gender))}</span></h2>
      ${write ? `<p class="mt-1"><button class="btn-secondary btn-sm" id="edit-h">Edit</button> <button class="btn-secondary btn-sm" id="arch-h">Archive</button> <button class="btn-primary btn-sm" id="new-room">+ Add room</button></p>` : ''}
      ${st.edit ? hostelForm(h) : errs()}
      ${st.roomForm ? `<section class="card card-p space-y-2"><div class="grid grid-2 gap-3"><div><label class="label">Room name or number</label><input class="input" id="r-name" value="${escapeHtml(st.rd.name ?? '')}"/></div><div><label class="label">Beds</label><input class="input" id="r-cap" inputmode="numeric" value="${escapeHtml(st.rd.capacity ?? '')}"/></div></div><button class="btn-primary btn-sm" id="r-save">${st.roomEditId ? 'Save changes' : 'Add room'}</button><button class="btn-secondary btn-sm" id="r-cancel">Cancel</button></section>` : ''}
      ${rooms.length ? rooms.map((r) => { const here = boarders.filter((b) => b.roomId === r.id); return `<section class="card card-p space-y-2"><div class="flex justify-between"><span><b class="text-sm">${escapeHtml(r.name)}</b>${write ? ` <button class="btn-ghost btn-sm" data-editroom="${r.id}">Edit</button>` : ''}</span><span class="text-xs text-ink-500">${here.length} of ${r.capacity} beds${write && !S.roomHasAllocationHistory(r.id) ? ` · <button class="btn-ghost btn-sm" data-rmroom="${r.id}">Remove room</button>` : ''}</span></div>
        ${here.map((b) => `<div class="flex flex-wrap items-center justify-between gap-2 text-sm" style="border-top:1px solid var(--ink-100);padding:.4rem 0;"><span>${escapeHtml(fullName(b.student))} <span class="text-xs text-ink-500">${escapeHtml(clsName(b.student))}${b.bed ? ` · bed ${escapeHtml(b.bed)}` : ''}</span></span>${write ? `<span><select class="input" style="width:auto;padding:.25rem;" data-move="${b.studentId}"><option value="">Move to…</option>${allRooms.filter((x) => x.id !== r.id && S.hostelRepo.getById(x.hostelId)?.status !== 'archived').map((x) => `<option value="${x.id}">${escapeHtml(S.hostelRepo.getById(x.hostelId)?.name ?? '')} · ${escapeHtml(x.name)}</option>`).join('')}</select> <button class="btn-ghost btn-sm" data-checkout="${b.studentId}">Check out</button></span>` : ''}</div>`).join('')}
        ${write && here.length < r.capacity ? `<div class="flex gap-2"><select class="input" data-who="${r.id}"><option value="">Add a boarder…</option>${eligible.map((s) => `<option value="${s.id}">${escapeHtml(fullName(s))} (${escapeHtml(clsName(s))})</option>`).join('')}</select><button class="btn-primary btn-sm" data-allocate="${r.id}">Add</button></div>` : ''}</section>`; }).join('') : '<div class="card card-p"><p class="text-sm text-ink-500">No rooms yet. Add a room with its number of beds.</p></div>'}`;
  }

  // ---------- exeats ----------
  function exeats() {
    const boarders = S.hostelRepo.getAll().flatMap((h) => S.boardersIn(h.id));
    const list = S.exeatsSorted().filter((x) => !st.filter || x.status === st.filter);
    return `<div class="flex flex-wrap gap-2 items-center justify-between"><select class="input" id="x-filter" style="max-width:12rem;"><option value="">All statuses</option>${Object.entries(EXEAT_STATUS).map(([k, v]) => `<option value="${k}" ${st.filter === k ? 'selected' : ''}>${v}</option>`).join('')}</select>${write ? '<button class="btn-primary btn-sm" id="new-x">+ Request exeat</button>' : ''}</div>
      ${st.xForm ? `<section class="card card-p space-y-3">${errs()}<div class="grid grid-2 gap-3"><div><label class="label">Boarder</label><select class="input" id="x-who"><option value="">Choose…</option>${boarders.sort((a, b) => fullName(a.student).localeCompare(fullName(b.student))).map((b) => `<option value="${b.studentId}" ${b.studentId === st.xd.studentId ? 'selected' : ''}>${escapeHtml(fullName(b.student))}</option>`).join('')}</select></div>
        <div><label class="label">Type</label><select class="input" id="x-type">${options(EXEAT_TYPES, st.xd.type ?? 'exeat')}</select></div><div><label class="label">Leaves on</label><input class="input" type="date" id="x-from" value="${st.xd.fromDate ?? todayISO()}"/></div><div><label class="label">Back by</label><input class="input" type="date" id="x-to" value="${st.xd.returnDate ?? todayISO()}"/></div></div>
        <input class="input" id="x-reason" placeholder="Reason" value="${escapeHtml(st.xd.reason ?? '')}"/><input class="input" id="x-guard" placeholder="Going with (parent or guardian) and phone number" value="${escapeHtml(st.xd.guardianContact ?? '')}"/><button class="btn-primary btn-sm" id="x-save">Submit request</button></section>` : errs()}
      ${list.length ? list.map((x) => { const over = isOverdue(x); return `<section class="card card-p space-y-1"><div class="flex flex-wrap justify-between gap-2"><b class="text-sm">${escapeHtml(sName(x.studentId))}</b><span class="text-sm" style="font-weight:600;${over ? 'color:var(--bad,#b3261e);' : ''}">${over ? 'OVERDUE · ' : ''}${escapeHtml(EXEAT_STATUS[x.status])}</span></div>
        <p class="text-xs text-ink-500">${escapeHtml(lab(EXEAT_TYPES, x.type))} · ${escapeHtml(x.fromDate)} to ${escapeHtml(x.returnDate)} · ${escapeHtml(x.reason)}</p><p class="text-xs text-ink-400">With ${escapeHtml(x.guardianContact)}${x.decidedBy ? ` · decided by ${escapeHtml(x.decidedBy)}` : ''}${x.decisionNote ? ` · ${escapeHtml(x.decisionNote)}` : ''}</p>
        ${write ? `<div class="flex flex-wrap gap-2">${Object.entries(EXEAT_ACTIONS).filter(([, a]) => a.from.includes(x.status)).map(([k, a]) => `<button class="btn-secondary btn-sm" data-xact="${k}" data-id="${x.id}" data-note="${a.needsNote ? 1 : 0}">${escapeHtml(a.label)}</button>`).join('')}</div>` : ''}</section>`; }).join('') : '<div class="card card-p"><p class="text-sm text-ink-500">No exeats.</p></div>'}`;
  }

  // ---------- roll call ----------
  function roll() {
    const hs = hostelsLive(); if (!st.rollHostel && hs[0]) st.rollHostel = hs[0].id;
    const boarders = st.rollHostel ? S.boardersIn(st.rollHostel) : []; const out = new Set(S.exeatRepo.getAll().filter((x) => x.status === 'out').map((x) => x.studentId));
    const prior = st.rollHostel ? S.rollFor(st.rollHostel, st.rollDate, st.rollSession) : null; const here = new Set(prior?.presentIds ?? []);
    const r = st.rollResult;
    return `<section class="card card-p space-y-3"><div class="grid grid-2 gap-3"><select class="input" id="rc-h">${hs.map((h) => `<option value="${h.id}" ${h.id === st.rollHostel ? 'selected' : ''}>${escapeHtml(h.name)}</option>`).join('')}</select>
      <select class="input" id="rc-s"><option value="evening" ${st.rollSession === 'evening' ? 'selected' : ''}>Evening</option><option value="morning" ${st.rollSession === 'morning' ? 'selected' : ''}>Morning</option></select><input class="input" type="date" id="rc-d" value="${st.rollDate}" max="${todayISO()}"/></div>
      ${prior ? '<p class="text-xs text-ink-500">Roll call already recorded for this session. Saving will replace it.</p>' : ''}${errs()}
      ${boarders.length ? boarders.map((b) => `<label class="text-sm" style="display:block;padding:.3rem 0;"><input type="checkbox" data-here="${b.studentId}" ${here.has(b.studentId) ? 'checked' : ''} ${out.has(b.studentId) ? 'disabled' : ''}/> ${escapeHtml(fullName(b.student))}${out.has(b.studentId) ? ' <span class="text-xs text-ink-500">(on exeat)</span>' : ''}</label>`).join('') : '<p class="text-sm text-ink-500">No boarders in this hostel yet.</p>'}
      <button class="btn-primary btn-sm" id="rc-save" ${boarders.length ? '' : 'disabled'}>Save roll call</button></section>
      ${r ? `<section class="card card-p space-y-1"><p class="text-sm"><b>${r.present.length}</b> present · <b>${r.onExeat.length}</b> on exeat · <b style="${r.missing.length ? 'color:var(--bad,#b3261e);' : ''}">${r.missing.length}</b> unaccounted for</p>${r.missing.length ? `<p class="text-sm" style="color:var(--bad,#b3261e);">Not accounted for: ${r.missing.map((s) => escapeHtml(fullName(s))).join(', ')}</p>` : '<p class="text-sm" style="color:var(--good,#2e7d4f);">Everyone is accounted for.</p>'}</section>` : ''}`;
  }

  function wire() {
    qs(container, '#new-h')?.addEventListener('click', () => { clear(); st.hd = null; st.form = true; draw(); });
    qs(container, '#h-cancel')?.addEventListener('click', () => { clear(); st.form = st.edit = false; st.hd = null; draw(); });
    qs(container, '#h-save')?.addEventListener('click', (e) => { const id = e.currentTarget.dataset.id || undefined; st.hd = { name: qs(container, '#h-name').value, gender: qs(container, '#h-gender').value, wardenId: qs(container, '#h-warden').value }; const r = S.saveHostel(st.hd, id); clear(); if (!r.ok) st.errors = r.errors; else { st.form = st.edit = false; st.hd = null; if (!id) st.hostelId = r.hostel.id; } draw(); });
    on(container, '[data-open]', 'click', (e) => { clear(); st.hostelId = e.currentTarget.dataset.open; draw(); });
    qs(container, '#back')?.addEventListener('click', () => { clear(); st.hostelId = null; st.edit = st.roomForm = false; draw(); });
    qs(container, '#edit-h')?.addEventListener('click', () => { clear(); st.hd = null; st.edit = true; draw(); });
    qs(container, '#arch-h')?.addEventListener('click', () => { if (!confirm('Archive this hostel?')) return; const r = S.archiveHostel(st.hostelId); clear(); if (!r.ok) st.errors = r.errors; else st.hostelId = null; draw(); });
    qs(container, '#new-room')?.addEventListener('click', () => { clear(); st.rd = {}; st.roomEditId = ''; st.roomForm = true; draw(); });
    on(container, '[data-editroom]', 'click', (e) => { const room = S.roomRepo.getById(e.currentTarget.dataset.editroom); if (!room) return; clear(); st.rd = { name: room.name, capacity: room.capacity }; st.roomEditId = room.id; st.roomForm = true; draw(); });
    qs(container, '#r-cancel')?.addEventListener('click', () => { clear(); st.roomForm = false; st.roomEditId = ''; st.rd = {}; draw(); });
    qs(container, '#r-save')?.addEventListener('click', () => { st.rd = { name: qs(container, '#r-name').value, capacity: qs(container, '#r-cap').value }; const r = S.saveRoom(st.hostelId, st.rd, st.roomEditId || undefined); clear(); if (!r.ok) st.errors = r.errors; else { st.roomForm = false; st.roomEditId = ''; st.rd = {}; } draw(); });
    on(container, '[data-rmroom]', 'click', (e) => { if (!confirm('Remove this empty room from the hostel?')) return; const r = S.removeRoom(e.currentTarget.dataset.rmroom); clear(); if (!r.ok) st.errors = r.errors; draw(); });
    on(container, '[data-allocate]', 'click', (e) => { const rid = e.currentTarget.dataset.allocate; const who = qs(container, `[data-who="${rid}"]`).value; if (!who) return; const r = S.allocate(rid, who); clear(); if (!r.ok) st.errors = [r.reason]; draw(); });
    on(container, '[data-move]', 'change', (e) => { if (!e.currentTarget.value) return; const r = S.move(e.currentTarget.dataset.move, e.currentTarget.value); clear(); if (!r.ok) st.errors = [r.reason]; draw(); });
    on(container, '[data-checkout]', 'click', (e) => { if (!confirm('Check this learner out of the hostel? Any pending exeat is cancelled.')) return; const r = S.checkOut(e.currentTarget.dataset.checkout); clear(); if (!r.ok) st.errors = [r.reason]; draw(); });
    qs(container, '#x-filter')?.addEventListener('change', (e) => { st.filter = e.target.value; draw(); });
    qs(container, '#new-x')?.addEventListener('click', () => { clear(); st.xd = {}; st.xForm = true; draw(); });
    qs(container, '#x-save')?.addEventListener('click', () => { st.xd = { studentId: qs(container, '#x-who').value, type: qs(container, '#x-type').value, fromDate: qs(container, '#x-from').value, returnDate: qs(container, '#x-to').value, reason: qs(container, '#x-reason').value, guardianContact: qs(container, '#x-guard').value }; const r = S.requestExeat(st.xd); clear(); if (!r.ok) st.errors = r.errors; else { st.xForm = false; st.xd = {}; st.msg = 'Exeat requested.'; } draw(); });
    on(container, '[data-xact]', 'click', (e) => { const b = e.currentTarget; let note = ''; if (b.dataset.note === '1') { note = prompt('Reason (required):') ?? ''; if (!note.trim()) return; } const r = S.actOnExeat(b.dataset.id, b.dataset.xact, note); clear(); if (!r.ok) st.errors = [r.reason]; draw(); });
    qs(container, '#rc-h')?.addEventListener('change', (e) => { st.rollHostel = e.target.value; st.rollResult = null; draw(); });
    qs(container, '#rc-s')?.addEventListener('change', (e) => { st.rollSession = e.target.value; st.rollResult = null; draw(); });
    qs(container, '#rc-d')?.addEventListener('change', (e) => { st.rollDate = e.target.value; st.rollResult = null; draw(); });
    qs(container, '#rc-save')?.addEventListener('click', () => { const presentIds = [...container.querySelectorAll('[data-here]:checked')].map((x) => x.dataset.here); const r = S.recordRoll(st.rollHostel, { date: st.rollDate, session: st.rollSession, presentIds }); clear(); if (!r.ok) { st.errors = r.errors; st.rollResult = null; } else st.rollResult = r.result; draw(); });
  }
  draw();
}
