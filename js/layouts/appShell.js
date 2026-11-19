import { NAV_ITEMS, MOBILE_PRIMARY_PATHS } from './navConfig.js';
import { icons } from '../components/icons.js';
import { escapeHtml, on, qs } from '../components/dom.js';
import { getSettings } from '../services/settingsService.js';
import { getSchool } from '../services/schoolService.js';
import { globalSearch } from '../services/searchService.js';
import { canAccessPath, getCurrentRole, roleLabel } from '../services/accessService.js';
import { moduleEnabled } from '../services/subscriptionService.js';
import { moduleForPath } from '../config/roles.js';

function visibleNavItems() {
  const toggles = getSettings().moduleToggles;
  return NAV_ITEMS.filter((item) => (!item.moduleKey || toggles[item.moduleKey]) && moduleEnabled(moduleForPath(item.path)) && (!item.needsModule || moduleEnabled(item.needsModule)) && canAccessPath(item.path));
}

function navLinkHtml(item, activePath, extraClass = '') {
  const isActive = item.path === activePath;
  return `
    <a href="${item.path}" class="nav-link ${extraClass} ${isActive ? 'active' : ''}" data-nav-link>
      ${item.icon(18)}<span>${escapeHtml(item.label === 'Exams & Assessments' && extraClass === 'mobile' ? 'Exams' : item.label)}</span>
    </a>
  `;
}

let shellRefs = null;
let removeGlobalListeners = [];

// Listeners on window/document outlive the shell's HTML, so they're tracked
// and removed whenever the shell is mounted again (e.g. after signing back in).
function listen(target, event, handler) {
  target.addEventListener(event, handler);
  removeGlobalListeners.push(() => target.removeEventListener(event, handler));
}

