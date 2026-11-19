import { escapeHtml } from '../../components/dom.js';
import { studentRepo, fullName } from '../../services/studentService.js';
import { getSchool } from '../../services/schoolService.js';
import { paymentRepo, allStudentBalances, totalOutstanding, invoiceRepo, expenseRepo } from '../../services/financeService.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { balancesForStudents, loadFinanceWorkspace } from '../../services/supabaseFinanceService.js';
import { classesSortedByOrder } from '../../services/academicService.js';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function money(value, currency) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function paymentMethodBucket(method) {
  const value = String(method || '').toLowerCase();
  if (['cash', 'cash payment', 'mpesa', 'm-pesa', 'safaricom', 'daraja'].includes(value)) return 'cash';
  return 'bank';
}

function renderQuickActions() {
  const actions = [
    ['record-payment', 'Record Payment'],
    ['generate-invoice', 'Generate Invoice'],
    ['add-expense', 'Add Expense'],
    ['open-reports', 'Financial Reports'],
  ];
  return `
    <div class="card card-p">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-xs text-ink-500" style="font-weight:700; letter-spacing:.06em;">QUICK ACTIONS</p>
          <p class="text-sm text-ink-500 mt-1">Frequent finance tasks</p>
        </div>
        <div class="flex flex-wrap gap-2">
          ${actions.map(([key, label], index) => `<button type="button" class="${index === 0 ? 'btn-primary' : 'btn-secondary'} btn-sm" data-finance-action="${key}">${escapeHtml(label)}</button>`).join('')}
        </div>
      </div>
    </div>
  `;
}

function wireQuickActions(container, onAction) {
  if (!onAction) return;
  container.querySelectorAll('[data-finance-action]').forEach((button) => {
    button.addEventListener('click', () => onAction(button.dataset.financeAction));
  });
}

function renderMetricCard(label, value, detail, tone = 'brand') {
  const toneMap = {
    brand: 'var(--brand-700)',
    success: 'var(--good)',
    warning: 'var(--warn)',
    danger: 'var(--bad)',
  };

  return `
    <div class="card card-p">
      <p class="text-sm text-ink-500">${escapeHtml(label)}</p>
      <p class="text-2xl mt-2" style="font-weight:600;font-family:var(--font-display);color:${toneMap[tone] ?? toneMap.brand};">${escapeHtml(value)}</p>
      <p class="text-xs text-ink-400 mt-1">${escapeHtml(detail)}</p>
    </div>
  `;
}

function renderTrendRow(label, value, width, color) {
  return `
    <div class="flex items-center gap-2 text-sm">
      <span style="width:2.8rem; color:var(--ink-600);">${escapeHtml(label)}</span>
      <div style="flex:1;background:var(--ink-100);border-radius:4px;overflow:hidden;height:.7rem;">
        <div style="width:${width}%;background:${color};height:100%;"></div>
      </div>
      <span style="min-width:4.5rem; text-align:right; color:var(--ink-700);">${escapeHtml(value)}</span>
    </div>
  `;
}

function renderBarList(items) {
  return items.map(({ label, value, color, width }) => `
    <div class="flex items-center gap-2 text-sm">
      <span style="width:5.2rem; color:var(--ink-600);">${escapeHtml(label)}</span>
      <div style="flex:1;background:var(--ink-100);border-radius:4px;overflow:hidden;height:.7rem;">
        <div style="width:${width}%;background:${color};height:100%;"></div>
      </div>
      <span style="min-width:2.8rem; text-align:right; color:var(--ink-700);">${escapeHtml(value)}</span>
    </div>
  `).join('');
}

