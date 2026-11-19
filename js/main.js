import { isSetupComplete } from './services/schoolService.js';
import { restoreSession, logout, accountStatus } from './services/authService.js';
import { restoreAdminSession, adminLogout, touchAdminSession, hasAdminSession } from './services/platformService.js';
import { touchSession, hasSchoolSession } from './services/authService.js';
import { startSessionGuard, mountDemoBanner } from './lib/sessionGuard.js';
import { installA11y } from './components/a11y.js';
import { renderAdminPortal } from './features/admin/adminPortal.js';
import { renderAccountStatus } from './features/account/accountStatus.js';
import { renderPublic, stopPublic, renderSetNewPassword } from './features/public/landing.js';
import { renderSetupWizard } from './features/setup/setupWizard.js';
import { mountShell, refreshShellNav } from './layouts/appShell.js';
import { startRouter, registerRoute, resetRouter } from './router.js';
import { renderDashboard } from './features/dashboard/dashboard.js';
import { renderStudentsList } from './features/students/studentsList.js';
import { renderStudentProfile } from './features/students/studentProfile.js';
import { renderAttendance } from './features/attendance/attendance.js';
import { renderAssessments } from './features/assessments/assessments.js';
import { renderFinance } from './features/finance/finance.js';
import { renderStaffList } from './features/staff/staffList.js';
import { renderTimetable } from './features/timetable/timetable.js';
import { renderCommunication } from './features/communication/communication.js';
import { renderAdmissions } from './features/admissions/admissions.js';
import { renderAcademics } from './features/academics/academics.js';
import { renderDiscipline } from './features/discipline/discipline.js';
import { renderLibrary } from './features/library/library.js';
import { renderTransport } from './features/transport/transport.js';
import { renderInventory } from './features/inventory/inventory.js';
import { renderReportsCenter } from './features/reports/reportsCenter.js';
import { renderDocuments } from './features/documents/documents.js';
import { renderSettings } from './features/settings/settings.js';
import { modulePlaceholder } from './components/emptyState.js';
import { renderActivities } from './features/activities/activities.js';
import { renderHostel } from './features/hostel/hostel.js';
import { renderHealth } from './features/health/health.js';
import { escapeHtml } from './components/dom.js';
import { isSupabaseConfigured } from './config/supabase.js';
import { getSupabaseIdentity, signOutFromSupabase } from './services/supabaseAuthService.js';
import * as supabasePlatformService from './services/supabasePlatformService.js';
import { renderRemoteWorkspace } from './features/remoteWorkspace.js';
import { renderEnterInviteCode } from './features/public/joinSchool.js';
import { renderParentPortal, renderDemoPortal } from './features/parent/parentPortal.js';
import { setCurrentRole } from './services/accessService.js';
import { normalizeRole } from './config/roles.js';
import { renderDataTransfer } from './features/data/dataTransfer.js';
import { renderSubscription } from './features/subscription/subscription.js';
import { renderWorkspace } from './features/academics/workspace.js';
import { loadSubscriptionContext } from './services/subscriptionService.js';
import { setTeacherIdentity } from './services/teacherService.js';

const appRoot = document.getElementById('app');

// Signs a browser-local session out when it has been idle too long or lived too long.
// (Cloud sessions are governed by Supabase auth tokens; this only covers demo mode.)
function armSessionGuard() {
  if (isSupabaseConfigured()) return;
  startSessionGuard({
    touch: () => { touchSession(); touchAdminSession(); },
    // restoreSession / restoreAdminSession clear an expired session and return nothing.
    check: () => !((hasSchoolSession() && !restoreSession()) || (hasAdminSession() && !restoreAdminSession())),
    onExpire: () => { logout(); adminLogout(); boot(); },
  });
}

