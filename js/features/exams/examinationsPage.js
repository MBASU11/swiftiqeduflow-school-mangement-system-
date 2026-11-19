import { qs } from '../../components/dom.js';
import { renderExaminationsList } from './examinationsList.js';
import { renderExamMarksEntry } from './examMarksEntry.js';
import { renderGradingSystem } from './gradingSystem.js';
import { renderReportCards } from './reportCard.js';

export function renderExaminationsPage(container) {
  let tab = 'examinations';
  let openExamId = null;

  function render() {
    container.innerHTML = `
      <div class="space-y-4">
        ${
          !openExamId
            ? `<div class="pill-group">
                <button class="pill ${tab === 'examinations' ? 'active' : ''}" id="tab-examinations">Examinations</button>
                <button class="pill ${tab === 'grading' ? 'active' : ''}" id="tab-grading">Grading</button>
                <button class="pill ${tab === 'reports' ? 'active' : ''}" id="tab-reports">Report cards</button>
              </div>`
            : ''
        }
        <div id="exam-tab-body"></div>
      </div>
    `;

    const tabExaminations = qs(container, '#tab-examinations');
    if (tabExaminations) tabExaminations.addEventListener('click', () => { tab = 'examinations'; openExamId = null; render(); });
    const tabGrading = qs(container, '#tab-grading');
    if (tabGrading) tabGrading.addEventListener('click', () => { tab = 'grading'; render(); });
    const tabReports = qs(container, '#tab-reports');
    if (tabReports) tabReports.addEventListener('click', () => { tab = 'reports'; render(); });

    const body = qs(container, '#exam-tab-body');
    if (tab === 'examinations') {
      if (openExamId) {
        renderExamMarksEntry(body, openExamId, () => { openExamId = null; render(); });
      } else {
        renderExaminationsList(body, (id) => { openExamId = id; render(); });
      }
    } else if (tab === 'grading') {
      renderGradingSystem(body);
    } else {
      renderReportCards(body);
    }
  }

  render();
}
