import { escapeHtml, on, qs } from '../../components/dom.js';
import { revealOnScroll } from '../../components/motion.js';
import { icons } from '../../components/icons.js';
import { allPlans, getPlan, priceText, enabledBilling } from '../../config/plans.js';
import { MODULES, FEATURES as MODULE_FEATURES } from '../../config/features.js';
import { requestPasswordReset, hasRecoverySession, setNewPassword } from '../../services/supabaseAuthService.js';
import { MIN_PASSWORD_LENGTH } from '../../lib/passwords.js';
import { getCatalogue, loadPublicCatalogue, hasPublicCatalogueLoaded, buildQuote, money, BILLING_LABEL } from '../../services/packageService.js';
import { headerHtml, authShell, legalLinksHtml } from './chrome.js';
import { renderLegalPage } from './legalPages.js';
import { LEGAL_VERSION } from '../../config/legalText.js';
import { renderAdminAccess } from '../admin/adminAccess.js';
import { renderJoinSchool } from './joinSchool.js';
import { legacyDataAvailable, legacySchoolName, login, register, validateSignup } from '../../services/authService.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { registerSchoolWithSupabase, signInWithSupabase } from '../../services/supabaseAuthService.js';
import { adminLogin } from '../../services/platformService.js';

const FEATURES = [
  ['users', 'Students & parents', 'Admission numbers, classes and streams, parent links and a full profile for every student.'],
  ['clipboard', 'Admissions', 'Take an enquiry all the way to enrolment — approving an applicant creates the student record for you.'],
  ['calendarCheck', 'Attendance', 'Mark a whole class present in one tap, adjust the exceptions, and get reports per class or student.'],
  ['table', 'Timetable', 'Weekly class timetables that stop a class, teacher or room being booked twice.'],
  ['award', 'Exams & report cards', 'Configurable grading, spreadsheet-style marks entry, an approval step before parents can see results, and printable report cards. CBC, Cambridge or your own.'],
  ['wallet', 'Fees & finance', 'Fee structures, invoices, M-Pesa, bank, cash and cheque payment records, balances, statements and expenses.'],
  ['megaphone', 'Communication', 'Announcements to the whole school, a class or a group, plus direct messages.'],
  ['bus', 'Transport', 'Vehicles, routes, stops and seat capacity for every route.'],
  ['library', 'Library', 'A catalogue with borrowing, returns and overdue tracking.'],
  ['shield', 'Discipline', 'Confidential incident records with follow-up dates.'],
  ['folder', 'Documents', 'Certificates, policies and student files kept together and linked to the right person.'],
  ['briefcase', 'Staff', 'Teaching and support staff with the subjects and classes they cover.'],
  ['award', 'CBC competency tracking', 'Rate learners against learning outcomes with one tap (EE, ME, AE, BE), see class and learner progress, check curriculum coverage, and print the CBC progress report.'],
  ['box', 'Inventory', 'Stock items and quantities, issue records and low-stock alerts.'],
  ['barChart', 'Reports Center', 'Attendance, finance and academic reports for the whole school in one place.'],
  ['grid', "Principal's view", 'One screen for what needs a decision: approvals, attendance, fees and results.'],
  ['bell', 'Parent & learner portals', 'Learners and parents sign in to see published report cards, homework (learners hand in online), timetable and attendance. Parents also see fees.'],
  ['activity', 'Clubs & activities', 'Clubs, sports and societies with members, session attendance and achievements.'],
  ['transfer', 'Hostel & boarding', 'Dormitories and beds, exeat approvals with return tracking, and evening roll call.'],
];

const HIGHLIGHTS = ['Works on phones, tablets and laptops', 'Priced by school size, not per learner', 'Priced in KES', 'Backup and restore built in', 'Switch modules on or off'];
const whatsappIcon = (size = 24) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 3.5a12 12 0 0 0-10.2 18.3L4 28l6.4-1.7A12 12 0 1 0 16 3.5Z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12.1 10.1c-.4-.8-.8-.8-1.2-.8h-.9c-.3 0-.8.1-1.2.6-.4.4-1.5 1.4-1.5 3.4s1.5 3.9 1.7 4.2c.2.3 2.9 4.6 7.1 6.2 3.5 1.4 4.2 1.1 5 .9.8-.2 2.5-1 2.8-2 .4-1 .4-1.8.2-2-.1-.2-.4-.3-.9-.6-.5-.2-2.5-1.2-2.9-1.3-.4-.2-.7-.2-1 .2-.3.5-1.1 1.3-1.4 1.6-.3.3-.5.4-1 .1-.5-.2-1.9-.7-3.6-2.3-1.3-1.1-2.2-2.5-2.4-2.9-.3-.5 0-.7.2-.9.2-.2.5-.6.7-.8.2-.3.3-.5.5-.8.1-.3 0-.6-.1-.8-.1-.2-.9-2.2-1.3-3Z" fill="currentColor" transform="translate(2 0) scale(.86 1)"/></svg>`;
const contactIcons = {
  phone: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a15 15 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/></svg>',
  email: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>',
  website: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
};

let hashListener = null;
let installPrompt;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    document.querySelectorAll('[data-install-app]').forEach((button) => button.classList.remove('hidden'));
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = undefined;
    document.querySelectorAll('[data-install-app]').forEach((button) => button.classList.add('hidden'));
  });
}

