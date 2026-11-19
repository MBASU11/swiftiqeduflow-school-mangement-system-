import { qs } from '../../components/dom.js';
import { renderAssessmentsList } from './assessmentsList.js';
import { renderMarksEntry } from './marksEntry.js';
import { renderExaminationsPage } from '../exams/examinationsPage.js';
import { renderMobileMarks } from '../offline/mobileMarks.js';
import { renderReportSettings } from '../exams/reportSettings.js';
import { isAdmin } from '../../services/accessService.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { offlineUsable } from '../../offline/offlineService.js';

export function renderAssessments(container) {
  let tab = 'assessments';
  let openAssessmentId = null;

  function render() {
    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center flex-wrap gap-3">
          <h1 class="text-xl" style="font-weight:600;">Exams & Assessments</h1>
          ${
            !openAssessmentId
              ? `<div class="pill-group">
                  <button class="pill ${tab === 'assessments' ? 'active' : ''}" id="tab-assessments">Assessments</button>
                  <button class="pill ${tab === 'exams' ? 'active' : ''}" id="tab-exams">Examinations</button>
                  ${offlineUsable('exams') ? `<button class="pill ${tab === 'mobile' ? 'active' : ''}" id="tab-mobile">Mobile marks</button>` : ''}
                  ${isAdmin() && !isSupabaseConfigured() ? `<button class="pill ${tab === 'rsettings' ? 'active' : ''}" id="tab-rsettings">Report settings</button>` : ''}
                </div>`
              : ''
          }
        </div>
        <div id="assessments-body"></div>
      </div>
    `;

    const tabAssessments = qs(container, '#tab-assessments');
    if (tabAssessments) tabAssessments.addEventListener('click', () => { tab = 'assessments'; openAssessmentId = null; render(); });
    const tabExams = qs(container, '#tab-exams');
    if (tabExams) tabExams.addEventListener('click', () => { tab = 'exams'; render(); });
    qs(container, '#tab-rsettings')?.addEventListener('click', () => { tab = 'rsettings'; openAssessmentId = null; render(); });
    const tabMobile = qs(container, '#tab-mobile');
    if (tabMobile) tabMobile.addEventListener('click', () => { tab = 'mobile'; openAssessmentId = null; render(); });

    const body = qs(container, '#assessments-body');
    if (tab === 'rsettings') {
      renderReportSettings(body);
    } else if (tab === 'mobile') {
      renderMobileMarks(body);
    } else if (tab === 'assessments') {
      if (openAssessmentId) {
        renderMarksEntry(body, openAssessmentId, () => { openAssessmentId = null; render(); });
      } else {
        renderAssessmentsList(body, (id) => { openAssessmentId = id; render(); });
      }
    } else {
      renderExaminationsPage(body);
    }
  }

  render();
}
