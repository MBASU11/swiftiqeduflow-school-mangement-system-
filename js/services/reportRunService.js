// The report-run workflow (demo mode): draft → moderation → approved → published, one run per examination + class.
// The rules live in academicEngine (canDo, submitBlockers, applyAction, shareGate); this file reads and writes the data.
// Cloud mode has no run table yet (backend phase), so nothing is locked or gated there.
import { examinationRepo, examScoreRepo, gradingSystemRepo, gradeBandRepo, reportPolicyRepo, reportCardRepo, reportCommentRepo, reportRunRepo, runFor, lockedRunFor } from './examService.js';
import { studentRepo } from './studentService.js';
import { getSubjectsForClass, termRepo } from './academicService.js';
import { assessmentRepo } from './assessmentService.js';
import { reportReadiness } from './teacherLogic.js';
import { currentAccount } from './authService.js';
import { getCurrentRole } from './accessService.js';
import * as E from './academicEngine.js';

export const policyNow = () => E.mergePolicy(reportPolicyRepo.getAll()[0]);
export const getRun = (examinationId, classId) => runFor(examinationId, classId) ?? E.emptyRun(examinationId, classId);
export const currentActor = () => ({ role: getCurrentRole(), name: currentAccount()?.name || 'Administrator', title: currentAccount()?.title ?? '' });

export function readinessFor(examinationId, classId) {
  const subjects = getSubjectsForClass(classId);
  const classTeacherComments = {};
  reportCardRepo.getAll().filter((r) => r.examinationId === examinationId).forEach((r) => { classTeacherComments[r.studentId] = { text: r.teacherComment }; });
  return reportReadiness({ students: studentRepo.getAll(), subjects, examScores: examScoreRepo.getAll(), examinationId, comments: reportCommentRepo.getAll(), classTeacherComments, classId });
}

export function blockersFor(examinationId, classId) {
  const system = gradingSystemRepo.getAll().find((g) => g.isDefault) ?? gradingSystemRepo.getAll()[0];
  const bandIssues = system ? E.validateBands(gradeBandRepo.getAll().filter((b) => b.gradingSystemId === system.id)) : [{ level: 'error', text: 'No grading scale has been set up yet.' }];
  return E.submitBlockers({ readiness: readinessFor(examinationId, classId), policy: policyNow(), bandIssues });
}

// What may the signed-in person do to this run right now? [{ action, label, ok, reason }]
export function availableActions(examinationId, classId) {
  const run = getRun(examinationId, classId); const actor = currentActor(); const policy = policyNow();
  return Object.entries(E.RUN_ACTIONS).filter(([, a]) => a.from.includes(run.status)).map(([action, a]) => {
    const can = E.canDo(run, action, actor, policy, a.needsNote ? 'x' : '');
    let reason = can.ok ? '' : can.reason;
    if (can.ok && action === 'submit') { const b = blockersFor(examinationId, classId); if (b.length) reason = 'Fix the items listed below first.'; }
    return { action, label: a.label, needsNote: Boolean(a.needsNote), ok: can.ok && !reason, reason };
  });
}

export function act(examinationId, classId, action, note = '') {
  const run = getRun(examinationId, classId); const actor = currentActor(); const policy = policyNow();
  const can = E.canDo(run, action, actor, policy, note);
  if (!can.ok) throw new Error(can.reason);
  if (action === 'submit') { const b = blockersFor(examinationId, classId); if (b.length) throw new Error(`Cannot submit yet: ${b[0]}`); }
  const next = E.applyAction(run, action, actor, { note });
  if (run.id) return reportRunRepo.update(run.id, next, `report run: ${E.RUN_ACTIONS[action].label.toLowerCase()}`);
  return reportRunRepo.create(next, `report run: ${E.RUN_ACTIONS[action].label.toLowerCase()}`);
}

// Marks entered on another device are checked here too (wired into the offline transport).
// Returns a reason string if the write must be refused, otherwise null.
export function lockReasonForWrite(kind, payload, parent) {
  if (kind === 'examScore') { const run = lockedRunFor(payload.examinationId, payload.classId); return run ? E.lockMessage(run) : null; }
  if (kind === 'assessmentScore') { const run = lockedRunForAssessment(parent); return run ? E.lockMessage(run) : null; }
  return null;
}
// An assessment feeds a class's report if it falls inside the term of a locked run's examination.
export function lockedRunForAssessment(assessment) {
  if (!assessment?.classId) return null;
  return reportRunRepo.getAll().filter((r) => E.isLockedRun(r) && r.classId === assessment.classId).find((r) => {
    const exam = examinationRepo.getById(r.examinationId); const term = termRepo.getAll().find((t) => t.id === exam?.termId);
    return E.assessmentsInTerm([assessment], { classId: assessment.classId, subjectId: assessment.subjectId, term }).length > 0;
  }) ?? null;
}
export function assessmentLockMessage(assessmentId) { const a = assessmentRepo.getById(assessmentId); const run = lockedRunForAssessment(a); return run ? E.lockMessage(run) : null; }
