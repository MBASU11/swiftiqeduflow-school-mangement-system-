import { LocalStorageRepository } from '../storage/Repository.js';
import { SupabaseRepository } from '../storage/SupabaseRepository.js';
import { StorageManager } from '../storage/StorageManager.js';

const COLLECTION = 'students';
export const studentRepo = new LocalStorageRepository(COLLECTION, 'student');
export const supabaseStudentRepo = new SupabaseRepository(COLLECTION);

export function validateStudent(data, editingId) {
  const errors = [];
  if (!data.firstName?.trim()) errors.push({ field: 'firstName', message: 'First name is required.' });
  if (!data.lastName?.trim()) errors.push({ field: 'lastName', message: 'Last name is required.' });
  if (!data.admissionNumber?.trim()) {
    errors.push({ field: 'admissionNumber', message: 'Admission number is required.' });
  } else {
    const duplicate = studentRepo.getAll().find((s) => s.admissionNumber === data.admissionNumber && s.id !== editingId);
    if (duplicate) errors.push({ field: 'admissionNumber', message: 'This admission number is already used by another student.' });
  }
  if (!data.classId) errors.push({ field: 'classId', message: 'Select a class.' });
  if (!data.admissionDate) errors.push({ field: 'admissionDate', message: 'Admission date is required.' });
  return errors;
}

export async function validateStudentRemote(data, editingId) {
  const errors = [];
  if (!data.firstName?.trim()) errors.push({ field: 'firstName', message: 'First name is required.' });
  if (!data.lastName?.trim()) errors.push({ field: 'lastName', message: 'Last name is required.' });
  if (!data.admissionNumber?.trim()) {
    errors.push({ field: 'admissionNumber', message: 'Admission number is required.' });
  } else {
    const duplicate = (await supabaseStudentRepo.getAll()).find(
      (student) => student.admissionNumber?.trim().toLowerCase() === data.admissionNumber.trim().toLowerCase() && student.id !== editingId
    );
    if (duplicate) errors.push({ field: 'admissionNumber', message: 'This admission number is already used by another student.' });
  }
  if (!data.classId) errors.push({ field: 'classId', message: 'Select a class.' });
  if (!data.admissionDate) errors.push({ field: 'admissionDate', message: 'Admission date is required.' });
  return errors;
}

export function activeStudents() {
  return StorageManager.filter(COLLECTION, (s) => s.status === 'active');
}

export function studentsForClass(classId) {
  return StorageManager.filter(COLLECTION, (s) => s.classId === classId && s.status === 'active');
}

export function studentsForStream(streamId) {
  return StorageManager.filter(COLLECTION, (s) => s.streamId === streamId && s.status === 'active');
}

export function fullName(s) {
  return [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' ');
}
