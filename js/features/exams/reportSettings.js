// Report settings (administrator): the school's report policy, a grade-scale checker, and weighted-assessment schemes.
// Everything is validated by the academic engine before it is saved. Demo mode until the backend phase.
import { escapeHtml, on, qs } from '../../components/dom.js';
import { reportPolicyRepo, weightingSchemeRepo, gradingSystemRepo, gradeBandRepo } from '../../services/examService.js';
import { classesSortedByOrder, subjectRepo, termRepo } from '../../services/academicService.js';
import * as E from '../../services/academicEngine.js';

const ASSESSMENT_TYPES = [['assignment', 'Assignment'], ['cat', 'CAT'], ['test', 'Test'], ['project', 'Project'], ['practical', 'Practical'], ['continuous', 'Continuous assessment'], ['custom', 'Custom']];
const opt = (list, sel) => list.map(([v, l]) => `<option value="${escapeHtml(v)}" ${v === sel ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('');

export function renderReportSettings(container) {
  const st = { flash: '', error: '', editing: null };
  const saved = () => reportPolicyRepo.getAll()[0];
  function draw() {
    const policy = E.mergePolicy(saved());
    const classes = classesSortedByOrder(); const subjects = subjectRepo.getAll(); const terms = termRepo.getAll();
    const system = gradingSystemRepo.getAll().find((g) => g.isDefault) ?? gradingSystemRepo.getAll()[0];
    const issues = system ? E.validateBands(gradeBandRepo.getAll().filter((b) => b.gradingSystemId === system.id)) : [{ level: 'error', text: 'No grading scale has been set up yet.' }];
    const schemes = weightingSchemeRepo.getAll();
    const sc = st.editing;
    const label = (s) => [s.classId ? classes.find((c) => c.id === s.classId)?.name : 'All classes', s.subjectId ? subjects.find((x) => x.id === s.subjectId)?.name : 'all subjects', s.termId ? terms.find((t) => t.id === s.termId)?.name : 'every term'].join(' · ');
    container.innerHTML = `<div class="space-y-4">
      ${st.flash ? `<div class="notice" role="status"><span>${escapeHtml(st.flash)}</span></div>` : ''}${st.error ? `<div class="notice" role="alert"><span>${escapeHtml(st.error)}</span></div>` : ''}
      <section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">Grade scale check</h3>
        ${issues.length ? issues.map((i) => `<p class="text-sm" style="color:${i.level === 'error' ? 'var(--bad)' : 'inherit'};">${i.level === 'error' ? '⚠' : 'ℹ'} ${escapeHtml(i.text)}</p>`).join('') : '<p class="text-sm" style="color:var(--good);">The grading scale covers every score from 0 to 100 with no gaps or overlaps.</p>'}
        <p class="text-xs text-ink-500">A report cannot be submitted for approval while the scale has errors. Edit bands in the Grading tab.</p></section>
      <section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">Report policy</h3><p class="text-xs text-ink-500">These are the school's own choices. Nothing here assumes a particular curriculum or ranking rule.</p>
        <div class="grid grid-2 lg-grid-4 gap-3">
          <div><label class="label">Decimal places</label><select class="input" id="p-dec">${opt([0, 1, 2, 3].map((n) => [n, String(n)]), policy.decimals)}</select></div>
          <div><label class="label">Missing marks</label><select class="input" id="p-miss">${opt([['exclude', 'Left out of the average'], ['zero', 'Counted as zero']], policy.missingScore)}</select></div>
          <div><label class="label">Class position</label><select class="input" id="p-rank">${opt([['class', 'Rank within the class'], ['stream', 'Rank within the stream'], ['none', 'Do not rank']], policy.ranking)}</select></div>
          <div><label class="label">Tied learners</label><select class="input" id="p-tie">${opt([['share', 'Share a place (1, 2, 2, 4)'], ['dense', 'Share, no gap (1, 2, 2, 3)']], policy.tieMode)}</select></div>
          <div><label class="label">Pass mark (%)</label><input class="input" type="number" min="0" max="100" id="p-pass" value="${policy.passMark}" /></div>
          <div><label class="label">Minimum subjects to rank</label><input class="input" type="number" min="1" id="p-min" value="${policy.minSubjectsToRank}" /></div>
          <div><label class="label">Missing assessment part</label><select class="input" id="p-comp">${opt([['redistribute', 'Share its weight among the rest'], ['zero', 'Count as zero'], ['incomplete', 'Leave the subject incomplete']], policy.missingComponent)}</select></div>
          <div><label class="label">Grade matching</label><select class="input" id="p-band">${opt([['lower_bound', 'Reaches the band minimum'], ['strict', 'Strictly inside min–max']], policy.bandMatch)}</select></div></div>
        <div class="flex flex-wrap gap-4">${[['p-pos', 'showPosition', 'Print class position'], ['p-avg', 'showClassAverage', 'Print class average per subject'], ['p-inc', 'rankIncomplete', 'Rank learners with missing marks'], ['p-rc', 'requireComments', 'Require subject comments before submitting'], ['p-rcc', 'requireClassComment', "Require the class teacher's comment"], ['p-sep', 'separateApprover', 'Approver must differ from submitter'], ['p-enf', 'enforceWorkflow', 'Share report cards only after approval and publishing']].map(([id, k, l]) => `<label class="text-sm"><input type="checkbox" id="${id}" ${policy[k] ? 'checked' : ''} /> ${l}</label>`).join('')}</div>
        <button class="btn-primary" id="p-save">Save policy</button></section>
      <section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">Weighted assessments</h3><p class="text-xs text-ink-500">Combine the examination with CATs, assignments and other assessment types into one subject mark. The most specific scheme wins: subject, then class, then whole school. With no scheme, the raw examination mark is used.</p>
        ${schemes.map((s) => `<div class="flex flex-wrap items-center justify-between gap-2 text-sm" style="border-top:1px solid var(--ink-100);padding-top:.5rem;"><span><strong>${escapeHtml(label(s))}</strong><br><span class="text-xs text-ink-500">${s.components.map((c) => `${c.kind === 'exam' ? 'Examination' : ASSESSMENT_TYPES.find(([v]) => v === c.ref)?.[1] ?? c.ref} ${c.weight}%`).join(' + ')}</span></span><span><button class="btn-ghost btn-sm" data-edit="${s.id}">Edit</button><button class="btn-ghost btn-sm" data-del="${s.id}">Delete</button></span></div>`).join('') || '<p class="text-sm text-ink-500">No weighting schemes: examination marks are used as entered.</p>'}
        ${sc ? `<div class="card card-p space-y-3" style="background:var(--ink-50);"><div class="grid grid-2 lg-grid-4 gap-3"><div><label class="label">Class</label><select class="input" data-s="classId"><option value="">All classes</option>${opt(classes.map((c) => [c.id, c.name]), sc.classId)}</select></div><div><label class="label">Subject</label><select class="input" data-s="subjectId"><option value="">All subjects</option>${opt(subjects.map((c) => [c.id, c.name]), sc.subjectId)}</select></div><div><label class="label">Term</label><select class="input" data-s="termId"><option value="">Every term</option>${opt(terms.map((c) => [c.id, c.name]), sc.termId)}</select></div></div>
          ${sc.components.map((c, i) => `<div class="flex flex-wrap items-end gap-2" data-comp="${i}"><div><label class="label">Part</label><select class="input" data-c="ref"><option value="__exam" ${c.kind === 'exam' ? 'selected' : ''}>Examination</option>${opt(ASSESSMENT_TYPES, c.kind === 'category' ? c.ref : '')}</select></div><div><label class="label">Weight %</label><input class="input" type="number" min="1" max="100" step="any" data-c="weight" value="${c.weight}" style="max-width:7rem;" /></div><button class="btn-ghost btn-sm" data-rmc="${i}">Remove</button></div>`).join('')}
          <p class="text-sm">Total: <strong>${E.round(sc.components.reduce((t, c) => t + Number(c.weight || 0), 0), 2)}%</strong> ${E.validateScheme(sc) ? `<span style="color:var(--bad);">— ${escapeHtml(E.validateScheme(sc))}</span>` : '<span style="color:var(--good);">— valid</span>'}</p>
          <div class="flex gap-2"><button class="btn-secondary btn-sm" id="s-addc">Add part</button><button class="btn-primary btn-sm" id="s-save">Save scheme</button><button class="btn-ghost btn-sm" id="s-cancel">Cancel</button></div></div>` : '<button class="btn-secondary btn-sm" id="s-new">New scheme</button>'}</section></div>`;
    const flash = (f, e = '') => { st.flash = f; st.error = e; draw(); };
    qs(container, '#p-save').addEventListener('click', () => {
      const next = E.mergePolicy({ decimals: Number(qs(container, '#p-dec').value), missingScore: qs(container, '#p-miss').value, ranking: qs(container, '#p-rank').value, tieMode: qs(container, '#p-tie').value, passMark: Number(qs(container, '#p-pass').value), minSubjectsToRank: Number(qs(container, '#p-min').value), missingComponent: qs(container, '#p-comp').value, bandMatch: qs(container, '#p-band').value,
        showPosition: qs(container, '#p-pos').checked, showClassAverage: qs(container, '#p-avg').checked, rankIncomplete: qs(container, '#p-inc').checked, requireComments: qs(container, '#p-rc').checked, requireClassComment: qs(container, '#p-rcc').checked, separateApprover: qs(container, '#p-sep').checked, enforceWorkflow: qs(container, '#p-enf').checked });
      const err = E.validatePolicy(next); if (err) return flash('', err);
      const cur = saved(); if (cur) reportPolicyRepo.update(cur.id, next, 'updated report policy'); else reportPolicyRepo.create(next, 'created report policy');
      flash('Policy saved. New report cards use it straight away.');
    });
    qs(container, '#s-new')?.addEventListener('click', () => { st.editing = { classId: '', subjectId: '', termId: '', components: [{ kind: 'exam', weight: 60 }, { kind: 'category', ref: 'cat', weight: 40 }] }; draw(); });
    on(container, '[data-edit]', 'click', (e) => { st.editing = JSON.parse(JSON.stringify(weightingSchemeRepo.getAll().find((x) => x.id === e.currentTarget.dataset.edit))); draw(); });
    on(container, '[data-del]', 'click', (e) => { if (confirm('Delete this weighting scheme? Reports go back to raw examination marks for those subjects.')) { weightingSchemeRepo.remove(e.currentTarget.dataset.del); flash('Scheme deleted.'); } });
    on(container, '[data-s]', 'change', (e) => { st.editing[e.currentTarget.dataset.s] = e.currentTarget.value; });
    on(container, '[data-c]', 'change', (e) => { const i = Number(e.currentTarget.closest('[data-comp]').dataset.comp); const c = st.editing.components[i]; if (e.currentTarget.dataset.c === 'weight') c.weight = Number(e.currentTarget.value); else if (e.currentTarget.value === '__exam') { c.kind = 'exam'; delete c.ref; } else { c.kind = 'category'; c.ref = e.currentTarget.value; } setTimeout(draw, 0); }); // redraw after the field has finished losing focus
    on(container, '[data-rmc]', 'click', (e) => { st.editing.components.splice(Number(e.currentTarget.dataset.rmc), 1); draw(); });
    qs(container, '#s-addc')?.addEventListener('click', () => { st.editing.components.push({ kind: 'category', ref: 'assignment', weight: 10 }); draw(); });
    qs(container, '#s-cancel')?.addEventListener('click', () => { st.editing = null; draw(); });
    qs(container, '#s-save')?.addEventListener('click', () => {
      const err = E.validateScheme(st.editing); if (err) return flash('', err);
      const rec = { classId: st.editing.classId || undefined, subjectId: st.editing.subjectId || undefined, termId: st.editing.termId || undefined, components: st.editing.components };
      if (st.editing.id) weightingSchemeRepo.update(st.editing.id, rec, 'updated weighting scheme'); else weightingSchemeRepo.create(rec, 'created weighting scheme');
      st.editing = null; flash('Scheme saved. It applies to new report cards.');
    });
  }
  draw();
}
