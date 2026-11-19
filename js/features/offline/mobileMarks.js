// Phone-first marks entry for assessments (CATs, assignments) and examinations.
// Drafts autosave on the device as you type and are restored after a refresh or restart. Marks are
// checked against the maximum before they can be submitted; submitted marks are queued on the device
// and synced when possible. Teachers only see their own classes.
import { escapeHtml, on, qs } from '../../components/dom.js';
import { classesSortedByOrder, getSubjectsForClass, getCurrentTerm } from '../../services/academicService.js';
import { getRosterFor } from '../../services/attendanceService.js';
import { assessmentRepo, assessmentScoreRepo } from '../../services/assessmentService.js';
import { examinationRepo, examScoreRepo } from '../../services/examService.js';
import { fullName } from '../../services/studentService.js';
import { queueScore, myClasses, getEngine, subscribe, saveDraft, loadDraft, clearDraft, refreshScope, startAutoSync } from '../../offline/offlineService.js';
import { STATUS } from '../../offline/outbox.js';
import { mountSyncPanel, stateBadge } from './syncPanel.js';

// Pure checks (also unit-tested): returns { value, error } for one typed mark.
export function checkMark(raw, max) {
  const t = String(raw ?? '').trim();
  if (t === '') return { value: null, error: '' };
  if (!/^\d+(\.\d+)?$/.test(t)) return { value: null, error: 'Enter a number' };
  const n = Number(t);
  if (n > max) return { value: n, error: `Must be 0–${max}` };
  return { value: n, error: '' };
}

