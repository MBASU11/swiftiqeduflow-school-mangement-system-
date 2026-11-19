import { escapeHtml, on, qs } from '../../components/dom.js';
import { teacherRepo, teacherFullName, STAFF_CATEGORIES } from '../../services/peopleService.js';
import { classesSortedByOrder, subjectRepo } from '../../services/academicService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { openStaffForm } from './staffForm.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { SupabaseRepository } from '../../storage/SupabaseRepository.js';
import { StorageManager } from '../../storage/StorageManager.js';
import { getSupabaseClient } from '../../services/supabaseClient.js';

function referencesStaff(record, id) {
  if (!record || typeof record !== 'object') return false;
  return Object.entries(record).some(([key, value]) => {
    if (/(?:teacher|staff)(?:Id|Ids|_id|_ids)$/i.test(key)) return Array.isArray(value) ? value.includes(id) : value === id;
    return value && typeof value === 'object' && referencesStaff(value, id);
  });
}

function hasLocalStaffReferences(id) {
  const data = JSON.parse(StorageManager.exportAll()).data;
  return Object.entries(data).some(([collection, envelope]) =>
    collection !== 'teachers' && Object.values(envelope.records).some((record) => referencesStaff(record, id))
  );
}

async function hasRemoteStaffReferences(id) {
  const client = await getSupabaseClient();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from('school_records')
      .select('collection,payload')
      .order('collection')
      .order('record_id')
      .range(offset, offset + 999);
    if (error) throw error;
    if (data.some((row) => row.collection !== 'teachers' && referencesStaff(row.payload, id))) return true;
    if (data.length < 1000) return false;
  }
}

