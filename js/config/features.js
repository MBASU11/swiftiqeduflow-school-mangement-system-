// EVERY SWITCHABLE PART OF THE PRODUCT, in one place.
// The Super Admin turns modules and individual features on or off per package (and per
// school) from the Package & Feature Control Centre — nothing here needs editing for that.
// This file only says what exists and what each package gets BY DEFAULT.

// Package order = rank. A feature with minTier 1 is included from the 2nd package upward.
export const DEFAULT_TIER_IDS = ['micro', 'starter', 'professional', 'advanced', 'enterprise', 'enterprise-plus'];

// key matches the menu keys used by the app (moduleForPath in config/roles.js).
// essential: core records that must stay reachable under any subscription.
// minTier: the package rank from which the module is included BY DEFAULT (0 = Micro, 1 = Starter, 2 = Professional...).
//          The Super Admin can still switch any module on or off per package, or grant one to a single school.
// soon: true = shown on the pricing page as "coming soon" (not sold yet), e.g. because it needs the secure cloud version first.
// built: false = listed so it can be priced and switched, but the screens are not part of this build yet.
export const MODULES = [
  { key: 'dashboard', label: 'Dashboard', essential: true },
  { key: 'students', label: 'Students', essential: true },
  { key: 'admissions', label: 'Admissions', minTier: 0 },
  { key: 'academics', label: 'Academics', essential: true },
  { key: 'attendance', label: 'Attendance', essential: true },
  { key: 'timetable', label: 'Timetable', minTier: 0 },
  { key: 'exams', label: 'Exams & Assessments', minTier: 0 },
  { key: 'finance', label: 'Finance', minTier: 0 },
  { key: 'communication', label: 'Communication', minTier: 0 },
  { key: 'reports', label: 'Reports', minTier: 0 },
  { key: 'transport', label: 'Transport', minTier: 1 },
  { key: 'discipline', label: 'Discipline', minTier: 1 },
  { key: 'activities', label: 'Activities', minTier: 2 },
  { key: 'staff', label: 'Staff', minTier: 1 },
  { key: 'documents', label: 'Documents', minTier: 0 },
  { key: 'library', label: 'Library', minTier: 1 },
  { key: 'inventory', label: 'Inventory', minTier: 1 },
  { key: 'health', label: 'Health', minTier: 2, soon: true },
  { key: 'hostel', label: 'Hostel / Boarding', minTier: 2 },
  { key: 'portal', label: 'Parents & Students Portal', minTier: 0 },
  { key: 'data', label: 'Import & Export', minTier: 0 },
  { key: 'settings', label: 'Settings', essential: true },
  // Add-on packs (sold on top of a package)
  { key: 'bursar_pack', label: 'Bursar Pack', pack: true },
  { key: 'teacher_pack', label: 'Teacher Pack', pack: true },
];

