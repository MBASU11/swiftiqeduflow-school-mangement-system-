// Gathers the principal's facts from the same services every module already uses (nothing here owns data).
import { classesSortedByOrder } from './academicService.js';
import { attendanceOverview, financeOverview } from './reportsService.js';
import { allStudentBalances } from './financeService.js';
import { activeStudents } from './studentService.js';
import { StorageManager } from '../storage/StorageManager.js';
import { admissionRepo } from './admissionsService.js';
import { lowStockItems } from './inventoryService.js';
import { getExaminationsFor, reportRunRepo } from './examService.js';
import { loadReportData, buildClassResults } from './reportCardService.js';
import { getSchool } from './schoolService.js';
import { participationNow } from './activitiesService.js';
import * as L from './principalLogic.js';

const iso = (d) => d.toISOString().slice(0, 10);

export async function principalSnapshot() {
  const today = iso(new Date()); const from = iso(new Date(Date.now() - 30 * 864e5));
  const classes = classesSortedByOrder(); const runs = reportRunRepo.getAll();
  const exam = getExaminationsFor()[0] ?? null; const currency = getSchool()?.currency || 'KES';
  const att30 = attendanceOverview(from, today);
  const todayRows = StorageManager.filter('attendance', (a) => a.date === today);
  const fin = financeOverview();
  const billed = StorageManager.all('invoices').filter((i) => i.status !== 'void').reduce((t, i) => t + (i.totalAmount ?? 0), 0);
  const board = exam ? L.reportBoard(classes.filter((c) => (exam.classIds ?? []).includes(c.id)), runs, exam.id) : [];
  const academics = [];
  if (exam) {
    const data = await loadReportData();
    for (const c of classes.filter((x) => (exam.classIds ?? []).includes(x.id))) {
      const s = buildClassResults(data, exam.id, c.id).summary;
      if (s.count) academics.push({ classId: c.id, className: c.name, learners: s.count, mean: s.mean, passRate: s.passRate });
    }
  }
  const admissions = admissionRepo.getAll();
  const facts = {
    inModeration: runs.filter((r) => r.status === 'in_moderation').length, approved: runs.filter((r) => r.status === 'approved').length,
    enquiries: admissions.filter((a) => a.stage === 'application').length, toAdmit: admissions.filter((a) => a.stage === 'approved').length,
    lowAttendance: L.lowAttendanceClasses(att30), arrearsCount: allStudentBalances(activeStudents()).filter((r) => r.balance > 0).length,
    arrearsTotal: fin.outstandingTotal, lowStock: lowStockItems().length, currency,
  };
  const part = participationNow();
  return {
    currency, exam, participation: part.total ? { taking: part.taking, total: part.total, pct: part.pct } : null, students: activeStudents().length,
    attendanceToday: todayRows.length ? Math.round((todayRows.filter((a) => a.status === 'present').length / todayRows.length) * 100) : null,
    collected30d: fin.collected30d, outstanding: fin.outstandingTotal, collectionRate: L.collectionRate(billed, billed - fin.outstandingTotal), topOutstanding: fin.topOutstanding,
    attendanceByClass: att30.filter((r) => r.averagePercentage !== null).sort((a, b) => a.averagePercentage - b.averagePercentage),
    board, academics: academics.sort((a, b) => (a.mean ?? 0) - (b.mean ?? 0)), attention: L.attentionItems(facts),
  };
}