export function renderStaffList(container) {
  const remote = isSupabaseConfigured();
  const staffRepo = remote ? new SupabaseRepository('teachers') : teacherRepo;
  const state = { query: '', categoryFilter: '', statusFilter: 'active', data: null, error: '' };

  async function openForm(staff) {
    await openStaffForm({
      staff,
      onSaved: async () => {
        if (remote) state.data = null;
        await render();
      },
    });
  }

  async function render() {
    let allStaff;
    let classes;
    let subjects;
    try {
      if (remote) {
        if (!state.data) {
          const [staff, schoolClasses, schoolSubjects] = await Promise.all([
            staffRepo.getAll(),
            new SupabaseRepository('classes').getAll(),
            new SupabaseRepository('subjects').getAll(),
          ]);
          state.data = { staff, classes: schoolClasses, subjects: schoolSubjects };
        }
        ({ staff: allStaff, classes, subjects } = state.data);
        classes.sort((a, b) => a.order - b.order);
      } else {
        allStaff = teacherRepo.getAll();
        classes = classesSortedByOrder();
        subjects = subjectRepo.getAll();
      }
      state.error = '';
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="staff-retry">Retry</button></div>`;
      qs(container, '#staff-retry').addEventListener('click', () => { state.data = null; render(); });
      return;
    }
    const classById = Object.fromEntries(classes.map((c) => [c.id, c]));
    const subjectById = Object.fromEntries(subjects.map((s) => [s.id, s]));
    const categoryLabel = Object.fromEntries(STAFF_CATEGORIES);

    if (allStaff.length === 0) {
      container.innerHTML = `
        <div class="card">
          ${emptyState({
            iconHtml: icons.briefcase(40),
            title: 'No staff yet',
            body: 'Add teachers and other staff members to get started.',
            actionsHtml: `<button class="btn-primary" id="add-staff-empty">+ Add Staff Member</button>`,
          })}
        </div>
      `;
      qs(container, '#add-staff-empty').addEventListener('click', () => openForm());
      return;
    }

    let list = allStaff.filter((staff) => state.statusFilter === 'all' || (state.statusFilter === 'inactive' ? !staff.isActive : staff.isActive));
    if (state.categoryFilter) list = list.filter((s) => s.category === state.categoryFilter);
    if (state.query.trim()) {
      const q = state.query.trim().toLowerCase();
      list = list.filter((s) => teacherFullName(s).toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => teacherFullName(a).localeCompare(teacherFullName(b)));

    const rowHtml = (s) => `
      <tr>
        <td style="font-weight:500;color:var(--ink-900);">${escapeHtml(teacherFullName(s))}</td>
        <td class="text-ink-600">${escapeHtml(categoryLabel[s.category] ?? s.category)}</td>
        <td class="text-ink-600">${escapeHtml(s.phone || s.email || '—')}</td>
        <td class="text-ink-600">${
          s.category === 'teaching'
            ? (s.subjectIds || []).map((id) => subjectById[id]?.name).filter(Boolean).join(', ') || '—'
            : '—'
        }</td>
        <td><span class="badge ${s.isActive ? 'badge-good' : 'badge-gold'}">${s.isActive ? 'Active' : 'Inactive'}</span></td>
        <td class="text-right" style="white-space:nowrap;">
          <button data-edit="${s.id}" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;" class="text-ink-600">Edit</button>
          <button data-toggle-active="${s.id}" style="background:none;border:none;cursor:pointer;text-decoration:underline;margin-left:0.75rem;font-family:inherit;" class="${s.isActive ? 'text-bad' : 'text-good'}">${s.isActive ? 'Deactivate' : 'Reactivate'}</button>
          ${s.isActive ? '' : `<button data-delete-staff="${escapeHtml(s.id)}" class="text-bad" style="background:none;border:none;cursor:pointer;text-decoration:underline;margin-left:0.75rem;font-family:inherit;">Delete</button>`}
        </td>
      </tr>
    `;

    const cardHtml = (s) => `
      <div class="card card-p">
        <div class="flex justify-between items-center">
          <div>
            <p style="font-weight:500;">${escapeHtml(teacherFullName(s))}</p>
            <p class="text-xs text-ink-500 mt-1">${escapeHtml(categoryLabel[s.category] ?? s.category)} · ${escapeHtml(s.phone || s.email || 'No contact')}</p>
          </div>
          <span class="badge ${s.isActive ? 'badge-good' : 'badge-gold'}">${s.isActive ? 'Active' : 'Inactive'}</span>
        </div>
        <div class="flex gap-4 text-sm mt-3">
          <button data-edit="${s.id}" class="text-ink-600" style="background:none;border:none;cursor:pointer;font-family:inherit;">Edit</button>
          <button data-toggle-active="${s.id}" class="${s.isActive ? 'text-bad' : 'text-good'}" style="background:none;border:none;cursor:pointer;font-family:inherit;">${s.isActive ? 'Deactivate' : 'Reactivate'}</button>
          ${s.isActive ? '' : `<button data-delete-staff="${escapeHtml(s.id)}" class="text-bad" style="background:none;border:none;cursor:pointer;font-family:inherit;">Delete</button>`}
        </div>
      </div>
    `;

    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center flex-wrap gap-3">
          <h1 class="text-xl" style="font-weight:600;">Staff</h1>
          <button class="btn-primary" id="add-staff-btn">+ Add Staff Member</button>
        </div>

        <div class="flex flex-wrap gap-3">
          <input class="input" style="max-width:16rem" id="staff-search" placeholder="Search by name" value="${escapeHtml(state.query)}" />
          <select class="input" style="max-width:12rem" id="category-filter">
            <option value="">All categories</option>
            ${STAFF_CATEGORIES.map(([v, label]) => `<option value="${v}" ${state.categoryFilter === v ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
          </select>
          <select class="input" style="max-width:12rem" id="staff-status-filter" aria-label="Staff status">
            <option value="active" ${state.statusFilter === 'active' ? 'selected' : ''}>Active staff</option>
            <option value="inactive" ${state.statusFilter === 'inactive' ? 'selected' : ''}>Inactive staff</option>
            <option value="all" ${state.statusFilter === 'all' ? 'selected' : ''}>All staff</option>
          </select>
        </div>

        <div class="card overflow-x-auto" id="desktop-table" style="display:none;">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Category</th><th>Contact</th><th>Subjects</th><th>Status</th><th class="text-right">Actions</th></tr></thead>
            <tbody>${list.map(rowHtml).join('')}</tbody>
          </table>
        </div>
        <div class="space-y-3" id="mobile-cards">${list.map(cardHtml).join('')}</div>
        ${list.length === 0 ? `<p class="text-sm text-ink-400">No staff match this search.</p>` : ''}
      </div>
    `;

    const desktopTable = qs(container, '#desktop-table');
    const mobileCards = qs(container, '#mobile-cards');
    function applyResponsive() {
      const isDesktop = window.innerWidth >= 768;
      desktopTable.style.display = isDesktop ? 'block' : 'none';
      mobileCards.style.display = isDesktop ? 'none' : 'block';
    }
    applyResponsive();
    window.addEventListener('resize', applyResponsive);

    qs(container, '#add-staff-btn').addEventListener('click', () => openForm());
    qs(container, '#staff-search').addEventListener('input', (e) => { state.query = e.target.value; render(); });
    qs(container, '#category-filter').addEventListener('change', (e) => { state.categoryFilter = e.target.value; render(); });
    qs(container, '#staff-status-filter').addEventListener('change', (e) => { state.statusFilter = e.target.value; render(); });

    on(container, '[data-edit]', 'click', async (e) => {
      const staff = await staffRepo.getById(e.currentTarget.getAttribute('data-edit'));
      if (staff) openForm(staff);
    });
    on(container, '[data-toggle-active]', 'click', async (e) => {
      const id = e.currentTarget.getAttribute('data-toggle-active');
      const staff = allStaff.find((person) => person.id === id);
      if (!staff) return;
      try {
        await staffRepo.update(id, { isActive: !staff.isActive }, staff.isActive ? 'deactivated staff member' : 'reactivated staff member');
        state.data = null;
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
    on(container, '[data-delete-staff]', 'click', async (e) => {
      const id = e.currentTarget.getAttribute('data-delete-staff');
      const staff = await staffRepo.getById(id);
      if (!staff || staff.isActive) return;
      if (!confirm('Permanently delete this inactive staff record? Linked records block deletion, and authentication accounts are never deleted.')) return;
      try {
        const hasReferences = remote ? await hasRemoteStaffReferences(id) : hasLocalStaffReferences(id);
        if (hasReferences) {
          throw new Error('This staff member is referenced by other school records. They were not deleted; keep them inactive so those records remain accessible.');
        }
        await staffRepo.remove(id);
        state.data = null;
        state.error = '';
      } catch (error) { state.error = error.message; }
      await render();
    });
  }

  render();
}
