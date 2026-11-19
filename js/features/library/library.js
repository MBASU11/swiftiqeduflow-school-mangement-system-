import { qs } from '../../components/dom.js';
import { renderBooksManager } from './booksManager.js';
import { renderBorrowing } from './borrowing.js';

export function renderLibrary(container) {
  let tab = 'books';

  function render() {
    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center flex-wrap gap-3">
          <h1 class="text-xl" style="font-weight:600;">Library</h1>
          <div class="pill-group">
            <button class="pill ${tab === 'books' ? 'active' : ''}" id="tab-books">Books</button>
            <button class="pill ${tab === 'borrowing' ? 'active' : ''}" id="tab-borrowing">Borrowing</button>
          </div>
        </div>
        <div id="library-body"></div>
      </div>
    `;

    qs(container, '#tab-books').addEventListener('click', () => { tab = 'books'; render(); });
    qs(container, '#tab-borrowing').addEventListener('click', () => { tab = 'borrowing'; render(); });

    const body = qs(container, '#library-body');
    if (tab === 'books') renderBooksManager(body);
    else renderBorrowing(body);
  }

  render();
}
