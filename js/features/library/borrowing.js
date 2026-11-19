import { escapeHtml, qs } from '../../components/dom.js';
import { bookRepo, availableCopies, borrowBook, returnBook, getActiveTransactions, correctLibraryLoan } from '../../services/libraryService.js';
import { studentRepo, fullName } from '../../services/studentService.js';
import { teacherRepo, teacherFullName } from '../../services/peopleService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { activeLibraryLoans, availableRemoteCopies, borrowRemoteBook, correctRemoteLibraryLoan, loadLibraryWorkspace, returnRemoteBook } from '../../services/supabaseLibraryService.js';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function daysFromNowISO(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function borrowersFor(type) {
  if (type === 'teacher') return teacherRepo.getAll().map((t) => ({ id: t.id, name: teacherFullName(t) }));
  return studentRepo.getAll().filter((s) => s.status === 'active').map((s) => ({ id: s.id, name: fullName(s) }));
}

export function renderBorrowing(container) {
  if (isSupabaseConfigured()) return renderRemoteBorrowing(container);
  const state = { formOpen: false, bookId: '', borrowerType: 'student', borrowerId: '', dueDate: daysFromNowISO(14) };

  function render() {
    const books = bookRepo.getAll().filter((b) => availableCopies(b) > 0);
    const active = getActiveTransactions();
    const bookById = Object.fromEntries(bookRepo.getAll().map((b) => [b.id, b]));

    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center">
          <p class="text-sm text-ink-500">Books currently on loan. Overdue items are flagged automatically.</p>
          <button class="btn-primary" id="new-borrow-btn" ${books.length === 0 ? 'disabled title="No copies available"' : ''}>+ Borrow a book</button>
        </div>

        ${state.formOpen ? formHtml(books) : ''}

        ${
          active.length === 0
            ? `<div class="card">${emptyState({ iconHtml: icons.library(40), title: 'No books currently on loan' })}</div>`
            : `<div class="card overflow-x-auto">
                <table class="data-table">
                  <thead><tr><th>Book</th><th>Borrower</th><th>Borrowed</th><th>Due</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    ${active
                      .map(
                        (t) => `<tr>
                          <td style="font-weight:500;">${escapeHtml(bookById[t.bookId]?.title ?? '—')}</td>
                          <td class="text-ink-600">${escapeHtml(t.borrowerName)} <span class="text-ink-400 text-xs">(${t.borrowerType})</span></td>
                          <td class="text-ink-600">${escapeHtml(t.borrowedDate)}</td>
                          <td class="text-ink-600">${escapeHtml(t.dueDate)}</td>
                          <td><span class="badge ${t.status === 'overdue' ? '' : 'badge-good'}" style="${t.status === 'overdue' ? 'background:rgba(176,65,62,0.1);color:var(--bad);' : ''}">${escapeHtml(t.status)}</span></td>
                          <td class="text-right"><button data-return="${t.id}" class="btn-secondary btn-sm">Mark returned</button><button data-correct-loan="${t.id}" class="btn-ghost btn-sm">Correct loan</button></td>
                        </tr>`
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>`
        }
      </div>
    `;

    qs(container, '#new-borrow-btn').addEventListener('click', () => {
      if (books.length === 0) return;
      state.formOpen = true;
      render();
    });

    if (state.formOpen) wireForm(books);

    container.querySelectorAll('[data-return]').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        if (!confirm('Mark this book as returned?')) return;
        returnBook(e.currentTarget.getAttribute('data-return'));
        render();
      })
    );
    container.querySelectorAll('[data-correct-loan]').forEach((btn) => btn.addEventListener('click', (event) => {
      if (!confirm('Mark this loan as entered in error? It will remain in the audit history.')) return;
      const reason = prompt('Required correction reason:') ?? '';
      const result = correctLibraryLoan(event.currentTarget.dataset.correctLoan, reason);
      if (!result.ok) alert(result.reason);
      render();
    }));
  }

  function formHtml(books) {
    const borrowers = borrowersFor(state.borrowerType);
    // No blank placeholder in these selects, so default state to the
    // browser's own visual default (the first option) to avoid a mismatch.
    if (!state.bookId && books.length > 0) state.bookId = books[0].id;
    if (!state.borrowerId && borrowers.length > 0) state.borrowerId = borrowers[0].id;

    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">Borrow a book</h3>
        <div class="grid sm-grid-2 gap-4">
          <div>
            <label class="label">Book</label>
            <select class="input" id="borrow-book">
              ${books.map((b) => `<option value="${b.id}" ${state.bookId === b.id ? 'selected' : ''}>${escapeHtml(b.title)} (${availableCopies(b)} available)</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="label">Due date</label>
            <input type="date" class="input" id="borrow-due" value="${escapeHtml(state.dueDate)}" />
          </div>
        </div>
        <div class="grid sm-grid-2 gap-4">
          <div>
            <label class="label">Borrower type</label>
            <select class="input" id="borrow-type">
              <option value="student" ${state.borrowerType === 'student' ? 'selected' : ''}>Student</option>
              <option value="teacher" ${state.borrowerType === 'teacher' ? 'selected' : ''}>Teacher / Staff</option>
            </select>
          </div>
          <div>
            <label class="label">Borrower</label>
            <select class="input" id="borrow-person" ${borrowers.length === 0 ? 'disabled' : ''}>
              ${borrowers.length === 0 ? '<option>None available</option>' : borrowers.map((p) => `<option value="${p.id}" ${state.borrowerId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-borrow-btn">Cancel</button>
          <button class="btn-primary" id="save-borrow-btn" ${borrowers.length === 0 ? 'disabled' : ''}>Borrow</button>
        </div>
      </div>
    `;
  }

  function wireForm(books) {
    qs(container, '#borrow-book').addEventListener('change', (e) => (state.bookId = e.target.value));
    qs(container, '#borrow-due').addEventListener('input', (e) => (state.dueDate = e.target.value));
    qs(container, '#borrow-type').addEventListener('change', (e) => {
      state.borrowerType = e.target.value;
      state.borrowerId = '';
      render();
    });
    const personSelect = qs(container, '#borrow-person');
    if (personSelect) personSelect.addEventListener('change', (e) => (state.borrowerId = e.target.value));
    qs(container, '#cancel-borrow-btn').addEventListener('click', () => { state.formOpen = false; render(); });
    qs(container, '#save-borrow-btn').addEventListener('click', () => {
      if (!state.bookId || !state.borrowerId) return;
      const borrower = borrowersFor(state.borrowerType).find((p) => p.id === state.borrowerId);
      if (!borrower) return;
      borrowBook({
        bookId: state.bookId,
        borrowerType: state.borrowerType,
        borrowerId: state.borrowerId,
        borrowerName: borrower.name,
        dueDate: state.dueDate,
      });
      state.formOpen = false;
      state.bookId = '';
      state.borrowerId = '';
      render();
    });
  }

  render();
}

async function renderRemoteBorrowing(container) {
  const state = {
    data: null,
    formOpen: false,
    bookId: '',
    borrowerType: 'student',
    borrowerId: '',
    dueDate: daysFromNowISO(14),
    error: '',
    busy: false,
  };

  async function render() {
    try {
      state.data ??= await loadLibraryWorkspace();
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="library-borrow-retry">Retry</button></div>`;
      qs(container, '#library-borrow-retry').addEventListener('click', () => { state.data = null; state.error = ''; render(); });
      return;
    }
    const items = state.data.books.map((book) => ({ ...book, available: availableRemoteCopies(state.data, book) }));
    const books = items.filter((book) => book.available > 0);
    state.bookId ||= books[0]?.id ?? '';
    const active = activeLibraryLoans(state.data);
    const bookById = Object.fromEntries(state.data.books.map((book) => [book.id, book]));
    const borrowers = state.borrowerType === 'teacher'
      ? state.data.teachers.filter((teacher) => teacher.isActive).map((teacher) => ({ id: teacher.id, name: teacherFullName(teacher) }))
      : state.data.students.filter((student) => student.status === 'active').map((student) => ({ id: student.id, name: fullName(student) }));
    state.borrowerId = borrowers.some((borrower) => borrower.id === state.borrowerId) ? state.borrowerId : (borrowers[0]?.id ?? '');

    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center"><p class="text-sm text-ink-500">Books currently on loan. Overdue items are flagged automatically.</p><button class="btn-primary" id="new-borrow-btn" ${books.length === 0 || state.busy ? 'disabled title="No copies available"' : ''}>+ Borrow a book</button></div>
        ${state.formOpen ? formHtml(books, borrowers) : ''}
        ${active.length === 0
          ? `<div class="card">${emptyState({ iconHtml: icons.library(40), title: 'No books currently on loan' })}</div>`
          : `<div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Book</th><th>Borrower</th><th>Borrowed</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${active.map((transaction) => `<tr><td style="font-weight:500;">${escapeHtml(bookById[transaction.bookId]?.title ?? '—')}</td><td class="text-ink-600">${escapeHtml(transaction.borrowerName)} <span class="text-ink-400 text-xs">(${escapeHtml(transaction.borrowerType)})</span></td><td class="text-ink-600">${escapeHtml(transaction.borrowedDate)}</td><td class="text-ink-600">${escapeHtml(transaction.dueDate)}</td><td><span class="badge ${transaction.status === 'overdue' ? '' : 'badge-good'}" style="${transaction.status === 'overdue' ? 'background:rgba(176,65,62,0.1);color:var(--bad);' : ''}">${escapeHtml(transaction.status)}</span></td><td class="text-right"><button data-return="${transaction.id}" class="btn-secondary btn-sm" ${state.busy ? 'disabled' : ''}>Mark returned</button><button data-correct-loan="${transaction.id}" class="btn-ghost btn-sm" ${state.busy ? 'disabled' : ''}>Correct loan</button></td></tr>`).join('')}</tbody></table></div>`}
      </div>`;

    qs(container, '#new-borrow-btn').addEventListener('click', () => {
      if (!books.length) return;
      state.formOpen = true;
      render();
    });
    if (state.formOpen) wireForm(books, borrowers);
    container.querySelectorAll('[data-return]').forEach((button) => button.addEventListener('click', async (event) => {
      if (!confirm('Mark this book as returned?')) return;
      const transactionId = event.currentTarget.getAttribute('data-return');
      state.busy = true;
      state.error = '';
      await render();
      try {
        await returnRemoteBook(transactionId);
        state.data = null;
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      state.busy = false;
      await render();
    }));
    container.querySelectorAll('[data-correct-loan]').forEach((button) => button.addEventListener('click', async (event) => {
      if (!confirm('Mark this loan as entered in error? It will remain in the audit history.')) return;
      const reason = prompt('Required correction reason:') ?? '';
      state.busy = true;
      state.error = '';
      await render();
      try {
        await correctRemoteLibraryLoan(event.currentTarget.dataset.correctLoan, reason);
        state.data = null;
      } catch (error) { state.error = error.message; }
      state.busy = false;
      await render();
    }));
  }

  function formHtml(books, borrowers) {
    return `<div class="card card-p space-y-4"><h3 class="text-sm text-ink-700" style="font-weight:600;">Borrow a book</h3>
      <div class="grid sm-grid-2 gap-4"><div><label class="label">Book</label><select class="input" id="borrow-book">${books.map((book) => `<option value="${book.id}" ${state.bookId === book.id ? 'selected' : ''}>${escapeHtml(book.title)} (${book.available} available)</option>`).join('')}</select></div><div><label class="label">Due date</label><input type="date" class="input" id="borrow-due" value="${escapeHtml(state.dueDate)}" /></div></div>
      <div class="grid sm-grid-2 gap-4"><div><label class="label">Borrower type</label><select class="input" id="borrow-type"><option value="student" ${state.borrowerType === 'student' ? 'selected' : ''}>Student</option><option value="teacher" ${state.borrowerType === 'teacher' ? 'selected' : ''}>Teacher / Staff</option></select></div><div><label class="label">Borrower</label><select class="input" id="borrow-person" ${borrowers.length === 0 ? 'disabled' : ''}>${borrowers.length === 0 ? '<option>None available</option>' : borrowers.map((borrower) => `<option value="${borrower.id}" ${state.borrowerId === borrower.id ? 'selected' : ''}>${escapeHtml(borrower.name)}</option>`).join('')}</select></div></div>
      <div class="flex justify-end gap-3"><button class="btn-secondary" id="cancel-borrow-btn">Cancel</button><button class="btn-primary" id="save-borrow-btn" ${borrowers.length === 0 || state.busy ? 'disabled' : ''}>${state.busy ? 'Saving...' : 'Borrow'}</button></div></div>`;
  }

  function wireForm(books, borrowers) {
    qs(container, '#borrow-book').addEventListener('change', (event) => { state.bookId = event.target.value; });
    qs(container, '#borrow-due').addEventListener('input', (event) => { state.dueDate = event.target.value; });
    qs(container, '#borrow-type').addEventListener('change', (event) => { state.borrowerType = event.target.value; state.borrowerId = ''; render(); });
    qs(container, '#borrow-person').addEventListener('change', (event) => { state.borrowerId = event.target.value; });
    qs(container, '#cancel-borrow-btn').addEventListener('click', () => { state.formOpen = false; render(); });
    qs(container, '#save-borrow-btn').addEventListener('click', async () => {
      const borrower = borrowers.find((person) => person.id === state.borrowerId);
      if (!state.bookId || !borrower) return;
      state.busy = true;
      state.error = '';
      await render();
      try {
        await borrowRemoteBook({ bookId: state.bookId, borrowerType: state.borrowerType, borrowerId: borrower.id, borrowerName: borrower.name, dueDate: state.dueDate });
        state.data = null;
        state.formOpen = false;
        state.bookId = '';
        state.borrowerId = '';
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      state.busy = false;
      await render();
    });
  }

  render();
}
