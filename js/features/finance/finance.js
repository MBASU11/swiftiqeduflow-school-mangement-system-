import { qs } from '../../components/dom.js';
import { renderFinanceOverview } from './financeOverview.js';
import { renderFeeStructures } from './feeStructures.js';
import { renderStudentAccount } from './studentAccount.js';
import { renderExpenses } from './expenses.js';
import { renderFinanceReports } from './financeReports.js';
import { BURSAR_TABS, renderBursarTab } from './bursarTabs.js';

const CORE_TABS = [
  ['dashboard', 'Finance Dashboard'],
  ['student-accounts', 'Student Accounts'],
  ['fee-management', 'Fee Structures'],
  ['invoices', 'Invoices'],
  ['payments', 'Payments & Receipts'],
  ['expense-management', 'Expenses'],
  ['financial-reports', 'Financial Reports'],
];

const OPTIONAL_TAB_RENDERERS = {
  reminders: 'reminders',
  refunds: 'refunds',
  charges: 'charges',
  reconcile: 'reconcile',
  pay: 'pay',
  breports: 'breports',
  statements: 'statements',
  plans: 'plans',
  credits: 'credits',
  cashbook: 'cashbook',
  faudit: 'faudit',
};

function availableTabs() {
  const optionalTabs = BURSAR_TABS
    .filter(([key, , enabled]) => key !== 'bursar' && OPTIONAL_TAB_RENDERERS[key] && enabled())
    .map(([key, label]) => [key, label]);
  return [...CORE_TABS, ...optionalTabs];
}
const ACTION_TABS = {
  'record-payment': ['payments', 'record'],
  'generate-invoice': ['invoices', 'generate'],
  'add-expense': ['expense-management', 'add'],
  'open-reports': ['financial-reports', null],
};

export function renderFinance(container) {
  let tab = 'dashboard';
  let action = null;

  function navigateToAction(name) {
    const destination = ACTION_TABS[name];
    if (!destination) return;
    [tab, action] = destination;
    render();
  }

  function renderBody(body) {
    if (tab === 'dashboard') {
      renderFinanceOverview(body, { onAction: navigateToAction });
      return;
    }
    if (tab === 'student-accounts') {
      renderStudentAccount(body);
      return;
    }
    if (tab === 'fee-management') {
      renderFeeStructures(body);
      return;
    }
    if (tab === 'expense-management') {
      renderExpenses(body, { initialOpen: action === 'add' });
      return;
    }
    if (tab === 'financial-reports') {
      renderFinanceReports(body);
      return;
    }
    if (['invoices', 'payments', ...Object.keys(OPTIONAL_TAB_RENDERERS)].includes(tab)) {
      renderBursarTab(tab, body, { initialAction: action });
      return;
    }
    renderFinanceReports(body);
  }

  function render() {
    const tabs = availableTabs();
    if (!tabs.some(([key]) => key === tab)) {
      tab = 'dashboard';
      action = null;
    }

    container.innerHTML = `
      <div class="space-y-5">
        <div class="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 class="text-2xl" style="font-weight:600;">Finance</h1>
            <p class="text-sm text-ink-500 mt-1">School fees, student accounts, payments, expenses and reports</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="btn-primary btn-sm" data-finance-action="record-payment">Record Payment</button>
            <button class="btn-secondary btn-sm" data-finance-action="generate-invoice">Generate Invoice</button>
            <button class="btn-secondary btn-sm" data-finance-action="add-expense">Add Expense</button>
          </div>
        </div>

        <div class="finance-workspace-layout">
          <aside class="card card-p finance-workspace-nav">
            <p class="text-xs text-ink-500" style="margin:0 0 .75rem; font-weight:700; letter-spacing:.06em;">FINANCE NAVIGATION</p>
            <div class="space-y-1">
              ${tabs.map(([key, label]) => `
                <button class="w-full text-left px-3 py-2 rounded-md border ${tab === key ? 'bg-brand-50 text-brand-700 border-brand-200' : 'border-transparent text-ink-700 hover:bg-ink-50'}" data-tab="${key}" role="tab" aria-selected="${tab === key ? 'true' : 'false'}" style="font-weight:${tab === key ? 600 : 500};">
                  ${label}
                </button>
              `).join('')}
            </div>
          </aside>

          <div id="finance-body" class="space-y-4" role="tabpanel"></div>
        </div>
      </div>
    `;

    tabs.forEach(([key]) => {
      const button = qs(container, `[data-tab="${key}"]`);
      button?.addEventListener('click', () => {
        tab = key;
        action = null;
        render();
      });
    });

    container.querySelectorAll('[data-finance-action]').forEach((button) => {
      button.addEventListener('click', () => navigateToAction(button.dataset.financeAction));
    });

    renderBody(qs(container, '#finance-body'));
  }

  render();
}
