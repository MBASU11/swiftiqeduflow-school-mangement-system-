import { escapeHtml, qs, on } from '../../components/dom.js';
import { authShell } from './chrome.js';
import { MIN_PASSWORD_LENGTH } from '../../lib/passwords.js';
import { joinSchoolWithInvite, acceptInviteCode } from '../../services/supabaseAuthService.js';

// Public page for a colleague who has been invited: creates their sign-in and
// attaches it to the school using the invitation code.
export function renderJoinSchool(rootEl, query, onAuthenticated) {
  const state = { name: '', email: query.email ?? '', code: query.code ?? '', error: '', notice: '', busy: false };

  function draw() {
    rootEl.innerHTML = authShell(
      'Join your school',
      'Use the email and invitation code your school administrator gave you.',
      `<div class="space-y-4">
        <div><label class="label" for="jn-name">Your full name</label><input class="input" id="jn-name" autocomplete="name" value="${escapeHtml(state.name)}" ${state.busy ? 'disabled' : ''} /></div>
        <div><label class="label" for="jn-email">Email (the one your invitation was sent to)</label><input class="input" id="jn-email" type="email" autocomplete="email" value="${escapeHtml(state.email)}" ${state.busy ? 'disabled' : ''} /></div>
        <div><label class="label" for="jn-code">Invitation code</label><input class="input" id="jn-code" autocomplete="off" placeholder="ABCD-1234-EFGH" value="${escapeHtml(state.code)}" style="text-transform:uppercase;letter-spacing:0.08em;" ${state.busy ? 'disabled' : ''} /></div>
        <div><label class="label" for="jn-password">Choose a password</label><input class="input" id="jn-password" type="password" autocomplete="new-password" ${state.busy ? 'disabled' : ''} /></div>
        <div><label class="label" for="jn-confirm">Confirm password</label><input class="input" id="jn-confirm" type="password" autocomplete="new-password" ${state.busy ? 'disabled' : ''} /></div>
        ${state.error ? `<p class="field-error" role="alert">${escapeHtml(state.error)}</p>` : ''}
        ${state.notice ? `<p class="text-sm text-good" role="status">${escapeHtml(state.notice)}</p>` : ''}
        <button class="btn btn-primary w-full" id="jn-submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Joining…' : 'Join school'}</button>
        <p class="auth-switch">Already joined? <a href="#/login">Log in</a></p>
      </div>`
    );
    qs(rootEl, '#jn-submit').addEventListener('click', submit);
    on(rootEl, 'input', 'keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  async function submit() {
    state.name = qs(rootEl, '#jn-name').value.trim();
    state.email = qs(rootEl, '#jn-email').value.trim();
    state.code = qs(rootEl, '#jn-code').value.trim();
    const password = qs(rootEl, '#jn-password').value;
    const confirm = qs(rootEl, '#jn-confirm').value;
    if (!state.name || !state.email || !state.code) { state.error = 'Fill in your name, email and invitation code.'; draw(); return; }
    if (password.length < MIN_PASSWORD_LENGTH) { state.error = `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`; draw(); return; }
    if (password !== confirm) { state.error = 'The two passwords don’t match.'; draw(); return; }
    state.busy = true; state.error = ''; draw();
    const result = await joinSchoolWithInvite({ name: state.name, email: state.email, password, code: state.code });
    state.busy = false;
    if (!result.ok) { state.error = result.error; draw(); return; }
    if (result.requiresEmailConfirmation) {
      state.notice = 'Almost there — confirm your email using the message we sent, then log in and enter your invitation code.';
      draw();
      return;
    }
    onAuthenticated();
  }
  draw();
}

// Shown to someone who is signed in but isn't part of a school yet (for example they
// confirmed their email after signing up): they just enter the invitation code.
export function renderEnterInviteCode(rootEl, { email, onJoined, onLogout }) {
  const state = { code: '', error: '', busy: false };
  function draw() {
    rootEl.innerHTML = authShell(
      'Enter your invitation code',
      `You're signed in as ${email}. Enter the code your school administrator gave you to join the school.`,
      `<div class="space-y-4">
        <div><label class="label" for="ic-code">Invitation code</label><input class="input" id="ic-code" autocomplete="off" placeholder="ABCD-1234-EFGH" value="${escapeHtml(state.code)}" style="text-transform:uppercase;letter-spacing:0.08em;" ${state.busy ? 'disabled' : ''} /></div>
        ${state.error ? `<p class="field-error" role="alert">${escapeHtml(state.error)}</p>` : ''}
        <button class="btn btn-primary w-full" id="ic-submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Checking…' : 'Join school'}</button>
        <p class="auth-switch"><a href="#/" id="ic-logout">Sign out</a></p>
      </div>`
    );
    qs(rootEl, '#ic-submit').addEventListener('click', async () => {
      state.code = qs(rootEl, '#ic-code').value.trim();
      if (!state.code) { state.error = 'Enter your invitation code.'; draw(); return; }
      state.busy = true; state.error = ''; draw();
      const result = await acceptInviteCode(state.code);
      state.busy = false;
      if (!result.ok) { state.error = result.error; draw(); return; }
      onJoined();
    });
    qs(rootEl, '#ic-logout').addEventListener('click', (e) => { e.preventDefault(); onLogout(); });
  }
  draw();
}
