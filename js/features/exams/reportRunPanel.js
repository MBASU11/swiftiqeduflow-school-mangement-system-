// The approval panel shown above a class's report cards: where the report is, what blocks it, and what you can do next.
// All rules come from the academic engine via reportRunService. Demo mode only (cloud has no run table yet).
import { escapeHtml, on } from '../../components/dom.js';
import { RUN_STATUS } from '../../services/academicEngine.js';
import { getRun, blockersFor, availableActions, act, policyNow } from '../../services/reportRunService.js';

const STEPS = ['draft', 'in_moderation', 'approved', 'published'];
const when = (iso) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : '');

export function runPanelHtml(examinationId, classId) {
  if (!classId) return '';
  const run = getRun(examinationId, classId); const policy = policyNow();
  const idx = STEPS.indexOf(run.status);
  const blockers = run.status === 'draft' ? blockersFor(examinationId, classId) : [];
  const actions = availableActions(examinationId, classId);
  return `<section class="card card-p space-y-3" id="run-panel">
    <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-sm" style="font-weight:600;">Report approval</h3><span class="text-sm" style="font-weight:600;">${escapeHtml(RUN_STATUS[run.status])}</span></div>
    <div class="flex flex-wrap gap-2 text-xs">${STEPS.map((s, i) => `<span style="padding:.15rem .5rem;border-radius:999px;border:1px solid var(--ink-100);${i <= idx ? 'background:var(--ink-900,#1b2430);color:#fff;' : ''}">${i + 1}. ${escapeHtml(RUN_STATUS[s])}</span>`).join('')}</div>
    ${run.status === 'draft' ? `<p class="text-xs text-ink-500">Marks and comments can still change. Submitting locks them.</p>` : `<p class="text-xs text-ink-500">🔒 Marks and subject comments are locked${run.status === 'published' ? ' and the principal\'s comment too' : ''}.</p>`}
    ${blockers.length ? `<div><p class="text-xs" style="font-weight:600;">Before this can be submitted:</p>${blockers.map((b) => `<p class="text-sm" style="color:var(--bad);">⚠ ${escapeHtml(b)}</p>`).join('')}</div>` : ''}
    ${run.approvedBy ? `<p class="text-xs text-ink-500">Approved by ${escapeHtml(run.approvedBy)} on ${escapeHtml(when(run.approvedAt))}. Their name prints on the report card.</p>` : ''}
    <div class="flex flex-wrap gap-2">${actions.map((a) => `<button class="${a.action === 'submit' || a.action === 'approve' || a.action === 'publish' ? 'btn-primary' : 'btn-secondary'} btn-sm" data-run="${a.action}" data-note="${a.needsNote ? 1 : 0}" ${a.ok ? '' : 'disabled'} title="${escapeHtml(a.reason)}">${escapeHtml(a.label)}</button>`).join('')}</div>
    ${actions.filter((a) => !a.ok && a.reason).map((a) => `<p class="text-xs text-warn">${escapeHtml(a.label)}: ${escapeHtml(a.reason)}</p>`).join('')}
    ${policy.enforceWorkflow ? '' : '<p class="text-xs text-ink-400">Sharing is not tied to approval (changeable in Report settings).</p>'}
    ${(run.history ?? []).length ? `<details><summary class="text-xs text-ink-500" style="cursor:pointer;">History (${run.history.length})</summary>${[...run.history].reverse().map((h) => `<p class="text-xs text-ink-600">${escapeHtml(when(h.at))} · ${escapeHtml(h.by)} · ${escapeHtml(h.label)}${h.note ? ` — ${escapeHtml(h.note)}` : ''}</p>`).join('')}</details>` : ''}
  </section>`;
}

export function wireRunPanel(container, examinationId, classId, onChange) {
  on(container, '[data-run]', 'click', (e) => {
    const b = e.currentTarget; const action = b.dataset.run; let note = '';
    if (b.dataset.note === '1') { note = prompt('Reason (required):') ?? ''; if (!note.trim()) return; }
    else if (action === 'publish' && !confirm('Publish this class\'s report cards? Parents can then be sent their links.')) return;
    try { act(examinationId, classId, action, note); onChange(''); } catch (error) { onChange(error.message); }
  });
}
