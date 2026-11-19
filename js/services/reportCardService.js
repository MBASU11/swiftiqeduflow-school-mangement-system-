// Builds report-card data once and reuses it for the on-screen preview, printing,
// whole-class printing and the shareable parent link. The model is plain JSON, so
// the very same object can be published as a snapshot a parent opens later.
import { isSupabaseConfigured } from '../config/supabase.js';
import { SupabaseRepository } from '../storage/SupabaseRepository.js';
import { getSupabaseClient } from './supabaseClient.js';
import { classesSortedByOrder, subjectRepo, termRepo, academicYearRepo, streamRepo } from './academicService.js';
import { studentRepo, fullName } from './studentService.js';
import { parentRepo, parentFullName } from './peopleService.js';
import { getSchool } from './schoolService.js';
import { attendanceRepo } from './attendanceService.js';
import { readyCommentsFor } from './teacherLogic.js';
import { progressBySubject, shortLabel } from './competencyLogic.js';
import { StorageManager } from '../storage/StorageManager.js';
import { mergePolicy, buildLearnerReport, rankLearners, classSummary, round, pickScheme, assessmentsInTerm, categoryPercent, weightedSubjectScore } from './academicEngine.js';
import { assessmentRepo, assessmentScoreRepo } from './assessmentService.js';
import {
  gradingSystemRepo, gradeBandRepo, examinationRepo, examScoreRepo, reportCardRepo, reportCommentRepo, reportPolicyRepo, weightingSchemeRepo, reportRunRepo,
  getExaminationsFor, saveReportCardComment,
} from './examService.js';
import {
  loadExamWorkspace, remoteAttendanceSummary, remoteBandsForSystem, remoteSubjectsForClass, saveRemoteReportCardComment,
} from './supabaseExamService.js';

const remote = () => isSupabaseConfigured();

export async function loadReportData() {
  if (remote()) {
    const data = await loadExamWorkspace();
    // loadExamWorkspace() does not fetch these, but the report card needs them.
    const extras = ['school', 'parents', 'streams', 'academicYears', 'publishedReportCards'];
    const values = await Promise.all(extras.map((name) => new SupabaseRepository(name).getAll()));
    extras.forEach((name, index) => { data[name] = values[index]; });
    return data;
  }
  return {
    school: [getSchool()].filter(Boolean),
    classes: classesSortedByOrder(),
    subjects: subjectRepo.getAll(),
    students: studentRepo.getAll(),
    terms: termRepo.getAll(),
    academicYears: academicYearRepo.getAll(),
    streams: streamRepo.getAll(),
    parents: parentRepo.getAll(),
    gradingSystems: gradingSystemRepo.getAll(),
    gradeBands: gradeBandRepo.getAll(),
    examinations: getExaminationsFor(),
    examScores: examScoreRepo.getAll(),
    reportCards: reportCardRepo.getAll(),
    reportComments: reportCommentRepo.getAll(),
    assessments: assessmentRepo.getAll(),
    assessmentScores: assessmentScoreRepo.getAll(),
    weightingSchemes: weightingSchemeRepo.getAll(),
    reportPolicy: reportPolicyRepo.getAll()[0],
    attendance: attendanceRepo.getAll(),
    publishedReportCards: [],
    reportRuns: reportRunRepo.getAll(),
    learningOutcomes: StorageManager.all('learningOutcomes'),
    competencyRatings: StorageManager.all('competencyRatings'),
  };
}

export async function saveComments(examinationId, studentId, patch) {
  if (remote()) return saveRemoteReportCardComment(examinationId, studentId, patch);
  return saveReportCardComment(examinationId, studentId, patch);
}

