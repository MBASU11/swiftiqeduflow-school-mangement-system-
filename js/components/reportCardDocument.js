import { escapeHtml } from './dom.js';

export const REPORT_CARD_CSS = `
.rc-page{width:100%;max-width:210mm;margin:0 auto;background:#fff;color:#1b2430;padding:11mm 12mm 9mm;border:1px solid #d7dde5;font-family:Inter,"Segoe UI",Roboto,Arial,sans-serif;font-size:10pt;line-height:1.35;position:relative}
.rc-page *{box-sizing:border-box}
.rc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;border-bottom:3px solid #1f3a5f;padding-bottom:9px}
.rc-school-brand{display:flex;align-items:center;gap:10px}
.rc-logo{width:22mm;height:22mm;object-fit:contain}
.rc-letterhead{width:100%;max-height:28mm;object-fit:contain;margin-bottom:6px}
.rc-school{font-family:Georgia,"Times New Roman",serif;font-size:19pt;font-weight:700;color:#1f3a5f;letter-spacing:.2px;line-height:1.1}
.rc-contact{font-size:8.5pt;color:#5b6777;margin-top:3px}
.rc-title{text-align:right}
.rc-title b{display:block;font-size:11.5pt;letter-spacing:.14em;text-transform:uppercase;color:#1f3a5f}
.rc-title span{display:block;font-size:9pt;color:#5b6777;margin-top:2px}
.rc-info{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid #cfd6df;border-top:0;margin-bottom:10px}
.rc-info div{padding:5px 8px;border-right:1px solid #cfd6df}
.rc-info div:last-child{border-right:0}
.rc-info small{display:block;font-size:7pt;letter-spacing:.09em;text-transform:uppercase;color:#7b8794}
.rc-info strong{font-size:10pt}
.rc-table{width:100%;border-collapse:collapse;margin-bottom:9px;font-size:9.5pt}
.rc-table th{background:#1f3a5f;color:#fff;padding:5px 8px;text-align:left;font-size:8.5pt;letter-spacing:.05em;text-transform:uppercase}
.rc-table td{padding:5px 8px;border-bottom:1px solid #e1e6ec}
.rc-table tbody tr:nth-child(even) td{background:#f6f8fb}
.rc-table .num{text-align:right;white-space:nowrap}
.rc-table .grade{text-align:center;font-weight:700;color:#1f3a5f}
.rc-table .muted{color:#7b8794}
.rc-summary{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:10px}
.rc-summary div{border:1px solid #cfd6df;border-radius:5px;padding:6px 8px;background:#f6f8fb;text-align:center}
.rc-summary small{display:block;font-size:7pt;letter-spacing:.09em;text-transform:uppercase;color:#7b8794}
.rc-summary strong{font-size:13pt;color:#1f3a5f}
.rc-comments{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px}
.rc-box{border:1px solid #cfd6df;border-radius:5px;padding:6px 9px;min-height:30mm;display:flex;flex-direction:column}
.rc-box small{display:block;font-size:7pt;letter-spacing:.09em;text-transform:uppercase;color:#7b8794;margin-bottom:3px}
.rc-box p{margin:0;font-size:9.5pt;flex:1;min-height:14mm}
.rc-sign{margin-top:8px;border-top:1px solid #9aa5b3;padding-top:2px;font-size:7.5pt;color:#5b6777}
.rc-draft{border:1.5px dashed #b45309;color:#b45309;font-size:8pt;font-weight:700;letter-spacing:.08em;text-align:center;padding:3px;margin-bottom:6px;text-transform:uppercase}
.rc-approved{margin-top:4px;font-size:7.5pt;color:#1b2430}
.rc-key{font-size:7.5pt;color:#5b6777;border-top:1px dashed #cfd6df;padding-top:6px}
.rc-key b{color:#1b2430}
.rc-key span{display:inline-block;margin:0 10px 2px 0;white-space:nowrap}
.rc-foot{display:flex;justify-content:space-between;font-size:7.5pt;color:#7b8794;margin-top:6px}
@media (max-width:640px){.rc-page{padding:12px}.rc-info{grid-template-columns:repeat(2,1fr)}.rc-summary{grid-template-columns:repeat(2,1fr)}.rc-comments{grid-template-columns:1fr}}
@media print{.rc-page{border:0;max-width:none;width:auto;padding:0;page-break-after:always;break-after:page}.rc-page:last-child{page-break-after:auto;break-after:auto}}
`;

const dash = (value) => (value === null || value === undefined || value === '' ? '—' : escapeHtml(value));

