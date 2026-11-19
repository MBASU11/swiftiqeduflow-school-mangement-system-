import { escapeHtml, on, qs } from '../../components/dom.js';
import { uuid } from '../../lib/uuid.js';
import { classesSortedByOrder, termRepo } from '../../services/academicService.js';
import { feeStructureRepo, invoiceTotal, updateFeeStructure, deleteFeeStructure } from '../../services/financeService.js';
import { getSchool } from '../../services/schoolService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { createRemoteFeeStructure, updateRemoteFeeStructure, deleteRemoteFeeStructure, loadFinanceWorkspace } from '../../services/supabaseFinanceService.js';

export function renderFeeStructures(container) {
  const remote = isSupabaseConfigured();
  let classes = remote ? [] : classesSortedByOrder();
  let terms = remote ? [] : termRepo.getAll();
  const state = { formOpen: false, editId: null, name: '', classId: '', termId: '', reason: '', items: [{ tempId: uuid(), name: '', amount: '' }], data: null, error: '' };

  async function render() {
    let structures;
    let school;
    try {
      if (remote) {
        state.data ??= await loadFinanceWorkspace();
        classes = state.data.classes.sort((a, b) => a.order - b.order);
        terms = state.data.terms;
        structures = state.data.feeStructures;
        school = state.data.school[0];
      } else {
        structures = feeStructureRepo.getAll().filter((structure) => !structure.archivedAt);
        school = getSchool();
      }
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="fee-structures-retry">Retry</button></div>`;
      qs(container, '#fee-structures-retry').addEventListener('click', () => { state.data = null; state.error = ''; render(); });
      return;
    }
    const currency = school?.currency ?? 'KES';
    const classById = Object.fromEntries(classes.map((c) => [c.id, c]));
    const termById = Object.fromEntries(terms.map((t) => [t.id, t]));

    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center">
          <p class="text-sm text-ink-500">Define fee items once, then generate invoices from them for students.</p>
          <button class="btn-primary" id="new-structure-btn">+ New fee structure</button>
        </div>

        ${state.formOpen ? formHtml() : ''}

        ${
          structures.length === 0
            ? `<div class="card">${emptyState({
                iconHtml: icons.wallet(40),
                title: 'No fee structures yet',
                body: 'Create one to start generating invoices.',
                actionsHtml: `<button class="btn-primary" id="empty-new-btn">+ New fee structure</button>`,
              })}</div>`
            : `<div class="card" style="overflow:hidden;">
                ${structures
                  .map(
                    (s) => `
                  <div style="padding:0.9rem 1rem; border-bottom:1px solid var(--ink-50);">
                    <div class="flex justify-between items-center">
                      <div>
                        <p class="text-sm" style="font-weight:500;">${escapeHtml(s.name)}</p>
                        <p class="text-xs text-ink-500 mt-1">${escapeHtml(classById[s.classId ?? '']?.name ?? 'All classes')} · ${escapeHtml(termById[s.termId ?? '']?.name ?? 'Any term')}</p>
                      </div>
                      <div class="flex items-center gap-2"><p class="text-sm" style="font-weight:600;">${currency} ${invoiceTotal(s.items).toLocaleString()}</p><button class="btn-ghost btn-sm" data-write-collection="feeStructures" data-edit-structure="${s.id}">Edit</button><button class="btn-ghost btn-sm" data-write-collection="feeStructures" data-delete-structure="${s.id}">Delete</button></div>
                    </div>
                    <ul style="list-style:none;margin:0.5rem 0 0;padding:0;" class="text-xs text-ink-500">
                      ${s.items.map((i) => `<li>${escapeHtml(i.name)}: ${currency} ${Number(i.amount).toLocaleString()}</li>`).join('')}
                    </ul>
                  </div>
                `
                  )
                  .join('')}
              </div>`
        }
      </div>
    `;

    qs(container, '#new-structure-btn').addEventListener('click', () => { resetForm(); state.formOpen = true; render(); });
    const emptyBtn = qs(container, '#empty-new-btn');
    if (emptyBtn) emptyBtn.addEventListener('click', () => { resetForm(); state.formOpen = true; render(); });
    on(container, '[data-edit-structure]', 'click', (e) => {
      const structure = structures.find((item) => item.id === e.currentTarget.dataset.editStructure);
      if (!structure) return;
      state.editId = structure.id;
      state.formOpen = true;
      state.name = structure.name;
      state.classId = structure.classId ?? '';
      state.termId = structure.termId ?? '';
      state.reason = '';
      state.items = structure.items.map((item) => ({ ...item, tempId: uuid(), amount: String(item.amount) }));
      render();
    });
    on(container, '[data-delete-structure]', 'click', async (e) => {
      if (!confirm('Delete this fee structure? It will be retained in the audit history, and structures referenced by invoices cannot be deleted.')) return;
      const reason = prompt('Reason for deleting this fee structure:');
      if (!reason) return;
      try {
        const id = e.currentTarget.dataset.deleteStructure;
        if (remote) await deleteRemoteFeeStructure(id, reason);
        else deleteFeeStructure(id, reason);
        if (state.editId === id) { resetForm(); state.formOpen = false; }
        state.data = null;
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });

    if (state.formOpen) {
      qs(container, '#fs-name').addEventListener('input', (e) => (state.name = e.target.value));
      qs(container, '#fs-reason')?.addEventListener('input', (e) => (state.reason = e.target.value));
      const classSelect = qs(container, '#fs-class');
      if (classSelect) classSelect.addEventListener('change', (e) => (state.classId = e.target.value));
      const termSelect = qs(container, '#fs-term');
      if (termSelect) termSelect.addEventListener('change', (e) => (state.termId = e.target.value));

      on(container, '[data-item-name]', 'input', (e) => {
        const id = e.target.getAttribute('data-item-name');
        state.items.find((i) => i.tempId === id).name = e.target.value;
      });
      on(container, '[data-item-amount]', 'input', (e) => {
        const id = e.target.getAttribute('data-item-amount');
        state.items.find((i) => i.tempId === id).amount = e.target.value;
      });
      on(container, '[data-remove-item]', 'click', (e) => {
        state.items = state.items.filter((i) => i.tempId !== e.currentTarget.getAttribute('data-remove-item'));
        render();
      });
      qs(container, '#add-item-btn').addEventListener('click', () => {
        state.items.push({ tempId: uuid(), name: '', amount: '' });
        render();
      });
      qs(container, '#cancel-fs-btn').addEventListener('click', () => { resetForm(); state.formOpen = false; render(); });
      qs(container, '#save-fs-btn').addEventListener('click', async () => {
        const items = state.items.filter((i) => i.name.trim() && i.amount !== '').map((i) => ({ id: i.id ?? uuid(), name: i.name.trim(), amount: Number(i.amount) }));
        if (!state.name.trim() || items.length === 0 || items.some((item) => !Number.isFinite(item.amount) || item.amount <= 0) || (state.editId && !state.reason.trim())) {
          state.error = 'Enter a fee structure name and at least one item with an amount greater than zero.';
          if (state.editId && !state.reason.trim()) state.error = 'Give a reason for editing the fee structure.';
          await render();
          return;
        }
        try {
          const structure = { name: state.name.trim(), classId: state.classId || undefined, termId: state.termId || undefined, items };
          if (state.editId) {
            if (remote) await updateRemoteFeeStructure(state.editId, structure, state.reason);
            else updateFeeStructure(state.editId, structure, state.reason);
          } else if (remote) await createRemoteFeeStructure(structure);
          else feeStructureRepo.create(structure);
          state.data = null;
          state.error = '';
          resetForm();
          state.formOpen = false;
        } catch (error) {
          state.error = error.message;
        }
        await render();
      });
    }
  }

  function resetForm() {
    state.editId = null;
    state.name = '';
    state.classId = '';
    state.termId = '';
    state.reason = '';
    state.items = [{ tempId: uuid(), name: '', amount: '' }];
  }

  function formHtml() {
    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editId ? 'Edit fee structure' : 'New fee structure'}</h3>
        <div class="grid sm-grid-3 gap-4">
          <div>
            <label class="label">Name</label>
            <input class="input" id="fs-name" value="${escapeHtml(state.name)}" placeholder="e.g. Term 1 Fees" />
          </div>
          <div>
            <label class="label">Class (optional)</label>
            <select class="input" id="fs-class">
              <option value="">All classes</option>
              ${classes.map((c) => `<option value="${c.id}" ${state.classId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="label">Term (optional)</label>
            <select class="input" id="fs-term">
              <option value="">Any term</option>
              ${terms.map((t) => `<option value="${t.id}" ${state.termId === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div>
          <label class="label">Fee items</label>
          <div class="space-y-2">
            ${state.items
              .map(
                (i) => `
              <div class="flex gap-2">
                <input class="input flex-1" placeholder="e.g. Tuition" data-item-name="${i.tempId}" value="${escapeHtml(i.name)}" />
                <input type="number" class="input" style="width:8rem" placeholder="Amount" data-item-amount="${i.tempId}" value="${escapeHtml(i.amount)}" />
                ${state.items.length > 1 ? `<button class="btn-ghost" data-remove-item="${i.tempId}">Remove</button>` : ''}
              </div>
            `
              )
              .join('')}
          </div>
          <button class="btn-secondary btn-sm" style="margin-top:0.5rem;" id="add-item-btn">+ Add item</button>
        </div>
        ${state.editId ? `<div><label class="label">Change reason (required)</label><input class="input" id="fs-reason" value="${escapeHtml(state.reason)}" /></div>` : ''}
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-fs-btn">Cancel</button>
          <button class="btn-primary" data-write-collection="feeStructures" id="save-fs-btn">${state.editId ? 'Save changes' : 'Create'}</button>
        </div>
      </div>
    `;
  }

  render();
}
