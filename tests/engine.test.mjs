// Run: node tests/engine.test.mjs — the academic engine, with hand-worked sample cases.
import assert from 'node:assert/strict';
import * as e from '../js/services/academicEngine.js';
let fail = 0; const ok = (name, fn) => { try { fn(); console.log('  ✓', name); } catch (x) { fail++; console.error('  ✗', name, '\n    ', x.message); } };
const bands = [{ grade: 'A', min: 80, max: 100, points: 4 }, { grade: 'B', min: 70, max: 79, points: 3 }, { grade: 'C', min: 50, max: 69, points: 2 }, { grade: 'D', min: 0, max: 49, points: 1 }];
const P = e.DEFAULT_POLICY;

console.log('Rounding');
ok('half-up is decimal-correct (at 2+ decimals the old Math.round(x*100)/100 turned 0.145 into 0.14; at 1 decimal both agree)', () => {
  assert.equal(e.round(50.05, 1), 50.1); assert.equal(Math.round(50.05 * 10) / 10, 50.1); assert.equal(Math.round(0.145 * 100) / 100, 0.14); assert.equal(e.round(0.145, 2), 0.15); assert.equal(e.round(1.005, 2), 1.01); assert.equal(e.round(2.5, 0), 3); assert.equal(e.round(71, 1), 71);
  assert.equal(e.round(-0.05, 1), -0.1); assert.equal(e.round(0, 1), 0); assert.equal(e.round(66.666666, 1), 66.7); assert.equal(e.round(null), null); assert.equal(e.round(NaN), null); assert.equal(e.round(1e-8, 2), 0);
});
ok('policy decimals are clamped and merged over the defaults', () => { assert.equal(e.mergePolicy({ decimals: 9 }).decimals, 3); assert.equal(e.mergePolicy({}).ranking, 'class'); assert.equal(e.mergePolicy({ passMark: 40 }).passMark, 40); });
ok('policy validation catches bad choices', () => { assert.equal(e.validatePolicy(e.mergePolicy({})), null); assert.match(e.validatePolicy({ ...P, ranking: 'x' }), /ranking/); assert.match(e.validatePolicy({ ...P, passMark: 150 }), /pass mark/); assert.match(e.validatePolicy({ ...P, minSubjectsToRank: 0 }), /Minimum/); });

console.log('Grade bands');
ok('contiguous bands are valid; gaps, overlaps, missing grades and out-of-range ends are reported in plain words', () => {
  assert.deepEqual(e.validateBands(bands), []);
  assert.match(e.validateBands([{ grade: 'A', min: 80, max: 100 }, { grade: 'C', min: 50, max: 69 }, { grade: 'D', min: 0, max: 49 }])[0].text, /70 to 79 fall between/);
  assert.match(e.validateBands([{ grade: 'A', min: 70, max: 100 }, { grade: 'B', min: 60, max: 75 }, { grade: 'D', min: 0, max: 59 }])[0].text, /overlap/);
  assert.match(e.validateBands([{ grade: 'A', min: 50, max: 100 }])[0].text, /0 to 49 have no grade/); assert.match(e.validateBands([{ grade: 'A', min: 0, max: 90 }])[0].text, /91 to 100/);
  assert.match(e.validateBands([{ grade: '', min: 0, max: 100 }])[0].text, /no grade/); assert.match(e.validateBands([])[0].text, /at least one/);
  assert.equal(e.validateBands([{ grade: 'A', min: 50, max: 100 }, { grade: 'A', min: 0, max: 49 }])[0].level, 'warning');
});
ok('a score takes the grade whose range it reaches; scores between integer bands (79.5) are NOT left ungraded', () => {
  assert.equal(e.gradeFor(80, bands).grade, 'A'); assert.equal(e.gradeFor(79, bands).grade, 'B'); assert.equal(e.gradeFor(79.5, bands).grade, 'B'); assert.equal(e.gradeFor(0, bands).grade, 'D'); assert.equal(e.gradeFor(100, bands).points, 4);
  assert.equal(e.gradeFor(79.5, bands, { ...P, bandMatch: 'strict' }), null); assert.equal(e.gradeFor(null, bands), null); assert.equal(e.gradeFor(55, []), null);
});

