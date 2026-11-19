// Administrators only (demo mode): give a learner or a parent a login for the portal. Cloud mode uses invitations instead.
import { escapeHtml, on, qs } from '../../components/dom.js';
import { listFamilyAccounts, createFamilyAccount, resetStaffPassword, removeStaffAccount } from '../../services/authService.js';
import { studentRepo, fullName } from '../../services/studentService.js';
import { parentRepo } from '../../services/peopleService.js';

const tempPassword = () => `${['Blue', 'Green', 'Swift', 'Bright', 'Lion'][Math.floor(Math.random() * 5)]}${Math.floor(1000 + Math.random() * 9000)}${['!', '#', '*'][Math.floor(Math.random() * 3)]}`;
const personName = (p) => [p.firstName, p.lastName].filter(Boolean).join(' ') || p.name || 'Parent';

export function renderFamilyAccess(container) {
  const st = { role: 'student', linkedId: '', username: '', password: tempPassword(), errors: [], fresh: null, notice: '' };
  function people() { return st.role === 'student' ? studentRepo.getAll().filter((s) => (s.status ?? 'active') === 'active').map((s) => ({ id: s.id, label: `${fullName(s)}${s.admissionNumber ? ` (${s.admissionNumber})` : ''}`, user: s.admissionNumber ?? '' })) : parentRepo.getAll().map((p) => ({ id: p.id, label: personName(p), user: String(p.phone ?? '').replace(/\D/g, '') })); }
  function draw() {
    const list = listFamilyAccounts(); const opts = people();
    const nameOf = (a) => { const rec = a.role === 'student' ? studentRepo.getById(a.linkedId) : parentRepo.getById(a.linkedId); return rec ? (a.role === 'student' ? fullName(rec) : personName(rec)) : a.name; };
    container.innerHTML = `<section class="card card-p space-y-3"><h3 class="text-sm" style="font-weight:600;">Learner and parent logins</h3>
      <p class="text-xs text-ink-500">Learners and parents sign in with a username and see only their own portal: report cards (once published), homework, timetable and attendance. Learners never see fees.</p>
      ${st.fresh ? `<div class="notice" role="status"><span>Login created. Username <b>${escapeHtml(st.fresh.username)}</b> · password <b>${escapeHtml(st.fresh.password)}</b>. Write it down now: the password is not shown again.</span></div>` : ''}${st.notice ? `<div class="notice" role="status"><span>${escapeHtml(st.notice)}</span></div>` : ''}
      ${st.errors.map((e) => `<p class="field-error" role="alert">${escapeHtml(e)}</p>`).join('')}
      <div class="grid grid-2 gap-3">
        <div><label class="label">For a</label><select class="input" id="fa-role"><option value="student" ${st.role === 'student' ? 'selected' : ''}>Learner</option><option value="parent" ${st.role === 'parent' ? 'selected' : ''}>Parent / guardian</option></select></div>
        <div><label class="label">Person</label><select class="input" id="fa-who"><option value="">Choose…</option>${opts.map((o) => `<option value="${escapeHtml(o.id)}" ${o.id === st.linkedId ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select></div>
        <div><label class="label">Username</label><input class="input" id="fa-user" value="${escapeHtml(st.username)}" autocapitalize="none" /></div>
        <div><label class="label">Password</label><input class="input" id="fa-pass" value="${escapeHtml(st.password)}" /></div></div>
      <button class="btn-primary btn-sm" id="fa-create">Create login</button>
      ${list.length ? `<div style="border-top:1px solid var(--ink-100);padding-top:.5rem;">${list.map((a) => `<div class="flex flex-wrap items-center justify-between gap-2 text-sm" style="padding:.3rem 0;"><span><b>${escapeHtml(nameOf(a))}</b> · ${a.role === 'student' ? 'Learner' : 'Parent'} · ${escapeHtml(a.username)}</span><span><button class="btn-ghost btn-sm" data-reset="${a.id}">Reset password</button><button class="btn-ghost btn-sm" data-del="${a.id}">Remove</button></span></div>`).join('')}</div>` : '<p class="text-xs text-ink-400">No learner or parent logins yet.</p>'}</section>`;
    const read = () => { st.username = qs(container, '#fa-user').value; st.password = qs(container, '#fa-pass').value; };
    qs(container, '#fa-role').addEventListener('change', (e) => { read(); st.role = e.target.value; st.linkedId = ''; st.username = ''; draw(); });
    qs(container, '#fa-who').addEventListener('change', (e) => { read(); st.linkedId = e.target.value; const o = opts.find((x) => x.id === st.linkedId); st.username = o?.user ?? ''; draw(); });
    qs(container, '#fa-create').addEventListener('click', () => {
      read(); const o = opts.find((x) => x.id === st.linkedId);
      const r = createFamilyAccount({ role: st.role, linkedId: st.linkedId, name: o?.label.replace(/ \(.*\)$/, ''), username: st.username, password: st.password });
      if (!r.ok) { st.errors = r.errors; st.fresh = null; return draw(); }
      Object.assign(st, { errors: [], notice: '', fresh: { username: r.account.username, password: st.password }, linkedId: '', username: '', password: tempPassword() }); draw();
    });
    on(container, '[data-reset]', 'click', (e) => { const pw = tempPassword(); const r = resetStaffPassword(e.currentTarget.dataset.reset, pw); st.errors = r.ok ? [] : [r.error]; st.fresh = r.ok ? { username: list.find((a) => a.id === e.currentTarget.dataset.reset)?.username, password: pw } : null; draw(); });
    on(container, '[data-del]', 'click', (e) => { if (!confirm('Remove this login? They will no longer be able to sign in.')) return; const r = removeStaffAccount(e.currentTarget.dataset.del); st.errors = r.ok ? [] : [r.error]; st.fresh = null; st.notice = r.ok ? 'Login removed.' : ''; draw(); });
  }
  draw();
}