// Results for every learner in one class, worked out by the academic engine under the school's report policy
// (rounding, missing marks, ranking, tie handling) and, if configured, a weighted-assessment scheme.
// The returned shape is what the report-card screens already use; `policy`, `summary` and `schemes` are additions.
export function buildClassResults(data, examinationId, classId) {
  const policy = mergePolicy(data.reportPolicy);
  const gradingSystem = data.gradingSystems.find((g) => g.isDefault) ?? data.gradingSystems[0];
  const bands = gradingSystem ? remoteBandsForSystem(data, gradingSystem.id) : [];
  const examination = data.examinations.find((e) => e.id === examinationId);
  const term = (data.terms ?? []).find((t) => t.id === examination?.termId);
  const subjects = remoteSubjectsForClass(data, classId);
  const roster = data.students.filter((s) => s.classId === classId && s.status === 'active').sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const schemes = new Map(subjects.map((sub) => [sub.id, pickScheme(data.weightingSchemes, { classId, subjectId: sub.id, termId: examination?.termId })]));

  const subjectScore = (studentId, sub) => {
    const raw = data.examScores.find((x) => x.examinationId === examinationId && x.subjectId === sub.id && x.studentId === studentId)?.score;
    const exam = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    const scheme = schemes.get(sub.id);
    if (!scheme) return exam;
    const feeding = assessmentsInTerm(data.assessments ?? [], { classId, subjectId: sub.id, term });
    const categoryPercents = {};
    scheme.components.filter((c) => c.kind === 'category').forEach((c) => { categoryPercents[c.ref] = categoryPercent(feeding.filter((a) => a.type === c.ref), data.assessmentScores ?? [], studentId); });
    return weightedSubjectScore({ scheme, examPercent: exam, categoryPercents, policy }).score;
  };

  const reports = new Map(roster.map((s) => [s.id, buildLearnerReport(subjects.map((sub) => ({ subjectId: sub.id, subjectName: sub.name, score: subjectScore(s.id, sub) })), bands, policy)]));
  const { positions: ranked, rankedCount } = rankLearners(roster.map((s) => ({ id: s.id, average: reports.get(s.id).average, subjectsScored: reports.get(s.id).subjectsScored, subjectsExpected: reports.get(s.id).subjectsExpected, group: s.streamId ?? '' })), policy);
  const positions = new Map([...ranked].map(([id, v]) => [id, v.position]));

  const subjectScores = new Map();
  reports.forEach((report) => report.rows.forEach((row) => { if (row.score !== null) subjectScores.set(row.subjectId, [...(subjectScores.get(row.subjectId) ?? []), row.score]); }));
  const subjectAverages = new Map([...subjectScores].map(([id, list]) => [id, round(list.reduce((t, x) => t + x, 0) / list.length, policy.decimals)]));
  const summary = classSummary([...reports.values()].map((r) => r.average), bands, policy);
  return { gradingSystem, bands, roster, reports, positions, rankedCount, subjectAverages, policy, summary, schemes };
}

function gradeRemark(bands, grade) {
  return bands.find((b) => b.grade === grade)?.description ?? '';
}

export function buildReportModel(data, examinationId, classId, studentId, results = buildClassResults(data, examinationId, classId)) {
  const school = data.school?.[0] ?? {};
  const student = data.students.find((s) => s.id === studentId);
  const examination = data.examinations.find((e) => e.id === examinationId);
  const schoolClass = data.classes.find((c) => c.id === classId);
  const stream = data.streams?.find((s) => s.id === student?.streamId);
  const term = data.terms?.find((t) => t.id === examination?.termId);
  const year = data.academicYears?.find((y) => y.id === term?.academicYearId);
  const report = results.reports.get(studentId);
  const comment = data.reportCards.find((r) => r.examinationId === examinationId && r.studentId === studentId);

  const hasTermDates = term?.startDate && term?.endDate;
  const attendance = remoteAttendanceSummary(data, classId, hasTermDates ? term.startDate : '2000-01-01', hasTermDates ? term.endDate : '2100-01-01')
    .find((a) => a.studentId === studentId);

  return {
    version: 1,
    generatedOn: new Date().toISOString().slice(0, 10),
    school: {
      name: school.name ?? 'School',
      address: school.address ?? '',
      phone: school.phone ?? '',
      email: school.email ?? '',
      logoUrl: school.logoUrl ?? '',
      letterheadUrl: school.letterheadUrl ?? '',
    },
    student: {
      name: fullName(student),
      admissionNumber: student.admissionNumber ?? '',
      className: schoolClass?.name ?? '',
      streamName: stream?.name ?? '',
      gender: student.gender ?? '',
    },
    exam: { name: examination?.name ?? '', term: term?.name ?? '', year: year?.label ?? '' },
    rows: report.rows.map((row) => ({
      subject: row.subjectName,
      score: row.score,
      grade: row.grade,
      points: row.points,
      remark: gradeRemark(results.bands, row.grade),
      classAverage: results.policy.showClassAverage ? (results.subjectAverages.get(row.subjectId) ?? null) : null,
    })),
    total: report.total,
    average: report.average,
    overallGrade: report.overallGrade,
    overallRemark: gradeRemark(results.bands, report.overallGrade),
    position: results.policy.showPosition ? (results.positions.get(studentId) ?? null) : null,
    classSize: results.policy.showPosition ? results.rankedCount : null,
    showClassAverage: results.policy.showClassAverage,
    attendance: attendance && attendance.total ? { percentage: attendance.percentage, present: attendance.present + attendance.late, total: attendance.total } : null,
    comments: { teacher: comment?.teacherComment ?? '', principal: comment?.principalComment ?? '' },
    // Where this class's report is in the approval workflow (demo mode). Cloud mode has no runs yet, so nothing is flagged there.
    approval: (() => {
      const policy = mergePolicy(data.reportPolicy);
      if (!data.reportRuns) return { workflowOn: false };
      const run = data.reportRuns.find((r) => r.examinationId === examinationId && r.classId === classId);
      return { workflowOn: Boolean(policy.enforceWorkflow), status: run?.status ?? 'draft', approvedBy: run?.approvedBy ?? '', approverTitle: run?.approverTitle ?? '', approvedAt: run?.approvedAt ?? '' };
    })(),
    // Only comments a teacher marked READY appear; drafts stay private to the teacher.
    // CBC: how many outcomes sit at each level, per subject, for this term. Only subjects with at least one rating appear.
    competencies: progressBySubject({ learner: student, subjects: (data.subjects ?? []).filter((x) => (x.classIds ?? []).includes(classId)), outcomes: data.learningOutcomes ?? [], ratings: data.competencyRatings ?? [], termId: examination?.termId })
      .filter((p) => p.rated > 0).map((p) => ({ subject: p.subject.name, total: p.total, rated: p.rated, reached: p.reached, counts: p.counts })),
    subjectComments: readyCommentsFor(data.reportComments ?? [], examinationId, studentId, Object.fromEntries((data.subjects ?? []).map((x) => [x.id, x]))),
    gradingKey: results.bands.map((b) => ({ min: b.min, max: b.max, grade: b.grade, description: b.description ?? '' })),
  };
}

