import { LocalStorageRepository } from '../storage/Repository.js';
import { currentAccount } from './authService.js';

export const bookRepo = new LocalStorageRepository('libraryBooks', 'book');
export const libraryTransactionRepo = new LocalStorageRepository('libraryTransactions', 'library transaction');

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function activeTransactionsForBook(bookId) {
  return libraryTransactionRepo.find((t) => t.bookId === bookId && !['returned', 'entered-in-error'].includes(t.status));
}

export function availableCopies(book) {
  return book.totalCopies - activeTransactionsForBook(book.id).length;
}

export function updateBookCatalog(id, details) {
  const book = bookRepo.getById(id);
  if (!book) throw new Error('This book no longer exists.');
  const activeLoans = activeTransactionsForBook(id).length;
  if (Number(details.totalCopies) < activeLoans) throw new Error(`At least ${activeLoans} copies are currently on loan.`);
  return bookRepo.update(id, details, 'updated library book');
}

export function borrowBook({ bookId, borrowerType, borrowerId, borrowerName, dueDate }) {
  const book = bookRepo.getById(bookId);
  if (!book || availableCopies(book) <= 0) return undefined;
  return libraryTransactionRepo.create({
    bookId,
    borrowerType,
    borrowerId,
    borrowerName,
    borrowedDate: todayISO(),
    dueDate,
    returnedDate: undefined,
    status: 'borrowed',
  });
}

export function returnBook(transactionId) {
  return libraryTransactionRepo.update(transactionId, { returnedDate: todayISO(), status: 'returned' }, 'returned library book');
}

export function getActiveTransactions() {
  const today = todayISO();
  return libraryTransactionRepo
    .find((t) => !['returned', 'entered-in-error'].includes(t.status))
    .map((t) => (t.dueDate < today ? { ...t, status: 'overdue' } : t))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function correctLibraryLoan(id, reason) {
  const cleanReason = String(reason ?? '').trim();
  if (!cleanReason) return { ok: false, reason: 'Provide a reason for correcting this loan.' };
  const transaction = libraryTransactionRepo.getById(id);
  if (!transaction || transaction.status === 'returned' || transaction.correctionStatus === 'entered-in-error') return { ok: false, reason: 'Only an active loan can be corrected.' };
  return { ok: true, transaction: libraryTransactionRepo.update(id, {
    status: 'returned',
    returnedDate: todayISO(),
    correctionStatus: 'entered-in-error',
    correctionReason: cleanReason,
    correctedAt: new Date().toISOString(),
    correctedBy: currentAccount()?.name ?? 'Administrator',
  }, 'corrected library loan') };
}

export function getHistoryForBook(bookId) {
  return libraryTransactionRepo.find((t) => t.bookId === bookId).sort((a, b) => b.borrowedDate.localeCompare(a.borrowedDate));
}
