import { escapeHtml, on, qs } from '../../components/dom.js';
import { studentRepo, validateStudent } from '../../services/studentService.js';
import { classesSortedByOrder, getStreamsForClass } from '../../services/academicService.js';
import { parentRepo, parentFullName } from '../../services/peopleService.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { SupabaseRepository } from '../../storage/SupabaseRepository.js';
import { supabaseStudentRepo, validateStudentRemote } from '../../services/studentService.js';

export async function openStudentForm({ student, onSaved }) {
  const remote = isSupabaseConfigured();
  const repo = remote ? supabaseStudentRepo : studentRepo;
  const remoteClasses = remote ? new SupabaseRepository('classes') : null;
  const remoteStreams = remote ? new SupabaseRepository('streams') : null;
  const remoteParents = remote ? new SupabaseRepository('parents') : null;
  let classes = [];
  let parents = [];
  let streams = [];
  try {
    [classes, parents, streams] = remote
      ? await Promise.all([remoteClasses.getAll(), remoteParents.getAll(), remoteStreams.getAll()])
      : [classesSortedByOrder(), parentRepo.getAll(), []];
    if (remote) classes.sort((a, b) => a.order - b.order);
  } catch (error) {
    window.alert(`Could not load student form data: ${error.message}`);
    return;
  }

  const state = {
    admissionNumber: student?.admissionNumber ?? '',
    firstName: student?.firstName ?? '',
    middleName: student?.middleName ?? '',
    lastName: student?.lastName ?? '',
    dateOfBirth: student?.dateOfBirth ?? '',
    gender: student?.gender ?? '',
    classId: student?.classId ?? '',
    streamId: student?.streamId ?? '',
    admissionDate: student?.admissionDate ?? new Date().toISOString().slice(0, 10),
    boardingStatus: student?.boardingStatus ?? 'day',
    house: student?.house ?? '',
    usesTransport: student?.usesTransport ?? false,
    parentId: student?.parentIds?.[0] ?? '',
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
    const availableStreams = remote ? streams.filter((stream) => stream.classId === state.classId) : getStreamsForClass(state.classId);
    overlay.innerHTML = `
      <div class="modal-panel">
        <div class="modal-header">
          <h2 class="text-lg" style="font-weight:600; font-family:var(--font-display);">${student ? 'Edit student' : 'Add student'}</h2>
          <button class="btn-ghost" id="modal-close" aria-label="Close">✕</button>
        </div>
        <div class="modal-body space-y-4">
          <div class="grid sm-grid-2 gap-4">
            <div>
              <label class="label">Admission number</label>
              <input class="input ${errorFor('admissionNumber') ? 'error' : ''}" data-f="admissionNumber" value="${escapeHtml(state.admissionNumber)}" />
              ${errorFor('admissionNumber') ? `<p class="field-error">${escapeHtml(errorFor('admissionNumber'))}</p>` : ''}
            </div>
            <div>
              <label class="label">Date of birth</label>
              <input type="date" class="input" data-f="dateOfBirth" value="${escapeHtml(state.dateOfBirth)}" />
            </div>
          </div>
          <div class="grid sm-grid-3 gap-4">
            <div>
              <label class="label">First name</label>
              <input class="input ${errorFor('firstName') ? 'error' : ''}" data-f="firstName" value="${escapeHtml(state.firstName)}" />
              ${errorFor('firstName') ? `<p class="field-error">${escapeHtml(errorFor('firstName'))}</p>` : ''}
            </div>
            <div>
              <label class="label">Middle name</label>
              <input class="input" data-f="middleName" value="${escapeHtml(state.middleName)}" />
            </div>
            <div>
              <label class="label">Last name</label>
              <input class="input ${errorFor('lastName') ? 'error' : ''}" data-f="lastName" value="${escapeHtml(state.lastName)}" />
              ${errorFor('lastName') ? `<p class="field-error">${escapeHtml(errorFor('lastName'))}</p>` : ''}
            </div>
          </div>
          <div class="grid sm-grid-3 gap-4">
            <div>
              <label class="label">Gender</label>
              <select class="input" data-f="gender">
                <option value="">Select</option>
                <option value="male" ${state.gender === 'male' ? 'selected' : ''}>Male</option>
                <option value="female" ${state.gender === 'female' ? 'selected' : ''}>Female</option>
                <option value="other" ${state.gender === 'other' ? 'selected' : ''}>Other</option>
              </select>
            </div>
            <div>
              <label class="label">Class</label>
              <select class="input ${errorFor('classId') ? 'error' : ''}" data-f="classId" id="class-select">
                <option value="">Select class</option>
                ${classes.map((c) => `<option value="${c.id}" ${state.classId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
              </select>
              ${errorFor('classId') ? `<p class="field-error">${escapeHtml(errorFor('classId'))}</p>` : ''}
            </div>
            <div>
              <label class="label">Stream</label>
              <select class="input" data-f="streamId" ${!state.classId ? 'disabled' : ''}>
                <option value="">${state.classId ? 'Select stream' : 'Select class first'}</option>
                ${availableStreams.map((s) => `<option value="${s.id}" ${state.streamId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="grid sm-grid-3 gap-4">
            <div>
              <label class="label">Admission date</label>
              <input type="date" class="input ${errorFor('admissionDate') ? 'error' : ''}" data-f="admissionDate" value="${escapeHtml(state.admissionDate)}" />
              ${errorFor('admissionDate') ? `<p class="field-error">${escapeHtml(errorFor('admissionDate'))}</p>` : ''}
            </div>
            <div>
              <label class="label">Day / Boarding</label>
              <select class="input" data-f="boardingStatus">
                <option value="day" ${state.boardingStatus === 'day' ? 'selected' : ''}>Day</option>
                <option value="boarding" ${state.boardingStatus === 'boarding' ? 'selected' : ''}>Boarding</option>
              </select>
            </div>
            <div>
              <label class="label">House</label>
              <input class="input" data-f="house" value="${escapeHtml(state.house)}" />
            </div>
          </div>
          <div class="grid sm-grid-2 gap-4">
            <div>
              <label class="label">Parent / Guardian</label>
              <select class="input" data-f="parentId">
                <option value="">Select existing parent (optional)</option>
                ${parents.map((p) => `<option value="${p.id}" ${state.parentId === p.id ? 'selected' : ''}>${escapeHtml(parentFullName(p))}</option>`).join('')}
              </select>
            </div>
            <label class="flex items-center gap-2" style="margin-top:1.7rem;">
              <input type="checkbox" data-f="usesTransport" ${state.usesTransport ? 'checked' : ''} />
              <span class="text-sm text-ink-700">Uses school transport</span>
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" id="modal-cancel">Cancel</button>
          <button class="btn-primary" id="modal-save" ${state.saving ? 'disabled' : ''}>${state.saving ? 'Saving…' : 'Save student'}</button>
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
      if (field === 'classId') {
        state.streamId = '';
        render();
      }
    });
    on(overlay, '[data-f]', 'change', (e) => {
      const field = e.target.getAttribute('data-f');
      if (e.target.tagName === 'SELECT') {
        state[field] = e.target.value;
        if (field === 'classId') {
          state.streamId = '';
          render();
        }
      }
    });

    qs(overlay, '#modal-save').addEventListener('click', save);
  }

  async function save() {
    const draft = {
      admissionNumber: state.admissionNumber,
      firstName: state.firstName,
      lastName: state.lastName,
      classId: state.classId || undefined,
      admissionDate: state.admissionDate,
    };
    let errors;
    try {
      errors = await (remote ? validateStudentRemote(draft, student?.id) : validateStudent(draft, student?.id));
    } catch (error) {
      state.errors = [{ field: 'admissionNumber', message: error.message }];
      render();
      return;
    }
    if (errors.length > 0) {
      state.errors = errors;
      render();
      return;
    }
    state.saving = true;
    const payload = {
      admissionNumber: state.admissionNumber.trim(),
      firstName: state.firstName.trim(),
      middleName: state.middleName.trim() || undefined,
      lastName: state.lastName.trim(),
      dateOfBirth: state.dateOfBirth || undefined,
      gender: state.gender || undefined,
      classId: state.classId || undefined,
      streamId: state.streamId || undefined,
      admissionDate: state.admissionDate,
      boardingStatus: state.boardingStatus,
      house: state.house.trim() || undefined,
      usesTransport: state.usesTransport,
      parentIds: state.parentId ? [state.parentId] : [],
      status: student?.status ?? 'active',
    };
    state.saving = true;
    render();
    try {
      const saved = student
        ? await repo.update(student.id, payload, `edited student ${payload.firstName} ${payload.lastName}`)
        : await repo.create(payload, `added student ${payload.firstName} ${payload.lastName}`);
      if (state.parentId && saved) {
        const parent = parents.find((p) => p.id === state.parentId);
        if (parent && !(parent.studentIds ?? []).includes(saved.id)) {
          const parentRepository = remote ? remoteParents : parentRepo;
          await parentRepository.update(state.parentId, { studentIds: [...(parent.studentIds ?? []), saved.id] });
        }
      }
      close();
      await onSaved();
    } catch (error) {
      state.saving = false;
      state.errors = [{ field: 'admissionNumber', message: error.message }];
      render();
    }
  }

  render();
}
