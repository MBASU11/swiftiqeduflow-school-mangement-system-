import { scopedStudents } from '../../services/classScope.js';
import { escapeHtml, on, qs } from '../../components/dom.js';
import { studentRepo, fullName } from '../../services/studentService.js';
import { classesSortedByOrder, streamRepo } from '../../services/academicService.js';
import { parentRepo, parentFullName } from '../../services/peopleService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { openStudentForm } from './studentForm.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { SupabaseRepository } from '../../storage/SupabaseRepository.js';
import { supabaseStudentRepo } from '../../services/studentService.js';
import { StorageManager } from '../../storage/StorageManager.js';
import { getSupabaseClient } from '../../services/supabaseClient.js';

const PAGE_SIZE = 10;

function referencesStudent(record, id) {
  if (!record || typeof record !== 'object') return false;
  return Object.entries(record).some(([key, value]) => {
    if (/(?:studentId|studentIds|student_id|student_ids)$/i.test(key)) return Array.isArray(value) ? value.includes(id) : value === id;
    return value && typeof value === 'object' && referencesStudent(value, id);
  });
}

function hasLocalStudentReferences(id) {
  const data = JSON.parse(StorageManager.exportAll()).data;
  return Object.entries(data).some(([collection, envelope]) =>
    collection !== 'students' && Object.values(envelope.records).some((record) => referencesStudent(record, id))
  );
}

async function hasRemoteStudentReferences(id) {
  const client = await getSupabaseClient();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from('school_records')
      .select('collection,payload')
      .order('collection')
      .order('record_id')
      .range(offset, offset + 999);
    if (error) throw error;
    if (data.some((row) => row.collection !== 'students' && referencesStudent(row.payload, id))) return true;
    if (data.length < 1000) return false;
  }
}

