// "Needs you": everything the Super Admin has to decide, each with a one-click action. Anything the system can do alone
// (trial, first invoice, activation on payment, renewal invoices) is already done and only reported here.
import { escapeHtml, on, qs } from '../../components/dom.js';
import { CURRENCY } from '../../config/plans.js';
import { BILLING_LABEL } from '../../services/packageService.js';
import * as AU from '../../services/platformAutomation.js';
import * as P from '../../services/platformService.js';

const fmt = (n) => Number(n).toLocaleString('en-US');
const head = (t, n, extra = '') => `<div class="flex flex-wrap items-center justify-between gap-2" style="margin-top:.9rem;"><h3 class="text-sm" style="font-weight:600;">${escapeHtml(t)} <span class="badge badge-gold">${n}</span></h3>${extra}</div>`;
const row = (left, right) => `<div class="flex flex-wrap items-center justify-between gap-2 text-sm" style="border-top:1px solid var(--ink-100);padding:.5rem 0;"><span>${left}</span><span class="flex gap-2 flex-wrap">${right}</span></div>`;

export function describeApproval(r) {
  const parts = [`Approved ${r.school.schoolName}: ${r.packageName} (${(BILLING_LABEL[r.billing] ?? r.billing).toLowerCase()}).`];
  if (r.trial) parts.push(`${r.packageName} is open until ${r.trialUntil} on trial.`);
  if (r.invoice) parts.push(`Invoice ${r.invoice.number} for ${CURRENCY} ${fmt(r.invoice.total)} issued, due ${r.invoice.dueDate}.`);
  return [...parts, ...r.notes.filter((n) => !/trial started/.test(n))].join(' ');
}

