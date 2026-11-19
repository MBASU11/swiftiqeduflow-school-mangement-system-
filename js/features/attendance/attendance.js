import { qs } from '../../components/dom.js';
import { renderAttendanceMarking } from './attendanceMarking.js';
import { renderAttendanceReports } from './attendanceReports.js';
import { renderAttendanceNotices } from './attendanceNotices.js';
import { renderMobileRegister } from '../offline/mobileRegister.js';
import { offlineUsable } from '../../offline/offlineService.js';
import { featureEnabled } from '../../services/subscriptionService.js';

export function renderAttendance(container) {
  let tab = 'mark';

  function render() {
    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center flex-wrap gap-3">
          <h1 class="text-xl" style="font-weight:600;">Attendance</h1>
          <div class="pill-group">
            <button class="pill ${tab === 'mark' ? 'active' : ''}" id="tab-mark">Mark attendance</button>
            <button class="pill ${tab === 'reports' ? 'active' : ''}" id="tab-reports">Reports</button>
            ${offlineUsable('attendance') ? `<button class="pill ${tab === 'mobile' ? 'active' : ''}" id="tab-mobile">Mobile register</button>` : ''}
            ${featureEnabled('attendance_notifications') ? `<button class="pill ${tab === 'notices' ? 'active' : ''}" id="tab-notices">Parent notices</button>` : ''}
          </div>
        </div>
        <div id="attendance-body"></div>
      </div>
    `;
    qs(container, '#tab-mark').addEventListener('click', () => { tab = 'mark'; render(); });
    qs(container, '#tab-reports').addEventListener('click', () => { tab = 'reports'; render(); });
    qs(container, '#tab-mobile')?.addEventListener('click', () => { tab = 'mobile'; render(); });
    qs(container, '#tab-notices')?.addEventListener('click', () => { tab = 'notices'; render(); });

    const body = qs(container, '#attendance-body');
    if (tab === 'mark') renderAttendanceMarking(body);
    else if (tab === 'mobile') renderMobileRegister(body);
    else if (tab === 'notices') renderAttendanceNotices(body);
    else renderAttendanceReports(body);
  }

  render();
}
