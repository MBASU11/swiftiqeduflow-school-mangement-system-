import { loadAttendanceWorkspace, summarizeRemoteAttendance } from './supabaseAttendanceService.js';
import { balancesForStudents, financeCollections, loadFinanceWorkspace } from './supabaseFinanceService.js';
import { activeLibraryLoans, loadLibraryWorkspace } from './supabaseLibraryService.js';
import { loadTransportWorkspace, assignmentsForRoute, transportCapacity } from './supabaseTransportService.js';
import { SupabaseRepository } from '../storage/SupabaseRepository.js';

export async function loadRemoteReportsWorkspace() {
  const [schoolRecords, attendance, finance, library, inventory, transport, teachers] = await Promise.all([
    Promise.all(['school', 'students', 'classes', 'teachers'].map((collection) => new SupabaseRepository(collection).getAll())),
    loadAttendanceWorkspace(),
    loadFinanceWorkspace(),
    loadLibraryWorkspace(),
    Promise.all([new SupabaseRepository('inventory').getAll(), new SupabaseRepository('inventoryTransactions').getAll()]),
    loadTransportWorkspace(),
    new SupabaseRepository('teachers').getAll(),
  ]);
  const [schools, students, classes, staff] = schoolRecords;
  return {
    school: schools[0],
    students: students.filter((student) => student.status === 'active'),
    classes: classes.sort((a, b) => a.order - b.order),
    staff: staff.filter((teacher) => teacher.isActive),
    attendance,
    finance,
    library,
    inventory: { items: inventory[0], transactions: inventory[1] },
    transport,
    teachers,
  };
}

export function remoteSchoolOverview(data) {
  return {
    studentCount: data.students.length,
    staffCount: data.staff.length,
    classCount: data.classes.length,
    invoiceCount: data.finance.invoices.length,
  };
}

export function remoteAttendanceOverview(data, startDate, endDate) {
  return data.classes.map((schoolClass) => {
    const rows = summarizeRemoteAttendance(data.attendance.attendance, schoolClass.id, startDate, endDate);
    const withRecords = rows.filter((row) => row.total > 0);
    return {
      classId: schoolClass.id,
      className: schoolClass.name,
      studentsWithRecords: withRecords.length,
      averagePercentage: withRecords.length
        ? Math.round(withRecords.reduce((sum, row) => sum + row.percentage, 0) / withRecords.length)
        : null,
    };
  });
}

export function remoteFinanceOverview(data, startDate, endDate) {
  const { payments, expenses } = financeCollections(data.finance, startDate, endDate);
  const balances = balancesForStudents(data.finance).filter((row) => row.balance > 0).sort((a, b) => b.balance - a.balance);
  return {
    startDate,
    endDate,
    collected30d: payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
    expenses30d: expenses.reduce((sum, expense) => sum + Number(expense.amount), 0),
    totalPayments: data.finance.payments.length,
    outstandingTotal: balances.reduce((sum, row) => sum + row.balance, 0),
    topOutstanding: balances.slice(0, 5),
  };
}

export function remoteLibraryOverview(data) {
  const active = activeLibraryLoans(data.library);
  return { bookCount: data.library.books.length, onLoan: active.length, overdue: active.filter((loan) => loan.status === 'overdue').length };
}

export function remoteInventoryOverview(data) {
  const items = data.inventory.items;
  const lowStock = items.filter((item) => item.quantity <= 3);
  return { itemCount: items.length, totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0), lowStock };
}

export function remoteTransportOverview(data) {
  const rows = data.transport.routes.map((route) => {
    const occupancy = assignmentsForRoute(data.transport, route.id).length;
    const capacity = transportCapacity(data.transport, route);
    return { routeId: route.id, name: route.name, occupancy, capacity, overCapacity: capacity !== null && occupancy > capacity };
  });
  return { routeCount: rows.length, rows };
}