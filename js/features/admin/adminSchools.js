import { escapeHtml, on, qs } from '../../components/dom.js';
import { uuid } from '../../lib/uuid.js';
import { CURRENCY, allPlans, getPlan, populationLabel, priceText } from '../../config/plans.js';
import { getCatalogue, loadCatalogue, packageById, priceFor, enabledBilling, BILLING_LABEL, expiryFor } from '../../services/packageService.js';
import * as subs from '../../services/subscriptionService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { statusBadge } from './adminInvoices.js';
import * as localPlatformService from '../../services/platformService.js';
import * as automation from '../../services/platformAutomation.js';
import { renderAttentionPanel, describeApproval } from './adminAttention.js';
import { KENYA_COUNTIES, KENYA_SCHOOL_TYPES } from '../../config/kenyaEducation.js';

const fmt = (n) => Number(n).toLocaleString('en-US');

const STATUS_LABEL = { pending: 'Pending approval', approved: 'Approved', rejected: 'Rejected', suspended: 'Suspended' };
const PAYMENT_LABEL = { none: 'No invoice', unpaid: 'Unpaid', partial: 'Part paid', paid: 'Paid' };

function schoolStatusBadge(status) {
  const cls = status === 'approved' ? 'badge-good' : status === 'pending' ? 'badge-gold' : 'badge-bad';
  return `<span class="badge ${cls}">${escapeHtml(STATUS_LABEL[status] ?? status)}</span>`;
}

function paymentBadge(state) {
  const cls = state === 'paid' ? 'badge-good' : state === 'none' ? 'badge-muted' : 'badge-gold';
  return `<span class="badge ${cls}">${escapeHtml(PAYMENT_LABEL[state] ?? state)}</span>`;
}

