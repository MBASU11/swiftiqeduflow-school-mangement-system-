import { LocalStorageRepository } from '../storage/Repository.js';
import { currentAccount } from './authService.js';

export const disciplineRepo = new LocalStorageRepository('discipline', 'discipline record');

export const CATEGORIES = [
  ['fighting', 'Fighting'],
  ['bullying', 'Bullying'],
  ['vandalism', 'Vandalism'],
  ['absenteeism', 'Absenteeism'],
  ['dress_code', 'Dress code'],
  ['academic_dishonesty', 'Academic dishonesty'],
  ['disrespect', 'Disrespect / insubordination'],
  ['other', 'Other'],
];

export function getRecordsForStudent(studentId) {
  return disciplineRepo.find((r) => r.studentId === studentId).sort((a, b) => b.date.localeCompare(a.date));
}

export function allRecordsSorted() {
  return disciplineRepo.getAll().sort((a, b) => b.date.localeCompare(a.date));
}

export async function correctDisciplineRecord(repository, id, patch) {
  const record = await repository.getById(id);
  if (!record) throw new Error('This discipline record no longer exists.');
  const fields = ['studentId', 'date', 'category', 'incident', 'description', 'action', 'parentNotified', 'followUpDate'];
  const changed = Object.fromEntries(fields.filter((key) => record[key] !== patch[key]).map((key) => [key, record[key] ?? null]));
  if (!Object.keys(changed).length) return record;
  const correction = {
    at: new Date().toISOString(),
    by: currentAccount()?.name ?? 'Administrator',
    reason: String(patch.correctionReason ?? '').trim(),
    previous: changed,
  };
  return repository.update(id, {
    ...patch,
    status: record.status,
    correctionReason: undefined,
    corrections: [...(record.corrections ?? []), correction],
  }, 'corrected discipline record');
}
