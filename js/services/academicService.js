import { LocalStorageRepository } from '../storage/Repository.js';
import { getSupabaseClient } from './supabaseClient.js';

export const curriculumRepo = new LocalStorageRepository('curricula', 'curriculum');
export const academicYearRepo = new LocalStorageRepository('academicYears', 'academic year');
export const termRepo = new LocalStorageRepository('terms', 'term');
export const classRepo = new LocalStorageRepository('classes', 'class');
export const streamRepo = new LocalStorageRepository('streams', 'stream');
export const subjectRepo = new LocalStorageRepository('subjects', 'subject');

export function getCurrentAcademicYear() {
  return academicYearRepo.find((y) => y.isCurrent)[0];
}

export function setCurrentAcademicYear(id) {
  academicYearRepo.getAll().forEach((y) => {
    if (y.isCurrent && y.id !== id) academicYearRepo.update(y.id, { isCurrent: false });
  });
  academicYearRepo.update(id, { isCurrent: true });
}

export function getCurrentTerm() {
  return termRepo.find((t) => t.isCurrent)[0];
}

export function setCurrentTerm(id) {
  termRepo.getAll().forEach((t) => {
    if (t.isCurrent && t.id !== id) termRepo.update(t.id, { isCurrent: false });
  });
  termRepo.update(id, { isCurrent: true });
}

export function getStreamsForClass(classId) {
  return streamRepo.find((s) => s.classId === classId);
}

export function getSubjectsForClass(classId) {
  return subjectRepo.find((s) => s.classIds.includes(classId));
}

export function classesSortedByOrder() {
  return classRepo.getAll().sort((a, b) => a.order - b.order);
}

export function nextClassOrder() {
  const all = classRepo.getAll();
  return all.length === 0 ? 1 : Math.max(...all.map((c) => c.order)) + 1;
}

export function getTermsForYear(yearId) {
  return termRepo.find((t) => t.academicYearId === yearId);
}

export function academicYearsSorted() {
  return academicYearRepo.getAll().sort((a, b) => b.label.localeCompare(a.label));
}

export async function setCurrentAcademicRecordRemote(collection, id) {
  const client = await getSupabaseClient();
  const { error } = await client.rpc('set_current_academic_record', {
    target_collection: collection,
    target_record_id: id,
  });
  if (error) throw error;
}

export async function removeClassRemote(id) {
  const client = await getSupabaseClient();
  const { error } = await client.rpc('remove_class_and_streams', { target_class_id: id });
  if (error) throw error;
}
