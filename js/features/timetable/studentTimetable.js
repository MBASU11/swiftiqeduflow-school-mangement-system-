import { escapeHtml, qs } from '../../components/dom.js';
import { fullName } from '../../services/studentService.js';
import { teacherFullName } from '../../services/peopleService.js';
import { loadTimetableData } from '../../services/timetableStore.js';
import { emptyState } from '../../components/emptyState.js';
import { ensureTimetableStyles, timetableGridHtml, printableTimetable, TIMETABLE_CSS } from '../../components/timetableGrid.js';
import { printHtml } from '../../components/printWindow.js';

export function renderStudentTimetable(container) {
  ensureTimetableStyles();
  const state = { data: null, studentId: '' };

  async function render() {
    try {
      state.data ??= await loadTimetableData();
    } catch (error) {
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span><button class="btn-secondary btn-sm" id="student-timetable-retry">Retry</button></div>`;
      qs(container, '#student-timetable-retry').addEventListener('click', () => { state.data = null; render(); });
      return;
    }
    const { students: allStudents, classes, subjects, teachers, entries: allEntries, school } = state.data;
    const students = allStudents.filter((s) => s.status === 'active');
    if (!students.length) {
      container.innerHTML = `<div class="card">${emptyState({ title: 'No students yet', body: 'Add students before looking up their timetable.' })}</div>`;
      return;
    }
    if (!students.some((s) => s.id === state.studentId)) state.studentId = students[0].id;
    const student = students.find((s) => s.id === state.studentId);
    const classById = Object.fromEntries(classes.map((c) => [c.id, c]));
    const subjectById = Object.fromEntries(subjects.map((s) => [s.id, s]));
    const teacherById = Object.fromEntries(teachers.map((t) => [t.id, t]));
    const entries = student.classId ? allEntries.filter((e) => e.classId === student.classId) : [];
    const describe = (e) => ({
      title: subjectById[e.subjectId]?.name ?? '—',
      meta: [e.teacherId ? teacherFullName(teacherById[e.teacherId] ?? { firstName: '', lastName: '—' }) : '', e.room].filter(Boolean).join(' · '),
    });

    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="label">Student</label>
            <select class="input" id="student-select" style="min-width:14rem">
              ${students.map((s) => `<option value="${s.id}" ${state.studentId === s.id ? 'selected' : ''}>${escapeHtml(fullName(s))}</option>`).join('')}
            </select>
          </div>
          <button class="btn-secondary" id="print-btn" style="margin-left:auto" ${entries.length ? '' : 'disabled'}>Print timetable</button>
        </div>
        ${
          !student.classId
            ? `<div class="card">${emptyState({ title: 'This student has no class assigned', body: "Assign a class from the student's profile to see their timetable." })}</div>`
            : entries.length === 0
            ? `<div class="card">${emptyState({ title: 'No periods scheduled for this class yet', body: `Build ${classById[student.classId]?.name ?? 'this class'}'s timetable from the Class tab.` })}</div>`
            : `<div class="card overflow-x-auto card-p">${timetableGridHtml(entries, { describe })}</div>`
        }
      </div>`;

    qs(container, '#student-select').addEventListener('change', (e) => { state.studentId = e.target.value; render(); });
    qs(container, '#print-btn').addEventListener('click', () => {
      printHtml(`${fullName(student)} timetable`, printableTimetable({
        school,
        heading: `${fullName(student)} — ${classById[student.classId]?.name ?? ''} timetable`,
        subheading: state.data.periodLabel,
        gridHtml: timetableGridHtml(entries, { describe }),
      }), { css: TIMETABLE_CSS, orientation: 'landscape' });
    });
  }

  render();
}
