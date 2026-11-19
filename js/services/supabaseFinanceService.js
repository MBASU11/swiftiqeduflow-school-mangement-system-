import { uuid } from '../lib/uuid.js';
import { isConfirmed } from './bursarLogic.js';
import { SupabaseRepository } from '../storage/SupabaseRepository.js';
import { getSupabaseClient } from './supabaseClient.js';

const COLLECTIONS = ['students', 'classes', 'terms', 'feeStructures', 'invoices', 'payments', 'expenses', 'school'];

export async function loadFinanceWorkspace() {
  const values = await Promise.all(COLLECTIONS.map((collection) => new SupabaseRepository(collection).getAll()));
  const data = Object.fromEntries(COLLECTIONS.map((collection, index) => [collection, values[index]]));
  data.students = data.students.filter((student) => student.status === 'active');
  data.feeStructures = data.feeStructures.filter((structure) => !structure.archivedAt);
  data.expenses = data.expenses.filter((expense) => !expense.deletedAt);
  data.invoices.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  data.payments.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  data.feeStructures.sort((a, b) => a.name.localeCompare(b.name));
  return data;
}

export function paymentsForInvoice(data, invoiceId) {
  return data.payments.filter((payment) => payment.invoiceId === invoiceId && isConfirmed(payment));
}

export function invoicesForStudent(data, studentId) {
  return data.invoices.filter((invoice) => invoice.studentId === studentId);
}

export function paymentsForStudent(data, studentId) {
  return data.payments.filter((payment) => payment.studentId === studentId && isConfirmed(payment));
}

export function totalsForStudent(data, studentId) {
  const invoices = invoicesForStudent(data, studentId);
  const payments = paymentsForStudent(data, studentId);
  const totalInvoiced = invoices.reduce((sum, invoice) => sum + Number(invoice.totalAmount || 0), 0);
  const totalPaid = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  return { totalInvoiced, totalPaid, balance: totalInvoiced - totalPaid };
}

export function invoicePaymentStatus(data, invoice) {
  const paid = paymentsForInvoice(data, invoice.id).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  return {
    paid,
    balance: Number(invoice.totalAmount || 0) - paid,
    status: paid >= Number(invoice.totalAmount || 0) && Number(invoice.totalAmount || 0) > 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
  };
}

export function createInvoicePayload({ studentId, termId, items, dueDate }) {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    studentId,
    termId: termId || undefined,
    items,
    totalAmount: items.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    dueDate: dueDate || undefined,
    status: 'unpaid',
    createdAt: now,
    updatedAt: now,
  };
}

export async function createRemoteInvoice(invoice) {
  return new SupabaseRepository('invoices').create(invoice, 'created invoice');
}

export async function recordRemotePayment(payment) {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc('record_student_invoice_payment', {
    target_student_id: payment.studentId,
    target_invoice_id: payment.invoiceId,
    payment_amount: Number(payment.amount),
    payment_method: payment.method,
    payment_reference: payment.reference?.trim() || null,
    payment_date: payment.date,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
}

export async function createRemoteFeeStructure(structure) {
  return new SupabaseRepository('feeStructures').create(structure, 'created fee structure');
}

export async function updateRemoteFeeStructure(id, structure, reason) {
  const note = String(reason ?? '').trim();
  if (!note) throw new Error('Give a reason for editing the fee structure.');
  const repo = new SupabaseRepository('feeStructures');
  const current = await repo.getById(id);
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
  return repo.update(id, { ...structure, revisionHistory });
}

export async function deleteRemoteFeeStructure(id, reason) {
  const note = String(reason ?? '').trim();
  if (!note) throw new Error('Give a reason for deleting the fee structure.');
  const [structures, invoices] = await Promise.all([
    new SupabaseRepository('feeStructures').getAll(),
    new SupabaseRepository('invoices').getAll(),
  ]);
  const current = structures.find((structure) => structure.id === id);
  if (!current) throw new Error('Fee structure not found.');
  if (current.archivedAt) throw new Error('Fee structure is already deleted.');
  if (invoices.some((invoice) => invoice.structureId === id)) {
    throw new Error('This fee structure is referenced by invoices and cannot be deleted. Edit it for future invoices instead.');
  }
  return new SupabaseRepository('feeStructures').update(id, { archivedAt: new Date().toISOString(), archiveReason: note });
}

export async function createRemoteExpense(expense) {
  return new SupabaseRepository('expenses').create(expense, 'recorded expense');
}

export async function updateRemoteExpense(id, expense, reason) {
  const note = String(reason ?? '').trim();
  if (!note) throw new Error('Give a reason for editing the expense.');
  const repo = new SupabaseRepository('expenses');
  const current = await repo.getById(id);
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
  return repo.update(id, { ...expense, changeHistory });
}

export async function deleteRemoteExpense(id, reason) {
  const note = String(reason ?? '').trim();
  if (!note) throw new Error('Give a reason for deleting the expense.');
  const repo = new SupabaseRepository('expenses');
  const current = await repo.getById(id);
  if (!current) throw new Error('Expense not found.');
  if (current.deletedAt) throw new Error('Expense is already deleted.');
  return repo.update(id, { deletedAt: new Date().toISOString(), deleteReason: note });
}

export function balancesForStudents(data) {
  return data.students.map((student) => ({ student, ...totalsForStudent(data, student.id) }))
    .filter((row) => row.totalInvoiced > 0);
}

export function financeCollections(data, startDate, endDate) {
  const payments = data.payments.filter((payment) => payment.date >= startDate && payment.date <= endDate && isConfirmed(payment));
  const expenses = data.expenses.filter((expense) => !expense.deletedAt && expense.date >= startDate && expense.date <= endDate);
  return { payments, expenses };
}