console.log('Weighted assessment');
const scheme = { components: [{ kind: 'exam', weight: 60 }, { kind: 'category', ref: 'cat', weight: 30 }, { kind: 'category', ref: 'assignment', weight: 10 }] };
ok('scheme validation: weights must total 100, no repeats, categories named', () => {
  assert.equal(e.validateScheme(scheme), null); assert.match(e.validateScheme({ components: [{ kind: 'exam', weight: 60 }] }), /60, not 100/); assert.match(e.validateScheme({ components: [] }), /at least one/);
  assert.match(e.validateScheme({ components: [{ kind: 'exam', weight: 50 }, { kind: 'exam', weight: 50 }] }), /only once/); assert.match(e.validateScheme({ components: [{ kind: 'category', ref: '', weight: 100 }] }), /assessment type/); assert.match(e.validateScheme({ components: [{ kind: 'exam', weight: 0 }, { kind: 'category', ref: 'a', weight: 100 }] }), /above zero/);
});
ok('category percent = mean of that learner\'s percentages, ignoring assessments they have no mark for', () => {
  const as = [{ id: 'a1', maxScore: 50 }, { id: 'a2', maxScore: 20 }, { id: 'a3', maxScore: 100 }]; const sc = [{ assessmentId: 'a1', studentId: 's', score: 40 }, { assessmentId: 'a2', studentId: 's', score: 10 }, { assessmentId: 'a3', studentId: 'x', score: 90 }];
  assert.equal(e.categoryPercent(as, sc, 's'), 65); assert.equal(e.categoryPercent(as, sc, 'nobody'), null); assert.equal(e.categoryPercent(as, [{ assessmentId: 'a1', studentId: 's', score: null }], 's'), null);
});
ok('hand-worked: exam 70, CAT 80, assignment 90 → 0.6·70 + 0.3·80 + 0.1·90 = 75', () => assert.equal(e.weightedSubjectScore({ scheme, examPercent: 70, categoryPercents: { cat: 80, assignment: 90 } }).score, 75));
ok('missing component: redistribute (exam 70, CAT 80, no assignment → (42+24)/0.9 = 73.3), zero (66), or incomplete (no score)', () => {
  const args = { scheme, examPercent: 70, categoryPercents: { cat: 80 } };
  const r = e.weightedSubjectScore({ ...args, policy: { ...P, missingComponent: 'redistribute' } }); assert.equal(r.score, 73.3); assert.equal(r.incomplete, true); assert.equal(r.parts.find((p) => p.ref === 'assignment').effectiveWeight, 0);
  assert.equal(e.weightedSubjectScore({ ...args, policy: { ...P, missingComponent: 'zero' } }).score, 66); const inc = e.weightedSubjectScore({ ...args, policy: { ...P, missingComponent: 'incomplete' } }); assert.deepEqual([inc.score, inc.incomplete], [null, true]);
  assert.equal(e.weightedSubjectScore({ scheme, examPercent: null, categoryPercents: {}, policy: P }).score, null);
});
ok('weights need not be whole numbers; results are rounded to the policy\'s decimals', () => assert.equal(e.weightedSubjectScore({ scheme: { components: [{ kind: 'exam', weight: 33.3 }, { kind: 'category', ref: 'cat', weight: 66.7 }] }, examPercent: 61, categoryPercents: { cat: 72 }, policy: { ...P, decimals: 2 } }).score, 68.34));

console.log('A learner\'s report');
const subj = (...s) => s.map((v, i) => ({ subjectId: `s${i}`, subjectName: `S${i}`, score: v }));
ok('average of scored subjects, grades per subject, overall grade; hand-worked 80,70,60 → total 210, average 70, B', () => {
  const r = e.buildLearnerReport(subj(80, 70, 60), bands); assert.deepEqual([r.total, r.average, r.overallGrade], [210, 70, 'B']); assert.deepEqual(r.rows.map((x) => x.grade), ['A', 'B', 'C']);
});
ok('missing marks are excluded from the average by default, or counted as zero if the school chooses', () => {
  const ex = e.buildLearnerReport(subj(80, null, 60), bands); assert.deepEqual([ex.total, ex.average, ex.subjectsScored, ex.subjectsExpected], [140, 70, 2, 3]);
  const zero = e.buildLearnerReport(subj(80, null, 60), bands, { ...P, missingScore: 'zero' }); assert.equal(zero.average, 46.7); assert.equal(zero.overallGrade, 'D');
  const none = e.buildLearnerReport(subj(null, null), bands); assert.deepEqual([none.average, none.total, none.overallGrade], [null, 0, null]);
});
ok('rounding follows the policy: (50 + 50.1) / 2 = 50.05 → 50.05 at 2 decimals, 50.1 at 1, 50 at 0', () => {
  assert.equal(e.buildLearnerReport(subj(50, 50.1), bands, { ...P, decimals: 2 }).average, 50.05); assert.equal(e.buildLearnerReport(subj(50, 50.1), bands, { ...P, decimals: 1 }).average, 50.1); assert.equal(e.buildLearnerReport(subj(50, 50.1), bands, { ...P, decimals: 0 }).average, 50);
});

