import { escapeHtml, on, qs } from '../../components/dom.js';
import { classesSortedByOrder, getStreamsForClass } from '../../services/academicService.js';
import { scopedClasses } from '../../services/classScope.js';
import { fullName } from '../../services/studentService.js';
import { attendanceRepo, getRecordsFor, getRosterFor, saveAttendance } from '../../services/attendanceService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { attendanceForClassDate, loadAttendanceWorkspace, rosterForClass, saveRemoteAttendance } from '../../services/supabaseAttendanceService.js';
import { SupabaseRepository } from '../../storage/SupabaseRepository.js';

const STATUS_OPTIONS = [
  ['present', 'Present'],
  ['absent', 'Absent'],
  ['late', 'Late'],
  ['excused', 'Excused'],
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function renderAttendanceMarking(container) {
  if (isSupabaseConfigured()) return renderRemoteAttendanceMarking(container);
  const classes = scopedClasses(classesSortedByOrder());
  const state = {
    classId: classes[0]?.id ?? '',
    streamId: '',
    date: todayISO(),
    statuses: {},
    saved: false,
    error: '',
  };

  function loadStatuses() {
    const roster = getRosterFor(state.classId, state.streamId || undefined);
    const existing = state.classId ? getRecordsFor(state.classId, state.date) : new Map();
    const next = {};
    roster.forEach((s) => {
      next[s.id] = existing.get(s.id)?.status ?? 'present';
    });
    state.statuses = next;
    state.saved = false;
  }

  function render() {
    if (classes.length === 0) {
      container.innerHTML = `<div class="card">${emptyState({
        iconHtml: icons.calendarCheck(40),
        title: 'No classes set up yet',
        body: 'Add classes from Settings or the setup wizard before recording attendance.',
      })}</div>`;
      return;
    }

    const streams = getStreamsForClass(state.classId);
    const roster = getRosterFor(state.classId, state.streamId || undefined);
    const records = attendanceRepo.find((record) => record.classId === state.classId && record.date === state.date && (!state.streamId || record.streamId === state.streamId));

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
          ${
            streams.length > 0
              ? `<div>
                  <label class="label">Stream</label>
                  <select class="input" id="stream-select" style="min-width:9rem">
                    <option value="">All streams</option>
                    ${streams.map((s) => `<option value="${s.id}" ${state.streamId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
                  </select>
                </div>`
              : ''
          }
          <div>
            <label class="label">Date</label>
            <input type="date" class="input" id="date-input" value="${escapeHtml(state.date)}" />
          </div>
          <button class="btn-secondary" id="mark-all-btn" ${roster.length === 0 ? 'disabled' : ''}>Mark All Present</button>
        </div>

        ${
          roster.length === 0
            ? `<div class="card">${emptyState({ title: 'No students in this class yet', body: 'Add students to this class to record attendance.' })}</div>${records.length ? `<button class="btn-secondary" id="clear-attendance-btn" data-write-collection="attendance">Clear ${records.length} saved attendance record${records.length === 1 ? '' : 's'}</button>` : ''}`
            : `
              <div class="card" style="overflow:hidden;">
                ${roster
                  .map(
                    (s) => `
                  <div class="flex items-center gap-3" style="padding:0.75rem 1rem; border-bottom:1px solid var(--ink-50);">
                    <span class="flex-1 text-sm" style="font-weight:500;">${escapeHtml(fullName(s))}</span>
                    <div class="flex flex-wrap gap-2">
                      ${STATUS_OPTIONS.map(
                        ([value, label]) =>
                          `<button class="status-btn ${value} ${state.statuses[s.id] === value ? 'active' : ''}" data-status="${s.id}:${value}">${label}</button>`
                      ).join('')}
                    </div>
                  </div>
                `
                  )
                  .join('')}
              </div>
              <div class="flex items-center gap-3">
                <button class="btn-primary" id="save-attendance-btn" data-write-collection="attendance">Save attendance</button>
                ${records.length ? `<button class="btn-secondary" id="clear-attendance-btn" data-write-collection="attendance">Clear ${records.length} record${records.length === 1 ? '' : 's'} for this date</button>` : ''}
                ${state.saved ? `<span class="text-sm text-good">Saved for ${escapeHtml(state.date)}.</span>` : ''}
              </div>
            `
        }
      </div>
    `;

    const classSelect = qs(container, '#class-select');
    if (classSelect) classSelect.addEventListener('change', (e) => {
      state.classId = e.target.value;
      state.streamId = '';
      loadStatuses();
      render();
    });
    const streamSelect = qs(container, '#stream-select');
    if (streamSelect) streamSelect.addEventListener('change', (e) => {
      state.streamId = e.target.value;
      loadStatuses();
      render();
    });
    const dateInput = qs(container, '#date-input');
    if (dateInput) dateInput.addEventListener('change', (e) => {
      state.date = e.target.value;
      loadStatuses();
      render();
    });
    const markAllBtn = qs(container, '#mark-all-btn');
    if (markAllBtn) markAllBtn.addEventListener('click', () => {
      roster.forEach((s) => (state.statuses[s.id] = 'present'));
      state.saved = false;
      render();
    });
    on(container, '[data-status]', 'click', (e) => {
      const [studentId, status] = e.currentTarget.getAttribute('data-status').split(':');
      state.statuses[studentId] = status;
      state.saved = false;
      render();
    });
    const saveBtn = qs(container, '#save-attendance-btn');
    if (saveBtn) saveBtn.addEventListener('click', () => {
      try { saveAttendance(state.classId, state.streamId || undefined, state.date, state.statuses); state.saved = true; state.error = ''; }
      catch (error) { state.error = error.message; }
      render();
    });
    const clearBtn = qs(container, '#clear-attendance-btn');
    if (clearBtn) clearBtn.addEventListener('click', async () => {
      if (!confirm(`Permanently clear ${records.length} attendance record${records.length === 1 ? '' : 's'} for ${state.date}?`)) return;
      try {
        for (const record of records) await attendanceRepo.remove(record.id, 'cleared attendance');
        state.error = ''; state.saved = false;
      } catch (error) { state.error = error.message; }
      render();
    });
  }

  loadStatuses();
  render();
}

function renderRemoteAttendanceMarking(container) {
  const state = {
    data: null,
    classId: '',
    streamId: '',
    date: todayISO(),
    statuses: {},
    saved: false,
    busy: false,
    error: '',
  };

  async function load() {
    container.innerHTML = '<p class="text-sm text-ink-500">Loading attendance...</p>';
    try {
      state.data = await loadAttendanceWorkspace();
      state.classId ||= scopedClasses(state.data.classes)[0]?.id ?? '';
      state.error = '';
      loadStatuses();
      render();
    } catch (error) {
      state.error = error.message;
      renderError();
    }
  }

  function loadStatuses() {
    const roster = rosterForClass(state.data, state.classId, state.streamId);
    const existing = attendanceForClassDate(state.data, state.classId, state.date);
    state.statuses = Object.fromEntries(roster.map((student) => [student.id, existing.get(student.id)?.status ?? 'present']));
    state.saved = false;
  }

  function renderError() {
    container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="attendance-retry">Retry</button></div>`;
    qs(container, '#attendance-retry').addEventListener('click', load);
  }

  function render() {
    if (!state.data) return renderError();
    const classes = scopedClasses(state.data.classes);
    if (classes.length === 0) {
      container.innerHTML = `<div class="card">${emptyState({ iconHtml: icons.calendarCheck(40), title: 'No classes set up yet', body: 'Add classes in Academics before recording attendance.' })}</div>`;
      return;
    }
    const streams = state.data.streams.filter((stream) => stream.classId === state.classId);
    const roster = rosterForClass(state.data, state.classId, state.streamId);
    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex flex-wrap items-end gap-3">
          <div><label class="label">Class</label><select class="input" id="class-select" style="min-width:10rem">${classes.map((c) => `<option value="${c.id}" ${state.classId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></div>
          ${streams.length ? `<div><label class="label">Stream</label><select class="input" id="stream-select" style="min-width:9rem"><option value="">All streams</option>${streams.map((stream) => `<option value="${stream.id}" ${state.streamId === stream.id ? 'selected' : ''}>${escapeHtml(stream.name)}</option>`).join('')}</select></div>` : ''}
          <div><label class="label">Date</label><input type="date" class="input" id="date-input" value="${escapeHtml(state.date)}" /></div>
          <button class="btn-secondary" id="mark-all-btn" ${roster.length === 0 || state.busy ? 'disabled' : ''}>Mark All Present</button>
        </div>
        ${roster.length === 0
          ? `<div class="card">${emptyState({ title: 'No students in this class yet', body: 'Add active students to this class to record attendance.' })}</div>${state.data.attendance.some((record) => record.classId === state.classId && record.date === state.date && (!state.streamId || record.streamId === state.streamId)) ? `<button class="btn-secondary" id="clear-attendance-btn" data-write-collection="attendance" ${state.busy ? 'disabled' : ''}>Clear attendance for this date</button>` : ''}`
          : `<div class="card" style="overflow:hidden;">${roster.map((student) => `<div class="flex items-center gap-3" style="padding:0.75rem 1rem;border-bottom:1px solid var(--ink-50);"><span class="flex-1 text-sm" style="font-weight:500;">${escapeHtml(fullName(student))}</span><div class="flex flex-wrap gap-2">${STATUS_OPTIONS.map(([value, label]) => `<button class="status-btn ${value} ${state.statuses[student.id] === value ? 'active' : ''}" data-status="${student.id}:${value}" ${state.busy ? 'disabled' : ''}>${label}</button>`).join('')}</div></div>`).join('')}</div>
            <div class="flex items-center gap-3"><button class="btn-primary" id="save-attendance-btn" data-write-collection="attendance" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Saving...' : 'Save attendance'}</button>${state.saved ? `<span class="text-sm text-good">Saved for ${escapeHtml(state.date)}.</span>` : ''}${state.data.attendance.filter((record) => record.classId === state.classId && record.date === state.date && (!state.streamId || record.streamId === state.streamId)).length ? `<button class="btn-secondary" id="clear-attendance-btn" data-write-collection="attendance" ${state.busy ? 'disabled' : ''}>Clear attendance for this date</button>` : ''}</div>`}
      </div>`;

    qs(container, '#class-select').addEventListener('change', (event) => {
      state.classId = event.target.value;
      state.streamId = '';
      loadStatuses();
      render();
    });
    const streamSelect = qs(container, '#stream-select');
    if (streamSelect) streamSelect.addEventListener('change', (event) => {
      state.streamId = event.target.value;
      loadStatuses();
      render();
    });
    qs(container, '#date-input').addEventListener('change', (event) => {
      state.date = event.target.value;
      loadStatuses();
      render();
    });
    const markAll = qs(container, '#mark-all-btn');
    if (markAll) markAll.addEventListener('click', () => {
      roster.forEach((student) => { state.statuses[student.id] = 'present'; });
      state.saved = false;
      render();
    });
    on(container, '[data-status]', 'click', (event) => {
      const [studentId, status] = event.currentTarget.getAttribute('data-status').split(':');
      state.statuses[studentId] = status;
      state.saved = false;
      render();
    });
    const saveButton = qs(container, '#save-attendance-btn');
    if (saveButton) saveButton.addEventListener('click', async () => {
      state.busy = true;
      state.error = '';
      render();
      try {
        await saveRemoteAttendance(state.classId, state.streamId, state.date, state.statuses, state.data.terms);
        state.data = await loadAttendanceWorkspace();
        state.saved = true;
      } catch (error) {
        state.error = error.message;
      }
      state.busy = false;
      render();
    });
    const clearButton = qs(container, '#clear-attendance-btn');
    if (clearButton) clearButton.addEventListener('click', async () => {
      const records = state.data.attendance.filter((record) => record.classId === state.classId && record.date === state.date && (!state.streamId || record.streamId === state.streamId));
      if (!records.length || !confirm(`Permanently clear ${records.length} attendance record${records.length === 1 ? '' : 's'} for ${state.date}?`)) return;
      state.busy = true; state.error = ''; render();
      const repo = new SupabaseRepository('attendance');
      try {
        for (const record of records) await repo.remove(record.id, 'cleared attendance');
        state.data = await loadAttendanceWorkspace(); state.saved = false;
      } catch (error) { state.error = error.message; }
      state.busy = false; render();
    });
  }

  load();
}
