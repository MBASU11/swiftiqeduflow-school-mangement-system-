import { qs } from '../../components/dom.js';
import { renderClassTimetable } from './classTimetable.js';
import { renderTeacherTimetable } from './teacherTimetable.js';
import { renderStudentTimetable } from './studentTimetable.js';

export function renderTimetable(container) {
  let tab = 'class';

  function render() {
    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center flex-wrap gap-3">
          <h1 class="text-xl" style="font-weight:600;">Timetable</h1>
          <div class="pill-group">
            <button class="pill ${tab === 'class' ? 'active' : ''}" id="tab-class">By Class</button>
            <button class="pill ${tab === 'teacher' ? 'active' : ''}" id="tab-teacher">By Teacher</button>
            <button class="pill ${tab === 'student' ? 'active' : ''}" id="tab-student">By Student</button>
          </div>
        </div>
        <div id="timetable-body"></div>
      </div>
    `;

    qs(container, '#tab-class').addEventListener('click', () => { tab = 'class'; render(); });
    qs(container, '#tab-teacher').addEventListener('click', () => { tab = 'teacher'; render(); });
    qs(container, '#tab-student').addEventListener('click', () => { tab = 'student'; render(); });

    const body = qs(container, '#timetable-body');
    if (tab === 'class') renderClassTimetable(body);
    else if (tab === 'teacher') renderTeacherTimetable(body);
    else renderStudentTimetable(body);
  }

  render();
}