console.log('Ranking (configurable, never assumed)');
const E = (id, average, got = 3, of = 3, group = '') => ({ id, average, subjectsScored: got, subjectsExpected: of, group });
const pos = (entries, policy) => Object.fromEntries([...e.rankLearners(entries, policy).positions].map(([k, v]) => [k, v.position]));
ok('standard ranking shares ties: 90, 85, 85, 70 → 1, 2, 2, 4;  dense: 1, 2, 2, 3', () => {
  const en = [E('a', 85), E('b', 90), E('c', 70), E('d', 85)];
  assert.deepEqual(pos(en, P), { b: 1, a: 2, d: 2, c: 4 }); assert.deepEqual(pos(en, { ...P, tieMode: 'dense' }), { b: 1, a: 2, d: 2, c: 3 });
});
ok('ranking can be switched off entirely', () => { const r = e.rankLearners([E('a', 80)], { ...P, ranking: 'none' }); assert.equal(r.positions.size, 0); assert.equal(r.rankedCount, 0); });
ok('by stream: each stream is ranked on its own', () => assert.deepEqual(pos([E('a', 90, 3, 3, 'x'), E('b', 80, 3, 3, 'x'), E('c', 60, 3, 3, 'y'), E('d', 95, 3, 3, 'y')], { ...P, ranking: 'stream' }), { a: 1, b: 2, d: 1, c: 2 }));
ok('learners with no average, too few subjects, or (if the school says so) incomplete marks are not ranked', () => {
  const en = [E('a', 80, 3, 3), E('b', null, 0, 3), E('c', 95, 1, 3), E('d', 70, 2, 3)];
  assert.deepEqual(pos(en, P), { c: 1, a: 2, d: 3 }); assert.deepEqual(pos(en, { ...P, minSubjectsToRank: 2 }), { a: 1, d: 2 }); assert.deepEqual(pos(en, { ...P, rankIncomplete: false }), { a: 1 });
  assert.equal(e.rankLearners(en, P).rankedCount, 3);
});
ok('PROPERTY: 400 random classes — positions start at 1, ties share a position, higher average never ranks lower, "of" is the group size', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 400; t++) {
    const n = 1 + Math.floor(rnd() * 25); const en = Array.from({ length: n }, (_, i) => E(`s${i}`, Math.round(rnd() * 400) / 10)); const dense = rnd() < 0.5;
    const r = e.rankLearners(en, { ...P, tieMode: dense ? 'dense' : 'share' }); const arr = en.map((x) => ({ ...x, ...r.positions.get(x.id) }));
    assert.equal(Math.min(...arr.map((x) => x.position)), 1);
    arr.forEach((x) => arr.forEach((y) => { if (x.average > y.average) assert.ok(x.position < y.position); if (x.average === y.average) assert.equal(x.position, y.position); }));
    assert.ok(arr.every((x) => x.of === n)); if (!dense) assert.equal(Math.max(...arr.map((x) => x.position)) <= n, true);
  }
});
ok('COMPATIBILITY: with default settings the positions are identical to the pre-engine algorithm', () => {
  const old = (list) => { const ranked = [...list].sort((a, b) => b.average - a.average); const m = new Map(); ranked.forEach((r, i) => { const tied = i > 0 && ranked[i - 1].average === r.average; m.set(r.id, tied ? m.get(ranked[i - 1].id) : i + 1); }); return Object.fromEntries(m); };
  let seed = 3; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 200; t++) { const en = Array.from({ length: 1 + Math.floor(rnd() * 20) }, (_, i) => E(`s${i}`, Math.round(rnd() * 200) / 2)); assert.deepEqual(pos(en, P), old(en)); }
});

