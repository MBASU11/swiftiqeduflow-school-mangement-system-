import { escapeHtml, qs } from '../../components/dom.js';
import { classRepo, curriculumRepo } from '../../services/academicService.js';
import { LocalStorageRepository } from '../../storage/Repository.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { SupabaseRepository } from '../../storage/SupabaseRepository.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';

const TYPES = [
  ['cbc', 'CBC / CBE'],
  ['cambridge', 'Cambridge'],
  ['custom', 'Custom'],
];

export function renderCurriculaManager(container) {
  const remote = isSupabaseConfigured();
  const repo = remote ? new SupabaseRepository('curricula') : curriculumRepo;
  const classesRepo = remote ? new SupabaseRepository('classes') : classRepo;
  const outcomesRepo = remote ? new SupabaseRepository('learningOutcomes') : new LocalStorageRepository('learningOutcomes', 'learning outcome');
  const state = { formOpen: false, editingId: '', name: '', type: 'cbc', error: '' };

  async function render() {
    let curricula;
    let classes;
    let outcomes = [];
    try {
      [curricula, classes, outcomes] = await Promise.all([repo.getAll(), classesRepo.getAll(), outcomesRepo.getAll()]);
    } catch (error) {
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span><button class="btn-secondary btn-sm" id="curr-retry">Retry</button></div>`;
      qs(container, '#curr-retry').addEventListener('click', render);
      return;
    }

    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center">
          <p class="text-sm text-ink-500">A school can run more than one curriculum — assign each to the relevant classes and subjects.</p>
          <button class="btn-primary" id="new-curriculum-btn" data-write-collection="curricula">+ Add curriculum</button>
        </div>

        ${state.formOpen ? formHtml() : ''}

        ${
          curricula.length === 0
            ? `<div class="card">${emptyState({ iconHtml: icons.book(40), title: 'No curricula yet', actionsHtml: `<button class="btn-primary" id="empty-new-btn" data-write-collection="curricula">+ Add curriculum</button>` })}</div>`
            : `<div class="card" style="overflow:hidden;">
                ${curricula
                  .map(
                    (c) => `<div style="padding:0.9rem 1rem; border-bottom:1px solid var(--ink-50);" class="flex justify-between items-center">
                      <span class="text-sm" style="font-weight:500;">${escapeHtml(c.name)}</span>
                      <span class="flex items-center gap-3"><span class="text-xs text-ink-500">${escapeHtml(TYPES.find(([v]) => v === c.type)?.[1] ?? c.type)}</span>
                        <button class="btn-secondary btn-sm" data-edit-curriculum="${c.id}" data-write-collection="curricula">Edit</button>
                        <button class="text-bad" data-remove-curriculum="${c.id}" data-write-collection="curricula" style="background:none;border:none;cursor:pointer;font-family:inherit;">Remove</button></span>
                    </div>`
                  )
                  .join('')}
              </div>`
        }
      </div>
    `;

    qs(container, '#new-curriculum-btn').addEventListener('click', () => { state.formOpen = true; state.editingId = ''; state.name = ''; state.type = 'cbc'; render(); });
    const emptyBtn = qs(container, '#empty-new-btn');
    if (emptyBtn) emptyBtn.addEventListener('click', () => { state.formOpen = true; state.editingId = ''; state.name = ''; state.type = 'cbc'; render(); });

    if (state.formOpen) wireForm();
    container.querySelectorAll('[data-edit-curriculum]').forEach((button) => {
      button.addEventListener('click', () => {
        const curriculum = curricula.find((item) => item.id === button.getAttribute('data-edit-curriculum'));
        if (!curriculum) return;
        state.formOpen = true;
        state.editingId = curriculum.id;
        state.name = curriculum.name;
        state.type = curriculum.type;
        render();
      });
    });
    container.querySelectorAll('[data-remove-curriculum]').forEach((button) => button.addEventListener('click', async () => {
      const id = button.getAttribute('data-remove-curriculum');
      if (classes.some((item) => item.curriculumId === id) || outcomes.some((item) => item.curriculumId === id)) {
        state.error = 'This curriculum is assigned to classes or learning outcomes. Reassign or remove those records first.';
      } else if (confirm('Remove this curriculum?')) {
        try {
          await repo.remove(id, 'removed curriculum');
          state.error = '';
        } catch (error) { state.error = error.message; }
      }
      await render();
    }));
  }

  function formHtml() {
    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editingId ? 'Edit curriculum' : 'New curriculum'}</h3>
        <div class="grid sm-grid-2 gap-4">
          <div>
            <label class="label">Name</label>
            <input class="input" id="curr-name" value="${escapeHtml(state.name)}" placeholder="e.g. Cambridge Lower Secondary" />
          </div>
          <div>
            <label class="label">Type</label>
            <select class="input" id="curr-type">
              ${TYPES.map(([v, label]) => `<option value="${v}" ${state.type === v ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-curr-btn">Cancel</button>
          <button class="btn-primary" id="save-curr-btn" data-write-collection="curricula">${state.editingId ? 'Save changes' : 'Add curriculum'}</button>
        </div>
      </div>
    `;
  }

  function wireForm() {
    qs(container, '#curr-name').addEventListener('input', (e) => (state.name = e.target.value));
    qs(container, '#curr-type').addEventListener('change', (e) => (state.type = e.target.value));
    qs(container, '#cancel-curr-btn').addEventListener('click', () => { state.formOpen = false; state.editingId = ''; render(); });
    qs(container, '#save-curr-btn').addEventListener('click', async () => {
      if (!state.name.trim()) return;
      try {
        if (state.editingId) await repo.update(state.editingId, { name: state.name.trim(), type: state.type }, 'updated curriculum');
        else await repo.create({ name: state.name.trim(), type: state.type, appliesTo: [] });
        state.name = '';
        state.editingId = '';
        state.formOpen = false;
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
  }

  render();
}
