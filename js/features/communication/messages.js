import { escapeHtml, qs } from '../../components/dom.js';
import { messageRepo, getMessages, RECIPIENT_TYPES } from '../../services/communicationService.js';
import { parentRepo, parentFullName, teacherRepo, teacherFullName } from '../../services/peopleService.js';
import { studentRepo, fullName } from '../../services/studentService.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { createRemoteMessage, loadCommunicationWorkspace, remoteRecipients } from '../../services/supabaseCommunicationService.js';
import { SupabaseRepository } from '../../storage/SupabaseRepository.js';

const RECIPIENT_LABEL = Object.fromEntries(RECIPIENT_TYPES);

function recipientsFor(type) {
  if (type === 'parent') return parentRepo.getAll().map((p) => ({ id: p.id, name: parentFullName(p) }));
  if (type === 'teacher') return teacherRepo.getAll().map((t) => ({ id: t.id, name: teacherFullName(t) }));
  return studentRepo.getAll().filter((s) => s.status === 'active').map((s) => ({ id: s.id, name: fullName(s) }));
}

export function renderMessages(container) {
  if (isSupabaseConfigured()) return renderRemoteMessages(container);
  const state = { formOpen: false, editId: '', recipientType: 'parent', recipientId: '', subject: '', body: '' };

  function render() {
    const messages = getMessages();

    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center">
          <p class="text-sm text-ink-500">Send a direct message to a parent, teacher, or student. Messages are saved in the app; they aren’t sent by email or SMS.</p>
          <button class="btn-primary" id="new-message-btn">+ New message</button>
        </div>

        ${state.formOpen ? formHtml() : ''}

        ${
          messages.length === 0
            ? `<div class="card">${emptyState({ iconHtml: icons.megaphone(40), title: 'No messages yet', actionsHtml: `<button class="btn-primary" id="empty-new-btn">+ New message</button>` })}</div>`
            : `<div class="card" style="overflow:hidden;">
                ${messages
                  .map(
                    (m) => `
                  <div style="padding:0.9rem 1rem; border-bottom:1px solid var(--ink-50);">
                    <p class="text-sm" style="font-weight:500;">${escapeHtml(m.subject)}</p>
                    <p class="text-sm text-ink-600 mt-1">${escapeHtml(m.body)}</p>
                    <p class="text-xs text-ink-400 mt-2">To: ${escapeHtml(m.recipientName)} (${escapeHtml(RECIPIENT_LABEL[m.recipientType] ?? m.recipientType)}) · ${escapeHtml(m.createdAt.slice(0, 10))}</p>
                    <div class="flex gap-3 mt-2"><button class="btn-ghost btn-sm" data-edit-message="${escapeHtml(m.id)}">Edit</button><button class="btn-ghost btn-sm text-bad" data-delete-message="${escapeHtml(m.id)}">Delete</button></div>
                  </div>
                `
                  )
                  .join('')}
              </div>`
        }
      </div>
    `;

    qs(container, '#new-message-btn').addEventListener('click', () => { state.formOpen = true; render(); });
    const emptyBtn = qs(container, '#empty-new-btn');
    if (emptyBtn) emptyBtn.addEventListener('click', () => { state.formOpen = true; render(); });

    if (state.formOpen) wireForm();
    on(container, '[data-edit-message]', 'click', (event) => {
      const message = messages.find((item) => item.id === event.currentTarget.getAttribute('data-edit-message'));
      if (!message) return;
      Object.assign(state, { formOpen: true, editId: message.id, recipientType: message.recipientType, recipientId: message.recipientId, subject: message.subject, body: message.body });
      render();
    });
    on(container, '[data-delete-message]', 'click', (event) => {
      const id = event.currentTarget.getAttribute('data-delete-message');
      if (!confirm('Delete this message permanently?')) return;
      messageRepo.remove(id, 'deleted message');
      render();
    });
  }

  function formHtml() {
    const recipients = recipientsFor(state.recipientType);
    // No blank placeholder in the recipient <select>, so default state to
    // match the browser's own visual default (the first option).
    if (!recipients.some((recipient) => recipient.id === state.recipientId)) state.recipientId = recipients[0]?.id ?? '';

    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editId ? 'Edit message' : 'New message'}</h3>
        <div class="grid sm-grid-2 gap-4">
          <div>
            <label class="label">Send to</label>
            <select class="input" id="msg-recipient-type">
              ${RECIPIENT_TYPES.map(([v, label]) => `<option value="${v}" ${state.recipientType === v ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="label">Recipient</label>
            <select class="input" id="msg-recipient" ${recipients.length === 0 ? 'disabled' : ''}>
              ${recipients.length === 0 ? '<option>None available</option>' : recipients.map((r) => `<option value="${r.id}" ${state.recipientId === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div>
          <label class="label">Subject</label>
          <input class="input" id="msg-subject" value="${escapeHtml(state.subject)}" />
        </div>
        <div>
          <label class="label">Message</label>
          <textarea class="input" id="msg-body" rows="3">${escapeHtml(state.body)}</textarea>
        </div>
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-msg-btn">Cancel</button>
          <button class="btn-primary" id="save-msg-btn" ${recipients.length === 0 ? 'disabled' : ''}>${state.editId ? 'Save changes' : 'Send'}</button>
        </div>
      </div>
    `;
  }

  function wireForm() {
    qs(container, '#msg-recipient-type').addEventListener('change', (e) => {
      state.recipientType = e.target.value;
      state.recipientId = '';
      render();
    });
    const recipientSelect = qs(container, '#msg-recipient');
    if (recipientSelect) recipientSelect.addEventListener('change', (e) => (state.recipientId = e.target.value));
    qs(container, '#msg-subject').addEventListener('input', (e) => (state.subject = e.target.value));
    qs(container, '#msg-body').addEventListener('input', (e) => (state.body = e.target.value));
    qs(container, '#cancel-msg-btn').addEventListener('click', () => { Object.assign(state, { formOpen: false, editId: '', subject: '', body: '' }); render(); });
    qs(container, '#save-msg-btn').addEventListener('click', () => {
      if (!state.recipientId || !state.subject.trim() || !state.body.trim()) return;
      const recipients = recipientsFor(state.recipientType);
      const recipient = recipients.find((r) => r.id === state.recipientId);
      if (!recipient) return;
      const details = {
        recipientType: state.recipientType,
        recipientId: state.recipientId,
        recipientName: recipient.name,
        subject: state.subject.trim(),
        body: state.body.trim(),
      };
      if (state.editId) messageRepo.update(state.editId, details, 'updated message');
      else messageRepo.create(details);
      Object.assign(state, { subject: '', body: '', formOpen: false, editId: '' });
      render();
    });
  }

  render();
}

function renderRemoteMessages(container) {
  const state = { data: null, formOpen: false, editId: '', recipientType: 'parent', recipientId: '', subject: '', body: '', error: '' };
  const messageRepo = new SupabaseRepository('messages');

  async function render() {
    try {
      state.data ??= await loadCommunicationWorkspace();
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="messages-retry">Retry</button></div>`;
      qs(container, '#messages-retry').addEventListener('click', () => { state.data = null; state.error = ''; render(); });
      return;
    }
    const messages = state.data.messages;
    const recipients = remoteRecipients(state.data, state.recipientType);
    state.recipientId = recipients.some((recipient) => recipient.id === state.recipientId) ? state.recipientId : (recipients[0]?.id ?? '');
    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center"><p class="text-sm text-ink-500">Messages are stored in this school's workspace. External delivery is not configured.</p><button class="btn-primary" id="new-message-btn">+ New message</button></div>
        ${state.formOpen ? formHtml(recipients) : ''}
        ${messages.length === 0 ? `<div class="card">${emptyState({ iconHtml: icons.megaphone(40), title: 'No messages yet', actionsHtml: `<button class="btn-primary" id="empty-new-btn">+ New message</button>` })}</div>` : `<div class="card" style="overflow:hidden;">${messages.map((message) => `<div style="padding:0.9rem 1rem;border-bottom:1px solid var(--ink-50);"><p class="text-sm" style="font-weight:500;">${escapeHtml(message.subject)}</p><p class="text-sm text-ink-600 mt-1">${escapeHtml(message.body)}</p><p class="text-xs text-ink-400 mt-2">To: ${escapeHtml(message.recipientName)} (${escapeHtml(RECIPIENT_LABEL[message.recipientType] ?? message.recipientType)}) · ${escapeHtml(message.createdAt.slice(0, 10))}</p><div class="flex gap-3 mt-2"><button class="btn-ghost btn-sm" data-edit-message="${escapeHtml(message.id)}">Edit</button><button class="btn-ghost btn-sm text-bad" data-delete-message="${escapeHtml(message.id)}">Delete</button></div></div>`).join('')}</div>`}
      </div>`;

    qs(container, '#new-message-btn').addEventListener('click', () => { state.formOpen = true; render(); });
    const emptyButton = qs(container, '#empty-new-btn');
    if (emptyButton) emptyButton.addEventListener('click', () => { state.formOpen = true; render(); });
    if (state.formOpen) wireForm(recipients);
    on(container, '[data-edit-message]', 'click', (event) => {
      const message = messages.find((item) => item.id === event.currentTarget.getAttribute('data-edit-message'));
      if (!message) return;
      Object.assign(state, { formOpen: true, editId: message.id, recipientType: message.recipientType, recipientId: message.recipientId, subject: message.subject, body: message.body });
      render();
    });
    on(container, '[data-delete-message]', 'click', async (event) => {
      if (!confirm('Delete this message permanently?')) return;
      try { await messageRepo.remove(event.currentTarget.getAttribute('data-delete-message')); state.data = null; state.error = ''; }
      catch (error) { state.error = error.message; }
      await render();
    });
  }

  function formHtml(recipients) {
    return `<div class="card card-p space-y-4"><h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editId ? 'Edit message' : 'New message'}</h3>
      <div class="grid sm-grid-2 gap-4"><div><label class="label">Send to</label><select class="input" id="msg-recipient-type">${RECIPIENT_TYPES.map(([value, label]) => `<option value="${value}" ${state.recipientType === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></div><div><label class="label">Recipient</label><select class="input" id="msg-recipient" ${recipients.length === 0 ? 'disabled' : ''}>${recipients.length === 0 ? '<option>None available</option>' : recipients.map((recipient) => `<option value="${recipient.id}" ${state.recipientId === recipient.id ? 'selected' : ''}>${escapeHtml(recipient.name)}</option>`).join('')}</select></div></div>
      <div><label class="label">Subject</label><input class="input" id="msg-subject" value="${escapeHtml(state.subject)}" /></div><div><label class="label">Message</label><textarea class="input" id="msg-body" rows="3">${escapeHtml(state.body)}</textarea></div>
      <div class="flex justify-end gap-3"><button class="btn-secondary" id="cancel-msg-btn">Cancel</button><button class="btn-primary" id="save-msg-btn" ${recipients.length === 0 ? 'disabled' : ''}>${state.editId ? 'Save changes' : 'Save message'}</button></div></div>`;
  }

  function wireForm(recipients) {
    qs(container, '#msg-recipient-type').addEventListener('change', (event) => { state.recipientType = event.target.value; state.recipientId = ''; render(); });
    qs(container, '#msg-recipient').addEventListener('change', (event) => { state.recipientId = event.target.value; });
    qs(container, '#msg-subject').addEventListener('input', (event) => { state.subject = event.target.value; });
    qs(container, '#msg-body').addEventListener('input', (event) => { state.body = event.target.value; });
    qs(container, '#cancel-msg-btn').addEventListener('click', () => { Object.assign(state, { formOpen: false, editId: '', subject: '', body: '' }); render(); });
    qs(container, '#save-msg-btn').addEventListener('click', async () => {
      if (!state.recipientId || !state.subject.trim() || !state.body.trim()) return;
      const recipient = recipients.find((person) => person.id === state.recipientId);
      if (!recipient) return;
      try {
        const details = { recipientType: state.recipientType, recipientId: state.recipientId, recipientName: recipient.name, subject: state.subject.trim(), body: state.body.trim() };
        if (state.editId) await messageRepo.update(state.editId, details);
        else await createRemoteMessage(details);
        state.subject = '';
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
