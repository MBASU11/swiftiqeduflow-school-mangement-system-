// A learner hands in homework (demo mode). Writes only the learner's own answer on their own submission record and never touches
// the teacher's marks, feedback or status choices beyond the submitted/late state.
import { LocalStorageRepository } from '../storage/Repository.js';
import { studentRepo } from './studentService.js';
import { submissionState } from './teacherLogic.js';
import { handInCheck, validateAnswer } from './handInLogic.js';

const homeworkRepo = new LocalStorageRepository('homework', 'homework');
const submissionRepo = new LocalStorageRepository('homeworkSubmissions', 'submission');
const today = () => new Date().toISOString().slice(0, 10);
const find = (homeworkId, studentId) => submissionRepo.getAll().find((x) => x.homeworkId === homeworkId && x.studentId === studentId);

// attachment: undefined = keep what is there, null = remove it, {name,type,size,dataUrl} = replace it.
export function handIn(account, homeworkId, { text = '', attachment } = {}) {
  if (!account || account.role !== 'student') return { ok: false, errors: ['Only the learner can hand in their homework.'] };
  const student = studentRepo.getById(account.linkedId); const homework = homeworkRepo.getById(homeworkId); const prior = find(homeworkId, account.linkedId);
  const check = handInCheck({ homework, student, submission: prior, today: today() });
  if (!check.ok) return { ok: false, errors: [check.reason] };
  const keep = attachment === undefined ? prior?.attachment : attachment;
  const errors = validateAnswer({ text, attachment: keep ?? undefined });
  if (errors.length) return { ok: false, errors };
  const firstOn = prior?.submittedAt || today();
  const patch = { homeworkId, studentId: student.id, classId: student.classId, text: String(text).trim(), attachment: keep ?? null, status: submissionState(homework, firstOn), submittedAt: firstOn, lastEditedAt: new Date().toISOString(), handedInBy: 'learner' };
  try { return { ok: true, late: check.late, submission: prior ? submissionRepo.update(prior.id, patch, 'learner updated hand-in') : submissionRepo.create(patch, 'learner handed in') }; }
  catch (error) { return { ok: false, errors: [/quota/i.test(error.message) ? 'There is not enough space on this device to store that file. Try a smaller file or write your answer instead.' : error.message] }; }
}
export const checkFor = (account, homework) => handInCheck({ homework, student: studentRepo.getById(account.linkedId), submission: find(homework.id, account.linkedId), today: today() });
