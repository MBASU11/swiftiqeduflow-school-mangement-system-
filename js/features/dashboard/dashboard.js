import { escapeHtml, on } from '../../components/dom.js';
import { animateCount } from '../../components/motion.js';
import { activeStudents } from '../../services/studentService.js';
import { teacherRepo } from '../../services/peopleService.js';
import { StorageManager } from '../../storage/StorageManager.js';
import { getSchool } from '../../services/schoolService.js';
import { icons } from '../../components/icons.js';
import { renderPrincipalDashboard } from './principalDashboard.js';
import { isAdmin, canAccessModule, canWriteModule, canReadCollection, getCurrentRole, roleLabel } from '../../services/accessService.js';
import { currentAccount } from '../../services/authService.js';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// `count` + `format` (optional) make the number count up on render instead
// of just appearing — purely cosmetic, so a stat without a numeric value
// (like "—") just passes a plain string and skips the animation.
function statCard(label, value, sub, count) {
  const id = `stat-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  return `
    <div class="card card-p">
      <p class="text-sm text-ink-500">${escapeHtml(label)}</p>
      <p class="text-3xl mt-2" id="${id}" style="font-family:var(--font-display); font-weight:600;">${count ? escapeHtml(count.format(0)) : escapeHtml(value)}</p>
      ${sub ? `<p class="text-xs text-ink-400 mt-1">${escapeHtml(sub)}</p>` : ''}
    </div>
  `;
}

function runCounters(container, counters) {
  counters.forEach(({ label, target, format }) => {
    const id = `stat-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    const el = container.querySelector(`#${id}`);
    if (el) animateCount(el, target, { format });
  });
}

function quickAction(label, iconFn, path) {
  return `
    <button class="card" data-quick-action="${path}" style="display:flex; align-items:center; gap:0.75rem; padding:1rem; text-align:left; cursor:pointer; border:1px solid var(--ink-100);">
      <div style="height:2.25rem;width:2.25rem;border-radius:0.5rem;background:var(--brand-100);color:var(--brand-700);display:flex;align-items:center;justify-content:center;flex-shrink:0;">${iconFn(18)}</div>
      <span class="text-sm" style="font-weight:500;">${escapeHtml(label)}</span>
    </button>
  `;
}

// Shortcuts appear only when the signed-in role can actually use them.
const QUICK_ACTIONS = [
  { label: 'Add Student', icon: icons.users, path: '#/students?new=1', module: 'students', write: true },
  { label: 'Add Teacher', icon: icons.users, path: '#/staff', module: 'staff', write: true },
  { label: 'New Application', icon: icons.clipboard, path: '#/admissions', module: 'admissions', write: true },
  { label: 'Record Attendance', icon: icons.calendarCheck, path: '#/attendance', module: 'attendance', write: true },
  { label: 'Enter Marks', icon: icons.clipboard, path: '#/exams', module: 'exams', write: true },
  { label: 'View Timetable', icon: icons.table, path: '#/timetable', module: 'timetable' },
  { label: 'Record Payment', icon: icons.wallet, path: '#/finance', module: 'finance', write: true },
  { label: 'Create Invoice', icon: icons.wallet, path: '#/finance', module: 'finance', write: true },
  { label: 'Send Announcement', icon: icons.megaphone, path: '#/communication', module: 'communication', write: true },
  { label: 'Upload Document', icon: icons.folder, path: '#/documents', module: 'documents', write: true },
  { label: 'Import / Export', icon: icons.transfer, path: '#/data', module: 'data' },
  { label: 'Generate Report', icon: icons.clipboard, path: '#/reports', module: 'reports' },
];

