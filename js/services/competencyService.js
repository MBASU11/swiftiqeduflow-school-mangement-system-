// CBC competency tracking (local and cloud use the same calls through the teacher service's repositories).
// Who may rate: administrators any class; a teacher only learners in classes (and subjects) they are allocated to.
// Ratings freeze for a class and term once that class's report is submitted, exactly like marks.
import { loadTeacher, saveRecord, allRecords } from './teacherService.js';
import { isSupabaseConfigured } from '../config/supabase.js';
import { reportRunRepo, examinationRepo } from './examService.js';
import { isLockedRun, lockMessage } from './academicEngine.js';
import { pairAllowed } from './teacherLogic.js';
import * as L from './competencyLogic.js';

export const SCALE = L.DEFAULT_RATING_SCALE;
const today = () => new Date().toISOString().slice(0, 10);

export async function loadCompetency() {
  const d = await loadTeacher();
  const [outcomes, ratings] = await Promise.all([allRecords('learningOutcomes'), allRecords('competencyRatings')]);
  const planned = await allRecords('lessonPlans');
  return { ...d, outcomes, ratings, lessonPlans: planned };
}

// The run that freezes this class's ratings for this term, if there is one (demo mode; the cloud has no runs yet).
export function lockedRunFor(classId, termId) {
  if (isSupabaseConfigured() || !termId) return null;
  return reportRunRepo.getAll().find((r) => r.classId === classId && isLockedRun(r) && examinationRepo.getById(r.examinationId)?.termId === termId) ?? null;
}

// ---- outcomes -------------------------------------------------------------------------------------------------------------
export async function saveOutcome(d, o) {
  if (!(o.classIds ?? []).every((c) => pairAllowed(d.scope, c, o.subjectId))) throw new Error('You are not allocated to teach this subject in one of those classes.');
  const clean = { ...o, description: String(o.description ?? '').trim(), strand: String(o.strand ?? '').trim(), subStrand: String(o.subStrand ?? '').trim(), status: o.status ?? 'active' };
  const e = L.validateOutcomeRecord(clean); if (e) throw new Error(e);
  return saveRecord('learningOutcomes', clean, clean.id ? 'updated learning outcome' : 'added learning outcome');
}
// Adds many at once from pasted lines; nothing is saved if any line is wrong, so the teacher fixes the list in one go.
export async function addOutcomes(d, { text, curriculumId, subjectId, classIds }) {
  if (!classIds.every((c) => pairAllowed(d.scope, c, subjectId))) return { ok: false, errors: ['You are not allocated to teach this subject in one of those classes.'] };
  const existing = (await allRecords('learningOutcomes')).filter((o) => o.subjectId === subjectId && o.curriculumId === curriculumId);
  const { outcomes, errors } = L.parseOutcomeLines(text, existing);
  if (errors.length) return { ok: false, errors };
  if (!outcomes.length) return { ok: false, errors: ['Paste at least one outcome.'] };
  for (const o of outcomes) { const e = L.validateOutcomeRecord({ ...o, curriculumId, subjectId, classIds }); if (e) return { ok: false, errors: [e] }; }
  for (const o of outcomes) await saveRecord('learningOutcomes', { ...o, curriculumId, subjectId, classIds, status: 'active' }, 'added learning outcome');
  return { ok: true, added: outcomes.length };
}
export const setOutcomeStatus = async (outcome, status) => saveRecord('learningOutcomes', { ...outcome, status }, status === 'archived' ? 'archived learning outcome' : 'restored learning outcome');

// ---- ratings --------------------------------------------------------------------------------------------------------------
// Returns { ok, changed } or { ok:false, reason }. Re-tapping the same level changes nothing and writes nothing.
export async function rate(d, { studentId, outcomeId, termId, level, comment = '' }) {
  const student = d.studentById[studentId]; const outcome = d.outcomes.find((o) => o.id === outcomeId);
  if (!student || !outcome) return { ok: false, reason: 'Learner or outcome not found.' };
  if (!SCALE.some((s) => s.key === level)) return { ok: false, reason: 'Choose a rating.' };
  if (!termId) return { ok: false, reason: 'Choose the term.' };
  if (outcome.status === 'archived') return { ok: false, reason: 'This outcome is archived.' };
  if ((outcome.classIds ?? []).length && !outcome.classIds.includes(student.classId)) return { ok: false, reason: 'This outcome is not for that learner\'s class.' };
  if (!pairAllowed(d.scope, student.classId, outcome.subjectId)) return { ok: false, reason: 'You are not allocated to teach this subject in that class.' };
  const run = lockedRunFor(student.classId, termId); if (run) return { ok: false, reason: lockMessage(run) };
  const prev = L.latestRatings(d.ratings).find((r) => r.studentId === studentId && r.outcomeId === outcomeId && (r.termId ?? '') === termId);
  if (prev?.level === level && !comment) return { ok: true, changed: false };
  const saved = await saveRecord('competencyRatings', { studentId, outcomeId, termId, level, comment: String(comment).trim(), classId: student.classId, subjectId: outcome.subjectId, date: today() }, 'rated learner');
  d.ratings = [...d.ratings, saved ?? { studentId, outcomeId, termId, level, date: today() }]; // keep the open screen in step without a reload
  return { ok: true, changed: true };
}

// ---- coverage -------------------------------------------------------------------------------------------------------------
// What was actually planned and taught for a class and subject: lesson plans that name outcomes, and scheme-of-work weeks done.
export function coverageFor(d, { classId, subjectId, termId }) {
  const outcomes = L.outcomesFor(d.outcomes, { classId, subjectId });
  const plans = d.lessonPlans.filter((p) => p.classId === classId && p.subjectId === subjectId && (!termId || !p.termId || p.termId === termId));
  const schemes = (d.schemesOfWork ?? []).filter((s) => s.classId === classId && s.subjectId === subjectId && (!termId || !s.termId || s.termId === termId));
  return { outcomes: L.outcomeCoverage(outcomes, plans), scheme: L.schemeCoverage(schemes), plans: plans.length };
}
