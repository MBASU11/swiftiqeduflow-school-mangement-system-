// School health (demo mode). Confidential: administrators and the school nurse only. Sick bay, medication, learner records.
import { escapeHtml, on, qs } from '../../components/dom.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { canWriteModule } from '../../services/accessService.js';
import { studentRepo, fullName } from '../../services/studentService.js';
import { classRepo } from '../../services/academicService.js';
import * as S from '../../services/healthService.js';
import { SEVERITY, OUTCOMES, VACCINES, isSevere, profileGaps, overdueImmunisations } from '../../services/healthLogic.js';

const lab = (list, k) => list.find(([x]) => x === k)?.[1] ?? k;
const iso = () => new Date().toISOString().slice(0, 10);
const hhmm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const opts = (list, cur, blank) => `${blank ? `<option value="">${blank}</option>` : ''}${list.map(([k, v]) => `<option value="${escapeHtml(k)}" ${k === cur ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('')}`;

export function renderHealth(container) {
  if (isSupabaseConfigured()) { container.innerHTML = '<div class="notice" role="status"><span>Health records run in demo mode for now. The cloud version needs the backend phase (stricter access rules than any other module).</span></div>'; return; }
  const write = canWriteModule('health');
  const st = { tab: 'today', studentId: '', sub: 'profile', search: '', errors: [], msg: '', visitFor: '', visitForm: null, needs: {}, profile: null, medForm: null, vaxForm: null, showVisit: false, showMed: false, showVax: false, editProfile: false };
  const clear = () => { st.errors = []; st.msg = ''; st.needs = {}; };
  const errs = () => `${st.errors.map((e) => `<p class="field-error" role="alert">${escapeHtml(e)}</p>`).join('')}${st.msg ? `<div class="notice" role="status"><span>${escapeHtml(st.msg)}</span></div>` : ''}`;
  const learners = () => studentRepo.getAll().filter((s) => (s.status ?? 'active') === 'active').sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const nameOf = (id) => { const s = studentRepo.getById(id); return s ? fullName(s) : 'Unknown learner'; };
  const clsOf = (s) => classRepo.getById(s?.classId)?.name ?? '';

  function draw() {
    container.innerHTML = `<div class="space-y-4"><div><h1 class="text-2xl" style="font-weight:600;">Health</h1><p class="text-xs text-ink-500">Confidential. Only administrators and the school nurse can see these records, and every time a learner's record is opened it is logged.</p></div>
      <div class="pill-group">${[['today', 'Today'], ['learners', 'Learners']].map(([k, v]) => `<button class="pill ${st.tab === k ? 'active' : ''}" data-tab="${k}">${v}</button>`).join('')}</div>
      <div>${st.tab === 'today' ? today() : st.studentId ? detail() : picker()}</div></div>`;
    on(container, '[data-tab]', 'click', (e) => { clear(); st.tab = e.currentTarget.dataset.tab; st.studentId = ''; st.showVisit = false; draw(); });
    wire();
  }

  // ---------- today ----------
  function today() {
    const o = S.overview(); const doses = S.dosesToday().filter((d) => d.status !== 'upcoming' || true); const recent = S.recentVisits(7).slice(0, 8);
    const tag = (d) => ({ given: '✓ given', missed: '✗ missed', overdue: 'OVERDUE', due: 'due now', upcoming: 'later' }[d.status]);
    return `<div class="space-y-4">${errs()}
      ${o.severe.length ? `<section class="card card-p" style="border:1px solid var(--bad,#b3261e);"><h2 class="text-sm" style="font-weight:600;color:var(--bad,#b3261e);">Severe allergies (${o.severe.length})</h2>${o.severe.map((x) => `<p class="text-sm" style="padding:.2rem 0;"><button class="btn-ghost btn-sm" data-open="${x.studentId}">${escapeHtml(nameOf(x.studentId))}</button> ${x.allergies.map((a) => escapeHtml(a.substance)).join(', ')}</p>`).join('')}</section>` : ''}
      <section class="card card-p space-y-1"><h2 class="text-sm" style="font-weight:600;">Needs attention</h2>
        ${o.overdueDoses.length ? `<p class="text-sm" style="color:var(--bad,#b3261e);">🔴 ${o.overdueDoses.length} medication dose${o.overdueDoses.length === 1 ? ' is' : 's are'} overdue.</p>` : ''}
        ${o.frequent.length ? `<p class="text-sm">🟡 Frequent visitors this month: ${o.frequent.map((f) => `${escapeHtml(nameOf(f.studentId))} (${f.count})`).join(', ')}</p>` : ''}
        ${o.gaps ? `<p class="text-sm">🟡 ${o.gaps} of ${o.learners} learners have an incomplete health record.</p>` : ''}${o.overdueVaccines ? `<p class="text-sm">🟡 ${o.overdueVaccines} learner${o.overdueVaccines === 1 ? ' has' : 's have'} an overdue immunisation.</p>` : ''}
        ${!o.overdueDoses.length && !o.frequent.length && !o.gaps && !o.overdueVaccines ? '<p class="text-sm" style="color:var(--good,#2e7d4f);">Nothing needs attention.</p>' : ''}</section>
      <section class="card card-p"><h2 class="text-sm mb-2" style="font-weight:600;">Medication due today</h2>${doses.length ? doses.map((d) => `<div class="flex flex-wrap items-center justify-between gap-2 text-sm" style="border-top:1px solid var(--ink-100);padding:.4rem 0;"><span><b>${escapeHtml(d.time)}</b> ${escapeHtml(nameOf(d.medication.studentId))}: ${escapeHtml(d.medication.name)} ${escapeHtml(d.medication.dose)}${d.medication.instructions ? `<br/><span class="text-xs text-ink-500">${escapeHtml(d.medication.instructions)}</span>` : ''}</span><span style="${d.status === 'overdue' ? 'color:var(--bad,#b3261e);font-weight:600;' : ''}">${tag(d)}${write && !d.record ? ` <button class="btn-primary btn-sm" data-give="${d.medication.id}" data-time="${d.time}">Given</button> <button class="btn-secondary btn-sm" data-miss="${d.medication.id}" data-time="${d.time}">Missed</button>` : ''}</span></div>`).join('') : '<p class="text-sm text-ink-500">No standing medication scheduled today.</p>'}</section>
      <section class="card card-p space-y-2"><div class="flex justify-between items-center"><h2 class="text-sm" style="font-weight:600;">Sick bay, last 7 days</h2>${write ? '<button class="btn-primary btn-sm" id="new-visit">+ Record a visit</button>' : ''}</div>
        ${st.showVisit && !st.studentId ? `<label class="label">Learner</label><select class="input" id="v-who"><option value="">Choose…</option>${learners().map((s) => `<option value="${s.id}" ${s.id === st.visitFor ? 'selected' : ''}>${escapeHtml(fullName(s))} (${escapeHtml(clsOf(s))})</option>`).join('')}</select>${st.visitFor ? visitForm(st.visitFor) : ''}` : ''}
        ${recent.length ? recent.map((v) => `<p class="text-sm" style="border-top:1px solid var(--ink-100);padding:.4rem 0;"><b>${escapeHtml(v.date)} ${escapeHtml(v.time)}</b> ${escapeHtml(nameOf(v.studentId))}: ${escapeHtml(v.complaint)} → ${escapeHtml(lab(OUTCOMES, v.outcome))}</p>`).join('') : '<p class="text-sm text-ink-500">No visits this week.</p>'}</section></div>`;
  }

  function visitForm(studentId) {
    const f = st.visitForm ?? { date: iso(), time: hhmm(), outcome: 'returned' };
    const profile = S.getProfile(studentId); const alert = (profile?.allergies ?? []).filter(isSevere);
    return `<div class="space-y-2" style="border-top:1px solid var(--ink-100);padding-top:.5rem;">${alert.length ? `<p class="text-sm" style="color:var(--bad,#b3261e);font-weight:600;">⚠ Severe allergy: ${alert.map((a) => escapeHtml(a.substance)).join(', ')}</p>` : ''}${errs()}
      <div class="grid grid-2 gap-2"><input class="input" type="date" id="v-date" max="${iso()}" value="${escapeHtml(f.date)}"/><input class="input" type="time" id="v-time" value="${escapeHtml(f.time ?? '')}"/></div>
      <input class="input" id="v-complaint" placeholder="Complaint (e.g. headache, fever, cut knee)" value="${escapeHtml(f.complaint ?? '')}"/>
      <div class="grid grid-2 gap-2"><input class="input" id="v-temp" inputmode="decimal" placeholder="Temperature °C" value="${escapeHtml(f.temperature ?? '')}"/><input class="input" id="v-pulse" inputmode="numeric" placeholder="Pulse" value="${escapeHtml(f.pulse ?? '')}"/></div>
      <textarea class="input" id="v-obs" rows="2" placeholder="Observations">${escapeHtml(f.observations ?? '')}</textarea><input class="input" id="v-action" placeholder="Action taken" value="${escapeHtml(f.action ?? '')}"/>
      <div class="grid grid-2 gap-2"><input class="input" id="v-med" placeholder="Medicine given (if any)" value="${escapeHtml(f.medication ?? '')}"/><input class="input" id="v-dose" placeholder="Dose" value="${escapeHtml(f.dose ?? '')}"/></div>
      <select class="input" id="v-outcome">${opts(OUTCOMES, f.outcome)}</select><label class="text-sm"><input type="checkbox" id="v-parent" ${f.parentNotified ? 'checked' : ''}/> Parent or guardian has been told</label>
      ${st.needs.consent ? '<label class="text-sm" style="color:var(--bad,#b3261e);"><input type="checkbox" id="v-override"/> A parent has agreed to this medicine by phone</label>' : ''}${st.needs.allergy ? '<label class="text-sm" style="color:var(--bad,#b3261e);"><input type="checkbox" id="v-allergy"/> A doctor or the parent has confirmed this medicine is safe</label>' : ''}
      <div class="flex gap-2"><button class="btn-primary btn-sm" id="v-save" data-for="${studentId}">Save visit</button><button class="btn-secondary btn-sm" id="v-cancel">Cancel</button></div></div>`;
  }
  const readVisit = () => ({ date: qs(container, '#v-date').value, time: qs(container, '#v-time').value, complaint: qs(container, '#v-complaint').value, temperature: qs(container, '#v-temp').value.trim(), pulse: qs(container, '#v-pulse').value.trim(), observations: qs(container, '#v-obs').value, action: qs(container, '#v-action').value, medication: qs(container, '#v-med').value, dose: qs(container, '#v-dose').value, outcome: qs(container, '#v-outcome').value, parentNotified: qs(container, '#v-parent').checked });

  // ---------- learners ----------
  function picker() {
    const q = st.search.trim().toLowerCase(); const list = learners().filter((s) => !q || fullName(s).toLowerCase().includes(q) || String(s.admissionNumber ?? '').toLowerCase().includes(q)).slice(0, 30);
    const severe = new Set(S.profileRepo.getAll().filter((p) => (p.allergies ?? []).some(isSevere)).map((p) => p.studentId));
    return `<div class="space-y-2"><input class="input" id="search" placeholder="Search by name or admission number" value="${escapeHtml(st.search)}"/>${list.map((s) => `<button class="card card-p" data-open="${s.id}" style="width:100%;text-align:left;cursor:pointer;"><b class="text-sm">${escapeHtml(fullName(s))}</b> <span class="text-xs text-ink-500">${escapeHtml(clsOf(s))}${s.admissionNumber ? ` · ${escapeHtml(s.admissionNumber)}` : ''}</span>${severe.has(s.id) ? ' <span style="color:var(--bad,#b3261e);">⚠ severe allergy</span>' : ''}</button>`).join('') || '<p class="text-sm text-ink-500">No learners match.</p>'}</div>`;
  }
  function detail() {
    const s = studentRepo.getById(st.studentId); if (!s) { st.studentId = ''; return picker(); }
    const p = S.getProfile(s.id); const gaps = profileGaps(p); const severe = (p?.allergies ?? []).filter(isSevere);
    return `<button class="btn-ghost btn-sm" id="back">← All learners</button><h2 class="text-lg mt-1" style="font-weight:600;">${escapeHtml(fullName(s))} <span class="text-sm text-ink-500">${escapeHtml(clsOf(s))}</span></h2>
      ${severe.length ? `<div class="notice" role="alert" style="border-color:var(--bad,#b3261e);"><span>⚠ <b>Severe allergy:</b> ${severe.map((a) => `${escapeHtml(a.substance)}${a.reaction ? ` (${escapeHtml(a.reaction)})` : ''}`).join(', ')}</span></div>` : ''}
      ${gaps.length ? `<p class="text-xs text-ink-500">To complete: ${gaps.map(escapeHtml).join(' · ')}</p>` : ''}
      <div class="pill-group mt-2">${[['profile', 'Profile'], ['visits', 'Visits'], ['meds', 'Medication'], ['vax', 'Immunisation']].map(([k, v]) => `<button class="pill ${st.sub === k ? 'active' : ''}" data-sub="${k}">${v}</button>`).join('')}</div>
      <div class="mt-2">${st.sub === 'profile' ? profileTab(s, p) : st.sub === 'visits' ? visitsTab(s) : st.sub === 'meds' ? medsTab(s) : vaxTab(s)}</div>`;
  }
  function profileTab(s, p) {
    if (st.editProfile) {
      const d = st.profile ?? { allergyStatus: p?.allergyStatus ?? 'unknown', allergies: p?.allergies?.map((a) => ({ ...a })) ?? [], conditions: p?.conditions ?? [], bloodGroup: p?.bloodGroup ?? '', emergencyName: p?.emergencyName ?? '', emergencyPhone: p?.emergencyPhone ?? '', doctor: p?.doctor ?? '', consentFirstAid: p?.consentFirstAid ?? false, notes: p?.notes ?? '' };
      st.profile = d;
      return `<section class="card card-p space-y-2">${errs()}<label class="label">Allergies</label><select class="input" id="p-astat">${opts([['unknown', 'Not recorded yet'], ['none', 'No known allergies'], ['listed', 'Has allergies (list below)']], d.allergyStatus)}</select>
        ${d.allergyStatus === 'listed' ? `${d.allergies.map((a, i) => `<div class="grid grid-2 gap-2" style="border-top:1px solid var(--ink-100);padding-top:.4rem;"><input class="input" data-a-sub="${i}" placeholder="Allergic to" value="${escapeHtml(a.substance ?? '')}"/><select class="input" data-a-sev="${i}">${opts(SEVERITY, a.severity, 'Severity…')}</select><input class="input" data-a-rea="${i}" placeholder="Reaction (e.g. swelling, rash)" value="${escapeHtml(a.reaction ?? '')}"/><button class="btn-ghost btn-sm" data-a-del="${i}">Remove</button></div>`).join('')}<button class="btn-secondary btn-sm" id="a-add">+ Add an allergy</button>` : ''}
        <label class="label">Conditions (one per line, e.g. asthma, epilepsy, sickle cell)</label><textarea class="input" id="p-cond" rows="3">${escapeHtml(d.conditions.join('\n'))}</textarea>
        <div class="grid grid-2 gap-2"><div><label class="label">Emergency contact</label><input class="input" id="p-en" value="${escapeHtml(d.emergencyName)}"/></div><div><label class="label">Emergency phone</label><input class="input" id="p-ep" inputmode="tel" value="${escapeHtml(d.emergencyPhone)}"/></div><div><label class="label">Doctor or clinic</label><input class="input" id="p-doc" value="${escapeHtml(d.doctor)}"/></div><div><label class="label">Blood group (optional)</label><select class="input" id="p-bg">${opts(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((x) => [x, x]), d.bloodGroup, 'Not known')}</select></div></div>
        <label class="text-sm"><input type="checkbox" id="p-consent" ${d.consentFirstAid ? 'checked' : ''}/> A parent has consented to first aid and basic medication</label><textarea class="input" id="p-notes" rows="2" placeholder="Other notes">${escapeHtml(d.notes)}</textarea>
        <div class="flex gap-2"><button class="btn-primary btn-sm" id="p-save">Save</button><button class="btn-secondary btn-sm" id="p-cancel">Cancel</button></div></section>`;
    }
    const acc = S.recentAccess(s.id);
    return `<section class="card card-p space-y-1">${errs()}${write ? '<button class="btn-secondary btn-sm" id="p-edit">Edit profile</button>' : ''}
      <p class="text-sm"><b>Allergies:</b> ${!p || p.allergyStatus === 'unknown' ? 'not recorded' : p.allergyStatus === 'none' ? 'none known' : p.allergies.map((a) => `${escapeHtml(a.substance)} (${escapeHtml(lab(SEVERITY, a.severity))})`).join(', ')}</p>
      <p class="text-sm"><b>Conditions:</b> ${(p?.conditions ?? []).length ? p.conditions.map(escapeHtml).join(', ') : 'none recorded'}</p>
      <p class="text-sm"><b>Emergency contact:</b> ${p?.emergencyPhone ? `${escapeHtml(p.emergencyName)} · ${escapeHtml(p.emergencyPhone)}` : 'not recorded'}</p>
      <p class="text-sm"><b>Doctor:</b> ${escapeHtml(p?.doctor || 'not recorded')}${p?.bloodGroup ? ` · <b>Blood group:</b> ${escapeHtml(p.bloodGroup)}` : ''}</p>
      <p class="text-sm"><b>Consent for first aid and basic medication:</b> ${p?.consentFirstAid ? `yes (${escapeHtml(p.consentDate)})` : 'not recorded'}</p>${p?.notes ? `<p class="text-sm">${escapeHtml(p.notes)}</p>` : ''}
      <p class="text-xs text-ink-400" style="margin-top:.5rem;">Recently opened by: ${acc.map((a) => `${escapeHtml(a.by)} (${escapeHtml(a.at.slice(0, 16).replace('T', ' '))})`).join(', ')}</p></section>`;
  }
  function visitsTab(s) {
    const v = S.visitsOf(s.id);
    return `${write ? '<button class="btn-primary btn-sm" id="new-visit">+ Record a visit</button>' : ''}${st.showVisit ? `<section class="card card-p mt-2">${visitForm(s.id)}</section>` : errs()}
      <div class="card card-p mt-2">${v.length ? v.map((x) => `<div style="border-top:1px solid var(--ink-100);padding:.4rem 0;" class="text-sm"><b>${escapeHtml(x.date)} ${escapeHtml(x.time)}</b> ${escapeHtml(x.complaint)} → ${escapeHtml(lab(OUTCOMES, x.outcome))}${x.status === 'entered-in-error' ? ' · CORRECTED' : ''}<br/><span class="text-xs text-ink-500">${[x.temperature ? `${escapeHtml(x.temperature)}°C` : '', x.pulse ? `pulse ${escapeHtml(x.pulse)}` : '', x.action ? escapeHtml(x.action) : '', x.medication ? `gave ${escapeHtml(x.medication)} ${escapeHtml(x.dose)}` : '', x.parentNotified ? 'parent told' : '', `by ${escapeHtml(x.recordedBy)}`, x.correctionReason ? `correction: ${escapeHtml(x.correctionReason)}` : ''].filter(Boolean).join(' · ')}</span>${write && x.status !== 'entered-in-error' ? ` <button class="btn-ghost btn-sm" data-void-visit="${x.id}">Correct as entered in error</button>` : ''}</div>`).join('') : '<p class="text-sm text-ink-500">No visits recorded.</p>'}</div>`;
  }
  function medsTab(s) {
    const m = S.medsOf(s.id); const f = st.medForm ?? {};
    return `${write ? '<button class="btn-primary btn-sm" id="new-med">+ Add standing medication</button>' : ''}${st.showMed ? `<section class="card card-p space-y-2 mt-2">${errs()}<div class="grid grid-2 gap-2"><input class="input" id="m-name" placeholder="Medicine (e.g. salbutamol inhaler)" value="${escapeHtml(f.name ?? '')}"/><input class="input" id="m-dose" placeholder="Dose" value="${escapeHtml(f.dose ?? '')}"/><input class="input" id="m-times" placeholder="Times, e.g. 08:00, 13:00" value="${escapeHtml(f.times ?? '')}"/><input class="input" id="m-auth" placeholder="Authorised by (parent / doctor)" value="${escapeHtml(f.authorisedBy ?? '')}"/><div><label class="label">Starts</label><input class="input" type="date" id="m-start" value="${escapeHtml(f.startDate ?? iso())}"/></div><div><label class="label">Ends (optional)</label><input class="input" type="date" id="m-end" value="${escapeHtml(f.endDate ?? '')}"/></div></div><input class="input" id="m-ins" placeholder="Instructions" value="${escapeHtml(f.instructions ?? '')}"/>${st.needs.allergy ? '<label class="text-sm" style="color:var(--bad,#b3261e);"><input type="checkbox" id="m-allergy"/> The parent or doctor has confirmed this is safe</label>' : ''}<div class="flex gap-2"><button class="btn-primary btn-sm" id="m-save">Save</button><button class="btn-secondary btn-sm" id="m-cancel">Cancel</button></div></section>` : errs()}
      <div class="card card-p mt-2">${m.length ? m.map((x) => `<div class="flex flex-wrap justify-between gap-2 text-sm" style="border-top:1px solid var(--ink-100);padding:.4rem 0;"><span><b>${escapeHtml(x.name)}</b> ${escapeHtml(x.dose)} at ${x.times.map(escapeHtml).join(', ')}<br/><span class="text-xs text-ink-500">${escapeHtml(x.startDate)}${x.endDate ? ` to ${escapeHtml(x.endDate)}` : ''} · authorised by ${escapeHtml(x.authorisedBy)}${x.status === 'stopped' ? ' · STOPPED' : ''}</span></span>${write && x.status !== 'stopped' ? `<button class="btn-ghost btn-sm" data-stop="${x.id}">Stop</button>` : ''}</div>`).join('') : '<p class="text-sm text-ink-500">No standing medication.</p>'}</div>`;
  }
  function vaxTab(s) {
    const r = S.immunisationsOf(s.id); const over = new Set(overdueImmunisations(r.filter((x) => x.status !== 'entered-in-error')).map((x) => x.id)); const f = st.vaxForm ?? {};
    return `${write ? '<button class="btn-primary btn-sm" id="new-vax">+ Record an immunisation</button>' : ''}${st.showVax ? `<section class="card card-p space-y-2 mt-2">${errs()}<div class="grid grid-2 gap-2"><select class="input" id="i-vac">${opts(VACCINES.map((x) => [x, x]), f.vaccine, 'Vaccine…')}</select><input class="input" id="i-dose" inputmode="numeric" placeholder="Dose number" value="${escapeHtml(f.doseNumber ?? '')}"/><div><label class="label">Date given</label><input class="input" type="date" id="i-date" max="${iso()}" value="${escapeHtml(f.dateGiven ?? iso())}"/></div><div><label class="label">Next dose due (optional)</label><input class="input" type="date" id="i-next" value="${escapeHtml(f.nextDue ?? '')}"/></div></div><input class="input" id="i-notes" placeholder="Notes" value="${escapeHtml(f.notes ?? '')}"/><div class="flex gap-2"><button class="btn-primary btn-sm" id="i-save">Save</button><button class="btn-secondary btn-sm" id="i-cancel">Cancel</button></div></section>` : errs()}
      <div class="card card-p mt-2">${r.length ? r.map((x) => `<p class="text-sm" style="border-top:1px solid var(--ink-100);padding:.4rem 0;"><b>${escapeHtml(x.vaccine)}</b>${x.doseNumber ? ` dose ${x.doseNumber}` : ''} · ${escapeHtml(x.dateGiven)}${x.nextDue ? ` · next due ${escapeHtml(x.nextDue)}` : ''}${over.has(x.id) ? ' <b style="color:var(--bad,#b3261e);">OVERDUE</b>' : ''}${x.status === 'entered-in-error' ? ` · CORRECTED (${escapeHtml(x.correctionReason ?? '')})` : ''}${write && x.status !== 'entered-in-error' ? ` <button class="btn-ghost btn-sm" data-void-vax="${x.id}">Correct as entered in error</button>` : ''}</p>`).join('') : '<p class="text-sm text-ink-500">No immunisations recorded.</p>'}</div>`;
  }

  function open(id) { clear(); st.tab = 'learners'; st.studentId = id; st.sub = 'profile'; st.editProfile = st.showVisit = st.showMed = st.showVax = false; st.profile = st.visitForm = st.medForm = st.vaxForm = null; S.logAccess(id); }
  function saveVisit(studentId) {
    st.visitForm = readVisit(); const r = S.addVisit(studentId, { ...st.visitForm, overrideConsent: qs(container, '#v-override')?.checked, confirmAllergy: qs(container, '#v-allergy')?.checked });
    clear(); if (!r.ok) { st.errors = r.errors; st.needs = { consent: r.needsConsentOverride, allergy: r.needsAllergyConfirm }; } else { st.showVisit = false; st.visitForm = null; st.visitFor = ''; st.msg = 'Visit recorded.'; } draw();
  }
  function wire() {
    on(container, '[data-open]', 'click', (e) => { open(e.currentTarget.dataset.open); draw(); });
    qs(container, '#search')?.addEventListener('input', (e) => { st.search = e.target.value; const pos = e.target.selectionStart; draw(); const el = qs(container, '#search'); el.focus(); el.setSelectionRange(pos, pos); });
    qs(container, '#back')?.addEventListener('click', () => { clear(); st.studentId = ''; draw(); });
    on(container, '[data-sub]', 'click', (e) => { clear(); st.sub = e.currentTarget.dataset.sub; st.showVisit = st.showMed = st.showVax = st.editProfile = false; draw(); });
    qs(container, '#new-visit')?.addEventListener('click', () => { clear(); st.visitForm = null; st.showVisit = true; draw(); });
    qs(container, '#v-who')?.addEventListener('change', (e) => { st.visitFor = e.target.value; st.visitForm = null; clear(); draw(); });
    qs(container, '#v-cancel')?.addEventListener('click', () => { clear(); st.showVisit = false; st.visitForm = null; st.visitFor = ''; draw(); });
    qs(container, '#v-save')?.addEventListener('click', (e) => saveVisit(e.currentTarget.dataset.for));
    on(container, '[data-void-visit]', 'click', (e) => {
      if (!confirm('Mark this visit as entered in error? It will remain in the audit history and be excluded from active visit summaries.')) return;
      const reason = prompt('Required correction reason:') ?? '';
      const result = S.voidVisit(e.currentTarget.dataset.voidVisit, reason);
      clear(); if (!result.ok) st.errors = [result.reason]; else st.msg = 'Visit marked as entered in error.'; draw();
    });
    on(container, '[data-void-vax]', 'click', (e) => {
      if (!confirm('Mark this immunisation as entered in error? It will remain in the audit history.')) return;
      const reason = prompt('Required correction reason:') ?? '';
      const result = S.voidImmunisation(e.currentTarget.dataset.voidVax, reason);
      clear(); if (!result.ok) st.errors = [result.reason]; else st.msg = 'Immunisation marked as entered in error.'; draw();
    });
    on(container, '[data-give]', 'click', (e) => { const r = S.recordDose(e.currentTarget.dataset.give, e.currentTarget.dataset.time, true); clear(); if (!r.ok) st.errors = [r.reason]; draw(); });
    on(container, '[data-miss]', 'click', (e) => { const why = prompt('Why was the dose missed? (required)') ?? ''; const r = S.recordDose(e.currentTarget.dataset.miss, e.currentTarget.dataset.time, false, why); clear(); if (!r.ok) st.errors = [r.reason]; draw(); });
    // profile
    qs(container, '#p-edit')?.addEventListener('click', () => { clear(); st.profile = null; st.editProfile = true; draw(); });
    qs(container, '#p-cancel')?.addEventListener('click', () => { clear(); st.editProfile = false; st.profile = null; draw(); });
    const grab = () => { const d = st.profile; d.allergyStatus = qs(container, '#p-astat').value; d.allergies = [...container.querySelectorAll('[data-a-sub]')].map((el, i) => ({ substance: el.value, severity: qs(container, `[data-a-sev="${i}"]`).value, reaction: qs(container, `[data-a-rea="${i}"]`).value })); d.conditions = qs(container, '#p-cond').value.split('\n'); d.emergencyName = qs(container, '#p-en').value; d.emergencyPhone = qs(container, '#p-ep').value; d.doctor = qs(container, '#p-doc').value; d.bloodGroup = qs(container, '#p-bg').value; d.consentFirstAid = qs(container, '#p-consent').checked; d.notes = qs(container, '#p-notes').value; };
    qs(container, '#p-astat')?.addEventListener('change', () => { grab(); if (st.profile.allergyStatus === 'listed' && !st.profile.allergies.length) st.profile.allergies.push({ substance: '', severity: '', reaction: '' }); draw(); });
    qs(container, '#a-add')?.addEventListener('click', () => { grab(); st.profile.allergies.push({ substance: '', severity: '', reaction: '' }); draw(); });
    on(container, '[data-a-del]', 'click', (e) => { grab(); st.profile.allergies.splice(Number(e.currentTarget.dataset.aDel), 1); draw(); });
    qs(container, '#p-save')?.addEventListener('click', () => { grab(); const r = S.saveProfile(st.studentId, st.profile); clear(); if (!r.ok) st.errors = r.errors; else { st.editProfile = false; st.profile = null; st.msg = 'Profile saved.'; } draw(); });
    // medication
    qs(container, '#new-med')?.addEventListener('click', () => { clear(); st.medForm = null; st.showMed = true; draw(); });
    qs(container, '#m-cancel')?.addEventListener('click', () => { clear(); st.showMed = false; st.medForm = null; draw(); });
    qs(container, '#m-save')?.addEventListener('click', () => { st.medForm = { name: qs(container, '#m-name').value, dose: qs(container, '#m-dose').value, times: qs(container, '#m-times').value, authorisedBy: qs(container, '#m-auth').value, startDate: qs(container, '#m-start').value, endDate: qs(container, '#m-end').value, instructions: qs(container, '#m-ins').value }; const r = S.addMedication(st.studentId, { ...st.medForm, times: st.medForm.times.split(/[,;\s]+/), confirmAllergy: qs(container, '#m-allergy')?.checked }); clear(); if (!r.ok) { st.errors = r.errors; st.needs = { allergy: r.needsAllergyConfirm }; } else { st.showMed = false; st.medForm = null; st.msg = 'Medication added.'; } draw(); });
    on(container, '[data-stop]', 'click', (e) => { if (confirm('Stop this medication? It will no longer appear in the daily list.')) { S.stopMedication(e.currentTarget.dataset.stop); draw(); } });
    // immunisation
    qs(container, '#new-vax')?.addEventListener('click', () => { clear(); st.vaxForm = null; st.showVax = true; draw(); });
    qs(container, '#i-cancel')?.addEventListener('click', () => { clear(); st.showVax = false; st.vaxForm = null; draw(); });
    qs(container, '#i-save')?.addEventListener('click', () => { st.vaxForm = { vaccine: qs(container, '#i-vac').value, doseNumber: qs(container, '#i-dose').value.trim(), dateGiven: qs(container, '#i-date').value, nextDue: qs(container, '#i-next').value, notes: qs(container, '#i-notes').value }; const r = S.addImmunisation(st.studentId, st.vaxForm); clear(); if (!r.ok) st.errors = r.errors; else { st.showVax = false; st.vaxForm = null; st.msg = 'Immunisation recorded.'; } draw(); });
  }
  draw();
}