export function renderFinanceOverview(container, { onAction } = {}) {
  if (isSupabaseConfigured()) return renderRemoteFinanceOverview(container, onAction);

  const currency = getSchool()?.currency ?? 'KES';
  const students = studentRepo.getAll().filter((s) => s.status === 'active');
  const invoices = invoiceRepo.getAll().filter((invoice) => invoice.status !== 'void');
  const payments = paymentRepo.getAll().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const confirmedPayments = payments.filter((payment) => !payment.status || payment.status === 'confirmed');
  const expenses = expenseRepo.getAll().sort((a, b) => b.date.localeCompare(a.date));

  const totalFeesBilled = invoices.reduce((sum, invoice) => sum + Number(invoice.totalAmount || 0), 0);
  const totalFeesCollected = confirmedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const outstanding = totalOutstanding(students);
  const totalExpenditure = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const netOperatingPosition = totalFeesCollected - totalExpenditure;
  const cashAtHand = confirmedPayments.filter((payment) => paymentMethodBucket(payment.method) === 'cash').reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const bankBalances = confirmedPayments.filter((payment) => paymentMethodBucket(payment.method) === 'bank').reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - (5 - index));
    const key = date.toISOString().slice(0, 7);
    return { key, label: date.toLocaleString(undefined, { month: 'short' }), amount: 0 };
  });
  confirmedPayments.forEach((payment) => {
    const month = months.find((entry) => entry.key === String(payment.date || '').slice(0, 7));
    if (month) month.amount += Number(payment.amount || 0);
  });
  const maxMonthlyCollection = Math.max(1, ...months.map((month) => month.amount));
  const trend = months.map((month) => ({
    ...month,
    width: Math.round((month.amount / maxMonthlyCollection) * 100),
    color: 'var(--brand-700)',
  }));
  const classById = Object.fromEntries(classesSortedByOrder().map((schoolClass) => [schoolClass.id, schoolClass]));
  const classTotals = {};
  allStudentBalances(students).forEach(({ student, totalInvoiced, totalPaid }) => {
    const className = classById[student.classId ?? '']?.name ?? 'No class';
    classTotals[className] ??= { billed: 0, paid: 0 };
    classTotals[className].billed += totalInvoiced;
    classTotals[className].paid += totalPaid;
  });
  const classBreakdown = Object.entries(classTotals).map(([label, totals]) => ({
    label,
    value: `${totals.billed ? Math.round((totals.paid / totals.billed) * 100) : 0}%`,
    width: Math.min(100, totals.billed ? Math.round((totals.paid / totals.billed) * 100) : 0),
    color: 'var(--brand-700)',
  }));
  const recentTransactions = [...payments.slice(0, 6), ...expenses.slice(0, 4)]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 8);

  container.innerHTML = `
    <div class="space-y-5">
      ${renderQuickActions()}

      <div class="grid grid-2 sm-grid-3 xl-grid-5 gap-4">
        ${renderMetricCard('Total fees billed', money(totalFeesBilled, currency), 'Across student invoices', 'brand')}
        ${renderMetricCard('Total fees collected', money(totalFeesCollected, currency), 'Confirmed collections', 'success')}
        ${renderMetricCard('Outstanding fees', money(outstanding, currency), 'Current receivables', 'warning')}
        ${renderMetricCard('Total expenditure', money(totalExpenditure, currency), 'Recorded expenses', 'warning')}
        ${renderMetricCard('Net fee position', money(netOperatingPosition, currency), netOperatingPosition >= 0 ? 'Surplus after recorded expenses' : 'Deficit after recorded expenses', netOperatingPosition >= 0 ? 'success' : 'danger')}
        ${renderMetricCard('Cash collections', money(cashAtHand, currency), 'Confirmed cash / M-Pesa receipts', 'brand')}
        ${renderMetricCard('Bank collections', money(bankBalances, currency), 'Confirmed bank and card receipts', 'success')}
      </div>

      <div class="grid gap-4 lg-grid-2">
        <div class="card card-p">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm text-ink-700" style="font-weight:600;">Income versus expenditure</h3>
            <span class="text-xs text-ink-500">${money(totalFeesCollected, currency)} / ${money(totalExpenditure, currency)}</span>
          </div>
          <div class="space-y-4">
            <div>
              <div class="flex items-center justify-between text-xs text-ink-500 mb-1"><span>Income</span><span>${money(totalFeesCollected, currency)}</span></div>
              <div style="height:12px;background:var(--ink-100);border-radius:999px;overflow:hidden;">
                <div style="height:100%;width:${Math.min(100, Math.round((totalFeesCollected / Math.max(1, totalFeesCollected + totalExpenditure)) * 100))}%;background:var(--brand-700);border-radius:999px;"></div>
              </div>
            </div>
            <div>
              <div class="flex items-center justify-between text-xs text-ink-500 mb-1"><span>Expenditure</span><span>${money(totalExpenditure, currency)}</span></div>
              <div style="height:12px;background:var(--ink-100);border-radius:999px;overflow:hidden;">
                <div style="height:100%;width:${Math.min(100, Math.round((totalExpenditure / Math.max(1, totalFeesCollected + totalExpenditure)) * 100))}%;background:var(--warn);border-radius:999px;"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="card card-p">
          <h3 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Fee collection trend</h3>
          <div class="space-y-2">
            ${trend.map((item) => renderTrendRow(item.label, money(item.amount, currency), item.width, item.color)).join('')}
          </div>
        </div>
      </div>

      <div class="grid gap-4 lg-grid-2">
        <div class="card card-p">
          <h3 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Fee collection by class</h3>
          <div class="space-y-2">
            ${renderBarList(classBreakdown)}
          </div>
        </div>

        <div class="card card-p">
          <h3 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Recent transactions</h3>
          <div class="overflow-x-auto">
            <table class="data-table">
              <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th class="text-right">Amount</th></tr></thead>
              <tbody>
                ${recentTransactions.length ? recentTransactions.map((entry) => {
                  const isPayment = 'method' in entry;
                  const reference = isPayment ? (entry.reference || 'Payment') : (entry.title || 'Expense');
                  return `<tr><td>${escapeHtml(entry.date || todayISO())}</td><td>${escapeHtml(isPayment ? 'Payment' : 'Expense')}</td><td>${escapeHtml(reference)}</td><td class="text-right">${money(Number(entry.amount || 0), currency)}</td></tr>`;
                }).join('') : `<tr><td colspan="4" class="text-sm text-ink-500">No transactions yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="grid gap-4 lg-grid-2">
        <div class="card card-p">
          <h3 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Payment method breakdown</h3>
          <div class="space-y-2">
            ${renderBarList([
              { label: 'Cash / M-Pesa', value: money(cashAtHand, currency), width: Math.min(100, Math.round((cashAtHand / Math.max(1, totalFeesCollected)) * 100)), color: 'var(--brand-700)' },
              { label: 'Bank / Card', value: money(bankBalances, currency), width: Math.min(100, Math.round((bankBalances / Math.max(1, totalFeesCollected)) * 100)), color: 'var(--good)' },
            ])}
          </div>
        </div>

        <div class="card card-p">
          <h3 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Pending financial approvals</h3>
          <div class="space-y-2">
            ${expenses.filter((expense) => ['submitted', 'pending approval', 'pending_approval'].includes(String(expense.status || '').toLowerCase())).slice(0, 4).map((expense) => `
              <div class="flex items-center justify-between gap-2 text-sm">
                <span class="text-ink-700">${escapeHtml(expense.title || 'Expense request')}</span>
                <span class="badge badge-warning">${escapeHtml(expense.status || 'Pending')}</span>
              </div>
            `).join('') || '<p class="text-sm text-ink-500">No pending approvals.</p>'}
          </div>
        </div>
      </div>
    </div>
  `;
  wireQuickActions(container, onAction);
}

async function renderRemoteFinanceOverview(container, onAction) {
  try {
    const data = await loadFinanceWorkspace();
    const currency = data.school[0]?.currency ?? 'KES';
    const studentById = Object.fromEntries((data.students || []).map((student) => [student.id, student]));
    const payments = data.payments || [];
    const expenses = data.expenses || [];
    const invoices = data.invoices || [];
    const totalFeesBilled = invoices.filter((invoice) => invoice.status !== 'void').reduce((sum, invoice) => sum + Number(invoice.totalAmount || 0), 0);
    const confirmedPayments = payments.filter((payment) => !payment.status || payment.status === 'confirmed');
    const totalFeesCollected = confirmedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const balances = balancesForStudents(data);
    const outstanding = balances.reduce((sum, row) => sum + Math.max(0, row.balance), 0);
    const totalExpenditure = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const netOperatingPosition = totalFeesCollected - totalExpenditure;
    const cashAtHand = confirmedPayments.filter((payment) => ['cash', 'mpesa', 'm-pesa'].includes(String(payment.method || '').toLowerCase())).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const bankBalances = confirmedPayments.filter((payment) => !['cash', 'mpesa', 'm-pesa'].includes(String(payment.method || '').toLowerCase())).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const recentTransactions = [...payments.slice(0, 6), ...expenses.slice(0, 4)].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 8);

    container.innerHTML = `
      <div class="space-y-5">
        ${renderQuickActions()}
        <div class="grid grid-2 sm-grid-3 xl-grid-5 gap-4">
          ${renderMetricCard('Total fees billed', money(totalFeesBilled, currency), 'Across student invoices', 'brand')}
          ${renderMetricCard('Total fees collected', money(totalFeesCollected, currency), 'Confirmed collections', 'success')}
          ${renderMetricCard('Outstanding fees', money(outstanding, currency), 'Current receivables', 'warning')}
          ${renderMetricCard('Total expenditure', money(totalExpenditure, currency), 'Recorded expenses', 'warning')}
          ${renderMetricCard('Net fee position', money(netOperatingPosition, currency), netOperatingPosition >= 0 ? 'Surplus after recorded expenses' : 'Deficit after recorded expenses', netOperatingPosition >= 0 ? 'success' : 'danger')}
          ${renderMetricCard('Cash collections', money(cashAtHand, currency), 'Confirmed cash / M-Pesa receipts', 'brand')}
          ${renderMetricCard('Bank collections', money(bankBalances, currency), 'Confirmed bank and card receipts', 'success')}
        </div>

        <div class="card card-p">
          <h3 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Recent transactions</h3>
          <div class="overflow-x-auto">
            <table class="data-table">
              <thead><tr><th>Date</th><th>Type</th><th>Student</th><th class="text-right">Amount</th></tr></thead>
              <tbody>
                ${recentTransactions.map((entry) => {
                  const isPayment = Boolean(entry.studentId);
                  const student = isPayment ? (studentById[entry.studentId] ? fullName(studentById[entry.studentId]) : '—') : 'School account';
                  return `<tr><td>${escapeHtml(entry.date || todayISO())}</td><td>${escapeHtml(isPayment ? 'Payment' : 'Expense')}</td><td>${escapeHtml(student)}</td><td class="text-right">${money(Number(entry.amount || 0), currency)}</td></tr>`;
                }).join('') || '<tr><td colspan="4" class="text-sm text-ink-500">No recent transactions.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    wireQuickActions(container, onAction);
  } catch (error) {
    container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span><button class="btn-secondary btn-sm" id="finance-overview-retry">Retry</button></div>`;
    const retry = container.querySelector('#finance-overview-retry');
    if (retry) retry.addEventListener('click', () => renderRemoteFinanceOverview(container, onAction));
  }
}
