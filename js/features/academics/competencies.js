// CBC competency tracking: rate learners against learning outcomes, see a class or a learner, manage the outcomes bank,
// and check curriculum coverage. Teachers see only the classes and subjects they are allocated to.
import { escapeHtml, on, qs } from '../../components/dom.js';
import { featureEnabled } from '../../services/subscriptionService.js';
import * as C from '../../services/competencyService.js';
import * as L from '../../services/competencyLogic.js';

const SCALE = L.DEFAULT_RATING_SCALE;
const sortName = (a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
const nm = (s) => `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim();
const opt = (v, label, cur) => `<option value="${escapeHtml(v)}" ${v === cur ? 'selected' : ''}>${escapeHtml(label)}</option>`;
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

// One row of four tap targets. Selected level is filled; every button has the full name for screen readers.
const levelButtons = (current, attrs) => `<span class="cbc-levels" role="group" aria-label="Rating">${SCALE.slice().sort((a, b) => b.value - a.value).map((s) => `<button type="button" class="cbc-btn ${current === s.key ? 'on' : ''}" style="--tone:${L.TONE[s.key] ?? '#555'}" aria-pressed="${current === s.key}" title="${escapeHtml(s.label)}" aria-label="${escapeHtml(s.label)}" ${attrs} data-level="${s.key}">${escapeHtml(L.shortLabel(s.key))}</button>`).join('')}</span>`;
const legend = () => `<p class="text-xs text-ink-500">${SCALE.slice().sort((a, b) => b.value - a.value).map((s) => `<b>${escapeHtml(L.shortLabel(s.key))}</b> ${escapeHtml(s.label)}`).join(' · ')}</p>`;
const bar = (dist, total) => `<div class="cbc-bar" role="img" aria-label="${escapeHtml(SCALE.map((s) => `${dist[s.key] ?? 0} ${L.shortLabel(s.key)}`).join(', '))}">${SCALE.slice().sort((a, b) => b.value - a.value).map((s) => `<span style="width:${pct(dist[s.key] ?? 0, total)}%;background:${L.TONE[s.key] ?? '#555'}"></span>`).join('')}</div>`;

// The printable CBC progress report for one learner and term.
export function progressReportHtml(d, learner, termId) {
  const term = d.termById[termId]; const cls = d.classById[learner.classId];
  const subjects = d.subjects.filter((s) => (s.classIds ?? []).includes(learner.classId));
  const prog = L.progressBySubject({ learner, subjects, outcomes: d.outcomes, ratings: d.ratings, scale: SCALE, termId });
  return `<div id="cbc-report" class="card card-p space-y-3"><div><h2 class="text-lg" style="font-weight:600;">${escapeHtml(d.school?.name ?? '')}</h2><p class="text-sm">Competency progress report · ${escapeHtml(term?.name ?? '')}</p></div>
    <p class="text-sm"><b>${escapeHtml(nm(learner))}</b> · ${escapeHtml(cls?.name ?? '')}${learner.admissionNumber ? ` · Adm. ${escapeHtml(learner.admissionNumber)}` : ''}</p>${legend()}
    ${prog.length ? prog.map((p) => `<section><h3 class="text-sm" style="font-weight:600;margin-top:.6rem;">${escapeHtml(p.subject.name)} <span class="text-xs text-ink-500">· reached ${p.reached} of ${p.total} outcomes (${p.reachedShare ?? 0}%)</span></h3>
      <table class="data-table"><thead><tr><th>Strand</th><th>Outcome</th><th>Level</th></tr></thead><tbody>${p.rows.map((r) => `<tr><td>${escapeHtml([r.outcome.strand, r.outcome.subStrand].filter(Boolean).join(' › '))}</td><td>${escapeHtml(r.outcome.description)}</td><td style="white-space:nowrap;">${r.level ? `<b style="color:${L.TONE[r.level]}">${escapeHtml(L.shortLabel(r.level))}</b> ${escapeHtml(L.levelLabel(r.level))}` : '<span class="text-ink-500">Not yet rated</span>'}</td></tr>`).join('')}</tbody></table></section>`).join('') : '<p class="text-sm text-ink-500">No learning outcomes have been set up for this class yet.</p>'}</div>`;
}

export async function renderCompetencies(container) {
  if (!featureEnabled('competency_ratings')) { container.innerHTML = '<div class="card card-p"><p class="text-sm text-ink-500">CBC competency tracking is not included in your package.</p></div>'; return; }
  container.innerHTML = '<div class="card card-p"><p class="text-sm text-ink-500" role="status">Loading…</p></div>';
  let d = await C.loadCompetency();
  const classes = d.myClasses.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
  const st = { view: 'rate', classId: classes[0]?.id ?? '', subjectId: '', termId: d.currentTerm?.id ?? d.terms[0]?.id ?? '', outcomeId: '', studentId: '', msg: '', errors: [], showArchived: false, bulk: '', applyAll: false, report: false, outcomeEdit: null };
  const views = [['rate', 'Rate'], ['learner', 'By learner'], ['overview', 'Class overview'], ['outcomes', 'Outcomes'], ...(featureEnabled('curriculum_coverage') ? [['coverage', 'Coverage']] : [])];
  const subjects = () => (st.classId ? d.subjectsFor(st.classId) : []);
  const outcomesHere = () => L.outcomesFor(d.outcomes, { classId: st.classId, subjectId: st.subjectId });
  const learners = () => d.students.filter((s) => s.classId === st.classId && (s.status ?? 'active') === 'active').sort(sortName);
  const clear = () => { st.msg = ''; st.errors = []; };
  const errs = () => `${st.errors.map((e) => `<p class="field-error" role="alert">${escapeHtml(e)}</p>`).join('')}${st.msg ? `<div class="notice" role="status"><span>${escapeHtml(st.msg)}</span></div>` : ''}`;

  function ensure() {
    if (!classes.some((c) => c.id === st.classId)) st.classId = classes[0]?.id ?? '';
    const subs = subjects(); if (st.view !== 'learner' && !subs.some((s) => s.id === st.subjectId)) st.subjectId = subs[0]?.id ?? '';
    const outs = outcomesHere(); if (!outs.some((o) => o.id === st.outcomeId)) st.outcomeId = outs[0]?.id ?? '';
    const ls = learners(); if (!ls.some((s) => s.id === st.studentId)) st.studentId = ls[0]?.id ?? '';
  }

  function draw() {
    ensure(); const subs = subjects(); const lock = C.lockedRunFor(st.classId, st.termId);
    if (!classes.length) { container.innerHTML = '<div class="card card-p"><p class="text-sm text-ink-500">You have no classes allocated yet. Ask the administrator to allocate you under Academics → Allocation.</p></div>'; return; }
    container.innerHTML = `<div class="space-y-4"><div class="pill-group" style="flex-wrap:wrap;">${views.map(([k, v]) => `<button class="pill ${st.view === k ? 'active' : ''}" data-view="${k}">${v}</button>`).join('')}</div>
      <div class="grid grid-2 lg-grid-4 gap-3 no-print"><div><label class="label" for="cb-class">Class</label><select class="input" id="cb-class">${classes.map((c) => opt(c.id, c.name, st.classId)).join('')}</select></div>
        ${st.view === 'learner' ? `<div><label class="label" for="cb-learner">Learner</label><select class="input" id="cb-learner">${learners().map((s) => opt(s.id, nm(s), st.studentId)).join('')}</select></div>` : `<div><label class="label" for="cb-subject">Subject</label><select class="input" id="cb-subject">${subs.map((s) => opt(s.id, s.name, st.subjectId)).join('')}</select></div>`}
        ${st.view === 'outcomes' ? '' : `<div><label class="label" for="cb-term">Term</label><select class="input" id="cb-term">${d.terms.map((t) => opt(t.id, t.name, st.termId)).join('')}</select></div>`}</div>
      ${st.view !== 'outcomes' && lock ? `<div class="notice" role="status"><span>🔒 Ratings for this class and term are locked because its report is ${escapeHtml(lock.status.replace('_', ' '))}. An administrator can return or reopen it.</span></div>` : ''}
      ${errs()}<div id="cb-body">${body()}</div></div>`;
    on(container, '[data-view]', 'click', (e) => { clear(); st.view = e.currentTarget.dataset.view; st.report = false; draw(); });
    qs(container, '#cb-class').addEventListener('change', (e) => { clear(); st.classId = e.target.value; st.subjectId = ''; st.outcomeId = ''; st.studentId = ''; draw(); });
    qs(container, '#cb-subject')?.addEventListener('change', (e) => { clear(); st.subjectId = e.target.value; st.outcomeId = ''; draw(); });
    qs(container, '#cb-learner')?.addEventListener('change', (e) => { clear(); st.studentId = e.target.value; st.report = false; draw(); });
    qs(container, '#cb-term')?.addEventListener('change', (e) => { clear(); st.termId = e.target.value; draw(); });
    wire();
  }
  const body = () => ({ rate: rateView, learner: learnerView, overview: overviewView, outcomes: outcomesView, coverage: coverageView }[st.view]());
  const noOutcomes = '<div class="card card-p"><p class="text-sm text-ink-500">No learning outcomes have been set up for this class and subject yet. Add them under <b>Outcomes</b>.</p></div>';
  const latest = (studentId, outcomeId) => L.latestRatings(d.ratings).find((r) => r.studentId === studentId && r.outcomeId === outcomeId && (r.termId ?? '') === st.termId)?.level ?? null;

  // ---------- rate: one outcome, every learner in the class
  function rateView() {
    const outs = outcomesHere(); if (!outs.length) return noOutcomes; const o = outs.find((x) => x.id === st.outcomeId) ?? outs[0]; const ls = learners();
    const sum = L.outcomeSummary(o.id, d.ratings, ls.map((s) => s.id), SCALE, st.termId);
    return `<div class="card card-p space-y-2"><label class="label" for="cb-outcome">Outcome</label><select class="input" id="cb-outcome">${L.groupByStrand(outs).map((g) => `<optgroup label="${escapeHtml(g.strand)}">${g.list.map((x) => opt(x.id, x.description.length > 90 ? `${x.description.slice(0, 90)}…` : x.description, o.id)).join('')}</optgroup>`).join('')}</select>
      <p class="text-sm" style="font-weight:600;">${escapeHtml(o.description)}</p>${legend()}
      <p class="text-xs text-ink-500" id="cb-sum">${sum.rated} of ${ls.length} rated${sum.topLevelShare === null ? '' : ` · ${sum.topLevelShare}% at the top level`}</p>${bar(sum.distribution, sum.rated || 1)}</div>
      <div class="card card-p" id="cb-list">${ls.length ? ls.map((s) => `<div class="cbc-row"><span class="text-sm">${escapeHtml(nm(s))}</span>${levelButtons(latest(s.id, o.id), `data-rate="${s.id}"`)}</div>`).join('') : '<p class="text-sm text-ink-500">No learners in this class.</p>'}</div>`;
  }
  // ---------- by learner
  function learnerView() {
    const s = d.studentById[st.studentId]; if (!s) return '<div class="card card-p"><p class="text-sm text-ink-500">No learners in this class.</p></div>';
    if (st.report) return `<p class="no-print"><button class="btn-secondary btn-sm" id="cb-back">← Back to rating</button> <button class="btn-primary btn-sm" id="cb-print">Print report</button></p>${progressReportHtml(d, s, st.termId)}`;
    const prog = L.progressBySubject({ learner: s, subjects: d.subjectsFor(st.classId), outcomes: d.outcomes, ratings: d.ratings, scale: SCALE, termId: st.termId });
    if (!prog.length) return noOutcomes;
    return `${legend()}<p class="no-print"><button class="btn-secondary btn-sm" id="cb-report">View printable report</button></p>${prog.map((p) => `<section class="card card-p space-y-1"><h3 class="text-sm" style="font-weight:600;">${escapeHtml(p.subject.name)} <span class="text-xs text-ink-500">· reached ${p.reached} of ${p.total}</span></h3>${p.rows.map((r) => `<div class="cbc-row"><span class="text-sm">${escapeHtml(r.outcome.description)}</span>${levelButtons(r.level, `data-rate="${s.id}" data-outcome="${r.outcome.id}"`)}</div>`).join('')}</section>`).join('')}`;
  }
  // ---------- class overview
  function overviewView() {
    const outs = outcomesHere(); if (!outs.length) return noOutcomes; const ls = learners(); const ov = L.classOverview({ learners: ls, outcomes: outs, ratings: d.ratings, scale: SCALE, termId: st.termId });
    const support = L.learnersNeedingSupport({ learners: ls, outcomes: outs, ratings: d.ratings, scale: SCALE, termId: st.termId });
    return `<div class="card card-p space-y-2"><p class="text-sm"><b>${ov.meetingShare === null ? '—' : `${ov.meetingShare}%`}</b> of ratings are at Meeting expectation or above · ${ls.length} learners · ${outs.length} outcomes</p>${legend()}
      ${ov.rows.map((r) => `<div style="border-top:1px solid var(--ink-100);padding:.5rem 0;"><p class="text-sm">${escapeHtml(r.outcome.description)}</p><p class="text-xs text-ink-500">${r.rated} of ${ls.length} rated${r.rated < ls.length ? ` · ${r.notRated} not yet rated` : ''}</p>${bar(r.distribution, r.rated || 1)}</div>`).join('')}</div>
      <div class="card card-p"><h3 class="text-sm" style="font-weight:600;">Learners needing support</h3>${support.length ? support.map((x) => `<div class="flex justify-between text-sm" style="border-top:1px solid var(--ink-100);padding:.4rem 0;"><span>${escapeHtml(nm(x.learner))}</span><span>${x.below} of ${x.rated} rated below Meeting</span></div>`).join('') : '<p class="text-sm text-ink-500">Nobody is rated below Meeting expectation yet.</p>'}</div>`;
  }
  // ---------- outcomes bank
  function outcomesView() {
    const cls = d.classById[st.classId]; const all = L.outcomesFor(d.outcomes.map((o) => ({ ...o, status: o.status === 'archived' && st.showArchived ? 'active' : o.status })), { classId: st.classId, subjectId: st.subjectId });
    const same = classes.filter((c) => c.curriculumId === cls?.curriculumId);
    return `<div class="card card-p space-y-2"><h3 class="text-sm" style="font-weight:600;">Add outcomes to ${escapeHtml(d.subjectById[st.subjectId]?.name ?? 'this subject')}, ${escapeHtml(cls?.name ?? '')}</h3>
      <p class="text-xs text-ink-500">One per line: <code>Strand | Sub-strand | Outcome</code> (strand and sub-strand are optional). Paste straight from your curriculum design or scheme of work. Nothing is saved if any line has a problem.</p>
      <textarea class="input" id="cb-bulk" rows="5" aria-label="Outcomes, one per line">${escapeHtml(st.bulk)}</textarea>
      ${same.length > 1 ? `<label class="text-sm"><input type="checkbox" id="cb-all" ${st.applyAll ? 'checked' : ''}/> Apply to all ${same.length} classes using ${escapeHtml(d.curriculumById[cls.curriculumId]?.name ?? 'this curriculum')}</label>` : ''}
      <button class="btn-primary btn-sm" id="cb-add" data-write-collection="learningOutcomes">Add outcomes</button></div>
      <label class="text-sm"><input type="checkbox" id="cb-arch" ${st.showArchived ? 'checked' : ''}/> Show archived</label>
      ${all.length ? L.groupByStrand(all).map((g) => `<section class="card card-p space-y-1"><h3 class="text-sm" style="font-weight:600;">${escapeHtml(g.strand)}</h3>${g.list.map((o) => { const arch = d.outcomes.find((x) => x.id === o.id)?.status === 'archived'; const n = d.ratings.filter((r) => r.outcomeId === o.id).length; return `<div class="flex justify-between gap-2 text-sm" style="border-top:1px solid var(--ink-100);padding:.4rem 0;${arch ? 'opacity:.6;' : ''}"><span>${escapeHtml(o.description)}${arch ? ' (archived)' : ''}<br/><span class="text-xs text-ink-500">${n} rating${n === 1 ? '' : 's'} recorded</span></span><span class="flex gap-2"><button class="btn-secondary btn-sm" data-edit-outcome="${o.id}" data-write-collection="learningOutcomes">Edit</button><button class="btn-ghost btn-sm" data-arch="${o.id}" data-write-collection="learningOutcomes">${arch ? 'Restore' : 'Archive'}</button></span></div>${st.outcomeEdit?.id === o.id ? `<div class="card card-p space-y-2"><label class="label">Strand</label><input class="input" data-outcome-edit="strand" value="${escapeHtml(st.outcomeEdit.strand)}" /><label class="label">Sub-strand</label><input class="input" data-outcome-edit="subStrand" value="${escapeHtml(st.outcomeEdit.subStrand)}" /><label class="label">Outcome</label><textarea class="input" data-outcome-edit="description" rows="2">${escapeHtml(st.outcomeEdit.description)}</textarea><div class="flex gap-2"><button class="btn-primary btn-sm" data-save-outcome="${o.id}" data-write-collection="learningOutcomes">Save changes</button><button class="btn-secondary btn-sm" data-cancel-outcome>Cancel</button></div></div>` : ''}`; }).join('')}</section>`).join('') : '<div class="card card-p"><p class="text-sm text-ink-500">No outcomes yet for this class and subject.</p></div>'}`;
  }
  // ---------- coverage
  function coverageView() {
    const cov = C.coverageFor(d, { classId: st.classId, subjectId: st.subjectId, termId: st.termId }); const o = cov.outcomes;
    if (!o.total) return noOutcomes;
    const chip = (s) => `<span style="font-weight:600;color:${s === 'taught' ? '#1d7447' : s === 'planned' ? '#8f5c0b' : '#b0413e'};">${escapeHtml(s)}</span>`;
    const order = { 'not covered': 0, planned: 1, taught: 2 };
    return `<div class="grid grid-2 gap-3"><div class="card card-p"><p class="text-xs text-ink-500">Outcomes taught</p><b class="text-lg">${o.taught} of ${o.total}</b><p class="text-xs text-ink-500">${o.pct ?? 0}% · ${o.planned} planned, ${o.total - o.taught - o.planned} not covered</p></div>
      <div class="card card-p"><p class="text-xs text-ink-500">Scheme of work weeks done</p><b class="text-lg">${cov.scheme.weeks ? `${cov.scheme.done} of ${cov.scheme.weeks}` : '—'}</b><p class="text-xs text-ink-500">${cov.scheme.pct === null ? 'No scheme of work for this class and subject' : `${cov.scheme.pct}%`}</p></div></div>
      <div class="card card-p"><p class="text-xs text-ink-500">Coverage comes from lesson plans: when a teacher plans a lesson they tick the outcomes it covers, and mark it taught afterwards.${cov.plans ? '' : ' No lesson plans exist for this class and subject yet.'}</p>
      ${o.rows.slice().sort((a, b) => order[a.state] - order[b.state]).map((r) => `<div class="flex justify-between gap-2 text-sm" style="border-top:1px solid var(--ink-100);padding:.4rem 0;"><span>${escapeHtml(r.outcome.description)}</span>${chip(r.state)}</div>`).join('')}</div>`;
  }

  async function doRate(studentId, outcomeId, level) {
    clear(); const r = await C.rate(d, { studentId, outcomeId, termId: st.termId, level });
    if (!r.ok) { st.errors = [r.reason]; return draw(); }
    const y = window.scrollY; draw(); window.scrollTo(0, y);
  }
  function wire() {
    qs(container, '#cb-outcome')?.addEventListener('change', (e) => { st.outcomeId = e.target.value; draw(); });
    on(container, '[data-rate]', 'click', (e) => { const b = e.currentTarget; doRate(b.dataset.rate, b.dataset.outcome ?? st.outcomeId, b.dataset.level); });
    qs(container, '#cb-report')?.addEventListener('click', () => { st.report = true; draw(); });
    qs(container, '#cb-back')?.addEventListener('click', () => { st.report = false; draw(); });
    qs(container, '#cb-print')?.addEventListener('click', () => { document.body.classList.add('cbc-printing'); try { window.print(); } finally { document.body.classList.remove('cbc-printing'); } });
    qs(container, '#cb-arch')?.addEventListener('change', (e) => { st.showArchived = e.target.checked; draw(); });
    qs(container, '#cb-all')?.addEventListener('change', (e) => { st.applyAll = e.target.checked; });
    qs(container, '#cb-bulk')?.addEventListener('input', (e) => { st.bulk = e.target.value; });
    on(container, '[data-arch]', 'click', async (e) => { const o = d.outcomes.find((x) => x.id === e.currentTarget.dataset.arch); await C.setOutcomeStatus(o, o.status === 'archived' ? 'active' : 'archived'); d = await C.loadCompetency(); draw(); });
    on(container, '[data-edit-outcome]', 'click', (e) => {
      const outcome = d.outcomes.find((item) => item.id === e.currentTarget.dataset.editOutcome);
      if (outcome) { st.outcomeEdit = { ...outcome }; draw(); }
    });
    on(container, '[data-outcome-edit]', 'input', (e) => { st.outcomeEdit[e.target.dataset.outcomeEdit] = e.target.value; });
    on(container, '[data-cancel-outcome]', 'click', () => { st.outcomeEdit = null; draw(); });
    on(container, '[data-save-outcome]', 'click', async () => {
      const outcome = d.outcomes.find((item) => item.id === st.outcomeEdit?.id);
      if (!outcome) return;
      clear();
      try {
        await C.saveOutcome(d, st.outcomeEdit);
        st.outcomeEdit = null;
        st.msg = 'Outcome updated.';
        d = await C.loadCompetency();
      } catch (error) { st.errors = [error.message]; }
      draw();
    });
    qs(container, '#cb-add')?.addEventListener('click', async () => {
      st.bulk = qs(container, '#cb-bulk').value; const cls = d.classById[st.classId]; clear();
      if (!cls?.curriculumId) { st.errors = ['This class has no curriculum yet. Set it under Academics → Classes.']; return draw(); }
      const classIds = st.applyAll ? classes.filter((c) => c.curriculumId === cls.curriculumId).map((c) => c.id) : [st.classId];
      const r = await C.addOutcomes(d, { text: st.bulk, curriculumId: cls.curriculumId, subjectId: st.subjectId, classIds });
      if (!r.ok) st.errors = r.errors; else { st.msg = `${r.added} outcome${r.added === 1 ? '' : 's'} added.`; st.bulk = ''; d = await C.loadCompetency(); }
      draw();
    });
  }
  draw();
}
