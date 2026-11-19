import { SupabaseRepository } from '../storage/SupabaseRepository.js';
import { getSupabaseClient } from './supabaseClient.js';

export async function loadAttendanceWorkspace() {
  const collections = ['classes', 'streams', 'students', 'attendance', 'terms'];
  const records = await Promise.all(collections.map((collection) => new SupabaseRepository(collection).getAll()));
  const data = Object.fromEntries(collections.map((collection, index) => [collection, records[index]]));
  data.classes.sort((a, b) => a.order - b.order);
  data.terms.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return data;
}

export async function saveRemoteAttendance(classId, streamId, date, statuses, terms) {
  const currentTermId = terms.find((term) => term.isCurrent)?.id ?? null;
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc('save_class_attendance', {
    target_class_id: classId,
    target_stream_id: streamId || null,
    attendance_date: date,
    student_statuses: statuses,
    current_term_id: currentTermId,
  });
  if (error) throw error;
  return data;
}

export function rosterForClass(data, classId, streamId = '') {
  return data.students.filter((student) =>
    student.status === 'active'
    && student.classId === classId
    && (!streamId || student.streamId === streamId)
  );
}

export function attendanceForClassDate(data, classId, date) {
  return new Map(data.attendance
    .filter((record) => record.classId === classId && record.date === date)
    .map((record) => [record.studentId, record]));
}

export function summarizeRemoteAttendance(records, classId, startDate, endDate) {
  const byStudent = new Map();
  records.filter((record) => record.classId === classId && record.date >= startDate && record.date <= endDate)
    .forEach((record) => {
      const list = byStudent.get(record.studentId) ?? [];
      list.push(record);
      byStudent.set(record.studentId, list);
    });

  return Array.from(byStudent.entries()).map(([studentId, studentRecords]) => {
    const present = studentRecords.filter((record) => record.status === 'present').length;
    const absent = studentRecords.filter((record) => record.status === 'absent').length;
    const late = studentRecords.filter((record) => record.status === 'late').length;
    const excused = studentRecords.filter((record) => record.status === 'excused').length;
    const total = studentRecords.length;
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