export function stopPublic() {
  if (hashListener) window.removeEventListener('hashchange', hashListener);
  hashListener = null;
}

function parseHash() {
  const raw = window.location.hash.slice(1) || '/';
  const [path, queryPart] = raw.split('?');
  const query = {};
  if (queryPart) new URLSearchParams(queryPart).forEach((v, k) => (query[k] = v));
  return { path: path || '/', query };
}

export function renderPublic(rootEl, { onAuthenticated, onAdminAuthenticated }) {
  stopPublic();
  const draw = () => {
    const { path, query } = parseHash();
    if (path === '/login') renderLogin(rootEl, onAuthenticated, onAdminAuthenticated);
    else if (path === '/signup') renderSignup(rootEl, query, onAuthenticated);
    else if (path === '/forgot') renderForgotPassword(rootEl);
    else if (path === '/join') renderJoinSchool(rootEl, query, onAuthenticated);
    else if (path === '/admin') renderAdminAccess(rootEl, onAdminAuthenticated);
    else if (path === '/privacy' || path === '/terms' || path === '/processing') renderLegalPage(rootEl, path.slice(1));
    else renderLanding(rootEl);
    window.scrollTo && window.scrollTo(0, 0);
  };
  hashListener = draw;
  window.addEventListener('hashchange', hashListener);
  draw();
}

