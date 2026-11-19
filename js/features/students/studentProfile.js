import { escapeHtml, on, qs } from '../../components/dom.js';
import { studentRepo, fullName } from '../../services/studentService.js';
import { classesSortedByOrder, streamRepo } from '../../services/academicService.js';
import { parentRepo, parentFullName } from '../../services/peopleService.js';
import { emptyState } from '../../components/emptyState.js';
import { openStudentForm } from './studentForm.js';
import { getDocumentsForStudent, downloadDocument, formatBytes } from '../../services/documentService.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { SupabaseRepository } from '../../storage/SupabaseRepository.js';
import { supabaseStudentRepo } from '../../services/studentService.js';
import { downloadRemoteDocument } from '../../services/documentService.js';
import { listParentAccess, inviteParent, revokeParentAccess } from '../../services/supabaseParentService.js';
import { formatInviteCode } from '../../services/supabaseTeamService.js';
import { getCurrentRole } from '../../services/accessService.js';
import { profileTabHtml } from './profileTabs.js';

const TABS = ['Overview', 'Academics', 'Attendance', 'Finance', 'Discipline', 'Health', 'Transport', 'Activities', 'Competencies', 'Documents'];

export function renderStudentProfile(container, params) {
  const id = params.id;
  const remote = isSupabaseConfigured();
  let activeTab = 'Overview';
  // Parent portal access (cloud mode; administrators and registrars only)
  const canManagePortal = remote && ['school_admin', 'registrar'].includes(getCurrentRole() ?? 'school_admin');
  let parentAccess = [];
  let currentParents = [];
  const portal = { fresh: null, error: '' };

  async function render() {
    let student;
    let classes;
    let streams;
    let parents;
    let remoteDocuments = [];
    try {
      [student, classes, streams, parents, remoteDocuments] = remote
        ? await Promise.all([
            supabaseStudentRepo.getById(id),
            new SupabaseRepository('classes').getAll(),
            new SupabaseRepository('streams').getAll(),
            new SupabaseRepository('parents').getAll(),
            new SupabaseRepository('documents').getAll(),
          ])
        : [studentRepo.getById(id), classesSortedByOrder(), streamRepo.getAll(), parentRepo.getAll(), []];
    } catch (error) {
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span><button class="btn-secondary btn-sm" id="profile-retry">Retry</button></div>`;
      qs(container, '#profile-retry').addEventListener('click', render);
      return;
    }
    if (!student) {
      container.innerHTML = `<div class="card">${emptyState({ title: 'Student not found', body: 'This student may have been archived or removed.', actionsHtml: `<button class="btn-secondary" id="back-btn">Back to students</button>` })}</div>`;
      qs(container, '#back-btn').addEventListener('click', () => (window.location.hash = '/students'));
      return;
    }

    if (canManagePortal) { try { parentAccess = await listParentAccess(); } catch { parentAccess = []; } }
    const classById = Object.fromEntries(classes.map((c) => [c.id, c]));
    const streamById = Object.fromEntries(streams.map((s) => [s.id, s]));
    const parentById = Object.fromEntries(parents.map((parent) => [parent.id, parent]));
    const linkedParents = (student.parentIds ?? []).map((parentId) => parentById[parentId]).filter(Boolean);
    currentParents = linkedParents;

    container.innerHTML = `
      <div class="space-y-5">
        <button class="text-sm text-ink-500" id="back-btn" style="background:none;border:none;cursor:pointer;font-family:inherit;">← Back to students</button>

        <div class="card card-p flex sm-flex-row items-center gap-4" style="flex-direction:column;">
          <div class="avatar" style="height:4rem;width:4rem;font-size:1.25rem;">${escapeHtml(student.firstName.charAt(0))}${escapeHtml(student.lastName.charAt(0))}</div>
          <div class="flex-1">
            <h1 class="text-xl" style="font-weight:600;">${escapeHtml(fullName(student))}</h1>
            <p class="text-sm text-ink-500 mt-1">${escapeHtml(student.admissionNumber)} · ${escapeHtml(classById[student.classId ?? '']?.name ?? 'No class')}${student.streamId ? ` ${escapeHtml(streamById[student.streamId]?.name ?? '')}` : ''}</p>
          </div>
          <span class="badge badge-good capitalize">${escapeHtml(student.status)}</span>
          <button class="btn-secondary" id="edit-btn">Edit</button>
        </div>

        <div class="tabs">
          ${TABS.map((t) => `<button class="tab-btn ${t === activeTab ? 'active' : ''}" data-tab="${t}">${escapeHtml(t)}</button>`).join('')}
        </div>

        <div id="tab-content"></div>
      </div>
    `;

    qs(container, '#back-btn').addEventListener('click', () => (window.location.hash = '/students'));
    qs(container, '#edit-btn').addEventListener('click', () => openStudentForm({
      student,
      onSaved: async () => render(),
    }));
    on(container, '[data-tab]', 'click', (e) => {
      activeTab = e.currentTarget.getAttribute('data-tab');
      render();
    });

    const tabContent = qs(container, '#tab-content');
    if (activeTab === 'Overview') {
      tabContent.innerHTML = `
        <div class="grid sm-grid-2 gap-4">
          <div class="card card-p">
            <h3 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Student details</h3>
            <dl class="text-sm">
              ${detailRow('Date of birth', student.dateOfBirth || '—')}
              ${detailRow('Gender', student.gender ?? '—')}
              ${detailRow('Admission date', student.admissionDate)}
              ${detailRow('Day / Boarding', student.boardingStatus)}
              ${detailRow('House', student.house || '—')}
              ${detailRow('Transport', student.usesTransport ? 'Yes' : 'No')}
            </dl>
          </div>
          <div class="card card-p">
            <h3 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Parent / Guardian</h3>
            ${
              linkedParents.length === 0
                ? `<p class="text-sm text-ink-400">No parent linked yet.</p>`
                : `<ul style="list-style:none;margin:0;padding:0;" class="text-sm space-y-2">
                    ${linkedParents
                      .map((p) => `<li><p style="font-weight:500;color:var(--ink-800);">${escapeHtml(parentFullName(p))}</p><p class="text-ink-500">${escapeHtml(p.phone || p.email || 'No contact on file')}</p>${canManagePortal ? portalHtml(p) : ''}</li>`)
                      .join('')}
                  </ul>`
            }
          </div>
        </div>
      `;
      wirePortal(tabContent);
    } else if (activeTab === 'Documents') {
      const docs = remote
        ? remoteDocuments.filter((document) => document.relatedStudentId === student.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        : getDocumentsForStudent(student.id);
      tabContent.innerHTML =
        docs.length === 0
          ? `<div class="card">${emptyState({
              title: 'No documents for this student yet',
              body: 'Upload a document from the Documents page and link it to this student.',
            })}</div>`
          : `<div class="card" style="overflow:hidden;">
              ${docs
                .map(
                  (d) => `<div class="flex justify-between items-center" style="padding:0.8rem 1rem; border-bottom:1px solid var(--ink-50);">
                    <div>
                      <p class="text-sm" style="font-weight:500;">${escapeHtml(d.name)}</p>
                      <p class="text-xs text-ink-500 mt-1">${escapeHtml(d.createdAt.slice(0, 10))} · ${escapeHtml(formatBytes(d.size || 0))}</p>
                    </div>
                    <button data-download-doc="${d.id}" class="text-brand-700" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;">Download</button>
                  </div>`
                )
                .join('')}
            </div>`;
      on(tabContent, '[data-download-doc]', 'click', async (e) => {
        const documentId = e.currentTarget.getAttribute('data-download-doc');
        if (remote) {
          const document = docs.find((item) => item.id === documentId);
          try { await downloadRemoteDocument(document); }
          catch (error) { tabContent.insertAdjacentHTML('afterbegin', `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span></div>`); }
        } else downloadDocument(documentId);
      });
    } else if (remote) {
      tabContent.innerHTML = `<div class="card card-p"><p class="text-sm text-ink-500">${escapeHtml(activeTab)} for this learner is shown in demo mode for now. The cloud version arrives with the backend phase.</p></div>`;
    } else {
      const tab = activeTab;
      tabContent.innerHTML = '<div class="card card-p"><p class="text-sm text-ink-500" role="status">Loading…</p></div>';
      profileTabHtml(tab, student).then((html) => { if (activeTab === tab) tabContent.innerHTML = html; }).catch((error) => { tabContent.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span></div>`; });
    }
  }

  const portalMessage = (name, email, code) => `Hello ${name}, you can now follow your child's report cards, fees and timetable online. Open ${window.location.origin}${window.location.pathname}#/join , sign up with ${email} and enter this code: ${formatInviteCode(code)}`;

  function portalHtml(p) {
    const access = parentAccess.find((a) => a.parentId === p.id);
    const fresh = portal.fresh?.parentId === p.id ? portal.fresh : null;
    const box = (inner) => `<div class="mt-2" style="border:1px solid var(--ink-100);border-radius:0.5rem;padding:0.5rem 0.7rem;">${inner}</div>`;
    if (fresh) {
      return box(`<p class="text-xs" style="color:var(--good,#2e7d4f);font-weight:600;">Invitation created</p>
        <p class="text-sm mt-1">Send ${escapeHtml(parentFullName(p))} this code: <code style="letter-spacing:0.06em;">${escapeHtml(formatInviteCode(fresh.code))}</code></p>
        <p class="text-xs text-ink-500">They open the site, choose “Join with your invitation code”, and sign up with <b>${escapeHtml(fresh.email)}</b>.</p>
        <button class="btn-secondary btn-sm mt-2" data-portal-copy="${escapeHtml(p.id)}" data-code="${escapeHtml(fresh.code)}" data-email="${escapeHtml(fresh.email)}">Copy message</button>`);
    }
    if (access?.status === 'active') {
      return box(`<p class="text-xs"><span style="color:var(--good,#2e7d4f);font-weight:600;">Portal access active</span> · ${escapeHtml(access.email)}</p><button class="text-bad text-xs" data-portal-revoke="${escapeHtml(p.id)}" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;padding:0;">Remove access</button>`);
    }
    if (access?.status === 'invited') {
      return box(`<p class="text-xs">Invitation sent to ${escapeHtml(access.email)} · code <code>${escapeHtml(formatInviteCode(access.code))}</code>${access.expired ? ' <span class="text-bad">(expired — invite again)</span>' : ''}</p>
        <button class="btn-secondary btn-sm mt-1" data-portal-copy="${escapeHtml(p.id)}" data-code="${escapeHtml(access.code)}" data-email="${escapeHtml(access.email)}">Copy message</button>
        <button class="text-bad text-xs" data-portal-revoke="${escapeHtml(p.id)}" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;margin-left:0.5rem;">Cancel</button>`);
    }
    return box(`<div class="flex gap-2 items-center flex-wrap"><input class="input" type="email" data-portal-email="${escapeHtml(p.id)}" placeholder="Parent's email" value="${escapeHtml(p.email ?? '')}" style="flex:1;min-width:11rem;" aria-label="Parent's email" /><button class="btn-secondary btn-sm" data-portal-invite="${escapeHtml(p.id)}">Invite to parent portal</button></div>`);
  }

  function wirePortal(tabContent) {
    if (portal.error) tabContent.insertAdjacentHTML('afterbegin', `<div class="notice" role="alert"><span>${escapeHtml(portal.error)}</span></div>`);
    on(tabContent, '[data-portal-invite]', 'click', async (e) => {
      const parentId = e.currentTarget.getAttribute('data-portal-invite');
      const email = qs(tabContent, `[data-portal-email="${parentId}"]`).value.trim();
      portal.error = '';
      try {
        const result = await inviteParent(parentId, email);
        portal.fresh = { parentId, email: result.email, code: result.code };
      } catch (error) { portal.error = error.message; }
      render();
    });
    on(tabContent, '[data-portal-revoke]', 'click', async (e) => {
      if (!confirm('Remove this parent’s portal access?')) return;
      portal.error = ''; portal.fresh = null;
      try { await revokeParentAccess(e.currentTarget.getAttribute('data-portal-revoke')); } catch (error) { portal.error = error.message; }
      render();
    });
    on(tabContent, '[data-portal-copy]', 'click', async (e) => {
      const b = e.currentTarget;
      const parent = currentParents.find((p) => p.id === b.getAttribute('data-portal-copy'));
      const message = portalMessage(parent ? parentFullName(parent) : 'there', b.getAttribute('data-email'), b.getAttribute('data-code'));
      try { await navigator.clipboard.writeText(message); b.textContent = 'Copied'; } catch { b.textContent = 'Select and copy manually'; }
    });
  }

  function detailRow(label, value) {
    return `<div class="flex justify-between capitalize" style="padding:0.4rem 0;"><dt class="text-ink-500">${escapeHtml(label)}</dt><dd style="font-weight:500;color:var(--ink-800);">${escapeHtml(value)}</dd></div>`;
  }

  render();
}