console.log('Class statistics');
ok('hand-worked: averages 90, 70, 50, 30 → mean 60, median 60, highest 90, lowest 30, std dev √500 = 22.4, pass rate 75% (50 passes), distribution', () => {
  const s = e.classSummary([90, 70, 50, 30], bands, P); assert.deepEqual([s.count, s.mean, s.median, s.highest, s.lowest, s.stdDev, s.passRate], [4, 60, 60, 90, 30, 22.4, 75]); assert.deepEqual(s.distribution, { A: 1, B: 1, C: 1, D: 1 });
  assert.equal(e.classSummary([90, 70, 50, 30], bands, { ...P, passMark: 60 }).passRate, 50); // the pass mark is the school's choice
});
ok('empty classes and odd counts', () => { assert.equal(e.classSummary([], bands).mean, null); assert.equal(e.classSummary([null, 75, undefined], bands).count, 1); assert.equal(e.median([3, 1, 2]), 2); assert.equal(e.median([1, 2, 3, 4]), 2.5); });
ok('trend over exams: improving, declining, steady, and "not enough" below two results', () => { assert.equal(e.trendOf([50, 55, 70, 80]), 'improving'); assert.equal(e.trendOf([80, 70, 55, 50]), 'declining'); assert.equal(e.trendOf([60, 61, 60, 62]), 'steady'); assert.equal(e.trendOf([60]), 'not enough results'); });

console.log('Competencies and learning outcomes');
const scale = e.DEFAULT_RATING_SCALE;
ok('rating scale is configurable and validated', () => { assert.equal(e.validateRatingScale(scale), null); assert.match(e.validateRatingScale([{ key: 'a', label: 'A', value: 1 }]), /2 to 8/); assert.match(e.validateRatingScale([{ key: 'ab', label: 'A', value: 1 }, { key: 'ab', label: 'B', value: 2 }]), /different/); assert.match(e.validateRatingScale([{ key: 'ab', label: 'A', value: 1 }, { key: 'cd', label: 'B', value: 1 }]), /values/); assert.match(e.validateRatingScale([{ key: 'ab', label: ' ', value: 1 }, { key: 'cd', label: 'B', value: 2 }]), /label/); });
ok('only the NEWEST rating per learner, outcome and term counts; earlier ones stay as history', () => {
  const r = [{ studentId: 's', outcomeId: 'o', termId: 't', level: 'below', date: '2026-01-10' }, { studentId: 's', outcomeId: 'o', termId: 't', level: 'meeting', date: '2026-03-01' }, { studentId: 's', outcomeId: 'o', termId: 't2', level: 'approaching', date: '2026-02-01' }];
  assert.deepEqual(e.latestRatings(r).map((x) => [x.termId, x.level]).sort(), [['t', 'meeting'], ['t2', 'approaching']]);
});
ok('outcome summary: distribution, rated vs not rated, share at the top level; learner profile: share of outcomes reached', () => {
  const ratings = [{ studentId: 'a', outcomeId: 'o1', termId: 't', level: 'exceeding', date: '1' }, { studentId: 'b', outcomeId: 'o1', termId: 't', level: 'meeting', date: '1' }, { studentId: 'c', outcomeId: 'o1', termId: 't', level: 'below', date: '1' }, { studentId: 'a', outcomeId: 'o2', termId: 't', level: 'approaching', date: '1' }, { studentId: 'zzz', outcomeId: 'o1', termId: 't', level: 'exceeding', date: '1' }];
  const s = e.outcomeSummary('o1', ratings, ['a', 'b', 'c', 'd'], scale, 't'); assert.deepEqual([s.rated, s.notRated, s.distribution.exceeding, s.distribution.below, s.topLevelShare], [3, 1, 1, 1, 33.3]);
  const outs = [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }]; const p = e.competencyProfile('a', outs, ratings, scale, 'meeting', 't'); assert.deepEqual([p.total, p.rated, p.reached, p.reachedShare], [3, 2, 1, 33.3]); assert.equal(e.competencyProfile('a', outs, ratings, scale, 'approaching', 't').reached, 2);
});
ok('outcome validation', () => { assert.match(e.validateOutcome({ curriculumId: 'c', subjectId: 's', description: ' ' }), /Describe/); assert.equal(e.validateOutcome({ curriculumId: 'c', subjectId: 's', description: 'Adds fractions' }), null); });

