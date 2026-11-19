import { escapeHtml, on, qs } from '../../components/dom.js';
import { CURRENCY } from '../../config/plans.js';
import { invoiceDocumentHtml } from '../../components/invoiceDocument.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import * as localPlatformService from '../../services/platformService.js';
import * as automation from '../../services/platformAutomation.js';

const PAYMENT_METHODS = localPlatformService.PAYMENT_METHODS;

const fmt = (n) => Number(n).toLocaleString('en-US');
const STATUS_LABEL = { unpaid: 'Unpaid', partial: 'Partly paid', paid: 'Paid', void: 'Void' };

export function statusBadge(status) {
  const cls = status === 'paid' ? 'badge-good' : status === 'void' ? 'badge-muted' : 'badge-gold';
  return `<span class="badge ${cls}">${escapeHtml(STATUS_LABEL[status] ?? status)}</span>`;
}

function renderLoadError(body, error) {
  body.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error?.message ?? 'Could not load platform data.')}</span></div>`;
}

export function renderInvoicesList(body, go, platformService = localPlatformService) {
  const state = { filter: '', notice: '' };
  const local = platformService === localPlatformService;

  async function draw() {
    let invoices;
    let schools;
    try {
      [invoices, schools] = await Promise.all([platformService.allInvoices(), platformService.listSchools()]);
    } catch (error) {
      renderLoadError(body, error);
      return;
    }
    const schoolNames = new Map(schools.map((school) => [school.id, school.schoolName]));
    const schoolName = (id) => schoolNames.get(id) ?? 'Unknown school';
    if (state.filter === 'overdue') invoices = invoices.filter((i) => localPlatformService.isOverdue(i));
    else if (state.filter) invoices = invoices.filter((i) => i.status === state.filter);
    const pendingRenewals = local ? automation.renewalsPending().length : 0;

    body.innerHTML = `
      <div class="space-y-4">
        ${state.notice ? `<div class="notice" role="status"><span>${escapeHtml(state.notice)}</span></div>` : ''}
        ${pendingRenewals ? `<div class="notice"><span>${pendingRenewals} school${pendingRenewals === 1 ? ' has a subscription' : 's have subscriptions'} ending soon without a renewal invoice.</span><button class="btn-primary btn-sm" id="make-renewals">Create renewal invoice${pendingRenewals === 1 ? '' : 's'}</button></div>` : ''}
        <div class="flex flex-wrap gap-2" role="group" aria-label="Filter invoices">
          ${[['', 'All'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['partial', 'Partly paid'], ['paid', 'Paid'], ['void', 'Void']]
            .map(([v, label]) => `<button class="chip ${state.filter === v ? 'active' : ''}" data-filter="${v}">${label}</button>`)
            .join('')}
        </div>
        ${
          invoices.length === 0
            ? `<div class="card">${emptyState({
                iconHtml: icons.wallet(40),
                title: 'No invoices yet',
                body: 'Open a school and create its package invoice.',
              })}</div>`
            : `<div class="card overflow-x-auto">
                <table class="data-table">
                  <thead><tr><th>Invoice</th><th>School</th><th>Issued</th><th class="text-right">Total</th><th class="text-right">Paid</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    ${invoices
                      .map(
                        (i) => `<tr>
                          <td style="font-weight:500;">${escapeHtml(i.number)}</td>
                          <td>${escapeHtml(schoolName(i.accountId))}</td>
                          <td class="text-ink-600">${escapeHtml(i.issueDate)}</td>
                          <td class="text-right">${CURRENCY} ${fmt(i.total)}</td>
                          <td class="text-right">${CURRENCY} ${fmt(i.paid)}</td>
                          <td>${statusBadge(i.status)}</td>
                          <td class="text-right"><button class="btn-secondary btn-sm" data-open-invoice="${i.id}">Open</button></td>
                        </tr>`
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>`
        }
      </div>`;
    qs(body, '#make-renewals')?.addEventListener('click', () => {
      const r = automation.createRenewalInvoices(admin?.name ?? 'Administrator');
      state.notice = `${r.created.length} renewal invoice${r.created.length === 1 ? '' : 's'} created${r.skipped.length ? `; ${r.skipped.length} skipped (${r.skipped.map((x) => `${x.school}: ${x.reason}`).join(' ')})` : ''}.`;
      draw();
    });
    on(body, '[data-filter]', 'click', (e) => {
      state.filter = e.currentTarget.getAttribute('data-filter');
      draw();
    });
    on(body, '[data-open-invoice]', 'click', (e) => go({ invoiceId: e.currentTarget.getAttribute('data-open-invoice') }));
  }
  draw();
}

export function renderInvoiceView(body, invoiceId, admin, { onBack, backLabel }, platformService = localPlatformService) {
  const state = { amount: '', method: 'mpesa', reference: '', date: new Date().toISOString().slice(0, 10), error: '', saved: false, activation: null, copied: false };
  const local = platformService === localPlatformService;

  async function draw() {
    let invoice;
    try {
      invoice = await platformService.getInvoice(invoiceId);
    } catch (error) {
      renderLoadError(body, error);
      return;
    }
    if (!invoice) {
      body.innerHTML = `<div class="card">${emptyState({ title: 'Invoice not found', actionsHtml: `<button class="btn-secondary" id="inv-back">${escapeHtml(backLabel)}</button>` })}</div>`;
      qs(body, '#inv-back').addEventListener('click', onBack);
      return;
    }
    let school;
    let settings;
    try {
      [school, settings] = await Promise.all([
        platformService.getSchool(invoice.accountId),
        platformService.getPlatformSettings(),
      ]);
    } catch (error) {
      renderLoadError(body, error);
      return;
    }
    const canPay = invoice.status === 'unpaid' || invoice.status === 'partial';
    if (state.amount === '' && canPay) state.amount = String(invoice.balance);

    body.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center flex-wrap gap-3 no-print">
          <button class="btn-ghost" id="inv-back">← ${escapeHtml(backLabel)}</button>
          <div class="flex gap-2">
            ${local && (invoice.status === 'unpaid' || invoice.status === 'partial') ? '<button class="btn-secondary" id="inv-remind">Copy payment reminder</button>' : ''}
            <button class="btn-secondary" id="inv-print">Print invoice</button>
            ${invoice.status !== 'void' && invoice.status !== 'paid' ? `<button class="btn-secondary" id="inv-void" style="color:var(--bad);">Void invoice</button>` : ''}
          </div>
        </div>

        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        ${state.copied ? '<p class="text-sm text-good no-print" role="status">Reminder copied. Paste it into SMS, WhatsApp or email.</p>' : ''}
        ${local && invoice.kind === 'subscription' && invoice.status !== 'void' ? `<p class="text-xs text-ink-500 no-print">${invoice.activatedAt ? 'This subscription invoice has been paid and the subscription is active.' : 'Paying this invoice in full activates the school\'s subscription automatically.'}</p>` : ''}
        <div class="card card-p">${invoiceDocumentHtml({ invoice, school, settings })}</div>

        ${
          state.saved
            ? `<p class="text-sm text-good no-print" id="pay-saved">Payment recorded.${!canPay ? ' This invoice is now fully paid.' : ''}${state.activation ? ` Subscription ${state.activation.renewal ? 'renewed' : 'activated'}: valid ${escapeHtml(state.activation.start)} to ${escapeHtml(state.activation.expiry)}.` : ''}</p>`
            : ''
        }

        ${
          canPay
            ? `<div class="card card-p space-y-4 no-print">
                <h3 class="text-sm text-ink-700" style="font-weight:600;">Confirm a payment received</h3>
                <p class="text-xs text-ink-500">Record money you have actually received (for example an M-Pesa or bank payment). This does not charge anyone.</p>
                <div class="grid sm-grid-3 gap-4">
                  <div>
                    <label class="label" for="pay-amount">Amount (${CURRENCY})</label>
                    <input type="number" min="1" class="input" id="pay-amount" value="${escapeHtml(state.amount)}" />
                  </div>
                  <div>
                    <label class="label" for="pay-method">Method</label>
                    <select class="input" id="pay-method">
                      ${PAYMENT_METHODS.map(([v, label]) => `<option value="${v}" ${state.method === v ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
                    </select>
                  </div>
                  <div>
                    <label class="label" for="pay-date">Date received</label>
                    <input type="date" class="input" id="pay-date" value="${escapeHtml(state.date)}" />
                  </div>
                </div>
                <div>
                  <label class="label" for="pay-ref">Reference (e.g. transaction code)</label>
                  <input class="input" id="pay-ref" value="${escapeHtml(state.reference)}" />
                </div>
                ${state.error ? `<p class="field-error" id="pay-error" role="alert">${escapeHtml(state.error)}</p>` : ''}
                <div class="flex justify-end"><button class="btn-primary" id="save-payment-btn">Record payment</button></div>
              </div>`
            : ''
        }
      </div>`;

    qs(body, '#inv-back').addEventListener('click', onBack);
    qs(body, '#inv-print').addEventListener('click', () => window.print());
    qs(body, '#inv-remind')?.addEventListener('click', async () => {
      const text = automation.reminderText(invoice, school, settings);
      try { await navigator.clipboard.writeText(text); state.copied = true; draw(); } catch { prompt('Copy this reminder:', text); }
    });
    const voidBtn = qs(body, '#inv-void');
    if (voidBtn) {
      voidBtn.addEventListener('click', async () => {
        if (!confirm('Void this invoice? It will stay on record but no longer counts towards what the school owes.')) return;
        try {
          await platformService.voidInvoice(invoiceId, admin.name);
          state.error = '';
          await draw();
        } catch (error) {
          state.error = error.message;
          await draw();
        }
      });
    }
    if (canPay) {
      qs(body, '#pay-amount').addEventListener('input', (e) => (state.amount = e.target.value));
      qs(body, '#pay-method').addEventListener('change', (e) => (state.method = e.target.value));
      qs(body, '#pay-date').addEventListener('input', (e) => (state.date = e.target.value));
      qs(body, '#pay-ref').addEventListener('input', (e) => (state.reference = e.target.value));
      qs(body, '#save-payment-btn').addEventListener('click', async () => {
        const result = await platformService.recordInvoicePayment(invoiceId, state, admin.name);
        if (!result.ok) {
          state.error = result.error;
          state.saved = false;
        } else {
          state.error = '';
          state.saved = true;
          state.activation = result.automation?.[0] ?? null;
          state.amount = '';
          state.reference = '';
        }
        draw();
      });
    }
  }
  draw();
}
