import { icons } from '../components/icons.js';

export const NAV_ITEMS = [
  { label: 'Dashboard', path: '#/', icon: icons.grid },
  { label: 'Admissions', path: '#/admissions', icon: icons.clipboard, moduleKey: 'admissions' },
  { label: 'Students', path: '#/students', icon: icons.users },
  { label: 'Academics', path: '#/academics', icon: icons.book, moduleKey: 'academics' },
  { label: 'Staff', path: '#/staff', icon: icons.briefcase },
  { label: 'My workspace', path: '#/workspace', icon: icons.briefcase, needsModule: 'teacher_pack' },
  { label: 'Attendance', path: '#/attendance', icon: icons.calendarCheck, moduleKey: 'attendance' },
  { label: 'Exams & Assessments', path: '#/exams', icon: icons.award, moduleKey: 'exams' },
  { label: 'Timetable', path: '#/timetable', icon: icons.table, moduleKey: 'timetable' },
  { label: 'Finance', path: '#/finance', icon: icons.wallet, moduleKey: 'finance' },
  { label: 'Communication', path: '#/communication', icon: icons.megaphone, moduleKey: 'communication' },
  { label: 'Reports', path: '#/reports', icon: icons.barChart },
  { label: 'Library', path: '#/library', icon: icons.library, moduleKey: 'library' },
  { label: 'Inventory', path: '#/inventory', icon: icons.box, moduleKey: 'inventory' },
  { label: 'Transport', path: '#/transport', icon: icons.bus, moduleKey: 'transport' },
  { label: 'Discipline', path: '#/discipline', icon: icons.shield, moduleKey: 'discipline' },
  { label: 'Activities', path: '#/activities', icon: icons.award },
  { label: 'Health', path: '#/health', icon: icons.activity, moduleKey: 'health' },
  { label: 'Hostel', path: '#/hostel', icon: icons.users, moduleKey: 'hostels' },
  { label: 'Documents', path: '#/documents', icon: icons.folder, moduleKey: 'documents' },
  { label: 'Import & Export', path: '#/data', icon: icons.transfer },
  { label: 'Settings', path: '#/settings', icon: icons.settings },
  { label: 'Subscription', path: '#/subscription', icon: icons.wallet },
];

// Bottom mobile nav gets the 5 things a teacher/admin reaches for most.
export const MOBILE_PRIMARY_PATHS = ['#/', '#/students', '#/attendance', '#/exams', '#/finance'];
