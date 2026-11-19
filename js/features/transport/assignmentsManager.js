import { escapeHtml, qs } from '../../components/dom.js';
import { studentRepo, fullName } from '../../services/studentService.js';
import {
  routeRepo,
  getAssignmentsForRoute,
  getAssignmentForStudent,
  routeCapacity,
  assignStudent,
  unassignStudent,
} from '../../services/transportService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { assignRemoteStudent, assignmentsForRoute, loadTransportWorkspace, transportCapacity, unassignRemoteStudent } from '../../services/supabaseTransportService.js';

export function renderAssignmentsManager(container) {
  const remote = isSupabaseConfigured();
  const state = { formOpen: false, editingAssignment: false, studentId: '', routeId: '', stopId: '', data: null, error: '' };

  async function render() {
    let routes;
    let students;
    try {
      if (remote) {
        state.data ??= await loadTransportWorkspace();
        routes = state.data.routes;
        students = state.data.students.filter((student) => student.status === 'active');
      } else {
        routes = routeRepo.getAll();
        students = studentRepo.getAll().filter((student) => student.status === 'active');
      }
      state.routeId ||= routes[0]?.id ?? '';
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="assignments-retry">Retry</button></div>`;
      qs(container, '#assignments-retry').addEventListener('click', () => { state.data = null; state.error = ''; render(); });
      return;
    }
    const studentById = Object.fromEntries(students.map((s) => [s.id, s]));

    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center">
          <p class="text-sm text-ink-500">Assign students to a route and stop.</p>
          <button class="btn-primary" id="new-assignment-btn" ${routes.length === 0 ? 'disabled title="Add a route first"' : ''}>+ Assign student</button>
        </div>

        ${state.formOpen ? formHtml(students, routes) : ''}

        ${
          routes.length === 0
            ? `<div class="card">${emptyState({ iconHtml: icons.bus(40), title: 'No routes yet', body: 'Add a route in the Routes tab before assigning students.' })}</div>`
            : `<div class="space-y-3">${routes.map((r) => routeAssignmentsHtml(r, studentById)).join('')}</div>`
        }
      </div>
    `;

    qs(container, '#new-assignment-btn').addEventListener('click', () => {
      if (routes.length === 0) return;
      state.formOpen = true;
      render();
    });

    if (state.formOpen) wireForm(students, routes);

    container.querySelectorAll('[data-unassign]').forEach((btn) =>
      btn.addEventListener('click', async (e) => {
        const studentId = e.currentTarget.getAttribute('data-unassign');
        if (!confirm('Unassign this student from school transport?')) return;
        try {
          if (remote) await unassignRemoteStudent(studentId);
          else unassignStudent(studentId);
          state.data = null;
          state.error = '';
        } catch (error) {
          state.error = error.message;
        }
        await render();
      })
    );
    on(container, '[data-reassign]', 'click', (e) => {
      const studentId = e.currentTarget.dataset.reassign;
      const assignment = remote
        ? state.data.assignments.find((entry) => entry.studentId === studentId)
        : getAssignmentForStudent(studentId);
      if (!assignment) return;
      state.studentId = studentId;
      state.routeId = assignment.routeId;
      state.stopId = assignment.stopId ?? '';
      state.editingAssignment = true;
      state.formOpen = true;
      render();
    });
  }

  function routeAssignmentsHtml(r, studentById) {
    const assignments = remote ? assignmentsForRoute(state.data, r.id) : getAssignmentsForRoute(r.id);
    const capacity = remote ? transportCapacity(state.data, r) : routeCapacity(r);
    const overCapacity = capacity !== null && assignments.length > capacity;
    const stopById = Object.fromEntries((r.stops || []).map((s) => [s.id, s]));
    return `
      <div class="card card-p">
        <div class="flex justify-between items-center">
          <p class="text-sm" style="font-weight:600;">${escapeHtml(r.name)}</p>
          ${capacity !== null ? `<span class="text-xs" style="${overCapacity ? 'color:var(--bad);font-weight:600;' : 'color:var(--ink-500);'}">${assignments.length}/${capacity} seats</span>` : ''}
        </div>
        ${
          assignments.length === 0
            ? `<p class="text-sm text-ink-400 mt-2">No students assigned yet.</p>`
            : `<ul style="list-style:none;margin:0.5rem 0 0;padding:0;" class="space-y-1.5">
                ${assignments
                  .map((a) => {
                    const student = studentById[a.studentId];
                    return `<li class="flex justify-between items-center text-sm">
                      <span>${escapeHtml(student ? fullName(student) : 'Unknown student')} <span class="text-ink-400 text-xs">· ${escapeHtml(stopById[a.stopId]?.name ?? 'No stop set')}</span></span>
                      <span><button data-reassign="${a.studentId}" class="text-brand-700" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;">Edit</button><button data-unassign="${a.studentId}" class="text-bad" style="background:none;border:none;cursor:pointer;text-decoration:underline;margin-left:.75rem;font-family:inherit;">Unassign</button></span>
                    </li>`;
                  })
                  .join('')}
              </ul>`
        }
      </div>
    `;
  }

  function formHtml(students, routes) {
    const route = remote ? state.data.routes.find((item) => item.id === state.routeId) : routeRepo.getById(state.routeId);
    const stops = route?.stops || [];
    // No blank placeholder in these selects, so default state to match the
    // browser's own visual default (the first option).
    if (!state.studentId && students.length > 0) state.studentId = students[0].id;
    if (!state.stopId && stops.length > 0) state.stopId = stops[0].id;

    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editingAssignment ? 'Edit transport assignment' : 'Assign student'}</h3>
        <div class="grid sm-grid-3 gap-4">
          <div>
            <label class="label">Student</label>
            <select class="input" id="assign-student" ${students.length === 0 || state.editingAssignment ? 'disabled' : ''}>
              ${students.length === 0 ? '<option>No students</option>' : students.map((s) => `<option value="${s.id}" ${state.studentId === s.id ? 'selected' : ''}>${escapeHtml(fullName(s))}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="label">Route</label>
            <select class="input" id="assign-route">
              ${routes.map((r) => `<option value="${r.id}" ${state.routeId === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="label">Stop</label>
            <select class="input" id="assign-stop" ${stops.length === 0 ? 'disabled' : ''}>
              ${stops.length === 0 ? '<option>No stops on this route</option>' : stops.map((s) => `<option value="${s.id}" ${state.stopId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-assign-btn">Cancel</button>
          <button class="btn-primary" id="save-assign-btn" ${students.length === 0 ? 'disabled' : ''}>${state.editingAssignment ? 'Save changes' : 'Assign'}</button>
        </div>
      </div>
    `;
  }

  function wireForm(students, routes) {
    qs(container, '#assign-student').addEventListener('change', (e) => (state.studentId = e.target.value));
    qs(container, '#assign-route').addEventListener('change', (e) => {
      state.routeId = e.target.value;
      state.stopId = '';
      render();
    });
    const stopSelect = qs(container, '#assign-stop');
    if (stopSelect) stopSelect.addEventListener('change', (e) => (state.stopId = e.target.value));
    qs(container, '#cancel-assign-btn').addEventListener('click', () => { state.formOpen = false; state.editingAssignment = false; render(); });
    qs(container, '#save-assign-btn').addEventListener('click', async () => {
      if (!state.studentId || !state.routeId) return;
      try {
        if (remote) await assignRemoteStudent(state.studentId, state.routeId, state.stopId || undefined);
        else assignStudent(state.studentId, state.routeId, state.stopId || undefined);
        state.formOpen = false;
        state.editingAssignment = false;
        state.data = null;
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
  }

  render();
}