function wireScrollLinks(rootEl) {
  on(rootEl, '[data-scroll]', 'click', (e) => {
    const target = rootEl.querySelector(`#${e.currentTarget.getAttribute('data-scroll')}`);
    if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function planCardHtml(plan) {
  const cat = getCatalogue();
  const publicName = plan.publicName || plan.name;
  const included = MODULES.filter((m) => !m.pack && !m.essential && plan.modules?.[m.key]);
  const core = cat.packages.find((p) => p.publicName === 'Core package' || p.id === 'micro');
  const coreModules = new Set(MODULES.filter((m) => !m.pack && (m.essential || core?.modules?.[m.key])).map((m) => m.key));
  const addsComparedToCore = plan.id !== core?.id && included.filter((m) => !coreModules.has(m.key));
  const coreFeatures = new Set(MODULE_FEATURES.filter((f) => core?.features?.[f.key]).map((f) => f.key));
  const addsFeatures = plan.id !== core?.id ? MODULE_FEATURES.filter((f) => plan.features?.[f.key] && !coreFeatures.has(f.key)) : [];
  const prices = cat.publicPricingVisible
    ? (plan.custom
      ? '<li><span>Price</span><strong>Quotation</strong></li>'
      : enabledBilling(cat).map(([k, l]) => `<li><span>${escapeHtml(l)}</span><strong>${escapeHtml(priceText(plan, k, cat.currency))}</strong></li>`).join(''))
    : '<li><span>Pricing</span><strong>Contact us for a quote</strong></li>';
  return `
    <div class="plan-card" data-plan-card="${plan.id}">
      <h4>${escapeHtml(publicName)}</h4>
      <p class="plan-pop">${escapeHtml(plan.publicDescription || 'A connected set of tools for your school.')}</p>
      <ul class="plan-fees">${prices}</ul>
      <p class="plan-pop">Core student and academic records, plus:</p>
      <ul class="plan-fees" style="margin-top:.75rem;">${(addsComparedToCore.length ? addsComparedToCore : included).map((m) => `<li><span>${escapeHtml(m.label)}${m.soon ? ' (coming soon)' : ''}${addsComparedToCore.length ? ' — adds over Core' : ''}</span></li>`).join('') || '<li><span>Core package capabilities</span></li>'}${addsFeatures.slice(0, 8).map((f) => `<li><span>${escapeHtml(f.label)} — adds over Core</span></li>`).join('')}${addsFeatures.length > 8 ? `<li><span>And ${addsFeatures.length - 8} more advanced capabilities</span></li>` : ''}</ul>
      <button class="btn ${plan.id === 'professional' ? 'btn-primary' : 'btn-secondary'}" type="button" data-select-package="${escapeHtml(plan.id)}">Request a quote</button>
    </div>
  `;
}

function addonsHtml() {
  const cat = getCatalogue(); const list = cat.addons.filter((a) => a.active); if (!list.length) return '';
  return `<div class="cmp-addons"><h3 style="margin-top:2rem;">Optional packs</h3><p class="pub-section-lead" style="margin-bottom:.75rem;">Choose only the extras your school needs. They are added to your selected core package.</p><div class="plan-grid">${list.map((a) => `<label class="plan-card pack-card"><span class="pack-check"><input type="checkbox" data-quote-addon="${escapeHtml(a.id)}" /> Select pack</span><h4>${escapeHtml(a.publicName || a.name)}</h4><p class="plan-pop">${escapeHtml(a.description ?? '')}</p>${cat.publicPricingVisible ? `<ul class="plan-fees">${enabledBilling(cat).map(([k, l]) => `<li><span>${escapeHtml(l)}</span><strong>${escapeHtml(a.prices?.[k] == null ? 'Price on request' : `${cat.currency} ${Number(a.prices[k]).toLocaleString('en-US')}`)}</strong></li>`).join('')}</ul>` : ''}</label>`).join('')}</div></div>`;
}

function renderLanding(rootEl) {
  rootEl.innerHTML = `
    <div class="pub">
      ${headerHtml(true)}

      <section class="pub-hero">
        <div class="hero-orbs" aria-hidden="true">
          <span class="hero-orb hero-orb-1"></span>
          <span class="hero-orb hero-orb-2"></span>
          <span class="hero-orb hero-orb-3"></span>
        </div>
        <div class="pub-container hero-content">
          <p class="pub-eyebrow hero-in" style="animation-delay:0ms;">SwiftIQ Enterprise · School management, made simple</p>
          <h1 class="hero-in" style="animation-delay:70ms;">One School. One Flow. <span>Everything Connected.</span></h1>
          <p class="pub-lead hero-in" style="animation-delay:140ms;">Admissions, attendance, exams, fees and more — one system for your whole school, built for phones as much as desktops.</p>
          <div class="pub-cta hero-in" style="animation-delay:210ms;">
            <a class="btn btn-primary" href="#/signup">Create your school account</a>
            <a class="btn btn-hero-secondary" href="#/login">Log in</a>
            <button class="btn btn-hero-secondary hidden" data-install-app type="button">Install app</button>
          </div>
          <ul class="pub-highlights hero-in" style="animation-delay:280ms;">${HIGHLIGHTS.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>
          <p class="pub-footnote hero-in" style="animation-delay:330ms;">Parents: your school administrator sends an invitation. After joining, use <a href="#/login">Log in</a> to view your child’s published report cards and fees.</p>
        </div>
      </section>

      <section class="pub-section pub-alt" id="about">
        <div class="pub-container">
          <h2 class="reveal">Built around the way schools work</h2>
          <p class="pub-section-lead">SwiftIQ EduFlow brings school operations into one connected workspace. Teams can manage day-to-day work from a phone, tablet or computer, while role-based access helps keep school information in the right hands.</p>
          <div class="feature-grid">
            <article class="feature-card"><h3>One connected record</h3><p>Keep student, academic and finance workflows connected instead of repeating the same work in separate tools.</p></article>
            <article class="feature-card"><h3>Designed for real school teams</h3><p>Give staff practical tools for admissions, attendance, learning, communication and administration.</p></article>
            <article class="feature-card"><h3>Flexible as you grow</h3><p>Configure modules and package options around your school’s needs with support from the SwiftIQ team.</p></article>
          </div>
        </div>
      </section>

      <section class="pub-section" id="features">
        <div class="pub-container">
          <h2 class="reveal">Everything your school runs on</h2>
          <p class="pub-section-lead">Every module works together, so a student is entered once and follows through admissions, class, exams and fees.</p>
          <div class="feature-grid reveal-stagger reveal">
            ${FEATURES.map(
              ([icon, title, body]) => `
              <div class="feature-card">
                <div class="feature-icon">${icons[icon](22)}</div>
                <h3>${escapeHtml(title)}</h3>
                <p>${escapeHtml(body)}</p>
              </div>`
            ).join('')}
          </div>
          <p class="pub-soon">Coming soon: school health records (allergies, sick bay, medication), once the secure cloud version is live.</p>
        </div>
      </section>

      <section class="pub-section pub-alt" id="how">
        <div class="pub-container">
          <h2 class="reveal">Up and running in three steps</h2>
          <div class="steps-grid reveal-stagger reveal">
            <div class="step"><span>1</span><h3>Sign up</h3><p>Register your school and tell us what package options you are interested in.</p></div>
            <div class="step"><span>2</span><h3>Set up your school</h3><p>A short guided setup covers your classes, streams, subjects, terms and curriculum.</p></div>
            <div class="step"><span>3</span><h3>Run your school</h3><p>Add students and staff, take attendance, enter marks and record fees from day one.</p></div>
          </div>
        </div>
      </section>

      <section class="pub-section" id="pricing">
        <div class="pub-container">
          <h2 class="reveal">Packages that fit your school</h2>
          <p class="pub-section-lead">Start with a core package and add optional packs as needed. Contact us for a tailored quotation.</p>
          <p id="public-catalogue-status" class="notice" role="status">Loading package options…</p>
          <div id="plan-groups"></div>
          <div id="plan-addons"></div>
          <div class="card card-p quote-form hidden" id="quote-request">
            <h3>Request a package quotation</h3>
            <p class="pub-section-lead">Tell us how to reach you. Your selection will be included in an email or WhatsApp message for the SwiftIQ team.</p>
            <div class="grid sm-grid-2 gap-3">
              <div><label class="label" for="quote-name">Your name</label><input class="input" id="quote-name" autocomplete="name" required /></div>
              <div><label class="label" for="quote-school">School name</label><input class="input" id="quote-school" required /></div>
              <div><label class="label" for="quote-email">Email</label><input class="input" id="quote-email" type="email" autocomplete="email" required /></div>
              <div><label class="label" for="quote-phone">Phone (optional)</label><input class="input" id="quote-phone" type="tel" autocomplete="tel" /></div>
            </div>
            <div><label class="label" for="quote-message">Anything else we should know? (optional)</label><textarea class="input" id="quote-message" rows="3"></textarea></div>
            <p id="quote-summary" class="plan-summary" aria-live="polite"></p>
            <p id="quote-error" class="field-error" role="alert"></p>
            <div class="pub-cta"><button class="btn btn-primary" type="button" id="quote-email-send">Request by email</button><button class="btn btn-secondary" type="button" id="quote-whatsapp-send">Request by WhatsApp</button></div>
          </div>
          <p class="pub-note">Setup, training, data migration, SMS, WhatsApp, payment processing and custom development may be quoted separately.</p>
        </div>
      </section>

      <section class="pub-band">
        <div class="pub-container">
          <h2>Ready to bring your school together?</h2>
          <a class="btn btn-primary" href="#/signup">Create your school account</a>
        </div>
      </section>

      <section class="pub-section pub-alt" id="parent-portal">
        <div class="pub-container">
          <h2 class="reveal">A clear view for parents</h2>
          <p class="pub-section-lead">Parents can securely sign in to see only their linked children, including published report cards, attendance, invoices, payments and balances.</p>
          <div class="pub-cta"><a class="btn btn-secondary" href="#/login">Parent / school login</a><a class="btn btn-primary" href="#/signup">Register a school</a></div>
          <p class="pub-note">The school administrator must create or invite the parent account and link it to the correct learner. Parents cannot view another child’s records.</p>
        </div>
      </section>

      <section class="pub-section pub-alt" id="contact">
        <div class="pub-container">
          <h2>Talk to SwiftIQ</h2>
          <p class="pub-section-lead">Questions about packages, onboarding or a demonstration? Our team can help.</p>
          <div class="contact-grid">
            <a class="contact-option" href="https://wa.me/254742210099" target="_blank" rel="noopener"><span class="contact-icon whatsapp-icon" aria-hidden="true">${whatsappIcon(26)}</span><span><strong>WhatsApp</strong><small>Chat with our team</small></span></a>
            <a class="contact-option" href="tel:+254742210099"><span class="contact-icon">${contactIcons.phone}</span><span><strong>Call</strong><small>0742 210 099</small></span></a>
            <a class="contact-option" href="mailto:swiftiqenterprise@gmail.com"><span class="contact-icon">${contactIcons.email}</span><span><strong>Email</strong><small>swiftiqenterprise@gmail.com</small></span></a>
            <a class="contact-option" href="https://swiftiqenterprise.co.ke" target="_blank" rel="noopener"><span class="contact-icon">${contactIcons.website}</span><span><strong>Website</strong><small>swiftiqenterprise.co.ke</small></span></a>
          </div>
        </div>
      </section>

      <footer class="pub-footer">
        <div class="pub-container">
          <p>SwiftIQ Enterprise · SwiftIQ EduFlow · One School. One Flow. Everything Connected.</p>
          <p class="pub-footnote">SwiftIQ Enterprise · Nairobi, Kenya · <a href="https://wa.me/254742210099" target="_blank" rel="noopener">WhatsApp / Call: 0742 210 099</a> · <a href="mailto:swiftiqenterprise@gmail.com">swiftiqenterprise@gmail.com</a> · <a href="https://swiftiqenterprise.co.ke" target="_blank" rel="noopener">swiftiqenterprise.co.ke</a></p>
          <p class="pub-footnote">${legalLinksHtml()}</p>
          ${isSupabaseConfigured() ? '' : '<p class="pub-footnote">Your school’s data is saved in this browser on this device. Use the same browser to come back to it, and download a backup regularly from Settings.</p>'}
          <p class="pub-footnote"><a href="#/admin" style="color:inherit;">Platform administrator</a></p>
        </div>
      </footer>
      <a class="whatsapp-float" href="https://wa.me/254742210099" target="_blank" rel="noopener" aria-label="Chat with SwiftIQ on WhatsApp">${whatsappIcon(30)}</a>
    </div>
  `;

  function drawPricing() {
    const visible = allPlans().filter((p) => p.publicVisible !== false);
    qs(rootEl, '#plan-groups').innerHTML = visible.length
      ? `<div class="plan-grid reveal-stagger reveal">${visible.map((p) => planCardHtml(p)).join('')}</div>`
      : '<p class="notice">Package options are being updated. Please contact SwiftIQ for assistance.</p>';
    qs(rootEl, '#plan-addons').innerHTML = addonsHtml();
    return visible.length > 0;
  }

  wireScrollLinks(rootEl);
  const updateQuote = () => {
    const packageId = rootEl.querySelector('[data-quote-package]:checked')?.value ?? rootEl.querySelector('[data-selected-package]')?.value ?? allPlans().find((p) => p.publicVisible !== false)?.id ?? allPlans()[0]?.id;
    const addons = [...rootEl.querySelectorAll('[data-quote-addon]:checked')].map((input) => input.dataset.quoteAddon);
    const quote = buildQuote({ packageId, billing: enabledBilling(getCatalogue())[0]?.[0] ?? 'annual', addons });
    const labels = [getCatalogue().packages.find((p) => p.id === packageId)?.publicName ?? getCatalogue().packages.find((p) => p.id === packageId)?.name, ...addons.map((id) => getCatalogue().addons.find((a) => a.id === id)?.publicName ?? getCatalogue().addons.find((a) => a.id === id)?.name)].filter(Boolean);
    qs(rootEl, '#quote-summary').textContent = `Selected: ${labels.join(' + ') || 'Choose a package'}${getCatalogue().publicPricingVisible && quote.ok && !quote.needsQuotation ? ` · indicative total ${money(getCatalogue(), quote.total)}` : ''}`;
  };
  on(rootEl, '[data-select-package]', 'click', (e) => {
    rootEl.querySelectorAll('[data-selected-package]').forEach((input) => input.remove());
    const input = document.createElement('input');
    input.type = 'hidden';
    input.dataset.selectedPackage = 'true';
    input.value = e.currentTarget.dataset.selectPackage;
    qs(rootEl, '#quote-request').append(input);
    qs(rootEl, '#quote-request').scrollIntoView({ behavior: 'smooth', block: 'center' });
    updateQuote();
  });
  on(rootEl, '[data-quote-addon]', 'change', updateQuote);
  const loadPricing = async () => {
    const status = qs(rootEl, '#public-catalogue-status');
    status.classList.remove('hidden', 'field-error');
    status.setAttribute('role', 'status');
    status.textContent = 'Loading package options…';
    try {
      await loadPublicCatalogue();
      qs(rootEl, '#public-catalogue-status').classList.add('hidden');
      const hasPublicPackages = drawPricing();
      if (hasPublicPackages) {
        qs(rootEl, '#quote-request').classList.remove('hidden');
        updateQuote();
      }
      revealOnScroll(rootEl);
    } catch (error) {
      status.classList.add('field-error');
      status.setAttribute('role', 'alert');
      status.textContent = `Package options could not be loaded. Please try again later or contact SwiftIQ directly. (${error.message})`;
      const retry = document.createElement('button');
      retry.className = 'btn-secondary btn-sm';
      retry.type = 'button';
      retry.textContent = 'Try again';
      retry.addEventListener('click', loadPricing);
      status.append(' ', retry);
    }
  };
  loadPricing();
  const sendQuote = (channel) => {
    const name = qs(rootEl, '#quote-name').value.trim();
    const school = qs(rootEl, '#quote-school').value.trim();
    const email = qs(rootEl, '#quote-email').value.trim();
    const phone = qs(rootEl, '#quote-phone').value.trim();
    const message = qs(rootEl, '#quote-message').value.trim();
    const error = qs(rootEl, '#quote-error');
    error.textContent = '';
    if (!name || !school || !/^\S+@\S+\.\S+$/.test(email)) {
      error.textContent = 'Enter your name, school name and a valid email address.';
      return;
    }
    const packageId = rootEl.querySelector('[data-selected-package]')?.value ?? allPlans().find((p) => p.publicVisible !== false)?.id ?? allPlans()[0]?.id;
    const addons = [...rootEl.querySelectorAll('[data-quote-addon]:checked')].map((input) => input.dataset.quoteAddon);
    const cat = getCatalogue();
    const pkg = cat.packages.find((p) => p.id === packageId);
    if (!pkg) {
      error.textContent = 'Select an available package before requesting a quote.';
      return;
    }
    const addonNames = addons.map((id) => cat.addons.find((a) => a.id === id)?.publicName ?? cat.addons.find((a) => a.id === id)?.name).filter(Boolean);
    const body = [
      'EduFlow package quotation request',
      `Name: ${name}`,
      `School: ${school}`,
      `Email: ${email}`,
      phone ? `Phone: ${phone}` : '',
      `Package: ${pkg.publicName || pkg.name}`,
      `Optional packs: ${addonNames.join(', ') || 'None selected'}`,
      message ? `Message: ${message}` : '',
    ].filter(Boolean).join('\n');
    const href = channel === 'email'
      ? `mailto:swiftiqenterprise@gmail.com?subject=${encodeURIComponent('EduFlow package quotation request')}&body=${encodeURIComponent(body)}`
      : `https://wa.me/254742210099?text=${encodeURIComponent(body)}`;
    window.open(href, '_blank', 'noopener');
  };
  qs(rootEl, '#quote-email-send').addEventListener('click', () => sendQuote('email'));
  qs(rootEl, '#quote-whatsapp-send').addEventListener('click', () => sendQuote('whatsapp'));
  updateQuote();
  revealOnScroll(rootEl);
  if (installPrompt) rootEl.querySelectorAll('[data-install-app]').forEach((button) => button.classList.remove('hidden'));
  rootEl.querySelectorAll('[data-install-app]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = undefined;
      rootEl.querySelectorAll('[data-install-app]').forEach((item) => item.classList.add('hidden'));
    });
  });
}