export function renderStudentsList(container, params) {
  const remote = isSupabaseConfigured();
  const state = { query: '', classFilter: '', statusFilter: 'active', sortKey: 'name', page: 1, data: null, error: '' };
  let newFormHandled = false;

  async function openForm(student) {
    await openStudentForm({
      student,
      onSaved: async () => {
        if (remote) state.data = null;
        await render();
      },
    });
  }

  async function render() {
    let allStudents;
    let classes;
    let streams;
    let parents;
    try {
      if (remote) {
        if (!state.data) {
          const [students, schoolClasses, schoolStreams, schoolParents] = await Promise.all([
            supabaseStudentRepo.getAll(),
            new SupabaseRepository('classes').getAll(),
            new SupabaseRepository('streams').getAll(),
            new SupabaseRepository('parents').getAll(),
          ]);
          state.data = { students, classes: schoolClasses, streams: schoolStreams, parents: schoolParents };
        }
        ({ students: allStudents, classes, streams, parents } = state.data);
        allStudents = scopedStudents(allStudents);
        classes.sort((a, b) => a.order - b.order);
      } else {
        allStudents = scopedStudents(studentRepo.getAll());
        classes = classesSortedByOrder();
        streams = streamRepo.getAll();
        parents = parentRepo.getAll();
      }
      state.error = '';
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error || error.message)}</span><button class="btn-secondary btn-sm" id="students-retry">Retry</button></div>`;
      qs(container, '#students-retry').addEventListener('click', () => { state.data = null; render(); });
      return;
    }
    const classById = Object.fromEntries(classes.map((c) => [c.id, c]));
    const streamById = Object.fromEntries(streams.map((s) => [s.id, s]));
    const parentById = Object.fromEntries(parents.map((p) => [p.id, p]));

    if (allStudents.length === 0) {
      container.innerHTML = `
        <div class="card">
          ${emptyState({
            iconHtml: icons.users(40),
            title: 'No students yet',
            body: 'Add your first student or import students from Excel.',
            actionsHtml: `<button class="btn-primary" id="add-student-empty">+ Add Student</button><button class="btn-secondary" disabled title="Coming in a later phase">Import Students</button>`,
          })}
        </div>
      `;
      qs(container, '#add-student-empty').addEventListener('click', () => openForm());
      if (params?.new === '1' && !newFormHandled) {
        newFormHandled = true;
        openForm();
      }
      return;
    }

    let list = allStudents.filter((student) => {
      if (state.statusFilter === 'all') return true;
      if (state.statusFilter === 'archived') return student.status === 'archived';
      if (state.statusFilter === 'inactive') return student.status !== 'active' && student.status !== 'archived';
      return student.status === 'active';
    });
    if (state.classFilter) list = list.filter((s) => s.classId === state.classFilter);
    if (state.query.trim()) {
      const q = state.query.trim().toLowerCase();
      list = list.filter((s) => fullName(s).toLowerCase().includes(q) || s.admissionNumber.toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => {
      if (state.sortKey === 'name') return fullName(a).localeCompare(fullName(b));
      if (state.sortKey === 'admission') return a.admissionNumber.localeCompare(b.admissionNumber);
      return (classById[a.classId ?? '']?.order ?? 0) - (classById[b.classId ?? '']?.order ?? 0);
    });

    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages);
    const pageItems = list.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

    const rowHtml = (s) => `
      <tr>
        <td style="font-weight:500;color:var(--ink-900);">${escapeHtml(fullName(s))}</td>
        <td class="text-ink-600">${escapeHtml(s.admissionNumber)}</td>
        <td class="text-ink-600">${escapeHtml(classById[s.classId ?? '']?.name ?? '—')}${s.streamId ? ` · ${escapeHtml(streamById[s.streamId]?.name ?? '')}` : ''}</td>
        <td class="text-ink-600">${escapeHtml(s.parentIds.map((id) => parentById[id]).filter(Boolean).map((p) => parentFullName(p)).join(', ') || '—')}</td>
        <td><span class="badge badge-good capitalize">${escapeHtml(s.status)}</span></td>
        <td class="text-right" style="white-space:nowrap;">
          <button class="text-brand-700" data-view="${s.id}" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;">View</button>
          <button class="text-ink-600" data-edit="${s.id}" style="background:none;border:none;cursor:pointer;text-decoration:underline;margin-left:0.75rem;font-family:inherit;">Edit</button>
          ${s.status === 'archived' ? `<button class="text-good" data-restore="${escapeHtml(s.id)}" style="background:none;border:none;cursor:pointer;text-decoration:underline;margin-left:0.75rem;font-family:inherit;">Restore</button><button class="text-bad" data-delete-student="${escapeHtml(s.id)}" style="background:none;border:none;cursor:pointer;text-decoration:underline;margin-left:0.75rem;font-family:inherit;">Delete</button>` : `<button class="text-bad" data-archive="${escapeHtml(s.id)}" style="background:none;border:none;cursor:pointer;text-decoration:underline;margin-left:0.75rem;font-family:inherit;">Archive</button>`}
        </td>
      </tr>
    `;

    const cardHtml = (s) => `
      <div class="card card-p">
        <div class="flex justify-between items-center">
          <div>
            <p style="font-weight:500;">${escapeHtml(fullName(s))}</p>
            <p class="text-xs text-ink-500 mt-1">${escapeHtml(s.admissionNumber)} · ${escapeHtml(classById[s.classId ?? '']?.name ?? '—')}</p>
          </div>
          <span class="badge badge-good capitalize">${escapeHtml(s.status)}</span>
        </div>
        <div class="flex gap-4 text-sm mt-3">
          <button data-view="${s.id}" class="text-brand-700" style="background:none;border:none;cursor:pointer;font-family:inherit;">View</button>
          <button data-edit="${s.id}" class="text-ink-600" style="background:none;border:none;cursor:pointer;font-family:inherit;">Edit</button>
          ${s.status === 'archived' ? `<button data-restore="${escapeHtml(s.id)}" class="text-good" style="background:none;border:none;cursor:pointer;font-family:inherit;">Restore</button><button data-delete-student="${escapeHtml(s.id)}" class="text-bad" style="background:none;border:none;cursor:pointer;font-family:inherit;">Delete</button>` : `<button data-archive="${escapeHtml(s.id)}" class="text-bad" style="background:none;border:none;cursor:pointer;font-family:inherit;">Archive</button>`}
        </div>
      </div>
    `;

    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center flex-wrap gap-3">
          <h1 class="text-xl" style="font-weight:600;">Students</h1>
          <button class="btn-primary" id="add-student-btn">+ Add Student</button>
        </div>

        <div class="flex flex-wrap gap-3">
          <input class="input" style="max-width:18rem" id="student-search" placeholder="Search by name or admission no." value="${escapeHtml(state.query)}" />
          <select class="input" style="max-width:11rem" id="class-filter">
            <option value="">All classes</option>
            ${classes.map((c) => `<option value="${c.id}" ${state.classFilter === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
          <select class="input" style="max-width:12rem" id="status-filter" aria-label="Student status">
            <option value="active" ${state.statusFilter === 'active' ? 'selected' : ''}>Active students</option>
            <option value="inactive" ${state.statusFilter === 'inactive' ? 'selected' : ''}>Inactive students</option>
            <option value="archived" ${state.statusFilter === 'archived' ? 'selected' : ''}>Archived students</option>
            <option value="all" ${state.statusFilter === 'all' ? 'selected' : ''}>All statuses</option>
          </select>
          <select class="input" style="max-width:10rem" id="sort-key">
            <option value="name" ${state.sortKey === 'name' ? 'selected' : ''}>Sort: Name</option>
            <option value="admission" ${state.sortKey === 'admission' ? 'selected' : ''}>Sort: Admission no.</option>
            <option value="class" ${state.sortKey === 'class' ? 'selected' : ''}>Sort: Class</option>
          </select>
        </div>

        <div class="card overflow-x-auto" id="desktop-table" style="display:none;">
          <table class="data-table">
            <thead><tr><th>Student</th><th>Admission #</th><th>Class</th><th>Parent</th><th>Status</th><th class="text-right">Actions</th></tr></thead>
            <tbody>${pageItems.map(rowHtml).join('')}</tbody>
          </table>
        </div>
        <div class="space-y-3" id="mobile-cards">${pageItems.map(cardHtml).join('')}</div>

        ${
          totalPages > 1
            ? `<div class="flex justify-between items-center text-sm text-ink-500">
                <span>Page ${state.page} of ${totalPages} · ${list.length} students</span>
                <div class="flex gap-2">
                  <button class="btn-secondary btn-sm" id="prev-page" ${state.page === 1 ? 'disabled' : ''}>Previous</button>
                  <button class="btn-secondary btn-sm" id="next-page" ${state.page === totalPages ? 'disabled' : ''}>Next</button>
                </div>
              </div>`
            : ''
        }
      </div>
    `;

    // Toggle table vs cards responsively (CSS-media-query alternative done in JS for simplicity)
    const desktopTable = qs(container, '#desktop-table');
    const mobileCards = qs(container, '#mobile-cards');
    function applyResponsive() {
      const isDesktop = window.innerWidth >= 768;
      desktopTable.style.display = isDesktop ? 'block' : 'none';
      mobileCards.style.display = isDesktop ? 'none' : 'block';
    }
    applyResponsive();
    window.addEventListener('resize', applyResponsive);

    qs(container, '#add-student-btn').addEventListener('click', () => openForm());
    qs(container, '#student-search').addEventListener('input', (e) => {
      state.query = e.target.value;
      state.page = 1;
      render();
    });
    qs(container, '#class-filter').addEventListener('change', (e) => {
      state.classFilter = e.target.value;
      state.page = 1;
      render();
    });
    qs(container, '#status-filter').addEventListener('change', (e) => {
      state.statusFilter = e.target.value;
      state.page = 1;
      render();
    });
    qs(container, '#sort-key').addEventListener('change', (e) => {
      state.sortKey = e.target.value;
      render();
    });
    const prevBtn = qs(container, '#prev-page');
    if (prevBtn) prevBtn.addEventListener('click', () => { state.page -= 1; render(); });
    const nextBtn = qs(container, '#next-page');
    if (nextBtn) nextBtn.addEventListener('click', () => { state.page += 1; render(); });

    on(container, '[data-view]', 'click', (e) => {
      window.location.hash = `/students/${e.currentTarget.getAttribute('data-view')}`;
    });
    on(container, '[data-edit]', 'click', async (e) => {
      const id = e.currentTarget.getAttribute('data-edit');
      const student = remote ? await supabaseStudentRepo.getById(id) : studentRepo.getById(id);
      if (student) openForm(student);
    });
    on(container, '[data-archive]', 'click', async (e) => {
      const id = e.currentTarget.getAttribute('data-archive');
      if (!confirm('Archive this student? They will be hidden from active lists but not deleted.')) return;
      try {
        await (remote ? supabaseStudentRepo : studentRepo).update(id, { status: 'archived' }, 'archived student');
        state.error = '';
        if (remote) state.data = null;
        await render();
      } catch (error) {
        state.error = error.message;
        await render();
      }
    });
    on(container, '[data-restore]', 'click', async (e) => {
      const id = e.currentTarget.getAttribute('data-restore');
      if (!confirm('Restore this student to active lists?')) return;
      try {
        await (remote ? supabaseStudentRepo : studentRepo).update(id, { status: 'active' }, 'restored student');
        state.error = '';
        if (remote) state.data = null;
      } catch (error) { state.error = error.message; }
      await render();
    });
    on(container, '[data-delete-student]', 'click', async (e) => {
      const id = e.currentTarget.getAttribute('data-delete-student');
      if (!confirm('Permanently delete this archived student record? Linked records block deletion. Authentication accounts are never deleted.')) return;
      try {
        const student = remote ? await supabaseStudentRepo.getById(id) : studentRepo.getById(id);
        if (!student || student.status !== 'archived') throw new Error('Only archived students can be permanently deleted.');
        const hasReferences = remote ? await hasRemoteStudentReferences(id) : hasLocalStudentReferences(id);
        if (hasReferences) {
          throw new Error('This student has linked school records. They were not deleted; keep the student archived so those records remain accessible.');
        }
        if (!remote) {
          const accounts = StorageManager.getGlobal('accounts') ?? [];
          if (accounts.some((account) => account.role === 'student' && account.linkedId === id)) {
            throw new Error('This student has a linked login. It was not deleted; remove or relink the login separately, then retry.');
          }
          studentRepo.remove(id, 'permanently deleted archived student');
        } else {
          await supabaseStudentRepo.remove(id);
          state.data = null;
        }
        state.error = '';
      } catch (error) { state.error = error.message; }
      await render();
    });

    if (params?.new === '1' && !newFormHandled) {
      newFormHandled = true;
      openForm();
    }
  }

  render();
}
