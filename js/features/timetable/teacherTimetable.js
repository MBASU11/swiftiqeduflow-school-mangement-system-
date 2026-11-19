import { escapeHtml, qs } from '../../components/dom.js';
import { teacherFullName } from '../../services/peopleService.js';
import { isBreak } from '../../services/timetableService.js';
import { loadTimetableData } from '../../services/timetableStore.js';
import { emptyState } from '../../components/emptyState.js';
import { ensureTimetableStyles, timetableGridHtml, printableTimetable, TIMETABLE_CSS } from '../../components/timetableGrid.js';
import { printHtml } from '../../components/printWindow.js';

export function renderTeacherTimetable(container) {
  ensureTimetableStyles();
  const state = { data: null, teacherId: '', error: '' };

  async function render() {
    try {
      state.data ??= await loadTimetableData();
    } catch (error) {
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span><button class="btn-secondary btn-sm" id="teacher-timetable-retry">Retry</button></div>`;
      qs(container, '#teacher-timetable-retry').addEventListener('click', () => { state.data = null; render(); });
      return;
    }
    const { teachers: allTeachers, classes, subjects, entries: allEntries, school } = state.data;
    const teachers = allTeachers.filter((t) => t.category === 'teaching');
    if (!teachers.length) {
      container.innerHTML = `<div class="card">${emptyState({ title: 'No teaching staff yet', body: 'Add teaching staff before assigning them to a timetable.' })}</div>`;
      return;
    }
    if (!teachers.some((t) => t.id === state.teacherId)) state.teacherId = teachers[0].id;
    const teacher = teachers.find((t) => t.id === state.teacherId);
    const classById = Object.fromEntries(classes.map((c) => [c.id, c]));
    const subjectById = Object.fromEntries(subjects.map((s) => [s.id, s]));
    const entries = allEntries.filter((e) => e.teacherId === state.teacherId && !isBreak(e));
    const describe = (e) => ({ title: `${classById[e.classId]?.name ?? '—'} · ${subjectById[e.subjectId]?.name ?? '—'}`, meta: e.room ?? '' });

    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="label">Teacher</label>
            <select class="input" id="teacher-select" style="min-width:14rem">
              ${teachers.map((t) => `<option value="${t.id}" ${state.teacherId === t.id ? 'selected' : ''}>${escapeHtml(teacherFullName(t))}</option>`).join('')}
            </select>
          </div>
          <button class="btn-secondary" id="print-btn" style="margin-left:auto" ${entries.length ? '' : 'disabled'}>Print timetable</button>
        </div>
        ${
          entries.length === 0
            ? `<div class="card">${emptyState({ title: 'No periods scheduled for this teacher yet' })}</div>`
            : `<div class="card overflow-x-auto card-p">${timetableGridHtml(entries, { describe })}</div>`
        }
      </div>`;

    qs(container, '#teacher-select').addEventListener('change', (e) => { state.teacherId = e.target.value; render(); });
    qs(container, '#print-btn').addEventListener('click', () => {
      printHtml(`${teacherFullName(teacher)} timetable`, printableTimetable({
        school,
        heading: `${teacherFullName(teacher)} — teaching timetable`,
        subheading: state.data.periodLabel,
        gridHtml: timetableGridHtml(entries, { describe }),
      }), { css: TIMETABLE_CSS, orientation: 'landscape' });
    });
  }

  render();
}
