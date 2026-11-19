// School-side Subscription page: current package, capacity, the price breakdown with the
// total clearly stated, the subscription request, and manual payment submission.
// Submitting a payment reference only queues it for the platform team — it never activates anything.
import { escapeHtml, on, qs } from '../../components/dom.js';
import {
  getCatalogue, loadCatalogue, activePackages, enabledBilling, packageById, buildQuote, money, BILLING_LABEL, renewalState, effectiveStatus,
} from '../../services/packageService.js';
import { CAPACITY_LEVELS } from '../../services/capacityService.js';
import * as subs from '../../services/subscriptionService.js';
import { isAdmin } from '../../services/accessService.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { myInvoices } from '../../services/platformAutomation.js';
import { getPlatformSettings, isOverdue } from '../../services/platformService.js';

const METHODS = [['mpesa', 'M-Pesa'], ['bank', 'Bank transfer'], ['cash', 'Cash / cheque (office)'], ['other', 'Other']];
const STATUS_TEXT = { none: 'No package assigned (all current features stay available)', requested: 'Awaiting verified payment', active: 'Active', trial: 'Trial', expired: 'Expired', suspended: 'Suspended' };

export async function renderSubscription(container) {
  const st = { error: '', flash: '', selection: null, payments: [], pay: { method: 'mpesa', reference: '', amount: '', note: '' } };

  async function draw() {
    container.innerHTML = '<p class="text-sm text-ink-500">Loading subscription…</p>';
    await loadCatalogue();
    await subs.refreshCapacity();
    const cat = getCatalogue();
    const sub = subs.currentSubscription();
    const cap = subs.currentCapacity();
    const status = effectiveStatus(sub, new Date(), cat.graceDays ?? 0);
    const renewal = renewalState(sub, cat);
    const pkg = packageById(sub?.packageId, cat);
    st.payments = await subs.listMyPayments().catch(() => []);
    st.selection ??= {
      packageId: sub?.requested?.packageId ?? sub?.packageId ?? subs.suggestedPackageForSchool().id,
      billing: sub?.requested?.billing ?? sub?.billing ?? enabledBilling(cat)[0]?.[0] ?? 'annual',
      addons: [...(sub?.requested?.addons ?? sub?.addons ?? [])], charges: [],
    };
    const sel = st.selection;
    const quote = buildQuote(sel, cat);
    const suggested = subs.suggestedPackageForSchool();
    const canEdit = isAdmin();
    const invoices = isSupabaseConfigured() ? [] : myInvoices();
    const instructions = isSupabaseConfigured() ? '' : getPlatformSettings().paymentInstructions;
    const heldQuote = sub?.requested?.quote;
    const paid = sub?.quote;

    container.innerHTML = `
      <div class="space-y-5" style="max-width:56rem;">
        <div><h1 class="text-xl" style="font-weight:600;">Subscription</h1><p class="text-sm text-ink-500 mt-1">Your package, student capacity and what you pay.</p></div>
        ${st.flash ? `<div class="notice" role="status"><span>${escapeHtml(st.flash)}</span></div>` : ''}
        ${st.error ? `<div class="notice" role="alert"><span>${escapeHtml(st.error)}</span></div>` : ''}

        <section class="card card-p space-y-2">
          <div class="flex justify-between flex-wrap gap-2"><h2 class="text-sm text-ink-700" style="font-weight:600;">Current subscription</h2><span class="badge ${status === 'active' ? 'badge-good' : status === 'none' ? 'badge-muted' : 'badge-gold'}">${escapeHtml(STATUS_TEXT[status] ?? status)}</span></div>
          ${sub ? `<div class="grid grid-2 lg-grid-4 gap-3 text-sm">
            <div><p class="text-ink-500">Package</p><strong>${escapeHtml(pkg?.name ?? '—')}</strong></div>
            <div><p class="text-ink-500">Billing</p><strong>${escapeHtml(BILLING_LABEL[sub.billing] ?? '—')}</strong></div>
            <div><p class="text-ink-500">Started</p><strong>${escapeHtml(sub.startDate ?? '—')}</strong></div>
            <div><p class="text-ink-500">Expires</p><strong>${escapeHtml(sub.expiryDate ?? sub.trialUntil ?? '—')}</strong></div>
            <div><p class="text-ink-500">Add-ons</p><strong>${escapeHtml((sub.addons ?? []).map((id) => cat.addons.find((a) => a.id === id)?.name ?? id).join(', ') || 'None')}</strong></div>
            <div><p class="text-ink-500">Amount paid</p><strong>${paid && !paid.needsQuotation ? escapeHtml(money(cat, paid.total)) : '—'}</strong></div>
            <div><p class="text-ink-500">Renewal</p><strong>${escapeHtml(renewal.label)}</strong></div>
            <div><p class="text-ink-500">Payment reference</p><strong>${escapeHtml(sub.paymentReference ?? '—')}</strong></div></div>`
          : '<p class="text-sm text-ink-600">No package has been assigned to this school yet, so nothing is restricted. Choose a package below when you are ready.</p>'}
          ${status === 'requested' ? '<div class="notice"><span>Only your essential school records are open until the platform team has verified your payment.</span></div>' : ''}
        </section>

        ${invoices.length ? `<section class="card card-p space-y-2"><h2 class="text-sm text-ink-700" style="font-weight:600;">Invoices</h2>
          ${status === 'trial' && sub?.trialUntil ? `<div class="notice"><span>You are on a trial until <strong>${escapeHtml(sub.trialUntil)}</strong>. Pay the invoice below before then to keep everything your package includes.</span></div>` : ''}
          ${renewal.due && status === 'active' ? `<div class="notice"><span>${escapeHtml(renewal.label)}. Pay the renewal invoice to continue without a break.</span></div>` : ''}
          <div class="overflow-x-auto"><table class="data-table"><thead><tr><th>Invoice</th><th>Issued</th><th>Due</th><th class="text-right">Amount</th><th class="text-right">Balance</th><th>Status</th></tr></thead><tbody>${invoices.map((i) => `<tr><td>${escapeHtml(i.number)}${i.renewal ? ' <span class="text-xs text-ink-500">(renewal)</span>' : ''}</td><td>${escapeHtml(i.issueDate)}</td><td>${escapeHtml(i.dueDate ?? '—')}</td><td class="text-right">${escapeHtml(money(cat, i.total))}</td><td class="text-right">${escapeHtml(money(cat, i.balance))}</td><td>${i.status === 'paid' ? '<span class="badge badge-good">Paid</span>' : isOverdue(i) ? '<span class="badge badge-bad">Overdue</span>' : '<span class="badge badge-gold">Unpaid</span>'}</td></tr>`).join('')}</tbody></table></div>
          ${instructions && invoices.some((i) => i.balance > 0) ? `<div style="border:1px solid var(--ink-100);border-radius:.6rem;padding:.75rem;"><h3 class="text-sm" style="font-weight:600;">How to pay</h3><p class="text-sm" style="white-space:pre-wrap;">${escapeHtml(instructions)}</p><p class="text-xs text-ink-500 mt-1">After paying, submit your reference below so the platform team can confirm it. Your subscription activates as soon as it is confirmed.</p></div>` : ''}
        </section>` : ''}

        <section class="card card-p space-y-2">
          <div class="flex justify-between flex-wrap gap-2"><h2 class="text-sm text-ink-700" style="font-weight:600;">Student capacity</h2><span class="badge ${cap.level === 'full' ? 'badge-bad' : cap.level === 'ok' ? 'badge-good' : 'badge-gold'}">${escapeHtml(CAPACITY_LEVELS[cap.level])}</span></div>
          ${cap.unlimited ? `<p class="text-sm">${cap.active} active students. No limit applies until a package is assigned.</p>` : `
            <div style="background:var(--ink-100);border-radius:99px;height:.7rem;overflow:hidden;"><div style="height:100%;width:${Math.min(100, Math.round((cap.active / cap.max) * 100))}%;background:${cap.level === 'full' ? 'var(--bad)' : cap.level === 'ok' ? 'var(--good)' : 'var(--gold-500, #c8962b)'};"></div></div>
            <p class="text-sm"><strong>${cap.active}</strong> active of <strong>${cap.paidLimit}</strong> paid · overflow allowance <strong>${cap.overflow}</strong> · maximum <strong>${cap.max}</strong> · ${cap.remainingPaid} paid places left · ${cap.remainingOverflow} overflow places left</p>
            ${cap.message ? `<div class="notice"><span>${escapeHtml(cap.message)}</span></div>` : ''}`}
        </section>

        ${canEdit ? `
        <section class="card card-p space-y-3">
          <h2 class="text-sm text-ink-700" style="font-weight:600;">Choose or change package</h2>
          <p class="text-sm text-ink-600">Suggested for ${cap.active || 'your'} student${cap.active === 1 ? '' : 's'}: <strong>${escapeHtml(suggested.name)}</strong>.</p>
          <div class="grid grid-2 lg-grid-3 gap-3">${activePackages(cat).map((p) => `
            <label class="card card-p" style="cursor:pointer;border:2px solid ${p.id === sel.packageId ? 'var(--brand-700)' : 'var(--ink-100)'};">
              <input type="radio" name="pkg" value="${p.id}" ${p.id === sel.packageId ? 'checked' : ''} />
              <strong> ${escapeHtml(p.name)}</strong>
              <div class="text-xs text-ink-500">${p.custom ? 'Custom student limit' : `Up to ${p.paidLimit.toLocaleString('en-US')} students (+${p.overflow} overflow)`}</div>
              <div class="text-sm mt-1">${p.custom ? 'Custom quotation' : enabledBilling(cat).map(([k, l]) => `${l}: ${p.prices[k] == null ? 'price to be confirmed' : money(cat, p.prices[k])}`).join('<br>')}</div></label>`).join('')}</div>
          <div class="flex flex-wrap gap-4 items-center"><span class="label" style="margin:0;">Billing</span>${enabledBilling(cat).map(([k, l]) => `<label class="text-sm"><input type="radio" name="billing" value="${k}" ${k === sel.billing ? 'checked' : ''} /> ${l}</label>`).join('')}</div>
          <div class="flex flex-wrap gap-4 items-center"><span class="label" style="margin:0;">Add-ons</span>${cat.addons.filter((a) => a.active).map((a) => `<label class="text-sm"><input type="checkbox" data-addon="${a.id}" ${sel.addons.includes(a.id) ? 'checked' : ''} /> ${escapeHtml(a.name)}</label>`).join('')}</div>
          <div class="flex flex-wrap gap-4 items-center"><span class="label" style="margin:0;">One-time services</span>${cat.charges.filter((c) => c.kind === 'one-time').map((c) => `<label class="text-sm"><input type="checkbox" data-charge="${c.id}" ${sel.charges.includes(c.id) ? 'checked' : ''} /> ${escapeHtml(c.name)}</label>`).join('')}</div>

          <div style="border:1px solid var(--ink-100);border-radius:.6rem;padding:.85rem;">
            <h3 class="text-sm" style="font-weight:600;">Price breakdown</h3>
            <table class="data-table"><tbody>${quote.lines.map((l) => `<tr><td>${escapeHtml(l.label)}</td><td style="text-align:right;">${l.amount == null ? '<em>to be confirmed</em>' : l.amount < 0 ? `− ${escapeHtml(money(cat, -l.amount))}` : escapeHtml(money(cat, l.amount))}</td></tr>`).join('')}
              <tr><td><strong>Total payable${quote.needsQuotation ? ' (excluding items still to be confirmed)' : ''}</strong></td><td style="text-align:right;"><strong>${escapeHtml(money(cat, quote.total))}</strong></td></tr></tbody></table>
            ${quote.needsQuotation ? '<p class="text-xs text-ink-500 mt-2">Some items have no confirmed price yet. SwiftIQ EduFlow will send you a quotation before you pay.</p>' : ''}
            ${quote.notes.map((n) => `<p class="text-xs text-ink-500 mt-1">${escapeHtml(n)}</p>`).join('')}
          </div>
          <button class="btn-primary" id="sub-request">Submit subscription request</button>
        </section>

        ${sub?.requested ? `
        <section class="card card-p space-y-3">
          <h2 class="text-sm text-ink-700" style="font-weight:600;">Pay and submit for verification</h2>
          <p class="text-sm text-ink-600">Requested: <strong>${escapeHtml(packageById(sub.requested.packageId, cat)?.name ?? '')}</strong>, ${escapeHtml(BILLING_LABEL[sub.requested.billing] ?? '')}${heldQuote && !heldQuote.needsQuotation ? ` — total ${escapeHtml(money(cat, heldQuote.total))}` : ''}. Pay as instructed by SwiftIQ EduFlow, then enter the reference below. <strong>Your package changes only after the platform team verifies the payment.</strong></p>
          <div class="grid grid-2 lg-grid-4 gap-3">
            <div><label class="label">Method</label><select class="input" data-pay="method">${METHODS.map(([k, l]) => `<option value="${k}" ${st.pay.method === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div><label class="label">Reference / transaction code</label><input class="input" data-pay="reference" value="${escapeHtml(st.pay.reference)}" /></div>
            <div><label class="label">Amount paid (${cat.currency})</label><input class="input" type="number" min="1" data-pay="amount" value="${escapeHtml(st.pay.amount)}" /></div>
            <div><label class="label">Note (optional)</label><input class="input" data-pay="note" value="${escapeHtml(st.pay.note)}" /></div></div>
          <button class="btn-primary" id="sub-pay">Submit payment for verification</button>
        </section>` : ''}` : '<div class="notice"><span>Only the school administrator can change the subscription.</span></div>'}

        ${st.payments.length ? `<section class="card card-p"><h2 class="text-sm text-ink-700 mb-2" style="font-weight:600;">Payment submissions</h2><table class="data-table"><thead><tr><th>Date</th><th>Reference</th><th>Amount</th><th>Status</th></tr></thead><tbody>${st.payments.map((p) => `<tr><td>${escapeHtml(String(p.submittedAt).slice(0, 10))}</td><td>${escapeHtml(p.reference)}</td><td>${escapeHtml(money(cat, p.amount))}</td><td><span class="badge ${p.status === 'verified' ? 'badge-good' : p.status === 'rejected' ? 'badge-bad' : 'badge-gold'}">${p.status === 'awaiting_verification' ? 'Awaiting verification' : escapeHtml(p.status)}</span>${p.verifyNote ? ` <span class="text-xs text-ink-500">${escapeHtml(p.verifyNote)}</span>` : ''}</td></tr>`).join('')}</tbody></table></section>` : ''}

        <p class="text-xs text-ink-500">SMS, WhatsApp, payment processing, setup, training, data migration and custom development are charged separately from the subscription.</p>
      </div>`;

    on(container, '[name="pkg"]', 'change', (e) => { sel.packageId = e.currentTarget.value; draw(); });
    on(container, '[name="billing"]', 'change', (e) => { sel.billing = e.currentTarget.value; draw(); });
    on(container, '[data-addon]', 'change', (e) => { const id = e.currentTarget.dataset.addon; sel.addons = e.currentTarget.checked ? [...new Set([...sel.addons, id])] : sel.addons.filter((x) => x !== id); draw(); });
    on(container, '[data-charge]', 'change', (e) => { const id = e.currentTarget.dataset.charge; sel.charges = e.currentTarget.checked ? [...new Set([...sel.charges, id])] : sel.charges.filter((x) => x !== id); draw(); });
    on(container, '[data-pay]', 'input', (e) => { st.pay[e.currentTarget.dataset.pay] = e.currentTarget.value; });
    qs(container, '#sub-request')?.addEventListener('click', async () => {
      try { await subs.requestSubscription(sel); st.error = ''; st.flash = 'Request saved. Pay as instructed, then submit your payment reference below.'; } catch (e) { st.error = e.message; st.flash = ''; }
      draw();
    });
    qs(container, '#sub-pay')?.addEventListener('click', async () => {
      try { await subs.submitPayment(st.pay); st.pay = { method: 'mpesa', reference: '', amount: '', note: '' }; st.error = ''; st.flash = 'Payment submitted. It will be activated once it has been verified.'; } catch (e) { st.error = e.message; st.flash = ''; }
      draw();
    });
  }
  draw();
}