console.log('Curriculum coverage');
ok('coverage comes from what was actually done: scheme weeks completed; outcomes covered by lessons marked taught', () => {
  assert.deepEqual(e.schemeCoverage([{ weeks: [{ status: 'done' }, { status: 'done' }, { status: 'planned' }, {}] }, { weeks: [{ status: 'done' }] }]), { weeks: 5, done: 3, pct: 60 }); assert.equal(e.schemeCoverage([]).pct, null);
  const c = e.outcomeCoverage([{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }, { id: 'o4' }], [{ status: 'taught', outcomeIds: ['o1', 'o2'] }, { status: 'planned', outcomeIds: ['o2', 'o3'] }, { status: 'postponed', outcomeIds: ['o4'] }]);
  assert.deepEqual(c.rows.map((r) => r.state), ['taught', 'taught', 'planned', 'not covered']); assert.deepEqual([c.taught, c.planned, c.pct], [2, 1, 50]);
});

console.log('Approval workflow');
const run = (status, extra = {}) => ({ status, ...extra });
const admin = { role: 'school_admin', name: 'Head' }, teacher = { role: 'teacher', name: 'Tina' }, other = { role: 'school_admin', name: 'Deputy' };
ok('a teacher submits; only an administrator approves, returns, publishes; each step needs the right status', () => {
  assert.equal(e.canDo(run('draft'), 'submit', teacher).ok, true); assert.equal(e.canDo(run('draft'), 'approve', admin).ok, false); assert.match(e.canDo(run('draft'), 'approve', admin).reason, /draft report cannot/);
  assert.equal(e.canDo(run('in_moderation'), 'approve', teacher).ok, false); assert.match(e.canDo(run('in_moderation'), 'approve', teacher).reason, /administrator/);
  assert.equal(e.canDo(run('approved'), 'publish', admin).ok, true); assert.equal(e.canDo(run('in_moderation'), 'publish', admin).ok, false); assert.equal(e.canDo(run('published'), 'submit', admin).ok, false);
});
ok('returning, unpublishing and reopening always need a reason', () => { ['return', 'unpublish', 'reopen'].forEach((a) => { const st = { return: 'in_moderation', unpublish: 'published', reopen: 'approved' }[a]; assert.match(e.canDo(run(st), a, admin, P, ' ').reason, /reason/); assert.equal(e.canDo(run(st), a, admin, P, 'Marks were wrong').ok, true); }); });
ok('separation of duties: whoever submitted cannot approve (unless the school turns that off)', () => {
  const r = run('in_moderation', { submittedBy: 'Head' }); assert.match(e.canDo(r, 'approve', admin).reason, /cannot also approve/); assert.equal(e.canDo(r, 'approve', other).ok, true); assert.equal(e.canDo(r, 'approve', admin, { ...P, separateApprover: false }).ok, true);
});
ok('a run can only be submitted when marks are in, comments ready, grading and weighting are valid; blockers are plain words', () => {
  const ready = [{ marksIn: 3, marksNeeded: 3, commentsReady: 3, commentsNeeded: 3, classComment: true }, { marksIn: 2, marksNeeded: 3, commentsReady: 1, commentsNeeded: 3, classComment: false }];
  const b = e.submitBlockers({ readiness: ready, policy: { ...P, requireClassComment: true }, bandIssues: [{ level: 'error', text: 'Scores from 70 to 79 have no grade.' }, { level: 'warning', text: 'x' }], scheme: { components: [{ kind: 'exam', weight: 60 }] } });
  assert.deepEqual(b, ['Grading scale: Scores from 70 to 79 have no grade.', 'Weighting: The weights add up to 60, not 100.', '1 learner(s) are missing marks.', '1 learner(s) are missing subject comments marked ready.', "1 learner(s) are missing the class teacher's comment."]);
  assert.deepEqual(e.submitBlockers({ readiness: [{ marksIn: 1, marksNeeded: 1, commentsReady: 0, commentsNeeded: 1, classComment: false }], policy: { ...P, requireComments: false } }), []);
  assert.deepEqual(e.submitBlockers({ readiness: [] }), ['There are no learners in this class.']);
});
ok('once submitted, a run is locked (marks cannot change) until it is returned or reopened', () => { assert.equal(e.isLockedRun(run('draft')), false); ['in_moderation', 'approved', 'published'].forEach((s) => assert.equal(e.isLockedRun(run(s)), true)); assert.equal(e.isLockedRun(undefined), false); });
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