// minTier: index into the package order from which the feature is included (null = never by package alone)
// pack:    the add-on pack that also unlocks it (null = none)
export const FEATURES = [
  // Finance
  { key: 'fee_structures', module: 'finance', label: 'Fee structures', minTier: 0, pack: null },
  { key: 'invoice_generation', module: 'finance', label: 'Invoice generation', minTier: 1, pack: 'bursar_pack' },
  { key: 'automated_receipting', module: 'finance', label: 'Automated receipting', minTier: 1, pack: 'bursar_pack' },
  { key: 'fee_reminders', module: 'finance', label: 'Fee reminders', minTier: 1, pack: 'bursar_pack' },
  { key: 'bulk_invoicing', module: 'finance', label: 'Bulk & segmented invoicing', minTier: 2, pack: 'bursar_pack' },
  { key: 'payment_reconciliation', module: 'finance', label: 'Payment reconciliation', minTier: 2, pack: 'bursar_pack' },
  { key: 'sibling_discounts', module: 'finance', label: 'Sibling discounts', minTier: null, pack: 'bursar_pack' },
  { key: 'refund_management', module: 'finance', label: 'Refund requests', minTier: null, pack: 'bursar_pack' },
  { key: 'refund_approvals', module: 'finance', label: 'Refund approvals', minTier: null, pack: 'bursar_pack' },
  { key: 'optional_charges', module: 'finance', label: 'Optional charges', minTier: null, pack: 'bursar_pack' },
  { key: 'transport_billing', module: 'finance', label: 'Transport billing', minTier: 1, pack: 'bursar_pack' },
  { key: 'swiftiq_pay', module: 'finance', label: 'SwiftIQ Pay configuration', minTier: null, pack: 'bursar_pack' },
  { key: 'advanced_financial_reports', module: 'finance', label: 'Advanced financial reports', minTier: 2, pack: 'bursar_pack' },
  { key: 'advanced_financial_analytics', module: 'finance', label: 'Advanced financial analytics', minTier: 3, pack: null },
  { key: 'reconciliation_audit_trail', module: 'finance', label: 'Reconciliation audit trail', minTier: 3, pack: null },
  { key: 'fee_statements', module: 'finance', label: 'Student fee statements', minTier: 2, pack: 'bursar_pack' },
  { key: 'cashbook', module: 'finance', label: 'Cashbook', minTier: 2, pack: 'bursar_pack' },
  { key: 'installment_plans', module: 'finance', label: 'Installment plans', minTier: 3, pack: 'bursar_pack' },
  { key: 'credit_notes', module: 'finance', label: 'Credit notes', minTier: 3, pack: 'bursar_pack' },
  { key: 'scholarships', module: 'finance', label: 'Scholarships and sponsorships', minTier: 3, pack: 'bursar_pack' },
  { key: 'finance_audit_trail', module: 'finance', label: 'Financial audit trail', minTier: 4, pack: 'bursar_pack' },
  // Academics / Teacher Pack
  { key: 'competency_ratings', module: 'academics', label: 'CBC competency tracking', minTier: 0 },
  { key: 'curriculum_coverage', module: 'academics', label: 'Curriculum coverage reports', minTier: 2 },
  { key: 'lesson_planning', module: 'academics', label: 'Lesson planning', minTier: null, pack: 'teacher_pack' },
  { key: 'workplan_manager', module: 'academics', label: 'Workplan & scheme of work manager', minTier: null, pack: 'teacher_pack' },
  { key: 'homework', module: 'academics', label: 'Homework', minTier: null, pack: 'teacher_pack' },
  { key: 'elearning', module: 'academics', label: 'eLearning', minTier: null, pack: 'teacher_pack' },
  { key: 'live_lessons', module: 'academics', label: 'Live lessons', minTier: null, pack: 'teacher_pack' },
  { key: 'student_welfare', module: 'academics', label: 'Student welfare records', minTier: null, pack: 'teacher_pack' },
  { key: 'advanced_assessment_reports', module: 'exams', label: 'Advanced assessment reports', minTier: 2, pack: 'teacher_pack' },
  { key: 'academic_comparisons', module: 'exams', label: 'Academic comparisons & trends', minTier: 3, pack: null },
  // Attendance
  { key: 'attendance_notifications', module: 'attendance', label: 'Parent attendance notifications', minTier: 1, pack: 'teacher_pack' },
  { key: 'enhanced_attendance_reports', module: 'attendance', label: 'Enhanced attendance reports', minTier: 2, pack: 'teacher_pack' },
  // Reports
  { key: 'report_filters', module: 'reports', label: 'Additional report filters', minTier: 1, pack: null },
  { key: 'workload_reports', module: 'reports', label: 'Workload & operational reports', minTier: 2, pack: null },
  { key: 'advanced_staff_reports', module: 'reports', label: 'Advanced staff & operational reports', minTier: 3, pack: null },
  { key: 'multi_campus_reporting', module: 'reports', label: 'Consolidated multi-campus reporting', minTier: 4, pack: null },
  // Transport / Inventory
  { key: 'transport_expanded', module: 'transport', label: 'Expanded transport management', minTier: 1, pack: null },
  { key: 'transport_advanced_reports', module: 'transport', label: 'Advanced transport reports', minTier: 2, pack: null },
  { key: 'inventory_tracking', module: 'inventory', label: 'Inventory tracking', minTier: 1, pack: null },
  { key: 'inventory_advanced_reports', module: 'inventory', label: 'Advanced inventory reports', minTier: 2, pack: null },
  // Communication
  { key: 'enhanced_communication', module: 'communication', label: 'Enhanced parent & student communication', minTier: 1, pack: null },
  { key: 'automation_integrations', module: 'communication', label: 'Automation & integrations', minTier: 2, pack: null },
  // Administration
  { key: 'workflow_permissions', module: 'settings', label: 'Advanced workflow & permission configuration', minTier: 3, pack: null },
  { key: 'departmental_permissions', module: 'settings', label: 'Departmental permissions', minTier: 4, pack: null },
  { key: 'multi_campus', module: 'settings', label: 'Multi-campus management', minTier: 4, pack: null },
  { key: 'advanced_audit_controls', module: 'settings', label: 'Advanced administrative & audit controls', minTier: 4, pack: null },
];

export const MODULE_BY_KEY = Object.fromEntries(MODULES.map((m) => [m.key, m]));
export const FEATURE_BY_KEY = Object.fromEntries(FEATURES.map((f) => [f.key, f]));
export const ESSENTIAL_MODULES = MODULES.filter((m) => m.essential).map((m) => m.key);
export const PACK_MODULES = MODULES.filter((m) => m.pack).map((m) => m.key);
