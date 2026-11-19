import { LocalStorageRepository } from '../storage/Repository.js';
import { StorageManager } from '../storage/StorageManager.js';
import { uuid } from '../lib/uuid.js';
import { isConfirmed, paidOn, creditsOn } from './bursarLogic.js';

export const feeStructureRepo = new LocalStorageRepository('feeStructures', 'fee structure');
export const invoiceRepo = new LocalStorageRepository('invoices', 'invoice');
export const paymentRepo = new LocalStorageRepository('payments', 'payment');
export const expenseRepo = new LocalStorageRepository('expenses', 'expense');
const creditNoteRepo = new LocalStorageRepository('creditNotes', 'credit note');

export function updateFeeStructure(id, structure, reason) {
  const note = String(reason ?? '').trim();
  if (!note) throw new Error('Give a reason for editing the fee structure.');
  const current = feeStructureRepo.getById(id);
  if (!current) throw new Error('Fee structure not found.');
  if (current.archivedAt) throw new Error('A deleted fee structure cannot be edited.');
  const revisionHistory = [...(current.revisionHistory ?? []), {
    at: new Date().toISOString(),
    name: current.name,
    classId: current.classId,
    termId: current.termId,
    items: current.items,
    reason: note,
  }];
  return feeStructureRepo.update(id, { ...structure, revisionHistory }, 'corrected fee structure');
}

export function deleteFeeStructure(id, reason) {
  const note = String(reason ?? '').trim();
  if (!note) throw new Error('Give a reason for deleting the fee structure.');
  const current = feeStructureRepo.getById(id);
  if (!current) throw new Error('Fee structure not found.');
  if (current.archivedAt) throw new Error('Fee structure is already deleted.');
  if (invoiceRepo.find((invoice) => invoice.structureId === id).length) {
    throw new Error('This fee structure is referenced by invoices and cannot be deleted. Edit it for future invoices instead.');
  }
  return feeStructureRepo.update(id, { archivedAt: new Date().toISOString(), archiveReason: note }, 'archived fee structure');
}

export function updateExpense(id, expense, reason) {
  const note = String(reason ?? '').trim();
  if (!note) throw new Error('Give a reason for editing the expense.');
  const current = expenseRepo.getById(id);
  if (!current) throw new Error('Expense not found.');
  if (current.deletedAt) throw new Error('A deleted expense cannot be edited.');
  const changeHistory = [...(current.changeHistory ?? []), {
    at: new Date().toISOString(),
    category: current.category,
    amount: current.amount,
    date: current.date,
    supplier: current.supplier,
    description: current.description,
    receiptReference: current.receiptReference,
    reason: note,
  }];
  return expenseRepo.update(id, { ...expense, changeHistory }, 'corrected expense');
}

export function deleteExpense(id, reason) {
  const note = String(reason ?? '').trim();
  if (!note) throw new Error('Give a reason for deleting the expense.');
  const current = expenseRepo.getById(id);
  if (!current) throw new Error('Expense not found.');
  if (current.deletedAt) throw new Error('Expense is already deleted.');
  return expenseRepo.update(id, { deletedAt: new Date().toISOString(), deleteReason: note }, 'deleted expense');
}

export function invoiceTotal(items) {
  return items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
}

export function createInvoice({ studentId, termId, items, dueDate }) {
  const total = invoiceTotal(items);
  return invoiceRepo.create({
    studentId,
    termId,
    items,
    totalAmount: total,
    dueDate: dueDate || undefined,
    status: 'unpaid',
  });
}

export function createInvoiceFromFeeStructure(studentId, feeStructureId, dueDate) {
  const structure = feeStructureRepo.getById(feeStructureId);
  if (!structure) return undefined;
  const items = structure.items.map((i) => ({ id: uuid(), name: i.name, amount: i.amount }));
  return createInvoice({ studentId, termId: structure.termId, items, dueDate });
}

export function getInvoicesForStudent(studentId) {
  return invoiceRepo.find((i) => i.studentId === studentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getPaymentsForStudent(studentId) {
  return paymentRepo.find((p) => p.studentId === studentId).sort((a, b) => b.date.localeCompare(a.date));
}

export function getPaymentsForInvoice(invoiceId) {
  return paymentRepo.find((p) => p.invoiceId === invoiceId);
}

export function invoicePaidAmount(invoiceId) {
  // Only confirmed payments count (pending/rejected never reduce a balance); a payment split across
  // several invoices counts only its share for this one.
  return paidOn({ id: invoiceId }, paymentRepo.getAll());
}

function refreshInvoiceStatus(invoiceId) {
  const invoice = invoiceRepo.getById(invoiceId);
  if (!invoice) return;
  const paid = invoicePaidAmount(invoiceId);
  let status = 'unpaid';
  const billed = Math.max(0, invoice.totalAmount - creditsOn(invoiceId, creditNoteRepo.getAll())); // approved credit notes lower what is owed
  if (paid >= billed && invoice.totalAmount > 0) status = 'paid';
  else if (paid > 0) status = 'partial';
  if (invoice.status !== status) invoiceRepo.update(invoiceId, { status });
}

// Records a payment. If invoiceId is given, applies it to that invoice and
// refreshes its status (unpaid/partial/paid). Idempotent in the sense that
// each call creates one payment record — balances are always derived by
// summing payments, never stored redundantly.
export function recordPayment({ studentId, invoiceId, amount, method, reference, date }) {
  const payment = paymentRepo.create({
    studentId,
    invoiceId: invoiceId || undefined,
    amount: Number(amount),
    method,
    reference: reference || undefined,
    date,
  });
  if (invoiceId) refreshInvoiceStatus(invoiceId);
  return payment;
}

export function studentTotals(studentId) {
  const invoices = getInvoicesForStudent(studentId);
  const payments = getPaymentsForStudent(studentId).filter(isConfirmed);
  const credits = creditNoteRepo.getAll();
  const totalInvoiced = invoices.filter((i) => i.status !== 'void').reduce((sum, i) => sum + Math.max(0, i.totalAmount - creditsOn(i.id, credits)), 0);
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  return { totalInvoiced, totalPaid, balance: totalInvoiced - totalPaid };
}

export function allStudentBalances(students) {
  return students
    .map((s) => ({ student: s, ...studentTotals(s.id) }))
    .filter((row) => row.totalInvoiced > 0);
}

export function collectionsInRange(startDate, endDate) {
  return paymentRepo.find((p) => p.date >= startDate && p.date <= endDate && isConfirmed(p));
}

export function collectionsByMethod(payments) {
  const byMethod = {};
  payments.forEach((p) => {
    byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
  });
  return byMethod;
}

export function classBalances(students, classById) {
  const rows = allStudentBalances(students);
  const byClass = {};
  rows.forEach((r) => {
    const className = classById[r.student.classId ?? '']?.name ?? 'No class';
    if (!byClass[className]) byClass[className] = { invoiced: 0, paid: 0, balance: 0 };
    byClass[className].invoiced += r.totalInvoiced;
    byClass[className].paid += r.totalPaid;
    byClass[className].balance += r.balance;
  });
  return byClass;
}

export function totalOutstanding(students) {
  return allStudentBalances(students).reduce((sum, r) => sum + Math.max(0, r.balance), 0);
}

export function totalExpensesInRange(startDate, endDate) {
  return expenseRepo.find((e) => !e.deletedAt && e.date >= startDate && e.date <= endDate).reduce((sum, e) => sum + e.amount, 0);
}
