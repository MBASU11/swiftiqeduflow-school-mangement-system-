import { SupabaseRepository } from '../storage/SupabaseRepository.js';
import { getSupabaseClient } from './supabaseClient.js';
import { findConflicts } from './timetableService.js';

export async function loadTimetableWorkspace() {
  const collections = ['classes', 'subjects', 'teachers', 'students', 'timetableEntries', 'school', 'terms', 'academicYears'];
  const values = await Promise.all(collections.map((collection) => new SupabaseRepository(collection).getAll()));
  const data = Object.fromEntries(collections.map((collection, index) => [collection, values[index]]));
  data.classes.sort((a, b) => a.order - b.order);
  return data;
}

export async function createRemoteTimetableEntry(entry) {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc('create_timetable_entry', { entry_payload: entry });
  if (error) throw error;
  return data;
}

export async function updateRemoteTimetableEntry(id, entry) {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc('update_timetable_entry', { target_entry_id: id, entry_payload: entry });
  if (error) throw error;
  return data;
}

export async function removeRemoteTimetableEntry(id) {
  return new SupabaseRepository('timetableEntries').remove(id, 'removed timetable period');
}

export function remoteEntriesForClass(data, classId) {
  return data.timetableEntries.filter((entry) => entry.classId === classId).sort((a, b) => a.day.localeCompare(b.day) || a.startTime.localeCompare(b.startTime));
}

export function remoteEntriesForTeacher(data, teacherId) {
  return data.timetableEntries.filter((entry) => entry.teacherId === teacherId).sort((a, b) => a.day.localeCompare(b.day) || a.startTime.localeCompare(b.startTime));
}

export function remoteTimetableConflicts(entries, candidate, excludeId) {
  return findConflicts(entries, candidate, excludeId);
}
