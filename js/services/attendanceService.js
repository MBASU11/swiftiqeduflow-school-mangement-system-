import { LocalStorageRepository } from '../storage/Repository.js';
import { getCurrentTerm } from './academicService.js';
import { studentsForClass, studentsForStream } from './studentService.js';

const COLLECTION = 'attendance';
export const attendanceRepo = new LocalStorageRepository(COLLECTION, 'attendance record');

export function getRosterFor(classId, streamId) {
  return streamId ? studentsForStream(streamId) : studentsForClass(classId);
}

export function getRecordsFor(classId, date) {
  const records = attendanceRepo.find((r) => r.classId === classId && r.date === date);
  return new Map(records.map((r) => [r.studentId, r]));
}

// Creates or updates one attendance record per student for the given class/date.
// A student can only have one record per day per class — save() is idempotent.
export function saveAttendance(classId, streamId, date, statuses) {
  const existing = getRecordsFor(classId, date);
  const termId = getCurrentTerm()?.id;

  Object.entries(statuses).forEach(([studentId, status]) => {
    const current = existing.get(studentId);
    if (current) {
      if (current.status !== status) attendanceRepo.update(current.id, { status }, 'updated attendance');
    } else {
      attendanceRepo.create({ studentId, classId, streamId, date, status, termId }, 'recorded attendance');
    }
  });
}

export function summarizeAttendance(classId, startDate, endDate) {
  const records = attendanceRepo.find((r) => r.classId === classId && r.date >= startDate && r.date <= endDate);
  const byStudent = new Map();
  records.forEach((r) => {
    const list = byStudent.get(r.studentId) ?? [];
    list.push(r);
    byStudent.set(r.studentId, list);
  });

  return Array.from(byStudent.entries()).map(([studentId, recs]) => {
    const present = recs.filter((r) => r.status === 'present').length;
    const absent = recs.filter((r) => r.status === 'absent').length;
    const late = recs.filter((r) => r.status === 'late').length;
    const excused = recs.filter((r) => r.status === 'excused').length;
    const total = recs.length;
    return {
      studentId,
      present,
      absent,
      late,
      excused,
      total,
      percentage: total > 0 ? Math.round(((present + late) / total) * 100) : null,
    };
  });
}
