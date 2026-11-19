import { LocalStorageRepository } from '../storage/Repository.js';

export const timetableEntryRepo = new LocalStorageRepository('timetableEntries', 'timetable entry');

export const DAYS = [
  ['MO', 'Monday'],
  ['TU', 'Tuesday'],
  ['WE', 'Wednesday'],
  ['TH', 'Thursday'],
  ['FR', 'Friday'],
  ['SA', 'Saturday'],
];

function timesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

export const isBreak = (entry) => entry.kind === 'break';

export const BREAK_PRESETS = ['Short break', 'Tea break', 'Lunch break', 'Games / Sports', 'Assembly', 'Prep'];

// Checks a candidate entry against existing entries on the same day and
// returns a human-readable reason for each clash found. A class, its teacher,
// or a room can each only be in one place at a time. Breaks have no teacher or
// room, so they only clash with the same class's own periods.
// `entries` defaults to the browser-local store; remote mode passes its own.
export function findConflicts(entries, candidate, excludeId) {
  const conflicts = [];
  if (!(candidate.startTime < candidate.endTime)) {
    conflicts.push('End time must be after start time.');
    return conflicts;
  }
  entries
    .filter((e) => e.day === candidate.day && e.id !== excludeId)
    .forEach((e) => {
      if (!timesOverlap(candidate.startTime, candidate.endTime, e.startTime, e.endTime)) return;
      if (e.classId === candidate.classId) conflicts.push(`Class already has a period at this time (${e.startTime}-${e.endTime}).`);
      if (!isBreak(candidate) && !isBreak(e)) {
        if (e.teacherId && candidate.teacherId && e.teacherId === candidate.teacherId) {
          conflicts.push(`Teacher is already teaching another class at this time (${e.startTime}-${e.endTime}).`);
        }
        if (e.room && candidate.room && e.room.toLowerCase() === candidate.room.toLowerCase()) {
          conflicts.push(`Room "${e.room}" is already booked at this time (${e.startTime}-${e.endTime}).`);
        }
      }
    });
  return [...new Set(conflicts)];
}

export function checkConflicts(candidate, excludeId) {
  return findConflicts(timetableEntryRepo.getAll(), candidate, excludeId);
}

export function getEntriesForClass(classId) {
  return timetableEntryRepo.find((e) => e.classId === classId).sort(sortByDayThenTime);
}

export function getEntriesForTeacher(teacherId) {
  return timetableEntryRepo.find((e) => e.teacherId === teacherId).sort(sortByDayThenTime);
}

function sortByDayThenTime(a, b) {
  const dayOrder = DAYS.map(([code]) => code);
  const dayDiff = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
  if (dayDiff !== 0) return dayDiff;
  return a.startTime.localeCompare(b.startTime);
}
