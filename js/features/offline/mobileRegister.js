// Phone-first attendance register. Every tap is saved on the device FIRST (works with no signal,
// survives refreshes and restarts), then synced when possible. Teachers see only their own classes.
import { escapeHtml, on, qs } from '../../components/dom.js';
import { classesSortedByOrder, getStreamsForClass } from '../../services/academicService.js';
import { getRosterFor, getRecordsFor } from '../../services/attendanceService.js';
import { getCurrentTerm } from '../../services/academicService.js';
import { fullName } from '../../services/studentService.js';
import { withSnapshot, queueAttendance, myClasses, getEngine, subscribe, refreshScope, startAutoSync } from '../../offline/offlineService.js';
import { STATUS } from '../../offline/outbox.js';
import { mountSyncPanel, stateBadge } from './syncPanel.js';

const today = () => new Date().toISOString().slice(0, 10);
const CHOICES = [['present', 'P', 'Present'], ['absent', 'A', 'Absent'], ['late', 'L', 'Late'], ['excused', 'E', 'Excused']];

export async function renderMobileRegister(container) {
  await refreshScope().catch(() => {});
  startAutoSync();
  const { scope, classes } = await myClasses(classesSortedByOrder());
  const st = { classId: classes[0]?.id ?? '', streamId: '', date: today(), roster: [], records: {}, fromSavedCopy: false, error: '' };
  if (!classes.length) { container.innerHTML = `<div class="notice"><span>${scope.linked ? 'No classes are assigned to you yet. Ask the administrator to allocate your classes.' : 'Your account is not linked to a staff record. Ask the administrator to add you under Staff with this same email address.'}</span></div>`; return; }

  async function load() {
    try {
      const snap = await withSnapshot(`register|${st.classId}|${st.streamId}|${st.date}`, async () => ({
        roster: getRosterFor(st.classId, st.streamId || undefined).map((s) => ({ id: s.id, name: fullName(s), adm: s.admissionNumber })),
        records: Object.fromEntries([...getRecordsFor(st.classId, st.date)].map(([id, r]) => [id, { status: r.status, version: r.version ?? 1 }])),
      }));
      st.roster = snap.data.roster; st.records = snap.data.records; st.fromSavedCopy = snap.fromSavedCopy; st.error = '';
    } catch (e) { st.error = 'This class has not been saved on this phone yet. Open it once with a connection.'; st.roster = []; }
    st.ops = (await getEngine().list()).filter((o) => o.kind === 'attendance' && o.payload.classId === st.classId && o.payload.date === st.date);
    draw();
  }
  // What to show for a learner: their own queued mark wins over the last server copy.
  const opFor = (id) => st.ops.find((o) => o.payload.studentId === id && o.status !== STATUS.synced);
  const statusOf = (id) => opFor(id)?.payload.status ?? st.records[id]?.status ?? '';

  function draw() {
    const streams = getStreamsForClass(st.classId);
    const marked = st.roster.filter((s) => statusOf(s.id)).length;
    const count = (k) => st.roster.filter((s) => statusOf(s.id) === k).length;
    container.innerHTML = `<div class="space-y-3" style="max-width:34rem;margin-inline:auto;">
      <div id="reg-sync"></div>
      <div class="grid grid-2 gap-2">
        <select class="input" id="rg-class" aria-label="Class">${classes.map((c) => `<option value="${c.id}" ${c.id === st.classId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
        <input class="input" type="date" id="rg-date" value="${st.date}" max="${today()}" aria-label="Date" />
        ${streams.length ? `<select class="input" id="rg-stream" aria-label="Stream" style="grid-column:span 2;"><option value="">Whole class</option>${streams.map((s) => `<option value="${s.id}" ${s.id === st.streamId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select>` : ''}
      </div>
      ${st.fromSavedCopy ? '<div class="notice"><span>Showing the copy saved on this phone. Your marks are queued and will sync when you are back online.</span></div>' : ''}
      ${st.error ? `<div class="notice" role="alert"><span>${escapeHtml(st.error)}</span></div>` : ''}
      <div class="flex flex-wrap items-center justify-between gap-2"><span class="text-sm">${marked}/${st.roster.length} marked · ${count('present')} P · ${count('absent')} A · ${count('late')} L · ${count('excused')} E</span>
        <button class="btn-secondary btn-sm" id="rg-allp" ${st.roster.length === marked ? 'disabled' : ''}>Mark the rest present</button></div>
      ${st.roster.map((s) => { const cur = statusOf(s.id); const op = opFor(s.id); return `<div class="card card-p" data-stu="${s.id}" style="padding:.6rem .75rem;">
          <div class="flex justify-between items-center gap-2"><div><strong>${escapeHtml(s.name)}</strong><div class="text-xs text-ink-500">${escapeHtml(s.adm ?? '')}</div></div>${op ? stateBadge(op.status) : cur ? stateBadge('synced') : ''}</div>
          <div class="grid gap-2" style="grid-template-columns:repeat(4,1fr);margin-top:.5rem;" role="group" aria-label="Attendance for ${escapeHtml(s.name)}">${CHOICES.map(([k, ab, label]) => `<button type="button" class="btn ${cur === k ? 'btn-primary' : 'btn-secondary'}" data-set="${k}" aria-pressed="${cur === k}" aria-label="${label}" style="min-height:44px;font-weight:600;">${ab}</button>`).join('')}</div></div>`; }).join('') || (st.error ? '' : '<p class="text-sm text-ink-500">No learners in this class.</p>')}
    </div>`;
    mountSyncPanel(qs(container, '#reg-sync'), (o) => `${st.roster.find((r) => r.id === o.payload.studentId)?.name ?? 'Learner'} — ${o.payload.status} (${o.payload.date})`);
    qs(container, '#rg-class').addEventListener('change', (e) => { st.classId = e.target.value; st.streamId = ''; load(); });
    qs(container, '#rg-date').addEventListener('change', (e) => { st.date = e.target.value || today(); load(); });
    qs(container, '#rg-stream')?.addEventListener('change', (e) => { st.streamId = e.target.value; load(); });
    const mark = async (id, status) => {
      await queueAttendance({ classId: st.classId, streamId: st.streamId || undefined, date: st.date, studentId: id, status, baseVersion: st.records[id]?.version ?? 0, termId: getCurrentTerm()?.id });
      st.ops = (await getEngine().list()).filter((o) => o.kind === 'attendance' && o.payload.classId === st.classId && o.payload.date === st.date); draw();
    };
    on(container, '[data-set]', 'click', (e) => mark(e.currentTarget.closest('[data-stu]').dataset.stu, e.currentTarget.dataset.set));
    qs(container, '#rg-allp')?.addEventListener('click', async () => { for (const s of st.roster.filter((x) => !statusOf(x.id))) await mark(s.id, 'present'); });
  }
  // when a sync finishes, re-read the records so "Synchronized" reflects the real stored state
  const off = subscribe(async () => { if (!container.isConnected) return off(); await load(); });
  load();
}
