// WHO CAN SEE AND CHANGE WHAT.
// One table drives the menu, page access, buttons, import/export and (via the
// matching SQL in supabase/migrations/202610140001_roles_and_team.sql) the database.
// If you change a rule here, change the SQL function role_collection_access() too —
// a test compares the two.

export const ROLES = {
  school_admin: {
    label: 'Administrator',
    title: 'Principal / Director / Head teacher',
    description: 'Sees and manages everything, including staff accounts and settings.',
  },
  accountant: {
    label: 'Accounts / Finance',
    title: 'Accountant, Bursar',
    description: 'Fees, payments, expenses and finance reports. Can look up students for billing.',
  },
  registrar: {
    label: 'Admissions & Students',
    title: 'Registrar, Admissions officer',
    description: 'Handles applications, admits students into classes and keeps student records.',
  },
  teacher: {
    label: 'Teacher / Trainer',
    title: 'Teacher, Trainer',
    description: 'Academics, attendance, timetable, exams and assessments, communication; can upload documents.',
  },
  nurse: {
    label: 'School nurse / Health',
    title: 'School nurse, Clinic officer',
    description: "Learners' health records, sick-bay visits, medication and immunisation. Can look up learners; nothing else.",
  },
  // Older accounts created before roles existed. Kept so nobody is locked out of
  // sign-in, but with the least access.
  staff: { label: 'Staff (limited)', title: 'Legacy', description: 'Basic access only.', legacy: true },
  // Reserved for a future parent portal; no school screens at all.
  parent: { label: 'Parent', title: 'Parent / guardian', description: 'Portal only: their own children\'s report cards, fees, homework and timetable.', legacy: true },
  student: { label: 'Learner', title: 'Learner', description: 'Portal only: their own report cards, homework and timetable. Never fees.', legacy: true },
};

// Roles an administrator can hand out.
export const ASSIGNABLE_ROLES = ['school_admin', 'accountant', 'registrar', 'teacher', 'nurse'];

export const normalizeRole = (role) => {
  if (role === 'admin') return 'school_admin'; // accounts created in browser-only mode
  return ROLES[role] ? role : 'staff';
};

// ---- Pages (menu items) --------------------------------------------------------
// 'write' = can use and change; 'read' = can open but not change; missing = hidden.
const ALL = 'write';
export const MODULE_ACCESS = {
  school_admin: Object.fromEntries(
    ['dashboard', 'students', 'admissions', 'academics', 'attendance', 'timetable', 'exams', 'finance', 'communication', 'reports',
      'transport', 'library', 'inventory', 'discipline', 'activities', 'hostel', 'health', 'staff', 'documents', 'data', 'settings'].map((m) => [m, ALL])
  ),
  accountant: { dashboard: 'read', finance: 'write', reports: 'read', students: 'read' },
  registrar: { dashboard: 'read', students: 'write', admissions: 'write', academics: 'read', documents: 'write', data: 'write' },
  teacher: { dashboard: 'read', students: 'read', academics: 'read', attendance: 'write', activities: 'write', hostel: 'write', timetable: 'read', exams: 'write', communication: 'write', documents: 'write', reports: 'read', data: 'write' },
  nurse: { dashboard: 'read', health: 'write', students: 'read' },
  staff: { dashboard: 'read' },
  parent: {},
  student: {},
};

// Which report tabs each role may open (Reports Center).
export const REPORT_TABS = {
  school_admin: ['overview', 'academics', 'finance', 'operations'],
  accountant: ['finance'],
  registrar: [],
  teacher: ['academics'],
  nurse: [],
  staff: [],
  parent: [],
  student: [],
};

// ---- Records (what is stored) ----------------------------------------------------
const FINANCE = ['feeStructures', 'invoices', 'payments', 'expenses', 'receipts', 'refunds', 'optionalCharges', 'studentCharges', 'adjustments', 'feeReminders', 'bursarSettings', 'creditNotes', 'awards', 'sponsorPayments', 'installmentPlans', 'bankTransactions'];
const STRUCTURE = ['classes', 'streams', 'subjects', 'curricula', 'terms', 'academicYears'];
const ASSESSMENTS = ['assessments', 'assessmentScores'];
const META = ['school', 'settings'];

