import { escapeHtml, on, qs } from '../../components/dom.js';
import { authShell } from '../public/chrome.js';
import { adminExists, adminLogin, registerAdmin, validateAdminSetup } from '../../services/platformService.js';
import { MIN_PASSWORD_LENGTH } from '../../lib/passwords.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { signInWithSupabase, signOutFromSupabase } from '../../services/supabaseAuthService.js';

export function renderAdminAccess(rootEl, onAuthenticated) {
  if (isSupabaseConfigured()) {
    renderSupabaseAdminLogin(rootEl, onAuthenticated);
    return;
  }
  if (adminExists()) renderAdminLogin(rootEl, onAuthenticated);
  else renderAdminSetup(rootEl, onAuthenticated);
}

function renderSupabaseAdminLogin(rootEl, onAuthenticated) {
  const state = { email: '', error: '', busy: false };

  function draw() {
    rootEl.innerHTML = authShell(
      'Platform administrator',
      'Log in to manage school approvals, packages and invoices.',
      `
      <div class="space-y-4">
        <div>
          <label class="label" for="ad-email">Email</label>
          <input class="input" id="ad-email" type="email" autocomplete="username" value="${escapeHtml(state.email)}" ${state.busy ? 'disabled' : ''} />
        </div>
        <div>
          <label class="label" for="ad-password">Password</label>
          <input class="input" id="ad-password" type="password" autocomplete="current-password" ${state.busy ? 'disabled' : ''} />
        </div>
        ${state.error ? `<p class="field-error" role="alert">${escapeHtml(state.error)}</p>` : ''}
        <button class="btn btn-primary w-full" id="ad-submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Signing in...' : 'Log in'}</button>
        <p class="auth-switch">Schools log in <a href="#/login">here</a>.</p>
      </div>`,
      { showStorageNote: false }
    );
    const submit = async () => {
      state.email = qs(rootEl, '#ad-email').value;
      const password = qs(rootEl, '#ad-password').value;
      state.busy = true;
      state.error = '';
      draw();
      try {
        const result = await signInWithSupabase(state.email, password);
        if (!result.ok) throw new Error(result.error);
        if (result.kind !== 'platform-admin') {
          await signOutFromSupabase();
          throw new Error('This account is not registered as a platform administrator.');
        }
        onAuthenticated();
      } catch (error) {
        state.busy = false;
        state.error = error.message;
        draw();
      }
    };
    qs(rootEl, '#ad-submit').addEventListener('click', submit);
    on(rootEl, 'input', 'keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
  }
  draw();
}

function renderAdminLogin(rootEl, onAuthenticated) {
  const state = { email: '', error: '' };

  function draw() {
    rootEl.innerHTML = authShell(
      'Platform administrator',
      'Log in to manage schools, packages, invoices and approvals.',
      `
      <div class="space-y-4">
        <div>
          <label class="label" for="ad-email">Email</label>
          <input class="input" id="ad-email" type="email" autocomplete="username" value="${escapeHtml(state.email)}" />
        </div>
        <div>
          <label class="label" for="ad-password">Password</label>
          <input class="input" id="ad-password" type="password" autocomplete="current-password" />
        </div>
        ${state.error ? `<p class="field-error" id="ad-error" role="alert">${escapeHtml(state.error)}</p>` : ''}
        <button class="btn btn-primary w-full" id="ad-submit">Log in</button>
        <p class="auth-switch">This area is for the business administrator only. Schools log in <a href="#/login">here</a>.</p>
      </div>`
    );
    const submit = () => {
      state.email = qs(rootEl, '#ad-email').value;
      const result = adminLogin(state.email, qs(rootEl, '#ad-password').value);
      if (!result.ok) {
        state.error = result.error;
        draw();
        return;
      }
      onAuthenticated();
    };
    qs(rootEl, '#ad-submit').addEventListener('click', submit);
    on(rootEl, 'input', 'keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }
  draw();
}

function renderAdminSetup(rootEl, onAuthenticated) {
  const state = { name: '', email: '', password: '', confirmPassword: '', errors: [] };
  const errorFor = (f) => state.errors.find((e) => e.field === f)?.message;
  const fieldError = (f) => (errorFor(f) ? `<p class="field-error">${escapeHtml(errorFor(f))}</p>` : '');

  function draw() {
    rootEl.innerHTML = authShell(
      'Set up the platform administrator',
      'Choose the login details you will use to manage schools and billing. There is no default password.',
      `
      <div class="space-y-4">
        <div class="notice"><span>Whoever completes this step becomes the administrator. In a live system the administrator account is created on the server, not from a public page.</span></div>
        <div>
          <label class="label" for="ad-name">Your full name</label>
          <input class="input ${errorFor('name') ? 'error' : ''}" id="ad-name" value="${escapeHtml(state.name)}" />
          ${fieldError('name')}
        </div>
        <div>
          <label class="label" for="ad-email">Email</label>
          <input class="input ${errorFor('email') ? 'error' : ''}" id="ad-email" type="email" autocomplete="username" value="${escapeHtml(state.email)}" />
          ${fieldError('email')}
        </div>
        <div class="grid sm-grid-2 gap-4">
          <div>
            <label class="label" for="ad-password">Password</label>
            <input class="input ${errorFor('password') ? 'error' : ''}" id="ad-password" type="password" autocomplete="new-password" value="${escapeHtml(state.password)}" />
            ${fieldError('password')}
          </div>
          <div>
            <label class="label" for="ad-confirm">Confirm password</label>
            <input class="input ${errorFor('confirmPassword') ? 'error' : ''}" id="ad-confirm" type="password" autocomplete="new-password" value="${escapeHtml(state.confirmPassword)}" />
            ${fieldError('confirmPassword')}
          </div>
        </div>
        <p class="text-xs text-ink-500">Use at least ${MIN_PASSWORD_LENGTH} characters.</p>
        <button class="btn btn-primary w-full" id="ad-submit">Create administrator</button>
      </div>`
    );
    qs(rootEl, '#ad-submit').addEventListener('click', () => {
      state.name = qs(rootEl, '#ad-name').value;
      state.email = qs(rootEl, '#ad-email').value;
      state.password = qs(rootEl, '#ad-password').value;
      state.confirmPassword = qs(rootEl, '#ad-confirm').value;
      state.errors = validateAdminSetup(state);
      if (state.errors.length > 0) {
        draw();
        return;
      }
      registerAdmin(state);
      onAuthenticated();
    });
  }
  draw();
}
