import { escapeHtml, on, qs } from '../../components/dom.js';
import { expenseRepo, updateExpense, deleteExpense } from '../../services/financeService.js';
import { getSchool } from '../../services/schoolService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { createRemoteExpense, updateRemoteExpense, deleteRemoteExpense, loadFinanceWorkspace } from '../../services/supabaseFinanceService.js';

export function renderExpenses(container, { initialOpen = false } = {}) {
  const remote = isSupabaseConfigured();
  const state = {
    formOpen: initialOpen,
    category: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    supplier: '',
    description: '',
    receiptReference: '',
    editId: null,
    reason: '',
    data: null,
    error: '',
  };

  async function render() {
    let currency;
    let expenses;
    try {
      if (remote) {
        state.data ??= await loadFinanceWorkspace();
        currency = state.data.school[0]?.currency ?? 'KES';
        expenses = state.data.expenses;
      } else {
        currency = getSchool()?.currency ?? 'KES';
        expenses = expenseRepo.getAll().filter((expense) => !expense.deletedAt);
      }
      expenses.sort((a, b) => b.date.localeCompare(a.date));
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="expenses-retry">Retry</button></div>`;
      qs(container, '#expenses-retry').addEventListener('click', () => { state.data = null; state.error = ''; render(); });
      return;
    }

    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center">
          <p class="text-sm text-ink-500">Track money going out — supplies, transport, utilities, and more.</p>
          <button class="btn-primary" id="new-expense-btn">+ Record expense</button>
        </div>

        ${state.formOpen ? formHtml() : ''}

        ${
          expenses.length === 0
            ? `<div class="card">${emptyState({ iconHtml: icons.wallet(40), title: 'No expenses recorded yet', actionsHtml: `<button class="btn-primary" id="empty-new-btn">+ Record expense</button>` })}</div>`
            : `<div class="card overflow-x-auto">
                <table class="data-table">
                  <thead><tr><th>Date</th><th>Category</th><th>Supplier</th><th>Description</th><th class="text-right">Amount</th><th></th></tr></thead>
                  <tbody>
                    ${expenses
                      .map(
                        (e) => `<tr><td>${escapeHtml(e.date)}</td><td>${escapeHtml(e.category)}</td><td class="text-ink-500">${escapeHtml(e.supplier ?? '—')}</td><td class="text-ink-500">${escapeHtml(e.description ?? '—')}</td><td class="text-right" style="font-weight:500;">${currency} ${e.amount.toLocaleString()}</td><td><button class="btn-ghost btn-sm" data-write-collection="expenses" data-edit-expense="${e.id}">Edit</button> <button class="btn-ghost btn-sm" data-write-collection="expenses" data-delete-expense="${e.id}">Delete</button></td></tr>`
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>`
        }
      </div>
    `;

    qs(container, '#new-expense-btn').addEventListener('click', () => { resetForm(); state.formOpen = true; render(); });
    const emptyBtn = qs(container, '#empty-new-btn');
    if (emptyBtn) emptyBtn.addEventListener('click', () => { resetForm(); state.formOpen = true; render(); });
    on(container, '[data-edit-expense]', 'click', (e) => {
      const expense = expenses.find((item) => item.id === e.currentTarget.dataset.editExpense);
      if (!expense) return;
      state.editId = expense.id;
      state.formOpen = true;
      state.category = expense.category ?? '';
      state.amount = String(expense.amount ?? '');
      state.date = expense.date ?? '';
      state.supplier = expense.supplier ?? '';
      state.description = expense.description ?? '';
      state.receiptReference = expense.receiptReference ?? '';
      state.reason = '';
      render();
    });
    on(container, '[data-delete-expense]', 'click', async (e) => {
      if (!confirm('Delete this expense record? It will be retained in the audit history.')) return;
      const reason = prompt('Reason for deleting this expense:');
      if (!reason) return;
      try {
        const id = e.currentTarget.dataset.deleteExpense;
        if (remote) await deleteRemoteExpense(id, reason);
        else deleteExpense(id, reason);
        if (state.editId === id) { resetForm(); state.formOpen = false; }
        state.data = null;
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });

    if (state.formOpen) {
      qs(container, '#exp-category').addEventListener('input', (e) => (state.category = e.target.value));
      qs(container, '#exp-amount').addEventListener('input', (e) => (state.amount = e.target.value));
      qs(container, '#exp-date').addEventListener('input', (e) => (state.date = e.target.value));
      qs(container, '#exp-supplier').addEventListener('input', (e) => (state.supplier = e.target.value));
      qs(container, '#exp-description').addEventListener('input', (e) => (state.description = e.target.value));
      qs(container, '#exp-receipt').addEventListener('input', (e) => (state.receiptReference = e.target.value));
      qs(container, '#exp-reason')?.addEventListener('input', (e) => (state.reason = e.target.value));
      qs(container, '#cancel-exp-btn').addEventListener('click', () => { resetForm(); state.formOpen = false; render(); });
      qs(container, '#save-exp-btn').addEventListener('click', async () => {
        const amount = Number(state.amount);
        if (!state.category.trim() || !amount || amount <= 0 || (state.editId && !state.reason.trim())) {
          state.error = 'Enter an expense category and an amount greater than zero.';
          if (state.editId && !state.reason.trim()) state.error = 'Give a reason for editing the expense.';
          await render();
          return;
        }
        const expense = {
          category: state.category.trim(),
          amount,
          date: state.date,
          supplier: state.supplier.trim() || undefined,
          description: state.description.trim() || undefined,
          receiptReference: state.receiptReference.trim() || undefined,
        };
        try {
          if (state.editId) {
            if (remote) await updateRemoteExpense(state.editId, expense, state.reason);
            else updateExpense(state.editId, expense, state.reason);
          } else if (remote) await createRemoteExpense(expense);
          else expenseRepo.create(expense);
          state.error = '';
          state.data = null;
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
    state.category = '';
    state.amount = '';
    state.date = new Date().toISOString().slice(0, 10);
    state.supplier = '';
    state.description = '';
    state.receiptReference = '';
    state.reason = '';
  }

  function formHtml() {
    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editId ? 'Edit expense' : 'Record expense'}</h3>
        <div class="grid sm-grid-3 gap-4">
          <div>
            <label class="label">Category</label>
            <input class="input" id="exp-category" value="${escapeHtml(state.category)}" placeholder="e.g. Utilities" />
          </div>
          <div>
            <label class="label">Amount</label>
            <input type="number" class="input" id="exp-amount" value="${escapeHtml(state.amount)}" />
          </div>
          <div>
            <label class="label">Date</label>
            <input type="date" class="input" id="exp-date" value="${escapeHtml(state.date)}" />
          </div>
        </div>
        <div class="grid sm-grid-2 gap-4">
          <div>
            <label class="label">Supplier (optional)</label>
            <input class="input" id="exp-supplier" value="${escapeHtml(state.supplier)}" />
          </div>
          <div>
            <label class="label">Receipt reference (optional)</label>
            <input class="input" id="exp-receipt" value="${escapeHtml(state.receiptReference)}" />
          </div>
        </div>
        <div>
          <label class="label">Description (optional)</label>
          <input class="input" id="exp-description" value="${escapeHtml(state.description)}" />
        </div>
        ${state.editId ? `<div><label class="label">Change reason (required)</label><input class="input" id="exp-reason" value="${escapeHtml(state.reason)}" /></div>` : ''}
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-exp-btn">Cancel</button>
          <button class="btn-primary" data-write-collection="expenses" id="save-exp-btn">${state.editId ? 'Save changes' : 'Save expense'}</button>
        </div>
      </div>
    `;
  }

  render();
}
