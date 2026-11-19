import { students } from './students.js';
import { marks } from './marks.js';
import { staff, admissions, subjects, classes, library, inventory } from './lists.js';

// Order = how they appear on the Import & Export page (setup order for a new school).
export const DATASETS = [classes, subjects, students, marks, admissions, staff, library, inventory];
export const DATASET_BY_KEY = Object.fromEntries(DATASETS.map((d) => [d.key, d]));

// Lists that can be exported all together in one workbook (marks need an exam + class).
export const EXPORT_ALL = [classes, subjects, students, admissions, staff, library, inventory];
export { loadContext } from './context.js';
