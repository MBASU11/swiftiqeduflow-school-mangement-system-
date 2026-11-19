// Run: node tests/engine-integration.test.mjs — the engine inside the real report builder (buildClassResults).
import assert from 'node:assert/strict';
const store = new Map();
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), get length() { return store.size; }, key: (i) => [...store.keys()][i] } };
globalThis.DOMException ??= class extends Error {}; globalThis.document = undefined;
let fail = 0; const ok = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', String(e.message).slice(0, 600)); } };
const RC = await import('../js/services/reportCardService.js');
const bands = [{ id: 'b1', gradingSystemId: 'gs', grade: 'A', min: 80, max: 100, points: 4 }, { id: 'b2', gradingSystemId: 'gs', grade: 'B', min: 70, max: 79, points: 3 }, { id: 'b3', gradingSystemId: 'gs', grade: 'C', min: 50, max: 69, points: 2 }, { id: 'b4', gradingSystemId: 'gs', grade: 'D', min: 0, max: 49, points: 1 }];
const mk = (extra = {}) => ({ gradingSystems: [{ id: 'gs', isDefault: true }], gradeBands: bands, examinations: [{ id: 'ex', termId: 't1' }], terms: [{ id: 't1', startDate: '2026-01-01', endDate: '2026-04-30' }],
  subjects: [{ id: 'math', name: 'Maths', classIds: ['c1'] }, { id: 'eng', name: 'English', classIds: ['c1'] }],
  students: [{ id: 'a', firstName: 'Amy', lastName: 'K', classId: 'c1', status: 'active' }, { id: 'b', firstName: 'Ben', lastName: 'K', classId: 'c1', status: 'active' }, { id: 'c', firstName: 'Cy', lastName: 'K', classId: 'c1', status: 'active' }, { id: 'w', firstName: 'Wes', lastName: 'K', classId: 'c1', status: 'withdrawn' }],
  examScores: [{ examinationId: 'ex', subjectId: 'math', studentId: 'a', score: 90 }, { examinationId: 'ex', subjectId: 'eng', studentId: 'a', score: 70 }, { examinationId: 'ex', subjectId: 'math', studentId: 'b', score: 60 }, { examinationId: 'ex', subjectId: 'eng', studentId: 'b', score: 60 }, { examinationId: 'ex', subjectId: 'math', studentId: 'c', score: 60 }, { examinationId: 'ex', subjectId: 'eng', studentId: 'c', score: 60 }],
  assessments: [], assessmentScores: [], weightingSchemes: [], reportPolicy: undefined, ...extra });

console.log('Defaults behave as before');
await ok('averages, grades and shared-tie positions for a small class (withdrawn learners excluded)', () => {
  const r = RC.buildClassResults(mk(), 'ex', 'c1');
  assert.deepEqual(r.roster.map((s) => s.id), ['a', 'b', 'c']);
  assert.deepEqual([r.reports.get('a').average, r.reports.get('a').overallGrade, r.reports.get('b').average, r.reports.get('b').overallGrade], [80, 'A', 60, 'C']);
  assert.deepEqual([r.positions.get('a'), r.positions.get('b'), r.positions.get('c'), r.rankedCount], [1, 2, 2, 3]);
  assert.deepEqual([r.subjectAverages.get('math'), r.subjectAverages.get('eng')], [70, 63.3]);
  assert.deepEqual([r.summary.count, r.summary.mean, r.summary.highest, r.summary.lowest], [3, 66.7, 80, 60]);
});
await ok('a learner with NO mark record for a subject no longer gets an average of NaN (the old code did)', () => {
  const data = mk({ examScores: mk().examScores.filter((x) => !(x.studentId === 'b' && x.subjectId === 'eng')) });
  const r = RC.buildClassResults(data, 'ex', 'c1'); const b = r.reports.get('b');
  assert.deepEqual([b.average, b.total, b.subjectsScored, b.subjectsExpected], [60, 60, 1, 2]);
  const oldAverage = (() => { const rows = data.subjects.map((s) => ({ score: data.examScores.find((x) => x.studentId === 'b' && x.subjectId === s.id)?.score })); const scored = rows.filter((x) => x.score !== null); return Math.round((scored.reduce((t, x) => t + Number(x.score), 0) / scored.length) * 10) / 10; })();
  assert.ok(Number.isNaN(oldAverage), 'the pre-engine algorithm produced NaN here');
});

console.log('Report policy');
await ok('ranking can be switched off, ties made dense, missing marks counted as zero — all from the saved policy', () => {
  assert.equal(RC.buildClassResults(mk({ reportPolicy: { ranking: 'none' } }), 'ex', 'c1').positions.size, 0);
  assert.deepEqual(['a', 'b', 'c'].map((id) => RC.buildClassResults(mk({ reportPolicy: { tieMode: 'dense' } }), 'ex', 'c1').positions.get(id)), [1, 2, 2]);
  const data = mk({ examScores: mk().examScores.filter((x) => !(x.studentId === 'b' && x.subjectId === 'eng')), reportPolicy: { missingScore: 'zero' } });
  assert.equal(RC.buildClassResults(data, 'ex', 'c1').reports.get('b').average, 30);
});
await ok('the report-card model respects "show position" and "show class average" and carries ready subject comments', () => {
  const data = mk({ reportPolicy: { showPosition: false, showClassAverage: false }, reportCards: [], reportComments: [{ examinationId: 'ex', studentId: 'a', subjectId: 'math', text: 'Great', status: 'ready', authorName: 'Tina' }], parents: [], school: {}, classes: [{ id: 'c1', name: 'Grade 4' }], streams: [], attendance: [], academicYears: [] });
  let model; try { model = RC.buildReportModel(data, 'ex', 'c1', 'a'); } catch (e) { throw new Error(`buildReportModel failed: ${e.message}`); }
  assert.equal(model.position, null); assert.ok(model.rows.every((r) => r.classAverage === null)); assert.deepEqual(model.subjectComments.map((c) => c.text), ['Great']);
});

console.log('Weighted assessments in the report');
await ok('a weighting scheme (60% exam, 40% CAT) is used for that subject only; the term\'s assessments feed it; others stay raw', () => {
  const scheme = { id: 's1', classId: 'c1', subjectId: 'math', components: [{ kind: 'exam', weight: 60 }, { kind: 'category', ref: 'cat', weight: 40 }] };
  const data = mk({ weightingSchemes: [scheme], assessments: [{ id: 'a1', classId: 'c1', subjectId: 'math', type: 'cat', maxScore: 50, date: '2026-02-10' }, { id: 'a2', classId: 'c1', subjectId: 'math', type: 'cat', maxScore: 20, date: '2026-08-10' }], assessmentScores: [{ assessmentId: 'a1', studentId: 'a', score: 40 }, { assessmentId: 'a2', studentId: 'a', score: 0 }] });
  const r = RC.buildClassResults(data, 'ex', 'c1'); const a = r.reports.get('a');
  assert.equal(a.rows.find((x) => x.subjectId === 'math').score, 86);              // 0.6·90 + 0.4·80; the out-of-term CAT (score 0) is ignored
  assert.equal(a.rows.find((x) => x.subjectId === 'eng').score, 70);               // no scheme: raw exam score
  assert.equal(r.reports.get('b').rows.find((x) => x.subjectId === 'math').score, 60); // no CAT marks → weight redistributed → exam only
});
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
