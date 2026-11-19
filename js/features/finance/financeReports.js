import { escapeHtml, qs } from '../../components/dom.js';
import { studentRepo, fullName } from '../../services/studentService.js';
import { classesSortedByOrder } from '../../services/academicService.js';
import { getSchool } from '../../services/schoolService.js';
import {
  collectionsInRange,
  collectionsByMethod,
  allStudentBalances,
  classBalances,
  totalExpensesInRange,
} from '../../services/financeService.js';
import { emptyState } from '../../components/emptyState.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { balancesForStudents, financeCollections, loadFinanceWorkspace } from '../../services/supabaseFinanceService.js';

const METHOD_LABELS = { mpesa: 'M-Pesa', bank: 'Bank', cash: 'Cash', cheque: 'Cheque', other: 'Other' };

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function renderFinanceReports(container) {
  if (isSupabaseConfigured()) return renderRemoteFinanceReports(container);
  const classes = classesSortedByOrder();
  const classById = Object.fromEntries(classes.map((c) => [c.id, c]));
  const state = { startDate: daysAgoISO(30), endDate: todayISO() };

  function render() {
    const currency = getSchool()?.currency ?? 'KES';
    const students = studentRepo.getAll().filter((s) => s.status === 'active');
    const payments = collectionsInRange(state.startDate, state.endDate);
    const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);
    const byMethod = collectionsByMethod(payments);
    const expenses = totalExpensesInRange(state.startDate, state.endDate);
    const balances = allStudentBalances(students).filter((r) => r.balance > 0).sort((a, b) => b.balance - a.balance);
    const byClass = classBalances(students, classById);

    container.innerHTML = `
      <div class="space-y-5">
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="label">From</label>
            <input type="date" class="input" id="start-date" value="${escapeHtml(state.startDate)}" />
          </div>
          <div>
            <label class="label">To</label>
            <input type="date" class="input" id="end-date" value="${escapeHtml(state.endDate)}" />
          </div>
        </div>

        <div class="grid grid-2 sm-grid-3 gap-4">
          <div class="card card-p"><p class="text-sm text-ink-500">Collected in range</p><p class="text-2xl mt-1" style="font-weight:600;font-family:var(--font-display);">${currency} ${totalCollected.toLocaleString()}</p></div>
          <div class="card card-p"><p class="text-sm text-ink-500">Expenses in range</p><p class="text-2xl mt-1" style="font-weight:600;font-family:var(--font-display);">${currency} ${expenses.toLocaleString()}</p></div>
          <div class="card card-p"><p class="text-sm text-ink-500">Net</p><p class="text-2xl mt-1" style="font-weight:600;font-family:var(--font-display);">${currency} ${(totalCollected - expenses).toLocaleString()}</p></div>
        </div>

        <div class="card card-p">
          <h3 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Collections by payment method</h3>
          ${
            Object.keys(byMethod).length === 0
              ? `<p class="text-sm text-ink-400">No payments in this range.</p>`
              : `<ul style="list-style:none;margin:0;padding:0;" class="space-y-2">
                  ${Object.entries(byMethod)
                    .map(([method, amount]) => `<li class="flex justify-between text-sm"><span>${escapeHtml(METHOD_LABELS[method] ?? method)}</span><span style="font-weight:500;">${currency} ${amount.toLocaleString()}</span></li>`)
                    .join('')}
                </ul>`
          }
        </div>

        <div class="card card-p">
          <h3 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Class balances</h3>
          ${
            Object.keys(byClass).length === 0
              ? `<p class="text-sm text-ink-400">No invoices yet.</p>`
              : `<div class="overflow-x-auto"><table class="data-table">
                  <thead><tr><th>Class</th><th class="text-right">Invoiced</th><th class="text-right">Paid</th><th class="text-right">Balance</th></tr></thead>
                  <tbody>
                    ${Object.entries(byClass)
                      .map(([name, row]) => `<tr><td>${escapeHtml(name)}</td><td class="text-right">${currency} ${row.invoiced.toLocaleString()}</td><td class="text-right">${currency} ${row.paid.toLocaleString()}</td><td class="text-right" style="font-weight:500;">${currency} ${row.balance.toLocaleString()}</td></tr>`)
                      .join('')}
                  </tbody>
                </table></div>`
          }
        </div>

        <div>
          <h3 class="text-sm text-ink-700 mb-2" style="font-weight:600;">Outstanding fees</h3>
          ${
            balances.length === 0
              ? `<div class="card">${emptyState({ title: 'No outstanding balances', body: 'Every invoiced student is fully paid up.' })}</div>`
              : `<div class="card overflow-x-auto">
                  <table class="data-table">
                    <thead><tr><th>Student</th><th>Class</th><th class="text-right">Invoiced</th><th class="text-right">Paid</th><th class="text-right">Balance</th></tr></thead>
                    <tbody>
                      ${balances
                        .map(
                          (r) => `<tr><td style="font-weight:500;">${escapeHtml(fullName(r.student))}</td><td class="text-ink-500">${escapeHtml(classById[r.student.classId ?? '']?.name ?? '—')}</td><td class="text-right">${currency} ${r.totalInvoiced.toLocaleString()}</td><td class="text-right">${currency} ${r.totalPaid.toLocaleString()}</td><td class="text-right" style="font-weight:600;color:var(--bad);">${currency} ${r.balance.toLocaleString()}</td></tr>`
                        )
                        .join('')}
                    </tbody>
                  </table>
                </div>`
          }
        </div>
      </div>
    `;

    qs(container, '#start-date').addEventListener('change', (e) => { state.startDate = e.target.value; render(); });
    qs(container, '#end-date').addEventListener('change', (e) => { state.endDate = e.target.value; render(); });
  }

  render();
}

