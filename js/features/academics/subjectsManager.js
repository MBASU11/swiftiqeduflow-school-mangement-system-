import { escapeHtml, on, qs } from '../../components/dom.js';
import { subjectRepo, classesSortedByOrder, curriculumRepo } from '../../services/academicService.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { SupabaseRepository } from '../../storage/SupabaseRepository.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';

const BLANK = { editingId: '', name: '', code: '', curriculumId: '', classIds: [] };

export function renderSubjectsManager(container) {
  const remote = isSupabaseConfigured();
  const subjectsRepo = remote ? new SupabaseRepository('subjects') : subjectRepo;
  const classesRepo = remote ? new SupabaseRepository('classes') : null;
  const curriculaRepo = remote ? new SupabaseRepository('curricula') : curriculumRepo;
  const state = { formOpen: false, ...BLANK, filterClassId: '', error: '' };

  function resetForm() {
    Object.assign(state, BLANK, { classIds: [] });
    state.formOpen = false;
  }

  async function render() {
    let subjects;
    let classes;
    let curricula;
    try {
      [subjects, classes, curricula] = remote
        ? await Promise.all([subjectsRepo.getAll(), classesRepo.getAll(), curriculaRepo.getAll()])
        : [subjectRepo.getAll(), classesSortedByOrder(), curriculumRepo.getAll()];
      classes.sort((a, b) => a.order - b.order);
    } catch (error) {
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span><button class="btn-secondary btn-sm" id="subjects-retry">Retry</button></div>`;
      qs(container, '#subjects-retry').addEventListener('click', render);
      return;
    }
    const classById = Object.fromEntries(classes.map((c) => [c.id, c]));
    const visible = state.filterClassId
      ? subjects.filter((s) => (s.classIds || []).includes(state.filterClassId))
      : subjects;
    visible.sort((a, b) => a.name.localeCompare(b.name));

    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center flex-wrap gap-3">
          <div class="flex items-center gap-3 flex-wrap">
            <p class="text-sm text-ink-500">Each subject is taught in the grades you tick. Report cards and timetables only show a grade's own subjects.</p>
          </div>
          <div class="flex items-center gap-3">
            <select class="input" id="subject-filter" style="min-width:10rem" aria-label="Filter by grade">
              <option value="">All grades</option>
              ${classes.map((c) => `<option value="${c.id}" ${state.filterClassId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
            <button class="btn-primary" id="new-subject-btn">+ Add subject</button>
          </div>
        </div>

        ${state.formOpen ? formHtml(classes, curricula) : ''}

        ${
          subjects.length === 0
            ? `<div class="card">${emptyState({ iconHtml: icons.book(40), title: 'No subjects yet', actionsHtml: `<button class="btn-primary" id="empty-new-btn">+ Add subject</button>` })}</div>`
            : visible.length === 0
            ? `<div class="card">${emptyState({ title: 'No subjects for this grade yet', body: 'Edit a subject and tick this grade, or use Manage subjects on the Classes tab.' })}</div>`
            : `<div class="card" style="overflow:hidden;">
                ${visible
                  .map(
                    (s) => `
                  <div style="padding:0.9rem 1rem; border-bottom:1px solid var(--ink-50);">
                    <div class="flex justify-between items-center gap-3">
                      <div>
                        <p class="text-sm" style="font-weight:500;">${escapeHtml(s.name)} <span class="text-ink-400">(${escapeHtml(s.code)})</span></p>
                        <p class="text-xs text-ink-500 mt-1">${(s.classIds || []).map((id) => classById[id]?.name).filter(Boolean).join(', ') || 'Not assigned to any grade'}</p>
                      </div>
                      <div class="flex gap-3">
                        <button data-edit="${s.id}" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;">Edit</button>
                        <button data-remove="${s.id}" class="text-bad" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;">Remove</button>
                      </div>
                    </div>
                  </div>`
                  )
                  .join('')}
              </div>`
        }
      </div>
    `;

    qs(container, '#subject-filter').addEventListener('change', (e) => { state.filterClassId = e.target.value; render(); });
    qs(container, '#new-subject-btn').addEventListener('click', () => { resetForm(); state.formOpen = true; render(); });
    const emptyBtn = qs(container, '#empty-new-btn');
    if (emptyBtn) emptyBtn.addEventListener('click', () => { resetForm(); state.formOpen = true; render(); });

    if (state.formOpen) wireForm(classes);

    on(container, '[data-edit]', 'click', (e) => {
      const subject = subjects.find((s) => s.id === e.currentTarget.getAttribute('data-edit'));
      if (!subject) return;
      Object.assign(state, {
        formOpen: true,
        editingId: subject.id,
        name: subject.name,
        code: subject.code ?? '',
        curriculumId: subject.curriculumId ?? '',
        classIds: [...(subject.classIds ?? [])],
        error: '',
      });
      render().then(() => qs(container, '#subj-name')?.scrollIntoView?.({ block: 'center' }));
    });

    on(container, '[data-remove]', 'click', async (e) => {
      const subject = subjects.find((s) => s.id === e.currentTarget.getAttribute('data-remove'));
      if (!confirm(`Remove ${subject?.name ?? 'this subject'}? Marks already entered for it will no longer appear on report cards.`)) return;
      try {
        await subjectsRepo.remove(e.currentTarget.getAttribute('data-remove'), 'removed subject');
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
  }

  function formHtml(classes, curricula) {
    const editing = Boolean(state.editingId);
    const allChecked = classes.length > 0 && classes.every((c) => state.classIds.includes(c.id));
    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">${editing ? 'Edit subject' : 'New subject'}</h3>
        <div class="grid sm-grid-3 gap-4">
          <div>
            <label class="label">Name</label>
            <input class="input" id="subj-name" value="${escapeHtml(state.name)}" placeholder="e.g. Geography" />
          </div>
          <div>
            <label class="label">Code</label>
            <input class="input" id="subj-code" value="${escapeHtml(state.code)}" placeholder="e.g. GEO" />
          </div>
          <div>
            <label class="label">Curriculum (optional)</label>
            <select class="input" id="subj-curriculum">
              <option value="">None</option>
              ${curricula.map((c) => `<option value="${c.id}" ${state.curriculumId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div>
          <div class="flex items-center justify-between">
            <label class="label">Grades that take this subject</label>
            ${classes.length ? `<label class="flex items-center gap-1.5 text-xs text-ink-500"><input type="checkbox" id="subj-all" ${allChecked ? 'checked' : ''}/> Select all</label>` : ''}
          </div>
          <div class="flex flex-wrap gap-3">
            ${
              classes.length === 0
                ? `<p class="text-sm text-ink-400">No classes set up yet.</p>`
                : classes.map((c) => `<label class="flex items-center gap-1.5 text-sm"><input type="checkbox" data-class-check="${c.id}" ${state.classIds.includes(c.id) ? 'checked' : ''}/> ${escapeHtml(c.name)}</label>`).join('')
            }
          </div>
        </div>
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-subj-btn">Cancel</button>
          <button class="btn-primary" id="save-subj-btn">${editing ? 'Save changes' : 'Add subject'}</button>
        </div>
      </div>
    `;
  }

  function wireForm(classes) {
    qs(container, '#subj-name').addEventListener('input', (e) => (state.name = e.target.value));
    qs(container, '#subj-code').addEventListener('input', (e) => (state.code = e.target.value));
    qs(container, '#subj-curriculum').addEventListener('change', (e) => (state.curriculumId = e.target.value));
    on(container, '[data-class-check]', 'change', (e) => {
      const id = e.target.getAttribute('data-class-check');
      state.classIds = e.target.checked ? [...state.classIds, id] : state.classIds.filter((c) => c !== id);
      const all = qs(container, '#subj-all');
      if (all) all.checked = classes.every((c) => state.classIds.includes(c.id));
    });
    const all = qs(container, '#subj-all');
    if (all) {
      all.addEventListener('change', (e) => {
        state.classIds = e.target.checked ? classes.map((c) => c.id) : [];
        container.querySelectorAll('[data-class-check]').forEach((box) => (box.checked = e.target.checked));
      });
    }
    qs(container, '#cancel-subj-btn').addEventListener('click', () => { resetForm(); render(); });
    qs(container, '#save-subj-btn').addEventListener('click', async () => {
      if (!state.name.trim()) { state.error = 'Enter a subject name.'; await render(); return; }
      const values = {
        name: state.name.trim(),
        code: (state.code.trim() || state.name.trim().slice(0, 3)).toUpperCase(),
        curriculumId: state.curriculumId || undefined,
        classIds: state.classIds,
      };
      try {
        if (state.editingId) await subjectsRepo.update(state.editingId, values, 'updated subject');
        else await subjectsRepo.create({ ...values, teacherIds: [] });
        resetForm();
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
  }

  render();
}