export function renderAttentionPanel(host, { admin, go, refresh, notice = '' }) {
  const who = admin?.name ?? 'Administrator'; const a = AU.attention(); const last = AU.lastRun();
  const pendingCount = a.pending.length; const approvable = a.pending.filter((p) => p.plan);
  host.innerHTML = `<section class="card card-p no-print" id="needs-you">
    <div class="flex flex-wrap items-center justify-between gap-2"><h2 class="text-sm text-ink-700" style="font-weight:600;">Needs you ${a.total ? `<span class="badge badge-gold">${a.total}</span>` : ''}</h2>
      <span class="text-xs text-ink-400">${last ? `Automation last ran ${escapeHtml(last.date)}${last.renewalInvoices ? `: ${last.renewalInvoices} renewal invoice${last.renewalInvoices === 1 ? '' : 's'} created` : ''}` : ''}</span></div>
    ${notice ? `<div class="notice" role="status" style="margin-top:.5rem;"><span>${escapeHtml(notice)}</span></div>` : ''}
    ${a.total === 0 ? '<p class="text-sm" style="color:var(--good,#2e7d4f);margin-top:.5rem;">All clear. Nothing is waiting for you.</p>' : ''}
    ${pendingCount ? `${head('Schools awaiting approval', pendingCount, approvable.length > 1 ? `<button class="btn-primary btn-sm" id="approve-all">Approve all ${approvable.length} &amp; invoice</button>` : '')}
      ${a.pending.map((p) => row(`<b>${escapeHtml(p.school.schoolName)}</b> <span class="text-xs text-ink-500">${escapeHtml(p.plan?.name ?? 'no valid package')} · ${escapeHtml(BILLING_LABEL[p.billing] ?? '')} · ${p.needsQuotation ? 'needs a quotation' : `${CURRENCY} ${fmt(p.total)}`}${p.school.studentCount ? ` · ${fmt(p.school.studentCount)} students` : ''}${p.overBand ? ' · <b style="color:var(--bad);">above package limit</b>' : ''}</span>`, `<button class="btn-primary btn-sm" data-approve="${p.school.id}">Approve &amp; invoice</button><button class="btn-secondary btn-sm" data-reject="${p.school.id}" style="color:var(--bad);">Reject</button><button class="btn-ghost btn-sm" data-open="${p.school.id}">Details</button>`)).join('')}` : ''}
    ${a.toVerify.length ? `${head('Payments to verify', a.toVerify.length)}${a.toVerify.map((p) => row(`<b>${escapeHtml(p.schoolName)}</b> <span class="text-xs text-ink-500">${escapeHtml(p.method)} · ref ${escapeHtml(p.reference)} · ${CURRENCY} ${fmt(p.amount)}</span>`, `<button class="btn-primary btn-sm" data-verify="${p.id}">Verified: activate</button><button class="btn-secondary btn-sm" data-reject-pay="${p.id}" style="color:var(--bad);">Reject</button>`)).join('')}` : ''}
    ${a.overdue.length ? `${head('Overdue invoices', a.overdue.length, `<span class="text-xs text-ink-500">${CURRENCY} ${fmt(a.overdueTotal)} in total</span>`)}${a.overdue.slice(0, 8).map((o) => row(`<b>${escapeHtml(o.schoolName)}</b> <span class="text-xs text-ink-500">${escapeHtml(o.invoice.number)} · ${CURRENCY} ${fmt(o.invoice.balance)} · ${o.daysLate} day${o.daysLate === 1 ? '' : 's'} late</span>`, `<button class="btn-secondary btn-sm" data-remind="${o.invoice.id}">Copy reminder</button><button class="btn-ghost btn-sm" data-invoice="${o.invoice.id}" data-school="${o.invoice.accountId}">Open</button>`)).join('')}${a.overdue.length > 8 ? `<p class="text-xs text-ink-400">and ${a.overdue.length - 8} more under Invoices → Overdue.</p>` : ''}` : ''}
    ${a.renewals.filter((r) => !r.invoice).length ? `${head('Renewals due, not yet invoiced', a.renewals.filter((r) => !r.invoice).length, '<button class="btn-primary btn-sm" id="make-renewals">Create renewal invoices</button>')}` : ''}
    ${a.trials.length ? `${head('Trials ending soon', a.trials.length)}${a.trials.map((t) => row(`<b>${escapeHtml(t.school.schoolName)}</b> <span class="text-xs text-ink-500">trial ends ${escapeHtml(t.trialUntil)} (${t.daysLeft < 0 ? 'ended' : `${t.daysLeft} day${t.daysLeft === 1 ? '' : 's'}`})</span>`, `<button class="btn-ghost btn-sm" data-open="${t.school.id}">Open</button>`)).join('')}` : ''}
    ${a.nearCapacity.length ? `${head('Close to their student limit', a.nearCapacity.length)}${a.nearCapacity.map((c) => row(`<b>${escapeHtml(c.school.schoolName)}</b> <span class="text-xs text-ink-500">${c.active} of ${c.max ?? '?'} students (${escapeHtml(c.level.replace('_', ' '))}). A larger package is the next step.</span>`, `<button class="btn-ghost btn-sm" data-open="${c.school.id}">Open</button>`)).join('')}` : ''}
  </section>`;

  const done = (msg) => refresh(msg);
  qs(host, '#approve-all')?.addEventListener('click', () => {
    if (!confirm(`Approve ${approvable.length} schools, start their trials and issue their first invoices?`)) return;
    const r = AU.approveMany(approvable.map((p) => p.school.id), who);
    done(`${r.approved.length} school${r.approved.length === 1 ? '' : 's'} approved, ${r.invoices} invoice${r.invoices === 1 ? '' : 's'} issued.${r.failed.length ? ` ${r.failed.length} could not be approved.` : ''}${r.approved.some((x) => x.notes.some((n) => /quotation|confirmed|limit/.test(n))) ? ' Some need a look: ' + r.approved.flatMap((x) => x.notes.filter((n) => /quotation|confirmed|limit/.test(n)).map((n) => `${x.school.schoolName}: ${n}`)).join(' ') : ''}`);
  });
  on(host, '[data-approve]', 'click', (e) => { const r = AU.approveAndAllocate(e.currentTarget.dataset.approve, who); done(r.ok ? describeApproval(r) : r.error); });
  on(host, '[data-reject]', 'click', (e) => { const reason = prompt('Reason for rejecting (the school will see this):'); if (reason === null) return; P.setSchoolStatus(e.currentTarget.dataset.reject, 'rejected', reason, who); done('School rejected.'); });
  on(host, '[data-open]', 'click', (e) => go({ tab: 'schools', schoolId: e.currentTarget.dataset.open }));
  on(host, '[data-invoice]', 'click', (e) => go({ tab: 'schools', schoolId: e.currentTarget.dataset.school, invoiceId: e.currentTarget.dataset.invoice }));
  on(host, '[data-verify]', 'click', async (e) => { try { const r = await AU.verifyPaymentAuto(e.currentTarget.dataset.verify, { approve: true, actor: who }); done(`Payment verified. Subscription active until ${r.subscription?.expiryDate ?? '—'}${r.invoice ? `; invoice ${r.invoice.number} marked paid` : ''}.`); } catch (error) { done(error.message); } });
  on(host, '[data-reject-pay]', 'click', async (e) => { const note = prompt('Why is this payment rejected? (the school will see this)'); if (note === null) return; try { await AU.verifyPaymentAuto(e.currentTarget.dataset.rejectPay, { approve: false, note, actor: who }); done('Payment rejected.'); } catch (error) { done(error.message); } });
  on(host, '[data-remind]', 'click', async (e) => {
    const inv = P.getInvoice(e.currentTarget.dataset.remind); const text = AU.reminderText(inv, P.getSchool(inv.accountId));
    try { await navigator.clipboard.writeText(text); done('Reminder copied. Paste it into SMS, WhatsApp or email.'); } catch { prompt('Copy this reminder:', text); }
  });
  qs(host, '#make-renewals')?.addEventListener('click', () => { const r = AU.createRenewalInvoices(who); done(`${r.created.length} renewal invoice${r.created.length === 1 ? '' : 's'} created${r.skipped.length ? `; ${r.skipped.length} skipped: ${r.skipped.map((x) => `${x.school} (${x.reason})`).join(' ')}` : ''}.`); });
}