export async function renderMobileMarks(container) {
  await refreshScope().catch(() => {});
  startAutoSync();
  const { scope, classes } = await myClasses(classesSortedByOrder());
  if (!classes.length) { container.innerHTML = `<div class="notice"><span>${scope.linked ? 'No classes are assigned to you yet. Ask the administrator to allocate your classes.' : 'Your account is not linked to a staff record. Ask the administrator to add you under Staff with this same email address.'}</span></div>`; return; }
  const st = { type: 'assessment', classId: classes[0].id, targetId: '', subjectId: '', roster: [], baseline: {}, values: {}, ops: [], restored: null, flash: '' };
  let saveTimer;

  const targets = () => (st.type === 'assessment' ? assessmentRepo.getAll().filter((a) => a.classId === st.classId) : examinationRepo.getAll());
  const target = () => targets().find((t) => t.id === st.targetId);
  const max = () => (st.type === 'assessment' ? Number(target()?.maxScore) || 100 : 100);
  const draftKey = () => `marks|${st.type}|${st.targetId}|${st.classId}|${st.subjectId}`;
  const kind = () => (st.type === 'assessment' ? 'assessmentScore' : 'examScore');
  const ids = (studentId) => (st.type === 'assessment' ? { assessmentId: st.targetId, studentId } : { examinationId: st.targetId, subjectId: st.subjectId, studentId });
  const opKey = (studentId) => (st.type === 'assessment' ? `assess|${st.targetId}|${studentId}` : `exam|${st.targetId}|${st.subjectId}|${studentId}`);

  async function load() {
    st.roster = st.targetId ? getRosterFor(st.classId).map((s) => ({ id: s.id, name: fullName(s), adm: s.admissionNumber })) : [];
    const rows = st.type === 'assessment' ? assessmentScoreRepo.getAll().filter((r) => r.assessmentId === st.targetId) : examScoreRepo.getAll().filter((r) => r.examinationId === st.targetId && r.subjectId === st.subjectId);
    st.baseline = Object.fromEntries(rows.map((r) => [r.studentId, { score: r.score ?? null, version: r.version ?? 1 }]));
    st.values = Object.fromEntries(st.roster.map((s) => [s.id, st.baseline[s.id]?.score == null ? '' : String(st.baseline[s.id].score)]));
    // queued-but-unsynced marks show as the current value
    st.ops = (await getEngine().list()).filter((o) => o.kind === kind() && st.roster.some((s) => opKey(s.id) === o.key));
    st.ops.filter((o) => o.status !== STATUS.synced).forEach((o) => { st.values[o.payload.studentId] = o.payload.score == null ? '' : String(o.payload.score); });
    // an unsubmitted draft from a previous session wins over both
    st.restored = null;
    if (st.targetId) {
      const d = await loadDraft(draftKey());
      if (d) { Object.assign(st.values, d.value.values); st.restored = d.savedAt; }
    }
    draw();
  }
  const errors = () => st.roster.map((s) => ({ s, ...checkMark(st.values[s.id], max()) })).filter((r) => r.error);
  const changed = () => st.roster.filter((s) => { const v = checkMark(st.values[s.id], max()).value; return v !== (st.baseline[s.id]?.score ?? null); });

  function draw() {
    const subjects = getSubjectsForClass(st.classId);
    const errs = errors(); const ch = changed(); const blanks = st.roster.filter((s) => String(st.values[s.id] ?? '').trim() === '').length;
    const opOf = (id) => st.ops.find((o) => o.key === opKey(id) && o.status !== STATUS.synced);
    container.innerHTML = `<div class="space-y-3" style="max-width:34rem;margin-inline:auto;">
      <div id="mk-sync"></div>
      <div class="grid grid-2 gap-2">
        <select class="input" id="mk-type" aria-label="Type"><option value="assessment" ${st.type === 'assessment' ? 'selected' : ''}>Assessment / CAT</option><option value="exam" ${st.type === 'exam' ? 'selected' : ''}>Examination</option></select>
        <select class="input" id="mk-class" aria-label="Class">${classes.map((c) => `<option value="${c.id}" ${c.id === st.classId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
        <select class="input" id="mk-target" aria-label="${st.type === 'assessment' ? 'Assessment' : 'Examination'}" ${st.type === 'exam' ? '' : 'style="grid-column:span 2;"'}><option value="">Choose…</option>${targets().map((t) => `<option value="${t.id}" ${t.id === st.targetId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}</select>
        ${st.type === 'exam' ? `<select class="input" id="mk-subject" aria-label="Subject"><option value="">Subject…</option>${subjects.map((s) => `<option value="${s.id}" ${s.id === st.subjectId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select>` : ''}
      </div>
      ${st.flash ? `<div class="notice" role="status"><span>${escapeHtml(st.flash)}</span></div>` : ''}
      ${st.restored ? `<div class="notice"><span>Restored your unsubmitted marks from ${escapeHtml(new Date(st.restored).toLocaleString())}. <button class="btn-ghost btn-sm" id="mk-discard">Discard draft</button></span></div>` : ''}
      ${st.targetId && (st.type === 'assessment' || st.subjectId) ? `
        <p class="text-sm text-ink-600">Out of <strong>${max()}</strong> · ${st.roster.length - blanks}/${st.roster.length} entered · ${ch.length} change(s) to submit · <span id="mk-saved" class="text-ink-500">Draft saved on this phone</span></p>
        ${st.roster.map((s) => { const r = checkMark(st.values[s.id], max()); const op = opOf(s.id); return `<div class="card card-p" data-stu="${s.id}" style="padding:.6rem .75rem;"><div class="flex justify-between items-center gap-2"><div><strong>${escapeHtml(s.name)}</strong><div class="text-xs text-ink-500">${escapeHtml(s.adm ?? '')}</div></div>${op ? stateBadge(op.status) : ''}</div>
            <input class="input" inputmode="decimal" autocomplete="off" data-mark value="${escapeHtml(st.values[s.id] ?? '')}" aria-label="Mark for ${escapeHtml(s.name)}" aria-invalid="${r.error ? 'true' : 'false'}" style="min-height:44px;font-size:1.05rem;margin-top:.4rem;" />${r.error ? `<p class="field-error" role="alert" style="margin:.2rem 0 0;">${escapeHtml(r.error)}</p>` : ''}</div>`; }).join('')}
        <button class="btn-primary w-full" id="mk-submit" style="min-height:48px;" ${errs.length || !ch.length ? 'disabled' : ''}>${errs.length ? `Fix ${errs.length} mark(s) first` : ch.length ? `Submit ${ch.length} mark(s)` : 'Nothing new to submit'}</button>` : '<p class="text-sm text-ink-500">Choose what you are marking.</p>'}
    </div>`;
    mountSyncPanel(qs(container, '#mk-sync'), (o) => `${st.roster.find((r) => r.id === o.payload.studentId)?.name ?? 'Learner'} — mark ${o.payload.score ?? 'cleared'}`);
    qs(container, '#mk-type').addEventListener('change', (e) => { st.type = e.target.value; st.targetId = ''; st.subjectId = ''; load(); });
    qs(container, '#mk-class').addEventListener('change', (e) => { st.classId = e.target.value; st.targetId = ''; st.subjectId = ''; load(); });
    qs(container, '#mk-target').addEventListener('change', (e) => { st.targetId = e.target.value; load(); });
    qs(container, '#mk-subject')?.addEventListener('change', (e) => { st.subjectId = e.target.value; load(); });
    qs(container, '#mk-discard')?.addEventListener('click', async () => { await clearDraft(draftKey()); st.flash = 'Draft discarded.'; load(); });
    on(container, '[data-mark]', 'input', (e) => {
      const id = e.currentTarget.closest('[data-stu]').dataset.stu; st.values[id] = e.currentTarget.value;
      const input = e.currentTarget; const r = checkMark(input.value, max()); input.setAttribute('aria-invalid', r.error ? 'true' : 'false');
      // show or clear the message right away, without redrawing (which would steal focus mid-typing)
      let msg = input.parentElement.querySelector('.field-error');
      if (r.error) { if (!msg) { msg = document.createElement('p'); msg.className = 'field-error'; msg.setAttribute('role', 'alert'); msg.style.margin = '.2rem 0 0'; input.after(msg); } msg.textContent = r.error; } else msg?.remove();
      refreshButton();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => { await saveDraft(draftKey(), { values: st.values }); const el = qs(container, '#mk-saved'); if (el) el.textContent = `Draft saved ${new Date().toLocaleTimeString()}`; refreshButton(); }, 300);
    });
    on(container, '[data-mark]', 'change', () => draw());
    qs(container, '#mk-submit')?.addEventListener('click', submit);
  }
  function refreshButton() { const b = qs(container, '#mk-submit'); if (!b) return; const e = errors().length, c = changed().length; b.disabled = Boolean(e) || !c; b.textContent = e ? `Fix ${e} mark(s) first` : c ? `Submit ${c} mark(s)` : 'Nothing new to submit'; }

  async function submit() {
    if (errors().length) return;
    const blanks = st.roster.filter((s) => String(st.values[s.id] ?? '').trim() === '').length;
    if (blanks && !confirm(`${blanks} learner(s) have no mark yet. Submit the others anyway?`)) return;
    // Take a snapshot FIRST: queuing a mark triggers screen refreshes that reload values, and must not
    // be able to change what is being submitted half-way through.
    st.submitting = true;
    const batch = changed().map((s) => ({ id: s.id, score: checkMark(st.values[s.id], max()).value, baseVersion: st.baseline[s.id]?.version ?? 0 }));
    const info = { kind: kind(), classId: st.classId, draft: draftKey(), idsOf: ids };
    try {
      for (const m of batch) await queueScore({ kind: info.kind, ids: info.idsOf(m.id), classId: info.classId, score: m.score, baseVersion: m.baseVersion });
      await clearDraft(info.draft);
    } finally { st.submitting = false; }
    st.flash = `${batch.length} mark(s) saved on this phone and queued to sync.`;
    await getEngine().sync(); await load();
  }
  // When a sync finishes, re-read the stored marks so badges and "changes to submit" are accurate.
  // Never redraw while someone is typing; their keystrokes are already saved as a draft.
  const off = subscribe(async () => {
    if (!container.isConnected) return off();
    if (!st.targetId || st.submitting || document.activeElement?.matches?.('[data-mark]')) return;
    await load();
  });
  load();
}