export const COLLECTION_ACCESS = {
  accountant: {
    write: FINANCE,
    read: ['students', 'parents', 'routes', 'transportAssignments', ...STRUCTURE, ...META],
  },
  registrar: {
    write: ['students', 'parents', 'admissions', 'documents'],
    read: [...STRUCTURE, ...META],
  },
  teacher: {
    write: ['attendance', 'examScores', 'reportCards', 'publishedReportCards', ...ASSESSMENTS, 'messages', 'announcements', 'documents', 'lessonPlans', 'schemesOfWork', 'homework', 'homeworkSubmissions', 'learningMaterials', 'liveLessons', 'attendanceNotices', 'reportComments', 'reportRuns', 'learningOutcomes', 'competencyRatings', 'activities', 'activityMembers', 'activitySessions', 'activityAchievements', 'hostels', 'hostelRooms', 'hostelAllocations', 'hostelExeats', 'hostelRollCalls'],
    read: [...STRUCTURE, ...META, 'students', 'parents', 'teachers', 'timetableEntries', 'examinations', 'gradingSystems', 'gradeBands', 'teachingAssignments', 'welfareGrants', 'planningFrameworks'],
  },
  nurse: { write: ['healthProfiles', 'healthVisits', 'healthMedications', 'healthDoses', 'healthImmunisations', 'healthAccessLog'], read: ['students', 'parents', ...STRUCTURE, ...META] },
  staff: { write: [], read: META },
  student: { write: ['homeworkSubmissions'], read: [] }, // a learner can hand in homework and nothing else
};

export const ALL_COLLECTIONS = [
  'academicYears', 'admissions', 'announcements', 'assessmentScores', 'assessments', 'attendance', 'classes', 'curricula', 'discipline',
  'documents', 'examScores', 'examinations', 'expenses', 'feeStructures', 'gradeBands', 'gradingSystems', 'inventory', 'inventoryTransactions',
  'invoices', 'lessonPlans', 'schemesOfWork', 'homework', 'homeworkSubmissions', 'learningMaterials', 'liveLessons', 'attendanceNotices', 'reportComments', 'planningFrameworks', 'reportPolicy', 'weightingSchemes', 'reportRuns', 'teachingAssignments', 'welfareNotes', 'welfareGrants', 'receipts', 'refunds', 'optionalCharges', 'studentCharges', 'adjustments', 'feeReminders', 'bursarSettings', 'creditNotes', 'awards', 'sponsorPayments', 'installmentPlans', 'bankTransactions', 'libraryBooks', 'libraryTransactions', 'messages', 'parents', 'payments', 'publishedReportCards', 'reportCards', 'routes',
  'school', 'settings', 'streams', 'students', 'subjects', 'teachers', 'terms', 'timetableEntries', 'transportAssignments', 'vehicles', 'activities', 'activityMembers', 'activitySessions', 'activityAchievements', 'hostels', 'hostelRooms', 'hostelAllocations', 'hostelExeats', 'hostelRollCalls', 'healthProfiles', 'healthVisits', 'healthMedications', 'healthDoses', 'healthImmunisations', 'healthAccessLog', 'learningOutcomes', 'competencyRatings',
];

// 'write' | 'read' | 'none'
export function collectionAccess(role, collection) {
  const r = normalizeRole(role);
  if (r === 'school_admin') return 'write';
  const rules = COLLECTION_ACCESS[r];
  if (!rules) return 'none';
  if (rules.write.includes(collection)) return 'write';
  if (rules.read.includes(collection)) return 'read';
  return 'none';
}

export function moduleAccess(role, moduleKey) {
  return MODULE_ACCESS[normalizeRole(role)]?.[moduleKey] ?? 'none';
}

// URL path (#/students/123) -> module key
export function moduleForPath(path) {
  const first = String(path ?? '').replace(/^#?\/?/, '').split(/[/?]/)[0];
  const map = { '': 'dashboard', assessments: 'exams', account: 'settings', subscription: 'settings', workspace: 'academics' };
  return map[first] ?? first;
}

// ---- Import / export ----------------------------------------------------------------
// What each dataset needs: to import it must be able to write these; to export, read these.
export const DATASET_NEEDS = {
  classes: { write: ['classes', 'streams'], read: ['classes', 'streams', 'students'] },
  subjects: { write: ['subjects'], read: ['subjects', 'classes'] },
  students: { write: ['students', 'parents'], read: ['students', 'parents', 'classes', 'streams'] },
  marks: { write: ['examScores'], read: ['examScores', 'students', 'subjects', 'examinations', 'classes', 'gradeBands', 'gradingSystems'] },
  admissions: { write: ['admissions'], read: ['admissions', 'classes'] },
  staff: { write: ['teachers'], read: ['teachers', 'subjects'] },
  library: { write: ['libraryBooks'], read: ['libraryBooks'] },
  inventory: { write: ['inventory'], read: ['inventory'] },
};

export function datasetAccess(role, datasetKey) {
  const needs = DATASET_NEEDS[datasetKey];
  if (!needs) return { import: false, export: false };
  const can = (list, level) => list.every((c) => {
    const a = collectionAccess(role, c);
    return level === 'write' ? a === 'write' : a !== 'none';
  });
  return { import: can(needs.write, 'write'), export: can(needs.read, 'read') };
}