function renderRemoteFinanceReports(container) {
  const state = { startDate: daysAgoISO(30), endDate: todayISO(), data: null, error: '' };

  async function render() {
    try {
      state.data ??= await loadFinanceWorkspace();
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="finance-reports-retry">Retry</button></div>`;
      qs(container, '#finance-reports-retry').addEventListener('click', () => { state.data = null; state.error = ''; render(); });
      return;
    }
    const data = state.data;
    const currency = data.school[0]?.currency ?? 'KES';
    const classById = Object.fromEntries(data.classes.map((schoolClass) => [schoolClass.id, schoolClass]));
    const { payments, expenses: rangedExpenses } = financeCollections(data, state.startDate, state.endDate);
    const totalCollected = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const expenseTotal = rangedExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
    const byMethod = payments.reduce((result, payment) => ((result[payment.method] = (result[payment.method] ?? 0) + Number(payment.amount)), result), {});
    const balances = balancesForStudents(data).filter((row) => row.balance > 0).sort((a, b) => b.balance - a.balance);
    const classTotals = {};
    balancesForStudents(data).forEach((row) => {
      const className = classById[row.student.classId ?? '']?.name ?? 'No class';
      classTotals[className] ??= { invoiced: 0, paid: 0, balance: 0 };
      classTotals[className].invoiced += row.totalInvoiced;
      classTotals[className].paid += row.totalPaid;
      classTotals[className].balance += row.balance;
    });
    container.innerHTML = `
      <div class="space-y-5">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex flex-wrap items-end gap-3"><div><label class="label">From</label><input type="date" class="input" id="start-date" value="${escapeHtml(state.startDate)}" /></div><div><label class="label">To</label><input type="date" class="input" id="end-date" value="${escapeHtml(state.endDate)}" /></div></div>
        <div class="grid grid-2 sm-grid-3 gap-4"><div class="card card-p"><p class="text-sm text-ink-500">Collected in range</p><p class="text-2xl mt-1" style="font-weight:600;font-family:var(--font-display);">${currency} ${totalCollected.toLocaleString()}</p></div><div class="card card-p"><p class="text-sm text-ink-500">Expenses in range</p><p class="text-2xl mt-1" style="font-weight:600;font-family:var(--font-display);">${currency} ${expenseTotal.toLocaleString()}</p></div><div class="card card-p"><p class="text-sm text-ink-500">Net</p><p class="text-2xl mt-1" style="font-weight:600;font-family:var(--font-display);">${currency} ${(totalCollected - expenseTotal).toLocaleString()}</p></div></div>
        <div class="card card-p"><h3 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Collections by payment method</h3>${Object.keys(byMethod).length === 0 ? '<p class="text-sm text-ink-400">No payments in this range.</p>' : `<ul style="list-style:none;margin:0;padding:0;" class="space-y-2">${Object.entries(byMethod).map(([method, amount]) => `<li class="flex justify-between text-sm"><span>${escapeHtml(METHOD_LABELS[method] ?? method)}</span><span style="font-weight:500;">${currency} ${amount.toLocaleString()}</span></li>`).join('')}</ul>`}</div>
        <div class="card card-p"><h3 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Class balances</h3>${Object.keys(classTotals).length === 0 ? '<p class="text-sm text-ink-400">No invoices yet.</p>' : `<div class="overflow-x-auto"><table class="data-table"><thead><tr><th>Class</th><th class="text-right">Invoiced</th><th class="text-right">Paid</th><th class="text-right">Balance</th></tr></thead><tbody>${Object.entries(classTotals).map(([name, row]) => `<tr><td>${escapeHtml(name)}</td><td class="text-right">${currency} ${row.invoiced.toLocaleString()}</td><td class="text-right">${currency} ${row.paid.toLocaleString()}</td><td class="text-right">${currency} ${row.balance.toLocaleString()}</td></tr>`).join('')}</tbody></table></div>`}</div>
        <div><h3 class="text-sm text-ink-700 mb-2" style="font-weight:600;">Outstanding fees</h3>${balances.length === 0 ? `<div class="card">${emptyState({ title: 'No outstanding balances', body: 'Every invoiced student is fully paid up.' })}</div>` : `<div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Student</th><th>Class</th><th class="text-right">Invoiced</th><th class="text-right">Paid</th><th class="text-right">Balance</th></tr></thead><tbody>${balances.map((row) => `<tr><td style="font-weight:500;">${escapeHtml(fullName(row.student))}</td><td class="text-ink-500">${escapeHtml(classById[row.student.classId ?? '']?.name ?? '—')}</td><td class="text-right">${currency} ${row.totalInvoiced.toLocaleString()}</td><td class="text-right">${currency} ${row.totalPaid.toLocaleString()}</td><td class="text-right" style="font-weight:600;color:var(--bad);">${currency} ${row.balance.toLocaleString()}</td></tr>`).join('')}</tbody></table></div>`}</div>
      </div>`;
    qs(container, '#start-date').addEventListener('change', (event) => { state.startDate = event.target.value; render(); });
    qs(container, '#end-date').addEventListener('change', (event) => { state.endDate = event.target.value; render(); });
  }

  render();
}
