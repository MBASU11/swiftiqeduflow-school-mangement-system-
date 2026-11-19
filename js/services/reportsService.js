// Nothing here owns data — every function reads through the same services
// each module already uses, and combines the results. If a module's own
// numbers look right but a report looks wrong, the bug is in this file,
// not in duplicated logic.

import { classesSortedByOrder } from './academicService.js';
import { activeStudents, studentsForClass } from './studentService.js';
import { teacherRepo } from './peopleService.js';
import { summarizeAttendance } from './attendanceService.js';
import { examScoreRepo, getExaminationsFor } from './examService.js';
import {
  allStudentBalances,
  collectionsInRange,
  expenseRepo,
  invoiceRepo,
  paymentRepo,
} from './financeService.js';
import { bookRepo, getActiveTransactions } from './libraryService.js';
import { inventoryItemRepo, lowStockItems } from './inventoryService.js';
import { routeRepo, routeCapacity, routeOccupancy } from './transportService.js';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function schoolOverview() {
  return {
    studentCount: activeStudents().length,
    staffCount: teacherRepo.getAll().filter((t) => t.isActive).length,
    classCount: classesSortedByOrder().length,
    invoiceCount: invoiceRepo.getAll().length,
  };
}

// One row per class: attendance % averaged across students with any record
// in the range, using the same summarizeAttendance() the Attendance module
// itself reports from.
export function attendanceOverview(startDate, endDate) {
  return classesSortedByOrder().map((c) => {
    const rows = summarizeAttendance(c.id, startDate, endDate);
    const withRecords = rows.filter((r) => r.total > 0);
    const average = withRecords.length > 0 ? Math.round(withRecords.reduce((sum, r) => sum + r.percentage, 0) / withRecords.length) : null;
    return { classId: c.id, className: c.name, studentsWithRecords: withRecords.length, averagePercentage: average };
  });
}

// One row per class sitting the most recent examination, averaging every
// subject score recorded for students in that class.
export function academicOverview() {
  const examination = getExaminationsFor()[0];
  if (!examination) return { examination: null, rows: [] };
  const classes = classesSortedByOrder().filter((c) => (examination.classIds || []).includes(c.id));
  const rows = classes.map((c) => {
    const studentIds = new Set(studentsForClass(c.id).map((s) => s.id));
    const scores = examScoreRepo
      .find((s) => s.examinationId === examination.id && studentIds.has(s.studentId) && s.score !== null)
      .map((s) => s.score);
    const average = scores.length > 0 ? Math.round((scores.reduce((sum, v) => sum + v, 0) / scores.length) * 10) / 10 : null;
    return { classId: c.id, className: c.name, scoresRecorded: scores.length, averageScore: average };
  });
  return { examination, rows };
}

export function financeOverview() {
  const students = activeStudents();
  const startDate = daysAgoISO(30);
  const endDate = todayISO();
  const collected = collectionsInRange(startDate, endDate).reduce((sum, p) => sum + p.amount, 0);
  const expenses = expenseRepo.find((e) => e.date >= startDate && e.date <= endDate).reduce((sum, e) => sum + e.amount, 0);
  const balances = allStudentBalances(students).filter((r) => r.balance > 0).sort((a, b) => b.balance - a.balance);
  return {
    startDate,
    endDate,
    collected30d: collected,
    expenses30d: expenses,
    totalPayments: paymentRepo.getAll().length,
    outstandingTotal: balances.reduce((sum, r) => sum + r.balance, 0),
    topOutstanding: balances.slice(0, 5),
  };
}

export function libraryOverview() {
  const active = getActiveTransactions();
  return {
    bookCount: bookRepo.getAll().length,
    onLoan: active.length,
    overdue: active.filter((t) => t.status === 'overdue').length,
  };
}

export function inventoryOverview() {
  const items = inventoryItemRepo.getAll();
  return {
    itemCount: items.length,
    totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
    lowStock: lowStockItems(),
  };
}

export function transportOverview() {
  const routes = routeRepo.getAll();
  const rows = routes.map((r) => {
    const occupancy = routeOccupancy(r.id);
    const capacity = routeCapacity(r);
    return { routeId: r.id, name: r.name, occupancy, capacity, overCapacity: capacity !== null && occupancy > capacity };
  });
  return { routeCount: routes.length, rows };
}

export function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
