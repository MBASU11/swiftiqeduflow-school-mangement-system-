import { escapeHtml, on, qs, qsa } from '../../components/dom.js';
import { classesSortedByOrder, getCurrentTerm, termRepo } from '../../services/academicService.js';
import { examinationRepo, examScoreRepo, reportCardRepo, reportRunRepo, getExaminationsFor } from '../../services/examService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { createRemoteExamination, loadExamWorkspace } from '../../services/supabaseExamService.js';
import { SupabaseRepository } from '../../storage/SupabaseRepository.js';

export function renderExaminationsList(container, onOpen) {
  if (isSupabaseConfigured()) return renderRemoteExaminationsList(container, onOpen);
  const classes = classesSortedByOrder();
  const state = {
    formOpen: false,
    name: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    classIds: [],
    termId: getCurrentTerm()?.id ?? '',
    editingId: '',
    error: '',
  };

  function render() {
    const examinations = getExaminationsFor();
    const classById = Object.fromEntries(classes.map((c) => [c.id, c]));
    const terms = termRepo.getAll();

    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center">
          <p class="text-sm text-ink-500">Set up examinations, then enter marks per class and subject.</p>
          <button class="btn-primary" id="new-exam-btn" data-write-collection="examinations">+ New examination</button>
        </div>
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}

        ${state.formOpen ? formHtml() : ''}

        ${
          examinations.length === 0
            ? `<div class="card">${emptyState({
                iconHtml: icons.award(40),
                title: 'No examinations yet',
                body: 'Create an examination to start entering marks and generating report cards.',
                actionsHtml: `<button class="btn-primary" id="empty-new-exam-btn" data-write-collection="examinations">+ New examination</button>`,
              })}</div>`
            : `<div class="card" style="overflow:hidden;">
                ${examinations
                  .map(
                    (e) => `
                  <div style="display:flex;justify-content:space-between;align-items:center;padding:0.9rem 1rem;border-bottom:1px solid var(--ink-50);">
                  <button data-open="${e.id}" style="flex:1;display:flex;justify-content:space-between;align-items:center;text-align:left;background:none;border:none;cursor:pointer;font-family:inherit;">
                    <div>
                      <p class="text-sm" style="font-weight:500;">${escapeHtml(e.name)}</p>
                      <p class="text-xs text-ink-500 mt-1">${(e.classIds || []).map((id) => classById[id]?.name).filter(Boolean).join(', ') || 'No classes'} · ${escapeHtml(e.startDate ?? '')} – ${escapeHtml(e.endDate ?? '')}</p>
                    </div>
                    <span class="text-ink-400 text-sm">Enter marks →</span>
                  </button><span class="flex gap-2"><button class="btn-secondary btn-sm" data-edit-exam="${e.id}" data-write-collection="examinations">Edit</button><button class="text-bad" data-remove-exam="${e.id}" data-write-collection="examinations" style="background:none;border:none;cursor:pointer;font-family:inherit;">Remove</button></span></div>
                `
                  )
                  .join('')}
              </div>`
        }
      </div>
    `;

    qs(container, '#new-exam-btn').addEventListener('click', () => { state.formOpen = true; state.editingId = ''; state.name = ''; state.termId = getCurrentTerm()?.id ?? ''; state.classIds = []; state.error = ''; render(); });
    const emptyNewBtn = qs(container, '#empty-new-exam-btn');
    if (emptyNewBtn) emptyNewBtn.addEventListener('click', () => { state.formOpen = true; state.editingId = ''; state.name = ''; state.termId = getCurrentTerm()?.id ?? ''; state.classIds = []; render(); });

    if (state.formOpen) {
      qs(container, '#exam-name').addEventListener('input', (e) => (state.name = e.target.value));
      qs(container, '#exam-start').addEventListener('input', (e) => (state.startDate = e.target.value));
      qs(container, '#exam-end').addEventListener('input', (e) => (state.endDate = e.target.value));
      qs(container, '#exam-term').addEventListener('change', (e) => (state.termId = e.target.value));
      on(container, '[data-class-check]', 'change', (e) => {
        const id = e.target.getAttribute('data-class-check');
        state.classIds = e.target.checked ? [...state.classIds, id] : state.classIds.filter((c) => c !== id);
      });
      qs(container, '#cancel-exam-btn').addEventListener('click', () => { state.formOpen = false; render(); });
      qs(container, '#create-exam-btn').addEventListener('click', async () => {
        if (!state.name.trim() || state.classIds.length === 0) return;
        try {
          if (state.editingId) {
            const dependent = examScoreRepo.find((score) => score.examinationId === state.editingId).length
              + reportCardRepo.find((card) => card.examinationId === state.editingId).length
              + reportRunRepo.find((run) => run.examinationId === state.editingId).length;
            const current = examinationRepo.getById(state.editingId);
            if (dependent && state.classIds.some((id) => !(current.classIds ?? []).includes(id))) throw new Error('Classes cannot be added after marks or reports exist. Create a separate examination instead.');
            if (dependent && (current.classIds ?? []).some((id) => !state.classIds.includes(id))) throw new Error('Classes cannot be removed while marks or reports depend on this examination.');
            examinationRepo.update(state.editingId, { name: state.name.trim(), termId: state.termId || null, classIds: state.classIds, startDate: state.startDate, endDate: state.endDate }, 'updated examination');
          } else {
            examinationRepo.create({ name: state.name.trim(), termId: state.termId || getCurrentTerm()?.id, classIds: state.classIds, startDate: state.startDate, endDate: state.endDate });
          }
          state.name = ''; state.classIds = []; state.editingId = ''; state.formOpen = false; state.error = '';
        } catch (error) { state.error = error.message; }
        render();
      });
    }

    on(container, '[data-open]', 'click', (e) => onOpen(e.currentTarget.getAttribute('data-open')));
    on(container, '[data-edit-exam]', 'click', (e) => {
      const exam = examinations.find((item) => item.id === e.currentTarget.getAttribute('data-edit-exam'));
      if (!exam) return;
      state.editingId = exam.id; state.formOpen = true; state.name = exam.name;
      state.startDate = exam.startDate ?? ''; state.endDate = exam.endDate ?? '';
      state.termId = exam.termId ?? '';
      state.classIds = [...(exam.classIds ?? [])]; render();
    });
    on(container, '[data-remove-exam]', 'click', (e) => {
      const id = e.currentTarget.getAttribute('data-remove-exam');
      const hasDependents = examScoreRepo.find((score) => score.examinationId === id).length || reportCardRepo.find((card) => card.examinationId === id).length || reportRunRepo.find((run) => run.examinationId === id).length;
      if (hasDependents) { state.error = 'This examination has marks, report cards, or report runs. Archive it or retain it; dependent records are not deleted.'; return render(); }
      if (confirm('Remove this examination?')) examinationRepo.remove(id, 'removed examination');
      render();
    });
  }

  function formHtml() {
    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editingId ? 'Edit examination' : 'New examination'}</h3>
        <div>
          <label class="label">Name</label>
          <input class="input" id="exam-name" value="${escapeHtml(state.name)}" placeholder="e.g. End of Term 1 Examination" />
        </div>
        <div class="grid sm-grid-2 gap-4">
          <div>
            <label class="label">Start date</label>
            <input type="date" class="input" id="exam-start" value="${escapeHtml(state.startDate)}" />
          </div>
          <div><label class="label">Academic term</label><select class="input" id="exam-term"><option value="">No term</option>${termRepo.getAll().map((term) => `<option value="${term.id}" ${state.termId === term.id ? 'selected' : ''}>${escapeHtml(term.name)}</option>`).join('')}</select></div>
          <div>
            <label class="label">End date</label>
            <input type="date" class="input" id="exam-end" value="${escapeHtml(state.endDate)}" />
          </div>
        </div>
        <div>
          <label class="label">Classes sitting this exam</label>
          <div class="flex flex-wrap gap-3">
            ${classes
              .map(
                (c) => `<label class="flex items-center gap-1.5 text-sm"><input type="checkbox" data-class-check="${c.id}" ${state.classIds.includes(c.id) ? 'checked' : ''}/> ${escapeHtml(c.name)}</label>`
              )
              .join('')}
          </div>
        </div>
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-exam-btn">Cancel</button>
          <button class="btn-primary" id="create-exam-btn" data-write-collection="examinations">${state.editingId ? 'Save changes' : 'Create'}</button>
        </div>
      </div>
    `;
  }

  render();
}

