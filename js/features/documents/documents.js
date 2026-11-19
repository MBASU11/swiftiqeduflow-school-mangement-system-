import { escapeHtml, on, qs } from '../../components/dom.js';
import { StorageError } from '../../storage/StorageManager.js';
import {
  CATEGORIES,
  MAX_FILE_BYTES,
  addDocument,
  allDocuments,
  downloadDocument,
  formatBytes,
  readFileAsDataUrl,
  removeDocument,
  updateDocumentMetadata,
  totalBytesStored,
  validateUpload,
} from '../../services/documentService.js';
import { studentRepo, fullName } from '../../services/studentService.js';
import { teacherRepo, teacherFullName } from '../../services/peopleService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { uuid } from '../../lib/uuid.js';
import { SupabaseRepository } from '../../storage/SupabaseRepository.js';
import { downloadRemoteDocument, removeRemoteDocument, updateRemoteDocumentMetadata, uploadRemoteDocument } from '../../services/documentService.js';

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);

function formHtml(students, staff, state) {
  return `
    <div class="card card-p space-y-4">
      <h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editId ? 'Edit document metadata' : 'Upload document'}</h3>
      ${state.editId ? '<p class="text-xs text-ink-500">The stored file will not be changed.</p>' : `<div>
        <label class="label">File</label>
        <input type="file" class="input" id="doc-file" />
        ${state.file ? `<p class="text-xs text-ink-500 mt-1">Selected: ${escapeHtml(state.file.name)} (${escapeHtml(formatBytes(state.file.size))})</p>` : ''}
      </div>`}
      <div class="grid sm-grid-2 gap-4">
        <div>
          <label class="label">Name</label>
          <input class="input" id="doc-name" value="${escapeHtml(state.name)}" placeholder="e.g. Admission policy 2026" />
        </div>
        <div>
          <label class="label">Category</label>
          <select class="input" id="doc-category">
            ${CATEGORIES.map(([v, label]) => `<option value="${v}" ${state.category === v ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
          </select>
        </div>
      </div>
      ${
        state.category === 'students'
          ? `<div>
              <label class="label">Linked student (optional)</label>
              <select class="input" id="doc-student">
                <option value="">Not linked</option>
                ${students.map((s) => `<option value="${s.id}" ${state.studentId === s.id ? 'selected' : ''}>${escapeHtml(fullName(s))}</option>`).join('')}
              </select>
            </div>`
          : state.category === 'staff'
          ? `<div>
              <label class="label">Linked staff member (optional)</label>
              <select class="input" id="doc-staff">
                <option value="">Not linked</option>
                ${staff.map((t) => `<option value="${t.id}" ${state.staffId === t.id ? 'selected' : ''}>${escapeHtml(teacherFullName(t))}</option>`).join('')}
              </select>
            </div>`
          : ''
      }
      <div>
        <label class="label">Description (optional)</label>
        <input class="input" id="doc-description" value="${escapeHtml(state.description)}" />
      </div>
      ${state.error ? `<p class="text-sm text-bad" id="doc-error">${escapeHtml(state.error)}</p>` : ''}
      <div class="flex justify-end gap-3">
        <button class="btn-secondary" id="cancel-doc-btn">Cancel</button>
        <button class="btn-primary" id="save-doc-btn" ${state.saving ? 'disabled' : ''}>${state.saving ? 'Saving…' : state.editId ? 'Save changes' : 'Save document'}</button>
      </div>
    </div>
  `;
}

export function renderDocuments(container, { schoolId } = {}) {
  if (isSupabaseConfigured()) return renderRemoteDocuments(container, schoolId);
  const state = {
    query: '',
    categoryFilter: '',
    formOpen: false,
    editId: '',
    file: null,
    name: '',
    category: 'school',
    description: '',
    studentId: '',
    staffId: '',
    error: '',
    saving: false,
  };

  function render() {
    const all = allDocuments();
    let docs = all;
    if (state.categoryFilter) docs = docs.filter((d) => d.category === state.categoryFilter);
    if (state.query.trim()) {
      const q = state.query.trim().toLowerCase();
      docs = docs.filter((d) => d.name.toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q));
    }
    const students = studentRepo.getAll().filter((s) => s.status === 'active');
    const staff = teacherRepo.getAll();
    const studentById = Object.fromEntries(studentRepo.getAll().map((s) => [s.id, s]));
    const staffById = Object.fromEntries(staff.map((t) => [t.id, t]));

    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center flex-wrap gap-3">
          <h1 class="text-xl" style="font-weight:600;">Documents</h1>
          <button class="btn-primary" id="upload-btn">+ Upload document</button>
        </div>

        <p class="text-xs text-ink-400">
          Files are kept in this browser on this device (${escapeHtml(formatBytes(totalBytesStored()))} stored, up to ${escapeHtml(formatBytes(MAX_FILE_BYTES))} per file).
          Include them in a backup from Settings. Larger files will move to cloud storage later.
        </p>

        ${state.formOpen ? formHtml(students, staff, state) : ''}

        ${
          all.length === 0
            ? `<div class="card">${emptyState({
                iconHtml: icons.folder(40),
                title: 'No documents yet',
                body: 'Upload certificates, policies, admission papers and other school records.',
                actionsHtml: `<button class="btn-primary" id="empty-upload-btn">+ Upload document</button>`,
              })}</div>`
            : `
              <div class="flex flex-wrap gap-3">
                <input class="input" style="max-width:16rem" id="doc-search" placeholder="Search documents" value="${escapeHtml(state.query)}" />
                <select class="input" style="max-width:14rem" id="doc-category-filter">
                  <option value="">All categories</option>
                  ${CATEGORIES.map(([v, label]) => `<option value="${v}" ${state.categoryFilter === v ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
                </select>
              </div>
              ${
                docs.length === 0
                  ? `<p class="text-sm text-ink-400">No documents match this search.</p>`
                  : `<div class="card overflow-x-auto">
                      <table class="data-table">
                        <thead><tr><th>Name</th><th>Category</th><th>Linked to</th><th class="text-right">Size</th><th>Uploaded</th><th></th></tr></thead>
                        <tbody>
                          ${docs
                            .map((d) => {
                              const linked = d.relatedStudentId
                                ? studentById[d.relatedStudentId] && fullName(studentById[d.relatedStudentId])
                                : d.relatedStaffId
                                ? staffById[d.relatedStaffId] && teacherFullName(staffById[d.relatedStaffId])
                                : null;
                              return `<tr>
                                <td style="font-weight:500;">${escapeHtml(d.name)}${d.description ? `<p class="text-xs text-ink-500" style="font-weight:400;">${escapeHtml(d.description)}</p>` : ''}</td>
                                <td class="text-ink-600">${escapeHtml(CATEGORY_LABEL[d.category] ?? d.category)}</td>
                                <td class="text-ink-600">${escapeHtml(linked || '—')}</td>
                                <td class="text-right text-ink-600">${escapeHtml(formatBytes(d.size || 0))}</td>
                                <td class="text-ink-600">${escapeHtml(d.createdAt.slice(0, 10))}</td>
                                <td class="text-right" style="white-space:nowrap;">
                                  <button data-download="${d.id}" class="text-brand-700" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;">Download</button>
                                  <button data-edit="${d.id}" class="text-brand-700" style="background:none;border:none;cursor:pointer;text-decoration:underline;margin-left:.75rem;font-family:inherit;">Edit</button>
                                  <button data-remove="${d.id}" class="text-bad" style="background:none;border:none;cursor:pointer;text-decoration:underline;margin-left:.75rem;font-family:inherit;">Remove</button>
                                </td>
                              </tr>`;
                            })
                            .join('')}
                        </tbody>
                      </table>
                    </div>`
              }
            `
        }
      </div>
    `;

    qs(container, '#upload-btn').addEventListener('click', () => { state.formOpen = true; render(); });
    const emptyBtn = qs(container, '#empty-upload-btn');
    if (emptyBtn) emptyBtn.addEventListener('click', () => { state.formOpen = true; render(); });

    const search = qs(container, '#doc-search');
    if (search) search.addEventListener('input', (e) => { state.query = e.target.value; render(); const again = qs(container, '#doc-search'); again.focus(); again.setSelectionRange(again.value.length, again.value.length); });
    const catFilter = qs(container, '#doc-category-filter');
    if (catFilter) catFilter.addEventListener('change', (e) => { state.categoryFilter = e.target.value; render(); });

    if (state.formOpen) wireForm();

    on(container, '[data-edit]', 'click', (e) => {
      const doc = all.find((item) => item.id === e.currentTarget.getAttribute('data-edit'));
      if (!doc) return;
      Object.assign(state, { editId: doc.id, name: doc.name, category: doc.category, description: doc.description ?? '', studentId: doc.relatedStudentId ?? '', staffId: doc.relatedStaffId ?? '', formOpen: true });
      render();
    });

    on(container, '[data-download]', 'click', (e) => downloadDocument(e.currentTarget.getAttribute('data-download')));
    on(container, '[data-remove]', 'click', (e) => {
      if (!confirm('Remove this document? The stored file will be deleted from this browser.')) return;
      removeDocument(e.currentTarget.getAttribute('data-remove'));
      render();
    });
  }


  function wireForm() {
    // Picking a file must NOT re-render (that would clear the file input);
    // it just fills in the name if the user hasn't typed one yet.
    qs(container, '#doc-file')?.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      state.file = file || null;
      state.error = '';
      if (file && !state.name.trim()) {
        state.name = file.name.replace(/\.[^.]+$/, '');
        qs(container, '#doc-name').value = state.name;
      }
    });
    qs(container, '#doc-name').addEventListener('input', (e) => (state.name = e.target.value));
    qs(container, '#doc-category').addEventListener('change', (e) => {
      state.category = e.target.value;
      state.studentId = '';
      state.staffId = '';
      render();
    });
    const studentSelect = qs(container, '#doc-student');
    if (studentSelect) studentSelect.addEventListener('change', (e) => (state.studentId = e.target.value));
    const staffSelect = qs(container, '#doc-staff');
    if (staffSelect) staffSelect.addEventListener('change', (e) => (state.staffId = e.target.value));
    qs(container, '#doc-description').addEventListener('input', (e) => (state.description = e.target.value));
    qs(container, '#cancel-doc-btn').addEventListener('click', () => {
      state.formOpen = false;
      state.editId = '';
      state.file = null;
      state.error = '';
      render();
    });
    qs(container, '#save-doc-btn').addEventListener('click', save);
  }

  async function save() {
    state.error = '';
    if (state.editId && !state.name.trim()) {
      state.error = 'Give the document a name so it is easy to find later.';
      render();
      return;
    }
    const fileProblem = state.editId ? null : validateUpload(state.file);
    if (fileProblem) {
      state.error = fileProblem;
      render();
      return;
    }
    if (!state.name.trim()) {
      state.error = 'Give the document a name so it is easy to find later.';
      render();
      return;
    }
    state.saving = true;
    render();
    try {
      const metadata = {
        name: state.name.trim(),
        category: state.category,
        description: state.description.trim() || undefined,
        relatedStudentId: state.studentId || undefined,
        relatedStaffId: state.staffId || undefined,
      };
      if (state.editId) updateDocumentMetadata(state.editId, metadata);
      else {
        const dataUrl = await readFileAsDataUrl(state.file);
        addDocument(
        {
          ...metadata,
          fileName: state.file.name,
          mimeType: state.file.type || undefined,
          size: state.file.size,
        },
        dataUrl
      );
      }
      state.formOpen = false;
      state.editId = '';
      state.file = null;
      state.name = '';
      state.description = '';
      state.studentId = '';
      state.staffId = '';
    } catch (err) {
      state.error =
        err instanceof StorageError
          ? err.message
          : "We couldn't save this document. Please check the file and try again.";
    }
    state.saving = false;
    render();
  }

  render();
}

function renderRemoteDocuments(container, schoolId) {
  const state = {
    data: null,
    query: '',
    categoryFilter: '',
    formOpen: false,
    editId: '',
    file: null,
    name: '',
    category: 'school',
    description: '',
    studentId: '',
    staffId: '',
    error: '',
    saving: false,
  };

  async function load() {
    const collections = ['documents', 'students', 'teachers'];
    const results = await Promise.all(collections.map((collection) => new SupabaseRepository(collection).getAll()));
    state.data = { documents: results[0].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), students: results[1], staff: results[2] };
  }

  async function render() {
    try {
      if (!state.data) await load();
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="remote-doc-retry">Retry</button></div>`;
      qs(container, '#remote-doc-retry').addEventListener('click', () => { state.data = null; state.error = ''; render(); });
      return;
    }
    const all = state.data.documents;
    let docs = all;
    if (state.categoryFilter) docs = docs.filter((document) => document.category === state.categoryFilter);
    if (state.query.trim()) {
      const query = state.query.trim().toLowerCase();
      docs = docs.filter((document) => document.name.toLowerCase().includes(query) || (document.description || '').toLowerCase().includes(query));
    }
    const students = state.data.students.filter((student) => student.status === 'active');
    const staff = state.data.staff;
    const studentById = Object.fromEntries(state.data.students.map((student) => [student.id, student]));
    const staffById = Object.fromEntries(staff.map((teacher) => [teacher.id, teacher]));
    const totalBytes = all.reduce((sum, document) => sum + (document.size || 0), 0);
    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center flex-wrap gap-3"><h1 class="text-xl" style="font-weight:600;">Documents</h1><button class="btn-primary" id="upload-btn">+ Upload document</button></div>
        <p class="text-xs text-ink-400">Files are stored privately for this school (${escapeHtml(formatBytes(totalBytes))} stored, up to 20 MB per file).</p>
        ${state.formOpen ? formHtml(students, staff, state) : ''}
        ${all.length === 0 ? `<div class="card">${emptyState({ iconHtml: icons.folder(40), title: 'No documents yet', body: 'Upload certificates, policies, admission papers and other school records.', actionsHtml: `<button class="btn-primary" id="empty-upload-btn">+ Upload document</button>` })}</div>` : `<div class="flex flex-wrap gap-3"><input class="input" style="max-width:16rem" id="doc-search" placeholder="Search documents" value="${escapeHtml(state.query)}" /><select class="input" style="max-width:14rem" id="doc-category-filter"><option value="">All categories</option>${CATEGORIES.map(([value, label]) => `<option value="${value}" ${state.categoryFilter === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></div>${docs.length === 0 ? '<p class="text-sm text-ink-400">No documents match this search.</p>' : `<div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Name</th><th>Category</th><th>Linked to</th><th class="text-right">Size</th><th>Uploaded</th><th></th></tr></thead><tbody>${docs.map((document) => {
          const linked = document.relatedStudentId ? studentById[document.relatedStudentId] && fullName(studentById[document.relatedStudentId]) : document.relatedStaffId ? staffById[document.relatedStaffId] && teacherFullName(staffById[document.relatedStaffId]) : null;
          return `<tr><td style="font-weight:500;">${escapeHtml(document.name)}${document.description ? `<p class="text-xs text-ink-500" style="font-weight:400;">${escapeHtml(document.description)}</p>` : ''}</td><td class="text-ink-600">${escapeHtml(CATEGORY_LABEL[document.category] ?? document.category)}</td><td class="text-ink-600">${escapeHtml(linked || '—')}</td><td class="text-right text-ink-600">${escapeHtml(formatBytes(document.size || 0))}</td><td class="text-ink-600">${escapeHtml(document.createdAt.slice(0, 10))}</td><td class="text-right" style="white-space:nowrap;"><button data-download="${document.id}" class="text-brand-700" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;">Download</button><button data-edit="${document.id}" class="text-brand-700" style="background:none;border:none;cursor:pointer;text-decoration:underline;margin-left:.75rem;font-family:inherit;">Edit</button><button data-remove="${document.id}" class="text-bad" style="background:none;border:none;cursor:pointer;text-decoration:underline;margin-left:.75rem;font-family:inherit;">Remove</button></td></tr>`;
        }).join('')}</tbody></table></div>`}`}
      </div>`;

    qs(container, '#upload-btn').addEventListener('click', () => { state.formOpen = true; render(); });
    const emptyUpload = qs(container, '#empty-upload-btn');
    if (emptyUpload) emptyUpload.addEventListener('click', () => { state.formOpen = true; render(); });
    const search = qs(container, '#doc-search');
    if (search) search.addEventListener('input', async (event) => { const cursor = event.target.selectionStart; state.query = event.target.value; await render(); const current = qs(container, '#doc-search'); current.focus(); current.setSelectionRange(cursor, cursor); });
    const categoryFilter = qs(container, '#doc-category-filter');
    if (categoryFilter) categoryFilter.addEventListener('change', (event) => { state.categoryFilter = event.target.value; render(); });
    if (state.formOpen) wireForm(students, staff);
    on(container, '[data-edit]', 'click', (event) => {
      const doc = all.find((item) => item.id === event.currentTarget.getAttribute('data-edit'));
      if (!doc) return;
      Object.assign(state, { editId: doc.id, name: doc.name, category: doc.category, description: doc.description ?? '', studentId: doc.relatedStudentId ?? '', staffId: doc.relatedStaffId ?? '', formOpen: true });
      render();
    });
    on(container, '[data-download]', 'click', async (event) => {
      try { await downloadRemoteDocument(all.find((document) => document.id === event.currentTarget.getAttribute('data-download'))); }
      catch (error) { state.error = error.message; await render(); }
    });
    on(container, '[data-remove]', 'click', async (event) => {
      if (!confirm('Remove this document and its private file?')) return;
      try {
        const document = all.find((item) => item.id === event.currentTarget.getAttribute('data-remove'));
        await removeRemoteDocument(document);
        state.data = null;
        state.error = '';
      } catch (error) { state.error = error.message; }
      await render();
    });
  }

  function wireForm(students, staff) {
    qs(container, '#doc-file')?.addEventListener('change', (event) => {
      state.file = event.target.files?.[0] ?? null;
      state.error = '';
      if (state.file && !state.name.trim()) {
        state.name = state.file.name.replace(/\.[^.]+$/, '');
        qs(container, '#doc-name').value = state.name;
      }
    });
    qs(container, '#doc-name').addEventListener('input', (event) => { state.name = event.target.value; });
    qs(container, '#doc-category').addEventListener('change', (event) => { state.category = event.target.value; state.studentId = ''; state.staffId = ''; render(); });
    const studentSelect = qs(container, '#doc-student');
    if (studentSelect) studentSelect.addEventListener('change', (event) => { state.studentId = event.target.value; });
    const staffSelect = qs(container, '#doc-staff');
    if (staffSelect) staffSelect.addEventListener('change', (event) => { state.staffId = event.target.value; });
    qs(container, '#doc-description').addEventListener('input', (event) => { state.description = event.target.value; });
    qs(container, '#cancel-doc-btn').addEventListener('click', () => { state.formOpen = false; state.editId = ''; state.file = null; state.error = ''; render(); });
    qs(container, '#save-doc-btn').addEventListener('click', save);
  }

  async function save() {
    if (!state.name.trim()) { state.error = 'Give the document a name so it is easy to find later.'; await render(); return; }
    if (!state.editId && !state.file) { state.error = 'Choose a file to upload.'; await render(); return; }
    if (!state.editId && state.file.size > 20 * 1024 * 1024) { state.error = 'Files up to 20 MB are supported in cloud storage.'; await render(); return; }
    state.saving = true;
    state.error = '';
    await render();
    try {
      const metadata = {
        name: state.name.trim(),
        category: state.category,
        description: state.description.trim() || undefined,
        relatedStudentId: state.studentId || undefined,
        relatedStaffId: state.staffId || undefined,
      };
      if (state.editId) await updateRemoteDocumentMetadata(state.editId, metadata);
      else await uploadRemoteDocument({
        schoolId,
        file: state.file,
        metadata: {
          id: uuid(),
          ...metadata,
          fileName: state.file.name,
          mimeType: state.file.type || undefined,
          size: state.file.size,
        },
      });
      state.formOpen = false;
      state.editId = '';
      state.file = null;
      state.name = '';
      state.description = '';
      state.studentId = '';
      state.staffId = '';
      state.data = null;
    } catch (error) {
      state.error = error.message;
    }
    state.saving = false;
    await render();
  }

  render();
}