export function reportCardPageHtml(model) {
  const m = model;
  // Exam names often already say "Term 3"; don't repeat it in the header.
  const termText = m.exam.term && !m.exam.name.toLowerCase().includes(m.exam.term.toLowerCase()) ? m.exam.term : '';
  const examLine = [m.exam.name, termText, m.exam.year].filter(Boolean).join(' · ');
  const termLine = [m.exam.term, m.exam.year].filter(Boolean).join(' ');
  const classLine = [m.student.className, m.student.streamName].filter(Boolean).join(' ');
  const contact = [m.school.address, m.school.phone, m.school.email].filter(Boolean).join('  |  ');
  const hasPeers = m.rows.some((r) => r.classAverage !== null);
  const hasRemarks = m.rows.some((r) => r.remark);

  return `
  <section class="rc-page">
    ${m.approval && m.approval.workflowOn && m.approval.status !== 'published' ? `<div class="rc-draft">${m.approval.status === 'approved' ? 'Approved – not yet published' : 'Draft – not yet approved'}</div>` : ''}
    <div class="rc-head">
      <div>
        ${m.school.letterheadUrl ? `<img class="rc-letterhead" src="${escapeHtml(m.school.letterheadUrl)}" alt="" />` : ''}
        <div class="rc-school-brand">
          ${m.school.logoUrl ? `<img class="rc-logo" src="${escapeHtml(m.school.logoUrl)}" alt="School logo" />` : ''}
          <div>
            <div class="rc-school">${escapeHtml(m.school.name)}</div>
            <div class="rc-contact">${escapeHtml(contact)}</div>
          </div>
        </div>
      </div>
      <div class="rc-title"><b>Report Card</b><span>${escapeHtml(examLine)}</span></div>
    </div>
    <div class="rc-info">
      <div><small>Student</small><strong>${escapeHtml(m.student.name)}</strong></div>
      <div><small>Admission No.</small><strong>${dash(m.student.admissionNumber)}</strong></div>
      <div><small>Class</small><strong>${dash(classLine)}</strong></div>
      <div><small>Term</small><strong>${dash(termLine)}</strong></div>
    </div>
    <table class="rc-table">
      <thead><tr><th>Subject</th><th class="num">Score</th><th style="text-align:center">Grade</th>${hasPeers ? '<th class="num">Class avg</th>' : ''}${hasRemarks ? '<th>Remarks</th>' : ''}</tr></thead>
      <tbody>
        ${m.rows.length
          ? m.rows.map((r) => `<tr><td>${escapeHtml(r.subject)}</td><td class="num">${r.score !== null ? escapeHtml(r.score) : '<span class="muted">—</span>'}</td><td class="grade">${dash(r.grade)}</td>${hasPeers ? `<td class="num muted">${dash(r.classAverage)}</td>` : ''}${hasRemarks ? `<td>${escapeHtml(r.remark)}</td>` : ''}</tr>`).join('')
          : `<tr><td colspan="5" class="muted">No subjects are assigned to this grade yet.</td></tr>`}
      </tbody>
    </table>
    <div class="rc-summary">
      <div><small>Total</small><strong>${dash(m.total)}</strong></div>
      <div><small>Average</small><strong>${dash(m.average)}</strong></div>
      <div><small>Overall grade</small><strong>${dash(m.overallGrade)}</strong></div>
      <div><small>Position</small><strong>${m.position ? `${m.position}/${m.classSize}` : '—'}</strong></div>
      <div><small>Attendance</small><strong>${m.attendance ? `${m.attendance.percentage}%` : '—'}</strong></div>
    </div>
    ${m.overallRemark ? `<p style="margin:0 0 8px;font-size:9.5pt"><b>Overall:</b> ${escapeHtml(m.overallRemark)}</p>` : ''}
    ${m.competencies?.length ? `<table class="rc-table"><thead><tr><th>Competencies (CBC)</th><th style="text-align:center">EE</th><th style="text-align:center">ME</th><th style="text-align:center">AE</th><th style="text-align:center">BE</th><th class="num">Reached</th></tr></thead><tbody>${m.competencies.map((c) => `<tr><td>${escapeHtml(c.subject)}</td><td class="grade">${c.counts.exceeding ?? 0}</td><td class="grade">${c.counts.meeting ?? 0}</td><td class="grade">${c.counts.approaching ?? 0}</td><td class="grade">${c.counts.below ?? 0}</td><td class="num">${c.reached} of ${c.total}</td></tr>`).join('')}</tbody></table><p class="rc-key"><span><b>EE</b> Exceeding expectation</span><span><b>ME</b> Meeting expectation</span><span><b>AE</b> Approaching expectation</span><span><b>BE</b> Below expectation</span> Counts are the number of learning outcomes at each level; Reached = Meeting or Exceeding.</p>` : ''}
    <div class="rc-comments">
      ${(m.subjectComments ?? []).length ? `<div class="rc-box"><small>Subject teachers' comments</small>${m.subjectComments.map((c) => `<p style="margin:.25rem 0;"><strong>${escapeHtml(c.subject)}:</strong> ${escapeHtml(c.text)}${c.by ? ` <em style="font-size:.85em;">— ${escapeHtml(c.by)}</em>` : ''}</p>`).join('')}</div>` : ''}
      <div class="rc-box"><small>Class teacher's comment</small><p>${escapeHtml(m.comments.teacher)}</p><div class="rc-sign">Signature &amp; date</div></div>
      <div class="rc-box"><small>Principal's comment</small><p>${escapeHtml(m.comments.principal)}</p>${m.approval?.approvedBy ? `<div class="rc-approved">Approved by <b>${escapeHtml(m.approval.approvedBy)}</b>${m.approval.approverTitle ? `, ${escapeHtml(m.approval.approverTitle)}` : ''} on ${escapeHtml(String(m.approval.approvedAt).slice(0, 10))}</div>` : ''}<div class="rc-sign">Signature, stamp &amp; date</div></div>
    </div>
    ${m.gradingKey.length ? `<div class="rc-key"><b>Grading key:</b> ${m.gradingKey.map((b) => `<span><b>${escapeHtml(b.grade)}</b> ${escapeHtml(b.min)}–${escapeHtml(b.max)}${b.description ? ` (${escapeHtml(b.description)})` : ''}</span>`).join('')}</div>` : ''}
    <div class="rc-foot"><span>Issued ${escapeHtml(m.generatedOn)}</span><span>${escapeHtml(m.school.name)}</span></div>
  </section>`;
}

export const reportCardsHtml = (models) => models.map(reportCardPageHtml).join('');

let injected = false;
export function ensureReportCardStyles() {
  if (injected || document.getElementById('rc-styles')) return;
  const style = document.createElement('style');
  style.id = 'rc-styles';
  style.textContent = REPORT_CARD_CSS;
  document.head.appendChild(style);
  injected = true;
}
