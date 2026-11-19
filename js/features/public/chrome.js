import { escapeHtml } from '../../components/dom.js';

export function headerHtml(showSectionLinks) {
  return `
    <header class="pub-header">
      <div class="pub-container pub-header-inner">
        <a class="pub-brand" href="#/">
          <img src="./assets/logo-badge.png" alt="" width="36" height="36" class="brand-mark" />
          <span>SwiftIQ Enterprise · EduFlow</span>
        </a>
        ${
          showSectionLinks
            ? `<nav class="pub-links">
                <button data-scroll="about">About</button>
                <button data-scroll="features">Features</button>
                <button data-scroll="pricing">Pricing</button>
                <button data-scroll="how">How it works</button>
                <button data-scroll="contact">Contact</button>
              </nav>`
            : `<span></span>`
        }
        <div class="pub-actions">
          ${showSectionLinks ? '<button class="btn btn-secondary btn-sm hidden" data-install-app type="button">Install app</button>' : ''}
          <a class="btn btn-secondary btn-sm" href="#/login">Log in</a>
          <a class="btn btn-primary btn-sm" href="#/signup">Sign up</a>
        </div>
      </div>
    </header>
  `;
}

export function authShell(title, subtitle, bodyHtml, { showStorageNote = true } = {}) {
  return `
    <div class="pub">
      ${headerHtml(false)}
      <main class="pub-container auth-wrap">
        <div class="auth-card">
          <h1>${escapeHtml(title)}</h1>
          <p class="auth-sub">${escapeHtml(subtitle)}</p>
          ${bodyHtml}
        </div>
        <p class="pub-footnote" style="text-align:center;">${legalLinksHtml()}</p>
        ${showStorageNote ? '<p class="pub-footnote" style="text-align:center;">Your school’s data is saved in this browser on this device. Use the same browser to come back to it, and download a backup regularly from Settings.</p>' : ''}
      </main>
    </div>
  `;
}


// The three legal pages, linked from every public page.
export const legalLinksHtml = () => '<a href="#/privacy">Privacy Notice</a> · <a href="#/terms">Terms of Service</a> · <a href="#/processing">Data Processing Terms</a>';
