import { escapeHtml, on, qs } from '../../components/dom.js';
import { uuid } from '../../lib/uuid.js';
import { studentRepo, fullName } from '../../services/studentService.js';
import { classesSortedByOrder } from '../../services/academicService.js';
import { getSchool } from '../../services/schoolService.js';
import {
  feeStructureRepo,
  createInvoiceFromFeeStructure,
  createInvoice,
  getInvoicesForStudent,
  getPaymentsForStudent,
  getPaymentsForInvoice,
  studentTotals,
  recordPayment,
  invoiceTotal,
} from '../../services/financeService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { featureEnabled } from '../../services/subscriptionService.js';
import { submitPayment as submitBursarPayment } from '../../services/bursarService.js';
import { createInvoicePayload, createRemoteInvoice, invoicePaymentStatus, loadFinanceWorkspace, paymentsForInvoice, paymentsForStudent, recordRemotePayment, totalsForStudent } from '../../services/supabaseFinanceService.js';

const METHODS = [
  ['mpesa', 'M-Pesa'],
  ['bank', 'Bank'],
  ['cash', 'Cash'],
  ['cheque', 'Cheque'],
  ['other', 'Other'],
];

export function renderStudentAccount(container) {
  const remote = isSupabaseConfigured();
  let classes = remote ? [] : classesSortedByOrder();
  let classById = Object.fromEntries(classes.map((c) => [c.id, c]));
  const state = {
    studentId: '',
    invoiceFormOpen: false,
    invoiceMode: 'structure',
    feeStructureId: '',
    customItems: [{ tempId: uuid(), name: '', amount: '' }],
    dueDate: '',
    paymentFormOpen: false,
    paymentInvoiceId: '',
    amount: '',
    method: 'mpesa',
    reference: '',
    date: new Date().toISOString().slice(0, 10),
    data: null,
    error: '',
  };

  async function render() {
    let students;
    let school;
    try {
      if (remote) {
        state.data ??= await loadFinanceWorkspace();
        students = state.data.students;
        classes = state.data.classes.sort((a, b) => a.order - b.order);
        classById = Object.fromEntries(classes.map((schoolClass) => [schoolClass.id, schoolClass]));
        school = state.data.school[0];
      } else {
        students = studentRepo.getAll().filter((student) => student.status === 'active');
        school = getSchool();
      }
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="account-retry">Retry</button></div>`;
      qs(container, '#account-retry').addEventListener('click', () => { state.data = null; state.error = ''; render(); });
      return;
    }
    const currency = school?.currency ?? 'KES';

    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        ${state.notice ? `<div class="notice" role="status"><span>${escapeHtml(state.notice)}</span></div>` : ''}
        <div class="flex flex-wrap items-end gap-3 no-print">
          <div class="flex-1" style="max-width:22rem;">
            <label class="label">Student</label>
            <select class="input" id="student-select">
              <option value="">Select a student</option>
              ${students
                .map((s) => `<option value="${s.id}" ${state.studentId === s.id ? 'selected' : ''}>${escapeHtml(fullName(s))} · ${escapeHtml(s.admissionNumber)}</option>`)
                .join('')}
            </select>
          </div>
          ${
            state.studentId
              ? `<button class="btn-secondary" id="print-statement-btn">Print statement</button>`
              : ''
          }
        </div>
        <div id="account-body"></div>
      </div>
    `;

    qs(container, '#student-select').addEventListener('change', (e) => {
      state.studentId = e.target.value;
      state.invoiceFormOpen = false;
      state.paymentFormOpen = false;
      render();
    });
    const printBtn = qs(container, '#print-statement-btn');
    if (printBtn) printBtn.addEventListener('click', () => window.print());

    renderAccountBody(students, currency);
  }

  async function renderAccountBody(students, currency) {
    const body = qs(container, '#account-body');
    if (!state.studentId) {
      body.innerHTML = `<div class="card">${emptyState({ iconHtml: icons.wallet(40), title: 'Choose a student', body: 'Select a student above to view their fee balance, invoices, and payment history.' })}</div>`;
      return;
    }

    const student = remote ? students.find((item) => item.id === state.studentId) : studentRepo.getById(state.studentId);
    const invoices = remote ? state.data.invoices.filter((invoice) => invoice.studentId === state.studentId) : getInvoicesForStudent(state.studentId);
    const payments = remote ? paymentsForStudent(state.data, state.studentId) : getPaymentsForStudent(state.studentId);
    const totals = remote ? totalsForStudent(state.data, state.studentId) : studentTotals(state.studentId);
    const structures = remote ? state.data.feeStructures : feeStructureRepo.getAll();
    // The <select> always shows a visual default (the browser auto-selects
    // the first <option> when none is marked selected), so state must match
    // that default — otherwise clicking Create before touching the dropdown
    // silently does nothing.
    if (state.invoiceFormOpen && state.invoiceMode === 'structure' && !state.feeStructureId && structures.length > 0) {
      state.feeStructureId = structures[0].id;
    }

    body.innerHTML = `
      <div class="space-y-4">
        <div class="card card-p">
          <div class="flex justify-between items-start" style="border-bottom:1px solid var(--ink-100); padding-bottom:1rem; margin-bottom:1rem;">
            <div>
              <p style="font-weight:600;">${escapeHtml(fullName(student))}</p>
              <p class="text-xs text-ink-500">${escapeHtml(student.admissionNumber)} · ${escapeHtml(classById[student.classId ?? '']?.name ?? '—')}</p>
            </div>
            <div class="text-right">
              <p class="text-xs text-ink-500">Balance</p>
              <p class="text-xl" style="font-weight:600; color: ${totals.balance > 0 ? 'var(--bad)' : 'var(--good)'};">${currency} ${totals.balance.toLocaleString()}</p>
            </div>
          </div>
          <div class="grid grid-2 sm-grid-3 gap-4">
            <div><p class="text-xs text-ink-500">Invoiced</p><p class="text-sm" style="font-weight:600;">${currency} ${totals.totalInvoiced.toLocaleString()}</p></div>
            <div><p class="text-xs text-ink-500">Paid</p><p class="text-sm" style="font-weight:600;">${currency} ${totals.totalPaid.toLocaleString()}</p></div>
          </div>
        </div>

        <div class="flex gap-3 no-print">
          <button class="btn-secondary" id="new-invoice-btn">+ Create invoice</button>
          <button class="btn-primary" id="record-payment-btn" ${invoices.length === 0 ? 'disabled title="Create an invoice first"' : ''}>+ Record payment</button>
        </div>

        ${state.invoiceFormOpen ? invoiceFormHtml(structures) : ''}
        ${state.paymentFormOpen ? paymentFormHtml(invoices, currency) : ''}

        <div>
          <h3 class="text-sm text-ink-700 mb-2" style="font-weight:600;">Invoices</h3>
          ${
            invoices.length === 0
              ? `<p class="text-sm text-ink-400">No invoices yet.</p>`
              : `<div class="card" style="overflow:hidden;">
                  ${invoices
                    .map((inv) => {
                      const paid = remote ? paymentsForInvoice(state.data, inv.id).reduce((sum, payment) => sum + Number(payment.amount), 0) : getPaymentsForInvoice(inv.id).reduce((sum, p) => sum + p.amount, 0);
                      const invoiceStatus = remote ? invoicePaymentStatus(state.data, inv).status : inv.status;
                      return `
                      <div style="padding:0.75rem 1rem; border-bottom:1px solid var(--ink-50);">
                        <div class="flex justify-between items-center">
                          <div>
                            <p class="text-sm" style="font-weight:500;">${inv.items.map((i) => escapeHtml(i.name)).join(', ')}</p>
                            <p class="text-xs text-ink-500 mt-1">${escapeHtml(inv.dueDate ? 'Due ' + inv.dueDate : 'No due date')}</p>
                          </div>
                          <div class="text-right">
                            <p class="text-sm" style="font-weight:600;">${currency} ${inv.totalAmount.toLocaleString()}</p>
                            <span class="badge ${invoiceStatus === 'paid' ? 'badge-good' : 'badge-gold'}">${escapeHtml(invoiceStatus)} · paid ${currency} ${paid.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    `;
                    })
                    .join('')}
                </div>`
          }
        </div>

        <div>
          <h3 class="text-sm text-ink-700 mb-2" style="font-weight:600;">Payment history</h3>
          ${
            payments.length === 0
              ? `<p class="text-sm text-ink-400">No payments recorded yet.</p>`
              : `<div class="card overflow-x-auto">
                  <table class="data-table">
                    <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th class="text-right">Amount</th></tr></thead>
                    <tbody>
                      ${payments
                        .map(
                          (p) => `<tr><td>${escapeHtml(p.date)}</td><td class="capitalize">${escapeHtml(METHODS.find(([v]) => v === p.method)?.[1] ?? p.method)}</td><td class="text-ink-500">${escapeHtml(p.reference ?? '—')}</td><td class="text-right" style="font-weight:500;">${currency} ${p.amount.toLocaleString()}</td></tr>`
                        )
                        .join('')}
                    </tbody>
                  </table>
                </div>`
          }
        </div>
      </div>
    `;

    qs(body, '#new-invoice-btn').addEventListener('click', () => { state.invoiceFormOpen = true; state.paymentFormOpen = false; render(); });
    const paymentBtn = qs(body, '#record-payment-btn');
    if (paymentBtn) paymentBtn.addEventListener('click', () => {
      state.paymentFormOpen = true;
      state.invoiceFormOpen = false;
      state.paymentInvoiceId = invoices.find((i) => i.status !== 'paid')?.id ?? invoices[0]?.id ?? '';
      render();
    });

    if (state.invoiceFormOpen) wireInvoiceForm(body, structures);
    if (state.paymentFormOpen) wirePaymentForm(body, invoices);
  }

  function invoiceFormHtml(structures) {
    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">New invoice</h3>
        <div class="pill-group">
          <button class="pill ${state.invoiceMode === 'structure' ? 'active' : ''}" id="mode-structure" type="button">From fee structure</button>
          <button class="pill ${state.invoiceMode === 'custom' ? 'active' : ''}" id="mode-custom" type="button">Custom items</button>
        </div>
        ${
          state.invoiceMode === 'structure'
            ? `<div>
                <label class="label">Fee structure</label>
                <select class="input" id="fs-select" ${structures.length === 0 ? 'disabled' : ''}>
                  ${structures.length === 0 ? '<option>No fee structures yet</option>' : structures.map((s) => `<option value="${s.id}" ${state.feeStructureId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
                </select>
              </div>`
            : `<div>
                <label class="label">Items</label>
                <div class="space-y-2">
                  ${state.customItems
                    .map(
                      (i) => `<div class="flex gap-2">
                        <input class="input flex-1" placeholder="Item name" data-ci-name="${i.tempId}" value="${escapeHtml(i.name)}" />
                        <input type="number" class="input" style="width:8rem" placeholder="Amount" data-ci-amount="${i.tempId}" value="${escapeHtml(i.amount)}" />
                        ${state.customItems.length > 1 ? `<button class="btn-ghost" data-ci-remove="${i.tempId}">Remove</button>` : ''}
                      </div>`
                    )
                    .join('')}
                </div>
                <button class="btn-secondary btn-sm" style="margin-top:0.5rem;" id="ci-add-btn">+ Add item</button>
              </div>`
        }
        <div style="max-width:12rem;">
          <label class="label">Due date (optional)</label>
          <input type="date" class="input" id="invoice-due" value="${escapeHtml(state.dueDate)}" />
        </div>
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-invoice-btn">Cancel</button>
          <button class="btn-primary" id="save-invoice-btn">Create invoice</button>
        </div>
      </div>
    `;
  }

  function wireInvoiceForm(body, structures) {
    qs(body, '#mode-structure').addEventListener('click', () => { state.invoiceMode = 'structure'; render(); });
    qs(body, '#mode-custom').addEventListener('click', () => { state.invoiceMode = 'custom'; render(); });
    const fsSelect = qs(body, '#fs-select');
    if (fsSelect) fsSelect.addEventListener('change', (e) => (state.feeStructureId = e.target.value));
    on(body, '[data-ci-name]', 'input', (e) => {
      const id = e.target.getAttribute('data-ci-name');
      state.customItems.find((i) => i.tempId === id).name = e.target.value;
    });
    on(body, '[data-ci-amount]', 'input', (e) => {
      const id = e.target.getAttribute('data-ci-amount');
      state.customItems.find((i) => i.tempId === id).amount = e.target.value;
    });
    on(body, '[data-ci-remove]', 'click', (e) => {
      state.customItems = state.customItems.filter((i) => i.tempId !== e.currentTarget.getAttribute('data-ci-remove'));
      render();
    });
    const addBtn = qs(body, '#ci-add-btn');
    if (addBtn) addBtn.addEventListener('click', () => {
      state.customItems.push({ tempId: uuid(), name: '', amount: '' });
      render();
    });
    qs(body, '#invoice-due').addEventListener('input', (e) => (state.dueDate = e.target.value));
    qs(body, '#cancel-invoice-btn').addEventListener('click', () => { state.invoiceFormOpen = false; render(); });
    qs(body, '#save-invoice-btn').addEventListener('click', async () => {
      try {
      if (state.invoiceMode === 'structure') {
        if (!state.feeStructureId) throw new Error('Choose a fee structure first.');
        const structure = structures.find((item) => item.id === state.feeStructureId);
        if (!structure) throw new Error('The selected fee structure is no longer available.');
        if (remote) {
          await createRemoteInvoice(createInvoicePayload({ studentId: state.studentId, termId: structure.termId, items: structure.items.map((item) => ({ id: item.id || uuid(), name: item.name, amount: Number(item.amount) })), dueDate: state.dueDate }));
        } else createInvoiceFromFeeStructure(state.studentId, state.feeStructureId, state.dueDate || undefined);
      } else {
        const items = state.customItems.map((item) => ({ id: uuid(), name: item.name.trim(), amount: Number(item.amount) }));
        if (items.some((item) => !item.name || !Number.isFinite(item.amount) || item.amount <= 0)) {
          throw new Error('Complete every custom item with a name and an amount greater than zero.');
        }
        if (remote) await createRemoteInvoice(createInvoicePayload({ studentId: state.studentId, items, dueDate: state.dueDate }));
        else createInvoice({ studentId: state.studentId, items, dueDate: state.dueDate || undefined });
      }
      state.invoiceFormOpen = false;
      state.customItems = [{ tempId: uuid(), name: '', amount: '' }];
      state.feeStructureId = '';
      state.dueDate = '';
      state.data = null;
      state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
  }

  function paymentFormHtml(invoices, currency) {
    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">Record payment</h3>
        <div class="grid sm-grid-2 gap-4">
          <div>
            <label class="label">Apply to invoice</label>
            <select class="input" id="payment-invoice">
              ${invoices.map((inv) => `<option value="${inv.id}" ${state.paymentInvoiceId === inv.id ? 'selected' : ''}>${inv.items.map((i) => i.name).join(', ')} — ${currency} ${inv.totalAmount.toLocaleString()} (${inv.status})</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="label">Payment method</label>
            <select class="input" id="payment-method">
              ${METHODS.map(([v, label]) => `<option value="${v}" ${state.method === v ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid sm-grid-3 gap-4">
          <div>
            <label class="label">Amount (${currency})</label>
            <input type="number" class="input" id="payment-amount" value="${escapeHtml(state.amount)}" />
          </div>
          <div>
            <label class="label">Reference</label>
            <input class="input" id="payment-reference" value="${escapeHtml(state.reference)}" placeholder="Transaction code" />
          </div>
          <div>
            <label class="label">Date</label>
            <input type="date" class="input" id="payment-date" value="${escapeHtml(state.date)}" />
          </div>
        </div>
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-payment-btn">Cancel</button>
          <button class="btn-primary" id="save-payment-btn">Save payment</button>
        </div>
      </div>
    `;
  }

  function wirePaymentForm(body) {
    qs(body, '#payment-invoice').addEventListener('change', (e) => (state.paymentInvoiceId = e.target.value));
    qs(body, '#payment-method').addEventListener('change', (e) => (state.method = e.target.value));
    qs(body, '#payment-amount').addEventListener('input', (e) => (state.amount = e.target.value));
    qs(body, '#payment-reference').addEventListener('input', (e) => (state.reference = e.target.value));
    qs(body, '#payment-date').addEventListener('input', (e) => (state.date = e.target.value));
    qs(body, '#cancel-payment-btn').addEventListener('click', () => { state.paymentFormOpen = false; render(); });
    qs(body, '#save-payment-btn').addEventListener('click', async () => {
      const amount = Number(state.amount);
      if (!state.paymentInvoiceId || !amount || amount <= 0) {
        state.error = 'Choose an invoice and enter an amount greater than zero.';
        await render();
        return;
      }
      const payment = {
        studentId: state.studentId,
        invoiceId: state.paymentInvoiceId,
        amount,
        method: state.method,
        reference: state.reference,
        date: state.date,
      };
      try {
        if (featureEnabled('automated_receipting')) {
          // Bursar Pack: electronic payments wait for verification; confirmed ones get a receipt.
          const saved = await submitBursarPayment(payment);
          state.notice = (saved?.status ?? 'confirmed') === 'pending_verification' ? 'Payment recorded as pending verification. It will count once confirmed in Finance → Payments & receipts.' : 'Payment recorded and receipted.';
        } else if (remote) {
          const result = await recordRemotePayment(payment);
          if (!result.ok) throw new Error(result.error);
        } else recordPayment(payment);
        state.paymentFormOpen = false;
        state.amount = '';
        state.reference = '';
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
