import { norm, text, isBlank, cleanAdmission, cleanNumber, nameKey } from '../importEngine.js';
import { fullName } from '../studentService.js';
import { saveExamScores } from '../examService.js';
import { saveRemoteExamScores } from '../supabaseExamService.js';
import { buildClassResults } from '../reportCardService.js';
import { remote } from './context.js';

const ABSENT = new Set(['abs', 'absent', 'a', 'x', 'na', 'nil', '-', '--', 'dnf', 'dns']);

const subjectsOf = (ctx, classId) => ctx.subjects.filter((s) => (s.classIds ?? []).includes(classId)).sort((a, b) => a.name.localeCompare(b.name));

export const marks = {
  key: 'marks',
  label: 'Marks / exam results',
  description: 'Class marks from an Excel sheet — one row per student, one column per subject. Grades, totals, positions and report cards are worked out automatically.',
  options: [
    { key: 'examinationId', type: 'exam', label: 'Examination', required: true },
    { key: 'classId', type: 'examClass', label: 'Class', required: true },
  ],
  ready: (options) => Boolean(options.examinationId && options.classId),

  // Subject columns come from the class's own subjects, so a Grade 1 sheet can
  // never push marks into a subject Grade 1 doesn't take.
  getFields(ctx, options) {
    const base = [
      { key: 'admissionNumber', label: 'Admission No', aliases: ['admno', 'adm', 'admission', 'admissionnumber', 'admissionno', 'regno', 'registrationnumber'] },
      { key: 'studentName', label: 'Student', aliases: ['name', 'names', 'studentname', 'pupilname', 'learnername', 'fullname', 'student'] },
    ];
    if (!options.classId) return base;
    return [
      ...base,
      ...subjectsOf(ctx, options.classId).map((s) => ({
        key: `subject:${s.id}`, label: s.name, subject: s,
        aliases: [s.code, s.name].filter(Boolean),
      })),
    ];
  },

  prepare(rows, ctx, options) {
    const roster = ctx.students.filter((s) => s.classId === options.classId && s.status === 'active');
    const byAdm = new Map(roster.filter((s) => s.admissionNumber).map((s) => [norm(s.admissionNumber), s]));
    const subjects = subjectsOf(ctx, options.classId);
    const subjectById = Object.fromEntries(subjects.map((s) => [s.id, s]));
    const existingScore = new Map(ctx.examScores.filter((e) => e.examinationId === options.examinationId).map((e) => [`${e.subjectId}|${e.studentId}`, e.score]));
    const className = ctx.classes.find((c) => c.id === options.classId)?.name ?? 'this class';
    const seen = new Map();

    const findByName = (value) => {
      const key = nameKey(value);
      const exact = roster.filter((s) => nameKey(fullName(s)) === key);
      if (exact.length === 1) return { student: exact[0] };
      if (exact.length > 1) return { error: 'More than one student has this name — use the admission number.' };
      const tokens = key.split(' ').filter(Boolean);
      const loose = roster.filter((s) => {
        const own = nameKey(fullName(s)).split(' ');
        return tokens.length >= 2 && (tokens.every((t) => own.includes(t)) || own.every((t) => tokens.includes(t)));
      });
      if (loose.length === 1) return { student: loose[0] };
      if (loose.length > 1) return { error: 'More than one student matches this name — use the admission number.' };
      return {};
    };

    const items = rows.map((row) => {
      const v = row.values;
      const messages = [];
      let status = 'ok';
      const fail = (m) => { messages.push(m); status = 'error'; };
      const warn = (m) => { messages.push(m); if (status === 'ok') status = 'warn'; };

      const adm = cleanAdmission(v.admissionNumber);
      let student = adm ? byAdm.get(norm(adm)) : undefined;
      if (!student && !isBlank(v.studentName)) {
        const found = findByName(v.studentName);
        if (found.error) fail(found.error);
        student = found.student;
      }
      if (!student && status !== 'error') {
        const who = adm || text(v.studentName);
        if (!who) fail('No admission number or name on this row.');
        else {
          const elsewhere = adm ? ctx.students.find((s) => norm(s.admissionNumber) === norm(adm)) : undefined;
          const where = elsewhere ? ` (that student is in ${ctx.classes.find((c) => c.id === elsewhere.classId)?.name ?? 'another class'})` : '';
          fail(`"${who}" is not a student in ${className}${where}.`);
        }
      }
      if (student) {
        if (seen.has(student.id)) fail(`${fullName(student)} appears twice (row ${seen.get(student.id)}).`);
        else seen.set(student.id, row.rowNumber);
      }

      const scores = {};
      let replaced = 0;
      Object.entries(v).forEach(([key, raw]) => {
        if (!key.startsWith('subject:')) return;
        const subject = subjectById[key.slice(8)];
        if (!subject || isBlank(raw)) return;
        if (typeof raw === "string" && ABSENT.has(text(raw).toLowerCase().replace(/[\s.\/]/g, ""))) return; // absent / not sat: leave as is
        const n = cleanNumber(raw);
        if (n === null) { fail(`${subject.name}: "${text(raw)}" is not a number.`); return; }
        if (n < 0 || n > 100) { fail(`${subject.name}: ${n} is outside 0–100.`); return; }
        scores[subject.id] = Math.round(n * 100) / 100;
        const before = student ? existingScore.get(`${subject.id}|${student.id}`) : undefined;
        if (before !== undefined && before !== null && before !== scores[subject.id]) replaced += 1;
      });

      if (status !== 'error' && Object.keys(scores).length === 0) { status = 'skip'; messages.push('No marks on this row.'); }
      if (replaced) warn(`${replaced} existing mark${replaced === 1 ? '' : 's'} will be replaced.`);

      const pieces = Object.entries(scores).map(([id, n]) => `${subjectById[id].name} ${n}`);
      return {
        rowNumber: row.rowNumber, status, messages, action: 'save',
        summary: `${student ? fullName(student) : text(v.studentName) || adm || '—'}${pieces.length ? ` — ${pieces.join(', ')}` : ''}`,
        plan: { studentId: student?.id, scores },
      };
    });
    return { items };
  },

  async commit(items, ctx, options, progress) {
    const bySubject = new Map();
    items.filter((i) => i.status === 'ok' || i.status === 'warn').forEach((item) => {
      Object.entries(item.plan.scores).forEach(([subjectId, score]) => {
        if (!bySubject.has(subjectId)) bySubject.set(subjectId, {});
        bySubject.get(subjectId)[item.plan.studentId] = String(score);
      });
    });
    let marksSaved = 0;
    let step = 0;
    for (const [subjectId, values] of bySubject) {
      const entries = Object.entries(values);
      for (let i = 0; i < entries.length; i += 500) {
        const chunk = Object.fromEntries(entries.slice(i, i + 500));
        if (remote()) await saveRemoteExamScores(options.examinationId, subjectId, chunk);
        else saveExamScores(options.examinationId, subjectId, chunk);
        marksSaved += Object.keys(chunk).length;
      }
      step += 1;
      progress?.(step, bySubject.size, 'Saving marks…');
    }
    return { created: 0, updated: 0, marks: marksSaved, students: new Set(items.filter((i) => i.plan.studentId && (i.status === 'ok' || i.status === 'warn')).map((i) => i.plan.studentId)).size, subjects: bySubject.size };
  },

  // A ready-to-fill sheet: the class list down the side, the grade's subjects across the top.
  template(ctx, options) {
    const roster = ctx.students.filter((s) => s.classId === options.classId && s.status === 'active').sort((a, b) => fullName(a).localeCompare(fullName(b)));
    const subjects = subjectsOf(ctx, options.classId);
    const cls = ctx.classes.find((c) => c.id === options.classId)?.name ?? 'Class';
    const exam = ctx.examinations.find((e) => e.id === options.examinationId)?.name ?? 'Exam';
    return {
      sheets: [
        { name: 'Marks', rows: [['Admission No', 'Student', ...subjects.map((s) => s.name)], ...roster.map((s) => [s.admissionNumber, fullName(s), ...subjects.map(() => '')])] },
        { name: 'Instructions', rows: [
          [`${exam} — ${cls}`],
          ['• Type each student’s mark (0–100) under the subject. Leave blank (or write ABS) if the student did not sit it.'],
          ['• Do not add Total, Average, Grade or Position — they are calculated automatically from your grading system.'],
          ['• Only this grade’s subjects are listed. Subjects can be added to a grade under Academics → Classes → Manage subjects.'],
        ] },
      ],
      fileName: `marks-template-${cls}-${exam}`,
    };
  },

  export(ctx, options) {
    const results = buildClassResults(ctx, options.examinationId, options.classId);
    const subjects = subjectsOf(ctx, options.classId);
    const cls = ctx.classes.find((c) => c.id === options.classId)?.name ?? 'Class';
    const exam = ctx.examinations.find((e) => e.id === options.examinationId)?.name ?? 'Exam';
    const list = [...results.roster].sort((a, b) => (results.positions.get(a.id) ?? 9999) - (results.positions.get(b.id) ?? 9999) || fullName(a).localeCompare(fullName(b)));
    const rows = list.map((s) => {
      const report = results.reports.get(s.id);
      const bySubject = Object.fromEntries(report.rows.map((r) => [r.subjectId, r]));
      return [results.positions.get(s.id) ?? '', s.admissionNumber, fullName(s), ...subjects.map((sub) => bySubject[sub.id]?.score ?? ''), report.total || '', report.average ?? '', report.overallGrade ?? ''];
    });
    return {
      sheets: [{ name: 'Results', rows: [['Position', 'Admission No', 'Student', ...subjects.map((s) => s.name), 'Total', 'Average', 'Grade'], ...rows] }],
      fileName: `results-${cls}-${exam}`,
      count: rows.length,
    };
  },
};
