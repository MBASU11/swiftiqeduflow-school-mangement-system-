import { escapeHtml, on, qs } from '../../components/dom.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { ROLES, ASSIGNABLE_ROLES, MODULE_ACCESS } from '../../config/roles.js';
import { listTeam, createStaffAccount, setStaffRole, removeStaffAccount, resetStaffPassword } from '../../services/authService.js';
import {
  loadRemoteTeam, inviteRemoteMember, revokeRemoteInvite, setRemoteMemberRole, removeRemoteMember, formatInviteCode,
} from '../../services/supabaseTeamService.js';

const MODULE_LABELS = {
  dashboard: 'Dashboard', students: 'Students', admissions: 'Admissions', academics: 'Academics', attendance: 'Attendance',
  timetable: 'Timetable', exams: 'Exams & assessments', finance: 'Finance', communication: 'Communication', reports: 'Reports',
  transport: 'Transport', library: 'Library', inventory: 'Inventory', discipline: 'Discipline', activities: 'Activities', hostel: 'Hostel', health: 'Health', staff: 'Staff', documents: 'Documents',
  data: 'Import & Export', settings: 'Settings & team',
};

function accessSummary(role) {
  const entries = Object.entries(MODULE_ACCESS[role] ?? {});
  const write = entries.filter(([, a]) => a === 'write').map(([m]) => MODULE_LABELS[m]).filter(Boolean);
  const read = entries.filter(([, a]) => a === 'read').map(([m]) => MODULE_LABELS[m]).filter(Boolean);
  if (role === 'school_admin') return 'Everything';
  return `${write.length ? `Can use & change: ${write.join(', ')}. ` : ''}${read.length ? `Can view: ${read.join(', ')}.` : ''}`;
}

const tempPassword = () => `${['Blue', 'Green', 'Swift', 'Bright', 'Lion'][Math.floor(Math.random() * 5)]}${Math.floor(1000 + Math.random() * 9000)}${['!', '#', '*'][Math.floor(Math.random() * 3)]}`;

