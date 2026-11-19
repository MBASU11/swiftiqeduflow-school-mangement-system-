import { escapeHtml, on, qs } from '../../components/dom.js';
import { teacherRepo } from '../../services/peopleService.js';
import { bookRepo, availableCopies, activeTransactionsForBook, getHistoryForBook, updateBookCatalog } from '../../services/libraryService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { availableRemoteCopies, createRemoteBook, loadLibraryWorkspace, removeRemoteBook, updateRemoteBook } from '../../services/supabaseLibraryService.js';

export function renderBooksManager(container) {
  const remote = isSupabaseConfigured();
  const state = { query: '', formOpen: false, editId: '', title: '', author: '', category: '', isbn: '', totalCopies: '1', data: null, error: '' };

  async function render() {
    let allBooks;
    let staff;
    try {
      if (remote) {
        state.data ??= await loadLibraryWorkspace();
        allBooks = state.data.books;
        staff = state.data.teachers;
      } else {
        allBooks = bookRepo.getAll();
        staff = teacherRepo.getAll();
      }
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="library-retry">Retry</button></div>`;
      qs(container, '#library-retry').addEventListener('click', () => { state.data = null; state.error = ''; render(); });
      return;
    }
    let books = allBooks;
    if (state.query.trim()) {
      const q = state.query.trim().toLowerCase();
      books = books.filter((b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q));
    }
    books = [...books].sort((a, b) => a.title.localeCompare(b.title));

    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center flex-wrap gap-3">
          <input class="input" style="max-width:18rem" id="book-search" placeholder="Search by title or author" value="${escapeHtml(state.query)}" />
          <button class="btn-primary" id="new-book-btn">+ Add book</button>
        </div>

        ${state.formOpen ? formHtml(staff) : ''}

        ${
          allBooks.length === 0
            ? `<div class="card">${emptyState({
                iconHtml: icons.library(40),
                title: 'No books yet',
                body: 'Add your library catalog to start tracking borrowing.',
                actionsHtml: `<button class="btn-primary" id="empty-new-btn">+ Add book</button>`,
              })}</div>`
            : `<div class="card overflow-x-auto">
                <table class="data-table">
                  <thead><tr><th>Title</th><th>Author</th><th>Category</th><th class="text-right">Copies</th><th class="text-right"></th></tr></thead>
                  <tbody>
                    ${books
                      .map((b) => {
                        const available = remote ? availableRemoteCopies(state.data, b) : availableCopies(b);
                        return `<tr>
                          <td style="font-weight:500;">${escapeHtml(b.title)}</td>
                          <td class="text-ink-600">${escapeHtml(b.author)}</td>
                          <td class="text-ink-600">${escapeHtml(b.category || '—')}</td>
                          <td class="text-right">${available}/${b.totalCopies} available</td>
                          <td class="text-right" style="white-space:nowrap;"><button data-edit="${b.id}" class="text-brand-700" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;">Edit</button><button data-remove="${b.id}" class="text-bad" style="background:none;border:none;cursor:pointer;text-decoration:underline;margin-left:.75rem;font-family:inherit;">Remove</button></td>
                        </tr>`;
                      })
                      .join('')}
                  </tbody>
                </table>
              </div>`
        }
        ${books.length === 0 && allBooks.length > 0 ? `<p class="text-sm text-ink-400">No books match this search.</p>` : ''}
      </div>
    `;

    const search = qs(container, '#book-search');
    if (search) search.addEventListener('input', async (e) => { const cursor = e.target.selectionStart; state.query = e.target.value; await render(); const again = qs(container, '#book-search'); again.focus(); again.setSelectionRange(cursor, cursor); });
    qs(container, '#new-book-btn').addEventListener('click', () => { state.formOpen = true; render(); });
    const emptyBtn = qs(container, '#empty-new-btn');
    if (emptyBtn) emptyBtn.addEventListener('click', () => { state.formOpen = true; render(); });

    if (state.formOpen) wireForm();

    on(container, '[data-edit]', 'click', (e) => {
      const book = allBooks.find((item) => item.id === e.currentTarget.getAttribute('data-edit'));
      if (!book) return;
      Object.assign(state, { editId: book.id, title: book.title, author: book.author, category: book.category ?? '', isbn: book.isbn ?? '', totalCopies: String(book.totalCopies), formOpen: true });
      render();
    });

    on(container, '[data-remove]', 'click', async (e) => {
      const id = e.currentTarget.getAttribute('data-remove');
      const book = remote ? allBooks.find((item) => item.id === id) : bookRepo.getById(id);
      const hasHistory = remote
        ? state.data.transactions.some((transaction) => transaction.bookId === id)
        : getHistoryForBook(id).length > 0;
      if (book && hasHistory) {
        alert('This book has loan history. It cannot be removed because loan records must be retained.');
        return;
      }
      if (!confirm('Remove this book from the catalog?')) return;
      try {
        if (remote) await removeRemoteBook(id);
        else bookRepo.remove(id, 'removed library book');
        state.data = null;
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
  }

  function formHtml(staff) {
    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editId ? 'Edit book' : 'Add book'}</h3>
        <div class="grid sm-grid-2 gap-4">
          <div>
            <label class="label">Title</label>
            <input class="input" id="book-title" value="${escapeHtml(state.title)}" />
          </div>
          <div>
            <label class="label">Author</label>
            <input class="input" id="book-author" value="${escapeHtml(state.author)}" />
          </div>
        </div>
        <div class="grid sm-grid-3 gap-4">
          <div>
            <label class="label">Category</label>
            <input class="input" id="book-category" value="${escapeHtml(state.category)}" placeholder="e.g. Fiction" />
          </div>
          <div>
            <label class="label">ISBN (optional)</label>
            <input class="input" id="book-isbn" value="${escapeHtml(state.isbn)}" />
          </div>
          <div>
            <label class="label">Total copies</label>
            <input type="number" min="1" class="input" id="book-copies" value="${escapeHtml(state.totalCopies)}" />
          </div>
        </div>
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-book-btn">Cancel</button>
          <button class="btn-primary" id="save-book-btn">${state.editId ? 'Save changes' : 'Add book'}</button>
        </div>
      </div>
    `;
  }

  function wireForm() {
    qs(container, '#book-title').addEventListener('input', (e) => (state.title = e.target.value));
    qs(container, '#book-author').addEventListener('input', (e) => (state.author = e.target.value));
    qs(container, '#book-category').addEventListener('input', (e) => (state.category = e.target.value));
    qs(container, '#book-isbn').addEventListener('input', (e) => (state.isbn = e.target.value));
    qs(container, '#book-copies').addEventListener('input', (e) => (state.totalCopies = e.target.value));
    qs(container, '#cancel-book-btn').addEventListener('click', () => { state.formOpen = false; state.editId = ''; render(); });
    qs(container, '#save-book-btn').addEventListener('click', async () => {
      const copies = Number(state.totalCopies);
      if (!state.title.trim() || !state.author.trim() || !copies || copies < 1) return;
      const book = {
        title: state.title.trim(),
        author: state.author.trim(),
        category: state.category.trim() || undefined,
        isbn: state.isbn.trim() || undefined,
        totalCopies: copies,
      };
      try {
        if (state.editId) {
          if (remote) await updateRemoteBook(state.editId, book);
          else updateBookCatalog(state.editId, book);
        } else if (remote) await createRemoteBook(book);
        else bookRepo.create(book);
        state.error = '';
        state.data = null;
      } catch (error) {
        state.error = error.message;
      }
      state.title = '';
      state.author = '';
      state.category = '';
      state.isbn = '';
      state.totalCopies = '1';
      state.editId = '';
      state.formOpen = false;
      await render();
    });
  }

  render();
}
