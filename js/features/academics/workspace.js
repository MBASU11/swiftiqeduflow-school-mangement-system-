// "My workspace": one page where a teacher finds everything for their classes, grouped by what they are
// doing. It reuses the Teacher Pack screens, the Mobile register and Mobile marks; nothing is duplicated.
import { escapeHtml, on, qs } from '../../components/dom.js';
import { moduleEnabled, featureEnabled } from '../../services/subscriptionService.js';
import { offlineUsable } from '../../offline/offlineService.js';
import { TEACHER_TABS, renderTeacherTab } from './teacherPack.js';
import { renderMobileRegister } from '../offline/mobileRegister.js';
import { renderMobileMarks } from '../offline/mobileMarks.js';
import { renderAttendanceNotices } from '../attendance/attendanceNotices.js';
import { renderCompetencies } from './competencies.js';

// A tab is [key, label, isAvailable, renderer?]. Without a renderer it is a Teacher Pack tab.
const available = (key) => TEACHER_TABS.find(([k]) => k === key)?.[2]?.() ?? false;
const label = (key) => TEACHER_TABS.find(([k]) => k === key)?.[1] ?? key;
const T = (key) => [key, label(key), () => available(key)];

export const GROUPS = () => [
  ['Today', [T('teaching'), T('schedule')]],
  ['My classes', [T('classlist'), ['register', 'Mark attendance', () => offlineUsable('attendance'), renderMobileRegister], ['notices', 'Absence notices', () => featureEnabled('attendance_notifications') && offlineUsable('attendance'), renderAttendanceNotices]]],
  ['Teaching', [T('lessons'), T('schemes'), T('homework'), T('elearning'), T('live')]],
  ['Assessment', [['marks', 'Enter marks', () => offlineUsable('exams'), renderMobileMarks], ['competencies', 'Competencies (CBC)', () => featureEnabled('competency_ratings'), renderCompetencies], T('results'), T('reportprep'), T('areports')]],
  ['Communication', [T('announce')]],
  ['Care', [T('welfare')]],
  ['Set-up (administrator)', [T('allocation'), T('frameworks')]],
];

export function renderWorkspace(container) {
  if (!moduleEnabled('teacher_pack')) {
    container.innerHTML = '<div class="card card-p" style="max-width:34rem;"><h1 class="text-lg" style="font-weight:600;">Teacher workspace is not in your package</h1><p class="text-sm text-ink-500 mt-2">Ask the school administrator about the Teacher Pack. Your attendance and marks screens still work as usual.</p></div>';
    return;
  }
  container.setAttribute('data-own-permissions', '');
  let tab = null;
  function render() {
    const groups = GROUPS().map(([name, tabs]) => [name, tabs.filter(([, , ok]) => ok())]).filter(([, tabs]) => tabs.length);
    const flat = groups.flatMap(([, tabs]) => tabs);
    if (!flat.some(([k]) => k === tab)) tab = flat[0]?.[0] ?? null;
    container.innerHTML = `<div class="space-y-4">
      <h1 class="text-xl" style="font-weight:600;">My workspace</h1>
      <nav class="space-y-2 no-print" aria-label="Workspace">${groups.map(([name, tabs]) => `<div><p class="text-xs text-ink-500" style="margin:0 0 .25rem .25rem;font-weight:600;letter-spacing:.04em;">${escapeHtml(name.toUpperCase())}</p><div class="pill-group" style="flex-wrap:wrap;">${tabs.map(([k, l]) => `<button class="pill ${tab === k ? 'active' : ''}" data-ws="${k}">${escapeHtml(l)}</button>`).join('')}</div></div>`).join('')}</nav>
      <div id="ws-body"></div></div>`;
    on(container, '[data-ws]', 'click', (e) => { tab = e.currentTarget.dataset.ws; render(); });
    const body = qs(container, '#ws-body');
    const entry = flat.find(([k]) => k === tab);
    if (!entry) { body.innerHTML = '<p class="text-sm text-ink-500">Nothing is switched on for you yet.</p>'; return; }
    if (entry[3]) entry[3](body); else renderTeacherTab(tab, body);
  }
  render();
}
