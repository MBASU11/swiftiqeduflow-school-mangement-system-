import { LocalStorageRepository } from '../storage/Repository.js';
import { assessmentLockMessage } from './reportRunService.js';

export const assessmentRepo = new LocalStorageRepository('assessments', 'assessment');
export const assessmentScoreRepo = new LocalStorageRepository('assessmentScores', 'score');

export function getAssessmentsFor(classId, subjectId) {
  return assessmentRepo
    .find((a) => a.classId === classId && (!subjectId || a.subjectId === subjectId))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

export function getScoresFor(assessmentId) {
  const scores = assessmentScoreRepo.find((s) => s.assessmentId === assessmentId);
  return new Map(scores.map((s) => [s.studentId, s]));
}

function validateDefinitionChange(assessment, patch) {
  const maxScore = Number(patch.maxScore ?? assessment.maxScore);
  if (!Number.isFinite(maxScore) || maxScore <= 0) throw new Error('Maximum score must be more than zero.');
  const scores = assessmentScoreRepo.find((score) => score.assessmentId === assessment.id);
  if (patch.classId !== undefined && patch.classId !== assessment.classId && scores.length) throw new Error('Class cannot be changed while score records are linked to this assessment.');
  const unsafe = scores.find((score) => score.score != null && Number(score.score) > maxScore);
  if (unsafe) throw new Error(`Maximum score cannot be reduced below a saved mark (${unsafe.score}). Correct the saved mark first.`);
  return scores;
}

export function updateAssessmentDefinition(id, patch) {
  const assessment = assessmentRepo.getById(id);
  if (!assessment) throw new Error('That assessment no longer exists.');
  const locked = assessmentLockMessage(id);
  if (locked) throw new Error(locked);
  validateDefinitionChange(assessment, patch);
  return assessmentRepo.update(id, patch, 'updated assessment');
}

export function deleteAssessmentDefinition(id) {
  const assessment = assessmentRepo.getById(id);
  if (!assessment) throw new Error('That assessment no longer exists.');
  const locked = assessmentLockMessage(id);
  if (locked) throw new Error(locked);
  const scores = assessmentScoreRepo.find((score) => score.assessmentId === id);
  if (scores.length) throw new Error(`This assessment has ${scores.length} linked score record(s). Delete is disabled until those scores are safely handled.`);
  return assessmentRepo.remove(id, 'removed assessment');
}

export function validateScores(values, maxScore) {
  const errors = [];
  Object.entries(values).forEach(([studentId, raw]) => {
    if (raw.trim() === '') return; // blank is allowed (not yet entered)
    const num = Number(raw);
    if (Number.isNaN(num)) {
      errors.push({ studentId, message: 'Not a number' });
    } else if (num < 0 || num > maxScore) {
      errors.push({ studentId, message: `Must be 0–${maxScore}` });
    }
  });
  return errors;
}

// Upserts one AssessmentScore per student. Idempotent — re-saving updates
// existing rows instead of creating duplicates, same pattern as attendance.
export function saveScores(assessmentId, values) {
  const locked = assessmentLockMessage(assessmentId); // frozen once a report that uses this assessment is submitted
  if (locked) throw new Error(locked);
  const existing = getScoresFor(assessmentId);
  Object.entries(values).forEach(([studentId, raw]) => {
    const score = raw.trim() === '' ? null : Number(raw);
    const current = existing.get(studentId);
    if (current) {
      if (current.score !== score) assessmentScoreRepo.update(current.id, { score }, 'updated score');
    } else {
      assessmentScoreRepo.create({ assessmentId, studentId, score }, 'entered score');
    }
  });
}

export function classAverage(assessmentId) {
  const scores = Array.from(getScoresFor(assessmentId).values()).filter((s) => s.score !== null);
  if (scores.length === 0) return null;
  const sum = scores.reduce((acc, s) => acc + (s.score ?? 0), 0);
  return Math.round((sum / scores.length) * 10) / 10;
}
