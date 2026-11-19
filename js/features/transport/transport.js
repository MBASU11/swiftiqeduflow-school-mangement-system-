import { qs } from '../../components/dom.js';
import { renderVehiclesManager } from './vehiclesManager.js';
import { renderRoutesManager } from './routesManager.js';
import { renderAssignmentsManager } from './assignmentsManager.js';

const TABS = [
  ['vehicles', 'Vehicles'],
  ['routes', 'Routes'],
  ['assignments', 'Assignments'],
];

export function renderTransport(container) {
  let tab = 'vehicles';

  function render() {
    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center flex-wrap gap-3">
          <h1 class="text-xl" style="font-weight:600;">Transport</h1>
          <div class="pill-group">
            ${TABS.map(([key, label]) => `<button class="pill ${tab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`).join('')}
          </div>
        </div>
        <div id="transport-body"></div>
      </div>
    `;

    TABS.forEach(([key]) => {
      qs(container, `[data-tab="${key}"]`).addEventListener('click', () => { tab = key; render(); });
    });

    const body = qs(container, '#transport-body');
    if (tab === 'vehicles') renderVehiclesManager(body);
    else if (tab === 'routes') renderRoutesManager(body);
    else renderAssignmentsManager(body);
  }

  render();
}
