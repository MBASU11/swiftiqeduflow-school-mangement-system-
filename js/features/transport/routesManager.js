import { escapeHtml, on, qs } from '../../components/dom.js';
import { vehicleRepo, routeRepo, routeOccupancy, routeCapacity, addStop, removeStop, removeRoute, updateRoute } from '../../services/transportService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { assignmentsForRoute, createRemoteRoute, updateRemoteRoute, loadTransportWorkspace, removeRemoteRoute, removeRemoteStop, addRemoteStop, transportCapacity } from '../../services/supabaseTransportService.js';

export function renderRoutesManager(container) {
  const remote = isSupabaseConfigured();
  const state = { formOpen: false, editId: '', name: '', fee: '', vehicleId: '', newStopNameByRoute: {}, data: null, error: '' };

  async function render() {
    let routes;
    let vehicles;
    try {
      if (remote) {
        state.data ??= await loadTransportWorkspace();
        routes = state.data.routes;
        vehicles = state.data.vehicles;
      } else {
        routes = routeRepo.getAll();
        vehicles = vehicleRepo.getAll();
      }
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="routes-retry">Retry</button></div>`;
      qs(container, '#routes-retry').addEventListener('click', () => { state.data = null; state.error = ''; render(); });
      return;
    }
    const vehicleById = Object.fromEntries(vehicles.map((v) => [v.id, v]));

    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center">
          <p class="text-sm text-ink-500">Routes, their vehicle, and stops along the way.</p>
          <button class="btn-primary" id="new-route-btn">+ Add route</button>
        </div>

        ${state.formOpen ? formHtml(vehicles) : ''}

        ${
          routes.length === 0
            ? `<div class="card">${emptyState({ iconHtml: icons.bus(40), title: 'No routes yet', actionsHtml: `<button class="btn-primary" id="empty-new-btn">+ Add route</button>` })}</div>`
            : `<div class="space-y-3">${routes.map((r) => routeRowHtml(r, vehicleById)).join('')}</div>`
        }
      </div>
    `;

    qs(container, '#new-route-btn').addEventListener('click', () => { state.formOpen = true; render(); });
    const emptyBtn = qs(container, '#empty-new-btn');
    if (emptyBtn) emptyBtn.addEventListener('click', () => { state.formOpen = true; render(); });

    if (state.formOpen) wireForm(vehicles);

    on(container, '[data-edit-route]', 'click', (e) => {
      const route = routes.find((item) => item.id === e.currentTarget.getAttribute('data-edit-route'));
      if (!route) return;
      state.editId = route.id;
      state.name = route.name ?? '';
      state.fee = route.fee == null ? '' : String(route.fee);
      state.vehicleId = route.vehicleId ?? '';
      state.formOpen = true;
      render();
    });

    on(container, '[data-remove-route]', 'click', async (e) => {
      if (!confirm('Remove this route and unassign any students on it?')) return;
      try {
        const routeId = e.currentTarget.getAttribute('data-remove-route');
        if (remote) await removeRemoteRoute(routeId);
        else removeRoute(routeId);
        state.data = null;
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
    on(container, '[data-add-stop]', 'click', async (e) => {
      const routeId = e.currentTarget.getAttribute('data-add-stop');
      const name = (state.newStopNameByRoute[routeId] || '').trim();
      if (!name) return;
      try {
        if (remote) await addRemoteStop(routeId, name);
        else addStop(routeId, name);
        state.newStopNameByRoute[routeId] = '';
        state.data = null;
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
    on(container, '[data-stop-input]', 'input', (e) => {
      state.newStopNameByRoute[e.target.getAttribute('data-stop-input')] = e.target.value;
    });
    on(container, '[data-remove-stop]', 'click', async (e) => {
      const [routeId, stopId] = e.currentTarget.getAttribute('data-remove-stop').split('::');
      if (!confirm('Remove this stop? Students assigned to it will be unassigned from transport.')) return;
      try {
        if (remote) await removeRemoteStop(routeId, stopId);
        else removeStop(routeId, stopId);
        state.data = null;
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
  }

  function routeRowHtml(r, vehicleById) {
    const vehicle = vehicleById[r.vehicleId ?? ''];
    const occupancy = remote ? assignmentsForRoute(state.data, r.id).length : routeOccupancy(r.id);
    const capacity = remote ? transportCapacity(state.data, r) : routeCapacity(r);
    const overCapacity = capacity !== null && occupancy > capacity;
    return `
      <div class="card card-p">
        <div class="flex justify-between items-center">
          <div>
            <p class="text-sm" style="font-weight:600;">${escapeHtml(r.name)}</p>
            <p class="text-xs text-ink-500 mt-1">
              ${vehicle ? escapeHtml(`${vehicle.make} ${vehicle.model} (${vehicle.registrationNumber})`) : 'No vehicle assigned'}${r.fee ? ` · fee ${Number(r.fee).toLocaleString('en-US')} per term` : ''}
              ${capacity !== null ? ` · <span style="${overCapacity ? 'color:var(--bad);font-weight:600;' : ''}">${occupancy}/${capacity} seats used</span>` : ''}
            </p>
          </div>
          <span><button data-edit-route="${r.id}" class="text-brand-700" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;">Edit</button><button data-remove-route="${r.id}" class="text-bad" style="background:none;border:none;cursor:pointer;text-decoration:underline;margin-left:.75rem;font-family:inherit;">Remove</button></span>
        </div>
        <div class="mt-3">
          <p class="text-xs text-ink-500 mb-1.5">Stops</p>
          <div class="flex flex-wrap gap-2 items-center">
            ${(r.stops || [])
              .map(
                (s) => `<span class="badge" style="background:var(--ink-100);color:var(--ink-700);">${escapeHtml(s.name)} <button data-remove-stop="${r.id}::${s.id}" style="background:none;border:none;cursor:pointer;color:var(--bad);margin-left:0.3rem;font-family:inherit;">✕</button></span>`
              )
              .join('')}
            <input class="input" style="width:9rem;padding:0.35rem 0.6rem;" data-stop-input="${r.id}" placeholder="New stop" value="${escapeHtml(state.newStopNameByRoute[r.id] || '')}" />
            <button class="btn-secondary btn-sm" data-add-stop="${r.id}">+ Add</button>
          </div>
        </div>
      </div>
    `;
  }

  function formHtml(vehicles) {
    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editId ? 'Edit route' : 'New route'}</h3>
        <div class="grid sm-grid-2 gap-4">
          <div>
            <label class="label">Route name</label>
            <input class="input" id="route-name" value="${escapeHtml(state.name)}" placeholder="e.g. Westlands Route" />
          </div>
          <div>
            <label class="label">Fee per term (optional)</label>
            <input class="input" id="route-fee" type="number" min="0" value="${escapeHtml(state.fee)}" placeholder="Used for transport billing" />
          </div>
          <div>
            <label class="label">Vehicle (optional)</label>
            <select class="input" id="route-vehicle">
              <option value="">None yet</option>
              ${vehicles.map((v) => `<option value="${v.id}" ${state.vehicleId === v.id ? 'selected' : ''}>${escapeHtml(v.registrationNumber)} — ${escapeHtml(v.make)} ${escapeHtml(v.model)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-route-btn">Cancel</button>
          <button class="btn-primary" id="save-route-btn">${state.editId ? 'Save changes' : 'Add route'}</button>
        </div>
      </div>
    `;
  }

  function wireForm() {
    qs(container, '#route-name').addEventListener('input', (e) => (state.name = e.target.value));
    qs(container, '#route-fee').addEventListener('input', (e) => (state.fee = e.target.value));
    qs(container, '#route-vehicle').addEventListener('change', (e) => (state.vehicleId = e.target.value));
    qs(container, '#cancel-route-btn').addEventListener('click', () => { state.formOpen = false; state.editId = ''; render(); });
    qs(container, '#save-route-btn').addEventListener('click', async () => {
      if (!state.name.trim()) return;
      try {
        const route = { name: state.name.trim(), vehicleId: state.vehicleId || undefined, fee: Number(state.fee) > 0 ? Number(state.fee) : undefined, stops: [] };
        if (state.editId) {
          if (remote) await updateRemoteRoute(state.editId, route);
          else updateRoute(state.editId, route);
        } else if (remote) await createRemoteRoute(route);
        else routeRepo.create(route);
        state.error = '';
        state.data = null;
      } catch (error) {
        state.error = error.message;
      }
      state.name = '';
      state.vehicleId = '';
      state.fee = '';
      state.editId = '';
      state.formOpen = false;
      await render();
    });
  }

  render();
}
