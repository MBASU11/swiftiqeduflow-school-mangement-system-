// The academic engine: every calculation behind a report card, as pure functions (no storage, no DOM).
// Nothing here assumes one curriculum, grading scale or ranking rule: schools configure them in a
// REPORT POLICY, and the defaults reproduce how the system behaved before this engine existed.
const num = (v) => Number(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const sum = (a) => a.reduce((t, x) => t + x, 0);

// ================================================================ policy
export const DEFAULT_POLICY = {
  decimals: 1,                 // how many decimal places scores and averages are rounded to (0–3)
  missingScore: 'exclude',     // a subject with no mark: 'exclude' it from the average, or count it as 'zero'
  ranking: 'class',            // 'none' | 'class' | 'stream' — class position is a school choice, never assumed
  tieMode: 'share',            // 'share' = 1,2,2,4 (standard competition)   'dense' = 1,2,2,3
  minSubjectsToRank: 1,        // fewer subjects than this and the learner is not ranked
  rankIncomplete: true,        // rank learners who are missing some subjects?
  showPosition: true,          // print the class position on the report card
  showClassAverage: true,      // print the class average per subject
  passMark: 50,                // used for pass-rate statistics only
  missingComponent: 'redistribute', // weighted subjects: a missing component's weight is 'redistribute'd, counted as 'zero', or makes the subject 'incomplete'
  bandMatch: 'lower_bound',    // 'lower_bound': a score takes the highest band whose minimum it reaches (no gaps)  |  'strict': must sit inside min..max
  requireComments: true,       // submit needs every subject comment marked ready
  requireClassComment: false,  // submit needs the class teacher's comment
  separateApprover: true,      // the person who approves must not be the person who submitted
  enforceWorkflow: true,       // report cards can be shared with parents only once the run is published (a school may switch this off)
};
export function mergePolicy(saved) {
  const p = { ...DEFAULT_POLICY, ...(saved ?? {}) };
  p.decimals = Math.min(3, Math.max(0, Math.round(num(p.decimals)) || 0));
  return p;
}
export function validatePolicy(p) {
  if (!Number.isInteger(p.decimals) || p.decimals < 0 || p.decimals > 3) return 'Decimal places must be between 0 and 3.';
  if (!['exclude', 'zero'].includes(p.missingScore)) return 'Choose how missing marks are treated.';
  if (!['none', 'class', 'stream'].includes(p.ranking)) return 'Choose a ranking option.';
  if (!['share', 'dense'].includes(p.tieMode)) return 'Choose how ties are ranked.';
  if (!['redistribute', 'zero', 'incomplete'].includes(p.missingComponent)) return 'Choose how a missing assessment component is treated.';
  if (!['lower_bound', 'strict'].includes(p.bandMatch)) return 'Choose how grade bands are matched.';
  if (!(p.passMark >= 0 && p.passMark <= 100)) return 'The pass mark must be between 0 and 100.';
  if (!Number.isInteger(p.minSubjectsToRank) || p.minSubjectsToRank < 1) return 'Minimum subjects to rank must be at least 1.';
  return null;
}

// ================================================================ rounding
// Decimal-correct "round half up": 50.05 -> 50.1 (the old Math.round(x*10)/10 gave 50.0 because 50.05*10 = 500.4999…).
export function round(v, decimals = 1) {
  if (!finite(v)) return null;
  const s = String(v);
  if (/e/i.test(s)) { const f = 10 ** decimals; return Math.round(v * f) / f; }
  const out = Number(`${Math.round(Number(`${Math.abs(v)}e${decimals}`)) * Math.sign(v || 1)}e-${decimals}`);
  return out === 0 ? 0 : out;
}

// ================================================================ grade bands
// band: { grade, min, max, points?, description? }
export function validateBands(bands, range = { min: 0, max: 100 }) {
  const issues = [];
  if (!bands.length) return [{ level: 'error', text: 'Add at least one grade band.' }];
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  sorted.forEach((b) => {
    if (!String(b.grade ?? '').trim()) issues.push({ level: 'error', text: `A band from ${b.min} to ${b.max} has no grade.` });
    if (!finite(num(b.min)) || !finite(num(b.max))) issues.push({ level: 'error', text: `Band "${b.grade}" needs a minimum and a maximum.` });
    else if (b.min > b.max) issues.push({ level: 'error', text: `Band "${b.grade}" has its minimum above its maximum.` });
  });
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    if (b.min <= a.max) issues.push({ level: 'error', text: `Bands "${a.grade}" (${a.min}–${a.max}) and "${b.grade}" (${b.min}–${b.max}) overlap.` });
    else if (b.min - a.max > 1) issues.push({ level: 'error', text: `Scores from ${a.max + 1} to ${b.min - 1} fall between "${a.grade}" and "${b.grade}" and have no grade.` });
  }
  if (sorted[0].min > range.min) issues.push({ level: 'error', text: `Scores from ${range.min} to ${sorted[0].min - 1} have no grade.` });
  if (sorted.at(-1).max < range.max) issues.push({ level: 'error', text: `Scores from ${sorted.at(-1).max + 1} to ${range.max} have no grade.` });
  const seen = new Set(); sorted.forEach((b) => { if (seen.has(b.grade)) issues.push({ level: 'warning', text: `The grade "${b.grade}" is used by more than one band.` }); seen.add(b.grade); });
  return issues;
}
export function gradeFor(score, bands, policy = DEFAULT_POLICY) {
  if (!finite(score) || !bands.length) return null;
  const desc = [...bands].sort((a, b) => b.min - a.min);
  const hit = policy.bandMatch === 'strict' ? desc.find((b) => score >= b.min && score <= b.max) : desc.find((b) => score >= b.min && score <= Math.max(b.max, 100));
  return hit ? { grade: hit.grade, points: hit.points ?? null, description: hit.description ?? '' } : null;
}

