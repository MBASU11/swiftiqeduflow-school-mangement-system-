import { escapeHtml, on, qs } from '../../components/dom.js';
import { classesSortedByOrder, getSubjectsForClass, getCurrentTerm } from '../../services/academicService.js';
import { assessmentRepo, getAssessmentsFor, classAverage, updateAssessmentDefinition, deleteAssessmentDefinition } from '../../services/assessmentService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { createRemoteAssessment, updateRemoteAssessment, deleteRemoteAssessment, loadAssessmentWorkspace, assessmentsForClass, averageForAssessment, subjectsForClass } from '../../services/supabaseAssessmentService.js';

const TYPE_OPTIONS = [
  ['assignment', 'Assignment'],
  ['cat', 'CAT'],
  ['test', 'Test'],
  ['project', 'Project'],
  ['practical', 'Practical'],
  ['continuous', 'Continuous assessment'],
  ['custom', 'Custom'],
];

function formHtml(subjects, state) {
  return `
    <div class="card card-p space-y-4">
      <h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editingId ? 'Edit assessment' : 'New assessment'}</h3>
      <div class="grid sm-grid-2 gap-4">
        <div>
          <label class="label">Name</label>
          <input class="input" data-f="name" value="${escapeHtml(state.name)}" placeholder="e.g. Mid-term CAT" />
        </div>
        <div>
          <label class="label">Type</label>
          <select class="input" data-f="type">
            ${TYPE_OPTIONS.map(([v, label]) => `<option value="${v}" ${state.type === v ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="grid sm-grid-3 gap-4">
        <div>
          <label class="label">Subject</label>
          <select class="input" data-f="subjectId">
            <option value="">Select subject</option>
            ${subjects.map((s) => `<option value="${s.id}" ${state.subjectId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="label">Max score</label>
          <input type="number" min="1" class="input" data-f="maxScore" value="${escapeHtml(state.maxScore)}" />
        </div>
        <div>
          <label class="label">Date</label>
          <input type="date" class="input" data-f="date" value="${escapeHtml(state.date)}" />
        </div>
      </div>
      <div class="flex justify-end gap-3">
        <button class="btn-secondary" id="cancel-form-btn">Cancel</button>
        <button class="btn-primary" id="create-assessment-btn">${state.editingId ? 'Save changes' : 'Create'}</button>
      </div>
    </div>
  `;
}

export function renderAssessmentsList(container, onOpen) {
  if (isSupabaseConfigured()) return renderRemoteAssessmentsList(container, onOpen);
  const classes = classesSortedByOrder();
  const state = {
    classId: classes[0]?.id ?? '',
    subjectId: '',
    formOpen: false,
    name: '',
    type: 'cat',
    maxScore: '100',
    date: new Date().toISOString().slice(0, 10),
    editingId: '',
    error: '',
  };

  function render() {
    if (classes.length === 0) {
      container.innerHTML = `<div class="card">${emptyState({ title: 'No classes set up yet', body: 'Add classes before creating assessments.' })}</div>`;
      return;
    }

    const subjects = state.classId ? getSubjectsForClass(state.classId) : [];
    const assessments = state.classId ? getAssessmentsFor(state.classId, state.subjectId || undefined) : [];

    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="label">Class</label>
            <select class="input" id="class-select" style="min-width:10rem">
              ${classes.map((c) => `<option value="${c.id}" ${state.classId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="label">Subject</label>
            <select class="input" id="subject-filter" style="min-width:10rem">
              <option value="">All subjects</option>
              ${subjects.map((s) => `<option value="${s.id}" ${state.subjectId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
            </select>
          </div>
          <button class="btn-primary" id="new-assessment-btn" style="margin-left:auto">+ New assessment</button>
        </div>
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}

        ${state.formOpen ? formHtml(subjects, state) : ''}

        ${
          assessments.length === 0
            ? `<div class="card">${emptyState({
                iconHtml: icons.clipboard(40),
                title: 'No assessments yet',
                body: 'Create an assessment to start entering marks for this class.',
                actionsHtml: `<button class="btn-primary" id="empty-new-btn">+ New assessment</button>`,
              })}</div>`
            : `<div class="card" style="overflow:hidden;">
                ${assessments
                  .map((a) => {
                    const subject = subjects.find((s) => s.id === a.subjectId);
                    const avg = classAverage(a.id);
                    return `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.9rem 1rem;border-bottom:1px solid var(--ink-50);">
                      <button data-open="${a.id}" style="flex:1;display:flex;justify-content:space-between;align-items:center;text-align:left;background:none;border:none;cursor:pointer;font-family:inherit;">
                      <div>
                        <p class="text-sm" style="font-weight:500;">${escapeHtml(a.name)}</p>
                        <p class="text-xs text-ink-500 mt-1">${escapeHtml(subject?.name ?? 'Subject')} · ${escapeHtml(TYPE_OPTIONS.find(([v]) => v === a.type)?.[1] ?? '')} · ${escapeHtml(a.date ?? '')}</p>
                      </div>
                      <div class="text-right">
                        <p class="text-sm" style="font-weight:500;">Out of ${a.maxScore}</p>
                        <p class="text-xs text-ink-400">${avg !== null ? `Avg ${avg}` : 'No scores yet'}</p>
                      </div>
                      </button>
                      <div class="flex gap-2" style="margin-left:.75rem;"><button class="btn-secondary btn-sm" data-edit="${a.id}">Edit</button><button class="btn-ghost btn-sm" data-delete="${a.id}">Delete</button></div>
                    </div>
                  `;
                  })
                  .join('')}
              </div>`
        }
      </div>
    `;

    qs(container, '#class-select').addEventListener('change', (e) => {
      state.classId = e.target.value;
      state.subjectId = '';
      render();
    });
    qs(container, '#subject-filter').addEventListener('change', (e) => {
      state.subjectId = e.target.value;
      render();
    });
    qs(container, '#new-assessment-btn').addEventListener('click', () => { state.formOpen = true; state.editingId = ''; state.error = ''; render(); });
    const emptyNewBtn = qs(container, '#empty-new-btn');
    if (emptyNewBtn) emptyNewBtn.addEventListener('click', () => { state.formOpen = true; state.editingId = ''; state.error = ''; render(); });

    if (state.formOpen) {
      on(container, '[data-f]', 'input', (e) => { state[e.target.getAttribute('data-f')] = e.target.value; });
      on(container, '[data-f]', 'change', (e) => { state[e.target.getAttribute('data-f')] = e.target.value; });
      qs(container, '#cancel-form-btn').addEventListener('click', () => { state.formOpen = false; state.editingId = ''; state.error = ''; render(); });
      qs(container, '#create-assessment-btn').addEventListener('click', () => {
        if (!state.name.trim() || !state.classId || !state.subjectId) return;
        try {
          const definition = { name: state.name.trim(), type: state.type, classId: state.classId, subjectId: state.subjectId, maxScore: Number(state.maxScore), date: state.date };
          if (!Number.isFinite(definition.maxScore) || definition.maxScore <= 0) throw new Error('Maximum score must be more than zero.');
          if (state.editingId) updateAssessmentDefinition(state.editingId, definition);
          else assessmentRepo.create({ ...definition, termId: getCurrentTerm()?.id });
          state.name = ''; state.formOpen = false; state.editingId = ''; state.error = '';
        } catch (error) { state.error = error.message; }
        render();
      });
    }

    on(container, '[data-open]', 'click', (e) => onOpen(e.currentTarget.getAttribute('data-open')));
    on(container, '[data-edit]', 'click', (e) => {
      const a = assessments.find((item) => item.id === e.currentTarget.dataset.edit);
      if (!a) return;
      state.editingId = a.id; state.formOpen = true; state.error = '';
      state.name = a.name; state.type = a.type ?? 'cat'; state.subjectId = a.subjectId;
      state.maxScore = String(a.maxScore ?? 100); state.date = a.date ?? '';
      render();
    });
    on(container, '[data-delete]', 'click', (e) => {
      const a = assessments.find((item) => item.id === e.currentTarget.dataset.delete);
      if (!a || !globalThis.confirm?.(`Delete "${a.name}"? Assessments with saved scores cannot be deleted.`)) return;
      try { deleteAssessmentDefinition(a.id); state.error = ''; }
      catch (error) { state.error = error.message; }
      render();
    });
  }


  render();
}

function renderRemoteAssessmentsList(container, onOpen) {
  const state = {
    data: null,
    classId: '',
    subjectId: '',
    formOpen: false,
    name: '',
    type: 'cat',
    maxScore: '100',
    date: new Date().toISOString().slice(0, 10),
    editingId: '',
    error: '',
  };

  async function render() {
    try {
      state.data ??= await loadAssessmentWorkspace();
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="assessment-retry">Retry</button></div>`;
      qs(container, '#assessment-retry').addEventListener('click', () => { state.data = null; state.error = ''; render(); });
      return;
    }
    const classes = state.data.classes;
    state.classId ||= classes[0]?.id ?? '';
    if (classes.length === 0) {
      container.innerHTML = `<div class="card">${emptyState({ title: 'No classes set up yet', body: 'Add classes before creating assessments.' })}</div>`;
      return;
    }
    const subjects = subjectsForClass(state.data, state.classId);
    const assessments = assessmentsForClass(state.data, state.classId, state.subjectId);
    const subjectById = Object.fromEntries(subjects.map((subject) => [subject.id, subject]));
    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex flex-wrap items-end gap-3">
          <div><label class="label">Class</label><select class="input" id="class-select" style="min-width:10rem">${classes.map((schoolClass) => `<option value="${schoolClass.id}" ${state.classId === schoolClass.id ? 'selected' : ''}>${escapeHtml(schoolClass.name)}</option>`).join('')}</select></div>
          <div><label class="label">Subject</label><select class="input" id="subject-filter" style="min-width:10rem"><option value="">All subjects</option>${subjects.map((subject) => `<option value="${subject.id}" ${state.subjectId === subject.id ? 'selected' : ''}>${escapeHtml(subject.name)}</option>`).join('')}</select></div>
          <button class="btn-primary" id="new-assessment-btn" style="margin-left:auto">+ New assessment</button>
        </div>
        ${state.formOpen ? formHtml(subjects, state) : ''}
        ${assessments.length === 0
          ? `<div class="card">${emptyState({ iconHtml: icons.clipboard(40), title: 'No assessments yet', body: 'Create an assessment to start entering marks for this class.', actionsHtml: `<button class="btn-primary" id="empty-new-btn">+ New assessment</button>` })}</div>`
          : `<div class="card" style="overflow:hidden;">${assessments.map((assessment) => {
            const average = averageForAssessment(state.data, assessment.id);
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.9rem 1rem;border-bottom:1px solid var(--ink-50);"><button data-open="${assessment.id}" style="flex:1;display:flex;justify-content:space-between;align-items:center;text-align:left;background:none;border:none;cursor:pointer;font-family:inherit;"><div><p class="text-sm" style="font-weight:500;">${escapeHtml(assessment.name)}</p><p class="text-xs text-ink-500 mt-1">${escapeHtml(subjectById[assessment.subjectId]?.name ?? 'Subject')} · ${escapeHtml(TYPE_OPTIONS.find(([value]) => value === assessment.type)?.[1] ?? '')} · ${escapeHtml(assessment.date ?? '')}</p></div><div class="text-right"><p class="text-sm" style="font-weight:500;">Out of ${assessment.maxScore}</p><p class="text-xs text-ink-400">${average !== null ? `Avg ${average}` : 'No scores yet'}</p></div></button><div class="flex gap-2" style="margin-left:.75rem;"><button class="btn-secondary btn-sm" data-edit="${assessment.id}">Edit</button><button class="btn-ghost btn-sm" data-delete="${assessment.id}">Delete</button></div></div>`;
          }).join('')}</div>`}
      </div>`;

    qs(container, '#class-select').addEventListener('change', (event) => { state.classId = event.target.value; state.subjectId = ''; render(); });
    qs(container, '#subject-filter').addEventListener('change', (event) => { state.subjectId = event.target.value; render(); });
    qs(container, '#new-assessment-btn').addEventListener('click', () => { state.formOpen = true; state.editingId = ''; state.error = ''; render(); });
    const emptyNew = qs(container, '#empty-new-btn');
    if (emptyNew) emptyNew.addEventListener('click', () => { state.formOpen = true; state.editingId = ''; state.error = ''; render(); });
    if (state.formOpen) {
      on(container, '[data-f]', 'input', (event) => { state[event.target.getAttribute('data-f')] = event.target.value; });
      on(container, '[data-f]', 'change', (event) => { state[event.target.getAttribute('data-f')] = event.target.value; });
      qs(container, '#cancel-form-btn').addEventListener('click', () => { state.formOpen = false; state.editingId = ''; state.error = ''; render(); });
      qs(container, '#create-assessment-btn').addEventListener('click', async () => {
        if (!state.name.trim() || !state.classId || !state.subjectId) return;
        try {
          const details = {
            name: state.name.trim(),
            type: state.type,
            classId: state.classId,
            subjectId: state.subjectId,
            maxScore: Number(state.maxScore),
            date: state.date,
          };
          if (state.editingId) await updateRemoteAssessment(state.editingId, details);
          else await createRemoteAssessment({ ...details, termId: state.data.terms.find((term) => term.isCurrent)?.id });
          state.data = null;
          state.name = '';
          state.formOpen = false;
          state.editingId = '';
          state.error = '';
          await render();
        } catch (error) {
          state.error = error.message;
          await render();
        }
      });
    }
    on(container, '[data-open]', 'click', (event) => onOpen(event.currentTarget.getAttribute('data-open')));
    on(container, '[data-edit]', 'click', (event) => {
      const assessment = assessments.find((item) => item.id === event.currentTarget.dataset.edit);
      if (!assessment) return;
      state.editingId = assessment.id; state.formOpen = true; state.error = '';
      state.name = assessment.name; state.type = assessment.type ?? 'cat'; state.subjectId = assessment.subjectId;
      state.maxScore = String(assessment.maxScore ?? 100); state.date = assessment.date ?? '';
      render();
    });
    on(container, '[data-delete]', 'click', async (event) => {
      const assessment = assessments.find((item) => item.id === event.currentTarget.dataset.delete);
      if (!assessment || !globalThis.confirm?.(`Delete "${assessment.name}"? Assessments with saved scores cannot be deleted.`)) return;
      try { await deleteRemoteAssessment(assessment.id); state.error = ''; state.data = null; }
      catch (error) { state.error = error.message; }
      await render();
    });
  }

  render();
}