// Administrators only. Adds colleagues and decides what each can see and change.
export function renderTeamAccess(container) {
  const remote = isSupabaseConfigured();
  const state = { team: null, error: '', notice: '', fresh: null, form: { name: '', email: '', role: 'teacher', password: tempPassword() }, errors: [], busy: false };

  async function load() {
    state.team = remote ? await loadRemoteTeam() : { members: listTeam(), invites: [] };
  }

  async function render() {
    try { await load(); } catch (error) { state.error = error.message; state.team ??= { members: [], invites: [] }; }
    const { members, invites } = state.team;
    const joinLink = (invite) => `${window.location.origin}${window.location.pathname}#/join?email=${encodeURIComponent(invite.email)}&code=${invite.code}`;
    container.innerHTML = `
      <div class="space-y-4">
        <div><h2 class="text-lg" style="font-weight:600;">Team &amp; access</h2>
        <p class="text-sm text-ink-500 mt-1">Give each person their own login. What they can see and change depends on their role.</p></div>
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        ${state.notice ? `<div class="notice"><span>${escapeHtml(state.notice)}</span></div>` : ''}

        <section class="card card-p">
          <h3 class="text-sm text-ink-700 mb-2" style="font-weight:600;">What each role can do</h3>
          <div class="space-y-2">${ASSIGNABLE_ROLES.map((r) => `<div style="border:1px solid var(--ink-100);border-radius:0.5rem;padding:0.6rem 0.8rem;">
            <p class="text-sm" style="font-weight:600;">${escapeHtml(ROLES[r].label)} <span class="text-xs text-ink-400" style="font-weight:400;">· ${escapeHtml(ROLES[r].title)}</span></p>
            <p class="text-xs text-ink-500 mt-1">${escapeHtml(accessSummary(r))}</p></div>`).join('')}</div>
        </section>

        ${state.fresh ? freshHtml(joinLink) : ''}

        <section class="card card-p space-y-3">
          <h3 class="text-sm text-ink-700" style="font-weight:600;">${remote ? 'Invite a colleague' : 'Add a colleague'}</h3>
          <div class="grid sm-grid-2 gap-3">
            <div><label class="label" for="tm-name">Full name</label><input class="input" id="tm-name" value="${escapeHtml(state.form.name)}" /></div>
            <div><label class="label" for="tm-email">Email</label><input class="input" id="tm-email" type="email" value="${escapeHtml(state.form.email)}" /></div>
            <div><label class="label" for="tm-role">Role</label><select class="input" id="tm-role">${ASSIGNABLE_ROLES.map((r) => `<option value="${r}" ${state.form.role === r ? 'selected' : ''}>${escapeHtml(ROLES[r].label)}</option>`).join('')}</select></div>
            ${remote ? '' : `<div><label class="label" for="tm-password">Starting password</label><div class="flex gap-2"><input class="input" id="tm-password" value="${escapeHtml(state.form.password)}" /><button class="btn-secondary btn-sm" id="tm-gen" type="button">New</button></div></div>`}
          </div>
          ${state.errors.length ? `<ul class="field-error" style="margin:0;padding-left:1.1rem;" role="alert">${state.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>` : ''}
          <div><button class="btn-primary" id="tm-add" ${state.busy ? 'disabled' : ''}>${remote ? 'Create invitation' : 'Create account'}</button></div>
          <p class="text-xs text-ink-400">${remote ? 'They sign up with this exact email and the invitation code you get after creating it. Codes work once and expire after 14 days.' : 'They sign in with this email and password from the normal Log in page.'}</p>
        </section>

        <section class="card" style="overflow:hidden;">
          <div class="card-p" style="padding-bottom:0.5rem;"><h3 class="text-sm text-ink-700" style="font-weight:600;">People with access (${members.length})</h3></div>
          <div class="overflow-x-auto"><table class="data-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
            <tbody>${members.map((m) => `<tr>
              <td style="font-weight:500;">${escapeHtml(m.name || '—')}${m.isOwner ? ' <span class="badge" style="background:var(--ink-100);color:var(--ink-700);">Owner</span>' : ''}${m.isMe ? ' <span class="text-xs text-ink-400">(you)</span>' : ''}</td>
              <td class="text-ink-600">${escapeHtml(m.email || '—')}</td>
              <td>${m.isOwner || m.isMe ? escapeHtml(ROLES[m.role]?.label ?? m.role) : `<select class="input" data-role-for="${escapeHtml(m.id)}" style="min-width:11rem;">${ASSIGNABLE_ROLES.map((r) => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${escapeHtml(ROLES[r].label)}</option>`).join('')}${ASSIGNABLE_ROLES.includes(m.role) ? '' : `<option value="${escapeHtml(m.role)}" selected>${escapeHtml(ROLES[m.role]?.label ?? m.role)}</option>`}</select>`}</td>
              <td class="text-right" style="white-space:nowrap;">${m.isOwner || m.isMe ? '' : `${remote ? '' : `<button data-reset="${escapeHtml(m.id)}" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;">Reset password</button> `}<button data-remove-member="${escapeHtml(m.id)}" class="text-bad" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;margin-left:0.5rem;">Remove</button>`}</td></tr>`).join('')}</tbody>
          </table></div>
        </section>

        ${invites.length ? `<section class="card" style="overflow:hidden;"><div class="card-p" style="padding-bottom:0.5rem;"><h3 class="text-sm text-ink-700" style="font-weight:600;">Waiting to join (${invites.length})</h3></div>
          <div class="overflow-x-auto"><table class="data-table"><thead><tr><th>Email</th><th>Role</th><th>Code</th><th></th></tr></thead>
          <tbody>${invites.map((i) => `<tr><td>${escapeHtml(i.email)}${i.name ? `<br><span class="text-xs text-ink-400">${escapeHtml(i.name)}</span>` : ''}</td><td>${escapeHtml(ROLES[i.role]?.label ?? i.role)}</td>
            <td><code>${escapeHtml(formatInviteCode(i.code))}</code>${i.expired ? ' <span class="text-bad text-xs">expired</span>' : ''}</td>
            <td class="text-right"><button data-copy-invite="${escapeHtml(i.id)}" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;">Copy details</button> <button data-revoke="${escapeHtml(i.id)}" class="text-bad" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;margin-left:0.5rem;">Cancel</button></td></tr>`).join('')}</tbody></table></div></section>` : ''}
      </div>`;
    wire(invites, joinLink);
  }

  function freshHtml(joinLink) {
    const f = state.fresh;
    return `<section class="card card-p" style="border-color:var(--good,#2e7d4f);">
      <h3 class="text-sm" style="font-weight:600;color:var(--good,#2e7d4f);">${f.kind === 'invite' ? 'Invitation created' : 'Account created'} for ${escapeHtml(f.name)}</h3>
      ${f.kind === 'invite'
        ? `<p class="text-sm mt-2">Send ${escapeHtml(f.name)} this code: <code style="font-size:1.05rem;letter-spacing:0.06em;">${escapeHtml(formatInviteCode(f.code))}</code></p>
           <p class="text-xs text-ink-500 mt-1">They open <b>${escapeHtml(`${window.location.origin}${window.location.pathname}#/join`)}</b>, sign up with <b>${escapeHtml(f.email)}</b> and enter the code.</p>`
        : `<p class="text-sm mt-2">Sign-in details — Email: <b>${escapeHtml(f.email)}</b> · Password: <code>${escapeHtml(f.password)}</code></p>
           <p class="text-xs text-ink-500 mt-1">Write these down or send them privately; the password isn't shown again.</p>`}
      <div class="mt-2"><button class="btn-secondary btn-sm" id="tm-copy-fresh">Copy details</button> <button class="btn-ghost text-sm" id="tm-dismiss">Done</button></div></section>`;
  }

  async function copy(textToCopy) {
    try { await navigator.clipboard.writeText(textToCopy); state.notice = 'Copied.'; } catch { state.notice = textToCopy; }
    await render();
  }

  async function act(task) {
    state.error = ''; state.notice = ''; state.busy = true;
    try { await task(); } catch (error) { state.error = error.message; }
    state.busy = false;
    await render();
  }

  function wire(invites, joinLink) {
    const f = state.form;
    qs(container, '#tm-name').addEventListener('input', (e) => { f.name = e.target.value; });
    qs(container, '#tm-email').addEventListener('input', (e) => { f.email = e.target.value; });
    qs(container, '#tm-role').addEventListener('change', (e) => { f.role = e.target.value; });
    qs(container, '#tm-password')?.addEventListener('input', (e) => { f.password = e.target.value; });
    qs(container, '#tm-gen')?.addEventListener('click', () => { f.password = tempPassword(); render(); });
    qs(container, '#tm-dismiss')?.addEventListener('click', () => { state.fresh = null; render(); });
    qs(container, '#tm-copy-fresh')?.addEventListener('click', () => {
      const x = state.fresh;
      copy(x.kind === 'invite'
        ? `Hello ${x.name}, you've been invited to join the school on SwiftIQ EduFlow as ${ROLES[x.role].label}. Open ${window.location.origin}${window.location.pathname}#/join , sign up with ${x.email} and enter this code: ${formatInviteCode(x.code)}`
        : `Hello ${x.name}, your SwiftIQ EduFlow login — Email: ${x.email} Password: ${x.password} (role: ${ROLES[x.role].label})`);
    });

    qs(container, '#tm-add').addEventListener('click', () => act(async () => {
      state.errors = [];
      if (remote) {
        if (!f.name.trim()) state.errors.push('Enter their name.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) state.errors.push('Enter a valid email address.');
        if (state.errors.length) return;
        const result = await inviteRemoteMember({ email: f.email.trim(), name: f.name.trim(), role: f.role });
        state.fresh = { kind: 'invite', name: f.name.trim(), email: result.email, role: f.role, code: result.code };
      } else {
        const result = createStaffAccount(f);
        if (!result.ok) { state.errors = result.errors.map((e) => e.message); return; }
        state.fresh = { kind: 'account', name: f.name.trim(), email: f.email.trim().toLowerCase(), role: f.role, password: f.password };
      }
      state.form = { name: '', email: '', role: f.role, password: tempPassword() };
    }));

    on(container, '[data-role-for]', 'change', (e) => act(async () => {
      const id = e.target.getAttribute('data-role-for');
      const role = e.target.value;
      if (remote) await setRemoteMemberRole(id, role);
      else { const r = setStaffRole(id, role); if (!r.ok) throw new Error(r.error); }
      state.notice = 'Role updated. It applies the next time they open a page.';
    }));
    on(container, '[data-remove-member]', 'click', (e) => {
      const id = e.currentTarget.getAttribute('data-remove-member');
      const person = state.team.members.find((m) => m.id === id);
      if (!confirm(`Remove ${person?.name || 'this person'}? They will no longer be able to open the school.`)) return;
      act(async () => {
        if (remote) await removeRemoteMember(id);
        else { const r = removeStaffAccount(id); if (!r.ok) throw new Error(r.error); }
        state.notice = 'Removed.';
      });
    });
    on(container, '[data-reset]', 'click', (e) => {
      const id = e.currentTarget.getAttribute('data-reset');
      const password = tempPassword();
      act(async () => {
        const r = resetStaffPassword(id, password);
        if (!r.ok) throw new Error(r.error);
        const person = state.team.members.find((m) => m.id === id);
        state.fresh = { kind: 'account', name: person.name, email: person.email, role: person.role, password };
      });
    });
    on(container, '[data-revoke]', 'click', (e) => act(async () => { await revokeRemoteInvite(e.currentTarget.getAttribute('data-revoke')); state.notice = 'Invitation cancelled.'; }));
    on(container, '[data-copy-invite]', 'click', (e) => {
      const i = invites.find((x) => x.id === e.currentTarget.getAttribute('data-copy-invite'));
      copy(`Hello${i.name ? ` ${i.name}` : ''}, you've been invited to join the school on SwiftIQ EduFlow as ${ROLES[i.role].label}. Open ${window.location.origin}${window.location.pathname}#/join , sign up with ${i.email} and enter this code: ${formatInviteCode(i.code)}`);
    });
  }

  render();
}