function renderRemoteExaminationsList(container, onOpen) {
  const examsRepo = new SupabaseRepository('examinations');
  const runsRepo = new SupabaseRepository('reportRuns');
  const state = { data: null, runs: [], formOpen: false, editingId: '', name: '', termId: '', startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), classIds: [], error: '' };

  async function render() {
    try {
      state.data ??= await loadExamWorkspace();
      state.runs = await runsRepo.getAll();
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="exams-retry">Retry</button></div>`;
      qs(container, '#exams-retry').addEventListener('click', () => { state.data = null; state.error = ''; render(); });
      return;
    }
    const { classes, examinations, terms } = state.data;
    const classById = Object.fromEntries(classes.map((schoolClass) => [schoolClass.id, schoolClass]));
    container.innerHTML = `<div class="space-y-4">${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}<div class="flex justify-between items-center"><p class="text-sm text-ink-500">Set up examinations, then enter marks per class and subject.</p><button class="btn-primary" id="new-exam-btn" data-write-collection="examinations">+ New examination</button></div>${state.formOpen ? formHtml() : ''}${examinations.length === 0 ? `<div class="card">${emptyState({ iconHtml: icons.award(40), title: 'No examinations yet', body: 'Create an examination to start entering marks and generating report cards.', actionsHtml: `<button class="btn-primary" id="empty-new-exam-btn" data-write-collection="examinations">+ New examination</button>` })}</div>` : `<div class="card" style="overflow:hidden;">${examinations.map((exam) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:.9rem 1rem;border-bottom:1px solid var(--ink-50);"><button data-open="${exam.id}" style="flex:1;display:flex;justify-content:space-between;align-items:center;text-align:left;background:none;border:none;cursor:pointer;font-family:inherit;"><div><p class="text-sm" style="font-weight:500;">${escapeHtml(exam.name)}</p><p class="text-xs text-ink-500 mt-1">${(exam.classIds || []).map((id) => classById[id]?.name).filter(Boolean).map(escapeHtml).join(', ') || 'No classes'} · ${escapeHtml(exam.startDate ?? '')} – ${escapeHtml(exam.endDate ?? '')}</p></div><span class="text-ink-400 text-sm">Enter marks →</span></button><span class="flex gap-2"><button class="btn-secondary btn-sm" data-edit-exam="${exam.id}" data-write-collection="examinations">Edit</button><button class="text-bad" data-remove-exam="${exam.id}" data-write-collection="examinations" style="background:none;border:none;cursor:pointer;font-family:inherit;">Remove</button></span></div>`).join('')}</div>`}</div>`;
    qs(container, '#new-exam-btn').addEventListener('click', () => { state.formOpen = true; state.editingId = ''; state.name = ''; state.termId = terms.find((term) => term.isCurrent)?.id ?? ''; state.classIds = []; render(); });
    const emptyButton = qs(container, '#empty-new-exam-btn');
    if (emptyButton) emptyButton.addEventListener('click', () => { state.formOpen = true; state.editingId = ''; state.name = ''; state.termId = terms.find((term) => term.isCurrent)?.id ?? ''; state.classIds = []; render(); });
    if (state.formOpen) {
      qs(container, '#exam-name').addEventListener('input', (event) => { state.name = event.target.value; });
      qs(container, '#exam-start').addEventListener('input', (event) => { state.startDate = event.target.value; });
      qs(container, '#exam-end').addEventListener('input', (event) => { state.endDate = event.target.value; });
      qs(container, '#exam-term').addEventListener('change', (event) => { state.termId = event.target.value; });
      on(container, '[data-class-check]', 'change', (event) => { const id = event.target.getAttribute('data-class-check'); state.classIds = event.target.checked ? [...state.classIds, id] : state.classIds.filter((classId) => classId !== id); });
      qs(container, '#cancel-exam-btn').addEventListener('click', () => { state.formOpen = false; state.editingId = ''; render(); });
      qs(container, '#create-exam-btn').addEventListener('click', async () => {
        if (!state.name.trim() || state.classIds.length === 0) return;
        try {
          if (state.editingId) {
            const current = examinations.find((exam) => exam.id === state.editingId);
            const dependent = state.data.examScores.some((score) => score.examinationId === state.editingId)
              || state.data.reportCards.some((card) => card.examinationId === state.editingId)
              || state.runs.some((run) => run.examinationId === state.editingId);
            if (dependent && state.classIds.some((id) => !(current.classIds ?? []).includes(id))) throw new Error('Classes cannot be added after marks or reports exist. Create a separate examination instead.');
            if (dependent && (current.classIds ?? []).some((id) => !state.classIds.includes(id))) throw new Error('Classes cannot be removed while marks or reports depend on this examination.');
            await examsRepo.update(state.editingId, { name: state.name.trim(), termId: state.termId || null, classIds: state.classIds, startDate: state.startDate, endDate: state.endDate }, 'updated examination');
          } else await createRemoteExamination({ name: state.name.trim(), termId: state.termId || terms.find((term) => term.isCurrent)?.id, classIds: state.classIds, startDate: state.startDate, endDate: state.endDate });
          state.name = '';
          state.classIds = [];
          state.editingId = '';
          state.formOpen = false;
          state.data = null;
          state.error = '';
        } catch (error) { state.error = error.message; }
        await render();
      });
    }
    on(container, '[data-open]', 'click', (event) => onOpen(event.currentTarget.getAttribute('data-open')));
    on(container, '[data-edit-exam]', 'click', (event) => {
      const exam = examinations.find((item) => item.id === event.currentTarget.getAttribute('data-edit-exam'));
      if (!exam) return;
      state.editingId = exam.id; state.formOpen = true; state.name = exam.name; state.termId = exam.termId ?? ''; state.startDate = exam.startDate ?? ''; state.endDate = exam.endDate ?? ''; state.classIds = [...(exam.classIds ?? [])]; render();
    });
    on(container, '[data-remove-exam]', 'click', async (event) => {
      const id = event.currentTarget.getAttribute('data-remove-exam');
      const dependent = state.data.examScores.some((score) => score.examinationId === id)
        || state.data.reportCards.some((card) => card.examinationId === id)
        || state.runs.some((run) => run.examinationId === id);
      if (dependent) state.error = 'This examination has marks, report cards, or report runs. Archive it or retain it; dependent records are not deleted.';
      else if (confirm('Remove this examination?')) {
        try { await examsRepo.remove(id, 'removed examination'); state.data = null; state.error = ''; }
        catch (error) { state.error = error.message; }
      }
      await render();
    });
  }

  function formHtml() {
    const classes = state.data.classes;
    return `<div class="card card-p space-y-4"><h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editingId ? 'Edit examination' : 'New examination'}</h3><div><label class="label">Name</label><input class="input" id="exam-name" value="${escapeHtml(state.name)}" placeholder="e.g. End of Term 1 Examination" /></div><div class="grid sm-grid-2 gap-4"><div><label class="label">Start date</label><input type="date" class="input" id="exam-start" value="${escapeHtml(state.startDate)}" /></div><div><label class="label">End date</label><input type="date" class="input" id="exam-end" value="${escapeHtml(state.endDate)}" /></div></div><div><label class="label">Academic term</label><select class="input" id="exam-term"><option value="">No term</option>${state.data.terms.map((term) => `<option value="${term.id}" ${state.termId === term.id ? 'selected' : ''}>${escapeHtml(term.name)}</option>`).join('')}</select></div><div><label class="label">Classes sitting this exam</label><div class="flex flex-wrap gap-3">${classes.map((schoolClass) => `<label class="flex items-center gap-1.5 text-sm"><input type="checkbox" data-class-check="${schoolClass.id}" ${state.classIds.includes(schoolClass.id) ? 'checked' : ''}/> ${escapeHtml(schoolClass.name)}</label>`).join('')}</div></div><div class="flex justify-end gap-3"><button class="btn-secondary" id="cancel-exam-btn">Cancel</button><button class="btn-primary" id="create-exam-btn" data-write-collection="examinations">${state.editingId ? 'Save changes' : 'Create'}</button></div></div>`;
  }

  render();
}
