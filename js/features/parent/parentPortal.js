import { escapeHtml, on, qs } from '../../components/dom.js';
import { fetchParentPortal } from '../../services/supabaseParentService.js';
import { buildDemoPortal } from '../../services/demoPortalService.js';
import { sectionsHtml } from '../public/legalPages.js';
import { handIn, checkFor } from '../../services/handInService.js';
import { LocalStorageRepository } from '../../storage/Repository.js';
import { reportCardPageHtml, REPORT_CARD_CSS, ensureReportCardStyles } from '../../components/reportCardDocument.js';
import { timetableGridHtml, printableTimetable, ensureTimetableStyles, TIMETABLE_CSS } from '../../components/timetableGrid.js';
import { printHtml } from '../../components/printWindow.js';

const money = (currency, n) => `${currency} ${Math.round(Number(n) || 0).toLocaleString()}`;

// Loads the signed-in parent's data, then draws it.
export async function renderParentPortal(rootEl, { onLogout }) {
  rootEl.innerHTML = '<main class="pub-container" style="padding:3rem 1rem;text-align:center;"><p class="text-sm text-ink-500" role="status">Loading…</p></main>';
  try {
    const data = await fetchParentPortal();
    renderParentView(rootEl, data, { onLogout });
  } catch (error) {
    rootEl.innerHTML = `<main class="pub-container" style="padding:3rem 1rem;"><div class="notice" role="alert"><span>${escapeHtml(error.message)}</span><button class="btn-secondary btn-sm" id="pp-retry">Try again</button> <button class="btn-ghost text-sm" id="pp-logout">Log out</button></div></main>`;
    qs(rootEl, '#pp-retry').addEventListener('click', () => renderParentPortal(rootEl, { onLogout }));
    qs(rootEl, '#pp-logout').addEventListener('click', onLogout);
  }
}