// Every sign-in, sign-out and finished setup comes back through here, which
// decides what to show: the public site, the first-time setup, or the app.
// Lets the app open with no connection (https or localhost only). Silent if the browser can't.
function registerOfflineShell() {
  if (!('serviceWorker' in navigator)) return;
  const secure = window.location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (secure) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

async function boot() {
  stopPublic();
  resetRouter();
  if (isSupabaseConfigured() && new URLSearchParams(window.location.search).get('reset') === '1') {
    await renderSetNewPassword(appRoot, { onDone: boot });
    return;
  }
  mountDemoBanner();
  armSessionGuard();
  if (isSupabaseConfigured()) {
    let identity;
    try {
      identity = await getSupabaseIdentity();
    } catch (error) {
      appRoot.innerHTML = `<main class="pub-container auth-wrap"><div class="auth-card"><h1>Backend unavailable</h1><p class="auth-sub">${escapeHtml(String(error.message ?? 'Could not connect to the backend.'))}</p></div></main>`;
      return;
    }
    // Signed in (e.g. just confirmed their email) but not yet part of a school.
    if (identity.noSchool) {
      setCurrentRole(null);
      renderEnterInviteCode(appRoot, { email: identity.user.email, onJoined: boot, onLogout: leaveSupabaseSchool });
      return;
    }
    if (identity.ok && identity.kind === 'platform-admin') {
      setCurrentRole(null);
      const admin = {
        id: identity.user.id,
        name: identity.user.user_metadata?.full_name ?? identity.user.email,
        email: identity.user.email,
      };
      renderAdminPortal(appRoot, {
        admin,
        platformService: supabasePlatformService,
        onLogout: leaveSupabaseAdmin,
      });
      return;
    }
    if (identity.ok && identity.kind === 'school') {
      setCurrentRole(normalizeRole(identity.role));
      setTeacherIdentity({ id: identity.user?.id ?? identity.userId, email: identity.user?.email ?? identity.email });
      if (normalizeRole(identity.role) === 'parent') {
        if (identity.school.status === 'approved') { renderParentPortal(appRoot, { onLogout: leaveSupabaseSchool }); return; }
      }
      if (identity.school.status === 'approved' && !identity.school.setupComplete && normalizeRole(identity.role) !== 'school_admin') {
        appRoot.innerHTML = `<main class="pub-container auth-wrap"><div class="auth-card"><h1>Setup in progress</h1><p class="auth-sub">Your school administrator hasn't finished setting up ${escapeHtml(identity.school.schoolName)} yet. Please check back soon.</p><button class="btn btn-secondary" id="setup-logout">Log out</button></div></main>`;
        appRoot.querySelector('#setup-logout').addEventListener('click', leaveSupabaseSchool);
        return;
      }
      if (identity.school.status === 'approved' && !identity.school.setupComplete) {
        renderSetupWizard(appRoot, boot, {
          ...identity.school,
          name: identity.school.schoolName,
          plan: identity.school.plan,
          backend: true,
          onLogout: leaveSupabaseSchool,
        });
        return;
      }
      if (identity.school.status === 'approved' && identity.school.setupComplete) {
        await loadSubscriptionContext();
        renderRemoteWorkspace(appRoot, {
          school: identity.school,
          platformService: supabasePlatformService,
          onLogout: leaveSupabaseSchool,
          onRefresh: boot,
        });
        return;
      }
      renderAccountStatus(appRoot, {
        account: identity.school,
        platformService: supabasePlatformService,
        onLogout: leaveSupabaseSchool,
        onRefresh: boot,
      });
      return;
    }
  }
  // The platform administrator sees the business console only — never a school's data.
  const admin = isSupabaseConfigured() ? null : restoreAdminSession();
  if (admin) {
    renderAdminPortal(appRoot, { admin, onLogout: leaveAdmin });
    return;
  }
  const account = isSupabaseConfigured() ? null : restoreSession();
  if (!account) {
    renderPublic(appRoot, { onAuthenticated: enterSchool, onAdminAuthenticated: enterSchool });
    return;
  }
  // A parent or learner login opens the portal and nothing else.
  if (account.role === 'parent' || account.role === 'student') {
    setCurrentRole(account.role);
    await renderDemoPortal(appRoot, account, { onLogout: leaveSchool });
    return;
  }
  // Schools use the system only once approved; until then they see their
  // registration status and invoices.
  if (accountStatus(account) !== 'approved') {
    renderAccountStatus(appRoot, { account, onLogout: leaveSchool, onRefresh: boot });
    return;
  }
  if (!isSetupComplete()) {
    renderSetupWizard(appRoot, boot, {
      name: account.schoolName,
      phone: account.phone,
      email: account.email,
      plan: account.plan,
      onLogout: leaveSchool,
    });
    return;
  }
  await loadSubscriptionContext();
  startApp(account);
}

// Clears the public-site address (#/login etc.) without triggering a route
// change, then loads the school that just signed in.
function enterSchool() {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
boot();
}

function leaveAdmin() {
  adminLogout();
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
boot();
}

async function leaveSupabaseAdmin() {
  await signOutFromSupabase();
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
boot();
}

async function leaveSupabaseSchool() {
  await signOutFromSupabase();
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
boot();
}

function leaveSchool() {
  logout();
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
boot();
}

function startApp(account) {
  const contentEl = mountShell(appRoot, { account, onLogout: leaveSchool });

  registerRoute('/', renderDashboard);
  registerRoute('/students', renderStudentsList);
  registerRoute('/students/:id', renderStudentProfile);
  registerRoute('/attendance', renderAttendance);
  registerRoute('/exams', renderAssessments);
  registerRoute('/finance', renderFinance);
  registerRoute('/staff', renderStaffList);
  registerRoute('/timetable', renderTimetable);
  registerRoute('/communication', renderCommunication);
  registerRoute('/admissions', renderAdmissions);
  registerRoute('/academics', renderAcademics);
  registerRoute('/discipline', renderDiscipline);
  registerRoute('/library', renderLibrary);
  registerRoute('/transport', renderTransport);
  registerRoute('/inventory', renderInventory);
  registerRoute('/reports', renderReportsCenter);
  registerRoute('/documents', renderDocuments);
  registerRoute('/settings', renderSettings);
  registerRoute('/data', renderDataTransfer);
  registerRoute('/subscription', renderSubscription);
  registerRoute('/workspace', renderWorkspace);

  registerRoute('/activities', renderActivities);
  registerRoute('/hostel', renderHostel);
  registerRoute('/health', renderHealth);

  const placeholderRoutes = [];
  placeholderRoutes.forEach(([path, label]) => {
    registerRoute(path, (container) => {
      container.innerHTML = modulePlaceholder(label);
    });
  });

  startRouter(contentEl, () => refreshShellNav());
}

registerOfflineShell();
installA11y(); // names every form control and makes scrollable tables keyboard-reachable, on every screen
boot();
