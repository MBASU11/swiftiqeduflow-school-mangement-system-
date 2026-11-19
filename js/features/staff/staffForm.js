import { escapeHtml, on, qs } from '../../components/dom.js';
import { teacherRepo, validateStaffMember, STAFF_CATEGORIES } from '../../services/peopleService.js';
import { classesSortedByOrder, subjectRepo } from '../../services/academicService.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { SupabaseRepository } from '../../storage/SupabaseRepository.js';

export async function openStaffForm({ staff, onSaved }) {
  const remote = isSupabaseConfigured();
  const repo = remote ? new SupabaseRepository('teachers') : teacherRepo;
  let classes;
  let subjects;
  try {
    [classes, subjects] = remote
      ? await Promise.all([new SupabaseRepository('classes').getAll(), new SupabaseRepository('subjects').getAll()])
      : [classesSortedByOrder(), subjectRepo.getAll()];
    classes.sort((a, b) => a.order - b.order);
  } catch (error) {
    window.alert(`Could not load staff form data: ${error.message}`);
    return;
  }

  const state = {
    firstName: staff?.firstName ?? '',
    lastName: staff?.lastName ?? '',
    phone: staff?.phone ?? '',
    email: staff?.email ?? '',
    category: staff?.category ?? 'teaching',
    subjectIds: staff?.subjectIds ?? [],
    classIds: staff?.classIds ?? [],
    isActive: staff?.isActive ?? true,
    errors: [],
    saving: false,
  };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
  }

  function errorFor(field) {
    return state.errors.find((e) => e.field === field)?.message;
  }

  function render() {
    overlay.innerHTML = `
      <div class="modal-panel">
        <div class="modal-header">
          <h2 class="text-lg" style="font-weight:600;font-family:var(--font-display);">${staff ? 'Edit staff member' : 'Add staff member'}</h2>
          <button class="btn-ghost" id="modal-close" aria-label="Close">✕</button>
        </div>
        <div class="modal-body space-y-4">
          <div class="grid sm-grid-2 gap-4">
            <div>
              <label class="label">First name</label>
              <input class="input ${errorFor('firstName') ? 'error' : ''}" data-f="firstName" value="${escapeHtml(state.firstName)}" />
              ${errorFor('firstName') ? `<p class="field-error">${escapeHtml(errorFor('firstName'))}</p>` : ''}
            </div>
            <div>
              <label class="label">Last name</label>
              <input class="input ${errorFor('lastName') ? 'error' : ''}" data-f="lastName" value="${escapeHtml(state.lastName)}" />
              ${errorFor('lastName') ? `<p class="field-error">${escapeHtml(errorFor('lastName'))}</p>` : ''}
            </div>
          </div>
          <div class="grid sm-grid-2 gap-4">
            <div>
              <label class="label">Phone</label>
              <input class="input" data-f="phone" value="${escapeHtml(state.phone)}" />
            </div>
            <div>
              <label class="label">Email</label>
              <input class="input" data-f="email" value="${escapeHtml(state.email)}" />
            </div>
          </div>
          <div>
            <label class="label">Category</label>
            <select class="input ${errorFor('category') ? 'error' : ''}" data-f="category">
              ${STAFF_CATEGORIES.map(([v, label]) => `<option value="${v}" ${state.category === v ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
            </select>
          </div>
          ${
            state.category === 'teaching'
              ? `
            <div>
              <label class="label">Subjects taught</label>
              <div class="flex flex-wrap gap-3">
                ${
                  subjects.length === 0
                    ? `<p class="text-sm text-ink-400">No subjects set up yet.</p>`
                    : subjects.map((s) => `<label class="flex items-center gap-1.5 text-sm"><input type="checkbox" data-subject-check="${s.id}" ${state.subjectIds.includes(s.id) ? 'checked' : ''}/> ${escapeHtml(s.name)}</label>`).join('')
                }
              </div>
            </div>
            <div>
              <label class="label">Classes taught</label>
              <div class="flex flex-wrap gap-3">
                ${
                  classes.length === 0
                    ? `<p class="text-sm text-ink-400">No classes set up yet.</p>`
                    : classes.map((c) => `<label class="flex items-center gap-1.5 text-sm"><input type="checkbox" data-class-check="${c.id}" ${state.classIds.includes(c.id) ? 'checked' : ''}/> ${escapeHtml(c.name)}</label>`).join('')
                }
              </div>
            </div>
          `
              : ''
          }
          <label class="flex items-center gap-2">
            <input type="checkbox" data-f="isActive" ${state.isActive ? 'checked' : ''} />
            <span class="text-sm text-ink-700">Currently active</span>
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" id="modal-cancel">Cancel</button>
          <button class="btn-primary" id="modal-save" ${state.saving ? 'disabled' : ''}>${state.saving ? 'Saving…' : 'Save staff member'}</button>
        </div>
      </div>
    `;
    wire();
  }

  function wire() {
    qs(overlay, '#modal-close').addEventListener('click', close);
    qs(overlay, '#modal-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    on(overlay, '[data-f]', 'input', (e) => {
      const field = e.target.getAttribute('data-f');
      state[field] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    });
    on(overlay, '[data-f]', 'change', (e) => {
      const field = e.target.getAttribute('data-f');
      if (e.target.tagName === 'SELECT') {
        state[field] = e.target.value;
        if (field === 'category') render();
      }
    });
    on(overlay, '[data-subject-check]', 'change', (e) => {
      const id = e.target.getAttribute('data-subject-check');
      state.subjectIds = e.target.checked ? [...state.subjectIds, id] : state.subjectIds.filter((s) => s !== id);
    });
    on(overlay, '[data-class-check]', 'change', (e) => {
      const id = e.target.getAttribute('data-class-check');
      state.classIds = e.target.checked ? [...state.classIds, id] : state.classIds.filter((c) => c !== id);
    });

    qs(overlay, '#modal-save').addEventListener('click', save);
  }

  async function save() {
    const errors = validateStaffMember(state);
    if (errors.length > 0) {
      state.errors = errors;
      render();
      return;
    }
    state.saving = true;
    const payload = {
      firstName: state.firstName.trim(),
      lastName: state.lastName.trim(),
      phone: state.phone.trim() || undefined,
      email: state.email.trim() || undefined,
      category: state.category,
      subjectIds: state.category === 'teaching' ? state.subjectIds : [],
      classIds: state.category === 'teaching' ? state.classIds : [],
      isActive: state.isActive,
    };
    try {
      if (staff) {
        await repo.update(staff.id, payload, `edited staff member ${payload.firstName} ${payload.lastName}`);
      } else {
        await repo.create(payload, `added staff member ${payload.firstName} ${payload.lastName}`);
      }
      close();
      await onSaved();
    } catch (error) {
      state.saving = false;
      state.errors = [{ field: 'firstName', message: error.message }];
      render();
    }
  }

  render();
}
