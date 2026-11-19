import { renderTeamAccess } from './teamAccess.js';
import { renderFamilyAccess } from './familyAccess.js';
import { renderParentNotice } from './parentNotice.js';
import { isAdmin } from '../../services/accessService.js';
import { escapeHtml, on, qs } from '../../components/dom.js';
import { getSettings, updateModuleToggles } from '../../services/settingsService.js';
import { exportBackup, importBackup, resetAllData } from '../../services/backupService.js';
import { getSchool, updateSchool } from '../../services/schoolService.js';
import { refreshShellNav } from '../../layouts/appShell.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { defaultModuleToggles } from '../../services/settingsService.js';
import { SupabaseRepository } from '../../storage/SupabaseRepository.js';
import { getSupabaseClient } from '../../services/supabaseClient.js';

const TOGGLE_LABELS = [
  ['admissions', 'Admissions'],
  ['academics', 'Academics'],
  ['attendance', 'Attendance'],
  ['timetable', 'Timetable'],
  ['exams', 'Exams & Assessments'],
  ['finance', 'Finance'],
  ['communication', 'Communication'],
  ['transport', 'Transport'],
  ['library', 'Library'],
  ['inventory', 'Inventory'],
  ['discipline', 'Discipline'],
  ['health', 'Health'],
  ['hostels', 'Hostel / Boarding'],
  ['documents', 'Documents'],
];

function addBrandingPreview(container, school, state, rerender) {
  const logoInput = qs(container, '#school-logo');
  if (!logoInput) return;
  const preview = document.createElement('div');
  preview.className = 'grid sm-grid-2 gap-3';
  preview.innerHTML = `
    <div>
      ${state.logoUrl ? `<img src="${escapeHtml(state.logoUrl)}" alt="School logo preview" style="width:72px;height:72px;object-fit:contain;border:1px solid var(--ink-200);border-radius:0.5rem;padding:0.25rem;" />` : '<p class="text-xs text-ink-500">No school logo uploaded</p>'}
      ${school?.logoUrl || state.logoUrl ? '<button type="button" class="btn-ghost btn-sm mt-2" id="remove-school-logo">Remove logo</button>' : ''}
    </div>
    <div>
      ${state.letterheadUrl ? `<img src="${escapeHtml(state.letterheadUrl)}" alt="Letterhead preview" style="width:180px;height:72px;object-fit:contain;border:1px solid var(--ink-200);border-radius:0.5rem;padding:0.25rem;" />` : '<p class="text-xs text-ink-500">No letterhead uploaded</p>'}
      ${school?.letterheadUrl || state.letterheadUrl ? '<button type="button" class="btn-ghost btn-sm mt-2" id="remove-school-letterhead">Remove letterhead</button>' : ''}
    </div>
  `;
  logoInput.closest('.grid')?.insertAdjacentElement('afterend', preview);
  qs(preview, '#remove-school-logo')?.addEventListener('click', () => {
    state.logoUrl = '';
    rerender();
  });
  qs(preview, '#remove-school-letterhead')?.addEventListener('click', () => {
    state.letterheadUrl = '';
    rerender();
  });
}

