// One interface over the two storage modes (browser-local prototype and Supabase),
// so each timetable screen is written once instead of twice.
import { isSupabaseConfigured } from '../config/supabase.js';
import { classesSortedByOrder, subjectRepo, getCurrentTerm, getCurrentAcademicYear } from './academicService.js';
import { teacherRepo } from './peopleService.js';
import { studentRepo } from './studentService.js';
import { getSchool } from './schoolService.js';
import { timetableEntryRepo, findConflicts } from './timetableService.js';
import {
  loadTimetableWorkspace,
  createRemoteTimetableEntry,
  updateRemoteTimetableEntry,
  removeRemoteTimetableEntry,
} from './supabaseTimetableService.js';

export async function loadTimetableData() {
  if (isSupabaseConfigured()) {
    const data = await loadTimetableWorkspace();
    const term = (data.terms ?? []).find((t) => t.isCurrent);
    const year = (data.academicYears ?? []).find((y) => y.isCurrent);
    return {
      classes: data.classes,
      subjects: data.subjects,
      teachers: data.teachers,
      students: data.students,
      entries: data.timetableEntries,
      school: data.school?.[0],
      periodLabel: [term?.name, year?.label].filter(Boolean).join(' · '),
    };
  }
  const term = getCurrentTerm();
  const year = getCurrentAcademicYear();
  return {
    classes: classesSortedByOrder(),
    subjects: subjectRepo.getAll(),
    teachers: teacherRepo.getAll(),
    students: studentRepo.getAll(),
    entries: timetableEntryRepo.getAll(),
    school: getSchool(),
    periodLabel: [term?.name, year?.label].filter(Boolean).join(' · '),
  };
}

export { findConflicts };

export async function createEntry(entry) {
  if (isSupabaseConfigured()) return createRemoteTimetableEntry(entry);
  return timetableEntryRepo.create(entry, entry.kind === 'break' ? 'added timetable break' : 'added timetable period');
}

export async function updateEntry(id, entry) {
  if (isSupabaseConfigured()) return updateRemoteTimetableEntry(id, entry);
  // Local store merges patches, so clear optional fields explicitly.
  return timetableEntryRepo.update(id, { teacherId: undefined, room: undefined, subjectId: undefined, label: undefined, ...entry }, 'updated timetable period');
}

export async function removeEntry(id) {
  if (isSupabaseConfigured()) return removeRemoteTimetableEntry(id);
  return timetableEntryRepo.remove(id, 'removed timetable period');
}
