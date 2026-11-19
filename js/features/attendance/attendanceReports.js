import { escapeHtml, qs } from '../../components/dom.js';
import { classesSortedByOrder } from '../../services/academicService.js';
import { scopedClasses } from '../../services/classScope.js';
import { fullName, studentRepo } from '../../services/studentService.js';
import { summarizeAttendance } from '../../services/attendanceService.js';
import { emptyState } from '../../components/emptyState.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { loadAttendanceWorkspace, summarizeRemoteAttendance } from '../../services/supabaseAttendanceService.js';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function renderAttendanceReports(container) {
  if (isSupabaseConfigured()) return renderRemoteAttendanceReports(container);
  const classes = scopedClasses(classesSortedByOrder());
  const state = { classId: classes[0]?.id ?? '', startDate: daysAgoISO(30), endDate: todayISO() };

  function render() {
    if (classes.length === 0) {
      container.innerHTML = `<div class="card">${emptyState({ title: 'No classes set up yet', body: 'Attendance reports will appear here once classes and attendance records exist.' })}</div>`;
      return;
    }

    const studentById = Object.fromEntries(studentRepo.getAll().map((s) => [s.id, s]));
    const summary = state.classId ? summarizeAttendance(state.classId, state.startDate, state.endDate) : [];
    const sorted = [...summary].sort((a, b) =>
      fullName(studentById[a.studentId] ?? { firstName: '', lastName: '' }).localeCompare(
        fullName(studentById[b.studentId] ?? { firstName: '', lastName: '' })
      )
    );
    const classAverage = sorted.length > 0 ? Math.round(sorted.reduce((sum, s) => sum + (s.percentage ?? 0), 0) / sorted.length) : null;

    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="label">Class</label>
            <select class="input" id="class-select" style="min-width:10rem">
              ${classes.map((c) => `<option value="${c.id}" ${state.classId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="label">From</label>
            <input type="date" class="input" id="start-date" value="${escapeHtml(state.startDate)}" />
          </div>
          <div>
            <label class="label">To</label>
            <input type="date" class="input" id="end-date" value="${escapeHtml(state.endDate)}" />
          </div>
          <button class="btn-secondary" id="export-csv" ${sorted.length === 0 ? 'disabled' : ''}>Export CSV</button>
          <button class="btn-secondary" id="print-btn" ${sorted.length === 0 ? 'disabled' : ''}>Print</button>
        </div>

        ${
          sorted.length === 0
            ? `<div class="card">${emptyState({ title: 'No attendance recorded for this range', body: 'Mark attendance for this class, or widen the date range.' })}</div>`
            : `
              <div class="card card-p flex items-center gap-6">
                <div><p class="text-sm text-ink-500">Class average</p><p class="text-2xl" style="font-weight:600;font-family:var(--font-display);">${classAverage}%</p></div>
                <div><p class="text-sm text-ink-500">Students with records</p><p class="text-2xl" style="font-weight:600;font-family:var(--font-display);">${sorted.length}</p></div>
              </div>
              <div class="card overflow-x-auto">
                <table class="data-table">
                  <thead><tr><th>Student</th><th class="text-right">Present</th><th class="text-right">Absent</th><th class="text-right">Late</th><th class="text-right">Excused</th><th class="text-right">Attendance %</th></tr></thead>
                  <tbody>
                    ${sorted
                      .map((s) => {
                        const student = studentById[s.studentId];
                        return `<tr>
                          <td style="font-weight:500;">${escapeHtml(student ? fullName(student) : '—')}</td>
                          <td class="text-right text-ink-600">${s.present}</td>
                          <td class="text-right text-ink-600">${s.absent}</td>
                          <td class="text-right text-ink-600">${s.late}</td>
                          <td class="text-right text-ink-600">${s.excused}</td>
                          <td class="text-right" style="font-weight:500;">${s.percentage !== null ? s.percentage + '%' : '—'}</td>
                        </tr>`;
                      })
                      .join('')}
                  </tbody>
                </table>
              </div>
            `
        }
      </div>
    `;

    qs(container, '#class-select').addEventListener('change', (e) => { state.classId = e.target.value; render(); });
    qs(container, '#start-date').addEventListener('change', (e) => { state.startDate = e.target.value; render(); });
    qs(container, '#end-date').addEventListener('change', (e) => { state.endDate = e.target.value; render(); });
    const exportBtn = qs(container, '#export-csv');
    if (exportBtn) exportBtn.addEventListener('click', () => {
      const className = classes.find((c) => c.id === state.classId)?.name ?? 'class';
      const rows = [
        ['Student', 'Present', 'Absent', 'Late', 'Excused', 'Days recorded', 'Attendance %'],
        ...sorted.map((s) => {
          const student = studentById[s.studentId];
          return [
            student ? fullName(student) : s.studentId,
            s.present,
            s.absent,
            s.late,
            s.excused,
            s.total,
            s.percentage !== null ? `${s.percentage}%` : '—',
          ];
        }),
      ];
      downloadCSV(`attendance-${className}-${state.startDate}-to-${state.endDate}.csv`, rows);
    });
    const printBtn = qs(container, '#print-btn');
    if (printBtn) printBtn.addEventListener('click', () => window.print());
  }

  render();
}

function renderRemoteAttendanceReports(container) {
  const state = { data: null, classId: '', startDate: daysAgoISO(30), endDate: todayISO(), error: '' };

  async function load() {
    container.innerHTML = '<p class="text-sm text-ink-500">Loading attendance reports...</p>';
    try {
      state.data = await loadAttendanceWorkspace();
      state.classId ||= state.data.classes[0]?.id ?? '';
      state.error = '';
      render();
    } catch (error) {
      state.error = error.message;
      renderError();
    }
  }

  function renderError() {
    container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="attendance-report-retry">Retry</button></div>`;
    qs(container, '#attendance-report-retry').addEventListener('click', load);
  }

  function render() {
    const classes = state.data.classes;
    if (classes.length === 0) {
      container.innerHTML = `<div class="card">${emptyState({ title: 'No classes set up yet', body: 'Attendance reports will appear here once classes and attendance records exist.' })}</div>`;
      return;
    }
    const studentById = Object.fromEntries(state.data.students.map((student) => [student.id, student]));
    const summary = summarizeRemoteAttendance(state.data.attendance, state.classId, state.startDate, state.endDate);
    const sorted = [...summary].sort((a, b) =>
      fullName(studentById[a.studentId] ?? { firstName: '', lastName: '' }).localeCompare(
        fullName(studentById[b.studentId] ?? { firstName: '', lastName: '' })
      )
    );
    const classAverage = sorted.length > 0 ? Math.round(sorted.reduce((sum, student) => sum + (student.percentage ?? 0), 0) / sorted.length) : null;
    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex flex-wrap items-end gap-3">
          <div><label class="label">Class</label><select class="input" id="class-select" style="min-width:10rem">${classes.map((schoolClass) => `<option value="${schoolClass.id}" ${state.classId === schoolClass.id ? 'selected' : ''}>${escapeHtml(schoolClass.name)}</option>`).join('')}</select></div>
          <div><label class="label">From</label><input type="date" class="input" id="start-date" value="${escapeHtml(state.startDate)}" /></div>
          <div><label class="label">To</label><input type="date" class="input" id="end-date" value="${escapeHtml(state.endDate)}" /></div>
          <button class="btn-secondary" id="export-csv" ${sorted.length === 0 ? 'disabled' : ''}>Export CSV</button>
          <button class="btn-secondary" id="print-btn" ${sorted.length === 0 ? 'disabled' : ''}>Print</button>
        </div>
        ${sorted.length === 0
          ? `<div class="card">${emptyState({ title: 'No attendance recorded for this range', body: 'Mark attendance for this class, or widen the date range.' })}</div>`
          : `<div class="card card-p flex items-center gap-6"><div><p class="text-sm text-ink-500">Class average</p><p class="text-2xl" style="font-weight:600;font-family:var(--font-display);">${classAverage}%</p></div><div><p class="text-sm text-ink-500">Students with records</p><p class="text-2xl" style="font-weight:600;font-family:var(--font-display);">${sorted.length}</p></div></div>
            <div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Student</th><th class="text-right">Present</th><th class="text-right">Absent</th><th class="text-right">Late</th><th class="text-right">Excused</th><th class="text-right">Attendance %</th></tr></thead><tbody>${sorted.map((studentSummary) => {
              const student = studentById[studentSummary.studentId];
              return `<tr><td style="font-weight:500;">${escapeHtml(student ? fullName(student) : '—')}</td><td class="text-right text-ink-600">${studentSummary.present}</td><td class="text-right text-ink-600">${studentSummary.absent}</td><td class="text-right text-ink-600">${studentSummary.late}</td><td class="text-right text-ink-600">${studentSummary.excused}</td><td class="text-right" style="font-weight:500;">${studentSummary.percentage !== null ? `${studentSummary.percentage}%` : '—'}</td></tr>`;
            }).join('')}</tbody></table></div>`}
      </div>`;

    qs(container, '#class-select').addEventListener('change', (event) => { state.classId = event.target.value; render(); });
    qs(container, '#start-date').addEventListener('change', (event) => { state.startDate = event.target.value; render(); });
    qs(container, '#end-date').addEventListener('change', (event) => { state.endDate = event.target.value; render(); });
    const exportButton = qs(container, '#export-csv');
    if (exportButton) exportButton.addEventListener('click', () => {
      const className = classes.find((schoolClass) => schoolClass.id === state.classId)?.name ?? 'class';
      const rows = [
        ['Student', 'Present', 'Absent', 'Late', 'Excused', 'Days recorded', 'Attendance %'],
        ...sorted.map((studentSummary) => {
          const student = studentById[studentSummary.studentId];
          return [student ? fullName(student) : studentSummary.studentId, studentSummary.present, studentSummary.absent, studentSummary.late, studentSummary.excused, studentSummary.total, studentSummary.percentage !== null ? `${studentSummary.percentage}%` : '—'];
        }),
      ];
      downloadCSV(`attendance-${className}-${state.startDate}-to-${state.endDate}.csv`, rows);
    });
    qs(container, '#print-btn').addEventListener('click', () => window.print());
  }

  load();
}
