import { registerRoute, startRouter } from '../router.js';
import { mountShell, refreshShellNav } from '../layouts/appShell.js';
import { NAV_ITEMS } from '../layouts/navConfig.js';
import { canAccessPath } from '../services/accessService.js';
import { renderAccountStatus } from './account/accountStatus.js';
import { renderStudentsList } from './students/studentsList.js';
import { renderStudentProfile } from './students/studentProfile.js';
import { renderAcademics } from './academics/academics.js';
import { renderStaffList } from './staff/staffList.js';
import { renderDiscipline } from './discipline/discipline.js';
import { renderAttendance } from './attendance/attendance.js';
import { renderAdmissions } from './admissions/admissions.js';
import { renderAssessments } from './assessments/assessments.js';
import { renderInventory } from './inventory/inventory.js';
import { renderLibrary } from './library/library.js';
import { renderTransport } from './transport/transport.js';
import { renderCommunication } from './communication/communication.js';
import { renderFinance } from './finance/finance.js';
import { renderReportsCenter } from './reports/reportsCenter.js';
import { renderDocuments } from './documents/documents.js';
import { renderSettings } from './settings/settings.js';
import { renderTimetable } from './timetable/timetable.js';
import { renderRemoteDashboard } from './remoteDashboard.js';
import { renderDataTransfer } from './data/dataTransfer.js';
import { renderSubscription } from './subscription/subscription.js';

const REMOTE_LINKS = [
  ['#/', 'Dashboard'],
  ['#/admissions', 'Admissions'],
  ['#/students', 'Students'],
  ['#/academics', 'Academics'],
  ['#/staff', 'Staff'],
  ['#/attendance', 'Attendance'],
  ['#/exams', 'Assessments'],
  ['#/timetable', 'Timetable'],
  ['#/finance', 'Finance'],
  ['#/communication', 'Communication'],
  ['#/reports', 'Reports'],
  ['#/library', 'Library'],
  ['#/inventory', 'Inventory'],
  ['#/transport', 'Transport'],
  ['#/discipline', 'Discipline'],
  ['#/documents', 'Documents'],
  ['#/data', 'Import & Export'],
  ['#/settings', 'Settings'],
];

export function renderRemoteWorkspace(rootEl, { school, platformService, onLogout, onRefresh }) {
  const navItems = REMOTE_LINKS
    .filter(([path]) => canAccessPath(path))
    .map(([path, label]) => {
      const item = NAV_ITEMS.find((navItem) => navItem.path === path);
      return item ? { ...item, path, label } : null;
    })
    .filter(Boolean);
  if (canAccessPath('#/settings')) {
    const subscriptionItem = NAV_ITEMS.find((item) => item.path === '#/subscription');
    if (subscriptionItem) navItems.push({ ...subscriptionItem, path: '#/account', label: 'Package invoices' });
  }
  const contentEl = mountShell(rootEl, {
    account: { name: school.schoolName, email: school.email },
    onLogout,
    navItems,
    schoolOverride: { name: school.schoolName, logoUrl: school.logoUrl ?? '', letterheadUrl: school.letterheadUrl ?? '' },
    searchEnabled: false,
  });
  registerRoute('/', renderRemoteDashboard);
  registerRoute('/students', renderStudentsList);
  registerRoute('/students/:id', renderStudentProfile);
  registerRoute('/academics', renderAcademics);
  registerRoute('/staff', renderStaffList);
  registerRoute('/discipline', renderDiscipline);
  registerRoute('/attendance', renderAttendance);
  registerRoute('/admissions', (container) => renderAdmissions(container, { schoolId: school.id }));
  registerRoute('/assessments', renderAssessments);
  registerRoute('/exams', renderAssessments);
  registerRoute('/inventory', renderInventory);
  registerRoute('/library', renderLibrary);
  registerRoute('/transport', renderTransport);
  registerRoute('/communication', renderCommunication);
  registerRoute('/finance', renderFinance);
  registerRoute('/reports', renderReportsCenter);
  registerRoute('/documents', (container) => renderDocuments(container, { schoolId: school.id }));
  registerRoute('/settings', renderSettings);
  registerRoute('/timetable', renderTimetable);
  registerRoute('/data', renderDataTransfer);
  registerRoute('/subscription', renderSubscription);
  registerRoute('/account', (container) => renderAccountStatus(container, {
    account: school,
    platformService,
    onLogout,
    onRefresh,
  }));
  startRouter(contentEl, () => refreshShellNav());
}
