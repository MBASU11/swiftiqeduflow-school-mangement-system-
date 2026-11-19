import { escapeHtml, on, qs } from '../../components/dom.js';
import { studentRepo, fullName } from '../../services/studentService.js';
import { disciplineRepo, allRecordsSorted, CATEGORIES } from '../../services/disciplineService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { SupabaseRepository } from '../../storage/SupabaseRepository.js';
import { canWriteModule } from '../../services/accessService.js';
import { correctDisciplineRecord } from '../../services/disciplineService.js';

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);

export function renderDiscipline(container) {
  const remote = isSupabaseConfigured();
  const studentsRepo = remote ? new SupabaseRepository('students') : studentRepo;
  const recordsRepo = remote ? new SupabaseRepository('discipline') : disciplineRepo;
  const write = canWriteModule('discipline');
  const state = {
    formOpen: false,
    editId: '',
    statusFilter: '',
    studentId: '',
    date: new Date().toISOString().slice(0, 10),
    category: 'other',
    incident: '',
    description: '',
    action: '',
    parentNotified: false,
    followUpDate: '',
    error: '',
  };

  async function render() {
    let students;
    let records;
    try {
      [students, records] = remote
        ? await Promise.all([studentsRepo.getAll(), recordsRepo.getAll()])
        : [studentRepo.getAll(), allRecordsSorted()];
      students = students.filter((student) => student.status === 'active');
      records.sort((a, b) => b.date.localeCompare(a.date));
    } catch (error) {
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span><button class="btn-secondary btn-sm" id="discipline-retry">Retry</button></div>`;
      qs(container, '#discipline-retry').addEventListener('click', render);
      return;
    }
    const studentById = Object.fromEntries(students.map((s) => [s.id, s]));
    if (state.statusFilter) records = records.filter((r) => r.status === state.statusFilter);

    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="card card-p" style="background:var(--ink-50); border-style:dashed;">
          <p class="text-xs text-ink-500">Discipline records are confidential. Treat this data with the same care as any other sensitive student record.</p>
        </div>

        <div class="flex justify-between items-center flex-wrap gap-3">
          <select class="input" id="status-filter" style="max-width:12rem">
            <option value="">All statuses</option>
            <option value="open" ${state.statusFilter === 'open' ? 'selected' : ''}>Open</option>
            <option value="resolved" ${state.statusFilter === 'resolved' ? 'selected' : ''}>Resolved</option>
          </select>
          ${write ? '<button class="btn-primary" id="new-record-btn">+ Log incident</button>' : ''}
        </div>

        ${state.formOpen ? formHtml(students) : ''}

        ${
          records.length === 0
            ? `<div class="card">${emptyState({
                iconHtml: icons.shield(40),
                title: 'No discipline records',
                body: state.statusFilter ? undefined : 'Log an incident to start tracking it here.',
              })}</div>`
            : `<div class="card" style="overflow:hidden;">
                ${records.map((r) => recordHtml(r, studentById)).join('')}
              </div>`
        }
      </div>
    `;

    qs(container, '#status-filter').addEventListener('change', (e) => { state.statusFilter = e.target.value; render(); });
    qs(container, '#new-record-btn')?.addEventListener('click', () => { state.formOpen = true; render(); });

    if (state.formOpen) wireForm(students);

    on(container, '[data-resolve]', 'click', async (e) => {
      if (!confirm('Mark this discipline record as resolved?')) return;
      try {
        await recordsRepo.update(e.currentTarget.getAttribute('data-resolve'), { status: 'resolved' }, 'marked discipline record resolved');
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
    on(container, '[data-reopen]', 'click', async (e) => {
      if (!confirm('Reopen this discipline record?')) return;
      try {
        await recordsRepo.update(e.currentTarget.getAttribute('data-reopen'), { status: 'open' }, 'reopened discipline record');
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
  }

  function recordHtml(r, studentById) {
    const student = studentById[r.studentId];
    return `
      <div style="padding:0.9rem 1rem; border-bottom:1px solid var(--ink-50);">
        <div class="flex justify-between items-start gap-3">
          <div>
            <p class="text-sm" style="font-weight:500;">${escapeHtml(student ? fullName(student) : 'Unknown student')} · ${escapeHtml(r.incident)}</p>
            <p class="text-xs text-ink-500 mt-1">${escapeHtml(CATEGORY_LABEL[r.category] ?? r.category)} · ${escapeHtml(r.date)}</p>
            ${r.description ? `<p class="text-sm text-ink-600 mt-2">${escapeHtml(r.description)}</p>` : ''}
            ${r.action ? `<p class="text-xs text-ink-500 mt-1"><strong>Action:</strong> ${escapeHtml(r.action)}</p>` : ''}
            <p class="text-xs text-ink-400 mt-1">
              Parent notified: ${r.parentNotified ? 'Yes' : 'No'}
              ${r.followUpDate ? ` · Follow-up: ${escapeHtml(r.followUpDate)}` : ''}
            </p>
            ${r.corrections?.length ? `<p class="text-xs text-ink-400 mt-1">Corrected ${r.corrections.length} time(s); latest by ${escapeHtml(r.corrections[r.corrections.length - 1].by)} · ${escapeHtml(r.corrections[r.corrections.length - 1].at.slice(0, 10))}</p>` : ''}
          </div>
          <div class="text-right" style="white-space:nowrap;">
            <span class="badge ${r.status === 'resolved' ? 'badge-good' : 'badge-gold'}">${escapeHtml(r.status)}</span>
            <div class="mt-2">
              ${write ? (r.status === 'open'
                ? `<button data-resolve="${r.id}" class="btn-secondary btn-sm">Mark resolved</button>`
                : `<button data-reopen="${r.id}" class="btn-ghost">Reopen</button>`) : ''}
              ${write ? `<button data-edit-record="${r.id}" class="btn-ghost btn-sm">Correct details</button>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function formHtml(students) {
    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editId ? 'Correct discipline record' : 'Log incident'}</h3>
        <div class="grid sm-grid-3 gap-4">
          <div>
            <label class="label">Student</label>
            <select class="input" id="disc-student" ${students.length === 0 ? 'disabled' : ''}>
              ${students.length === 0 ? '<option>No students yet</option>' : students.map((s) => `<option value="${s.id}" ${state.studentId === s.id ? 'selected' : ''}>${escapeHtml(fullName(s))}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="label">Date</label>
            <input type="date" class="input" id="disc-date" value="${escapeHtml(state.date)}" />
          </div>
          <div>
            <label class="label">Category</label>
            <select class="input" id="disc-category">
              ${CATEGORIES.map(([v, label]) => `<option value="${v}" ${state.category === v ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div>
          <label class="label">Incident (short summary)</label>
          <input class="input" id="disc-incident" value="${escapeHtml(state.incident)}" placeholder="e.g. Argument during break time" />
        </div>
        <div>
          <label class="label">Description</label>
          <textarea class="input" id="disc-description" rows="2">${escapeHtml(state.description)}</textarea>
        </div>
        <div>
          <label class="label">Action taken</label>
          <input class="input" id="disc-action" value="${escapeHtml(state.action)}" placeholder="e.g. Verbal warning, detention" />
        </div>
        <div class="grid sm-grid-2 gap-4">
          <label class="flex items-center gap-2" style="margin-top:1.7rem;">
            <input type="checkbox" id="disc-notified" ${state.parentNotified ? 'checked' : ''} />
            <span class="text-sm text-ink-700">Parent notified</span>
          </label>
          <div>
            <label class="label">Follow-up date (optional)</label>
            <input type="date" class="input" id="disc-followup" value="${escapeHtml(state.followUpDate)}" />
          </div>
        </div>
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-disc-btn">Cancel</button>
          <button class="btn-primary" id="save-disc-btn" ${students.length === 0 ? 'disabled' : ''}>${state.editId ? 'Save correction' : 'Save record'}</button>
        </div>
      </div>
    `;
  }

  function wireForm(students) {
    // No blank placeholder in the student <select>, so default state to the
    // first student to match the browser's own visual default.
    if (!state.studentId && students.length > 0) state.studentId = students[0].id;

    qs(container, '#disc-student').addEventListener('change', (e) => (state.studentId = e.target.value));
    qs(container, '#disc-date').addEventListener('input', (e) => (state.date = e.target.value));
    qs(container, '#disc-category').addEventListener('change', (e) => (state.category = e.target.value));
    qs(container, '#disc-incident').addEventListener('input', (e) => (state.incident = e.target.value));
    qs(container, '#disc-description').addEventListener('input', (e) => (state.description = e.target.value));
    qs(container, '#disc-action').addEventListener('input', (e) => (state.action = e.target.value));
    qs(container, '#disc-notified').addEventListener('change', (e) => (state.parentNotified = e.target.checked));
    qs(container, '#disc-followup').addEventListener('input', (e) => (state.followUpDate = e.target.value));
    qs(container, '#cancel-disc-btn').addEventListener('click', () => { state.formOpen = false; state.editId = ''; render(); });
    qs(container, '#save-disc-btn').addEventListener('click', async () => {
      if (!state.studentId || !state.incident.trim()) return;
      try {
        const record = {
          studentId: state.studentId,
          date: state.date,
          category: state.category,
          incident: state.incident.trim(),
          description: state.description.trim() || undefined,
          action: state.action.trim() || undefined,
          parentNotified: state.parentNotified,
          followUpDate: state.followUpDate || undefined,
          status: 'open',
        };
        if (state.editId) {
          const reason = prompt('Required: why are you correcting this confidential record?')?.trim();
          if (!reason) return;
          await correctDisciplineRecord(recordsRepo, state.editId, { ...record, correctionReason: reason });
        } else await recordsRepo.create(record);
        state.incident = '';
        state.description = '';
        state.action = '';
        state.parentNotified = false;
        state.followUpDate = '';
        state.formOpen = false;
        state.editId = '';
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
    on(container, '[data-edit-record]', 'click', async (e) => {
      const record = await recordsRepo.getById(e.currentTarget.dataset.editRecord);
      if (!record) return;
      Object.assign(state, {
        editId: record.id,
        studentId: record.studentId,
        date: record.date,
        category: record.category,
        incident: record.incident,
        description: record.description ?? '',
        action: record.action ?? '',
        parentNotified: Boolean(record.parentNotified),
        followUpDate: record.followUpDate ?? '',
        formOpen: true,
      });
      render();
    });
  }

  render();
}
