import { escapeHtml, on, qs } from '../../components/dom.js';
import { CURRENCY } from '../../config/plans.js';
import { invoiceDocumentHtml } from '../../components/invoiceDocument.js';
import * as localPlatformService from '../../services/platformService.js';
import { importSchoolBackup } from '../../services/dataMigrationService.js';

const fmt = (n) => Number(n).toLocaleString('en-US');

// What a school sees before it has been approved (or after a rejection or
// suspension): its registration progress and its own package invoices —
// nothing else, and no access to the school's data.
export function renderAccountStatus(rootEl, { account, onLogout, onRefresh, platformService = localPlatformService }) {
  const status = account.status ?? 'approved';
  const state = { openInvoiceId: null, importing: false, importMessage: '' };

  async function draw() {
    let invoices;
    let settings;
    try {
      [invoices, settings] = await Promise.all([
        platformService.invoicesForAccount(account.id),
        platformService.getPlatformSettings(),
      ]);
    } catch (error) {
      rootEl.innerHTML = `<main class="pub-container auth-wrap"><div class="auth-card"><h1>Could not load your account</h1><p class="auth-sub">${escapeHtml(error.message)}</p><button class="btn btn-secondary" id="status-logout">Log out</button></div></main>`;
      qs(rootEl, '#status-logout').addEventListener('click', onLogout);
      return;
    }
    const live = invoices.filter((i) => i.status !== 'void');
    const invoiced = live.reduce((sum, invoice) => sum + invoice.total, 0);
    const paid = live.reduce((sum, invoice) => sum + invoice.paid, 0);
    const pay = {
      state: live.length === 0 ? 'none' : live.every((invoice) => invoice.status === 'paid') ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
      invoiced,
      paid,
      balance: invoiced - paid,
    };
    const open = state.openInvoiceId && invoices.find((i) => i.id === state.openInvoiceId);
    const school = { schoolName: account.schoolName, name: account.name, email: account.email, phone: account.phone };

    const steps = [
      ['Registered', true],
      ['Package invoice issued', live.length > 0],
      ['Payment confirmed', pay.state === 'paid'],
      ['Approved', status === 'approved'],
    ];

    const headline =
      status === 'approved'
        ? 'Your school has been approved'
        : status === 'rejected'
        ? "Your registration wasn't approved"
        : status === 'suspended'
        ? "Your school's access is suspended"
        : 'Your registration is awaiting approval';
    const lead =
      status === 'approved'
        ? 'Your school has been approved. You can manage student records in the shared workspace.'
        : status === 'rejected'
        ? 'Please contact us if you think this is a mistake.'
        : status === 'suspended'
        ? 'Please contact us to restore access.'
        : 'Thank you for registering. Once your package invoice is paid and confirmed, your school will be approved and you can start setting it up.';

    rootEl.innerHTML = `
      <div class="pub">
        <header class="pub-header no-print">
          <div class="pub-container pub-header-inner">
            <span class="pub-brand"><img src="./assets/logo-badge.png" alt="" width="36" height="36" class="brand-mark" /><span>SwiftIQ EduFlow</span></span>
            <span></span>
            <button class="btn btn-secondary btn-sm" id="status-logout">Log out</button>
          </div>
        </header>
        <main class="pub-container auth-wrap" style="max-width:48rem;">
          <div class="auth-card">
            <h1>${escapeHtml(headline)}</h1>
            <p class="auth-sub">${escapeHtml(lead)}</p>
            ${account.statusNote && status !== 'approved' ? `<div class="notice" style="margin-bottom:1rem;"><span><strong>Message from the administrator:</strong> ${escapeHtml(account.statusNote)}</span></div>` : ''}
            ${status === 'approved' ? `<section class="card card-p" style="margin:1rem 0;">
              <h2 class="text-sm text-ink-700" style="font-weight:600; margin-bottom:0.5rem;">Import existing school data</h2>
              <p class="text-sm text-ink-500" style="margin-bottom:0.75rem;">Choose a JSON backup exported from this browser to stage its records in the approved school workspace.</p>
              <div class="flex flex-wrap gap-3 items-center">
                <input class="input" id="school-backup-file" type="file" accept="application/json,.json" ${state.importing ? 'disabled' : ''} />
                <button class="btn-secondary" id="school-backup-import" ${state.importing ? 'disabled' : ''}>${state.importing ? 'Importing...' : 'Import backup'}</button>
              </div>
              ${state.importMessage ? `<p class="text-sm ${state.importMessage.ok ? 'text-good' : 'text-bad'}" role="status" style="margin-top:0.75rem;">${escapeHtml(state.importMessage.text)}</p>` : ''}
            </section>` : ''}

            <dl class="text-sm" style="margin-bottom:1rem;">
              <div class="flex justify-between" style="padding:0.3rem 0;"><dt class="text-ink-500">School</dt><dd>${escapeHtml(account.schoolName)}</dd></div>
              <div class="flex justify-between" style="padding:0.3rem 0;"><dt class="text-ink-500">Package</dt><dd>${escapeHtml(account.plan?.name ?? '—')} · ${account.plan?.modules === 'single' ? 'single module' : 'both modules'}</dd></div>
            </dl>

            ${
              status === 'pending'
                ? `<ol class="progress-steps">
                    ${steps.map(([label, done]) => `<li class="${done ? 'done' : ''}"><span>${done ? '✓' : ''}</span>${escapeHtml(label)}</li>`).join('')}
                  </ol>`
                : ''
            }

            <h2 class="text-sm text-ink-700" style="font-weight:600; margin:1.25rem 0 0.5rem;">Your invoices</h2>
            ${
              invoices.length === 0
                ? `<p class="text-sm text-ink-500" id="no-invoice">No invoice has been issued yet. We will issue your package invoice shortly.</p>`
                : `<ul style="list-style:none;margin:0;padding:0;" class="space-y-2">
                    ${invoices
                      .map(
                        (i) => `<li class="flex justify-between items-center" style="border:1px solid var(--ink-100); border-radius:0.6rem; padding:0.6rem 0.8rem;">
                          <span class="text-sm"><strong>${escapeHtml(i.number)}</strong> · ${CURRENCY} ${fmt(i.total)} · ${escapeHtml({ unpaid: 'Unpaid', partial: 'Partly paid', paid: 'Paid', void: 'Void' }[i.status])}</span>
                          <button class="btn-secondary btn-sm" data-view-invoice="${i.id}">View / print</button>
                        </li>`
                      )
                      .join('')}
                  </ul>`
            }
            ${open ? `<div style="margin-top:1rem;">${invoiceDocumentHtml({ invoice: open, school, settings })}<div class="no-print" style="margin-top:0.75rem;"><button class="btn-secondary" id="print-invoice">Print invoice</button></div></div>` : ''}

            <div class="flex gap-3 no-print" style="margin-top:1.5rem;">
              <button class="btn btn-primary" id="status-refresh">Check status</button>
            </div>
          </div>
        </main>
      </div>`;

    qs(rootEl, '#status-logout').addEventListener('click', onLogout);
    qs(rootEl, '#status-refresh').addEventListener('click', onRefresh);
    const importButton = qs(rootEl, '#school-backup-import');
    if (importButton) {
      importButton.addEventListener('click', async () => {
        const file = qs(rootEl, '#school-backup-file').files?.[0];
        if (!file) {
          state.importMessage = { ok: false, text: 'Choose a school backup file first.' };
          await draw();
          return;
        }
        state.importing = true;
        state.importMessage = { ok: true, text: 'Importing school records...' };
        await draw();
        try {
          const result = await importSchoolBackup(await file.text());
          state.importMessage = result.ok
            ? { ok: true, text: `${result.imported} school records and ${result.uploadedFiles ?? 0} private files imported.` }
            : { ok: false, text: `${result.imported ? `${result.imported} records imported before the error. ` : ''}${result.uploadedFiles ? `${result.uploadedFiles} files uploaded. ` : ''}${result.error}` };
        } catch (error) {
          state.importMessage = { ok: false, text: error.message };
        }
        state.importing = false;
        await draw();
      });
    }
    on(rootEl, '[data-view-invoice]', 'click', (e) => {
      const id = e.currentTarget.getAttribute('data-view-invoice');
      state.openInvoiceId = state.openInvoiceId === id ? null : id;
      draw();
    });
    const print = qs(rootEl, '#print-invoice');
    if (print) print.addEventListener('click', () => window.print());
  }
  draw();
}