export function mountShell(rootEl, { account, onLogout, navItems, schoolOverride, searchEnabled = true } = {}) {
  removeGlobalListeners.forEach((remove) => remove());
  removeGlobalListeners = [];
  const school = schoolOverride ?? getSchool();
  const nav = navItems ?? visibleNavItems();
  const mobileItems = nav.filter((item) => MOBILE_PRIMARY_PATHS.includes(item.path));

  rootEl.innerHTML = `
    <aside class="shell-sidebar">
      <div class="brand">
        ${school?.logoUrl ? `<img src="${escapeHtml(school.logoUrl)}" alt="School logo" width="36" height="36" class="brand-mark" style="object-fit:contain;" />` : '<img src="./assets/logo-badge.png" alt="" width="36" height="36" class="brand-mark" />'}
        <div>
          <p class="name">SwiftIQ EduFlow</p>
          <p class="tag">One School. One Flow.</p>
        </div>
      </div>
      <nav id="sidebar-nav">${nav.map((i) => navLinkHtml(i, '')).join('')}</nav>
      <div class="footer">${escapeHtml(school?.name ?? 'SwiftIQ EduFlow')}</div>
    </aside>

    <div class="shell-main">
      <header class="shell-topbar">
        <div class="shell-topbar-inner">
          <button class="btn-ghost hamburger" id="hamburger-btn" aria-label="Open menu">${icons.menu(20)}</button>
          ${searchEnabled ? `<div class="search-wrap">
            <span class="icon">${icons.search(16)}</span>
            <input class="input" id="global-search" placeholder="Search students, parents, teachers…" autocomplete="off" />
            <div id="search-results"></div>
          </div>` : ''}
          <div class="flex items-center gap-2" style="margin-left:auto">
            <span class="offline-chip hidden" id="offline-chip">${icons.wifiOff(14)} Offline — saving locally</span>
            <button class="btn-ghost" aria-label="Notifications">${icons.bell(20)}</button>
            <div class="account-wrap">
              <button class="avatar-btn" id="account-btn" aria-label="Account menu" aria-haspopup="true">
                <div class="avatar">${escapeHtml((account?.name ?? school?.name ?? 'S').charAt(0).toUpperCase())}</div>
              </button>
              <div class="account-menu hidden" id="account-menu" role="menu">
                <div class="who">
                  <p>${escapeHtml(account?.name ?? 'Signed in')}</p>
                  <p>${escapeHtml(account?.email ?? '')}</p>
                  ${getCurrentRole() ? `<p style="font-weight:600;">${escapeHtml(roleLabel())}</p>` : ''}
                  <p>${escapeHtml(school?.name ?? '')}</p>
                </div>
                <button id="logout-btn" role="menuitem">Log out</button>
              </div>
            </div>
          </div>
        </div>
      </header>
      <main class="shell-content" id="shell-content"></main>
    </div>

    <nav class="mobile-nav" id="mobile-nav">
      ${mobileItems.map((i) => navLinkHtml(i, '', 'mobile')).join('')}
    </nav>

    <div id="drawer-root"></div>
  `;

  const contentEl = qs(rootEl, '#shell-content');
  const searchInput = qs(rootEl, '#global-search');
  const searchResults = qs(rootEl, '#search-results');
  const offlineChip = qs(rootEl, '#offline-chip');
  const drawerRoot = qs(rootEl, '#drawer-root');

  function updateOnlineState() {
    offlineChip.classList.toggle('hidden', navigator.onLine);
  }
  listen(window, 'online', updateOnlineState);
  listen(window, 'offline', updateOnlineState);
  updateOnlineState();

  if (searchInput && searchResults) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      if (q.length < 2) {
        searchResults.innerHTML = '';
        return;
      }
      const results = globalSearch(q).slice(0, 6);
      if (results.length === 0) {
        searchResults.innerHTML = '';
        return;
      }
      searchResults.innerHTML = `
        <div class="search-results">
          ${results
            .map(
              (r) => `<button data-path="${r.path}"><span>${escapeHtml(r.label)}</span><span class="text-ink-400">${escapeHtml(r.kind)}</span></button>`
            )
            .join('')}
        </div>
      `;
      on(searchResults, 'button', 'click', (e) => {
        const path = e.currentTarget.getAttribute('data-path');
        searchInput.value = '';
        searchResults.innerHTML = '';
        window.location.hash = path.replace(/^#/, '');
      });
    });
  }
  const accountBtn = qs(rootEl, '#account-btn');
  const accountMenu = qs(rootEl, '#account-menu');
  accountBtn.addEventListener('click', () => accountMenu.classList.toggle('hidden'));
  qs(rootEl, '#logout-btn').addEventListener('click', () => {
    if (onLogout) onLogout();
  });
  listen(document, 'click', (e) => {
    if (searchInput && searchResults && !searchInput.contains(e.target) && !searchResults.contains(e.target)) {
      searchResults.innerHTML = '';
    }
    if (!accountBtn.contains(e.target) && !accountMenu.contains(e.target)) {
      accountMenu.classList.add('hidden');
    }
  });

  function openDrawer() {
    drawerRoot.innerHTML = `
      <div class="drawer-overlay" id="drawer-overlay"></div>
      <div class="drawer">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <img src="./assets/logo-badge.png" alt="" width="30" height="30" class="brand-mark" />
            <p class="text-lg" style="font-family: var(--font-display); font-weight:600;">SwiftIQ EduFlow</p>
          </div>
          <button class="btn-ghost" id="drawer-close" aria-label="Close menu">✕</button>
        </div>
        <nav>${(navItems ?? visibleNavItems()).map((i) => navLinkHtml(i, currentHash())).join('')}</nav>
      </div>
    `;
    qs(drawerRoot, '#drawer-overlay').addEventListener('click', closeDrawer);
    qs(drawerRoot, '#drawer-close').addEventListener('click', closeDrawer);
    on(drawerRoot, '[data-nav-link]', 'click', closeDrawer);
  }
  function closeDrawer() {
    drawerRoot.innerHTML = '';
  }
  qs(rootEl, '#hamburger-btn').addEventListener('click', openDrawer);

  shellRefs = { rootEl, contentEl, navItems };
  return contentEl;
}

function currentHash() {
  return window.location.hash || '#/';
}

// Re-highlights the active nav link and refreshes the sidebar/mobile list
// (module toggles may have changed since the shell was mounted).
export function refreshShellNav() {
  if (!shellRefs) return;
  const { rootEl, navItems } = shellRefs;
  const nav = navItems ?? visibleNavItems();
  const active = currentHash();
  const sidebarNav = qs(rootEl, '#sidebar-nav');
  if (sidebarNav) sidebarNav.innerHTML = nav.map((i) => navLinkHtml(i, active)).join('');
  const mobileNav = qs(rootEl, '#mobile-nav');
  if (mobileNav) {
    const mobileItems = nav.filter((item) => MOBILE_PRIMARY_PATHS.includes(item.path));
    mobileNav.innerHTML = mobileItems.map((i) => navLinkHtml(i, active, 'mobile')).join('');
  }
}
