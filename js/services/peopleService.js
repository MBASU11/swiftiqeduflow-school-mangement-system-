import { LocalStorageRepository } from '../storage/Repository.js';

export const parentRepo = new LocalStorageRepository('parents', 'parent');
export const teacherRepo = new LocalStorageRepository('teachers', 'teacher');

export const STAFF_CATEGORIES = [
  ['teaching', 'Teaching'],
  ['administration', 'Administration'],
  ['finance', 'Finance'],
  ['support', 'Support'],
  ['transport', 'Transport'],
  ['other', 'Other'],
];

export function parentFullName(p) {
  return `${p.firstName} ${p.lastName}`.trim();
}

export function teacherFullName(t) {
  return `${t.firstName} ${t.lastName}`.trim();
}

export function validateStaffMember(data) {
  const errors = [];
  if (!data.firstName?.trim()) errors.push({ field: 'firstName', message: 'First name is required.' });
  if (!data.lastName?.trim()) errors.push({ field: 'lastName', message: 'Last name is required.' });
  if (!data.category) errors.push({ field: 'category', message: 'Select a category.' });
  return errors;
}
