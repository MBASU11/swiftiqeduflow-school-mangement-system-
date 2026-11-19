import { SupabaseRepository } from '../storage/SupabaseRepository.js';
import { getSupabaseClient } from './supabaseClient.js';

const COLLECTIONS = ['classes', 'subjects', 'students', 'terms', 'gradingSystems', 'gradeBands', 'examinations', 'examScores', 'reportCards', 'attendance'];

export async function loadExamWorkspace() {
  const values = await Promise.all(COLLECTIONS.map((collection) => new SupabaseRepository(collection).getAll()));
  const data = Object.fromEntries(COLLECTIONS.map((collection, index) => [collection, values[index]]));
  data.classes.sort((a, b) => a.order - b.order);
  data.examinations.sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
  return data;
}

export function remoteSubjectsForClass(data, classId) {
  return data.subjects.filter((subject) => (subject.classIds ?? []).includes(classId));
}

export function remoteStudentsForExamClass(data, classId) {
  return data.students.filter((student) => student.classId === classId && student.status === 'active');
}

export function remoteScoresForExam(data, examinationId, subjectId) {
  return new Map(data.examScores.filter((score) => score.examinationId === examinationId && score.subjectId === subjectId).map((score) => [score.studentId, score]));
}

export function remoteBandsForSystem(data, gradingSystemId) {
  return data.gradeBands.filter((band) => band.gradingSystemId === gradingSystemId).sort((a, b) => b.min - a.min);
}

export function remoteGradeForScore(data, gradingSystemId, score) {
  if (score === null || score === undefined || !gradingSystemId) return null;
  const band = remoteBandsForSystem(data, gradingSystemId).find((candidate) => score >= candidate.min && score <= candidate.max);
  return band ? { grade: band.grade, points: band.points ?? null } : null;
}

export async function createRemoteExamination(examination) {
  return new SupabaseRepository('examinations').create(examination, 'created examination');
}

export async function createRemoteGradingSystem(system) {
  return new SupabaseRepository('gradingSystems').create(system, 'created grading system');
}

export async function createRemoteGradeBand(band) {
  return new SupabaseRepository('gradeBands').create(band, 'created grade band');
}

export async function removeRemoteGradeBand(id) {
  return new SupabaseRepository('gradeBands').remove(id, 'removed grade band');
}

export async function setRemoteDefaultGradingSystem(id) {
  const client = await getSupabaseClient();
  const { error } = await client.rpc('set_default_grading_system', { target_system_id: id });
  if (error) throw error;
}

export async function saveRemoteExamScores(examinationId, subjectId, values) {
  const client = await getSupabaseClient();
  const scores = Object.fromEntries(Object.entries(values).map(([studentId, raw]) => [studentId, raw.trim() === '' ? null : Number(raw)]));
  const { data, error } = await client.rpc('save_examination_scores', {
    target_examination_id: examinationId,
    target_subject_id: subjectId,
    student_scores: scores,
  });
  if (error) throw error;
  return data;
}

export async function saveRemoteReportCardComment(examinationId, studentId, patch) {
  const repo = new SupabaseRepository('reportCards');
  const existing = (await repo.getAll()).find((record) => record.examinationId === examinationId && record.studentId === studentId);
  if (existing) return repo.update(existing.id, patch, 'updated report card comment');
  return repo.create({ examinationId, studentId, teacherComment: '', principalComment: '', ...patch }, 'added report card comment');
}

export function remoteExamReport(data, examinationId, classId, studentId, gradingSystemId) {
  const rows = remoteSubjectsForClass(data, classId).map((subject) => {
    const score = data.examScores.find((entry) => entry.examinationId === examinationId && entry.subjectId === subject.id && entry.studentId === studentId)?.score ?? null;
    const grade = remoteGradeForScore(data, gradingSystemId, score);
    return { subjectId: subject.id, subjectName: subject.name, score, grade: grade?.grade ?? null, points: grade?.points ?? null };
  });
  const scored = rows.filter((row) => row.score !== null);
  const total = scored.reduce((sum, row) => sum + Number(row.score), 0);
  const average = scored.length ? Math.round((total / scored.length) * 10) / 10 : null;
  return { rows, total, average, overallGrade: remoteGradeForScore(data, gradingSystemId, average)?.grade ?? null };
}

export function remoteAttendanceSummary(data, classId, startDate, endDate) {
  const grouped = new Map();
  data.attendance.filter((record) => record.classId === classId && record.date >= startDate && record.date <= endDate).forEach((record) => {
    const list = grouped.get(record.studentId) ?? [];
    list.push(record);
    grouped.set(record.studentId, list);
  });
  return Array.from(grouped, ([studentId, records]) => {
    const present = records.filter((record) => record.status === 'present').length;
    const late = records.filter((record) => record.status === 'late').length;
    return { studentId, present, late, total: records.length, percentage: records.length ? Math.round(((present + late) / records.length) * 100) : null };
  });
}