import { SupabaseRepository } from '../storage/SupabaseRepository.js';
import { getSupabaseClient } from './supabaseClient.js';
import { currentAccount } from './authService.js';

export async function loadLibraryWorkspace() {
  const [books, transactions, students, teachers] = await Promise.all([
    new SupabaseRepository('libraryBooks').getAll(),
    new SupabaseRepository('libraryTransactions').getAll(),
    new SupabaseRepository('students').getAll(),
    new SupabaseRepository('teachers').getAll(),
  ]);
  return { books, transactions, students, teachers };
}

export function activeLibraryLoans(data) {
  const today = new Date().toISOString().slice(0, 10);
  return data.transactions
    .filter((transaction) => !['returned', 'entered-in-error'].includes(transaction.status))
    .map((transaction) => ({ ...transaction, status: transaction.dueDate < today ? 'overdue' : 'borrowed' }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function availableRemoteCopies(data, book) {
  const activeCount = data.transactions.filter((transaction) => transaction.bookId === book.id && !['returned', 'entered-in-error'].includes(transaction.status)).length;
  return Math.max(0, book.totalCopies - activeCount);
}

export async function createRemoteBook(details) {
  return new SupabaseRepository('libraryBooks').create(details, 'added book');
}

export async function updateRemoteBook(id, details) {
  const [books, transactions] = await Promise.all([
    new SupabaseRepository('libraryBooks').getAll(),
    new SupabaseRepository('libraryTransactions').getAll(),
  ]);
  if (!books.some((book) => book.id === id)) throw new Error('This book no longer exists.');
  const activeLoans = transactions.filter((transaction) => transaction.bookId === id && !['returned', 'entered-in-error'].includes(transaction.status)).length;
  if (Number(details.totalCopies) < activeLoans) throw new Error(`At least ${activeLoans} copies are currently on loan.`);
  return new SupabaseRepository('libraryBooks').update(id, details, 'updated library book');
}

export async function removeRemoteBook(id) {
  const transactions = await new SupabaseRepository('libraryTransactions').getAll();
  if (transactions.some((transaction) => transaction.bookId === id)) {
    throw new Error('This book has loan history. It cannot be removed because loan records must be retained.');
  }
  const client = await getSupabaseClient();
  const { error } = await client.rpc('remove_library_book', { target_book_id: id });
  if (error) throw error;
}

export async function borrowRemoteBook({ bookId, borrowerType, borrowerId, borrowerName, dueDate }) {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc('borrow_library_book', {
    target_book_id: bookId,
    borrower_type: borrowerType,
    borrower_id: borrowerId,
    borrower_name: borrowerName,
    due_date: dueDate,
  });
  if (error) throw error;
  return data;
}

export async function returnRemoteBook(transactionId) {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc('return_library_book', { target_transaction_id: transactionId });
  if (error) throw error;
  return data;
}

export async function correctRemoteLibraryLoan(id, reason) {
  const cleanReason = String(reason ?? '').trim();
  if (!cleanReason) throw new Error('Provide a reason for correcting this loan.');
  const repository = new SupabaseRepository('libraryTransactions');
  const transaction = await repository.getById(id);
  if (!transaction || transaction.status === 'returned' || transaction.correctionStatus === 'entered-in-error') throw new Error('Only an active loan can be corrected.');
  return repository.update(id, {
    status: 'returned',
    returnedDate: new Date().toISOString().slice(0, 10),
    correctionStatus: 'entered-in-error',
    correctionReason: cleanReason,
    correctedAt: new Date().toISOString(),
    correctedBy: currentAccount()?.name ?? 'Administrator',
  }, 'corrected library loan');
}