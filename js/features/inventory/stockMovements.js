import { escapeHtml, qs } from '../../components/dom.js';
import { CATEGORIES, getTransactionsForItem, inventoryItemRepo, inventoryTransactionRepo, stockIn, stockOut, correctStockMovement } from '../../services/inventoryService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { correctRemoteInventoryMovement, loadInventoryWorkspace, recordRemoteInventoryMovement, transactionsForItem } from '../../services/supabaseInventoryService.js';

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);

export function renderStockMovements(container) {
  if (isSupabaseConfigured()) return renderRemoteStockMovements(container);
  const items = inventoryItemRepo.getAll();
  const state = { itemId: items[0]?.id ?? '', direction: 'in', quantity: '', note: '', error: '', saved: false };

  function render() {
    if (items.length === 0) {
      container.innerHTML = `<div class="card">${emptyState({ iconHtml: icons.box(40), title: 'No inventory items yet', body: 'Add an item in the Items tab before recording stock movements.' })}</div>`;
      return;
    }
    const item = inventoryItemRepo.getById(state.itemId);
    const history = item ? getTransactionsForItem(item.id) : [];

    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="label">Item</label>
            <select class="input" id="mv-item" style="min-width:14rem">
              ${items.map((i) => `<option value="${i.id}" ${state.itemId === i.id ? 'selected' : ''}>${escapeHtml(i.name)} (${escapeHtml(CATEGORY_LABEL[i.category] ?? i.category)})</option>`).join('')}
            </select>
          </div>
          <div class="card card-p" style="padding:0.6rem 1rem;">
            <p class="text-xs text-ink-500">Current stock</p>
            <p class="text-lg" style="font-weight:600;">${item ? item.quantity : '—'}</p>
          </div>
        </div>

        <div class="card card-p space-y-4">
          <div class="pill-group">
            <button class="pill ${state.direction === 'in' ? 'active' : ''}" id="dir-in">Stock in</button>
            <button class="pill ${state.direction === 'out' ? 'active' : ''}" id="dir-out">Stock out</button>
          </div>
          <div class="grid sm-grid-2 gap-4">
            <div>
              <label class="label">Quantity</label>
              <input type="number" min="1" class="input" id="mv-quantity" value="${escapeHtml(state.quantity)}" />
            </div>
            <div>
              <label class="label">Note (optional)</label>
              <input class="input" id="mv-note" value="${escapeHtml(state.note)}" placeholder="${state.direction === 'in' ? 'e.g. Delivery from supplier' : 'e.g. Issued to Grade 6'}" />
            </div>
          </div>
          ${state.error ? `<p class="field-error" id="mv-error">${escapeHtml(state.error)}</p>` : ''}
          ${state.saved ? `<p class="text-sm text-good" id="mv-saved">Recorded.</p>` : ''}
          <div class="flex justify-end"><button class="btn-primary" id="save-mv-btn">${state.direction === 'in' ? 'Add stock' : 'Remove stock'}</button></div>
        </div>

        <div>
          <h3 class="text-sm text-ink-700 mb-2" style="font-weight:600;">History</h3>
          ${
            history.length === 0
              ? `<p class="text-sm text-ink-400">No stock movements recorded yet.</p>`
              : `<div class="card overflow-x-auto">
                  <table class="data-table">
                    <thead><tr><th>Date</th><th>Movement</th><th class="text-right">Quantity</th><th>Note</th><th></th></tr></thead>
                    <tbody>
                      ${history
                        .map(
                          (t) => `<tr>
                            <td>${escapeHtml(t.date)}</td>
                            <td><span class="badge ${t.type === 'in' ? 'badge-good' : 'badge-gold'}">${t.type === 'in' ? 'Stock in' : 'Stock out'}</span></td>
                            <td class="text-right">${t.quantity}</td>
                            <td class="text-ink-500">${escapeHtml(t.note ?? '—')}</td>
                            <td>${inventoryTransactionRepo.getAll().some((entry) => entry.correctionOf === t.id) ? '<span class="text-xs text-ink-500">Corrected</span>' : `<button data-correct="${t.id}" class="btn-ghost btn-sm">Reverse</button>`}</td>
                          </tr>`
                        )
                        .join('')}
                    </tbody>
                  </table>
                </div>`
          }
        </div>
      </div>
    `;

    qs(container, '#mv-item').addEventListener('change', (e) => {
      state.itemId = e.target.value;
      state.error = '';
      state.saved = false;
      render();
    });
    qs(container, '#dir-in').addEventListener('click', () => { state.direction = 'in'; state.error = ''; render(); });
    qs(container, '#dir-out').addEventListener('click', () => { state.direction = 'out'; state.error = ''; render(); });
    qs(container, '#mv-quantity').addEventListener('input', (e) => { state.quantity = e.target.value; state.saved = false; });
    qs(container, '#mv-note').addEventListener('input', (e) => (state.note = e.target.value));
    qs(container, '#save-mv-btn').addEventListener('click', () => {
      const quantity = Number(state.quantity);
      const result = state.direction === 'in' ? stockIn(state.itemId, quantity, state.note.trim()) : stockOut(state.itemId, quantity, state.note.trim());
      if (!result.ok) {
        state.error = result.error;
        state.saved = false;
      } else {
        state.error = '';
        state.saved = true;
        state.quantity = '';
        state.note = '';
      }
      render();
    });
    on(container, '[data-correct]', 'click', (event) => {
      const id = event.currentTarget.dataset.correct;
      if (!confirm('Record an audited reversal for this movement? The original entry will remain in history.')) return;
      const result = correctStockMovement(id);
      state.error = result.ok ? '' : result.error;
      render();
    });
  }

  render();
}

async function renderRemoteStockMovements(container) {
  const state = { data: null, itemId: '', direction: 'in', quantity: '', note: '', error: '', saved: false, busy: false };

  async function render() {
    try {
      state.data ??= await loadInventoryWorkspace();
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="movement-retry">Retry</button></div>`;
      qs(container, '#movement-retry').addEventListener('click', () => { state.data = null; state.error = ''; render(); });
      return;
    }
    const items = state.data.items;
    state.itemId ||= items[0]?.id ?? '';
    if (items.length === 0) {
      container.innerHTML = `<div class="card">${emptyState({ iconHtml: icons.box(40), title: 'No inventory items yet', body: 'Add an item in the Items tab before recording stock movements.' })}</div>`;
      return;
    }
    const item = items.find((entry) => entry.id === state.itemId);
    const history = transactionsForItem(state.data, state.itemId);
    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex flex-wrap items-end gap-3">
          <div><label class="label">Item</label><select class="input" id="mv-item" style="min-width:14rem">${items.map((entry) => `<option value="${entry.id}" ${state.itemId === entry.id ? 'selected' : ''}>${escapeHtml(entry.name)} (${escapeHtml(CATEGORY_LABEL[entry.category] ?? entry.category)})</option>`).join('')}</select></div>
          <div class="card card-p" style="padding:0.6rem 1rem;"><p class="text-xs text-ink-500">Current stock</p><p class="text-lg" style="font-weight:600;">${item?.quantity ?? '—'}</p></div>
        </div>
        <div class="card card-p space-y-4">
          <div class="pill-group"><button class="pill ${state.direction === 'in' ? 'active' : ''}" id="dir-in">Stock in</button><button class="pill ${state.direction === 'out' ? 'active' : ''}" id="dir-out">Stock out</button></div>
          <div class="grid sm-grid-2 gap-4"><div><label class="label">Quantity</label><input type="number" min="1" class="input" id="mv-quantity" value="${escapeHtml(state.quantity)}" ${state.busy ? 'disabled' : ''} /></div><div><label class="label">Note (optional)</label><input class="input" id="mv-note" value="${escapeHtml(state.note)}" placeholder="${state.direction === 'in' ? 'e.g. Delivery from supplier' : 'e.g. Issued to Grade 6'}" ${state.busy ? 'disabled' : ''} /></div></div>
          ${state.error ? `<p class="field-error" id="mv-error">${escapeHtml(state.error)}</p>` : ''}
          ${state.saved ? '<p class="text-sm text-good" id="mv-saved">Recorded.</p>' : ''}
          <div class="flex justify-end"><button class="btn-primary" id="save-mv-btn" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Saving...' : state.direction === 'in' ? 'Add stock' : 'Remove stock'}</button></div>
        </div>
        <div><h3 class="text-sm text-ink-700 mb-2" style="font-weight:600;">History</h3>${history.length === 0 ? '<p class="text-sm text-ink-400">No stock movements recorded yet.</p>' : `<div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Date</th><th>Movement</th><th class="text-right">Quantity</th><th>Note</th><th></th></tr></thead><tbody>${history.map((transaction) => `<tr><td>${escapeHtml(transaction.date)}</td><td><span class="badge ${transaction.type === 'in' ? 'badge-good' : 'badge-gold'}">${transaction.type === 'in' ? 'Stock in' : 'Stock out'}</span></td><td class="text-right">${transaction.quantity}</td><td class="text-ink-500">${escapeHtml(transaction.note ?? '—')}</td><td>${state.data.transactions.some((entry) => entry.note?.includes(`reversal of movement ${transaction.id}`)) ? '<span class="text-xs text-ink-500">Corrected</span>' : `<button data-correct="${transaction.id}" class="btn-ghost btn-sm">Reverse</button>`}</td></tr>`).join('')}</tbody></table></div>`}</div>
      </div>`;

    qs(container, '#mv-item').addEventListener('change', (event) => { state.itemId = event.target.value; state.error = ''; state.saved = false; render(); });
    qs(container, '#dir-in').addEventListener('click', () => { state.direction = 'in'; state.error = ''; state.saved = false; render(); });
    qs(container, '#dir-out').addEventListener('click', () => { state.direction = 'out'; state.error = ''; state.saved = false; render(); });
    qs(container, '#mv-quantity').addEventListener('input', (event) => { state.quantity = event.target.value; state.saved = false; });
    qs(container, '#mv-note').addEventListener('input', (event) => { state.note = event.target.value; });
    qs(container, '#save-mv-btn').addEventListener('click', async () => {
      state.busy = true;
      state.error = '';
      render();
      const result = await recordRemoteInventoryMovement(state.itemId, state.direction, state.quantity, state.note);
      if (!result.ok) {
        state.error = result.error;
        state.saved = false;
      } else {
        state.error = '';
        state.saved = true;
        state.quantity = '';
        state.note = '';
        state.data = null;
      }
      state.busy = false;
      await render();
    });
    on(container, '[data-correct]', 'click', async (event) => {
      const id = event.currentTarget.dataset.correct;
      if (!confirm('Record an audited reversal for this movement? The original entry will remain in history.')) return;
      state.busy = true;
      state.error = '';
      render();
      const result = await correctRemoteInventoryMovement(id);
      state.busy = false;
      if (!result.ok) state.error = result.error;
      else state.data = null;
      await render();
    });
  }

  render();
}
