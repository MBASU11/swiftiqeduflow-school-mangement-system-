// Parent absence notices (Teacher Pack: attendance notifications).
// Notices are QUEUED. Nothing is shown as delivered because no SMS/email/WhatsApp provider confirms it;
// the buttons open the message in the phone's own SMS, WhatsApp or mail app.
import { escapeHtml, on, qs } from '../../components/dom.js';
import { scopedClasses } from '../../services/classScope.js';
import * as S from '../../services/teacherService.js';
import * as T from '../../services/teacherLogic.js';

const today = () => new Date().toISOString().slice(0, 10);

export async function renderAttendanceNotices(body) {
  const st = { date: today(), classId: '', flash: '', error: '' };
  async function draw() {
    body.innerHTML = '<p class="text-sm text-ink-500">Loading…</p>';
    try {
      const d = await S.loadTeacher();
      const classes = scopedClasses(d.classes);
      st.classId ||= classes[0]?.id ?? '';
      const notices = d.attendanceNotices.filter((n) => d.scope.unrestricted || d.scope.classIds.has(n.classId)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const day = d.attendance.filter((r) => r.classId === st.classId && r.date === st.date);
      const sum = T.attendanceSummary(day);
      body.innerHTML = `<div class="space-y-4">
        <div class="notice"><span>Notices are <strong>queued, not sent</strong>. Use the buttons to open each message in your phone's SMS, WhatsApp or email app. Parents without a phone or email on record are flagged.</span></div>
        ${st.flash ? `<div class="notice" role="status"><span>${escapeHtml(st.flash)}</span></div>` : ''}${st.error ? `<div class="notice" role="alert"><span>${escapeHtml(st.error)}</span></div>` : ''}
        <div class="flex flex-wrap gap-2 items-end"><div><label class="label">Class</label><select class="input" id="an-c">${classes.map((c) => `<option value="${c.id}" ${c.id === st.classId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></div><div><label class="label">Date</label><input class="input" type="date" id="an-d" value="${st.date}" /></div><button class="btn-primary" id="an-go">Queue notices for absent/late students</button></div>
        <p class="text-sm text-ink-600">${sum.total ? `${sum.present} present · ${sum.absent} absent · ${sum.late} late · ${sum.excused} excused${sum.rate != null ? ` · ${sum.rate}% attending` : ''}` : 'No attendance has been marked for this class on this date.'}</p>
        <div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Date</th><th>Student</th><th>Status</th><th>Message</th><th>State</th><th></th></tr></thead><tbody>${notices.slice(0, 100).map((n) => { const s = d.studentById[n.studentId]; return `<tr><td>${escapeHtml(n.date)}</td><td>${escapeHtml(s ? `${s.firstName} ${s.lastName}` : '')}</td><td>${escapeHtml(n.status)}</td><td class="text-sm">${escapeHtml(n.message)}</td><td><span class="badge badge-${n.queuedStatus === 'queued' ? 'gold' : 'muted'}">${n.queuedStatus === 'queued' ? 'Queued (not sent)' : 'Opened on this device'}</span>${n.noContact ? '<div class="text-xs">No phone or email on record</div>' : ''}</td><td>${n.phone ? `<a class="btn-ghost btn-sm" data-ho="${n.id}:sms" href="sms:${encodeURIComponent(n.phone)}?body=${encodeURIComponent(n.message)}">SMS</a><a class="btn-ghost btn-sm" data-ho="${n.id}:whatsapp" target="_blank" rel="noopener" href="https://wa.me/${encodeURIComponent(String(n.phone).replace(/\D/g, ''))}?text=${encodeURIComponent(n.message)}">WhatsApp</a>` : ''}${n.email ? `<a class="btn-ghost btn-sm" data-ho="${n.id}:email" href="mailto:${encodeURIComponent(n.email)}?subject=${encodeURIComponent('Attendance notice')}&body=${encodeURIComponent(n.message)}">Email</a>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="6" class="text-sm text-ink-500">No notices yet.</td></tr>'}</tbody></table></div></div>`;
      qs(body, '#an-c').addEventListener('change', (e) => { st.classId = e.target.value; draw(); });
      qs(body, '#an-d').addEventListener('change', (e) => { st.date = e.target.value; draw(); });
      qs(body, '#an-go').addEventListener('click', async () => { try { const made = await S.queueAbsenceNotices(st.date, st.classId); st.flash = made.length ? `${made.length} notice(s) queued.` : 'No new notices: nobody absent or late, or already queued.'; st.error = ''; } catch (e) { st.error = e.message; st.flash = ''; } draw(); });
      on(body, '[data-ho]', 'click', (e) => { const [id, via] = e.currentTarget.dataset.ho.split(':'); S.markNoticeOpened(id, via); });
    } catch (e) { body.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(e.message)}</span></div>`; }
  }
  draw();
}
