// The principal's view at the top of the administrator's dashboard (demo mode): what needs a decision, then how the school is doing.
import { escapeHtml, on } from '../../components/dom.js';
import { RUN_STATUS } from '../../services/academicEngine.js';
import { principalSnapshot } from '../../services/principalService.js';

const money = (c, n) => `${c} ${Math.round(Number(n) || 0).toLocaleString()}`;
const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
const bar = (v, good = 85, warn = 70) => `<div style="height:.45rem;background:var(--ink-100);border-radius:999px;overflow:hidden;"><div style="width:${Math.max(0, Math.min(100, v ?? 0))}%;height:100%;background:${v >= good ? 'var(--good,#2e7d4f)' : v >= warn ? '#b7791f' : 'var(--bad,#b3261e)'};"></div></div>`;
const stat = (label, value, sub = '') => `<div class="card card-p"><p class="text-xs text-ink-500">${escapeHtml(label)}</p><p class="text-xl mt-1" style="font-weight:600;font-family:var(--font-display);">${escapeHtml(value)}</p>${sub ? `<p class="text-xs text-ink-400 mt-1">${escapeHtml(sub)}</p>` : ''}</div>`;

export function renderPrincipalDashboard(container) {
  container.innerHTML = '<section class="card card-p"><p class="text-sm text-ink-500" role="status">Loading the principal\'s view…</p></section>';
  principalSnapshot().then((s) => {
    const att = s.attendanceByClass.slice(0, 6); const c = s.currency;
    container.innerHTML = `<div class="space-y-4">
      <section class="card card-p">
        <h2 class="text-sm text-ink-700 mb-2" style="font-weight:600;">Needs your attention</h2>
        ${s.attention.length ? s.attention.map((a) => `<button data-go="${escapeHtml(a.path)}" style="display:flex;gap:.6rem;align-items:flex-start;width:100%;text-align:left;background:none;border:none;border-top:1px solid var(--ink-100);padding:.6rem 0;cursor:pointer;font-family:inherit;"><span aria-hidden="true">${a.level === 'act' ? '🔴' : '🟡'}</span><span class="text-sm">${escapeHtml(a.text)}</span></button>`).join('') : '<p class="text-sm" style="color:var(--good,#2e7d4f);">Nothing is waiting on you right now.</p>'}
      </section>
      <div class="grid grid-2 lg-grid-4 gap-3">
        ${stat('Learners', String(s.students))}${stat("Today's attendance", pct(s.attendanceToday), s.attendanceToday === null ? 'Not recorded yet' : '')}
        ${s.participation ? stat('In activities', `${s.participation.pct}%`, `${s.participation.taking} of ${s.participation.total} learners in a club, sport or society`) : ''}${stat('Fees collected (30 days)', money(c, s.collected30d), s.collectionRate === null ? '' : `${s.collectionRate}% of billed fees collected`)}${stat('Fees outstanding', money(c, s.outstanding))}
      </div>
      ${s.board.length ? `<section class="card card-p"><h2 class="text-sm text-ink-700 mb-2" style="font-weight:600;">Report cards: ${escapeHtml(s.exam.name)}</h2>${s.board.map((b) => `<div class="flex justify-between text-sm" style="border-top:1px solid var(--ink-100);padding:.4rem 0;"><span>${escapeHtml(b.className)}</span><span style="font-weight:${b.status === 'published' ? 400 : 600};">${escapeHtml(RUN_STATUS[b.status])}</span></div>`).join('')}<button class="btn-secondary btn-sm mt-2" data-go="#/exams">Open report cards</button></section>` : ''}
      ${att.length ? `<section class="card card-p"><h2 class="text-sm text-ink-700 mb-2" style="font-weight:600;">Attendance by class, last 30 days (lowest first)</h2>${att.map((r) => `<div style="padding:.35rem 0;"><div class="flex justify-between text-sm"><span>${escapeHtml(r.className)}</span><span>${r.averagePercentage}%</span></div>${bar(r.averagePercentage)}</div>`).join('')}</section>` : ''}
      ${s.academics.length ? `<section class="card card-p"><h2 class="text-sm text-ink-700 mb-2" style="font-weight:600;">Performance by class: ${escapeHtml(s.exam.name)} (lowest first)</h2><div class="overflow-x-auto"><table class="data-table"><thead><tr><th>Class</th><th class="text-right">Learners</th><th class="text-right">Mean</th><th class="text-right">Pass rate</th></tr></thead><tbody>${s.academics.map((a) => `<tr><td>${escapeHtml(a.className)}</td><td class="text-right">${a.learners}</td><td class="text-right">${a.mean ?? '—'}</td><td class="text-right">${pct(a.passRate)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
      ${s.topOutstanding.length ? `<section class="card card-p"><h2 class="text-sm text-ink-700 mb-2" style="font-weight:600;">Largest fee balances</h2>${s.topOutstanding.map((r) => `<div class="flex justify-between text-sm" style="border-top:1px solid var(--ink-100);padding:.4rem 0;"><span>${escapeHtml([r.student.firstName, r.student.lastName].filter(Boolean).join(' '))}</span><span style="font-weight:600;">${money(c, r.balance)}</span></div>`).join('')}</section>` : ''}
    </div>`;
    on(container, '[data-go]', 'click', (e) => { window.location.hash = e.currentTarget.getAttribute('data-go').replace(/^#/, ''); });
  }).catch((error) => { container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span></div>`; });
}