// ---- Contacts and messages ------------------------------------------------

export function parentsOf(data, student) {
  return (student?.parentIds ?? [])
    .map((id) => data.parents.find((p) => p.id === id))
    .filter(Boolean)
    .map((p) => ({ id: p.id, name: parentFullName(p), phone: p.phone ?? '', email: p.email ?? '' }));
}

// Kenyan-friendly: 07xx / 01xx / 7xx / +254 / 254 all become 2547xxxxxxxx.
export function toInternationalPhone(raw) {
  const digits = String(raw ?? '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (!digits) return '';
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return digits;
}

export function shareMessage(model, link) {
  const exam = [model.exam.name, model.exam.term].filter(Boolean).join(' – ');
  const result = [
    model.average !== null ? `average ${model.average}${model.overallGrade ? ` (${model.overallGrade})` : ''}` : '',
    model.position ? `position ${model.position} of ${model.classSize}` : '',
  ].filter(Boolean).join(', ');
  return `Dear Parent/Guardian, ${model.student.name}'s ${exam} report card from ${model.school.name} is ready${result ? `: ${result}` : ''}.${link ? ` View or print it here: ${link}` : ' Please contact the school office for the printed copy.'}`;
}

export const mailtoLink = (email, model, link) =>
  `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`${model.student.name} – ${model.exam.name} report card`)}&body=${encodeURIComponent(shareMessage(model, link))}`;
export const smsLink = (phone, model, link) => `sms:+${toInternationalPhone(phone)}?&body=${encodeURIComponent(shareMessage(model, link))}`;
export const whatsappLink = (phone, model, link) => `https://wa.me/${toInternationalPhone(phone)}?text=${encodeURIComponent(shareMessage(model, link))}`;

// ---- Parent link (needs the Supabase backend) -----------------------------

export const portalAvailable = () => remote();

export function shareUrl(token) {
  const url = new URL('report.html', window.location.href);
  url.hash = '';
  url.search = `?t=${encodeURIComponent(token)}`;
  return url.toString();
}

export function publishedFor(data, examinationId, studentId) {
  const card = (data.publishedReportCards ?? []).find((c) => c.examinationId === examinationId && c.studentId === studentId && !c.revoked);
  return card ? { token: card.token, snapshot: card.snapshot, publishedAt: card.publishedAt } : null;
}

export const isOutOfDate = (published, model) =>
  published && JSON.stringify({ ...published.snapshot, generatedOn: '' }) !== JSON.stringify({ ...model, generatedOn: '' });

export async function publishReportCard(examinationId, studentId, model) {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc('publish_report_card', { card_payload: { examinationId, studentId, snapshot: model } });
  if (error) throw error;
  return data.token;
}

export async function revokeReportCard(examinationId, studentId) {
  const client = await getSupabaseClient();
  const { error } = await client.rpc('revoke_published_report_card', { target_examination_id: examinationId, target_student_id: studentId });
  if (error) throw error;
}

export async function fetchSharedReportCard(token) {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc('get_shared_report_card', { share_token: token });
  if (error) throw error;
  return data;
}
