import { escapeHtml, qs } from '../components/dom.js';
import { canAccessModule, canReadCollection, getCurrentRole, roleLabel } from '../services/accessService.js';
import { loadRemoteReportsWorkspace, remoteFinanceOverview, remoteLibraryOverview, remoteSchoolOverview } from '../services/supabaseReportsService.js';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export function renderRemoteDashboard(container) {
  async function render() {
    container.innerHTML = '<p class="text-sm text-ink-500">Loading school overview...</p>';
    try {
      const data = await loadRemoteReportsWorkspace();
      const school = remoteSchoolOverview(data);
      const finance = remoteFinanceOverview(data, daysAgoISO(30), todayISO());
      const library = remoteLibraryOverview(data);
      const currency = data.school?.currency ?? 'KES';
      container.innerHTML = `
        <div class="space-y-5">
          <div class="flex justify-between items-end flex-wrap gap-3">
            <div><p class="text-sm text-ink-500">${escapeHtml(data.school?.name ?? '')}${getCurrentRole() && getCurrentRole() !== 'school_admin' ? ` · ${escapeHtml(roleLabel())}` : ''}</p><h1 class="text-xl" style="font-weight:600;">Dashboard</h1></div>
            <p class="text-sm text-ink-500">${new Date().toLocaleDateString()}</p>
          </div>
          <div class="grid grid-2 sm-grid-3 lg-grid-4 gap-4">
            ${canReadCollection('students') ? statCard('Active students', school.studentCount) : ''}
            ${canReadCollection('teachers') ? statCard('Active staff', school.staffCount) : ''}
            ${canReadCollection('classes') ? statCard('Classes', school.classCount) : ''}
            ${canReadCollection('invoices') ? statCard('Outstanding fees', `${currency} ${finance.outstandingTotal.toLocaleString()}`) : ''}
            ${canReadCollection('payments') ? statCard('Collected (30 days)', `${currency} ${finance.collected30d.toLocaleString()}`) : ''}
            ${canReadCollection('expenses') ? statCard('Expenses (30 days)', `${currency} ${finance.expenses30d.toLocaleString()}`) : ''}
          </div>
          <div class="grid sm-grid-2 gap-4">
            ${canReadCollection('payments') ? `<section class="card card-p"><div class="flex justify-between items-center mb-3"><h2 class="text-sm text-ink-700" style="font-weight:600;">Recent payments</h2><a class="text-sm text-brand-700" href="#/finance">Finance</a></div>${data.finance.payments.length ? `<div class="space-y-2">${data.finance.payments.slice(0, 6).map((payment) => {
              const student = data.students.find((entry) => entry.id === payment.studentId);
              const studentName = student ? [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ') : 'Student';
              return `<div class="flex justify-between gap-3 text-sm"><span>${escapeHtml(studentName)} · ${escapeHtml(payment.method)}</span><span style="font-weight:500;white-space:nowrap;">${currency} ${Number(payment.amount).toLocaleString()}</span></div>`;
            }).join('')}</div>` : '<p class="text-sm text-ink-400">No payments recorded yet.</p>'}</section>` : ''}
            ${getCurrentRole() === 'accountant' ? '' : `<section class="card card-p"><div class="flex justify-between items-center mb-3"><h2 class="text-sm text-ink-700" style="font-weight:600;">School activity</h2>${canAccessModule('academics') ? '<a class="text-sm text-brand-700" href="#/academics">Academics</a>' : ''}</div><div class="space-y-2 text-sm">${canReadCollection('invoices') ? `<p>${school.invoiceCount} student invoices</p>` : ''}${canReadCollection('attendance') ? `<p>${data.attendance.attendance.length} attendance records</p>` : ''}${canReadCollection('libraryTransactions') ? `<p>${library.onLoan} books on loan${library.overdue ? ` · ${library.overdue} overdue` : ''}</p>` : ''}${canReadCollection('transportAssignments') ? `<p>${data.transport.assignments.length} transport assignments</p>` : ''}${getCurrentRole() && getCurrentRole() !== 'school_admin' ? `<p>${escapeHtml(roleLabel())} access</p>` : ''}</div></section>`}
          </div>
          <section><h2 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Modules</h2><div class="flex flex-wrap gap-2">${[['/students','Students','students'],['/admissions','Admissions','admissions'],['/attendance','Attendance','attendance'],['/timetable','Timetable','timetable'],['/assessments','Assessments','exams'],['/finance','Finance','finance'],['/communication','Communication','communication'],['/documents','Documents','documents'],['/reports','Reports','reports'],['/data','Import & Export','data']].filter(([,,module]) => canAccessModule(module)).map(([path,label]) => `<a class="btn-secondary btn-sm" href="#${path}">${escapeHtml(label)}</a>`).join('')}</div></section>
        </div>`;
    } catch (error) {
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span><button class="btn-secondary btn-sm" id="dashboard-retry">Retry</button></div>`;
      qs(container, '#dashboard-retry').addEventListener('click', render);
    }
  }

  render();
}

function statCard(label, value) {
  return `<div class="card card-p"><p class="text-sm text-ink-500">${escapeHtml(label)}</p><p class="text-xl mt-1" style="font-weight:600;">${escapeHtml(String(value))}</p></div>`;
}
