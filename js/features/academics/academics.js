import { qs } from '../../components/dom.js';
import { featureEnabled } from '../../services/subscriptionService.js';
import { renderCompetencies } from './competencies.js';
import { renderClassesManager } from './classesManager.js';
import { renderSubjectsManager } from './subjectsManager.js';
import { renderAcademicYearsManager } from './academicYearsManager.js';
import { renderCurriculaManager } from './curriculaManager.js';
import { TEACHER_TABS, renderTeacherTab } from './teacherPack.js';

const TABS = [
  ['classes', 'Classes & Streams'],
  ['subjects', 'Subjects'],
  ['years', 'Academic Years'],
  ['curricula', 'Curricula'],
];

export function renderAcademics(container) {
  let tab = 'classes';

  function render() {
    // Existing tabs unchanged; Teacher Pack tabs appear only for features the package includes.
    const packTabs = TEACHER_TABS.filter(([, , on]) => on()).map(([k, l]) => [k, l]);
    const baseTabs = [...TABS, ...(featureEnabled('competency_ratings') ? [['competencies', 'Competencies']] : [])];
    const tabs = [...baseTabs, ...packTabs];
    if (!tabs.some(([k]) => k === tab)) tab = 'classes';
    container.innerHTML = `
      <div class="space-y-4">
        <div class="space-y-2">
          <h1 class="text-xl" style="font-weight:600;">Academics</h1>
          <div class="pill-group" style="flex-wrap:wrap;">
            ${baseTabs.map(([key, label]) => `<button class="pill ${tab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`).join('')}
          </div>
          ${packTabs.length ? `<p class="text-xs text-ink-500" style="margin:.6rem 0 .25rem .25rem;font-weight:600;letter-spacing:.04em;">TEACHER PACK</p><div class="pill-group" style="flex-wrap:wrap;">${packTabs.map(([key, label]) => `<button class="pill ${tab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`).join('')}</div>` : ''}
        </div>
        <div id="academics-body"></div>
      </div>
    `;

    tabs.forEach(([key]) => {
      qs(container, `[data-tab="${key}"]`).addEventListener('click', () => { tab = key; render(); });
    });

    const body = qs(container, '#academics-body');
    if (tab === 'classes') renderClassesManager(body);
    else if (tab === 'subjects') renderSubjectsManager(body);
    else if (tab === 'competencies') renderCompetencies(body);
    else if (packTabs.some(([k]) => k === tab)) renderTeacherTab(tab, body);
    else if (tab === 'years') renderAcademicYearsManager(body);
    else renderCurriculaManager(body);
  }

  render();
}
