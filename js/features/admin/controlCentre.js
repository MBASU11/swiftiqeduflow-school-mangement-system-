// Package & Feature Control Centre (Super Admin only).
// Schools & capacity · Packages & prices · Payments to verify · Audit log.
// Nothing here edits source code: packages, prices, limits, modules and features are data.
import { escapeHtml, on, qs } from '../../components/dom.js';
import { MODULES, FEATURES } from '../../config/features.js';
import {
  getCatalogue, loadCatalogue, packageById, BILLING, BILLING_LABEL, money, buildDefaultCatalogue, suggestPackage, expiryFor, applyPackageBasics, enabledBilling,
} from '../../services/packageService.js';
import { CAPACITY_LEVELS } from '../../services/capacityService.js';
import * as subs from '../../services/subscriptionService.js';

const TABS = [['schools', 'Schools & capacity'], ['packages', 'Full package editor'], ['payments', 'Payments to verify'], ['audit', 'Audit log']];
const LEVEL_BADGE = { ok: 'badge-good', warning: 'badge-gold', over_limit: 'badge-gold', full: 'badge-bad' };
const todayISO = () => new Date().toISOString().slice(0, 10);
const num = (v) => (String(v ?? '').trim() === '' ? null : Number(v));
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const err = (e) => `<div class="notice" role="alert"><span>${escapeHtml(e?.message ?? String(e))}</span></div>`;