// Pure view: everything it shows comes from `data`.
export function renderParentView(rootEl, data, { onLogout, audience = data.audience ?? 'parent', onHandIn = null, onDeleteHandIn = null, notice = '' }) {
  const learner = audience === 'learner';
  ensureReportCardStyles();
  ensureTimetableStyles();
  const state = { childId: data.children[0]?.id ?? '', openCard: '', handIn: '', errors: [], draftText: '', busy: false };
  const currency = data.school.currency || 'KES';

  function draw() {
    const child = data.children.find((c) => c.id === state.childId);
    rootEl.innerHTML = `
      <header style="background:#1f3a5f;color:#fff;padding:0.8rem 1rem;display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;">
        <div><p style="font-weight:700;margin:0;">${escapeHtml(data.school.name)}</p><p style="margin:0;font-size:0.8rem;opacity:0.85;">${learner ? 'Learner' : 'Parent'} portal${data.parent.name ? ` · ${escapeHtml(data.parent.name)}` : ''}</p></div>
        <button class="btn-secondary btn-sm" id="pp-logout">Log out</button>
      </header>
      <main style="max-width:56rem;margin:0 auto;padding:1rem;" class="space-y-4">
        ${data.children.length === 0 ? `<div class="card card-p"><p class="text-sm text-ink-600">No children are linked to your account yet. Please contact the school office.</p></div>` : ''}
        ${data.children.length > 1 ? `<div class="pill-group" role="group" aria-label="Choose a child" style="flex-wrap:wrap;">${data.children.map((c) => `<button class="pill ${c.id === state.childId ? 'active' : ''}" data-child="${escapeHtml(c.id)}">${escapeHtml(c.name)}</button>`).join('')}</div>` : ''}
        ${child ? childHtml(child) : ''}
        ${noticesHtml()}
        <section class="card card-p" style="margin-top:1rem;"><details><summary class="text-sm" style="cursor:pointer;font-weight:600;">Privacy notice</summary>
          ${data.school.notice ? `<div class="legal">${sectionsHtml(data.school.notice)}</div>` : '<p class="text-sm text-ink-500">Ask the school for its notice about how it uses children\'s information.</p>'}
          <p class="text-xs text-ink-500">The service that stores the school\'s records is covered by the <a href="#/privacy" target="_blank" rel="noopener">SwiftIQ EduFlow Privacy Notice</a>.</p></details></section>
      </main>`;
    wire(child);
  }

  function childHtml(child) {
    const place = [child.className, child.streamName].filter(Boolean).join(' ');
    const att = child.attendance;
    return `
      <section class="card card-p">
        <h1 class="text-xl" style="font-weight:600;">${escapeHtml(child.name)}</h1>
        <p class="text-sm text-ink-500 mt-1">${escapeHtml([place, child.admissionNumber ? `Adm. ${child.admissionNumber}` : ''].filter(Boolean).join(' · '))}</p>
        ${att && att.total ? `<p class="text-sm mt-2">Attendance, last 30 days: <b>${att.present} of ${att.total} days present (${Math.round((att.present / att.total) * 100)}%)</b></p>` : ''}
      </section>

      <section class="card card-p">
        <h2 class="text-sm text-ink-700 mb-2" style="font-weight:600;">Report cards</h2>
        ${child.reportCards.length === 0 ? '<p class="text-sm text-ink-400">No report cards have been shared yet. You will see them here as soon as the school publishes them.</p>' : child.reportCards.map((card) => {
          const s = card.snapshot ?? {};
          const title = [s.exam?.name, s.exam?.term, s.exam?.year].filter(Boolean).join(' · ') || 'Report card';
          const summary = [s.average != null ? `Average ${s.average}` : '', s.overallGrade ? `Grade ${s.overallGrade}` : '', s.position ? `Position ${s.position} of ${s.classSize}` : ''].filter(Boolean).join(' · ');
          const open = state.openCard === card.id;
          return `<div style="border-top:1px solid var(--ink-100);padding:0.7rem 0;">
            <div class="flex justify-between items-center gap-2 flex-wrap"><div><p class="text-sm" style="font-weight:600;">${escapeHtml(title)}</p><p class="text-xs text-ink-500">${escapeHtml(summary)}</p></div>
            <div class="flex gap-2"><button class="btn-secondary btn-sm" data-open-card="${escapeHtml(card.id)}">${open ? 'Hide' : 'View'}</button><button class="btn-secondary btn-sm" data-print-card="${escapeHtml(card.id)}">Print / Save PDF</button></div></div>
            ${open ? `<div class="overflow-x-auto mt-3" style="background:#eef1f5;padding:0.5rem;">${reportCardPageHtml(s)}</div>` : ''}
          </div>`;
        }).join('')}
      </section>

      ${learner ? '' : `      <section class="card card-p">
        <h2 class="text-sm text-ink-700 mb-2" style="font-weight:600;">Fees</h2>
        <div class="grid grid-2 lg-grid-4 gap-3" style="margin-bottom:0.75rem;">
          <div><p class="text-xs text-ink-500">Billed</p><p style="font-weight:600;">${money(currency, child.fees.billed)}</p></div>
          <div><p class="text-xs text-ink-500">Paid</p><p style="font-weight:600;">${money(currency, child.fees.paid)}</p></div>
          <div><p class="text-xs text-ink-500">Balance</p><p style="font-weight:700;color:${Number(child.fees.balance) > 0 ? 'var(--bad,#b3261e)' : 'var(--good,#2e7d4f)'};">${money(currency, child.fees.balance)}</p></div>
        </div>
        ${child.fees.invoices.length === 0 ? '<p class="text-sm text-ink-400">No invoices yet.</p>' : `<div class="overflow-x-auto"><table class="data-table"><thead><tr><th>Invoice</th><th class="text-right">Amount</th><th class="text-right">Paid</th><th>Due</th></tr></thead><tbody>${child.fees.invoices.map((i) => `<tr><td>${escapeHtml(i.title)}</td><td class="text-right">${money(currency, i.total)}</td><td class="text-right">${money(currency, i.paid)}</td><td>${escapeHtml(i.dueDate ?? '—')}</td></tr>`).join('')}</tbody></table></div>`}
        ${(child.fees.receipts ?? []).length ? `<h4 class="text-xs text-ink-500 mt-3" style="font-weight:600;">Receipts</h4><div class="overflow-x-auto"><table class="data-table"><tbody>${child.fees.receipts.map((r) => `<tr><td>${escapeHtml(r.number ?? '')}</td><td>${escapeHtml(r.date ?? '')}</td><td class="text-right">${money(currency, r.amount)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <p class="text-xs text-ink-400 mt-2">To make a payment or ask about a balance, please contact the school office.</p>
      </section>`}

      ${(child.homework ?? []).length || (child.materials ?? []).length || (child.liveLessons ?? []).length ? `<section class="card card-p space-y-3">
        <h2 class="text-sm text-ink-700" style="font-weight:600;">Learning</h2>
        ${(child.homework ?? []).length ? `<div class="overflow-x-auto"><table class="data-table"><thead><tr><th>Homework</th><th>Due</th><th>Status</th><th>Marks / feedback</th></tr></thead><tbody>${child.homework.map((h) => `<tr><td><strong>${escapeHtml(h.title)}</strong><div class="text-xs text-ink-500">${escapeHtml(h.subject ?? '')}</div></td><td>${escapeHtml(h.dueDate ?? '')}</td><td>${escapeHtml({ pending: 'Not handed in', submitted: 'Handed in', late: 'Handed in late', marked: 'Marked' }[h.state] ?? h.state)}${learner && onHandIn ? (h.canHandIn ? `<div class="flex gap-2" style="margin-top:.25rem;"><button class="btn-secondary btn-sm" data-handin="${escapeHtml(h.id)}">${h.answer || h.attachmentName ? 'Change hand-in' : 'Hand in'}</button>${onDeleteHandIn && (h.answer || h.attachmentName) ? `<button class="btn-ghost btn-sm text-bad" data-delete-handin="${escapeHtml(h.id)}">Delete hand-in</button>` : ''}</div>` : h.handInNote && h.state !== 'pending' ? `<div class="text-xs text-ink-400">${escapeHtml(h.handInNote)}</div>` : '') : ''}</td><td class="text-sm">${h.marks != null ? `${escapeHtml(String(h.marks))} ` : ''}${escapeHtml(h.feedback ?? '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${notice ? `<div class="notice" role="status"><span>${escapeHtml(notice)}</span></div>` : ''}
        ${learner && onHandIn && state.handIn ? handInPanel(child.homework.find((x) => x.id === state.handIn)) : ''}
        ${(child.liveLessons ?? []).length ? `<div><h3 class="text-xs text-ink-500" style="font-weight:600;">Upcoming live lessons</h3>${child.liveLessons.map((l) => `<p class="text-sm" style="margin:.2rem 0;">${escapeHtml(l.date)} ${escapeHtml(l.startTime ?? '')} · ${escapeHtml(l.title)}${/^https?:\/\//i.test(l.meetingLink ?? '') ? ` · <a href="${escapeHtml(l.meetingLink)}" target="_blank" rel="noopener noreferrer">Join</a>` : ''}</p>`).join('')}</div>` : ''}
        ${(child.materials ?? []).length ? `<div><h3 class="text-xs text-ink-500" style="font-weight:600;">Learning materials</h3>${child.materials.map((m) => `<p class="text-sm" style="margin:.2rem 0;">${/^https?:\/\//i.test(m.url ?? '') ? `<a href="${escapeHtml(m.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(m.title)}</a>` : `<strong>${escapeHtml(m.title)}</strong>${m.body ? ` — ${escapeHtml(m.body)}` : ''}`}</p>`).join('')}</div>` : ''}
      </section>` : ''}
      <section class="card card-p">
        <div class="flex justify-between items-center mb-2"><h2 class="text-sm text-ink-700" style="font-weight:600;">Class timetable</h2>${child.timetable.length ? '<button class="btn-secondary btn-sm" id="pp-print-timetable">Print</button>' : ''}</div>
        ${child.timetable.length === 0 ? '<p class="text-sm text-ink-400">The timetable has not been published yet.</p>' : `<div class="overflow-x-auto">${timetableHtml(child)}</div>`}
      </section>`;
  }

  const lessons = (child) => child.timetable.map((e, i) => ({ ...e, id: `t${i}` }));
  const describe = (e) => ({ title: e.subject ?? '—', meta: e.room ?? '' });
  const timetableHtml = (child) => timetableGridHtml(lessons(child), { describe });

  function noticesHtml() {
    return `<section class="card card-p"><h2 class="text-sm text-ink-700 mb-2" style="font-weight:600;">Notices from the school</h2>
      ${data.notices.length === 0 ? '<p class="text-sm text-ink-400">No notices right now.</p>' : data.notices.map((n) => `<div style="border-top:1px solid var(--ink-100);padding:0.6rem 0;"><p class="text-sm" style="font-weight:600;">${escapeHtml(n.title)} <span class="text-xs text-ink-400" style="font-weight:400;">${escapeHtml(n.date)}</span></p><p class="text-sm text-ink-600" style="white-space:pre-wrap;">${escapeHtml(n.body)}</p></div>`).join('')}</section>`;
  }

  function handInPanel(h) {
    if (!h) return '';
    return `<section class="card card-p space-y-2" id="handin-panel" style="border:1px solid var(--ink-200,#ccd);">
      <h3 class="text-sm" style="font-weight:600;">${escapeHtml(h.title)} <span class="text-xs text-ink-500">· due ${escapeHtml(h.dueDate ?? '')}${h.late ? ' · this will be recorded as late' : ''}</span></h3>
      ${h.instructions ? `<p class="text-sm text-ink-600" style="white-space:pre-wrap;">${escapeHtml(h.instructions)}</p>` : ''}
      ${state.errors.map((e) => `<p class="field-error" role="alert">${escapeHtml(e)}</p>`).join('')}
      <label class="label" for="hi-text">Your answer</label><textarea class="input" id="hi-text" rows="6" maxlength="5000">${escapeHtml(state.draftText)}</textarea>
      <label class="label" for="hi-file">Attach a file (optional: picture, PDF or text file, up to 300 KB)${h.attachmentName ? `. Currently attached: ${escapeHtml(h.attachmentName)}` : ''}</label><input class="input" id="hi-file" type="file" accept="image/png,image/jpeg,application/pdf,text/plain" />
      ${h.attachmentName ? '<label class="text-sm"><input type="checkbox" id="hi-remove" /> Remove the attached file</label>' : ''}
      <div class="flex gap-2"><button class="btn-primary btn-sm" id="hi-save" ${state.busy ? 'disabled' : ''}>${h.answer || h.attachmentName ? 'Save changes' : 'Hand in'}</button><button class="btn-secondary btn-sm" id="hi-cancel">Cancel</button></div></section>`;
  }
  const readFile = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve({ name: file.name, type: file.type, size: file.size, dataUrl: r.result }); r.onerror = () => reject(new Error('The file could not be read.')); r.readAsDataURL(file); });

  function wire(child) {
    on(rootEl, '[data-handin]', 'click', (e) => { const h = child.homework.find((x) => x.id === e.currentTarget.getAttribute('data-handin')); state.handIn = h.id; state.errors = []; state.draftText = h.answer ?? ''; draw(); rootEl.querySelector('#handin-panel')?.scrollIntoView({ block: 'center' }); });
    on(rootEl, '[data-delete-handin]', 'click', async (e) => {
      const homeworkId = e.currentTarget.getAttribute('data-delete-handin');
      const homework = child.homework.find((item) => item.id === homeworkId);
      if (!homework || !homework.canHandIn || !onDeleteHandIn || !confirm('Permanently delete your hand-in? You can submit again before the deadline.')) return;
      const result = await onDeleteHandIn(homeworkId);
      if (!result?.ok) { state.errors = result?.errors ?? ['The hand-in could not be deleted.']; draw(); }
    });
    qs(rootEl, '#hi-cancel')?.addEventListener('click', () => { state.handIn = ''; state.errors = []; draw(); });
    qs(rootEl, '#hi-save')?.addEventListener('click', async () => {
      state.draftText = qs(rootEl, '#hi-text').value; const file = qs(rootEl, '#hi-file').files[0]; let attachment;
      try { if (file) attachment = await readFile(file); else if (qs(rootEl, '#hi-remove')?.checked) attachment = null; } catch (error) { state.errors = [error.message]; return draw(); }
      state.busy = true; const r = await onHandIn(state.handIn, { text: state.draftText, attachment }); state.busy = false;
      if (!r.ok) { state.errors = r.errors; draw(); }
    });
    qs(rootEl, '#pp-logout').addEventListener('click', onLogout);
    on(rootEl, '[data-child]', 'click', (e) => { state.childId = e.currentTarget.getAttribute('data-child'); state.openCard = ''; draw(); });
    on(rootEl, '[data-open-card]', 'click', (e) => { const id = e.currentTarget.getAttribute('data-open-card'); state.openCard = state.openCard === id ? '' : id; draw(); });
    on(rootEl, '[data-print-card]', 'click', (e) => {
      const card = child.reportCards.find((c) => c.id === e.currentTarget.getAttribute('data-print-card'));
      if (card) printHtml(`${child.name} report card`, reportCardPageHtml(card.snapshot), { css: REPORT_CARD_CSS, margin: '10mm' });
    });
    qs(rootEl, '#pp-print-timetable')?.addEventListener('click', () => {
      printHtml(`${child.name} timetable`, printableTimetable({
        school: { name: data.school.name }, heading: `${child.name} — ${child.className ?? ''} timetable`, subheading: '', gridHtml: timetableHtml(child),
      }), { css: TIMETABLE_CSS, orientation: 'landscape' });
    });
  }

  draw();
}

// Demo mode: a parent or learner who signed in with a username. Same screen as the cloud portal, fed from this browser's school data.
export async function renderDemoPortal(rootEl, account, { onLogout }) {
  const show = async (notice = '') => renderParentView(rootEl, await buildDemoPortal(account), { onLogout, notice, onHandIn: account.role === 'student' ? async (homeworkId, payload) => {
    const r = handIn(account, homeworkId, payload);
    if (r.ok) await show(r.late ? 'Handed in. It was recorded as late.' : 'Handed in. Your teacher can now see it.');
    return r;
  } : null, onDeleteHandIn: account.role === 'student' ? async (homeworkId) => {
    const submissions = new LocalStorageRepository('homeworkSubmissions', 'submission');
    const submission = submissions.getAll().find((item) => item.homeworkId === homeworkId && item.studentId === account.linkedId);
    const homework = new LocalStorageRepository('homework', 'homework').getById(homeworkId);
    const eligibility = checkFor(account, homework ?? {});
    if (!submission || !['submitted', 'late'].includes(submission.status) || !eligibility.ok) {
      return { ok: false, errors: [eligibility.reason || 'Only your own unmarked hand-in can be deleted.'] };
    }
    submissions.remove(submission.id, 'learner deleted hand-in');
    await show('Your hand-in was deleted. You can submit again before the deadline.');
    return { ok: true };
  } : null });
  try { await show(); }
  catch (error) {
    rootEl.innerHTML = `<main class="pub-container" style="padding:3rem 1rem;"><div class="notice" role="alert"><span>${escapeHtml(error.message)}</span><button class="btn-secondary btn-sm" id="pp-logout">Log out</button></div></main>`;
    qs(rootEl, '#pp-logout').addEventListener('click', onLogout);
  }
}
