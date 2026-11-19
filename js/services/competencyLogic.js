// CBC competency tracking: pure rules on top of the academic engine (no storage, no DOM).
// A learning outcome belongs to a curriculum and subject and applies to one or more classes. A learner is rated against it, per
// term, on a scale (default: Below / Approaching / Meeting / Exceeding expectation). Ratings are history: the newest one counts.
import { DEFAULT_RATING_SCALE, validateRatingScale, validateOutcome, latestRatings, outcomeSummary, competencyProfile, outcomeCoverage, schemeCoverage } from './academicEngine.js';
export { DEFAULT_RATING_SCALE, validateRatingScale, latestRatings, outcomeSummary, competencyProfile, outcomeCoverage, schemeCoverage };

// The abbreviations Kenyan teachers use on CBC report forms. A custom scale falls back to the first letters of its label.
const SHORT = { below: 'BE', approaching: 'AE', meeting: 'ME', exceeding: 'EE' };
export const shortLabel = (level, scale = DEFAULT_RATING_SCALE) => { const s = scale.find((x) => x.key === level); return !s ? '' : SHORT[s.key] ?? s.label.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 3); };
export const levelLabel = (level, scale = DEFAULT_RATING_SCALE) => scale.find((x) => x.key === level)?.label ?? '';
export const levelValue = (level, scale = DEFAULT_RATING_SCALE) => scale.find((x) => x.key === level)?.value ?? null;
export const TONE = { below: '#b0413e', approaching: '#8f5c0b', meeting: '#227d80', exceeding: '#1d7447' };

export function validateOutcomeRecord(o) {
  const e = validateOutcome(o); if (e) return e;
  if (String(o.description).trim().length > 400) return 'Keep the outcome under 400 characters.';
  if (String(o.strand ?? '').length > 120 || String(o.subStrand ?? '').length > 120) return 'Keep strand names under 120 characters.';
  if (!(o.classIds ?? []).length) return 'Choose at least one class this outcome applies to.';
  return null;
}

// "Strand | Sub-strand | Outcome", "Strand | Outcome" or just "Outcome", one per line. Reports every bad line instead of stopping at the first.
export function parseOutcomeLines(text, existing = []) {
  const seen = new Set(existing.map((o) => key(o))); const outcomes = []; const errors = [];
  String(text ?? '').split('\n').forEach((raw, i) => {
    const line = raw.trim(); if (!line) return;
    const parts = line.split('|').map((p) => p.trim()); const description = parts[parts.length - 1]; const strand = parts.length > 1 ? parts[0] : ''; const subStrand = parts.length > 2 ? parts[1] : '';
    if (parts.length > 3) return errors.push(`Line ${i + 1}: use at most "Strand | Sub-strand | Outcome".`);
    if (!description) return errors.push(`Line ${i + 1}: the outcome is empty.`);
    if (description.length > 400) return errors.push(`Line ${i + 1}: the outcome is over 400 characters.`);
    const o = { strand, subStrand, description }; if (seen.has(key(o))) return errors.push(`Line ${i + 1}: this outcome already exists.`);
    seen.add(key(o)); outcomes.push(o);
  });
  return { outcomes, errors };
}
const key = (o) => `${(o.strand ?? '').toLowerCase()}|${(o.subStrand ?? '').toLowerCase()}|${String(o.description).trim().toLowerCase()}`;

// Outcomes a learner of this class is rated on in this subject (archived ones are history, not part of the current list).
export const outcomesFor = (outcomes, { classId, subjectId }) => outcomes.filter((o) => o.status !== 'archived' && (!subjectId || o.subjectId === subjectId) && (!(o.classIds ?? []).length || o.classIds.includes(classId)));
export const groupByStrand = (outcomes) => { const m = new Map(); outcomes.forEach((o) => { const k = [o.strand, o.subStrand].filter(Boolean).join(' › ') || 'General'; m.set(k, [...(m.get(k) ?? []), o]); }); return [...m].map(([strand, list]) => ({ strand, list })); };

// One row per outcome for a class: how many are at each level, and how many learners are still unrated.
export function classOverview({ learners, outcomes, ratings, scale = DEFAULT_RATING_SCALE, termId }) {
  const ids = learners.map((l) => l.id);
  const rows = outcomes.map((o) => ({ outcome: o, ...outcomeSummary(o.id, ratings, ids, scale, termId) }));
  return { rows, learners: learners.length, meetingShare: meetingShare(rows, scale) };
}
function meetingShare(rows, scale) {
  const need = levelValue('meeting', scale) ?? scale[Math.floor(scale.length / 2)].value; let met = 0; let rated = 0;
  rows.forEach((r) => scale.forEach((s) => { const n = r.distribution[s.key] ?? 0; rated += n; if (s.value >= need) met += n; }));
  return rated ? Math.round((met / rated) * 100) : null;
}

// Learners rated below the "meeting" level in at least `min` outcomes, most first. Never invents a rating: unrated outcomes are not counted.
export function learnersNeedingSupport({ learners, outcomes, ratings, scale = DEFAULT_RATING_SCALE, termId, min = 1 }) {
  const need = levelValue('meeting', scale) ?? scale[Math.floor(scale.length / 2)].value; const ids = new Set(outcomes.map((o) => o.id));
  const latest = latestRatings(ratings).filter((r) => ids.has(r.outcomeId) && (r.termId ?? '') === (termId ?? ''));
  return learners.map((l) => { const mine = latest.filter((r) => r.studentId === l.id); const below = mine.filter((r) => (levelValue(r.level, scale) ?? Infinity) < need); return { learner: l, below: below.length, rated: mine.length }; })
    .filter((x) => x.below >= min).sort((a, b) => b.below - a.below || b.rated - a.rated);
}

// What a report card or progress report shows for one learner and term: per subject, how many outcomes sit at each level.
export function progressBySubject({ learner, subjects, outcomes, ratings, scale = DEFAULT_RATING_SCALE, termId }) {
  return subjects.map((subject) => {
    const outs = outcomesFor(outcomes, { classId: learner.classId, subjectId: subject.id }); if (!outs.length) return null;
    const p = competencyProfile(learner.id, outs, ratings, scale, 'meeting', termId);
    const counts = Object.fromEntries(scale.map((s) => [s.key, p.rows.filter((r) => r.level === s.key).length]));
    return { subject, rows: p.rows, total: p.total, rated: p.rated, reached: p.reached, reachedShare: p.reachedShare, counts };
  }).filter(Boolean);
}