export async function renderControlCentre(body) {
  const st = { mode: 'simple', tab: 'schools', schoolId: null, flash: '', error: '', rows: null, payments: null, audit: null, draft: null, edits: null };

  async function draw() {
    await loadCatalogue();
    const simple = st.mode === 'simple';
    body.innerHTML = `
      <div class="space-y-4">
        <div><h2 class="text-xl" style="font-weight:600;">${simple ? 'Packages' : 'Packages: advanced settings'}</h2>
          <p class="text-sm text-ink-500 mt-1">${simple ? 'Prices and student limits for each package. Everything else follows the package automatically.' : 'The full editor: modules, features, add-ons, billing options and automation rules. Most of this never needs changing. Disabling a module hides it; its records are never deleted.'}</p></div>
        ${simple ? '' : `<div class="flex flex-wrap gap-2 items-center"><button class="btn-ghost btn-sm" id="cc-simple">← Back to the simple view</button></div>
        <div class="pill-group" style="flex-wrap:wrap;">${TABS.map(([k, l]) => `<button class="pill ${st.tab === k ? 'active' : ''}" data-cc-tab="${k}">${l}</button>`).join('')}</div>`}
        ${st.flash ? `<div class="notice" role="status"><span>${escapeHtml(st.flash)}</span></div>` : ''}
        ${st.error ? err(st.error) : ''}
        <div id="cc-body"></div>
      </div>`;
    qs(body, '#cc-simple')?.addEventListener('click', () => { st.mode = 'simple'; st.flash = ''; st.error = ''; st.draft = null; draw(); });
    on(body, '[data-cc-tab]', 'click', (e) => { st.tab = e.currentTarget.dataset.ccTab; st.schoolId = null; st.flash = ''; st.error = ''; st.draft = null; draw(); });
    const el = qs(body, '#cc-body');
    try {
      if (simple) await simplePanel(el);
      else if (st.tab === 'schools') await (st.schoolId ? schoolPanel(el) : schoolsTable(el));
      else if (st.tab === 'packages') await packagesPanel(el);
      else if (st.tab === 'payments') await paymentsPanel(el);
      else await auditPanel(el);
    } catch (e) { el.innerHTML = err(e); }
  }
  const redraw = (flash = '', error = '') => { st.flash = flash; st.error = error; st.rows = null; st.payments = null; st.audit = null; return draw(); };

  // ------------------------------------------------------------ the simple view: only what changes, everything else automatic
  async function simplePanel(el) {
    const cat = getCatalogue(); const billing = enabledBilling(cat);
    const counts = {}; try { (await subs.listSchoolSubscriptions()).forEach((r) => { const id = r.subscription?.packageId; if (id) counts[id] = (counts[id] ?? 0) + 1; }); } catch { /* the counts are a convenience */ }
    const edits = (st.edits ??= {});
    const val = (p, kind, k) => (edits[p.id]?.[kind]?.[k] ?? edits[p.id]?.[kind] ?? (kind === 'prices' ? p.prices?.[k] : p.paidLimit) ?? '');
    const mods = MODULES.filter((m) => !m.pack && !m.essential);
    el.innerHTML = `<div class="space-y-4">
      <div class="notice"><span><strong>This runs by itself.</strong> A school gets the modules and the student limit of its package. Approving a school starts its trial and issues its first invoice. Paying an invoice switches the subscription on, renewal invoices are created before expiry, and a lapsed school drops back to its essential records. You only come here if a price or a student limit changes.</span></div>
      ${cat.packages.filter((p) => p.active !== false).map((p) => `<section class="card card-p space-y-3"><div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-sm" style="font-weight:600;">${escapeHtml(p.name)}</h3><span class="text-xs text-ink-500">${counts[p.id] ?? 0} school${(counts[p.id] ?? 0) === 1 ? '' : 's'} on this package</span></div>
        ${p.custom ? '<p class="text-sm text-ink-600">Priced by quotation for each school. No fixed price or student limit.</p>' : `<div class="grid grid-2 lg-grid-4 gap-3">
          <div><label class="label" for="sp-lim-${p.id}">Student limit</label><input class="input" id="sp-lim-${p.id}" inputmode="numeric" data-sp="${p.id}" data-kind="paidLimit" value="${escapeHtml(val(p, 'paidLimit'))}" /></div>
          ${billing.map(([k, l]) => `<div><label class="label" for="sp-${k}-${p.id}">Price ${escapeHtml(l.toLowerCase())} (${escapeHtml(cat.currency)})</label><input class="input" id="sp-${k}-${p.id}" inputmode="decimal" data-sp="${p.id}" data-kind="prices" data-k="${k}" value="${escapeHtml(val(p, 'prices', k))}" placeholder="quoted" /></div>`).join('')}</div>
          <p class="text-xs text-ink-500">Schools may go ${escapeHtml(String(p.overflow ?? cat.defaultOverflow))} students over the limit before new admissions are blocked.</p>`}
        <p class="text-sm"><strong>Included:</strong> ${mods.filter((m) => p.modules?.[m.key]).map((m) => escapeHtml(m.label)).join(', ') || 'the essentials only'}</p>
        ${mods.some((m) => !p.modules?.[m.key]) ? `<p class="text-sm text-ink-500"><strong>Not included:</strong> ${mods.filter((m) => !p.modules?.[m.key]).map((m) => escapeHtml(m.label)).join(', ')}</p>` : ''}</section>`).join('')}
      <div class="flex flex-wrap gap-2"><button class="btn-primary" id="sp-save">Save prices and limits</button><button class="btn-secondary" id="sp-reset">Reset what each package includes to the recommended sets</button></div>
      <p class="text-xs text-ink-500">Changes apply to every school straight away. A price change is used on the next invoice. Invoices already issued keep their price.</p>
      <p><button class="btn-ghost btn-sm" id="sp-adv">Advanced settings: modules, features, add-ons, automation rules, audit log…</button></p></div>`;
    on(el, '[data-sp]', 'input', (e) => { const t = e.currentTarget; const m = (edits[t.dataset.sp] ??= { prices: {} }); if (t.dataset.kind === 'paidLimit') m.paidLimit = t.value; else m.prices[t.dataset.k] = t.value; });
    qs(el, '#sp-adv').addEventListener('click', () => { st.mode = 'advanced'; st.flash = ''; st.error = ''; draw(); });
    qs(el, '#sp-save').addEventListener('click', async () => {
      const r = applyPackageBasics(cat, Object.fromEntries(Object.entries(edits).map(([id, e]) => [id, { paidLimit: e.paidLimit ?? cat.packages.find((p) => p.id === id).paidLimit, prices: e.prices ?? {} }])));
      if (!r.ok) { st.error = r.errors.join(' '); st.flash = ''; return draw(); }
      if (!Object.keys(edits).length) { st.flash = 'Nothing has changed.'; st.error = ''; return draw(); }
      if (!confirm('Save these prices and student limits? They apply to every school straight away.')) return;
      try { await subs.saveCatalogue(r.catalogue, 'Updated package prices and student limits'); st.edits = null; await redraw('Saved.'); } catch (e) { st.error = e.message; draw(); }
    });
    qs(el, '#sp-reset').addEventListener('click', async () => {
      if (!confirm('Reset what every package includes (modules and features) to the recommended sets? Prices and student limits are not touched.')) return;
      const next = JSON.parse(JSON.stringify(cat)); const rec = buildDefaultCatalogue().packages;
      next.packages.forEach((p, i) => { if (rec[i]) { p.modules = { ...rec[i].modules }; p.features = { ...rec[i].features }; } });
      try { await subs.saveCatalogue(next, 'Reset package contents to recommended'); await redraw('Every package now includes the recommended modules and features.'); } catch (e) { st.error = e.message; draw(); }
    });
  }

  // ------------------------------------------------------------ schools & capacity
  async function schoolsTable(el) {
    const cat = getCatalogue();
    st.rows ??= (await subs.listSchoolSubscriptions()).map((r) => subs.summariseSchool(r, cat));
    el.innerHTML = `
      <div class="card overflow-x-auto"><table class="data-table">
        <thead><tr><th>School</th><th>Package</th><th>Active</th><th>Paid limit</th><th>Overflow</th><th>Maximum</th><th>Remaining paid</th><th>Over paid</th><th>Overflow left</th><th>Capacity</th><th>Subscription</th><th>Expiry / renewal</th><th></th></tr></thead>
        <tbody>${st.rows.map((r) => {
          const c = r.capacity; const pkg = packageById(r.subscription?.packageId, cat);
          return `<tr>
            <td><strong>${escapeHtml(r.schoolName)}</strong><div class="text-xs text-ink-400">${escapeHtml(String(r.schoolId).slice(0, 8))}</div></td>
            <td>${escapeHtml(pkg?.name ?? (r.subscription ? '—' : 'Legacy (no package)'))}</td>
            <td>${fmt(c.active)}</td><td>${c.unlimited ? '∞' : fmt(c.paidLimit)}</td><td>${c.unlimited ? '—' : fmt(c.overflow)}</td><td>${c.unlimited ? '∞' : fmt(c.max)}</td>
            <td>${fmt(c.remainingPaid)}</td><td>${c.unlimited ? '—' : fmt(c.overPaid)}</td><td>${fmt(c.remainingOverflow)}</td>
            <td><span class="badge ${LEVEL_BADGE[c.level]}">${escapeHtml(CAPACITY_LEVELS[c.level])}</span></td>
            <td>${escapeHtml(r.subscriptionStatus)}${r.pendingPayments ? ` <span class="badge badge-gold">${r.pendingPayments} to verify</span>` : ''}</td>
            <td>${escapeHtml(r.renewal.label)}</td>
            <td><button class="btn btn-secondary btn-sm" data-manage="${escapeHtml(r.schoolId)}">Manage</button></td></tr>`;
        }).join('') || '<tr><td colspan="13" class="text-sm text-ink-500">No schools yet.</td></tr>'}</tbody></table></div>`;
    on(el, '[data-manage]', 'click', (e) => { st.schoolId = e.currentTarget.dataset.manage; st.draft = null; draw(); });
  }

  async function schoolPanel(el) {
    const cat = getCatalogue();
    st.rows ??= (await subs.listSchoolSubscriptions()).map((r) => subs.summariseSchool(r, cat));
    const row = st.rows.find((r) => String(r.schoolId) === String(st.schoolId));
    if (!row) { st.schoolId = null; return schoolsTable(el); }
    const sub = row.subscription ?? {};
    const d = (st.draft ??= {
      packageId: sub.packageId ?? suggestPackage(row.declaredStudents ?? row.activeStudents, cat).id,
      billing: sub.billing ?? 'annual', status: sub.status ?? 'active', startDate: sub.startDate ?? todayISO(), expiryDate: sub.expiryDate ?? '',
      trialUntil: sub.trialUntil ?? '', addons: [...(sub.addons ?? [])],
      paidLimit: sub.limits?.paidLimit ?? '', overflow: sub.limits?.overflow ?? '', max: sub.limits?.max ?? '', exceptionUntil: sub.limits?.exceptionUntil ?? '',
      modules: { ...(sub.overrides?.modules ?? {}) }, features: { ...(sub.overrides?.features ?? {}) }, reason: '',
    });
    const c = row.capacity;
    const tri = (kind, key, defaultOn) => {
      const v = d[kind][key];
      return `<select class="input" data-tri="${kind}:${key}" style="max-width:11rem;"><option value="">Package default (${defaultOn ? 'on' : 'off'})</option><option value="on" ${v === true ? 'selected' : ''}>Force on</option><option value="off" ${v === false ? 'selected' : ''}>Force off</option></select>`;
    };
    const pkg = packageById(d.packageId, cat);
    const addonOn = (m) => cat.addons.some((a) => (a.module === m || a.modules?.includes(m)) && d.addons.includes(a.id));
    el.innerHTML = `
      <div class="space-y-4">
        <button class="btn-ghost" id="cc-back">← All schools</button>
        <div class="flex justify-between items-start flex-wrap gap-3"><h3 class="text-lg" style="font-weight:600;">${escapeHtml(row.schoolName)}</h3>
          <span class="badge ${LEVEL_BADGE[c.level]}">${escapeHtml(CAPACITY_LEVELS[c.level])}</span></div>
        ${c.message ? `<div class="notice"><span>${escapeHtml(c.message)}</span></div>` : ''}
        <div class="grid grid-2 lg-grid-4 gap-4">
          ${[['Active students', c.active], ['Paid limit', c.unlimited ? '∞' : c.paidLimit], ['Overflow allowance', c.unlimited ? '—' : c.overflow], ['Maximum permitted', c.unlimited ? '∞' : c.max],
             ['Remaining paid capacity', fmt(c.remainingPaid)], ['Above paid limit', c.unlimited ? '—' : c.overPaid], ['Remaining overflow', fmt(c.remainingOverflow)], ['Exception until', row.limits.exceptionUntil ?? '—']]
            .map(([l, v]) => `<div class="card card-p"><p class="text-sm text-ink-500">${l}</p><p class="stat-num" style="font-size:1.3rem;">${escapeHtml(String(v))}</p></div>`).join('')}
        </div>

        <section class="card card-p space-y-3"><h4 class="text-sm text-ink-700" style="font-weight:600;">Package &amp; subscription</h4>
          <div class="grid grid-2 lg-grid-4 gap-3">
            <div><label class="label">Package</label><select class="input" data-f="packageId">${cat.packages.map((p) => `<option value="${p.id}" ${p.id === d.packageId ? 'selected' : ''}>${escapeHtml(p.name)}${p.active ? '' : ' (inactive)'}</option>`).join('')}</select></div>
            <div><label class="label">Billing</label><select class="input" data-f="billing">${BILLING.map(([k, l]) => `<option value="${k}" ${k === d.billing ? 'selected' : ''}>${l}${cat.billing[k]?.enabled ? '' : ' (off in catalogue)'}</option>`).join('')}</select></div>
            <div><label class="label">Status</label><select class="input" data-f="status">${['active', 'trial', 'requested', 'suspended', 'expired'].map((s) => `<option ${s === d.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
            <div><label class="label">Start date</label><input class="input" type="date" data-f="startDate" value="${escapeHtml(d.startDate)}" /></div>
            <div><label class="label">Expiry date</label><input class="input" type="date" data-f="expiryDate" value="${escapeHtml(d.expiryDate)}" /></div>
            <div><label class="label">Trial until</label><input class="input" type="date" data-f="trialUntil" value="${escapeHtml(d.trialUntil)}" /></div>
          </div>
          <section class="card card-p space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2"><h4 class="text-sm text-ink-700" style="font-weight:600;">Optional pack access</h4><span class="badge badge-muted">${d.addons.length} selected</span></div>
            <p class="text-xs text-ink-500">Tick a pack, enter a reason below, then choose Apply package &amp; pack access. Selected packs become available according to this subscription’s status.</p>
            <div class="grid grid-2 gap-3">${cat.addons.filter((a) => a.active || d.addons.includes(a.id)).map((a) => `<label class="card card-p flex gap-2 items-start text-sm"><input type="checkbox" data-addon="${a.id}" ${d.addons.includes(a.id) ? 'checked' : ''} /> <span><strong>${escapeHtml(a.name)}</strong>${!a.active ? ' <span class="badge badge-muted">retired — remove only</span>' : ''}<span class="block text-xs text-ink-500 mt-1">${escapeHtml(a.description ?? '')}</span><span class="block text-xs text-ink-400 mt-1">Adds ${(a.modules ?? []).map((key) => MODULES.find((m) => m.key === key)?.label).filter(Boolean).join(', ') || 'configured features'}${(a.features ?? []).length ? ` · ${(a.features ?? []).length} features` : ''}</span></span></label>`).join('') || '<p class="text-sm text-ink-500">No optional packs are available. Configure them in Full package editor.</p>'}</div>
          </section>
          <p class="text-sm text-ink-600">Price: ${escapeHtml(pkg?.custom ? 'Custom quotation' : money(cat, pkg?.prices?.[d.billing] ?? 0))} (${BILLING_LABEL[d.billing]}). <button class="btn-ghost btn-sm" id="cc-autoexpiry">Set expiry from start date</button></p>
        </section>

        <section class="card card-p space-y-3"><h4 class="text-sm text-ink-700" style="font-weight:600;">Capacity override</h4>
          <p class="text-xs text-ink-500">Leave blank to use the package values. Maximum permitted = paid limit + overflow, unless you set a custom maximum (optionally until a date).</p>
          <div class="grid grid-2 lg-grid-4 gap-3">
            <div><label class="label">Paid limit</label><input class="input" type="number" min="1" data-f="paidLimit" value="${escapeHtml(d.paidLimit)}" placeholder="${pkg?.paidLimit ?? 'custom'}" /></div>
            <div><label class="label">Overflow allowance</label><input class="input" type="number" min="0" data-f="overflow" value="${escapeHtml(d.overflow)}" placeholder="${pkg?.overflow ?? cat.defaultOverflow}" /></div>
            <div><label class="label">Custom maximum</label><input class="input" type="number" min="1" data-f="max" value="${escapeHtml(d.max)}" /></div>
            <div><label class="label">Exception expires</label><input class="input" type="date" data-f="exceptionUntil" value="${escapeHtml(d.exceptionUntil)}" /></div>
          </div>
        </section>

        <section class="card card-p space-y-3"><h4 class="text-sm text-ink-700" style="font-weight:600;">Module overrides for this school</h4>
          <p class="text-xs text-ink-500">Essential records (Dashboard, Students, Academics, Attendance, Settings) always stay available. Turning a module off hides it; nothing is deleted.</p>
          <div class="grid grid-2 gap-3">${MODULES.map((m) => {
            const def = m.essential || (m.pack ? addonOn(m.key) : Boolean(pkg?.modules?.[m.key]));
            return `<div class="flex justify-between items-center gap-2"><span class="text-sm">${escapeHtml(m.label)}${m.essential ? ' <span class="badge badge-muted">essential</span>' : ''}${m.built === false ? ' <span class="badge badge-muted">screens not built yet</span>' : ''}</span>${m.essential ? '' : tri('modules', m.key, def)}</div>`;
          }).join('')}</div>
          <h4 class="text-sm text-ink-700" style="font-weight:600; margin-top:.75rem;">Feature overrides</h4>
          <div class="grid grid-2 gap-3">${FEATURES.map((f) => {
            const def = Boolean(pkg?.features?.[f.key]) || cat.addons.some((a) => d.addons.includes(a.id) && a.features?.includes(f.key)) || (f.pack && addonOn(f.pack));
            return `<div class="flex justify-between items-center gap-2"><span class="text-sm">${escapeHtml(f.label)} <span class="text-xs text-ink-400">(${escapeHtml(f.module)})</span></span>${tri('features', f.key, def)}</div>`;
          }).join('')}</div>
        </section>

        <section class="card card-p space-y-3"><label class="label">Reason for this change (required — saved in the audit log)</label>
          <input class="input" data-f="reason" value="${escapeHtml(d.reason)}" placeholder="e.g. Approved temporary capacity for new intake" />
          <div class="flex gap-2"><button class="btn-primary" id="cc-save">Apply package &amp; pack access</button><button class="btn-secondary" id="cc-reset">Discard changes</button></div></section>
      </div>`;

    qs(el, '#cc-back').addEventListener('click', () => { st.schoolId = null; st.draft = null; draw(); });
    qs(el, '#cc-reset').addEventListener('click', () => { st.draft = null; draw(); });
    qs(el, '#cc-autoexpiry').addEventListener('click', () => { if (d.startDate) { d.expiryDate = expiryFor(d.startDate, d.billing, cat); draw(); } });
    on(el, '[data-f]', 'change', (e) => { d[e.currentTarget.dataset.f] = e.currentTarget.value; if (['packageId', 'billing'].includes(e.currentTarget.dataset.f)) draw(); });
    on(el, '[data-addon]', 'change', (e) => { const id = e.currentTarget.dataset.addon; d.addons = e.currentTarget.checked ? [...new Set([...d.addons, id])] : d.addons.filter((x) => x !== id); draw(); });
    on(el, '[data-tri]', 'change', (e) => {
      const [kind, key] = e.currentTarget.dataset.tri.split(':'); const v = e.currentTarget.value;
      if (v === '') delete d[kind][key]; else d[kind][key] = v === 'on';
    });
    qs(el, '#cc-save').addEventListener('click', async () => {
      if (!String(d.reason).trim()) { st.error = 'Record a reason for this change.'; return draw(); }
      const limits = {};
      const pl = num(d.paidLimit); const ov = num(d.overflow); const mx = num(d.max);
      if (pl != null) limits.paidLimit = pl; if (ov != null) limits.overflow = ov;
      if (mx != null) { limits.max = mx; if (d.exceptionUntil) limits.exceptionUntil = d.exceptionUntil; }
      const patch = {
        packageId: d.packageId, billing: d.billing, status: d.status, startDate: d.startDate || null, expiryDate: d.expiryDate || null,
        trialUntil: d.trialUntil || null, addons: d.addons, limits, overrides: { modules: d.modules, features: d.features },
      };
      const newMax = mx ?? ((pl ?? pkg?.paidLimit) != null ? (pl ?? pkg.paidLimit) + (ov ?? pkg?.overflow ?? cat.defaultOverflow) : null);
      const lowered = newMax != null && newMax < row.capacity.active;
      const selectedPacks = cat.addons.filter((a) => d.addons.includes(a.id)).map((a) => a.name);
      const summary = `Apply these changes to ${row.schoolName}?\n\nPackage: ${packageById(d.packageId, cat)?.name}, ${BILLING_LABEL[d.billing]}, status ${d.status}\nOptional packs to grant: ${selectedPacks.join(', ') || 'None'}\nMaximum permitted students: ${newMax ?? 'unlimited'}${lowered ? `\n\nNOTE: that is below the ${row.capacity.active} students already active. Existing students are kept, but no new student can be enrolled until the population falls.` : ''}\n\nReason: ${d.reason}`;
      if (!confirm(summary)) return;
      try { await subs.adminSetSubscription(row.schoolId, patch, d.reason); st.draft = null; await redraw('Saved. The change is recorded in the audit log.'); }
      catch (e) { st.error = e.message; draw(); }
    });
  }

  // ------------------------------------------------------------ packages & prices
  async function packagesPanel(el) {
    const cat = (st.draft ??= JSON.parse(JSON.stringify(getCatalogue())));
    const priceIn = (path, v) => `<input class="input" type="number" min="0" data-cat="${path}" value="${v ?? ''}" placeholder="not set" />`;
    const publicChoices = [
      { id: 'micro', label: 'Core package' },
      { id: 'enterprise-plus', label: 'Complete package' },
    ].map(({ id, label }) => ({ pkg: cat.packages.find((p) => p.id === id), label })).filter((x) => x.pkg);
    const packageCoverage = (pkg) => ({
      modules: MODULES.filter((m) => !m.pack && !m.essential && pkg.modules?.[m.key]).length,
      features: FEATURES.filter((f) => pkg.features?.[f.key]).length,
    });
    el.innerHTML = `
      <div class="space-y-4">
        <section class="card card-p space-y-3"><h4 class="text-sm text-ink-700" style="font-weight:600;">Billing &amp; global rules</h4>
          <div class="flex flex-wrap gap-4">${BILLING.map(([k, l]) => `<label class="text-sm"><input type="checkbox" data-cat-bool="billing.${k}.enabled" ${cat.billing[k]?.enabled ? 'checked' : ''} /> ${l} billing available</label>`).join('')}</div>
          <label class="text-sm"><input type="checkbox" data-cat-bool="publicPricingVisible" ${cat.publicPricingVisible ? 'checked' : ''} /> Show configured package and pack prices on the public website</label>
          <div class="grid grid-2 lg-grid-4 gap-3">
            <div><label class="label">Default overflow (students)</label>${priceIn('defaultOverflow', cat.defaultOverflow)}</div>
            <div><label class="label">Warn at % of paid limit</label>${priceIn('capacity.warnPercent', cat.capacity.warnPercent)}</div>
            <div><label class="label">Terms per year</label>${priceIn('termsPerYear', cat.termsPerYear)}</div>
            <div><label class="label">Trial length (days)</label>${priceIn('trialDays', cat.trialDays)}</div>
          </div>
          <div><label class="label">Statuses NOT counted as active (comma separated)</label><input class="input" data-cat-list="capacity.excludeStatuses" value="${escapeHtml(cat.capacity.excludeStatuses.join(', '))}" /></div>
          <div><label class="label">Renewal reminders (days before expiry, comma separated)</label><input class="input" data-cat-numlist="renewalReminderDays" value="${escapeHtml((cat.renewalReminderDays ?? []).join(', '))}" /></div>
        </section>
        <section class="card card-p space-y-3"><h4 class="text-sm text-ink-700" style="font-weight:600;">Automation (what happens without you)</h4>
          <div class="grid grid-2 gap-1">${[['startTrialOnApproval', 'Start a trial when a school is approved'], ['invoiceOnApproval', 'Issue the first invoice when a school is approved'], ['autoRenewalInvoices', 'Create renewal invoices automatically']].map(([k, l]) => `<label class="text-sm"><input type="checkbox" data-cat-bool="automation.${k}" ${cat.automation?.[k] !== false ? 'checked' : ''} /> ${l}</label>`).join('')}</div>
          <div class="grid grid-2 lg-grid-4 gap-3">
            <div><label class="label">First invoice due after (days)</label>${priceIn('automation.invoiceDueDays', cat.automation?.invoiceDueDays)}</div>
            <div><label class="label">Renewal invoice created (days before expiry)</label>${priceIn('automation.renewalWindowDays', cat.automation?.renewalWindowDays)}</div>
            <div><label class="label">Grace after expiry (days of full access)</label>${priceIn('graceDays', cat.graceDays)}</div></div>
          <p class="text-xs text-ink-500">Paying a subscription invoice in full always activates or renews the subscription by itself. When a school's trial ends unpaid, or its grace period runs out, it is restricted to its essential records automatically; nothing is deleted.</p></section>
        <section class="card card-p space-y-3"><h4 class="text-sm text-ink-700" style="font-weight:600;">Public packages: Core vs Complete</h4>
          <p class="text-xs text-ink-500">Make the public choices easy to manage here. Core is the starting package; Complete includes every standard module and package-level feature. Optional packs stay separate and can be activated for an individual school. Use the inclusion matrix below to control exactly what each package grants.</p>
          <div class="grid grid-2 gap-3">${publicChoices.map(({ pkg, label }) => {
            const coverage = packageCoverage(pkg);
            return `<div class="card card-p space-y-2"><strong>${escapeHtml(label)}</strong>
              <p class="text-xs text-ink-500">${coverage.modules} additional modules · ${coverage.features} features enabled</p>
              <label class="text-sm"><input type="checkbox" data-cat-bool="packages.${cat.packages.indexOf(pkg)}.active" ${pkg.active ? 'checked' : ''} /> Available for subscriptions</label>
              <label class="text-sm"><input type="checkbox" data-cat-bool="packages.${cat.packages.indexOf(pkg)}.publicVisible" ${pkg.publicVisible ? 'checked' : ''} /> Show on landing page</label>
              ${!pkg.active ? '<p class="text-xs text-ink-500">Activate this package before listing it publicly.</p>' : ''}
              <div><label class="label">Public package name</label><input class="input" data-cat="packages.${cat.packages.indexOf(pkg)}.publicName" value="${escapeHtml(pkg.publicName ?? label)}" /></div>
              <div><label class="label">Public description</label><textarea class="input" rows="2" data-cat="packages.${cat.packages.indexOf(pkg)}.publicDescription">${escapeHtml(pkg.publicDescription ?? '')}</textarea></div>
            </div>`;
          }).join('')}</div>
        </section>
        <section class="card card-p space-y-3"><div class="flex flex-wrap items-center justify-between gap-2"><h4 class="text-sm text-ink-700" style="font-weight:600;">What each package includes</h4><button class="btn-secondary btn-sm" id="cat-recommended">Reset to recommended</button></div>
          <p class="text-xs text-ink-500">Tick a module to include it in a package. This is exactly what the pricing page shows, so keep it as you want it advertised. Core modules are always included. A single school can still be given an extra module under Schools &amp; capacity → Manage.</p>
          <div class="overflow-x-auto"><table class="data-table"><thead><tr><th>Module</th>${cat.packages.map((p) => `<th style="text-align:center;">${escapeHtml(p.name)}</th>`).join('')}</tr></thead><tbody>${MODULES.filter((m) => !m.pack && !m.essential).map((m) => `<tr><td>${escapeHtml(m.label)}</td>${cat.packages.map((p, i) => `<td style="text-align:center;"><input type="checkbox" aria-label="${escapeHtml(m.label)} in ${escapeHtml(p.name)}" data-cat-bool="packages.${i}.modules.${m.key}" ${p.modules[m.key] ? 'checked' : ''} /></td>`).join('')}</tr>`).join('')}</tbody></table></div></section>
        ${cat.packages.map((p, i) => `
          <section class="card card-p space-y-3"><div class="flex justify-between items-center"><h4 class="text-sm" style="font-weight:600;">${escapeHtml(p.name)}</h4>
            <div class="flex flex-wrap gap-3"><label class="text-sm"><input type="checkbox" data-cat-bool="packages.${i}.active" ${p.active ? 'checked' : ''} /> Available to schools</label>
            <label class="text-sm"><input type="checkbox" data-cat-bool="packages.${i}.publicVisible" ${p.publicVisible ? 'checked' : ''} /> Show on public website</label></div></div>
            <div class="grid grid-2 lg-grid-4 gap-3">
              <div><label class="label">Name</label><input class="input" data-cat="packages.${i}.name" value="${escapeHtml(p.name)}" /></div>
              <div><label class="label">Public name</label><input class="input" data-cat="packages.${i}.publicName" value="${escapeHtml(p.publicName ?? p.name)}" /></div>
              <div class="lg-col-span-2"><label class="label">Public description</label><input class="input" data-cat="packages.${i}.publicDescription" value="${escapeHtml(p.publicDescription ?? '')}" /></div>
              <div><label class="label">Paid student limit</label>${priceIn(`packages.${i}.paidLimit`, p.paidLimit)}</div>
              <div><label class="label">Overflow allowance</label>${priceIn(`packages.${i}.overflow`, p.overflow)}</div>
              <div><label class="label">Maximum (computed)</label><input class="input" disabled value="${p.paidLimit == null ? 'Custom' : p.paidLimit + (p.overflow ?? 0)}" /></div>
              ${BILLING.map(([k, l]) => `<div><label class="label">Price — ${l.toLowerCase()} (${cat.currency})</label>${p.custom ? '<input class="input" disabled value="Custom quotation" />' : priceIn(`packages.${i}.prices.${k}`, p.prices[k])}</div>`).join('')}
              <div><label class="label">User limit</label>${priceIn(`packages.${i}.limits.users`, p.limits?.users)}</div>
              <div><label class="label">Storage (GB)</label>${priceIn(`packages.${i}.limits.storageGb`, p.limits?.storageGb)}</div>
              <div><label class="label">Campuses</label>${priceIn(`packages.${i}.limits.campuses`, p.limits?.campuses)}</div>
            </div>
            <details><summary class="text-sm text-brand-700" style="cursor:pointer;">Included modules &amp; features</summary>
              <div class="grid grid-2 gap-1 mt-3">${MODULES.filter((m) => !m.pack).map((m) => `<label class="text-sm"><input type="checkbox" data-cat-bool="packages.${i}.modules.${m.key}" ${p.modules[m.key] ? 'checked' : ''} ${m.essential ? 'disabled checked' : ''} /> ${escapeHtml(m.label)}</label>`).join('')}</div>
              <div class="grid grid-2 gap-1 mt-3">${FEATURES.map((f) => `<label class="text-sm"><input type="checkbox" data-cat-bool="packages.${i}.features.${f.key}" ${p.features[f.key] ? 'checked' : ''} /> ${escapeHtml(f.label)}</label>`).join('')}</div></details>
          </section>`).join('')}
        <section class="card card-p space-y-3"><h4 class="text-sm text-ink-700" style="font-weight:600;">Add-on packs (price on top of a package)</h4>
            ${cat.addons.map((a, i) => `<div class="card card-p space-y-3"><div class="grid grid-2 lg-grid-4 gap-3 items-end">
              <div><label class="label">Pack name</label><input class="input" data-cat="addons.${i}.name" value="${escapeHtml(a.name)}" /></div>
              <div class="lg-col-span-2"><label class="label">Public description</label><input class="input" data-cat="addons.${i}.description" value="${escapeHtml(a.description ?? '')}" /></div>
              <label class="text-sm"><input type="checkbox" data-cat-bool="addons.${i}.active" ${a.active ? 'checked' : ''} /> Available for selection</label>
              ${BILLING.map(([k, l]) => `<div><label class="label">${l}</label>${priceIn(`addons.${i}.prices.${k}`, a.prices[k])}</div>`).join('')}
            </div><details><summary class="text-sm text-brand-700" style="cursor:pointer;">Included modules and features</summary>
              <div class="grid grid-2 gap-1 mt-3">${MODULES.filter((m) => !m.pack).map((m) => `<label class="text-sm"><input type="checkbox" data-addon-module="${i}:${m.key}" ${a.modules?.includes(m.key) ? 'checked' : ''} /> ${escapeHtml(m.label)}</label>`).join('')}</div>
              <div class="grid grid-2 gap-1 mt-3">${FEATURES.map((f) => `<label class="text-sm"><input type="checkbox" data-addon-feature="${i}:${f.key}" ${a.features?.includes(f.key) ? 'checked' : ''} /> ${escapeHtml(f.label)}</label>`).join('')}</div>
            </details></div>`).join('')}
          <h4 class="text-sm text-ink-700" style="font-weight:600;">Combined-pack discount</h4>
          ${cat.discounts.map((dc, i) => `<div class="grid grid-2 lg-grid-4 gap-3 items-end"><span class="text-sm">${escapeHtml(dc.name)}</span><div><label class="label">Type</label><select class="input" data-cat="discounts.${i}.type"><option value="percent" ${dc.type === 'percent' ? 'selected' : ''}>Percent</option><option value="amount" ${dc.type === 'amount' ? 'selected' : ''}>Fixed amount</option></select></div><div><label class="label">Value</label>${priceIn(`discounts.${i}.value`, dc.value)}</div><label class="text-sm"><input type="checkbox" data-cat-bool="discounts.${i}.active" ${dc.active ? 'checked' : ''} /> Active</label></div>`).join('')}
        </section>
        <section class="card card-p space-y-3"><h4 class="text-sm text-ink-700" style="font-weight:600;">Separate charges (never folded into the subscription)</h4>
          <div class="grid grid-2 lg-grid-4 gap-3">${cat.charges.map((ch, i) => `<div><label class="label">${escapeHtml(ch.name)} ${ch.kind === 'percent' ? '(%)' : ch.unit ? `(per ${ch.unit})` : ''}</label>${priceIn(`charges.${i}.amount`, ch.amount)}</div>`).join('')}</div></section>
        <section class="card card-p space-y-3"><label class="label">Reason for this change (required)</label><input class="input" id="cat-reason" />
          <div class="flex gap-2"><button class="btn-primary" id="cat-save">Save catalogue</button><button class="btn-secondary" id="cat-add">Add package</button><button class="btn-ghost" id="cat-reset">Discard</button></div></section>
      </div>`;
    const setPath = (path, value) => { const keys = path.split('.'); let o = cat; keys.slice(0, -1).forEach((k) => { o[k] ??= {}; o = o[k]; }); o[keys.at(-1)] = value; };
    on(el, '[data-cat]', 'change', (e) => { const t = e.currentTarget; setPath(t.dataset.cat, t.type === 'number' ? num(t.value) : t.value); });
    on(el, '[data-cat-bool]', 'change', (e) => setPath(e.currentTarget.dataset.catBool, e.currentTarget.checked));
    on(el, '[data-addon-module]', 'change', (e) => {
      const [index, key] = e.currentTarget.dataset.addonModule.split(':');
      const addon = cat.addons[Number(index)];
      addon.modules = e.currentTarget.checked ? [...new Set([...addon.modules, key])] : addon.modules.filter((item) => item !== key);
    });
    on(el, '[data-addon-feature]', 'change', (e) => {
      const [index, key] = e.currentTarget.dataset.addonFeature.split(':');
      const addon = cat.addons[Number(index)];
      addon.features = e.currentTarget.checked ? [...new Set([...addon.features, key])] : addon.features.filter((item) => item !== key);
    });
    on(el, '[data-cat-list]', 'change', (e) => setPath(e.currentTarget.dataset.catList, e.currentTarget.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)));
    on(el, '[data-cat-numlist]', 'change', (e) => setPath(e.currentTarget.dataset.catNumlist, e.currentTarget.value.split(',').map((x) => Number(x.trim())).filter((x) => x > 0)));
    qs(el, '#cat-reset').addEventListener('click', () => { st.draft = null; draw(); });
    qs(el, '#cat-recommended').addEventListener('click', () => {
      if (!confirm('Replace every package\'s modules and features with the recommended sets? Prices and limits are not touched. Nothing is saved until you press Save catalogue.')) return;
      const rec = buildDefaultCatalogue().packages;
      cat.packages.forEach((p, i) => { if (rec[i]) { p.modules = { ...rec[i].modules }; p.features = { ...rec[i].features }; } });
      draw();
    });
    qs(el, '#cat-add').addEventListener('click', () => {
      const name = prompt('Name for the new package (e.g. Special School):'); if (!name?.trim()) return;
      const base = buildDefaultCatalogue().packages[0];
      cat.packages.push({ ...base, id: `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`, name: name.trim(), minStudents: 1, paidLimit: null, custom: false, prices: { monthly: null, termly: null, annual: null } });
      draw();
    });
    qs(el, '#cat-save').addEventListener('click', async () => {
      const reason = qs(el, '#cat-reason').value;
      if (!reason.trim()) { st.error = 'Record a reason for this change.'; return draw(); }
      if (!confirm('Save these package, price and entitlement changes? They apply to schools immediately.')) return;
      try { await subs.saveCatalogue(cat, reason); st.draft = null; await redraw('Catalogue saved.'); } catch (e) { st.error = e.message; draw(); }
    });
  }

  // ------------------------------------------------------------ payments
  async function paymentsPanel(el) {
    st.payments ??= await subs.listPayments();
    const cat = getCatalogue();
    const pending = st.payments.filter((p) => p.status === 'awaiting_verification');
    const done = st.payments.filter((p) => p.status !== 'awaiting_verification');
    const q = (p) => (p.quote ? `${p.quote.packageName ?? ''} · ${BILLING_LABEL[p.quote.billing] ?? ''} · expected ${p.quote.needsQuotation ? 'quotation needed' : money(cat, p.quote.total)}` : '');
    el.innerHTML = `
      <div class="space-y-4">
        <div class="notice"><span>A payment reference or screenshot never activates a subscription. Confirm the money has actually arrived (M-Pesa statement, bank statement), then verify.</span></div>
        <section class="card card-p space-y-3"><h4 class="text-sm text-ink-700" style="font-weight:600;">Awaiting verification (${pending.length})</h4>
          ${pending.map((p) => `<div class="flex justify-between items-center flex-wrap gap-3" style="border-bottom:1px solid var(--ink-100); padding-bottom:.6rem;">
            <div><strong>${escapeHtml(p.schoolName)}</strong> — ${escapeHtml(money(cat, p.amount))} by ${escapeHtml(p.method)}<div class="text-xs text-ink-500">Ref <code>${escapeHtml(p.reference)}</code> · ${escapeHtml(String(p.submittedAt).slice(0, 10))} · ${escapeHtml(q(p))}</div></div>
            <div class="flex gap-2 items-center"><input class="input" type="date" data-start="${p.id}" value="${todayISO()}" title="Subscription start date" style="max-width:10rem;" />
              <button class="btn-primary btn-sm" data-verify="${p.id}">Verify &amp; activate</button><button class="btn-secondary btn-sm" data-reject="${p.id}">Reject</button></div></div>`).join('') || '<p class="text-sm text-ink-500">Nothing waiting.</p>'}
        </section>
        <section class="card card-p"><h4 class="text-sm text-ink-700 mb-2" style="font-weight:600;">History</h4>
          <table class="data-table"><thead><tr><th>School</th><th>Amount</th><th>Reference</th><th>Status</th><th>Note</th></tr></thead><tbody>${done.map((p) => `<tr><td>${escapeHtml(p.schoolName)}</td><td>${escapeHtml(money(cat, p.amount))}</td><td>${escapeHtml(p.reference)}</td><td><span class="badge ${p.status === 'verified' ? 'badge-good' : 'badge-bad'}">${escapeHtml(p.status)}</span></td><td>${escapeHtml(p.verifyNote ?? '')}</td></tr>`).join('') || '<tr><td colspan="5" class="text-sm text-ink-500">None yet.</td></tr>'}</tbody></table></section>
      </div>`;
    const act = (approve) => async (e) => {
      const id = e.currentTarget.dataset[approve ? 'verify' : 'reject'];
      const note = prompt(approve ? 'How did you confirm the payment? (e.g. "Seen on M-Pesa statement")' : 'Why is this payment rejected?');
      if (note === null || (!approve && !note.trim())) return;
      try { await subs.verifyPayment(id, { approve, note, startDate: qs(el, `[data-start="${id}"]`).value }); await redraw(approve ? 'Payment verified. The subscription is now active.' : 'Payment rejected.'); }
      catch (error) { st.error = error.message; draw(); }
    };
    on(el, '[data-verify]', 'click', act(true));
    on(el, '[data-reject]', 'click', act(false));
  }

  async function auditPanel(el) {
    st.audit ??= await subs.listAudit();
    el.innerHTML = `<div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>When</th><th>School</th><th>Action</th><th>Reason</th></tr></thead><tbody>${st.audit.map((a) => `<tr><td>${escapeHtml(String(a.at).replace('T', ' ').slice(0, 16))}</td><td>${escapeHtml(a.schoolName ?? a.schoolId?.slice?.(0, 8) ?? 'Platform')}</td><td>${escapeHtml(a.action)}</td><td>${escapeHtml(a.reason ?? '')}</td></tr>`).join('') || '<tr><td colspan="4" class="text-sm text-ink-500">No changes recorded yet.</td></tr>'}</tbody></table></div>`;
  }

  draw();
}