// ================================================================ weighted assessment
// scheme: { components: [{ kind: 'exam', weight }, { kind: 'category', ref: 'cat', weight }] }  weights are percentages.
export function validateScheme(scheme) {
  const c = scheme?.components ?? [];
  if (!c.length) return 'Add at least one component.';
  if (c.some((x) => !(num(x.weight) > 0))) return 'Every component needs a weight above zero.';
  if (c.some((x) => x.kind === 'category' && !String(x.ref ?? '').trim())) return 'Choose the assessment type for each category component.';
  const keys = c.map((x) => `${x.kind}:${x.ref ?? ''}`);
  if (new Set(keys).size !== keys.length) return 'Each component can appear only once.';
  const total = sum(c.map((x) => num(x.weight)));
  return Math.abs(total - 100) > 0.001 ? `The weights add up to ${round(total, 2)}, not 100.` : null;
}
// A learner's percentage in one assessment type = the mean of their percentages in each assessment of that type
// that they have a mark for. Assessments with no mark for them are not counted (and a type with none gives null).
export function categoryPercent(assessments, scores, studentId) {
  const pcts = assessments.map((a) => { const s = scores.find((x) => x.assessmentId === a.id && x.studentId === studentId); const max = num(a.maxScore) || 100; return s && finite(s.score) ? (s.score / max) * 100 : null; }).filter((x) => x !== null);
  return pcts.length ? sum(pcts) / pcts.length : null;
}
export function weightedSubjectScore({ scheme, examPercent, categoryPercents, policy = DEFAULT_POLICY }) {
  const parts = scheme.components.map((c) => ({ kind: c.kind, ref: c.ref ?? null, weight: num(c.weight), pct: c.kind === 'exam' ? examPercent : (categoryPercents[c.ref] ?? null) }));
  const missing = parts.filter((p) => p.pct === null || p.pct === undefined);
  if (missing.length && policy.missingComponent === 'incomplete') return { score: null, incomplete: true, parts };
  const used = parts.map((p) => ({ ...p, pct: p.pct ?? (policy.missingComponent === 'zero' ? 0 : null) }));
  const counted = used.filter((p) => p.pct !== null);
  if (!counted.length) return { score: null, incomplete: false, parts: used };
  const weightSum = sum(counted.map((p) => p.weight));
  return { score: round(sum(counted.map((p) => p.pct * p.weight)) / weightSum, policy.decimals), incomplete: missing.length > 0, parts: used.map((p) => ({ ...p, effectiveWeight: p.pct === null ? 0 : round((p.weight / weightSum) * 100, 2) })) };
}

// ================================================================ a learner's report
// subjectScores: [{ subjectId, subjectName, score|null }]   Returns rows with grades, plus total and average per policy.
export function buildLearnerReport(subjectScores, bands, policy = DEFAULT_POLICY) {
  const rows = subjectScores.map((s) => { const sc = finite(s.score) ? round(s.score, policy.decimals) : null; const g = gradeFor(sc, bands, policy); return { ...s, score: sc, grade: g?.grade ?? null, points: g?.points ?? null }; });
  const counted = policy.missingScore === 'zero' ? rows.map((r) => r.score ?? 0) : rows.filter((r) => r.score !== null).map((r) => r.score);
  const total = round(sum(counted), policy.decimals);
  const average = counted.length ? round(sum(counted) / counted.length, policy.decimals) : null;
  return { rows, total: counted.length ? total : 0, average, overallGrade: gradeFor(average, bands, policy)?.grade ?? null, subjectsScored: rows.filter((r) => r.score !== null).length, subjectsExpected: rows.length };
}

