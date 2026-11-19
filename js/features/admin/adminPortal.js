import { escapeHtml, on, qs } from '../../components/dom.js';
import { renderSchoolsList, renderSchoolDetail } from './adminSchools.js';
import { renderInvoicesList, renderInvoiceView } from './adminInvoices.js';
import { renderAdminSettings } from './adminSettings.js';
import { renderControlCentre } from './controlCentre.js';
import * as localPlatformService from '../../services/platformService.js';
import { runDailyAutomation } from '../../services/platformAutomation.js';

const TABS = [
  ['schools', 'Schools'],
  ['invoices', 'Invoices'],
  ['control', 'Packages'],
  ['settings', 'Business settings'],
];

// The business-side console. It shows registrations, packages, invoices and
// approvals only — it has no route into any school's own records.
export function renderAdminPortal(rootEl, { admin, onLogout, platformService = localPlatformService }) {
  const nav = { tab: 'schools', schoolId: null, invoiceId: null, notice: '' };
  // Once a day, the first time the console is opened: create the renewal invoices that are due (local mode; the server does this in the cloud).
  if (platformService === localPlatformService) { try { const r = runDailyAutomation('Automation'); if (r.ran && r.created?.length) nav.notice = `Automation: ${r.created.length} renewal invoice${r.created.length === 1 ? '' : 's'} created today.`; } catch { /* never block the console */ } }

  function go(patch) {
    Object.assign(nav, patch);
    draw();
  }

  async function draw() {
    rootEl.innerHTML = `
      <div class="admin-shell">
        <header class="admin-header no-print">
          <div class="pub-container admin-header-inner">
            <div class="flex items-center gap-2">
              <img src="./assets/logo-badge.png" alt="" width="32" height="32" class="brand-mark" />
              <div>
                <p class="admin-title">SwiftIQ EduFlow</p>
                <p class="admin-sub">Platform administration</p>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span class="admin-who">${escapeHtml(admin.name)}</span>
              <button class="btn btn-hero-secondary btn-sm" id="admin-logout">Log out</button>
            </div>
          </div>
        </header>
        <main class="pub-container" style="padding-top:1.25rem; padding-bottom:3rem;">
          <div class="pill-group no-print" style="margin-bottom:1.25rem; flex-wrap:wrap;">
            ${TABS.map(([key, label]) => `<button class="pill ${nav.tab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`).join('')}
          </div>
          <div id="admin-body"></div>
        </main>
      </div>`;

    qs(rootEl, '#admin-logout').addEventListener('click', onLogout);
    on(rootEl, '[data-tab]', 'click', (e) => go({ tab: e.currentTarget.getAttribute('data-tab'), schoolId: null, invoiceId: null }));

    const body = qs(rootEl, '#admin-body');
    if (nav.invoiceId) {
      const fromSchool = nav.tab === 'schools' && nav.schoolId;
      await renderInvoiceView(body, nav.invoiceId, admin, {
        onBack: () => go({ invoiceId: null }),
        backLabel: fromSchool ? 'Back to school' : 'All invoices',
      }, platformService);
    } else if (nav.tab === 'schools') {
      if (nav.schoolId) await renderSchoolDetail(body, nav.schoolId, admin, go, platformService);
      else { await renderSchoolsList(body, go, platformService, admin, nav.notice); nav.notice = ''; }
    } else if (nav.tab === 'control') {
      await renderControlCentre(body);
    } else if (nav.tab === 'invoices') {
      await renderInvoicesList(body, go, platformService);
    } else {
      await renderAdminSettings(body, admin, platformService);
    }
  }

  draw();
}
