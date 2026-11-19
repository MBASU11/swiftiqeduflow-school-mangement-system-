import { escapeHtml, on, qs } from '../../components/dom.js';
import { announcementRepo, getAnnouncements, AUDIENCES } from '../../services/communicationService.js';
import { classesSortedByOrder, getStreamsForClass } from '../../services/academicService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { createRemoteAnnouncement, loadCommunicationWorkspace, removeRemoteAnnouncement } from '../../services/supabaseCommunicationService.js';
import { SupabaseRepository } from '../../storage/SupabaseRepository.js';

const AUDIENCE_LABEL = Object.fromEntries(AUDIENCES);

export function renderAnnouncements(container) {
  if (isSupabaseConfigured()) return renderRemoteAnnouncements(container);
  const classes = classesSortedByOrder();
  const state = { formOpen: false, editId: '', title: '', body: '', audience: 'school', classId: '', streamId: '' };

  function render() {
    const announcements = getAnnouncements();
    const classById = Object.fromEntries(classes.map((c) => [c.id, c]));

    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center">
          <p class="text-sm text-ink-500">Post an update for the whole school, a class, or a specific group.</p>
          <button class="btn-primary" id="new-announcement-btn">+ Send Announcement</button>
        </div>

        ${state.formOpen ? formHtml() : ''}

        ${
          announcements.length === 0
            ? `<div class="card">${emptyState({
                iconHtml: icons.megaphone(40),
                title: 'No announcements yet',
                actionsHtml: `<button class="btn-primary" id="empty-new-btn">+ Send Announcement</button>`,
              })}</div>`
            : `<div class="card" style="overflow:hidden;">
                ${announcements
                  .map((a) => {
                    const target =
                      a.audience === 'class'
                        ? classById[(a.audienceIds || [])[0]]?.name
                        : a.audience === 'stream'
                        ? classes.flatMap((c) => getStreamsForClass(c.id)).find((s) => s.id === (a.audienceIds || [])[0])?.name
                        : null;
                    return `
                    <div style="padding:0.9rem 1rem; border-bottom:1px solid var(--ink-50);">
                      <div class="flex justify-between items-start gap-3">
                        <div>
                          <p class="text-sm" style="font-weight:500;">${escapeHtml(a.title)}</p>
                          <p class="text-sm text-ink-600 mt-1">${escapeHtml(a.body)}</p>
                        </div>
                        <div class="flex gap-3"><button data-edit-announcement="${escapeHtml(a.id)}" class="btn-ghost btn-sm">Edit</button><button data-remove="${escapeHtml(a.id)}" class="btn-ghost btn-sm text-bad">Delete</button></div>
                      </div>
                      <p class="text-xs text-ink-400 mt-2">To: ${escapeHtml(AUDIENCE_LABEL[a.audience] ?? a.audience)}${target ? ` (${escapeHtml(target)})` : ''} · ${escapeHtml(a.createdAt.slice(0, 10))}</p>
                    </div>
                  `;
                  })
                  .join('')}
              </div>`
        }
      </div>
    `;

    qs(container, '#new-announcement-btn').addEventListener('click', () => { state.formOpen = true; render(); });
    const emptyBtn = qs(container, '#empty-new-btn');
    if (emptyBtn) emptyBtn.addEventListener('click', () => { state.formOpen = true; render(); });

    if (state.formOpen) wireForm();

    on(container, '[data-edit-announcement]', 'click', (e) => {
      const announcement = announcements.find((item) => item.id === e.currentTarget.getAttribute('data-edit-announcement'));
      if (!announcement) return;
      const targetId = announcement.audienceIds?.[0] ?? '';
      const targetStream = classes.flatMap((schoolClass) => getStreamsForClass(schoolClass.id)).find((stream) => stream.id === targetId);
      Object.assign(state, { formOpen: true, editId: announcement.id, title: announcement.title, body: announcement.body, audience: announcement.audience, classId: announcement.audience === 'class' ? targetId : (targetStream?.classId ?? ''), streamId: announcement.audience === 'stream' ? targetId : '' });
      render();
    });
    on(container, '[data-remove]', 'click', (e) => {
      if (!confirm('Delete this announcement permanently?')) return;
      announcementRepo.remove(e.currentTarget.getAttribute('data-remove'), 'removed announcement');
      render();
    });
  }

  function formHtml() {
    const streams = state.classId ? getStreamsForClass(state.classId) : [];
    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editId ? 'Edit announcement' : 'New announcement'}</h3>
        <div>
          <label class="label">Title</label>
          <input class="input" id="ann-title" value="${escapeHtml(state.title)}" placeholder="e.g. Half-term break dates" />
        </div>
        <div>
          <label class="label">Message</label>
          <textarea class="input" id="ann-body" rows="3">${escapeHtml(state.body)}</textarea>
        </div>
        <div class="grid sm-grid-3 gap-4">
          <div>
            <label class="label">Audience</label>
            <select class="input" id="ann-audience">
              ${AUDIENCES.map(([v, label]) => `<option value="${v}" ${state.audience === v ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
            </select>
          </div>
          ${
            state.audience === 'class' || state.audience === 'stream'
              ? `<div>
                  <label class="label">Class</label>
                  <select class="input" id="ann-class">
                    ${classes.map((c) => `<option value="${c.id}" ${state.classId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
                  </select>
                </div>`
              : ''
          }
          ${
            state.audience === 'stream'
              ? `<div>
                  <label class="label">Stream</label>
                  <select class="input" id="ann-stream" ${streams.length === 0 ? 'disabled' : ''}>
                    ${streams.length === 0 ? '<option>No streams for this class</option>' : streams.map((s) => `<option value="${s.id}" ${state.streamId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
                  </select>
                </div>`
              : ''
          }
        </div>
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-ann-btn">Cancel</button>
          <button class="btn-primary" id="save-ann-btn">${state.editId ? 'Save changes' : 'Send'}</button>
        </div>
      </div>
    `;
  }

  function wireForm() {
    // Selects with no blank placeholder auto-select their first option
    // visually, so state must match that default or Send can silently use
    // an empty target.
    if ((state.audience === 'class' || state.audience === 'stream') && !classes.some((schoolClass) => schoolClass.id === state.classId) && classes.length > 0) {
      state.classId = classes[0].id;
    }
    if (state.audience === 'stream' && !getStreamsForClass(state.classId).some((stream) => stream.id === state.streamId)) {
      const streams = getStreamsForClass(state.classId);
      if (streams.length > 0) state.streamId = streams[0].id;
    }

    qs(container, '#ann-title').addEventListener('input', (e) => (state.title = e.target.value));
    qs(container, '#ann-body').addEventListener('input', (e) => (state.body = e.target.value));
    qs(container, '#ann-audience').addEventListener('change', (e) => {
      state.audience = e.target.value;
      state.classId = '';
      state.streamId = '';
      render();
    });
    const classSelect = qs(container, '#ann-class');
    if (classSelect) classSelect.addEventListener('change', (e) => {
      state.classId = e.target.value;
      state.streamId = '';
      render();
    });
    const streamSelect = qs(container, '#ann-stream');
    if (streamSelect) streamSelect.addEventListener('change', (e) => (state.streamId = e.target.value));
    qs(container, '#cancel-ann-btn').addEventListener('click', () => { Object.assign(state, { formOpen: false, editId: '', title: '', body: '' }); render(); });
    qs(container, '#save-ann-btn').addEventListener('click', () => {
      if (!state.title.trim() || !state.body.trim()) return;
      const audienceIds = state.audience === 'class' ? [state.classId] : state.audience === 'stream' ? [state.streamId] : [];
      const details = { title: state.title.trim(), body: state.body.trim(), audience: state.audience, audienceIds };
      if (state.editId) announcementRepo.update(state.editId, details, 'updated announcement');
      else announcementRepo.create(details);
      Object.assign(state, { title: '', body: '', formOpen: false, editId: '' });
      render();
    });
  }

  render();
}

function renderRemoteAnnouncements(container) {
  const state = { data: null, formOpen: false, editId: '', title: '', body: '', audience: 'school', classId: '', streamId: '', error: '' };
  const announcementsRepo = new SupabaseRepository('announcements');

  async function render() {
    try {
      state.data ??= await loadCommunicationWorkspace();
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="announcements-retry">Retry</button></div>`;
      qs(container, '#announcements-retry').addEventListener('click', () => { state.data = null; state.error = ''; render(); });
      return;
    }
    const classes = state.data.classes;
    const classById = Object.fromEntries(classes.map((schoolClass) => [schoolClass.id, schoolClass]));
    const streamById = Object.fromEntries(state.data.streams.map((stream) => [stream.id, stream]));
    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center"><p class="text-sm text-ink-500">Post an update for the whole school, a class, or a specific group.</p><button class="btn-primary" id="new-announcement-btn">+ Send Announcement</button></div>
        ${state.formOpen ? formHtml(classes) : ''}
        ${state.data.announcements.length === 0
          ? `<div class="card">${emptyState({ iconHtml: icons.megaphone(40), title: 'No announcements yet', actionsHtml: `<button class="btn-primary" id="empty-new-btn">+ Send Announcement</button>` })}</div>`
          : `<div class="card" style="overflow:hidden;">${state.data.announcements.map((announcement) => {
            const targetId = (announcement.audienceIds ?? [])[0];
            const target = announcement.audience === 'class'
              ? classById[targetId]?.name
              : announcement.audience === 'stream' ? streamById[targetId]?.name : null;
            return `<div style="padding:0.9rem 1rem;border-bottom:1px solid var(--ink-50);"><div class="flex justify-between items-start gap-3"><div><p class="text-sm" style="font-weight:500;">${escapeHtml(announcement.title)}</p><p class="text-sm text-ink-600 mt-1">${escapeHtml(announcement.body)}</p></div><div class="flex gap-3"><button data-edit-announcement="${escapeHtml(announcement.id)}" class="btn-ghost btn-sm">Edit</button><button data-remove="${escapeHtml(announcement.id)}" class="btn-ghost btn-sm text-bad">Delete</button></div></div><p class="text-xs text-ink-400 mt-2">To: ${escapeHtml(AUDIENCE_LABEL[announcement.audience] ?? announcement.audience)}${target ? ` (${escapeHtml(target)})` : ''} · ${escapeHtml(announcement.createdAt.slice(0, 10))}</p></div>`;
          }).join('')}</div>`}
      </div>`;

    qs(container, '#new-announcement-btn').addEventListener('click', () => { state.formOpen = true; render(); });
    const emptyButton = qs(container, '#empty-new-btn');
    if (emptyButton) emptyButton.addEventListener('click', () => { state.formOpen = true; render(); });
    if (state.formOpen) wireForm(classes);
    on(container, '[data-edit-announcement]', 'click', (event) => {
      const announcement = state.data.announcements.find((item) => item.id === event.currentTarget.getAttribute('data-edit-announcement'));
      if (!announcement) return;
      const targetId = announcement.audienceIds?.[0] ?? '';
      const targetStream = state.data.streams.find((stream) => stream.id === targetId);
      Object.assign(state, { formOpen: true, editId: announcement.id, title: announcement.title, body: announcement.body, audience: announcement.audience, classId: announcement.audience === 'class' ? targetId : (targetStream?.classId ?? ''), streamId: announcement.audience === 'stream' ? targetId : '' });
      render();
    });
    on(container, '[data-remove]', 'click', async (event) => {
      if (!confirm('Delete this announcement permanently?')) return;
      try {
        await removeRemoteAnnouncement(event.currentTarget.getAttribute('data-remove'));
        state.data = null;
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
  }

  function formHtml(classes) {
    const streams = state.data.streams.filter((stream) => stream.classId === state.classId);
    return `<div class="card card-p space-y-4"><h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editId ? 'Edit announcement' : 'New announcement'}</h3>
      <div><label class="label">Title</label><input class="input" id="ann-title" value="${escapeHtml(state.title)}" placeholder="e.g. Half-term break dates" /></div>
      <div><label class="label">Message</label><textarea class="input" id="ann-body" rows="3">${escapeHtml(state.body)}</textarea></div>
      <div class="grid sm-grid-3 gap-4"><div><label class="label">Audience</label><select class="input" id="ann-audience">${AUDIENCES.map(([value, label]) => `<option value="${value}" ${state.audience === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></div>
      ${state.audience === 'class' || state.audience === 'stream' ? `<div><label class="label">Class</label><select class="input" id="ann-class">${classes.map((schoolClass) => `<option value="${schoolClass.id}" ${state.classId === schoolClass.id ? 'selected' : ''}>${escapeHtml(schoolClass.name)}</option>`).join('')}</select></div>` : ''}
      ${state.audience === 'stream' ? `<div><label class="label">Stream</label><select class="input" id="ann-stream" ${streams.length === 0 ? 'disabled' : ''}>${streams.length ? streams.map((stream) => `<option value="${stream.id}" ${state.streamId === stream.id ? 'selected' : ''}>${escapeHtml(stream.name)}</option>`).join('') : '<option>No streams for this class</option>'}</select></div>` : ''}</div>
      <div class="flex justify-end gap-3"><button class="btn-secondary" id="cancel-ann-btn">Cancel</button><button class="btn-primary" id="save-ann-btn">${state.editId ? 'Save changes' : 'Send'}</button></div></div>`;
  }

  function wireForm(classes) {
    if ((state.audience === 'class' || state.audience === 'stream') && !classes.some((schoolClass) => schoolClass.id === state.classId) && classes.length) state.classId = classes[0].id;
    const streams = state.data.streams.filter((stream) => stream.classId === state.classId);
    if (state.audience === 'stream' && !streams.some((stream) => stream.id === state.streamId) && streams.length) state.streamId = streams[0].id;
    qs(container, '#ann-title').addEventListener('input', (event) => { state.title = event.target.value; });
    qs(container, '#ann-body').addEventListener('input', (event) => { state.body = event.target.value; });
    qs(container, '#ann-audience').addEventListener('change', (event) => { state.audience = event.target.value; state.classId = ''; state.streamId = ''; render(); });
    const classSelect = qs(container, '#ann-class');
    if (classSelect) classSelect.addEventListener('change', (event) => { state.classId = event.target.value; state.streamId = ''; render(); });
    const streamSelect = qs(container, '#ann-stream');
    if (streamSelect) streamSelect.addEventListener('change', (event) => { state.streamId = event.target.value; });
    qs(container, '#cancel-ann-btn').addEventListener('click', () => { Object.assign(state, { formOpen: false, editId: '', title: '', body: '' }); render(); });
    qs(container, '#save-ann-btn').addEventListener('click', async () => {
      if (!state.title.trim() || !state.body.trim()) return;
      const audienceIds = state.audience === 'class' ? [state.classId] : state.audience === 'stream' ? [state.streamId] : [];
      try {
        const details = { title: state.title.trim(), body: state.body.trim(), audience: state.audience, audienceIds };
        if (state.editId) await announcementsRepo.update(state.editId, details);
        else await createRemoteAnnouncement(details);
        state.title = '';
        state.body = '';
        state.formOpen = false;
        state.editId = '';
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