export function renderDashboard(container) {
  const school = getSchool();
  const students = activeStudents();
  const teachers = teacherRepo.getAll().filter((t) => t.isActive);
  const today = todayISO();
  const todayAttendance = StorageManager.filter('attendance', (a) => a.date === today);
  const payments = StorageManager.all('payments');
  const events = StorageManager.all('events')
    .filter((e) => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  const presentToday = todayAttendance.filter((a) => a.status === 'present').length;
  const attendancePct = todayAttendance.length > 0 ? Math.round((presentToday / todayAttendance.length) * 100) : null;
  const totalCollected = payments.filter((p) => !p.status || p.status === 'confirmed').reduce((sum, p) => sum + p.amount, 0);

  container.innerHTML = `
    <div class="space-y-6">
      <div>
        <h1 class="text-2xl" style="font-weight:600;">${getCurrentRole() && getCurrentRole() !== 'school_admin' ? `Welcome, ${escapeHtml(currentAccount()?.name ?? '')}` : school ? `Welcome back, ${escapeHtml(school.name)}` : 'Dashboard'}</h1>
        <p class="text-sm text-ink-500 mt-1">${getCurrentRole() && getCurrentRole() !== 'school_admin' ? `${escapeHtml(roleLabel())} · ${escapeHtml(school?.name ?? '')}` : "Here's what's happening today."}</p>
      </div>

      ${isAdmin() ? '<div id="principal-view"></div>' : ''}
      <div class="grid grid-2 lg-grid-4 gap-4"${isAdmin() ? ' hidden' : ''}>
        ${canReadCollection('students') ? statCard('Students', String(students.length), undefined, { format: (n) => String(n) }) : ''}
        ${canReadCollection('teachers') ? statCard('Teachers', String(teachers.length), undefined, { format: (n) => String(n) }) : ''}
        ${
          !canReadCollection('attendance')
            ? ''
            : attendancePct !== null
            ? statCard("Today's attendance", '', `${presentToday}/${todayAttendance.length} present`, { format: (n) => `${n}%` })
            : statCard("Today's attendance", '—', 'No attendance recorded')
        }
        ${
          !canReadCollection('payments')
            ? ''
            : payments.length > 0
            ? statCard('Fees collected', '', `${payments.length} payments`, { format: (n) => `${school?.currency ?? 'KES'} ${n.toLocaleString()}` })
            : statCard('Fees collected', '—', 'No transactions yet')
        }
      </div>

      <div>
        <h2 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Quick actions</h2>
        <div class="grid grid-2" style="grid-template-columns:repeat(2,1fr); gap:0.75rem;" >
          <div class="grid" style="grid-template-columns:repeat(2,1fr); gap:0.75rem; grid-column:1/-1;">
            ${QUICK_ACTIONS.filter((a) => canAccessModule(a.module) && (!a.write || canWriteModule(a.module))).map((a) => quickAction(a.label, a.icon, a.path)).join('')}
          </div>
        </div>
      </div>

      <div class="card card-p">
        <h2 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Upcoming events</h2>
        ${
          events.length === 0
            ? `<p class="text-sm text-ink-400">No upcoming events.</p>`
            : `<ul style="list-style:none; margin:0; padding:0;">
                ${events
                  .slice(0, 5)
                  .map(
                    (e) =>
                      `<li class="text-sm flex justify-between" style="padding:0.6rem 0; border-bottom:1px solid var(--ink-100);"><span class="text-ink-800">${escapeHtml(e.title)}</span><span class="text-ink-400">${escapeHtml(e.date)}</span></li>`
                  )
                  .join('')}
              </ul>`
        }
      </div>
    </div>
  `;

  if (isAdmin()) renderPrincipalDashboard(container.querySelector('#principal-view'));
  runCounters(container, [
    ...(canReadCollection('students') ? [{ label: 'Students', target: students.length, format: (n) => String(n) }] : []),
    ...(canReadCollection('teachers') ? [{ label: 'Teachers', target: teachers.length, format: (n) => String(n) }] : []),
    ...(canReadCollection('attendance') && attendancePct !== null ? [{ label: "Today's attendance", target: attendancePct, format: (n) => `${n}%` }] : []),
    ...(canReadCollection('payments') && payments.length > 0 ? [{ label: 'Fees collected', target: totalCollected, format: (n) => `${school?.currency ?? 'KES'} ${n.toLocaleString()}` }] : []),
  ]);

  on(container, '[data-quick-action]', 'click', (e) => {
    window.location.hash = e.currentTarget.getAttribute('data-quick-action').replace(/^#/, '');
  });
}