// ================================================================ ranking (a school choice, off by default if the school says so)
// entries: [{ id, average, subjectsScored, subjectsExpected, group }]   group = stream id when ranking by stream
export function rankLearners(entries, policy = DEFAULT_POLICY) {
  const positions = new Map();
  if (policy.ranking === 'none') return { positions, rankedCount: 0 };
  const eligible = entries.filter((e) => e.average !== null && e.subjectsScored >= policy.minSubjectsToRank && (policy.rankIncomplete || e.subjectsScored === e.subjectsExpected));
  const groups = policy.ranking === 'stream' ? [...new Set(eligible.map((e) => e.group ?? ''))] : [''];
  groups.forEach((g) => {
    const list = eligible.filter((e) => policy.ranking !== 'stream' || (e.group ?? '') === g).sort((a, b) => b.average - a.average);
    let rank = 0, prev = null;
    list.forEach((e, i) => {
      if (prev === null || e.average !== prev) { rank = policy.tieMode === 'dense' ? rank + 1 : i + 1; prev = e.average; }
      positions.set(e.id, { position: rank, of: list.length, group: g });
    });
  });
  return { positions, rankedCount: eligible.length };
}

// ================================================================ class statistics
export function median(values) { if (!values.length) return null; const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
export function classSummary(averages, bands, policy = DEFAULT_POLICY) {
  const v = averages.filter(finite);
  if (!v.length) return { count: 0, mean: null, median: null, highest: null, lowest: null, stdDev: null, passRate: null, distribution: {} };
  const mean = sum(v) / v.length;
  const dist = {}; v.forEach((x) => { const g = gradeFor(x, bands, policy)?.grade ?? 'Ungraded'; dist[g] = (dist[g] ?? 0) + 1; });
  return { count: v.length, mean: round(mean, policy.decimals), median: round(median(v), policy.decimals), highest: Math.max(...v), lowest: Math.min(...v), stdDev: round(Math.sqrt(sum(v.map((x) => (x - mean) ** 2)) / v.length), policy.decimals), passRate: round((v.filter((x) => x >= policy.passMark).length / v.length) * 100, 1), distribution: dist };
}
// Which way is a learner heading across exams (oldest first)? Needs at least two.
export function trendOf(points, threshold = 3) {
  if (points.length < 2) return 'not enough results';
  const h = Math.floor(points.length / 2); const first = sum(points.slice(0, h)) / h; const last = sum(points.slice(h)) / (points.length - h);
  return last - first > threshold ? 'improving' : first - last > threshold ? 'declining' : 'steady';
}

// ================================================================ competencies and learning outcomes
export const DEFAULT_RATING_SCALE = [
  { key: 'below', label: 'Below expectation', value: 1 }, { key: 'approaching', label: 'Approaching expectation', value: 2 },
  { key: 'meeting', label: 'Meeting expectation', value: 3 }, { key: 'exceeding', label: 'Exceeding expectation', value: 4 },
];
export function validateRatingScale(scale) {
  if (scale.length < 2 || scale.length > 8) return 'A rating scale needs 2 to 8 levels.';
  if (scale.some((s) => !String(s.label ?? '').trim() || !/^[a-z][a-z0-9_]{1,20}$/.test(s.key ?? ''))) return 'Every level needs a label and a key (lowercase letters, numbers, underscore).';
  if (new Set(scale.map((s) => s.key)).size !== scale.length) return 'Level keys must be different.';
  const vals = scale.map((s) => s.value); if (new Set(vals).size !== vals.length || vals.some((v) => !finite(v))) return 'Level values must be different numbers (higher = stronger).';
  return null;
}
export function validateOutcome(o) { if (!String(o.description ?? '').trim()) return 'Describe the outcome.'; if (!o.curriculumId) return 'Choose a curriculum.'; if (!o.subjectId) return 'Choose a subject.'; return null; }
// Ratings are history: only the newest rating per learner, outcome and term counts.
export function latestRatings(ratings) {
  const m = new Map();
  [...ratings].sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))).forEach((r) => m.set(`${r.studentId}|${r.outcomeId}|${r.termId ?? ''}`, r));
  return [...m.values()];
}
export function outcomeSummary(outcomeId, ratings, learnerIds, scale, termId) {
  const latest = latestRatings(ratings).filter((r) => r.outcomeId === outcomeId && (termId === undefined || (r.termId ?? '') === (termId ?? '')) && learnerIds.includes(r.studentId));
  const dist = Object.fromEntries(scale.map((s) => [s.key, latest.filter((r) => r.level === s.key).length]));
  const top = [...scale].sort((a, b) => b.value - a.value)[0];
  return { rated: latest.length, notRated: learnerIds.length - latest.length, distribution: dist, topLevelShare: latest.length ? round((dist[top.key] / latest.length) * 100, 1) : null };
}
// How many of a subject's outcomes has this learner reached? "Reached" = at or above the chosen level.
export function competencyProfile(studentId, outcomes, ratings, scale, reachedKey = 'meeting', termId) {
  const need = scale.find((s) => s.key === reachedKey)?.value ?? scale[Math.floor(scale.length / 2)].value;
  const latest = latestRatings(ratings).filter((r) => r.studentId === studentId && (termId === undefined || (r.termId ?? '') === (termId ?? '')));
  const rows = outcomes.map((o) => { const r = latest.find((x) => x.outcomeId === o.id); const val = scale.find((s) => s.key === r?.level)?.value ?? null; return { outcome: o, level: r?.level ?? null, reached: val !== null && val >= need }; });
  const rated = rows.filter((r) => r.level);
  return { rows, total: outcomes.length, rated: rated.length, reached: rows.filter((r) => r.reached).length, reachedShare: outcomes.length ? round((rows.filter((r) => r.reached).length / outcomes.length) * 100, 1) : null };
}

