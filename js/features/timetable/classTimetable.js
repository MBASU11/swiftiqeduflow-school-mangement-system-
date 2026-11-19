import { escapeHtml, on, qs } from '../../components/dom.js';
import { teacherFullName } from '../../services/peopleService.js';
import { DAYS, BREAK_PRESETS, isBreak } from '../../services/timetableService.js';
import { loadTimetableData, findConflicts, createEntry, updateEntry, removeEntry } from '../../services/timetableStore.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { ensureTimetableStyles, timetableGridHtml, printableTimetable, TIMETABLE_CSS } from '../../components/timetableGrid.js';
import { printHtml } from '../../components/printWindow.js';

const DAY_LABEL = Object.fromEntries(DAYS);
const WEEK = ['MO', 'TU', 'WE', 'TH', 'FR'];

const blankForm = (kind = 'lesson') => ({
  kind,
  editingId: '',
  days: kind === 'break' ? [...WEEK] : ['MO'],
  startTime: kind === 'break' ? '10:00' : '08:00',
  endTime: kind === 'break' ? '10:20' : '09:00',
  subjectId: '',
  teacherId: '',
  room: '',
  label: kind === 'break' ? 'Tea break' : '',
  allClasses: false,
});

export function renderClassTimetable(container) {
  ensureTimetableStyles();
  const state = { data: null, classId: '', view: 'grid', formOpen: false, form: blankForm(), conflicts: [], error: '', busy: false };

  async function render() {
    try {
      state.data ??= await loadTimetableData();
    } catch (error) {
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span><button class="btn-secondary btn-sm" id="timetable-retry">Retry</button></div>`;
      qs(container, '#timetable-retry').addEventListener('click', () => { state.data = null; render(); });
      return;
    }
    const { classes, subjects: allSubjects, teachers: allTeachers, entries: allEntries, school } = state.data;
    if (!classes.length) {
      container.innerHTML = `<div class="card">${emptyState({ title: 'No classes set up yet', body: 'Add classes before building a timetable.' })}</div>`;
      return;
    }
    if (!classes.some((c) => c.id === state.classId)) state.classId = classes[0].id;
    const currentClass = classes.find((c) => c.id === state.classId);
    const gradeSubjects = allSubjects.filter((s) => (s.classIds ?? []).includes(state.classId));
    const teachers = allTeachers.filter((t) => t.category === 'teaching' && t.isActive);
    const subjectById = Object.fromEntries(allSubjects.map((s) => [s.id, s]));
    const teacherById = Object.fromEntries(allTeachers.map((t) => [t.id, t]));
    const entries = allEntries
      .filter((e) => e.classId === state.classId)
      .sort((a, b) => DAYS.findIndex(([d]) => d === a.day) - DAYS.findIndex(([d]) => d === b.day) || a.startTime.localeCompare(b.startTime));

    // Keep a sensible default subject so Save never silently submits a blank one.
    if (state.formOpen && state.form.kind === 'lesson' && !state.form.subjectId && gradeSubjects.length) {
      state.form.subjectId = gradeSubjects[0].id;
    }

    const describe = (e) => ({
      title: subjectById[e.subjectId]?.name ?? '—',
      meta: [e.teacherId ? teacherFullName(teacherById[e.teacherId] ?? { firstName: '', lastName: '—' }) : '', e.room].filter(Boolean).join(' · '),
    });

    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="label">Class</label>
            <select class="input" id="class-select" style="min-width:10rem">
              ${classes.map((c) => `<option value="${c.id}" ${state.classId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="pill-group" role="group" aria-label="View">
            <button class="pill ${state.view === 'grid' ? 'active' : ''}" id="view-grid">Timetable</button>
            <button class="pill ${state.view === 'list' ? 'active' : ''}" id="view-list">List</button>
          </div>
          <div class="flex gap-2 flex-wrap" style="margin-left:auto">
            <button class="btn-secondary" id="print-btn" ${entries.length ? '' : 'disabled'}>Print timetable</button>
            <button class="btn-secondary" id="add-break-btn">+ Add break</button>
            <button class="btn-primary" id="add-period-btn">+ Add period</button>
          </div>
        </div>

        ${state.formOpen ? formHtml(gradeSubjects, teachers, classes, subjectById) : ''}

        ${
          entries.length === 0
            ? `<div class="card">${emptyState({ iconHtml: icons.table(40), title: 'No periods scheduled yet', body: 'Add the first period or a break for this class above.' })}</div>`
            : state.view === 'grid'
            ? `<div class="card overflow-x-auto card-p">${timetableGridHtml(entries, { describe, editable: true })}<p class="text-xs text-ink-400 mt-2">Click a period or break to edit it. Click a “+” cell to add a period at that time.</p></div>`
            : listHtml(entries, subjectById, teacherById)
        }
      </div>
    `;

    wire({ classes, gradeSubjects, teachers, entries, allEntries, subjectById, describe, currentClass, school });
  }

  function listHtml(entries, subjectById, teacherById) {
    return `<div class="card overflow-x-auto">
      <table class="data-table">
        <thead><tr><th>Day</th><th>Time</th><th>Subject / Break</th><th>Teacher</th><th>Room</th><th></th></tr></thead>
        <tbody>
          ${entries
            .map(
              (e) => `<tr>
                <td>${escapeHtml(DAY_LABEL[e.day] ?? e.day)}</td>
                <td>${escapeHtml(e.startTime)}–${escapeHtml(e.endTime)}</td>
                <td>${isBreak(e) ? `<span class="badge" style="background:#fdf3d8;color:#7a5a00;">${escapeHtml(e.label || 'Break')}</span>` : escapeHtml(subjectById[e.subjectId]?.name ?? '—')}</td>
                <td>${escapeHtml(!isBreak(e) && e.teacherId ? teacherFullName(teacherById[e.teacherId] ?? { firstName: '', lastName: '—' }) : '—')}</td>
                <td>${escapeHtml(e.room ?? '—')}</td>
                <td class="text-right" style="white-space:nowrap">
                  <button data-edit="${e.id}" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;">Edit</button>
                  <button data-remove="${e.id}" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;margin-left:0.6rem;" class="text-bad">Remove</button>
                </td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
  }

  function formHtml(subjects, teachers, classes, subjectById) {
    const f = state.form;
    const editing = Boolean(f.editingId);
    const isBrk = f.kind === 'break';
    // Never lose the subject of a period being edited, even if the grade no longer lists it.
    const subjectOptions = [...subjects];
    if (f.subjectId && !subjectOptions.some((s) => s.id === f.subjectId) && subjectById[f.subjectId]) subjectOptions.push(subjectById[f.subjectId]);
    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">${editing ? 'Edit' : 'New'} ${isBrk ? 'break' : 'period'}</h3>
        <div>
          <label class="label">${editing ? 'Day' : 'Days'}</label>
          <div class="flex flex-wrap gap-3">
            ${DAYS.map(([code, label]) =>
              editing
                ? `<label class="flex items-center gap-1.5 text-sm"><input type="radio" name="tt-day" data-day="${code}" ${f.days[0] === code ? 'checked' : ''}/> ${escapeHtml(label)}</label>`
                : `<label class="flex items-center gap-1.5 text-sm"><input type="checkbox" data-day="${code}" ${f.days.includes(code) ? 'checked' : ''}/> ${escapeHtml(label)}</label>`
            ).join('')}
          </div>
        </div>
        <div class="grid sm-grid-3 gap-4">
          <div>
            <label class="label">Start time</label>
            <input type="time" class="input" id="tt-start" value="${escapeHtml(f.startTime)}" />
          </div>
          <div>
            <label class="label">End time</label>
            <input type="time" class="input" id="tt-end" value="${escapeHtml(f.endTime)}" />
          </div>
          ${
            isBrk
              ? `<div>
                  <label class="label">Break name</label>
                  <input class="input" id="tt-label" list="tt-break-presets" value="${escapeHtml(f.label)}" placeholder="e.g. Tea break" />
                  <datalist id="tt-break-presets">${BREAK_PRESETS.map((p) => `<option value="${escapeHtml(p)}"></option>`).join('')}</datalist>
                </div>`
              : `<div>
                  <label class="label">Subject</label>
                  <select class="input" id="tt-subject" ${subjectOptions.length === 0 ? 'disabled' : ''}>
                    ${subjectOptions.length === 0 ? '<option>No subjects for this grade</option>' : subjectOptions.map((s) => `<option value="${s.id}" ${f.subjectId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
                  </select>
                  ${subjectOptions.length === 0 ? '<p class="text-xs text-warn mt-1">Assign subjects to this grade under Academics → Classes → Manage subjects.</p>' : ''}
                </div>`
          }
        </div>
        ${
          isBrk
            ? `<label class="flex items-center gap-2 text-sm"><input type="checkbox" id="tt-all-classes" ${f.allClasses ? 'checked' : ''} ${editing ? 'disabled' : ''}/> Apply to every grade (${classes.length}) — typical for tea, lunch and games</label>`
            : `<div class="grid sm-grid-2 gap-4">
                <div>
                  <label class="label">Teacher</label>
                  <select class="input" id="tt-teacher">
                    <option value="">Unassigned</option>
                    ${teachers.map((t) => `<option value="${t.id}" ${f.teacherId === t.id ? 'selected' : ''}>${escapeHtml(teacherFullName(t))}</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label class="label">Room (optional)</label>
                  <input class="input" id="tt-room" value="${escapeHtml(f.room)}" placeholder="e.g. Lab 2" />
                </div>
              </div>`
        }
        ${
          state.conflicts.length
            ? `<div style="background:var(--gold-100); border:1px solid var(--gold-300); border-radius:0.5rem; padding:0.75rem 1rem;">
                <p class="text-sm" style="font-weight:600; color:var(--gold-700);">This conflicts with an existing period:</p>
                <ul style="margin:0.35rem 0 0; padding-left:1.1rem;" class="text-sm text-ink-700">${state.conflicts.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
              </div>`
            : ''
        }
        <div class="flex justify-between gap-3">
          <div>${editing ? `<button class="btn-secondary text-bad" id="delete-period-btn">Delete</button>` : ''}</div>
          <div class="flex gap-3">
            <button class="btn-secondary" id="cancel-period-btn">Cancel</button>
            <button class="btn-primary" id="save-period-btn" ${state.busy || (!isBrk && subjectOptions.length === 0) ? 'disabled' : ''}>${editing ? 'Save changes' : isBrk ? 'Add break' : 'Save period'}</button>
          </div>
        </div>
      </div>`;
  }

  function openForm(form) {
    state.form = form;
    state.formOpen = true;
    state.conflicts = [];
    state.error = '';
    render().then(() => qs(container, '#tt-start')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }));
  }

  function wire(ctx) {
    const { classes, gradeSubjects, entries, allEntries, currentClass, school } = ctx;

    qs(container, '#class-select').addEventListener('change', (e) => { state.classId = e.target.value; state.form.subjectId = ''; state.formOpen = false; render(); });
    qs(container, '#view-grid').addEventListener('click', () => { state.view = 'grid'; render(); });
    qs(container, '#view-list').addEventListener('click', () => { state.view = 'list'; render(); });
    qs(container, '#add-period-btn').addEventListener('click', () => openForm(blankForm('lesson')));
    qs(container, '#add-break-btn').addEventListener('click', () => openForm(blankForm('break')));

    qs(container, '#print-btn').addEventListener('click', () => {
      const html = printableTimetable({
        school,
        heading: `${currentClass.name} timetable`,
        subheading: state.data.periodLabel,
        gridHtml: timetableGridHtml(entries, { describe: ctx.describe }),
      });
      printHtml(`${currentClass.name} timetable`, html, { css: TIMETABLE_CSS, orientation: 'landscape' });
    });

    const startEdit = (id) => {
      const e = allEntries.find((entry) => entry.id === id);
      if (!e) return;
      openForm({
        kind: isBreak(e) ? 'break' : 'lesson',
        editingId: e.id,
        days: [e.day],
        startTime: e.startTime,
        endTime: e.endTime,
        subjectId: e.subjectId ?? '',
        teacherId: e.teacherId ?? '',
        room: e.room ?? '',
        label: e.label ?? '',
        allClasses: false,
      });
    };
    on(container, '[data-tt-edit]', 'click', (e) => startEdit(e.currentTarget.getAttribute('data-tt-edit')));
    on(container, '[data-edit]', 'click', (e) => startEdit(e.currentTarget.getAttribute('data-edit')));
    on(container, '[data-tt-add]', 'click', (e) => {
      const [day, start, end] = e.currentTarget.getAttribute('data-tt-add').split('|');
      openForm({ ...blankForm('lesson'), days: [day], startTime: start, endTime: end });
    });
    on(container, '[data-remove]', 'click', (e) => remove(e.currentTarget.getAttribute('data-remove')));

    if (!state.formOpen) return;
    const f = state.form;
    const touched = () => { state.conflicts = []; };
    on(container, '[data-day]', 'change', (e) => {
      const day = e.target.getAttribute('data-day');
      if (f.editingId) f.days = [day];
      else f.days = e.target.checked ? [...new Set([...f.days, day])] : f.days.filter((d) => d !== day);
      touched();
    });
    qs(container, '#tt-start').addEventListener('input', (e) => { f.startTime = e.target.value; touched(); });
    qs(container, '#tt-end').addEventListener('input', (e) => { f.endTime = e.target.value; touched(); });
    qs(container, '#tt-label')?.addEventListener('input', (e) => { f.label = e.target.value; });
    qs(container, '#tt-subject')?.addEventListener('change', (e) => { f.subjectId = e.target.value; });
    qs(container, '#tt-teacher')?.addEventListener('change', (e) => { f.teacherId = e.target.value; touched(); });
    qs(container, '#tt-room')?.addEventListener('input', (e) => { f.room = e.target.value; touched(); });
    qs(container, '#tt-all-classes')?.addEventListener('change', (e) => { f.allClasses = e.target.checked; touched(); });
    qs(container, '#cancel-period-btn').addEventListener('click', () => { state.formOpen = false; state.conflicts = []; render(); });
    qs(container, '#delete-period-btn')?.addEventListener('click', () => remove(f.editingId));
    qs(container, '#save-period-btn').addEventListener('click', () => save({ classes, gradeSubjects, allEntries }));
  }

  async function remove(id) {
    if (!confirm('Remove this period from the timetable?')) return;
    try {
      await removeEntry(id);
      state.formOpen = false;
      state.error = '';
      state.data = null;
    } catch (error) {
      state.error = error.message;
    }
    await render();
  }

  async function save({ classes, allEntries }) {
    const f = state.form;
    const isBrk = f.kind === 'break';
    if (!f.days.length) { state.conflicts = ['Choose at least one day.']; await render(); return; }
    if (isBrk && !f.label.trim()) { state.conflicts = ['Give the break a name.']; await render(); return; }
    if (!isBrk && !f.subjectId) { state.conflicts = ['Choose a subject.']; await render(); return; }

    const targetClasses = isBrk && f.allClasses ? classes.map((c) => c.id) : [state.classId];
    const candidates = [];
    for (const classId of targetClasses) {
      for (const day of f.days) {
        candidates.push(
          isBrk
            ? { kind: 'break', classId, day, startTime: f.startTime, endTime: f.endTime, label: f.label.trim() }
            : { kind: 'lesson', classId, day, startTime: f.startTime, endTime: f.endTime, subjectId: f.subjectId, teacherId: f.teacherId || undefined, room: f.room.trim() || undefined }
        );
      }
    }

    // Check everything first (against saved entries and the other new ones) so a
    // multi-day / all-grade save either goes through cleanly or reports every clash.
    const classNameById = Object.fromEntries(classes.map((c) => [c.id, c.name]));
    const problems = [];
    const pool = [...allEntries];
    candidates.forEach((candidate) => {
      const found = findConflicts(pool, candidate, f.editingId || undefined);
      found.forEach((message) => problems.push(`${classNameById[candidate.classId]} · ${DAY_LABEL[candidate.day]}: ${message}`));
      pool.push({ ...candidate, id: `pending-${pool.length}` });
    });
    if (problems.length) { state.conflicts = problems.slice(0, 12); await render(); return; }

    state.busy = true;
    try {
      if (f.editingId) await updateEntry(f.editingId, candidates[0]);
      else for (const candidate of candidates) await createEntry(candidate);
      state.formOpen = false;
      state.conflicts = [];
      state.error = '';
      state.data = null;
    } catch (error) {
      state.error = error.message;
      state.data = null; // some entries may already have been saved
    }
    state.busy = false;
    await render();
  }

  render();
}
