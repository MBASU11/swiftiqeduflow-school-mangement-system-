import { escapeHtml, on, qs } from '../../components/dom.js';
import { CATEGORIES, CONDITIONS, inventoryItemRepo, updateInventoryCatalogItem, removeInventoryCatalogItem } from '../../services/inventoryService.js';
import { teacherRepo, teacherFullName } from '../../services/peopleService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { createInventoryItem, loadInventoryWorkspace, removeInventoryItem, updateInventoryItem } from '../../services/supabaseInventoryService.js';

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);
const CONDITION_LABEL = Object.fromEntries(CONDITIONS);

export function renderItemsManager(container) {
  const remote = isSupabaseConfigured();
  const state = {
    query: '',
    categoryFilter: '',
    formOpen: false,
    editId: '',
    name: '',
    category: 'other',
    quantity: '1',
    location: '',
    condition: 'good',
    assignedTo: '',
    data: null,
    error: '',
  };

  async function render() {
    let staff;
    let allItems;
    try {
      if (remote) {
        state.data ??= await loadInventoryWorkspace();
        staff = state.data.teachers;
        allItems = state.data.items;
      } else {
        staff = teacherRepo.getAll();
        allItems = inventoryItemRepo.getAll();
      }
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="inventory-retry">Retry</button></div>`;
      qs(container, '#inventory-retry').addEventListener('click', () => { state.data = null; state.error = ''; render(); });
      return;
    }
    let items = allItems;
    if (state.categoryFilter) items = items.filter((i) => i.category === state.categoryFilter);
    if (state.query.trim()) {
      const q = state.query.trim().toLowerCase();
      items = items.filter((i) => i.name.toLowerCase().includes(q) || (i.location || '').toLowerCase().includes(q));
    }
    items = [...items].sort((a, b) => a.name.localeCompare(b.name));

    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center flex-wrap gap-3">
          <p class="text-sm text-ink-500">Everything the school owns, where it is, and who has it.</p>
          <button class="btn-primary" id="new-item-btn">+ Add item</button>
        </div>

        ${state.formOpen ? formHtml(staff) : ''}

        ${
          allItems.length === 0
            ? `<div class="card">${emptyState({
                iconHtml: icons.box(40),
                title: 'No inventory items yet',
                body: 'Add furniture, equipment, books and anything else worth tracking.',
                actionsHtml: `<button class="btn-primary" id="empty-new-btn">+ Add item</button>`,
              })}</div>`
            : `
              <div class="flex flex-wrap gap-3">
                <input class="input" style="max-width:16rem" id="item-search" placeholder="Search by name or location" value="${escapeHtml(state.query)}" />
                <select class="input" style="max-width:14rem" id="item-category-filter">
                  <option value="">All categories</option>
                  ${CATEGORIES.map(([v, label]) => `<option value="${v}" ${state.categoryFilter === v ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
                </select>
              </div>
              ${
                items.length === 0
                  ? `<p class="text-sm text-ink-400">No items match this search.</p>`
                  : `<div class="card overflow-x-auto">
                      <table class="data-table">
                        <thead><tr><th>Item</th><th>Category</th><th class="text-right">Quantity</th><th>Location</th><th>Condition</th><th>Assigned to</th><th></th></tr></thead>
                        <tbody>
                          ${items
                            .map((i) => {
                              const person = staff.find((t) => t.id === i.assignedTo);
                              return `<tr>
                                <td style="font-weight:500;">${escapeHtml(i.name)}</td>
                                <td class="text-ink-600">${escapeHtml(CATEGORY_LABEL[i.category] ?? i.category)}</td>
                                <td class="text-right ${i.quantity <= 3 ? 'low-stock' : ''}">${i.quantity}</td>
                                <td class="text-ink-600">${escapeHtml(i.location || '—')}</td>
                                <td class="text-ink-600">${escapeHtml(CONDITION_LABEL[i.condition] ?? i.condition)}</td>
                                <td class="text-ink-600">${escapeHtml(person ? teacherFullName(person) : '—')}</td>
                                <td class="text-right" style="white-space:nowrap;"><button data-edit="${i.id}" class="text-brand-700" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;">Edit</button><button data-remove="${i.id}" class="text-bad" style="background:none;border:none;cursor:pointer;text-decoration:underline;margin-left:.75rem;font-family:inherit;">Remove</button></td>
                              </tr>`;
                            })
                            .join('')}
                        </tbody>
                      </table>
                    </div>`
              }
            `
        }
      </div>
    `;

    qs(container, '#new-item-btn').addEventListener('click', () => { state.formOpen = true; render(); });
    const emptyBtn = qs(container, '#empty-new-btn');
    if (emptyBtn) emptyBtn.addEventListener('click', () => { state.formOpen = true; render(); });

    const search = qs(container, '#item-search');
    if (search) search.addEventListener('input', (e) => { state.query = e.target.value; render(); const again = qs(container, '#item-search'); again.focus(); again.setSelectionRange(again.value.length, again.value.length); });
    const catFilter = qs(container, '#item-category-filter');
    if (catFilter) catFilter.addEventListener('change', (e) => { state.categoryFilter = e.target.value; render(); });

    if (state.formOpen) wireForm(staff);

    on(container, '[data-edit]', 'click', (e) => {
      const item = allItems.find((entry) => entry.id === e.currentTarget.getAttribute('data-edit'));
      if (!item) return;
      Object.assign(state, { editId: item.id, name: item.name, category: item.category, quantity: String(item.quantity), location: item.location ?? '', condition: item.condition, assignedTo: item.assignedTo ?? '', formOpen: true });
      render();
    });

    on(container, '[data-remove]', 'click', async (e) => {
      if (!confirm('Remove this inventory item? Items with stock history cannot be removed.')) return;
      try {
        const id = e.currentTarget.getAttribute('data-remove');
        if (remote) await removeInventoryItem(id);
        else removeInventoryCatalogItem(id);
        state.data = null;
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
  }

  function formHtml(staff) {
    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editId ? 'Edit item' : 'Add item'}</h3>
        <div class="grid sm-grid-3 gap-4">
          <div>
            <label class="label">Name</label>
            <input class="input" id="item-name" value="${escapeHtml(state.name)}" placeholder="e.g. Plastic chairs" />
          </div>
          <div>
            <label class="label">Category</label>
            <select class="input" id="item-category">
              ${CATEGORIES.map(([v, label]) => `<option value="${v}" ${state.category === v ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="label">Starting quantity</label>
            <input type="number" min="0" class="input" id="item-quantity" value="${escapeHtml(state.quantity)}" ${state.editId ? 'disabled' : ''} />
            ${state.editId ? '<p class="text-xs text-ink-500">Stock changes must be recorded in Stock movements.</p>' : ''}
          </div>
        </div>
        <div class="grid sm-grid-3 gap-4">
          <div>
            <label class="label">Location</label>
            <input class="input" id="item-location" value="${escapeHtml(state.location)}" placeholder="e.g. Store room" />
          </div>
          <div>
            <label class="label">Condition</label>
            <select class="input" id="item-condition">
              ${CONDITIONS.map(([v, label]) => `<option value="${v}" ${state.condition === v ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="label">Assigned to (optional)</label>
            <select class="input" id="item-assigned">
              <option value="">Unassigned</option>
              ${staff.map((t) => `<option value="${t.id}" ${state.assignedTo === t.id ? 'selected' : ''}>${escapeHtml(teacherFullName(t))}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-item-btn">Cancel</button>
          <button class="btn-primary" id="save-item-btn">${state.editId ? 'Save changes' : 'Add item'}</button>
        </div>
      </div>
    `;
  }

  function wireForm() {
    qs(container, '#item-name').addEventListener('input', (e) => (state.name = e.target.value));
    qs(container, '#item-category').addEventListener('change', (e) => (state.category = e.target.value));
    qs(container, '#item-quantity').addEventListener('input', (e) => (state.quantity = e.target.value));
    qs(container, '#item-location').addEventListener('input', (e) => (state.location = e.target.value));
    qs(container, '#item-condition').addEventListener('change', (e) => (state.condition = e.target.value));
    qs(container, '#item-assigned').addEventListener('change', (e) => (state.assignedTo = e.target.value));
    qs(container, '#cancel-item-btn').addEventListener('click', () => { state.formOpen = false; state.editId = ''; render(); });
    qs(container, '#save-item-btn').addEventListener('click', async () => {
      const quantity = Number(state.quantity);
      if (!state.name.trim() || Number.isNaN(quantity) || quantity < 0) return;
      try {
        const item = {
          name: state.name.trim(),
          category: state.category,
          quantity,
          location: state.location.trim() || undefined,
          condition: state.condition,
          assignedTo: state.assignedTo || undefined,
        };
        if (state.editId) {
          if (remote) await updateInventoryItem(state.editId, item);
          else updateInventoryCatalogItem(state.editId, item);
        } else if (remote) await createInventoryItem(item);
        else inventoryItemRepo.create(item);
        state.name = '';
        state.quantity = '1';
        state.location = '';
        state.assignedTo = '';
        state.editId = '';
        state.formOpen = false;
        state.data = null;
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
  }

  render();
}
