import { LocalStorageRepository } from '../storage/Repository.js';
import { StorageManager } from '../storage/StorageManager.js';
import { getSubjectsForClass } from './academicService.js';
import { studentRepo } from './studentService.js';
import { isLockedRun, lockMessage } from './academicEngine.js';

export const gradingSystemRepo = new LocalStorageRepository('gradingSystems', 'grading system');
export const gradeBandRepo = new LocalStorageRepository('gradeBands', 'grade band');
export const examinationRepo = new LocalStorageRepository('examinations', 'examination');
export const examScoreRepo = new LocalStorageRepository('examScores', 'exam score');
export const reportCardRepo = new LocalStorageRepository('reportCards', 'report card comment');
// Subject-teacher comments for the report card (draft until the teacher marks them ready).
// School-wide report rules and weighted-assessment schemes (administrator only).
export const reportPolicyRepo = new LocalStorageRepository('reportPolicy', 'report policy');
export const weightingSchemeRepo = new LocalStorageRepository('weightingSchemes', 'weighting scheme');
export const reportCommentRepo = new LocalStorageRepository('reportComments', 'report comment');
// One record per examination + class: where its report is in draft → moderation → approved → published (demo mode).
export const reportRunRepo = new LocalStorageRepository('reportRuns', 'report run');
export const runFor = (examinationId, classId) => reportRunRepo.getAll().find((r) => r.examinationId === examinationId && r.classId === classId);
export const lockedRunFor = (examinationId, classId) => { const r = runFor(examinationId, classId); return isLockedRun(r) ? r : null; };

export function getGradingSystems() {
  return gradingSystemRepo.getAll();
}

export function getDefaultGradingSystem() {
  const all = gradingSystemRepo.getAll();
  return all.find((g) => g.isDefault) ?? all[0];
}

export const DEFAULT_CBC_BANDS = [
  { min: 0, max: 24, grade: 'BE', points: 1, description: 'Below expectation' },
  { min: 25, max: 49, grade: 'AE', points: 2, description: 'Approaching expectation' },
  { min: 50, max: 74, grade: 'ME', points: 3, description: 'Meeting expectation' },
  { min: 75, max: 100, grade: 'EE', points: 4, description: 'Exceeding expectation' },
];

export function ensureDefaultCBCGradingSystem() {
  const existing = getGradingSystems();
  if (existing.length) return existing.find((system) => system.isDefault) ?? existing[0];
  const system = gradingSystemRepo.create({ name: 'Kenya CBC / CBE', isDefault: true, builtIn: true });
  DEFAULT_CBC_BANDS.forEach((band) => gradeBandRepo.create({ gradingSystemId: system.id, ...band }));
  return system;
}

export function makeDefaultGradingSystem(id) {
  gradingSystemRepo.getAll().forEach((g) => {
    if (g.isDefault && g.id !== id) gradingSystemRepo.update(g.id, { isDefault: false });
  });
  gradingSystemRepo.update(id, { isDefault: true });
}

export function getGradeBandsFor(gradingSystemId) {
  return gradeBandRepo.find((b) => b.gradingSystemId === gradingSystemId).sort((a, b) => b.min - a.min);
}

export function gradeForScore(gradingSystemId, score) {
  if (score === null || score === undefined || !gradingSystemId) return null;
  const band = getGradeBandsFor(gradingSystemId).find((b) => score >= b.min && score <= b.max);
  return band ? { grade: band.grade, points: band.points ?? null } : null;
}

export function getExaminationsFor(termId) {
  return examinationRepo.find((e) => !termId || e.termId === termId).sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
}

export function getExamScoresFor(examinationId, subjectId) {
  const scores = examScoreRepo.find((s) => s.examinationId === examinationId && s.subjectId === subjectId);
  return new Map(scores.map((s) => [s.studentId, s]));
}

// Idempotent, same pattern as attendance/assessment scores.
export function saveExamScores(examinationId, subjectId, values) {
  // Marks are frozen once a class's report is submitted; nothing is written if any learner's class is locked.
  const studentClass = new Map(studentRepo.getAll().map((s) => [s.id, s.classId]));
  const locked = Object.keys(values).map((id) => lockedRunFor(examinationId, studentClass.get(id))).find(Boolean);
  if (locked) throw new Error(lockMessage(locked));
  const existing = getExamScoresFor(examinationId, subjectId);
  Object.entries(values).forEach(([studentId, raw]) => {
    const score = raw.trim() === '' ? null : Number(raw);
    const current = existing.get(studentId);
    if (current) {
      if (current.score !== score) examScoreRepo.update(current.id, { score }, 'updated exam score');
    } else {
      examScoreRepo.create({ examinationId, subjectId, studentId, score }, 'entered exam score');
    }
  });
}

export function computeStudentReport(examinationId, classId, studentId, gradingSystemId) {
  const subjects = getSubjectsForClass(classId);
  const rows = subjects.map((subject) => {
    const record = StorageManager.filter(
      'examScores',
      (s) => s.examinationId === examinationId && s.subjectId === subject.id && s.studentId === studentId
    )[0];
    const score = record?.score ?? null;
    const graded = gradeForScore(gradingSystemId, score);
    return { subjectId: subject.id, subjectName: subject.name, score, grade: graded?.grade ?? null, points: graded?.points ?? null };
  });
  const scored = rows.filter((r) => r.score !== null);
  const total = scored.reduce((sum, r) => sum + r.score, 0);
  const average = scored.length > 0 ? Math.round((total / scored.length) * 10) / 10 : null;
  const overall = gradeForScore(gradingSystemId, average);
  return { rows, total, average, overallGrade: overall?.grade ?? null };
}

export function getReportCardComment(examinationId, studentId) {
  return reportCardRepo.find((r) => r.examinationId === examinationId && r.studentId === studentId)[0];
}

export function saveReportCardComment(examinationId, studentId, patch) {
  // After submission only the principal's comment may still change (and not once published).
  const locked = lockedRunFor(examinationId, studentRepo.getById(studentId)?.classId);
  if (locked) {
    const cur = getReportCardComment(examinationId, studentId);
    const changesOther = Object.keys(patch).some((k) => k !== 'principalComment' && (patch[k] ?? '') !== (cur?.[k] ?? ''));
    if (changesOther || locked.status === 'published') throw new Error(lockMessage(locked));
  }
  const existing = getReportCardComment(examinationId, studentId);
  if (existing) {
    return reportCardRepo.update(existing.id, patch, 'updated report card comment');
  }
  return reportCardRepo.create({ examinationId, studentId, teacherComment: '', principalComment: '', ...patch }, 'added report card comment');
}
