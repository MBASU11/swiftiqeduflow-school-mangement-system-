import { escapeHtml, on, qs } from '../../components/dom.js';
import { vehicleRepo, routeRepo, updateVehicle } from '../../services/transportService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { loadTransportWorkspace, createRemoteVehicle, updateRemoteVehicle, removeRemoteVehicle } from '../../services/supabaseTransportService.js';

export function renderVehiclesManager(container) {
  const remote = isSupabaseConfigured();
  const state = { formOpen: false, editId: '', registrationNumber: '', make: '', model: '', capacity: '14', driverName: '', driverPhone: '', data: null, error: '' };

  async function render() {
    let vehicles;
    let routes;
    try {
      if (remote) {
        state.data ??= await loadTransportWorkspace();
        vehicles = state.data.vehicles;
        routes = state.data.routes;
      } else {
        vehicles = vehicleRepo.getAll();
        routes = routeRepo.getAll();
      }
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="vehicle-retry">Retry</button></div>`;
      qs(container, '#vehicle-retry').addEventListener('click', () => { state.data = null; state.error = ''; render(); });
      return;
    }

    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center">
          <p class="text-sm text-ink-500">Vehicles and their drivers. Assign a vehicle to a route in the Routes tab.</p>
          <button class="btn-primary" id="new-vehicle-btn">+ Add vehicle</button>
        </div>

        ${state.formOpen ? formHtml() : ''}

        ${
          vehicles.length === 0
            ? `<div class="card">${emptyState({ iconHtml: icons.bus(40), title: 'No vehicles yet', actionsHtml: `<button class="btn-primary" id="empty-new-btn">+ Add vehicle</button>` })}</div>`
            : `<div class="card overflow-x-auto">
                <table class="data-table">
                  <thead><tr><th>Registration</th><th>Vehicle</th><th>Driver</th><th class="text-right">Capacity</th><th>Route</th><th></th></tr></thead>
                  <tbody>
                    ${vehicles
                      .map((v) => {
                        const route = routes.find((r) => r.vehicleId === v.id);
                        return `<tr>
                          <td style="font-weight:500;">${escapeHtml(v.registrationNumber)}</td>
                          <td class="text-ink-600">${escapeHtml(v.make)} ${escapeHtml(v.model)}</td>
                          <td class="text-ink-600">${escapeHtml(v.driverName || '—')}${v.driverPhone ? ` · ${escapeHtml(v.driverPhone)}` : ''}</td>
                          <td class="text-right">${v.capacity}</td>
                          <td class="text-ink-500">${escapeHtml(route?.name ?? 'Unassigned')}</td>
                          <td class="text-right" style="white-space:nowrap;"><button data-edit="${v.id}" class="text-brand-700" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;">Edit</button><button data-remove="${v.id}" class="text-bad" style="background:none;border:none;cursor:pointer;text-decoration:underline;margin-left:.75rem;font-family:inherit;">Remove</button></td>
                        </tr>`;
                      })
                      .join('')}
                  </tbody>
                </table>
              </div>`
        }
      </div>
    `;

    qs(container, '#new-vehicle-btn').addEventListener('click', () => { state.formOpen = true; render(); });
    const emptyBtn = qs(container, '#empty-new-btn');
    if (emptyBtn) emptyBtn.addEventListener('click', () => { state.formOpen = true; render(); });

    if (state.formOpen) wireForm();

    on(container, '[data-edit]', 'click', (e) => {
      const vehicle = vehicles.find((item) => item.id === e.currentTarget.getAttribute('data-edit'));
      if (!vehicle) return;
      state.editId = vehicle.id;
      state.registrationNumber = vehicle.registrationNumber ?? '';
      state.make = vehicle.make ?? '';
      state.model = vehicle.model ?? '';
      state.capacity = String(vehicle.capacity ?? 14);
      state.driverName = vehicle.driverName ?? '';
      state.driverPhone = vehicle.driverPhone ?? '';
      state.formOpen = true;
      render();
    });

    on(container, '[data-remove]', 'click', async (e) => {
      const id = e.currentTarget.getAttribute('data-remove');
      if (routes.some((r) => r.vehicleId === id)) {
        alert('This vehicle is assigned to a route. Unassign it from the route first.');
        return;
      }
      if (!confirm('Remove this vehicle?')) return;
      try {
        if (remote) await removeRemoteVehicle(id);
        else vehicleRepo.remove(id, 'removed vehicle');
        state.data = null;
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
  }

  function formHtml() {
    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editId ? 'Edit vehicle' : 'Add vehicle'}</h3>
        <div class="grid sm-grid-3 gap-4">
          <div>
            <label class="label">Registration number</label>
            <input class="input" id="v-reg" value="${escapeHtml(state.registrationNumber)}" placeholder="e.g. KDA 123X" />
          </div>
          <div>
            <label class="label">Make</label>
            <input class="input" id="v-make" value="${escapeHtml(state.make)}" placeholder="e.g. Toyota" />
          </div>
          <div>
            <label class="label">Model</label>
            <input class="input" id="v-model" value="${escapeHtml(state.model)}" placeholder="e.g. Hiace" />
          </div>
        </div>
        <div class="grid sm-grid-3 gap-4">
          <div>
            <label class="label">Capacity (seats)</label>
            <input type="number" min="1" class="input" id="v-capacity" value="${escapeHtml(state.capacity)}" />
          </div>
          <div>
            <label class="label">Driver name</label>
            <input class="input" id="v-driver-name" value="${escapeHtml(state.driverName)}" />
          </div>
          <div>
            <label class="label">Driver phone</label>
            <input class="input" id="v-driver-phone" value="${escapeHtml(state.driverPhone)}" />
          </div>
        </div>
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-v-btn">Cancel</button>
          <button class="btn-primary" id="save-v-btn">${state.editId ? 'Save changes' : 'Add vehicle'}</button>
        </div>
      </div>
    `;
  }

  function wireForm() {
    qs(container, '#v-reg').addEventListener('input', (e) => (state.registrationNumber = e.target.value));
    qs(container, '#v-make').addEventListener('input', (e) => (state.make = e.target.value));
    qs(container, '#v-model').addEventListener('input', (e) => (state.model = e.target.value));
    qs(container, '#v-capacity').addEventListener('input', (e) => (state.capacity = e.target.value));
    qs(container, '#v-driver-name').addEventListener('input', (e) => (state.driverName = e.target.value));
    qs(container, '#v-driver-phone').addEventListener('input', (e) => (state.driverPhone = e.target.value));
    qs(container, '#cancel-v-btn').addEventListener('click', () => { state.formOpen = false; state.editId = ''; render(); });
    qs(container, '#save-v-btn').addEventListener('click', async () => {
      const capacity = Number(state.capacity);
      if (!state.registrationNumber.trim() || !capacity || capacity < 1) return;
      const vehicle = {
        registrationNumber: state.registrationNumber.trim(),
        make: state.make.trim(),
        model: state.model.trim(),
        capacity,
        driverName: state.driverName.trim() || undefined,
        driverPhone: state.driverPhone.trim() || undefined,
      };
      try {
        if (state.editId) {
          if (remote) await updateRemoteVehicle(state.editId, vehicle);
          else updateVehicle(state.editId, vehicle);
        } else if (remote) await createRemoteVehicle(vehicle);
        else vehicleRepo.create(vehicle);
        state.data = null;
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      state.registrationNumber = '';
      state.make = '';
      state.model = '';
      state.driverName = '';
      state.driverPhone = '';
      state.editId = '';
      state.formOpen = false;
      await render();
    });
  }

  render();
}