function renderSettingsBody(container) {
  if (isSupabaseConfigured()) return renderRemoteSettings(container);
  let school = getSchool();
  const state = { showReset: false, resetConfirmText: '', importMessage: null, profileOpen: false, profileError: '', logoUrl: '', letterheadUrl: '' };

  function render() {
    const settings = getSettings();
    container.innerHTML = `
      <div class="space-y-6" style="max-width:48rem;">
        <h1 class="text-xl" style="font-weight:600;">Settings</h1>

        <section class="card card-p">
          <div class="flex justify-between items-center gap-3"><h2 class="text-sm text-ink-700 mb-1" style="font-weight:600;">School profile</h2><button class="btn-secondary btn-sm" id="edit-school-profile">Edit profile</button></div>
          <p class="text-sm text-ink-500 mb-2">${escapeHtml(school?.name ?? '')} · ${escapeHtml(school?.currency ?? '')} · ${escapeHtml(school?.timezone ?? '')}</p>
          ${school?.logoUrl || school?.letterheadUrl ? `<div class="flex items-center gap-3 mb-3">${school.logoUrl ? `<img src="${escapeHtml(school.logoUrl)}" alt="School logo" style="width:72px;height:72px;object-fit:contain;border:1px solid var(--ink-200);border-radius:0.5rem;padding:0.25rem;" />` : ''}${school.letterheadUrl ? `<img src="${escapeHtml(school.letterheadUrl)}" alt="School letterhead" style="width:180px;height:72px;object-fit:contain;border:1px solid var(--ink-200);border-radius:0.5rem;padding:0.25rem;" />` : ''}</div>` : ''}
          ${school?.email ? `<p class="text-sm text-ink-500">${escapeHtml(school.email)}</p>` : ''}
          ${school?.address ? `<p class="text-sm text-ink-500">${escapeHtml(school.address)}</p>` : ''}
          ${school?.plan ? `<p class="text-sm text-ink-500 mb-4">Plan: ${escapeHtml(school.plan.name)} · ${school.plan.modules === 'single' ? 'single module' : 'both modules'}</p>` : ''}
          ${state.profileError ? `<p class="notice mt-3" role="alert">${escapeHtml(state.profileError)}</p>` : ''}
          ${state.profileOpen ? `<div class="space-y-3 mt-4" id="school-profile-form">
            <div><label class="label" for="school-name">School name</label><input class="input" id="school-name" value="${escapeHtml(school?.name ?? '')}" /></div>
            <div class="grid sm-grid-2 gap-3"><div><label class="label" for="school-email">Email</label><input class="input" id="school-email" type="email" value="${escapeHtml(school?.email ?? '')}" /></div><div><label class="label" for="school-phone">Phone</label><input class="input" id="school-phone" value="${escapeHtml(school?.phone ?? '')}" /></div></div>
            <div><label class="label" for="school-address">Address</label><input class="input" id="school-address" value="${escapeHtml(school?.address ?? '')}" /></div>
            <div class="grid sm-grid-2 gap-3">
              <div><label class="label" for="school-logo">School logo</label><input class="input" id="school-logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" /></div>
              <div><label class="label" for="school-letterhead">School letterhead</label><input class="input" id="school-letterhead" type="file" accept="image/png,image/jpeg,image/webp" /></div>
            </div>
            <p class="text-xs text-ink-500">Maximum 2 MB per image. The logo or letterhead will appear on report cards and printable documents.</p>
            <div class="grid sm-grid-2 gap-3"><div><label class="label" for="school-currency">Currency</label><input class="input" id="school-currency" value="${escapeHtml(school?.currency ?? 'KES')}" /></div><div><label class="label" for="school-timezone">Timezone</label><input class="input" id="school-timezone" value="${escapeHtml(school?.timezone ?? 'Africa/Nairobi')}" /></div></div>
            <div class="flex justify-end gap-3"><button class="btn-secondary" id="cancel-school-profile">Cancel</button><button class="btn-primary" id="save-school-profile">Save profile</button></div>
          </div>` : ''}
        </section>

        <section class="card card-p">
          <h2 class="text-sm text-ink-700 mb-1" style="font-weight:600;">Modules</h2>
          <p class="text-sm text-ink-500 mb-4">Turn off modules this school doesn't need. They disappear from the navigation immediately.</p>
          <div class="grid sm-grid-2 gap-2">
            ${TOGGLE_LABELS.map(
              ([key, label]) => `
              <label class="flex justify-between items-center" style="border:1px solid var(--ink-100); border-radius:0.5rem; padding:0.6rem 0.9rem;">
                <span class="text-sm" style="color:var(--ink-800);">${escapeHtml(label)}</span>
                <input type="checkbox" data-toggle="${key}" ${settings.moduleToggles[key] ? 'checked' : ''} />
              </label>
            `
            ).join('')}
          </div>
        </section>

        <section class="card card-p">
          <h2 class="text-sm text-ink-700 mb-1" style="font-weight:600;">Backup & restore</h2>
          <p class="text-sm text-ink-500 mb-4">Your school’s data is saved in this browser on this device. Download a backup regularly and keep it somewhere safe.</p>
          <div class="flex flex-wrap gap-3">
            <button class="btn-secondary" id="export-btn">Export School Data</button>
            <button class="btn-secondary" id="import-btn">Import School Data</button>
            <input type="file" accept="application/json" id="import-file" class="hidden" />
          </div>
          ${state.importMessage ? `<p class="mt-3 text-sm ${state.importMessage.ok ? 'text-good' : 'text-bad'}">${escapeHtml(state.importMessage.text)}</p>` : ''}
        </section>

        <section class="card card-p" style="border-color: rgba(176,65,62,0.3);">
          <h2 class="text-sm text-bad mb-1" style="font-weight:600;">Danger zone</h2>
          <p class="text-sm text-ink-500 mb-4">Reset Local School Data permanently removes everything stored in this browser for this school.</p>
          ${
            !state.showReset
              ? `<button class="btn-danger" id="show-reset-btn">Reset Local School Data</button>`
              : `<div class="space-y-3">
                  <p class="text-sm text-ink-700">This will permanently remove locally stored school data from this browser. Type <strong>RESET</strong> to confirm.</p>
                  <input class="input" style="max-width:16rem" id="reset-confirm-input" value="${escapeHtml(state.resetConfirmText)}" />
                  <div class="flex gap-3">
                    <button class="btn-secondary" id="cancel-reset-btn">Cancel</button>
                    <button class="btn-danger" id="confirm-reset-btn" ${state.resetConfirmText !== 'RESET' ? 'disabled' : ''}>Permanently reset</button>
                  </div>
                </div>`
          }
        </section>
      </div>
    `;

    on(container, '[data-toggle]', 'change', (e) => {
      updateModuleToggles({ [e.target.getAttribute('data-toggle')]: e.target.checked });
      refreshShellNav();
    });

    qs(container, '#export-btn').addEventListener('click', () => exportBackup(school?.name ?? 'school'));
    qs(container, '#edit-school-profile').addEventListener('click', () => {
      state.profileOpen = true;
      state.profileError = '';
      state.logoUrl = school?.logoUrl ?? '';
      state.letterheadUrl = school?.letterheadUrl ?? '';
      render();
    });
    const cancelProfile = qs(container, '#cancel-school-profile');
    if (cancelProfile) cancelProfile.addEventListener('click', () => { state.profileOpen = false; state.profileError = ''; render(); });
    const logoInput = qs(container, '#school-logo');
    const letterheadInput = qs(container, '#school-letterhead');
    const readBrandImage = (input, fieldName) => {
      if (!input) return;
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
          state.profileError = 'The selected image must be 2 MB or smaller.';
          render();
          return;
        }
        const reader = new FileReader();
        reader.onload = () => { state[fieldName] = String(reader.result); state.profileError = ''; };
        reader.readAsDataURL(file);
      });
    };
    readBrandImage(logoInput, 'logoUrl');
    readBrandImage(letterheadInput, 'letterheadUrl');
    addBrandingPreview(container, school, state, render);
    const saveProfile = qs(container, '#save-school-profile');
    if (saveProfile) saveProfile.addEventListener('click', () => {
      const name = qs(container, '#school-name').value.trim();
      if (!name) { state.profileError = 'School name is required.'; render(); return; }
      school = updateSchool({
        name, email: qs(container, '#school-email').value.trim(),
        phone: qs(container, '#school-phone').value.trim(),
        address: qs(container, '#school-address').value.trim(),
        logoUrl: state.logoUrl || null,
        letterheadUrl: state.letterheadUrl || null,
        currency: qs(container, '#school-currency').value.trim() || 'KES',
        timezone: qs(container, '#school-timezone').value.trim() || 'Africa/Nairobi',
      });
      state.profileOpen = false;
      state.profileError = '';
      render();
    });
    const importBtn = qs(container, '#import-btn');
    const importFile = qs(container, '#import-file');
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', () => {
      const file = importFile.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = importBackup(String(reader.result));
        if (result.ok) {
          state.importMessage = { ok: true, text: 'Backup restored. Reloading…' };
          render();
          setTimeout(() => window.location.reload(), 1200);
        } else {
          state.importMessage = { ok: false, text: result.error };
          render();
        }
      };
      reader.readAsText(file);
    });

    const showResetBtn = qs(container, '#show-reset-btn');
    if (showResetBtn) showResetBtn.addEventListener('click', () => { state.showReset = true; render(); });
    const cancelResetBtn = qs(container, '#cancel-reset-btn');
    if (cancelResetBtn) cancelResetBtn.addEventListener('click', () => { state.showReset = false; render(); });
    const resetConfirmInput = qs(container, '#reset-confirm-input');
    if (resetConfirmInput) resetConfirmInput.addEventListener('input', (e) => {
      state.resetConfirmText = e.target.value;
      qs(container, '#confirm-reset-btn').disabled = state.resetConfirmText !== 'RESET';
    });
    const confirmResetBtn = qs(container, '#confirm-reset-btn');
    if (confirmResetBtn) confirmResetBtn.addEventListener('click', () => {
      resetAllData();
      window.location.reload();
    });
  }

  render();
}

