// Parent and learner portals in DEMO mode: builds the same data shape the cloud portal returns (see parent_portal() in the
// Supabase migrations), from this browser's school data, for ONE linked person. A parent sees only children linked to them;
// a learner sees only themselves, and never fees. Report cards appear only once the class's report run is PUBLISHED.
import { LocalStorageRepository } from '../storage/Repository.js';
import { getSchool } from './schoolService.js';
import { studentRepo, fullName } from './studentService.js';
import { parentRepo } from './peopleService.js';
import { classRepo, streamRepo, subjectRepo } from './academicService.js';
import { invoiceRepo, paymentRepo, invoicePaidAmount } from './financeService.js';
import { timetableEntryRepo } from './timetableService.js';
import { announcementRepo } from './communicationService.js';
import { attendanceRepo } from './attendanceService.js';
import { examinationRepo, reportRunRepo } from './examService.js';
import { checkFor } from './handInService.js';
import { parentNoticeSections } from '../config/legalText.js';
import { getPlatformSettings } from './platformService.js';
import { loadReportData, buildClassResults, buildReportModel } from './reportCardService.js';

const repo = (name) => new LocalStorageRepository(name, name);
const today = () => new Date().toISOString().slice(0, 10);

export function linkedChildren(account) {
  const all = studentRepo.getAll().filter((s) => (s.status ?? 'active') !== 'archived');
  if (account.role === 'student') return all.filter((s) => s.id === account.linkedId);
  return all.filter((s) => (s.parentIds ?? []).includes(account.linkedId));
}

async function reportCardsFor(data, student) {
  const out = [];
  for (const run of reportRunRepo.getAll().filter((r) => r.status === 'published' && r.classId === student.classId)) {
    const exam = examinationRepo.getById(run.examinationId); if (!exam) continue;
    const results = buildClassResults(data, exam.id, student.classId);
    if (!results.roster.some((s) => s.id === student.id)) continue;
    out.push({ id: `${exam.id}:${student.id}`, publishedAt: run.publishedAt ?? '', snapshot: buildReportModel(data, exam.id, student.classId, student.id, results) });
  }
  return out.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

export async function buildDemoPortal(account) {
  const school = getSchool() ?? {}; const learner = account.role === 'student';
  const data = await loadReportData();
  const classes = classRepo.getAll(); const streams = streamRepo.getAll(); const subjects = subjectRepo.getAll();
  const subj = (id) => subjects.find((s) => s.id === id)?.name ?? '';
  const submissions = repo('homeworkSubmissions').getAll();
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const kids = linkedChildren(account);
  const children = [];
  for (const st of kids) {
    const att = attendanceRepo.getAll().filter((a) => a.studentId === st.id && a.date >= since);
    const invoices = learner ? [] : invoiceRepo.getAll().filter((i) => i.studentId === st.id && i.status !== 'void');
    const rows = invoices.map((i) => ({ id: i.id, title: i.number ?? i.title ?? i.items?.[0]?.name ?? 'Invoice', total: i.totalAmount ?? 0, paid: invoicePaidAmount(i.id), dueDate: i.dueDate }));
    children.push({
      id: st.id, name: fullName(st), admissionNumber: st.admissionNumber,
      className: classes.find((c) => c.id === st.classId)?.name, streamName: streams.find((s) => s.id === st.streamId)?.name,
      reportCards: await reportCardsFor(data, st),
      fees: { billed: rows.reduce((t, r) => t + r.total, 0), paid: rows.reduce((t, r) => t + r.paid, 0), balance: rows.reduce((t, r) => t + r.total - r.paid, 0), invoices: rows,
        receipts: learner ? [] : paymentRepo.getAll().filter((p) => p.studentId === st.id && (p.status ?? 'confirmed') === 'confirmed').map((p) => ({ number: p.receiptNumber ?? p.reference ?? '', amount: p.amount, date: p.date })) },
      timetable: timetableEntryRepo.getAll().filter((t) => t.classId === st.classId).map((t) => ({ day: t.day, startTime: t.startTime, endTime: t.endTime, kind: t.kind ?? 'lesson', label: t.label, room: t.room, subject: subj(t.subjectId) })),
      homework: repo('homework').getAll().filter((h) => h.classId === st.classId && (h.status ?? 'published') === 'published').sort((a, b) => String(b.dueDate).localeCompare(String(a.dueDate))).map((h) => {
        const sub = submissions.find((x) => x.homeworkId === h.id && x.studentId === st.id);
        const shown = sub?.status === 'marked' && sub.feedbackPublished; // marks and feedback reach the family only once the teacher publishes them
        const out = { id: h.id, title: h.title, instructions: h.instructions, dueDate: h.dueDate, subject: subj(h.subjectId), links: (h.links ?? []).filter((l) => /^https?:\/\//i.test(l)), state: shown || sub?.status !== 'marked' ? (sub?.status ?? 'pending') : 'submitted', marks: shown ? sub.marks : undefined, feedback: shown ? sub.feedback : undefined };
        if (learner) { const c = checkFor(account, h); Object.assign(out, { canHandIn: c.ok, handInNote: c.reason, late: c.late, answer: sub?.text ?? '', attachmentName: sub?.attachment?.name ?? '', maxMarks: h.maxMarks }); }
        return out;
      }),
      materials: repo('learningMaterials').getAll().filter((m) => m.classId === st.classId && m.published !== false).map((m) => ({ id: m.id, title: m.title, type: m.type, url: m.url, body: m.body })),
      liveLessons: repo('liveLessons').getAll().filter((l) => l.classId === st.classId && l.status === 'scheduled' && l.date >= today()).sort((a, b) => String(a.date).localeCompare(String(b.date))),
      attendance: { total: att.length, present: att.filter((a) => a.status === 'present' || a.status === 'late').length },
    });
  }
  const classIds = new Set(kids.map((k) => k.classId)); const streamIds = new Set(kids.map((k) => k.streamId));
  const mine = learner ? 'students' : 'parents';
  const notices = announcementRepo.getAll().filter((a) => !a.audience || a.audience === 'school' || a.audience === mine || (a.audience === 'class' && classIds.has(a.audienceIds?.[0])) || (a.audience === 'stream' && streamIds.has(a.audienceIds?.[0])))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 20).map((a) => ({ id: a.id, title: a.title, body: a.body, date: String(a.createdAt ?? '').slice(0, 10) }));
  return { school: { name: school.name ?? '', currency: school.currency || 'KES', notice: school.privacyNotice ? parentNoticeSections(school, school.privacyNotice, getPlatformSettings()) : null }, parent: { name: account.name }, children, notices, audience: learner ? 'learner' : 'parent' };
}
