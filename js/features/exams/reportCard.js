import { escapeHtml, on, qs } from '../../components/dom.js';
import { fullName } from '../../services/studentService.js';
import { emptyState } from '../../components/emptyState.js';
import { printHtml } from '../../components/printWindow.js';
import { ensureReportCardStyles, reportCardPageHtml, reportCardsHtml, REPORT_CARD_CSS } from '../../components/reportCardDocument.js';
import {
  loadReportData, buildClassResults, buildReportModel, saveComments, parentsOf,
  shareMessage, mailtoLink, smsLink, whatsappLink, portalAvailable, shareUrl, publishedFor, isOutOfDate,
  publishReportCard, revokeReportCard, toInternationalPhone,
} from '../../services/reportCardService.js';

import { runPanelHtml, wireRunPanel } from './reportRunPanel.js';
import { shareGate, mergePolicy } from '../../services/academicEngine.js';
import { getRun } from '../../services/reportRunService.js';

export function renderReportCards(container) {
  ensureReportCardStyles();
  const state = { data: null, examinationId: '', classId: '', studentId: '', share: '', error: '', notice: '', busy: false };

  async function render() {
    try {
      state.data ??= await loadReportData();
    } catch (error) {
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span><button class="btn-secondary btn-sm" id="report-cards-retry">Retry</button></div>`;
      qs(container, '#report-cards-retry').addEventListener('click', () => { state.data = null; render(); });
      return;
    }
    const data = state.data;
    if (!data.examinations.length) {
      container.innerHTML = `<div class="card">${emptyState({ title: 'No examinations yet', body: 'Create an examination first, then generate report cards from it.' })}</div>`;
      return;
    }
    if (!data.examinations.some((e) => e.id === state.examinationId)) state.examinationId = data.examinations[0].id;
    const examination = data.examinations.find((e) => e.id === state.examinationId);
    const examClasses = data.classes.filter((c) => (examination.classIds ?? []).includes(c.id));
    if (!examClasses.some((c) => c.id === state.classId)) { state.classId = examClasses[0]?.id ?? ''; state.studentId = ''; }

    const results = state.classId ? buildClassResults(data, state.examinationId, state.classId) : null;
    const roster = results?.roster ?? [];
    if (!roster.some((s) => s.id === state.studentId)) state.studentId = roster[0]?.id ?? '';
    const index = roster.findIndex((s) => s.id === state.studentId);
    const model = state.studentId ? buildReportModel(data, state.examinationId, state.classId, state.studentId, results) : null;
    const hasGrading = Boolean(results?.gradingSystem);
    const gate = portalAvailable() || !state.classId ? { ok: true } : shareGate(getRun(state.examinationId, state.classId), mergePolicy(data.reportPolicy));

    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="label">Examination</label>
            <select class="input" id="exam-select" style="min-width:14rem">
              ${data.examinations.map((e) => `<option value="${e.id}" ${state.examinationId === e.id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="label">Class</label>
            <select class="input" id="class-select" style="min-width:10rem" ${examClasses.length === 0 ? 'disabled' : ''}>
              ${examClasses.length === 0 ? '<option>No classes</option>' : examClasses.map((c) => `<option value="${c.id}" ${state.classId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="label">Student</label>
            <div class="flex gap-1">
              <button class="btn-secondary btn-sm" id="prev-student" aria-label="Previous student" ${index <= 0 ? 'disabled' : ''}>‹</button>
              <select class="input" id="student-select" style="min-width:12rem" ${roster.length === 0 ? 'disabled' : ''}>
                ${roster.length === 0 ? '<option>No students</option>' : roster.map((s) => `<option value="${s.id}" ${state.studentId === s.id ? 'selected' : ''}>${escapeHtml(fullName(s))}</option>`).join('')}
              </select>
              <button class="btn-secondary btn-sm" id="next-student" aria-label="Next student" ${index < 0 || index >= roster.length - 1 ? 'disabled' : ''}>›</button>
            </div>
          </div>
          <div class="flex gap-2 flex-wrap" style="margin-left:auto">
            <button class="btn-secondary" id="print-btn" ${model ? '' : 'disabled'}>Print / Save PDF</button>
            <button class="btn-secondary" id="print-class-btn" ${roster.length ? '' : 'disabled'}>Print whole class (${roster.length})</button>
            <button class="btn-primary" id="share-btn" ${model && gate.ok ? '' : 'disabled'} title="${escapeHtml(gate.ok ? '' : gate.reason)}">Share with parent</button>
          </div>
        </div>

        ${portalAvailable() ? '' : runPanelHtml(state.examinationId, state.classId)}
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        ${gate.ok ? '' : `<p class="text-sm text-warn">${escapeHtml(gate.reason)}</p>`}
        ${state.notice ? `<div class="notice"><span>${escapeHtml(state.notice)}</span></div>` : ''}
        ${model && !hasGrading ? `<p class="text-sm text-warn">No grading system is set up yet, so grades won't show — only raw scores. Set one up under Grading.</p>` : ''}

        ${gate.ok && state.share === 'student' && model ? sharePanelHtml(data, model) : ''}
        ${gate.ok && state.share === 'class' ? classSharePanelHtml(data, results) : ''}

        ${
          model
            ? `<div class="card card-p overflow-x-auto" style="background:#eef1f5"><div id="printable-report">${reportCardPageHtml(model)}</div></div>
               <div class="card card-p space-y-3">
                 <div class="grid sm-grid-2 gap-4">
                   <div><label class="label">Class teacher's comment</label><textarea class="input" id="teacher-comment" rows="3">${escapeHtml(model.comments.teacher)}</textarea></div>
                   <div><label class="label">Principal's comment</label><textarea class="input" id="principal-comment" rows="3">${escapeHtml(model.comments.principal)}</textarea></div>
                 </div>
                 <div><button class="btn-secondary" id="save-comments-btn">Save comments</button> <span id="comment-saved" class="text-sm text-good" style="display:none;margin-left:0.5rem;">Saved.</span></div>
               </div>`
            : `<div class="card">${emptyState({ title: 'Nothing to show yet', body: 'Choose an examination, class and student above.' })}</div>`
        }
      </div>`;

    wire({ data, results, roster, index, model });
  }

  // ---- Share panels -------------------------------------------------------

  function contactButtons(parent, model, link) {
    const buttons = [];
    if (parent.email) buttons.push(`<a class="btn-secondary btn-sm" href="${escapeHtml(mailtoLink(parent.email, model, link))}">Email</a>`);
    if (parent.phone) {
      buttons.push(`<a class="btn-secondary btn-sm" href="${escapeHtml(smsLink(parent.phone, model, link))}">SMS</a>`);
      buttons.push(`<a class="btn-secondary btn-sm" target="_blank" rel="noopener" href="${escapeHtml(whatsappLink(parent.phone, model, link))}">WhatsApp</a>`);
    }
    return buttons.join(' ') || '<span class="text-xs text-ink-400">No phone or email on file</span>';
  }

  function shareTabs() {
    return `<div class="pill-group" role="group" aria-label="Share scope">
      <button class="pill ${state.share === 'student' ? 'active' : ''}" data-share-tab="student">This student</button>
      <button class="pill ${state.share === 'class' ? 'active' : ''}" data-share-tab="class">Whole class</button>
    </div>`;
  }

  function sharePanelHtml(data, model) {
    const student = data.students.find((s) => s.id === state.studentId);
    const parents = parentsOf(data, student);
    const published = publishedFor(data, state.examinationId, state.studentId);
    const link = published ? shareUrl(published.token) : '';
    const stale = isOutOfDate(published, model);
    return `
      <div class="card card-p space-y-4">
        <div class="flex justify-between items-center">
          <div class="flex items-center gap-3 flex-wrap"><h3 class="text-sm text-ink-700" style="font-weight:600;">Share ${escapeHtml(model.student.name)}'s report card</h3>${shareTabs()}</div>
          <button class="btn-ghost text-sm" id="close-share">Close</button>
        </div>

        <div>
          <p class="text-xs text-ink-500 mb-1.5">Parent portal link</p>
          ${
            !portalAvailable()
              ? `<p class="text-sm text-ink-500">Secure parent links need the Supabase backend (see <code>supabase/README.md</code>). Until then, use <b>Print / Save PDF</b> and send the file, or send the summary message below.</p>`
              : published
              ? `<div class="flex flex-wrap items-center gap-2">
                   <input class="input" id="share-link" readonly value="${escapeHtml(link)}" style="flex:1;min-width:16rem" />
                   <button class="btn-secondary btn-sm" id="copy-link">Copy link</button>
                   ${stale ? `<button class="btn-primary btn-sm" id="update-link" ${state.busy ? 'disabled' : ''}>Update shared copy</button>` : ''}
                   <button class="btn-secondary btn-sm text-bad" id="revoke-link">Stop sharing</button>
                 </div>
                 <p class="text-xs ${stale ? 'text-warn' : 'text-ink-400'} mt-1">${stale ? 'Marks or comments changed after this was shared — update the shared copy so the parent sees the latest.' : 'Anyone with this link can view this one report card, so send it only to the parent.'}</p>`
              : `<button class="btn-primary btn-sm" id="create-link" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Creating…' : 'Create secure link'}</button>
                 <p class="text-xs text-ink-400 mt-1">Creates a private link the parent can open on any phone to view and print the report card.</p>`
          }
        </div>

        <div>
          <p class="text-xs text-ink-500 mb-1.5">Send to parent / guardian</p>
          ${
            parents.length === 0
              ? `<p class="text-sm text-ink-400">No parent is linked to this student. Link one from the student's profile to send by SMS, WhatsApp or email.</p>`
              : parents.map((p) => `<div class="flex flex-wrap items-center justify-between gap-2" style="padding:0.4rem 0;border-bottom:1px solid var(--ink-50);">
                  <div><p class="text-sm" style="font-weight:500;">${escapeHtml(p.name)}</p><p class="text-xs text-ink-500">${escapeHtml([p.phone, p.email].filter(Boolean).join(' · ') || 'No contact on file')}</p></div>
                  <div class="flex gap-2">${contactButtons(p, model, link)}</div>
                </div>`).join('')
          }
          ${portalAvailable() && !published && parents.length ? `<p class="text-xs text-warn mt-2">Create the secure link first so the message includes it.</p>` : ''}
          <details class="mt-3"><summary class="text-xs text-ink-500" style="cursor:pointer">Message preview</summary>
            <p class="text-sm text-ink-600 mt-2" style="white-space:pre-wrap">${escapeHtml(shareMessage(model, link))}</p>
          </details>
          <p class="text-xs text-ink-400 mt-2">Email, SMS and WhatsApp open on your device with the message ready to send — they are not sent automatically by the system.</p>
        </div>
      </div>`;
  }

  function classSharePanelHtml(data, results) {
    if (!results) return '';
    const rows = results.roster.map((student) => {
      const model = buildReportModel(data, state.examinationId, state.classId, student.id, results);
      const published = publishedFor(data, state.examinationId, student.id);
      const link = published ? shareUrl(published.token) : '';
      const parent = parentsOf(data, student)[0];
      return { student, model, published, link, parent };
    });
    const missing = rows.filter((r) => !r.published || isOutOfDate(r.published, r.model)).length;
    return `
      <div class="card card-p space-y-3">
        <div class="flex justify-between items-center flex-wrap gap-2">
          <div class="flex items-center gap-3 flex-wrap"><h3 class="text-sm text-ink-700" style="font-weight:600;">Share the whole class</h3>${shareTabs()}</div>
          <div class="flex gap-2">
            ${portalAvailable() ? `<button class="btn-primary btn-sm" id="publish-all" ${state.busy || !missing ? 'disabled' : ''}>${state.busy ? 'Working…' : missing ? `Create / update ${missing} link${missing === 1 ? '' : 's'}` : 'All links up to date'}</button>` : ''}
            <button class="btn-ghost text-sm" id="close-share">Close</button>
          </div>
        </div>
        ${portalAvailable() ? '' : `<p class="text-sm text-ink-500">Secure links need the Supabase backend. The buttons below send a short results summary instead.</p>`}
        <div class="overflow-x-auto"><table class="data-table">
          <thead><tr><th>Student</th><th>Parent</th><th>Link</th><th>Send</th></tr></thead>
          <tbody>
            ${rows.map((r) => `<tr>
              <td>${escapeHtml(r.model.student.name)}</td>
              <td>${r.parent ? `${escapeHtml(r.parent.name)}<br><span class="text-xs text-ink-500">${escapeHtml([r.parent.phone, r.parent.email].filter(Boolean).join(' · ') || 'No contact')}</span>` : '<span class="text-ink-400">None linked</span>'}</td>
              <td>${r.published ? (isOutOfDate(r.published, r.model) ? '<span class="text-warn text-xs">Out of date</span>' : '<span class="text-good text-xs">Ready</span>') : '<span class="text-ink-400 text-xs">—</span>'}</td>
              <td><div class="flex gap-2 flex-wrap">${r.parent ? contactButtons(r.parent, r.model, r.link) : ''}</div></td>
            </tr>`).join('')}
          </tbody>
        </table></div>
        <p class="text-xs text-ink-400">Each button opens your phone or email app with that parent's message ready to send.</p>
      </div>`;
  }

  // ---- Wiring -------------------------------------------------------------

  function wire({ data, results, roster, index, model }) {
    if (!portalAvailable()) wireRunPanel(container, state.examinationId, state.classId, (err) => { state.error = err; state.notice = ''; state.data = null; render(); });
    qs(container, '#exam-select').addEventListener('change', (e) => { state.examinationId = e.target.value; state.classId = ''; state.studentId = ''; state.share = ''; state.notice = ''; render(); });
    qs(container, '#class-select').addEventListener('change', (e) => { state.classId = e.target.value; state.studentId = ''; state.notice = ''; render(); });
    qs(container, '#student-select').addEventListener('change', (e) => { state.studentId = e.target.value; state.notice = ''; render(); });
    qs(container, '#prev-student').addEventListener('click', () => { if (index > 0) { state.studentId = roster[index - 1].id; render(); } });
    qs(container, '#next-student').addEventListener('click', () => { if (index >= 0 && index < roster.length - 1) { state.studentId = roster[index + 1].id; render(); } });

    qs(container, '#print-btn').addEventListener('click', () => {
      printHtml(`${model.student.name} – report card`, reportCardPageHtml(model), { css: REPORT_CARD_CSS, margin: '10mm' });
    });
    qs(container, '#print-class-btn').addEventListener('click', () => {
      const models = roster.map((s) => buildReportModel(data, state.examinationId, state.classId, s.id, results));
      printHtml(`${model?.student.className ?? 'Class'} report cards`, reportCardsHtml(models), { css: REPORT_CARD_CSS, margin: '10mm' });
    });

    qs(container, '#share-btn').addEventListener('click', () => { state.share = state.share === 'student' ? '' : 'student'; state.notice = ''; render(); });
    on(container, '#close-share', 'click', () => { state.share = ''; render(); });
    on(container, '[data-share-tab]', 'click', (e) => { state.share = e.currentTarget.getAttribute('data-share-tab'); state.notice = ''; render(); });

    qs(container, '#copy-link')?.addEventListener('click', async () => {
      const value = qs(container, '#share-link').value;
      try { await navigator.clipboard.writeText(value); state.notice = 'Link copied.'; } catch { qs(container, '#share-link').select(); state.notice = 'Press Ctrl/⌘+C to copy the selected link.'; }
      await render();
    });

    const publish = async (studentIds) => {
      state.busy = true; state.error = ''; state.notice = '';
      await render();
      try {
        for (const id of studentIds) {
          const m = buildReportModel(data, state.examinationId, state.classId, id, results);
          await publishReportCard(state.examinationId, id, m);
        }
        state.notice = studentIds.length > 1 ? `${studentIds.length} links are ready.` : 'Link is ready.';
      } catch (error) {
        state.error = error.message;
      }
      state.busy = false;
      state.data = null;
      await render();
    };
    qs(container, '#create-link')?.addEventListener('click', () => publish([state.studentId]));
    qs(container, '#update-link')?.addEventListener('click', () => publish([state.studentId]));
    qs(container, '#publish-all')?.addEventListener('click', () => {
      const ids = roster.filter((s) => {
        const published = publishedFor(data, state.examinationId, s.id);
        return !published || isOutOfDate(published, buildReportModel(data, state.examinationId, state.classId, s.id, results));
      }).map((s) => s.id);
      publish(ids);
    });
    qs(container, '#revoke-link')?.addEventListener('click', async () => {
      if (!confirm('Stop sharing? The parent’s link will stop working.')) return;
      try { await revokeReportCard(state.examinationId, state.studentId); state.notice = 'Sharing stopped.'; state.error = ''; } catch (error) { state.error = error.message; }
      state.data = null;
      await render();
    });

    qs(container, '#save-comments-btn')?.addEventListener('click', async () => {
      try {
        await saveComments(state.examinationId, state.studentId, {
          teacherComment: qs(container, '#teacher-comment').value,
          principalComment: qs(container, '#principal-comment').value,
        });
        state.data = null;
        state.error = '';
        state.notice = 'Comments saved.';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
  }

  render();
}