// Settings page: the existing sections, plus Team & access for administrators.
export function renderSettings(container) {
  container.innerHTML = '<div id="settings-main"></div><div id="settings-team" data-admin-only style="max-width:48rem;margin-top:1.5rem;"></div><div id="settings-family" data-admin-only style="max-width:48rem;margin-top:1.5rem;"></div><div id="settings-privacy" data-admin-only style="max-width:48rem;margin-top:1.5rem;"></div>';
  renderSettingsBody(qs(container, '#settings-main'));
  if (isAdmin()) { renderTeamAccess(qs(container, '#settings-team')); renderFamilyAccess(qs(container, '#settings-family')); renderParentNotice(qs(container, '#settings-privacy')); }
}

function renderRemoteSettings(container) {
  const state = { data: null, error: '', profileOpen: false, profileError: '', logoUrl: '', letterheadUrl: '' };
  const settingsRepo = new SupabaseRepository('settings');
  const schoolRepo = new SupabaseRepository('school');

  async function render() {
    let school;
    let settings;
    try {
      [school, settings] = await Promise.all([schoolRepo.getById('the-school'), settingsRepo.getById('the-settings')]);
      if (!settings) {
        const now = new Date().toISOString();
        const payload = { id: 'the-settings', createdAt: now, updatedAt: now, moduleToggles: { ...defaultModuleToggles } };
        const client = await getSupabaseClient();
        const { error } = await client.from('school_records').insert({ collection: 'settings', record_id: 'the-settings', payload });
        if (error) throw error;
        settings = payload;
      }
      state.data = { school, settings };
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="settings-retry">Retry</button></div>`;
      qs(container, '#settings-retry').addEventListener('click', render);
      return;
    }
    const { moduleToggles } = state.data.settings;
    container.innerHTML = `<div class="space-y-6" style="max-width:48rem;">${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}<h1 class="text-xl" style="font-weight:600;">Settings</h1><section class="card card-p"><div class="flex justify-between items-center gap-3"><h2 class="text-sm text-ink-700 mb-1" style="font-weight:600;">School profile</h2><button class="btn-secondary btn-sm" id="edit-school-profile">Edit profile</button></div><p class="text-sm text-ink-500 mb-2">${escapeHtml(school?.name ?? '')} · ${escapeHtml(school?.currency ?? '')} · ${escapeHtml(school?.timezone ?? '')}</p>${school?.logoUrl || school?.letterheadUrl ? `<div class="flex items-center gap-3 mb-3">${school.logoUrl ? `<img src="${escapeHtml(school.logoUrl)}" alt="School logo" style="width:72px;height:72px;object-fit:contain;border:1px solid var(--ink-200);border-radius:0.5rem;padding:0.25rem;" />` : ''}${school.letterheadUrl ? `<img src="${escapeHtml(school.letterheadUrl)}" alt="School letterhead" style="width:180px;height:72px;object-fit:contain;border:1px solid var(--ink-200);border-radius:0.5rem;padding:0.25rem;" />` : ''}</div>` : ''}${school?.email ? `<p class="text-sm text-ink-500">${escapeHtml(school.email)}</p>` : ''}${school?.address ? `<p class="text-sm text-ink-500">${escapeHtml(school.address)}</p>` : ''}${school?.plan ? `<p class="text-sm text-ink-500">Plan: ${escapeHtml(school.plan.name)} · ${school.plan.modules === 'single' ? 'single module' : 'both modules'}</p>` : ''}${state.profileError ? `<p class="notice mt-3" role="alert">${escapeHtml(state.profileError)}</p>` : ''}${state.profileOpen ? `<div class="space-y-3 mt-4"><div><label class="label" for="school-name">School name</label><input class="input" id="school-name" value="${escapeHtml(school?.name ?? '')}" /></div><div class="grid sm-grid-2 gap-3"><div><label class="label" for="school-email">Email</label><input class="input" id="school-email" type="email" value="${escapeHtml(school?.email ?? '')}" /></div><div><label class="label" for="school-phone">Phone</label><input class="input" id="school-phone" value="${escapeHtml(school?.phone ?? '')}" /></div></div><div><label class="label" for="school-address">Address</label><input class="input" id="school-address" value="${escapeHtml(school?.address ?? '')}" /></div><div class="grid sm-grid-2 gap-3"><div><label class="label" for="school-logo">School logo</label><input class="input" id="school-logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" /></div><div><label class="label" for="school-letterhead">School letterhead</label><input class="input" id="school-letterhead" type="file" accept="image/png,image/jpeg,image/webp" /></div></div><p class="text-xs text-ink-500">Maximum 2 MB per image. The logo or letterhead will appear on report cards and printable documents.</p><div class="grid sm-grid-2 gap-3"><div><label class="label" for="school-currency">Currency</label><input class="input" id="school-currency" value="${escapeHtml(school?.currency ?? 'KES')}" /></div><div><label class="label" for="school-timezone">Timezone</label><input class="input" id="school-timezone" value="${escapeHtml(school?.timezone ?? 'Africa/Nairobi')}" /></div></div><div class="flex justify-end gap-3"><button class="btn-secondary" id="cancel-school-profile">Cancel</button><button class="btn-primary" id="save-school-profile">Save profile</button></div></div>` : ''}</section><section class="card card-p"><h2 class="text-sm text-ink-700 mb-1" style="font-weight:600;">Modules</h2><p class="text-sm text-ink-500 mb-4">Turn off modules this school does not need.</p><div class="grid sm-grid-2 gap-2">${TOGGLE_LABELS.map(([key, label]) => `<label class="flex justify-between items-center" style="border:1px solid var(--ink-100);border-radius:0.5rem;padding:0.6rem 0.9rem;"><span class="text-sm" style="color:var(--ink-800);">${escapeHtml(label)}</span><input type="checkbox" data-toggle="${key}" ${moduleToggles[key] ? 'checked' : ''} /></label>`).join('')}</div></section><section class="card card-p"><h2 class="text-sm text-ink-700 mb-1" style="font-weight:600;">Cloud data</h2><p class="text-sm text-ink-500">School records are stored in the shared tenant database. Use your Supabase project's backup and recovery settings to manage cloud backups.</p></section></div>`;
    qs(container, '#edit-school-profile').addEventListener('click', () => {
      state.profileOpen = true;
      state.profileError = '';
      state.logoUrl = school?.logoUrl ?? '';
      state.letterheadUrl = school?.letterheadUrl ?? '';
      render();
    });
    const cancelProfile = qs(container, '#cancel-school-profile');
    if (cancelProfile) cancelProfile.addEventListener('click', () => { state.profileOpen = false; state.profileError = ''; render(); });
    const readRemoteBrandImage = (inputId, fieldName) => {
      const input = qs(container, inputId);
      if (!input) return;
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
          state.profileError = 'The selected image must be 2 MB or smaller.';
          render();
          return;
        }
        const reader = new FileReader();
        reader.onload = () => { state[fieldName] = String(reader.result); state.profileError = ''; };
        reader.readAsDataURL(file);
      });
    };
    readRemoteBrandImage('#school-logo', 'logoUrl');
    readRemoteBrandImage('#school-letterhead', 'letterheadUrl');
    addBrandingPreview(container, school, state, render);
    const saveProfile = qs(container, '#save-school-profile');
    if (saveProfile) saveProfile.addEventListener('click', async () => {
      const name = qs(container, '#school-name').value.trim();
      if (!name) { state.profileError = 'School name is required.'; render(); return; }
      try {
        await schoolRepo.update('the-school', {
          name, email: qs(container, '#school-email').value.trim(),
          phone: qs(container, '#school-phone').value.trim(),
          address: qs(container, '#school-address').value.trim(),
          logoUrl: state.logoUrl || null,
          letterheadUrl: state.letterheadUrl || null,
          currency: qs(container, '#school-currency').value.trim() || 'KES',
          timezone: qs(container, '#school-timezone').value.trim() || 'Africa/Nairobi',
        });
        state.profileOpen = false;
        state.profileError = '';
        state.error = '';
      } catch (error) { state.profileError = error.message; }
      await render();
    });
    on(container, '[data-toggle]', 'change', async (event) => {
      const nextToggles = { ...moduleToggles, [event.target.getAttribute('data-toggle')]: event.target.checked };
      try {
        await settingsRepo.update('the-settings', { moduleToggles: nextToggles }, 'changed module settings');
        state.error = '';
        await render();
      } catch (error) {
        state.error = error.message;
        await render();
      }
    });
  }

  render();
}