function renderLoadError(body, error) {
  body.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error?.message ?? 'Could not load platform data.')}</span></div>`;
}

export function renderSchoolsList(body, go, platformService = localPlatformService, admin = null, notice = '') {
  const state = { status: '', query: '', schools: null, notice };
  const local = platformService === localPlatformService;

  async function draw() {
    let all;
    try {
      state.schools ??= await platformService.listSchools();
      all = state.schools;
    } catch (error) {
      renderLoadError(body, error);
      return;
    }
    let schools = all;
    if (state.status) schools = schools.filter((s) => s.status === state.status);
    if (state.query.trim()) {
      const q = state.query.trim().toLowerCase();
      schools = schools.filter((s) => s.schoolName.toLowerCase().includes(q) || s.email.includes(q) || s.name.toLowerCase().includes(q));
    }
    const count = (st) => all.filter((s) => s.status === st).length;
    const outstanding = all.filter((s) => s.status !== 'rejected').reduce((sum, s) => sum + s.payment.balance, 0);

    body.innerHTML = `
      <div class="space-y-4">
        ${local ? '<div id="attention-host"></div>' : ''}
        <div class="grid grid-2 lg-grid-4 gap-4">
          <div class="card card-p"><p class="text-sm text-ink-500">Awaiting approval</p><p class="stat-num">${count('pending')}</p></div>
          <div class="card card-p"><p class="text-sm text-ink-500">Approved schools</p><p class="stat-num">${count('approved')}</p></div>
          <div class="card card-p"><p class="text-sm text-ink-500">Suspended or rejected</p><p class="stat-num">${count('suspended') + count('rejected')}</p></div>
          <div class="card card-p"><p class="text-sm text-ink-500">Invoiced, not yet paid</p><p class="stat-num" style="font-size:1.35rem;">${CURRENCY} ${fmt(outstanding)}</p></div>
        </div>

        <div class="flex flex-wrap gap-3 items-center">
          <input class="input" style="max-width:18rem" id="school-search" placeholder="Search school, name or email" value="${escapeHtml(state.query)}" />
          <div class="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
            ${[['', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['suspended', 'Suspended'], ['rejected', 'Rejected']]
              .map(([v, label]) => `<button class="chip ${state.status === v ? 'active' : ''}" data-status="${v}">${label}</button>`)
              .join('')}
          </div>
        </div>

        ${
          all.length === 0
            ? `<div class="card">${emptyState({
                iconHtml: icons.users(40),
                title: 'No schools have registered yet',
                body: 'When a school signs up from the landing page it will appear here for review.',
              })}</div>`
            : schools.length === 0
            ? `<p class="text-sm text-ink-400">No schools match this filter.</p>`
            : `<div class="card overflow-x-auto">
                <table class="data-table">
                  <thead><tr><th>School</th><th>Contact</th><th>Package</th><th>Registered</th><th>Payment</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    ${schools
                      .map(
                        (s) => `<tr>
                          <td style="font-weight:500;">${escapeHtml(s.schoolName)}</td>
                          <td class="text-ink-600">${escapeHtml(s.name)}<br /><span class="text-xs text-ink-400">${escapeHtml(s.email)}</span></td>
                          <td class="text-ink-600">${escapeHtml(s.plan?.name ?? '—')}<br /><span class="text-xs text-ink-400">${escapeHtml(BILLING_LABEL[s.plan?.billing] ?? '')}</span></td>
                          <td class="text-ink-600">${escapeHtml(s.createdAt.slice(0, 10))}</td>
                          <td>${paymentBadge(s.payment.state)}</td>
                          <td>${schoolStatusBadge(s.status)}</td>
                          <td class="text-right"><button class="btn-secondary btn-sm" data-open-school="${s.id}">Manage</button></td>
                        </tr>`
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>`
        }
      </div>`;

    if (local) { renderAttentionPanel(qs(body, '#attention-host'), { admin, go, notice: state.notice, refresh: (msg) => { state.schools = null; state.notice = msg; draw(); } }); }
    const search = qs(body, '#school-search');
    search.addEventListener('input', async (e) => {
      const cursor = e.target.selectionStart;
      state.query = e.target.value;
      await draw();
      const again = qs(body, '#school-search');
      again.focus();
      again.setSelectionRange(cursor, cursor);
    });
    on(body, '[data-status]', 'click', (e) => {
      state.status = e.currentTarget.getAttribute('data-status');
      draw();
    });
    on(body, '[data-open-school]', 'click', (e) => go({ schoolId: e.currentTarget.getAttribute('data-open-school') }));
  }
  draw();
}

export function renderSchoolDetail(body, schoolId, admin, go, platformService = localPlatformService) {
  const deleteEnabled = platformService !== localPlatformService;
  const dueDefault = () => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  };
  const state = { invoiceFormOpen: false, items: [], dueDate: dueDefault(), note: '', invoiceErrors: [], planId: '', billing: '', subRow: null };

  async function draw() {
    let school;
    let invoices;
    try {
      [school, invoices] = await Promise.all([
        platformService.getSchool(schoolId),
        platformService.invoicesForAccount(schoolId),
      ]);
    } catch (error) {
      renderLoadError(body, error);
      return;
    }
    if (!school) {
      body.innerHTML = `<div class="card">${emptyState({ title: 'School not found', actionsHtml: `<button class="btn-secondary" id="sd-back">Back to schools</button>` })}</div>`;
      qs(body, '#sd-back').addEventListener('click', () => go({ schoolId: null }));
      return;
    }
    await loadCatalogue().catch(() => {});
    if (!state.planId) {
      state.planId = getPlan(school.plan?.planId) ? school.plan.planId : (allPlans()[0]?.id ?? '');
      state.billing = school.plan?.billing ?? 'annual';
    }
    const plan = getPlan(school.plan?.planId);
    const overBand = plan && !plan.custom && school.studentCount && school.studentCount > plan.paidLimit;
    const pay = school.payment;
    const previewPlan = getPlan(state.planId);
    try {
      const row = (await subs.listSchoolSubscriptions()).find((r) => String(r.schoolId) === String(school.id));
      state.subRow = row ? subs.summariseSchool(row) : null;
    } catch { state.subRow = null; }
    const sub = state.subRow?.subscription ?? null;
    const subStatus = state.subRow?.subscriptionStatus ?? 'none';
    const SUB_LABEL = { none: 'No subscription yet', requested: 'Requested — awaiting payment', active: 'Active', trial: 'Trial', suspended: 'Suspended', expired: 'Expired' };

    body.innerHTML = `
      <div class="space-y-4">
        <button class="btn-ghost" id="sd-back">← All schools</button>

        <div class="flex justify-between items-start flex-wrap gap-3">
          <div>
            <h2 class="text-xl" style="font-weight:600;">${escapeHtml(school.schoolName)}</h2>
            <p class="text-sm text-ink-500 mt-1">Registered ${escapeHtml(school.createdAt.slice(0, 10))}</p>
          </div>
          <div class="flex gap-2 items-center flex-wrap">
            ${paymentBadge(pay.state)} ${schoolStatusBadge(school.status)}
            <button class="btn-secondary btn-sm" id="delete-school-btn" style="color:var(--bad);" ${deleteEnabled ? '' : 'disabled title="School deletion is unavailable in demo mode."'}>
              ${deleteEnabled ? 'Delete school' : 'Delete school (unavailable in demo mode)'}
            </button>
          </div>
        </div>

        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        ${state.flash ? `<div class="notice" role="status"><span>${escapeHtml(state.flash)}</span></div>` : ''}
        ${school.statusNote ? `<div class="notice"><span><strong>Note:</strong> ${escapeHtml(school.statusNote)}</span></div>` : ''}

        <div class="card card-p no-print">
          <h3 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Decision</h3>
          <p class="text-sm text-ink-600 mb-3">
            ${
              school.status === 'pending'
                ? 'One click approves the school, allocates the package it chose, starts its trial and issues the first invoice. The subscription then activates by itself when that invoice is paid.'
                : school.status === 'approved'
                ? 'This school is approved and can log in. Its subscription activates automatically when its invoice is paid.'
                : school.status === 'suspended'
                ? 'This school is suspended and cannot log in to its data.'
                : 'This registration was rejected.'
            }
          </p>
          <div class="flex flex-wrap gap-2">
            ${school.status === 'pending' || school.status === 'rejected' ? `<button class="btn-primary" id="approve-auto-btn">Approve &amp; invoice</button><button class="btn-secondary" id="approve-btn">Approve only</button>` : ''}
            ${school.status === 'pending' ? `<button class="btn-secondary" id="reject-btn" style="color:var(--bad);">Reject</button>` : ''}
            ${school.status === 'approved' ? `<button class="btn-secondary" id="suspend-btn" style="color:var(--bad);">Suspend</button>` : ''}
            ${school.status === 'suspended' ? `<button class="btn-primary" id="reactivate-btn">Reactivate</button>` : ''}
          </div>
        </div>

        <div class="grid sm-grid-2 gap-4">
          <div class="card card-p">
            <h3 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Contact</h3>
            <dl class="text-sm">
              <div class="flex justify-between" style="padding:0.3rem 0;"><dt class="text-ink-500">Administrator</dt><dd>${escapeHtml(school.name)}</dd></div>
              <div class="flex justify-between" style="padding:0.3rem 0;"><dt class="text-ink-500">Email</dt><dd>${escapeHtml(school.email)}</dd></div>
              <div class="flex justify-between" style="padding:0.3rem 0;"><dt class="text-ink-500">Phone</dt><dd>${escapeHtml(school.phone ?? '—')}</dd></div>
              <div class="flex justify-between" style="padding:0.3rem 0;"><dt class="text-ink-500">School type</dt><dd>${escapeHtml(KENYA_SCHOOL_TYPES.find(([code]) => code === school.schoolType)?.[1] ?? school.schoolType ?? '—')}</dd></div>
              <div class="flex justify-between" style="padding:0.3rem 0;"><dt class="text-ink-500">County</dt><dd>${escapeHtml(KENYA_COUNTIES.find(([code]) => code === school.countyCode)?.[1] ?? school.countyCode ?? '—')}</dd></div>
              <div class="flex justify-between" style="padding:0.3rem 0;"><dt class="text-ink-500">Students (as declared)</dt><dd>${school.studentCount ? fmt(school.studentCount) : '—'}</dd></div>
            </dl>
            ${overBand ? `<p class="text-xs" style="color:var(--bad);margin-top:0.5rem;">Declared students exceed this package's limit of ${fmt(plan.paidLimit)}. Consider moving them to a larger package.</p>` : ''}
          </div>

          <div class="card card-p no-print" id="pkg-auto">
            <h3 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Package &amp; students</h3>
            ${(() => {
              const row = state.subRow; const c = row?.capacity; const ren = row?.renewal; const cat = getCatalogue(); const sp = sub?.packageId ? packageById(sub.packageId, cat) : null; const next = sub?.nextPackageId ? packageById(sub.nextPackageId, cat) : null;
              const pct = c && !c.unlimited && c.paidLimit ? Math.min(100, Math.round((c.active / c.paidLimit) * 100)) : 0;
              return `<p class="text-sm"><strong>${escapeHtml(sp?.name ?? school.plan?.name ?? '—')}</strong> · ${escapeHtml({ monthly: 'monthly', termly: 'per term', annual: 'per year' }[sub?.billing ?? school.plan?.billing] ?? '')}${next ? ` · <span class="text-ink-600">moves to <strong>${escapeHtml(next.name)}</strong> at renewal</span>` : ''}</p>
              ${c ? `<div style="margin:.6rem 0;"><div class="flex justify-between text-sm"><span>Students</span><span><strong>${fmt(c.active)}</strong> of ${c.unlimited ? 'unlimited' : fmt(c.paidLimit)}${!c.unlimited && c.overflow ? ` <span class="text-xs text-ink-500">(+${fmt(c.overflow)} allowance)</span>` : ''}</span></div>
                <div class="cbc-bar" role="img" aria-label="${pct}% of the student limit used"><span style="width:${pct}%;background:${c.level === 'ok' ? 'var(--good)' : c.level === 'warning' ? 'var(--warn)' : 'var(--bad)'}"></span></div>${c.message ? `<p class="text-xs text-ink-600" style="margin-top:.3rem;">${escapeHtml(c.message)}</p>` : '<p class="text-xs text-ink-500" style="margin-top:.3rem;">Within the limit. Admissions stop automatically at the limit plus allowance.</p>'}</div>` : ''}
              <p class="text-sm"><strong>Subscription:</strong> <span class="badge ${subStatus === 'active' ? 'badge-good' : subStatus === 'none' ? 'badge-muted' : subStatus === 'suspended' || subStatus === 'expired' ? 'badge-bad' : 'badge-gold'}">${escapeHtml(SUB_LABEL[subStatus] ?? subStatus)}</span> ${ren?.label && subStatus !== 'none' ? `<span class="text-xs text-ink-500">${escapeHtml(ren.label)}</span>` : ''}</p>
              <p class="text-xs text-ink-500" style="margin:.3rem 0 .8rem;">${subStatus === 'active' ? 'Renews by invoice: it is created automatically before the end date and the subscription continues when it is paid.' : subStatus === 'trial' ? 'On trial. Paying the invoice switches the package on for the full period; if it is not paid by the end of the trial the school drops to its essential records.' : subStatus === 'requested' || subStatus === 'none' ? 'Waiting for the first payment. It switches on by itself when the invoice is paid.' : subStatus === 'expired' ? 'Lapsed: the school has its essential records only. Paying an invoice restores everything.' : ''}</p>
              <label class="label" for="sd-change-pkg">Change package</label>
              <div class="flex gap-2"><select class="input" id="sd-change-pkg">${allPlans().map((p) => `<option value="${p.id}" ${(sub?.nextPackageId ?? sub?.packageId ?? school.plan?.planId) === p.id ? 'selected' : ''}>${escapeHtml(p.name)}: ${escapeHtml(populationLabel(p))}</option>`).join('')}</select><button class="btn-primary btn-sm" id="sd-change-apply">Apply</button></div>
              <p class="text-xs text-ink-500" style="margin-top:.3rem;">Moving up applies now with an invoice for the days left. Moving down applies at renewal. Before the first payment the invoice is simply reissued.</p>`;
            })()}
          </div>
        </div>

        <details class="no-print"><summary class="text-sm text-ink-500" style="cursor:pointer;padding:.25rem 0;">Manual overrides (rarely needed)</summary>
          <div class="card card-p no-print" style="margin-top:.5rem;">
            <h3 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Package &amp; subscription</h3>
            <p class="text-sm mb-2"><strong>${escapeHtml(school.plan?.name ?? '—')}</strong>${plan ? ` · ${escapeHtml(populationLabel(plan))}` : ' <span class="badge badge-gold">old plan — choose a new package</span>'}${school.plan?.billing ? ` · billed ${escapeHtml((BILLING_LABEL[school.plan.billing] ?? '').toLowerCase())}` : ''}</p>
            <div class="space-y-3">
              <select class="input" id="sd-plan" aria-label="Package">
                ${allPlans().map((p) => `<option value="${p.id}" ${state.planId === p.id ? 'selected' : ''}>${escapeHtml(p.name)} — ${escapeHtml(populationLabel(p))}</option>`).join('')}
              </select>
              <div class="space-y-2">
                ${enabledBilling(getCatalogue()).map(([v, label]) => `<label class="flex items-center gap-2 text-sm"><input type="radio" name="sd-billing" value="${v}" ${state.billing === v ? 'checked' : ''} /> ${escapeHtml(label)} — ${escapeHtml(priceText(previewPlan, v))}</label>`).join('')}
              </div>
              <p class="text-xs text-ink-500">Prices come from the Package &amp; Feature Control Centre. Change them there.</p>
              <button class="btn-secondary btn-sm" id="sd-save-plan" ${state.planId === school.plan?.planId && state.billing === school.plan?.billing ? 'disabled' : ''}>Save package</button>
            </div>
            <div style="border-top:1px solid var(--ink-100);margin-top:1rem;padding-top:1rem;" class="space-y-2">
              <p class="text-sm"><strong>Subscription:</strong> <span class="badge ${subStatus === 'active' ? 'badge-good' : subStatus === 'none' ? 'badge-muted' : subStatus === 'suspended' || subStatus === 'expired' ? 'badge-bad' : 'badge-gold'}">${escapeHtml(SUB_LABEL[subStatus] ?? subStatus)}</span></p>
              ${sub?.startDate ? `<p class="text-xs text-ink-500">${escapeHtml(sub.startDate)} → ${escapeHtml(sub.expiryDate ?? '—')} · ${escapeHtml(packageById(sub.packageId)?.name ?? '')}${state.subRow ? ` · ${fmt(state.subRow.activeStudents)} active students` : ''}</p>` : ''}
              <div class="flex flex-wrap gap-2">
                ${subStatus === 'active' || subStatus === 'trial' ? `<button class="btn-secondary btn-sm" id="sub-apply">Apply the package above</button><button class="btn-secondary btn-sm" id="sub-suspend" style="color:var(--bad);">Suspend subscription</button>` : ''}
                ${subStatus === 'suspended' ? `<button class="btn-primary btn-sm" id="sub-resume">Resume subscription</button>` : ''}
                ${['none', 'requested', 'expired'].includes(subStatus) ? `<button class="btn-primary btn-sm" id="sub-activate">Activate subscription</button>` : ''}
              </div>
              <p class="text-xs text-ink-500">Activate only after the invoice payment is confirmed. It starts today, sets the expiry from the billing frequency and switches on the package's modules. Suspending locks the package's optional modules; essential school records stay available and nothing is deleted.</p>
            </div>
          </div>
        </details>

        <div class="card card-p">
          <div class="flex justify-between items-center mb-3 no-print">
            <h3 class="text-sm text-ink-700" style="font-weight:600;">Invoices</h3>
            <button class="btn-primary btn-sm" id="new-invoice-btn">+ Create package invoice</button>
          </div>
          ${state.invoiceFormOpen ? invoiceFormHtml() : ''}
          ${
            invoices.length === 0
              ? `<p class="text-sm text-ink-400">No invoices yet.</p>`
              : `<div class="overflow-x-auto"><table class="data-table">
                  <thead><tr><th>Invoice</th><th>Issued</th><th class="text-right">Total</th><th class="text-right">Paid</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    ${invoices
                      .map(
                        (i) => `<tr>
                          <td style="font-weight:500;">${escapeHtml(i.number)}</td>
                          <td class="text-ink-600">${escapeHtml(i.issueDate)}</td>
                          <td class="text-right">${CURRENCY} ${fmt(i.total)}</td>
                          <td class="text-right">${CURRENCY} ${fmt(i.paid)}</td>
                          <td>${statusBadge(i.status)}</td>
                          <td class="text-right"><button class="btn-secondary btn-sm" data-open-invoice="${i.id}">Open / record payment</button></td>
                        </tr>`
                      )
                      .join('')}
                  </tbody>
                </table></div>`
          }
        </div>

        <div class="card card-p">
          <h3 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Activity</h3>
          <ul style="list-style:none;margin:0;padding:0;" class="space-y-2">
            ${[...school.history]
              .reverse()
              .map((h) => `<li class="text-sm flex justify-between gap-3"><span>${escapeHtml(h.action)}</span><span class="text-xs text-ink-400" style="white-space:nowrap;">${escapeHtml(h.at.slice(0, 10))} · ${escapeHtml(h.by)}</span></li>`)
              .join('')}
          </ul>
        </div>
      </div>`;

    wire(school, pay);
  }

  function invoiceFormHtml() {
    return `
      <div class="space-y-3 no-print" style="border:1px solid var(--ink-100); border-radius:0.75rem; padding:1rem; margin-bottom:1rem;">
        <p class="text-sm" style="font-weight:600;">New package invoice</p>
        <div class="space-y-2">
          ${state.items
            .map(
              (i) => `<div class="flex gap-2">
                <input class="input flex-1" data-item-desc="${i.tempId}" value="${escapeHtml(i.description)}" placeholder="Description" aria-label="Line description" />
                <input class="input" style="width:8rem;" type="number" data-item-amount="${i.tempId}" value="${escapeHtml(i.amount)}" placeholder="Amount" aria-label="Line amount" />
                ${state.items.length > 1 ? `<button class="btn-ghost" data-remove-item="${i.tempId}" aria-label="Remove line">✕</button>` : ''}
              </div>`
            )
            .join('')}
          <div class="flex flex-wrap gap-2">
            <button class="btn-secondary btn-sm" id="add-line-btn">+ Add line</button>
            <select class="input" id="add-addon" style="max-width:14rem;"><option value="">+ Add-on pack…</option>${getCatalogue().addons.filter((a) => a.active).map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}</select>
            <select class="input" id="add-charge" style="max-width:16rem;"><option value="">+ Separate charge (setup, training…)</option>${getCatalogue().charges.filter((c) => c.kind === 'one-time').map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${c.amount == null ? ' (set amount)' : ` — ${fmt(c.amount)}`}</option>`).join('')}</select>
          </div>
        </div>
        <div class="grid sm-grid-2 gap-4">
          <div>
            <label class="label" for="inv-due">Due date</label>
            <input type="date" class="input" id="inv-due" value="${escapeHtml(state.dueDate)}" />
          </div>
          <div>
            <label class="label" for="inv-note">Note (optional)</label>
            <input class="input" id="inv-note" value="${escapeHtml(state.note)}" />
          </div>
        </div>
        ${state.invoiceErrors.length ? `<ul class="field-error" id="inv-errors" style="margin:0;padding-left:1.1rem;">${state.invoiceErrors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>` : ''}
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-invoice-btn">Cancel</button>
          <button class="btn-primary" id="save-invoice-btn">Create invoice</button>
        </div>
      </div>`;
  }

  function wire(school, pay) {
    const runAction = async (action) => {
      try {
        await action();
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await draw();
    };
    qs(body, '#sd-back').addEventListener('click', () => go({ schoolId: null }));
    qs(body, '#delete-school-btn').addEventListener('click', async () => {
      if (!deleteEnabled) return;
      const confirmed = confirm(
        `Permanently delete ${school.schoolName}?\n\nThis removes the school's registration, records, memberships, invoices, and subscription data. This cannot be undone.`
      );
      if (!confirmed) return;
      try {
        await platformService.deleteSchool(school.id, admin.name);
        go({ schoolId: null });
      } catch (error) {
        state.error = error.message;
        await draw();
      }
    });

    qs(body, '#sd-change-apply')?.addEventListener('click', () => {
      const r = automation.changePackage(school.id, qs(body, '#sd-change-pkg').value, admin.name);
      state.error = r.ok ? '' : r.error; state.flash = r.ok ? `${r.packageName}: ${r.notes.join(' ')}` : ''; state.subRow = null;
      draw();
    });
    qs(body, '#approve-auto-btn')?.addEventListener('click', () => {
      const r = automation.approveAndAllocate(school.id, admin.name);
      state.error = r.ok ? '' : r.error; state.flash = r.ok ? describeApproval(r) : '';
      draw();
    });
    const approve = qs(body, '#approve-btn');
    if (approve) {
      approve.addEventListener('click', () => {
        if (!confirm('Approve without allocating a package or issuing an invoice? Use this only when you will arrange the package and billing yourself.')) return;
        runAction(() => platformService.setSchoolStatus(school.id, 'approved', 'Approved without automatic package or invoice', admin.name));
      });
    }
    const reject = qs(body, '#reject-btn');
    if (reject) {
      reject.addEventListener('click', () => {
        const reason = prompt('Reason for rejecting (the school will see this):');
        if (reason === null) return;
        runAction(() => platformService.setSchoolStatus(school.id, 'rejected', reason, admin.name));
      });
    }
    const suspend = qs(body, '#suspend-btn');
    if (suspend) {
      suspend.addEventListener('click', () => {
        const reason = prompt('Reason for suspending (the school will see this):');
        if (reason === null) return;
        runAction(() => platformService.setSchoolStatus(school.id, 'suspended', reason, admin.name));
      });
    }
    const reactivate = qs(body, '#reactivate-btn');
    if (reactivate) {
      reactivate.addEventListener('click', () => {
        runAction(() => platformService.setSchoolStatus(school.id, 'approved', 'Reactivated', admin.name));
      });
    }

    qs(body, '#sd-plan').addEventListener('change', (e) => {
      state.planId = e.target.value;
      draw();
    });
    on(body, '[name="sd-billing"]', 'change', (e) => {
      state.billing = e.target.value;
      draw();
    });
    qs(body, '#sd-save-plan').addEventListener('click', () => runAction(async () => {
      await platformService.changeSchoolPlan(school.id, state.planId, state.billing, admin.name);
      state.planId = '';
    }));

    // Subscription controls. Every one needs a reason and a confirmation, and is audited.
    const subAction = (patchFor, verb) => async () => {
      const reason = prompt(`Reason for this change (kept in the audit log):`);
      if (!reason?.trim()) return;
      const patch = patchFor();
      if (!confirm(`${verb} for ${school.schoolName}?\n\nReason: ${reason}`)) return;
      runAction(() => subs.adminSetSubscription(school.id, patch, reason));
    };
    const chosen = () => ({ packageId: school.plan?.planId, billing: school.plan?.billing ?? 'annual' });
    const startNow = () => { const start = new Date().toISOString().slice(0, 10); return { ...chosen(), status: 'active', startDate: start, expiryDate: expiryFor(start, chosen().billing), trialUntil: null }; };
    qs(body, '#sub-activate')?.addEventListener('click', () => {
      if (!getPlan(school.plan?.planId)) { state.error = 'Choose and save a package for this school first.'; draw(); return; }
      subAction(startNow, 'Activate the subscription')();
    });
    qs(body, '#sub-apply')?.addEventListener('click', () => {
      if (!getPlan(school.plan?.planId)) { state.error = 'Choose and save a package for this school first.'; draw(); return; }
      subAction(() => ({ ...chosen(), status: 'active' }), 'Apply the saved package')();
    });
    qs(body, '#sub-suspend')?.addEventListener('click', subAction(() => ({ status: 'suspended' }), 'Suspend the subscription'));
    qs(body, '#sub-resume')?.addEventListener('click', subAction(() => ({ status: 'active' }), 'Resume the subscription'));

    qs(body, '#new-invoice-btn').addEventListener('click', () => {
      state.items = platformService.defaultInvoiceItems(school).map((i) => ({ tempId: uuid(), description: i.description, amount: String(i.amount) }));
      state.invoiceErrors = [];
      state.invoiceFormOpen = true;
      draw();
    });
    if (state.invoiceFormOpen) {
      on(body, '[data-item-desc]', 'input', (e) => {
        state.items.find((i) => i.tempId === e.target.getAttribute('data-item-desc')).description = e.target.value;
      });
      on(body, '[data-item-amount]', 'input', (e) => {
        state.items.find((i) => i.tempId === e.target.getAttribute('data-item-amount')).amount = e.target.value;
      });
      on(body, '[data-remove-item]', 'click', (e) => {
        state.items = state.items.filter((i) => i.tempId !== e.currentTarget.getAttribute('data-remove-item'));
        draw();
      });
      qs(body, '#add-addon').addEventListener('change', (e) => {
        const a = getCatalogue().addons.find((x) => x.id === e.target.value); if (!a) return;
        const price = priceFor(a.prices, school.plan?.billing ?? 'annual');
        state.items.push({ tempId: uuid(), description: price == null ? `${a.name} (price to be confirmed)` : a.name, amount: String(price ?? 0) });
        draw();
      });
      qs(body, '#add-charge').addEventListener('change', (e) => {
        const c = getCatalogue().charges.find((x) => x.id === e.target.value); if (!c) return;
        state.items.push({ tempId: uuid(), description: c.amount == null ? `${c.name} (one-time, set amount)` : `${c.name} (one-time)`, amount: String(c.amount ?? 0) });
        draw();
      });
      qs(body, '#add-line-btn').addEventListener('click', () => {
        state.items.push({ tempId: uuid(), description: '', amount: '' });
        draw();
      });
      qs(body, '#inv-due').addEventListener('input', (e) => (state.dueDate = e.target.value));
      qs(body, '#inv-note').addEventListener('input', (e) => (state.note = e.target.value));
      qs(body, '#cancel-invoice-btn').addEventListener('click', () => {
        state.invoiceFormOpen = false;
        draw();
      });
      qs(body, '#save-invoice-btn').addEventListener('click', async () => {
        const { errors, items } = platformService.validateInvoice(state.items, state.dueDate);
        if (errors.length > 0) {
          state.invoiceErrors = errors;
          draw();
          return;
        }
        try {
          const invoice = await platformService.createInvoice(school.id, { items, dueDate: state.dueDate, note: state.note }, admin.name);
          state.invoiceFormOpen = false;
          state.note = '';
          go({ schoolId: school.id, invoiceId: invoice.id });
        } catch (error) {
          state.invoiceErrors = [error.message];
          await draw();
        }
      });
    }
    on(body, '[data-open-invoice]', 'click', (e) => go({ schoolId: school.id, invoiceId: e.currentTarget.getAttribute('data-open-invoice') }));
  }

  draw();
}
