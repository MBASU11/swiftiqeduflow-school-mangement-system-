import { SupabaseRepository } from '../storage/SupabaseRepository.js';
import { getSupabaseClient } from './supabaseClient.js';

export async function loadAssessmentWorkspace() {
  const collections = ['classes', 'subjects', 'assessments', 'assessmentScores', 'students', 'terms'];
  const values = await Promise.all(collections.map((collection) => new SupabaseRepository(collection).getAll()));
  const data = Object.fromEntries(collections.map((collection, index) => [collection, values[index]]));
  data.classes.sort((a, b) => a.order - b.order);
  return data;
}

export function subjectsForClass(data, classId) {
  return data.subjects.filter((subject) => (subject.classIds ?? []).includes(classId));
}

export function assessmentsForClass(data, classId, subjectId = '') {
  return data.assessments
    .filter((assessment) => assessment.classId === classId && (!subjectId || assessment.subjectId === subjectId))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

export function scoresForAssessment(data, assessmentId) {
  return new Map(data.assessmentScores
    .filter((score) => score.assessmentId === assessmentId)
    .map((score) => [score.studentId, score]));
}

export function averageForAssessment(data, assessmentId) {
  const scores = Array.from(scoresForAssessment(data, assessmentId).values()).filter((score) => score.score !== null && score.score !== undefined);
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((sum, score) => sum + Number(score.score), 0) / scores.length) * 10) / 10;
}

export async function createRemoteAssessment(details) {
  const maxScore = Number(details.maxScore);
  if (!Number.isFinite(maxScore) || maxScore <= 0) throw new Error('Maximum score must be more than zero.');
  const repo = new SupabaseRepository('assessments');
  return repo.create({ ...details, maxScore }, 'created assessment');
}

export async function updateRemoteAssessment(id, patch) {
  const repo = new SupabaseRepository('assessments');
  const [assessment, data] = await Promise.all([repo.getById(id), loadAssessmentWorkspace()]);
  if (!assessment) throw new Error('That assessment no longer exists.');
  const maxScore = Number(patch.maxScore ?? assessment.maxScore);
  if (!Number.isFinite(maxScore) || maxScore <= 0) throw new Error('Maximum score must be more than zero.');
  const scores = data.assessmentScores.filter((score) => score.assessmentId === id);
  if (patch.classId !== undefined && patch.classId !== assessment.classId && scores.length) throw new Error('Class cannot be changed while score records are linked to this assessment.');
  const unsafe = scores.find((score) => score.score != null && Number(score.score) > maxScore);
  if (unsafe) throw new Error(`Maximum score cannot be reduced below a saved mark (${unsafe.score}). Correct the saved mark first.`);
  return repo.update(id, patch, 'updated assessment');
}

export async function deleteRemoteAssessment(id) {
  const repo = new SupabaseRepository('assessments');
  const [assessment, data] = await Promise.all([repo.getById(id), loadAssessmentWorkspace()]);
  if (!assessment) throw new Error('That assessment no longer exists.');
  const scores = data.assessmentScores.filter((score) => score.assessmentId === id);
  if (scores.length) throw new Error(`This assessment has ${scores.length} linked score record(s). Delete is disabled until those scores are safely handled.`);
  return repo.remove(id, 'removed assessment');
}

export async function saveRemoteAssessmentScores(assessmentId, values) {
  const studentScores = Object.fromEntries(Object.entries(values).map(([studentId, raw]) => [
    studentId,
    raw.trim() === '' ? null : Number(raw),
  ]));
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc('save_assessment_scores', {
    target_assessment_id: assessmentId,
    student_scores: studentScores,
  });
  if (error) throw error;
  return data;
}

export function remoteStudentsForAssessment(data, assessment) {
  return data.students.filter((student) => student.classId === assessment.classId && student.status === 'active');
}