// ================================================================ curriculum coverage
// Coverage is measured from what was actually planned and taught — nothing is invented.
export function schemeCoverage(schemes) {
  const weeks = schemes.flatMap((s) => s.weeks ?? []); const done = weeks.filter((w) => w.status === 'done').length;
  return { weeks: weeks.length, done, pct: weeks.length ? round((done / weeks.length) * 100, 1) : null };
}
export function outcomeCoverage(outcomes, lessonPlans) {
  const taught = new Set(lessonPlans.filter((p) => p.status === 'taught').flatMap((p) => p.outcomeIds ?? []));
  const planned = new Set(lessonPlans.filter((p) => p.status === 'planned').flatMap((p) => p.outcomeIds ?? []));
  const rows = outcomes.map((o) => ({ outcome: o, state: taught.has(o.id) ? 'taught' : planned.has(o.id) ? 'planned' : 'not covered' }));
  return { rows, total: outcomes.length, taught: rows.filter((r) => r.state === 'taught').length, planned: rows.filter((r) => r.state === 'planned').length, pct: outcomes.length ? round((rows.filter((r) => r.state === 'taught').length / outcomes.length) * 100, 1) : null };
}

// ================================================================ report-run workflow: draft → moderation → approved → published
export const RUN_STATUS = { draft: 'Draft', in_moderation: 'In moderation', approved: 'Approved', published: 'Published' };
export const RUN_ACTIONS = {
  submit:    { from: ['draft'], to: 'in_moderation', who: 'preparer', label: 'Submit for moderation' },
  return:    { from: ['in_moderation'], to: 'draft', who: 'moderator', label: 'Return for changes', needsNote: true },
  approve:   { from: ['in_moderation'], to: 'approved', who: 'moderator', label: 'Approve' },
  publish:   { from: ['approved'], to: 'published', who: 'publisher', label: 'Publish' },
  unpublish: { from: ['published'], to: 'approved', who: 'publisher', label: 'Unpublish', needsNote: true },
  reopen:    { from: ['approved'], to: 'draft', who: 'publisher', label: 'Reopen for changes', needsNote: true },
};
// actor: { role, isClassTeacher, name }. Preparers: the class teacher, any teacher of the class, or an administrator.
// Moderators and publishers: school administrator / principal.
export function canDo(run, action, actor, policy = DEFAULT_POLICY, note = '') {
  const a = RUN_ACTIONS[action];
  if (!a) return { ok: false, reason: 'Unknown action.' };
  if (!a.from.includes(run.status)) return { ok: false, reason: `A ${RUN_STATUS[run.status].toLowerCase()} report cannot be ${a.label.toLowerCase()}d.` };
  const admin = actor.role === 'school_admin' || actor.role === null || actor.role === undefined;
  const allowed = a.who === 'preparer' ? (admin || actor.role === 'teacher') : admin;
  if (!allowed) return { ok: false, reason: a.who === 'preparer' ? 'Only teachers and administrators can submit.' : 'Only the school administrator can do this.' };
  if (a.needsNote && !String(note).trim()) return { ok: false, reason: 'Give a reason.' };
  if (action === 'approve' && policy.separateApprover && run.submittedBy && run.submittedBy === actor.name) return { ok: false, reason: 'The person who submitted the report cannot also approve it. Ask another administrator.' };
  return { ok: true };
}
// What must be true before a run can be submitted? Returns a list of plain-language blockers (empty = ready).
export function submitBlockers({ readiness, policy = DEFAULT_POLICY, bandIssues = [], scheme = undefined }) {
  const out = [];
  bandIssues.filter((i) => i.level === 'error').forEach((i) => out.push(`Grading scale: ${i.text}`));
  if (scheme) { const e = validateScheme(scheme); if (e) out.push(`Weighting: ${e}`); }
  if (!readiness.length) out.push('There are no learners in this class.');
  const noMarks = readiness.filter((r) => r.marksIn < r.marksNeeded).length;
  if (noMarks) out.push(`${noMarks} learner(s) are missing marks.`);
  if (policy.requireComments) { const n = readiness.filter((r) => r.commentsReady < r.commentsNeeded).length; if (n) out.push(`${n} learner(s) are missing subject comments marked ready.`); }
  if (policy.requireClassComment) { const n = readiness.filter((r) => !r.classComment).length; if (n) out.push(`${n} learner(s) are missing the class teacher's comment.`); }
  return out;
}
export const isLockedRun = (run) => Boolean(run) && run.status !== 'draft';
export const emptyRun = (examinationId, classId) => ({ examinationId, classId, status: 'draft', history: [] });
// Apply one workflow action and return the NEW run (never mutates). The caller must have checked canDo() first.
// Returning or reopening wipes the submit/approve stamps, so a changed report always needs approving afresh.
export function applyAction(run, action, actor, { note = '', now = new Date().toISOString() } = {}) {
  const a = RUN_ACTIONS[action];
  if (!a) throw new Error('Unknown action.');
  const by = actor?.name || 'Administrator';
  const next = { ...run, status: a.to, history: [...(run.history ?? []), { action, label: a.label, by, at: now, note: String(note ?? '').trim() }] };
  if (action === 'submit') Object.assign(next, { submittedBy: by, submittedAt: now });
  if (action === 'approve') Object.assign(next, { approvedBy: by, approvedAt: now, approverTitle: actor?.title ?? '' });
  if (action === 'publish') Object.assign(next, { publishedBy: by, publishedAt: now });
  if (action === 'unpublish') { next.publishedBy = undefined; next.publishedAt = undefined; } // set to undefined, not deleted: the repository MERGES updates
  if (action === 'return' || action === 'reopen') ['submittedBy', 'submittedAt', 'approvedBy', 'approvedAt', 'approverTitle', 'publishedBy', 'publishedAt'].forEach((k) => { next[k] = undefined; });
  return next;
}
// May this run's report cards be shared with parents (links, SMS, email, WhatsApp)?
export function shareGate(run, policy = DEFAULT_POLICY) {
  if (!policy.enforceWorkflow || run?.status === 'published') return { ok: true };
  return { ok: false, reason: `This class's report is ${RUN_STATUS[run?.status ?? 'draft'].toLowerCase()}. Report cards can be shared with parents only after the report is approved and published.` };
}
export const lockMessage = (run) => `Marks and comments for this class are locked because its report is ${RUN_STATUS[run?.status ?? 'draft'].toLowerCase()}. An administrator must return or reopen it first.`;

// A weighting scheme may be for one subject in one class, a whole class, or the whole school; the most specific one wins.
// scheme: { classId?, subjectId?, termId?, components }. A scheme tied to a different term never applies.
export function pickScheme(schemes, { classId, subjectId, termId }) {
  const fits = (s) => (!s.classId || s.classId === classId) && (!s.subjectId || s.subjectId === subjectId) && (!s.termId || s.termId === termId);
  const weight = (s) => (s.subjectId ? 4 : 0) + (s.classId ? 2 : 0) + (s.termId ? 1 : 0);
  return [...(schemes ?? [])].filter(fits).sort((a, b) => weight(b) - weight(a))[0] ?? null;
}
// Which assessments feed a subject's weighted score? Those for that class and subject that fall inside the term (if both have dates).
export function assessmentsInTerm(assessments, { classId, subjectId, term }) {
  return assessments.filter((a) => a.classId === classId && a.subjectId === subjectId && (!term?.startDate || !term?.endDate || !a.date || (a.date >= term.startDate && a.date <= term.endDate)));
}