function renderLogin(rootEl, onAuthenticated, onAdminAuthenticated) {
  const state = { email: '', error: '', busy: false };

  function draw() {
    rootEl.innerHTML = authShell(
      'Log in',
      'Sign in to your school or administrator account.',
      `
      <div class="space-y-4">
        <div>
          <label class="label" for="li-email">Email or username</label>
          <input class="input" id="li-email" type="text" autocomplete="username" autocapitalize="none" value="${escapeHtml(state.email)}" ${state.busy ? 'disabled' : ''} />
        </div>
        <div>
          <label class="label" for="li-password">Password</label>
          <input class="input" id="li-password" type="password" autocomplete="current-password" ${state.busy ? 'disabled' : ''} />
        </div>
        ${state.error ? `<p class="field-error" id="li-error" role="alert">${escapeHtml(state.error)}</p>` : ''}
        <button class="btn btn-primary w-full" id="li-submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Signing in...' : 'Log in'}</button>
        <p class="auth-switch">${isSupabaseConfigured() ? '<a href="#/forgot">Forgot your password?</a>' : 'Forgot your password? Ask your school administrator to reset it, or contact SwiftIQ support.'}</p>
        <p class="auth-switch">New here? <a href="#/signup">Create a school account</a></p>
        ${isSupabaseConfigured() ? '<p class="auth-switch">Invited by your school? <a href="#/join">Join with your invitation code</a></p>' : ''}
      </div>`,
      { showStorageNote: !isSupabaseConfigured() }
    );

    const submit = async () => {
      state.email = qs(rootEl, '#li-email').value;
      const password = qs(rootEl, '#li-password').value;
      if (isSupabaseConfigured()) {
        state.busy = true;
        state.error = '';
        draw();
        try {
          const result = await signInWithSupabase(state.email, password);
          if (!result.ok) throw new Error(result.error);
          if (result.kind === 'platform-admin') onAdminAuthenticated();
          else onAuthenticated();
        } catch (error) {
          state.busy = false;
          state.error = error.message;
          draw();
        }
        return;
      }
      const adminResult = adminLogin(state.email, password);
      if (adminResult.ok) {
        onAdminAuthenticated();
        return;
      }
      const schoolResult = login(state.email, password);
      if (!schoolResult.ok) {
        state.error = schoolResult.error;
        draw();
        return;
      }
      onAuthenticated();
    };
    qs(rootEl, '#li-submit').addEventListener('click', submit);
    on(rootEl, 'input', 'keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }
  draw();
}

function recommendPublicPackage(studentCount) {
  const plans = allPlans();
  if (!plans.length) return undefined;
  const count = Number(studentCount);
  const fixed = plans.filter((plan) => !plan.custom && plan.paidLimit != null).sort((a, b) => a.paidLimit - b.paidLimit);
  if (Number.isFinite(count) && count > 0) {
    return fixed.find((plan) => count <= plan.paidLimit) ?? plans.find((plan) => plan.custom) ?? fixed.at(-1) ?? plans[0];
  }
  return fixed[0] ?? plans[0];
}

function renderSignup(rootEl, query, onAuthenticated) {
  const chosen = allPlans().find((plan) => plan.id === query.plan && plan.publicVisible !== false);
  const hasExplicitPlan = Boolean(chosen);
  const state = {
    name: '',
    schoolName: '',
    email: '',
    phone: '',
    studentCount: '',
    password: '',
    confirmPassword: '',
    planId: chosen?.id ?? recommendPublicPackage('')?.id ?? '',
    billing: (enabledBilling(getCatalogue()).find(([k]) => k === 'annual') ?? enabledBilling(getCatalogue())[0] ?? ['annual'])[0],
    acceptedTerms: false,
    legalVersion: LEGAL_VERSION,
    adoptLegacy: legacyDataAvailable(),
    errors: [],
    serverError: '',
    success: '',
    busy: false,
    catalogueReady: !isSupabaseConfigured() || hasPublicCatalogueLoaded(),
  };
  if (state.adoptLegacy && legacySchoolName()) state.schoolName = legacySchoolName();

  const errorFor = (field) => state.errors.find((e) => e.field === field)?.message;
  const fieldError = (field) => (errorFor(field) ? `<p class="field-error">${escapeHtml(errorFor(field))}</p>` : '');

  function draw() {
    const plan = getPlan(state.planId);
    const isPublicPlan = Boolean(plan && plan.publicVisible !== false);
    const quote = buildQuote({ packageId: state.planId, billing: state.billing });
    rootEl.innerHTML = authShell(
      'Create your school account',
      isSupabaseConfigured()
        ? 'Register your school. Your account remains pending until the platform administrator reviews it.'
        : 'Tell us about you and your school. Your account is activated once your package invoice is paid and approved.',
      `
      <div class="space-y-4">
        ${state.serverError ? `<p class="field-error" role="alert">${escapeHtml(state.serverError)}</p>` : ''}
        ${state.success ? `<div class="notice" role="status"><span>${escapeHtml(state.success)}</span></div>` : ''}
        ${
          legacyDataAvailable() && !isSupabaseConfigured()
            ? `<label class="notice">
                <input type="checkbox" id="su-legacy" ${state.adoptLegacy ? 'checked' : ''} />
                <span>We found school data${legacySchoolName() ? ` for <strong>${escapeHtml(legacySchoolName())}</strong>` : ''} saved in this browser before accounts existed. Attach it to this new account.</span>
              </label>`
            : ''
        }
        <div class="grid sm-grid-2 gap-4">
          <div>
            <label class="label" for="su-name">Your full name</label>
            <input class="input ${errorFor('name') ? 'error' : ''}" id="su-name" autocomplete="name" value="${escapeHtml(state.name)}" />
            ${fieldError('name')}
          </div>
          <div>
            <label class="label" for="su-school">School name</label>
            <input class="input ${errorFor('schoolName') ? 'error' : ''}" id="su-school" value="${escapeHtml(state.schoolName)}" />
            ${fieldError('schoolName')}
          </div>
        </div>
        <div class="grid sm-grid-2 gap-4">
          <div>
            <label class="label" for="su-email">Email</label>
            <input class="input ${errorFor('email') ? 'error' : ''}" id="su-email" type="email" autocomplete="email" value="${escapeHtml(state.email)}" />
            ${fieldError('email')}
          </div>
          <div>
            <label class="label" for="su-phone">Phone (optional)</label>
            <input class="input" id="su-phone" type="tel" autocomplete="tel" value="${escapeHtml(state.phone)}" />
          </div>
        </div>
        <div>
          <label class="label" for="su-students">Approximate number of students (optional)</label>
          <input class="input ${errorFor('studentCount') ? 'error' : ''}" id="su-students" type="number" min="1" inputmode="numeric" value="${escapeHtml(state.studentCount)}" style="max-width:14rem;" />
          ${fieldError('studentCount')}
        </div>
        <div class="grid sm-grid-2 gap-4">
          <div>
            <label class="label" for="su-password">Password</label>
            <input class="input ${errorFor('password') ? 'error' : ''}" id="su-password" type="password" autocomplete="new-password" value="${escapeHtml(state.password)}" />
            ${fieldError('password')}
          </div>
          <div>
            <label class="label" for="su-confirm">Confirm password</label>
            <input class="input ${errorFor('confirmPassword') ? 'error' : ''}" id="su-confirm" type="password" autocomplete="new-password" value="${escapeHtml(state.confirmPassword)}" />
            ${fieldError('confirmPassword')}
          </div>
        </div>
        <div>
          <p class="label">Recommended package</p>
          <p class="plan-summary">${escapeHtml(!plan ? 'No package is currently available for online registration. Please contact SwiftIQ.' : isPublicPlan ? plan.publicName || plan.name : 'Your best-fit package will be confirmed by SwiftIQ.')}</p>
          <input type="hidden" id="su-plan" value="${escapeHtml(state.planId)}" />
          <p class="text-xs text-ink-500">${plan ? 'The package recommendation updates from your approximate student count; internal capacity ranges are not shown.' : '<a href="mailto:swiftiqenterprise@gmail.com">Contact SwiftIQ</a> for package options.'}</p>
          ${fieldError('planId')}
        </div>
        <div>
          <p class="label">Billing</p>
          <div class="space-y-2">
            ${enabledBilling(getCatalogue()).map(([v, label]) => `<label class="flex items-center gap-2 text-sm"><input type="radio" name="su-billing" value="${v}" ${state.billing === v ? 'checked' : ''} /> ${escapeHtml(label)}${getCatalogue().publicPricingVisible && isPublicPlan && !plan.custom ? ` — ${escapeHtml(priceText(plan, v))}` : ''}</label>`).join('')}
          </div>
          <p class="plan-summary">${!getCatalogue().publicPricingVisible || !isPublicPlan || plan?.custom || quote.needsQuotation ? 'Package pricing will be confirmed by SwiftIQ.' : `Total payable: ${escapeHtml(money(getCatalogue(), quote.total))} ${escapeHtml((BILLING_LABEL[state.billing] ?? '').toLowerCase())}. Setup and other services are charged separately.`}</p>
        </div>
        <div>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" id="su-terms" ${state.acceptedTerms ? 'checked' : ''} />
            <span>I have read and accept the <a href="#/terms" target="_blank" rel="noopener">Terms of Service</a>, the <a href="#/privacy" target="_blank" rel="noopener">Privacy Notice</a> and the <a href="#/processing" target="_blank" rel="noopener">Data Processing Terms</a>, on behalf of my school.${isSupabaseConfigured() ? '' : ' I understand that in this demonstration my school’s data is saved only in this browser on this device.'}</span>
          </label>
          ${fieldError('acceptedTerms')}
        </div>
        <button class="btn btn-primary w-full" id="su-submit" ${state.busy || !state.catalogueReady || !plan ? 'disabled' : ''}>${state.busy ? 'Creating account...' : !state.catalogueReady ? 'Loading package options...' : !plan ? 'Contact SwiftIQ' : 'Create account'}</button>
        <p class="auth-switch">Already registered? <a href="#/login">Log in</a></p>
      </div>`,
      { showStorageNote: !isSupabaseConfigured() }
    );
    wire();
  }

  function readInputs() {
    state.name = qs(rootEl, '#su-name').value;
    state.schoolName = qs(rootEl, '#su-school').value;
    state.email = qs(rootEl, '#su-email').value;
    state.phone = qs(rootEl, '#su-phone').value;
    state.studentCount = qs(rootEl, '#su-students').value;
    state.planId = qs(rootEl, '#su-plan').value;
    state.password = qs(rootEl, '#su-password').value;
    state.confirmPassword = qs(rootEl, '#su-confirm').value;
    state.acceptedTerms = qs(rootEl, '#su-terms').checked;
    const legacy = qs(rootEl, '#su-legacy');
    if (legacy) state.adoptLegacy = legacy.checked;
  }

  function wire() {
    on(rootEl, '#su-students', 'input', () => {
      readInputs();
      if (!hasExplicitPlan) state.planId = recommendPublicPackage(state.studentCount)?.id ?? '';
      draw();
    });
    on(rootEl, '[name="su-billing"]', 'change', (e) => {
      readInputs();
      state.billing = e.target.value;
      draw();
    });
    const submit = async () => {
      if (!state.catalogueReady) {
        state.serverError = 'Package options are unavailable. Please try again later or contact SwiftIQ.';
        draw();
        return;
      }
      readInputs();
      state.errors = validateSignup(state).map((error) =>
        isSupabaseConfigured() && error.field === 'acceptedTerms'
          ? { ...error, message: 'Confirm that your registration details will be stored in the SwiftIQ backend.' }
          : error
      );
      if (state.errors.length > 0) {
        draw();
        return;
      }
      if (isSupabaseConfigured()) {
        state.busy = true;
        state.serverError = '';
        draw();
        try {
          const result = await registerSchoolWithSupabase(state);
          if (!result.ok) throw new Error(result.error);
          if (result.requiresEmailConfirmation) {
            state.busy = false;
            state.success = 'Registration created. Confirm your email address, then log in to view its approval status.';
            state.password = '';
            state.confirmPassword = '';
            draw();
            return;
          }
          onAuthenticated();
        } catch (error) {
          state.busy = false;
          state.serverError = error.message;
          draw();
        }
        return;
      }
      register(state);
      onAuthenticated();
    };
    qs(rootEl, '#su-submit').addEventListener('click', submit);
  }

  draw();
  loadPublicCatalogue().then(() => {
    state.catalogueReady = true;
    if (!state.busy && !state.success) {
      readInputs();
      if (!hasExplicitPlan) state.planId = recommendPublicPackage(state.studentCount)?.id ?? '';
      draw();
    }
  }).catch((error) => {
    state.catalogueReady = false;
    state.serverError = `Package options could not be loaded. Please try again later or contact SwiftIQ. (${error.message})`;
    draw();
  });
}

// ---------------------------------------------------------------- password reset (cloud mode)
function renderForgotPassword(rootEl) {
  const state = { sent: false, busy: false, error: '' };
  if (!isSupabaseConfigured()) {
    rootEl.innerHTML = authShell('Reset your password', 'Password reset by email is available in the cloud version only.', '<p class="auth-switch"><a href="#/login">Back to log in</a></p>', { showStorageNote: false });
    return;
  }
  function draw() {
    rootEl.innerHTML = authShell('Reset your password', 'We will email you a link to choose a new password.', state.sent
      ? `<p class="text-sm" role="status">If that email belongs to an account, a reset link is on its way. Check your inbox and spam folder. The link works once and expires soon.</p><p class="auth-switch"><a href="#/login">Back to log in</a></p>`
      : `<div class="space-y-4">
          <div><label class="label" for="fp-email">Email</label><input class="input" id="fp-email" type="email" autocomplete="email" /></div>
          ${state.error ? `<p class="field-error" role="alert">${escapeHtml(state.error)}</p>` : ''}
          <button class="btn btn-primary w-full" id="fp-submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Sending...' : 'Send reset link'}</button>
          <p class="auth-switch"><a href="#/login">Back to log in</a></p></div>`, { showStorageNote: false });
    qs(rootEl, '#fp-submit')?.addEventListener('click', async () => {
      const email = qs(rootEl, '#fp-email').value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { state.error = 'Enter a valid email address.'; draw(); return; }
      state.busy = true; state.error = ''; draw();
      try { await requestPasswordReset(email); state.sent = true; } catch (e) { state.error = e.message; }
      state.busy = false; draw();
    });
  }
  draw();
}

// Shown when someone opens the emailed link (the page URL carries ?reset=1).
export async function renderSetNewPassword(rootEl, { onDone }) {
  const state = { busy: false, error: '', valid: false };
  state.valid = await hasRecoverySession().catch(() => false);
  function draw() {
    if (!state.valid) {
      rootEl.innerHTML = authShell('This link has expired', 'Reset links work once and expire quickly.', '<p class="auth-switch"><a href="#/forgot" id="rp-again">Request a new link</a></p>', { showStorageNote: false });
      qs(rootEl, '#rp-again').addEventListener('click', () => { window.history.replaceState({}, '', window.location.pathname); onDone(); });
      return;
    }
    rootEl.innerHTML = authShell('Choose a new password', `Use at least ${MIN_PASSWORD_LENGTH} characters.`, `<div class="space-y-4">
        <div><label class="label" for="rp-pw">New password</label><input class="input" id="rp-pw" type="password" autocomplete="new-password" /></div>
        <div><label class="label" for="rp-pw2">Confirm new password</label><input class="input" id="rp-pw2" type="password" autocomplete="new-password" /></div>
        ${state.error ? `<p class="field-error" role="alert">${escapeHtml(state.error)}</p>` : ''}
        <button class="btn btn-primary w-full" id="rp-submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Saving...' : 'Save new password'}</button></div>`, { showStorageNote: false });
    qs(rootEl, '#rp-submit').addEventListener('click', async () => {
      const pw = qs(rootEl, '#rp-pw').value; const pw2 = qs(rootEl, '#rp-pw2').value;
      if (pw.length < MIN_PASSWORD_LENGTH) { state.error = `Use at least ${MIN_PASSWORD_LENGTH} characters.`; draw(); return; }
      if (pw !== pw2) { state.error = 'The two passwords do not match.'; draw(); return; }
      state.busy = true; state.error = ''; draw();
      try { await setNewPassword(pw); window.history.replaceState({}, '', window.location.pathname); window.location.hash = '#/login'; onDone(); }
      catch (e) { state.busy = false; state.error = e.message; draw(); }
    });
  }
  draw();
}
