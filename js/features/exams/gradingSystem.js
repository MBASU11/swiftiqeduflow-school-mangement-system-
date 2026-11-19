import { escapeHtml, on, qs } from '../../components/dom.js';
import {
  gradeBandRepo, gradingSystemRepo, getGradeBandsFor, getGradingSystems,
  makeDefaultGradingSystem, ensureDefaultCBCGradingSystem, DEFAULT_CBC_BANDS,
} from '../../services/examService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { loadExamWorkspace, setRemoteDefaultGradingSystem } from '../../services/supabaseExamService.js';
import { SupabaseRepository } from '../../storage/SupabaseRepository.js';

export function renderGradingSystem(container) {
  const remote = isSupabaseConfigured();
  const systemsRepo = remote ? new SupabaseRepository('gradingSystems') : gradingSystemRepo;
  const bandsRepo = remote ? new SupabaseRepository('gradeBands') : gradeBandRepo;
  const state = { selectedId: null, data: null, error: '', systemEdit: null, bandEdit: null };
  if (!remote) ensureDefaultCBCGradingSystem();

  async function render() {
    try {
      state.data = remote
        ? await loadExamWorkspace()
        : { gradingSystems: getGradingSystems(), gradeBands: gradeBandRepo.getAll() };
      if (!state.data.gradingSystems.length && remote) {
        const system = await systemsRepo.create({ name: 'Kenya CBC / CBE', isDefault: true, builtIn: true });
        for (const band of DEFAULT_CBC_BANDS) await bandsRepo.create({ gradingSystemId: system.id, ...band });
        state.data = null;
        return render();
      }
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="grading-retry">Retry</button></div>`;
      qs(container, '#grading-retry').addEventListener('click', () => { state.data = null; render(); });
      return;
    }

    const systems = state.data.gradingSystems;
    if (!state.selectedId && systems.length) state.selectedId = systems.find((system) => system.isDefault)?.id ?? systems[0].id;
    const selected = systems.find((system) => system.id === state.selectedId);
    const bands = selected
      ? state.data.gradeBands.filter((band) => band.gradingSystemId === selected.id).sort((a, b) => b.min - a.min)
      : [];
    const editBand = state.bandEdit;
    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex flex-wrap items-end gap-3">
          <div><label class="label">Grading system</label><select class="input" id="system-select" style="min-width:12rem" ${systems.length ? '' : 'disabled'}>
            ${systems.length ? systems.map((system) => `<option value="${system.id}" ${system.id === state.selectedId ? 'selected' : ''}>${escapeHtml(system.name)}${system.isDefault ? ' (default)' : ''}</option>`).join('') : '<option>No systems yet</option>'}
          </select></div>
          <button class="btn-secondary" id="new-system-btn" data-write-collection="gradingSystems">+ New grading system</button>
          ${selected && !selected.isDefault ? '<button class="btn-secondary" id="make-default-btn">Make default</button>' : ''}
          ${selected ? `<button class="btn-secondary" id="edit-system-btn" data-write-collection="gradingSystems">Edit name</button>${!selected.isDefault && !selected.builtIn ? '<button class="text-bad" id="remove-system-btn" data-write-collection="gradingSystems" style="background:none;border:none;cursor:pointer;">Remove system</button>' : ''}` : ''}
        </div>
        ${state.systemEdit ? `<div class="card card-p flex gap-2"><input class="input" id="system-name" value="${escapeHtml(state.systemEdit.name)}" /><button class="btn-primary btn-sm" id="save-system" data-write-collection="gradingSystems">Save</button><button class="btn-secondary btn-sm" id="cancel-system">Cancel</button></div>` : ''}
        ${!selected
          ? `<div class="card">${emptyState({ iconHtml: icons.award(40), title: 'No grading systems yet', body: 'Create one to define grade bands like A, B, C from score ranges.', actionsHtml: '<button class="btn-primary" id="empty-new-system-btn" data-write-collection="gradingSystems">+ New grading system</button>' })}</div>`
          : `<div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Min</th><th>Max</th><th>Grade</th><th>Points</th><th>Description</th><th></th></tr></thead><tbody>
              ${bands.map((band) => editBand?.id === band.id
                ? `<tr>${['min', 'max', 'grade', 'points', 'description'].map((field) => `<td><input class="input" data-band-edit="${field}" type="${['min', 'max', 'points'].includes(field) ? 'number' : 'text'}" value="${escapeHtml(editBand[field] ?? '')}" /></td>`).join('')}<td><button class="btn-secondary btn-sm" id="save-band" data-write-collection="gradeBands">Save</button><button class="btn-secondary btn-sm" id="cancel-band">Cancel</button></td></tr>`
                : `<tr><td>${band.min}</td><td>${band.max}</td><td style="font-weight:600;">${escapeHtml(band.grade)}</td><td>${band.points ?? '—'}</td><td class="text-ink-500">${escapeHtml(band.description ?? '')}</td><td class="text-right"><button class="btn-secondary btn-sm" data-edit-band="${band.id}" data-write-collection="gradeBands">Edit</button><button data-remove-band="${band.id}" data-write-collection="gradeBands" class="text-bad" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;">Remove</button></td></tr>`).join('')}
              <tr><td><input class="input" style="padding:.4rem;" id="band-min" type="number" placeholder="0" /></td><td><input class="input" style="padding:.4rem;" id="band-max" type="number" placeholder="100" /></td><td><input class="input" style="padding:.4rem;width:4rem;" id="band-grade" placeholder="A" /></td><td><input class="input" style="padding:.4rem;width:4rem;" id="band-points" type="number" placeholder="12" /></td><td><input class="input" style="padding:.4rem;" id="band-desc" placeholder="Exceeding expectation" /></td><td class="text-right"><button class="btn-secondary btn-sm" id="add-band" data-write-collection="gradeBands">+ Add</button></td></tr>
            </tbody></table></div>`}
      </div>`;

    qs(container, '#system-select')?.addEventListener('change', (event) => { state.selectedId = event.target.value; state.systemEdit = null; state.bandEdit = null; render(); });
    const newSystem = async () => {
      const name = prompt('Name this grading system (e.g. "CBC 4-12 scale", "Cambridge A-E"):');
      if (!name?.trim()) return;
      try {
        const created = await systemsRepo.create({ name: name.trim(), isDefault: systems.length === 0 });
        state.selectedId = created.id; state.error = ''; state.data = null;
      } catch (error) { state.error = error.message; }
      render();
    };
    qs(container, '#new-system-btn')?.addEventListener('click', newSystem);
    qs(container, '#empty-new-system-btn')?.addEventListener('click', newSystem);
    qs(container, '#make-default-btn')?.addEventListener('click', async () => {
      try {
        if (remote) await setRemoteDefaultGradingSystem(selected.id);
        else makeDefaultGradingSystem(selected.id);
        state.error = ''; state.data = null;
      } catch (error) { state.error = error.message; }
      render();
    });
    qs(container, '#edit-system-btn')?.addEventListener('click', () => { state.systemEdit = { name: selected.name }; render(); });
    qs(container, '#system-name')?.addEventListener('input', (event) => { state.systemEdit.name = event.target.value; });
    qs(container, '#cancel-system')?.addEventListener('click', () => { state.systemEdit = null; render(); });
    qs(container, '#save-system')?.addEventListener('click', async () => {
      if (!state.systemEdit.name.trim()) return;
      try { await systemsRepo.update(selected.id, { name: state.systemEdit.name.trim() }, 'updated grading system'); state.systemEdit = null; state.error = ''; state.data = null; }
      catch (error) { state.error = error.message; }
      render();
    });
    qs(container, '#remove-system-btn')?.addEventListener('click', async () => {
      if (bands.length) state.error = 'Remove this system’s grade bands first.';
      else if (confirm('Remove this grading system?')) {
        try { await systemsRepo.remove(selected.id, 'removed grading system'); state.selectedId = null; state.error = ''; state.data = null; }
        catch (error) { state.error = error.message; }
      }
      render();
    });
    qs(container, '#add-band')?.addEventListener('click', async () => {
      const min = Number(qs(container, '#band-min').value), max = Number(qs(container, '#band-max').value);
      const grade = qs(container, '#band-grade').value.trim(), points = qs(container, '#band-points').value.trim();
      if (!grade || !Number.isFinite(min) || !Number.isFinite(max) || min > max) { state.error = 'Enter a grade and a valid minimum/maximum range.'; return render(); }
      try { await bandsRepo.create({ gradingSystemId: selected.id, min, max, grade, points: points ? Number(points) : undefined, description: qs(container, '#band-desc').value.trim() || undefined }); state.error = ''; state.data = null; }
      catch (error) { state.error = error.message; }
      render();
    });
    on(container, '[data-edit-band]', 'click', (event) => {
      const band = bands.find((item) => item.id === event.currentTarget.getAttribute('data-edit-band'));
      if (band) { state.bandEdit = { ...band }; render(); }
    });
    on(container, '[data-band-edit]', 'input', (event) => { state.bandEdit[event.target.getAttribute('data-band-edit')] = event.target.value; });
    qs(container, '#cancel-band')?.addEventListener('click', () => { state.bandEdit = null; render(); });
    qs(container, '#save-band')?.addEventListener('click', async () => {
      const patch = { ...state.bandEdit, min: Number(state.bandEdit.min), max: Number(state.bandEdit.max), grade: String(state.bandEdit.grade ?? '').trim(), points: state.bandEdit.points === '' ? undefined : Number(state.bandEdit.points) };
      if (!patch.grade || !Number.isFinite(patch.min) || !Number.isFinite(patch.max) || patch.min > patch.max) { state.error = 'Enter a grade and a valid minimum/maximum range.'; return render(); }
      try { await bandsRepo.update(patch.id, patch, 'updated grade band'); state.bandEdit = null; state.error = ''; state.data = null; }
      catch (error) { state.error = error.message; }
      render();
    });
    on(container, '[data-remove-band]', 'click', async (event) => {
      if (!confirm('Remove this grade band? Marks remain, but grade calculations using this system may change.')) return;
      try { await bandsRepo.remove(event.currentTarget.getAttribute('data-remove-band'), 'removed grade band'); state.error = ''; state.data = null; }
      catch (error) { state.error = error.message; }
      render();
    });
  }
  render();
}
