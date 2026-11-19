import { getCurrentRole } from '../../services/accessService.js';
import { REPORT_TABS } from '../../config/roles.js';
import { escapeHtml, on, qs } from '../../components/dom.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import {
  loadRemoteReportsWorkspace,
  remoteAttendanceOverview,
  remoteFinanceOverview,
  remoteInventoryOverview,
  remoteLibraryOverview,
  remoteSchoolOverview,
  remoteTransportOverview,
} from '../../services/supabaseReportsService.js';
import { animateCount } from '../../components/motion.js';
import { getSchool } from '../../services/schoolService.js';
import { classesSortedByOrder } from '../../services/academicService.js';
import { fullName } from '../../services/studentService.js';
import { emptyState } from '../../components/emptyState.js';
import {
  academicOverview,
  attendanceOverview,
  downloadCSV,
  financeOverview,
  inventoryOverview,
  libraryOverview,
  schoolOverview,
  transportOverview,
} from '../../services/reportsService.js';

const ALL_TABS = [
  ['overview', 'Overview'],
  ['academics', 'Academics'],
  ['finance', 'Finance'],
  ['operations', 'Operations'],
];

// Each role only gets the report tabs that concern its work.
function visibleTabs() {
  const role = getCurrentRole();
  if (!role) return ALL_TABS;
  const allowed = REPORT_TABS[role] ?? [];
  return ALL_TABS.filter(([key]) => allowed.includes(key));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// `count`/`format` are optional — only the Overview tab's headline cards use
// them to count up on render; every other call just renders static text.
function statCard(label, value, sub, count) {
  const id = `rpt-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  return `
    <div class="card card-p">
      <p class="text-sm text-ink-500">${escapeHtml(label)}</p>
      <p class="stat-num" ${count ? `id="${id}"` : ''}>${count ? escapeHtml(count.format(0)) : escapeHtml(String(value))}</p>
      ${sub ? `<p class="text-xs text-ink-400 mt-1">${escapeHtml(sub)}</p>` : ''}
    </div>`;
}

function runCounters(body, counters) {
  counters.forEach(({ label, target, format }) => {
    const id = `rpt-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    const el = body.querySelector(`#${id}`);
    if (el) animateCount(el, target, { format });
  });
}

export function renderReportsCenter(container) {
  let tab = visibleTabs()[0]?.[0] ?? 'overview';
  const state = { attStart: daysAgoISO(30), attEnd: todayISO() };
  if (isSupabaseConfigured()) return renderRemoteReportsCenter(container);

  function render() {
    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center flex-wrap gap-3">
          <h1 class="text-xl" style="font-weight:600;">Reports Center</h1>
          <div class="pill-group" style="flex-wrap:wrap;">
            ${visibleTabs().map(([key, label]) => `<button class="pill ${tab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`).join('')}
          </div>
        </div>
        <div id="reports-body"></div>
      </div>`;

    visibleTabs().forEach(([key]) => {
      qs(container, `[data-tab="${key}"]`).addEventListener('click', () => { tab = key; render(); });
    });

    const body = qs(container, '#reports-body');
    if (tab === 'overview') renderOverview(body);
    else if (tab === 'academics') renderAcademics(body);
    else if (tab === 'finance') renderFinance(body);
    else renderOperations(body);
  }

function renderRemoteReportsCenter(container) {
  let tab = visibleTabs()[0]?.[0] ?? 'overview';
  const state = { data: null, attStart: daysAgoISO(30), attEnd: todayISO(), error: '' };

  async function render() {
    try {
      state.data ??= await loadRemoteReportsWorkspace();
    } catch (error) {
      state.error = error.message;
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span><button class="btn-secondary btn-sm" id="remote-reports-retry">Retry</button></div>`;
      qs(container, '#remote-reports-retry').addEventListener('click', () => { state.data = null; state.error = ''; render(); });
      return;
    }
    container.innerHTML = `<div class="space-y-4"><div class="flex justify-between items-center flex-wrap gap-3"><h1 class="text-xl" style="font-weight:600;">Reports Center</h1><div class="pill-group" style="flex-wrap:wrap;">${visibleTabs().map(([key, label]) => `<button class="pill ${tab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`).join('')}</div></div>${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}<div id="reports-body"></div></div>`;
    on(container, '[data-tab]', 'click', (event) => { tab = event.currentTarget.getAttribute('data-tab'); render(); });
    const body = qs(container, '#reports-body');
    if (tab === 'overview') renderOverview(body);
    else if (tab === 'academics') renderAcademics(body);
    else if (tab === 'finance') renderFinance(body);
    else renderOperations(body);
  }

  function renderOverview(body) {
    const school = remoteSchoolOverview(state.data);
    const library = remoteLibraryOverview(state.data);
    const inventory = remoteInventoryOverview(state.data);
    const transport = remoteTransportOverview(state.data);
    const finance = remoteFinanceOverview(state.data, daysAgoISO(30), todayISO());
    const currency = state.data.school?.currency ?? 'KES';
    body.innerHTML = `<div class="space-y-5"><div class="grid grid-2 lg-grid-4 gap-4">${statCard('Students', school.studentCount)}${statCard('Staff', school.staffCount)}${statCard('Classes', school.classCount)}${statCard('Invoices raised', school.invoiceCount)}</div><div class="grid grid-2 lg-grid-4 gap-4">${statCard('Outstanding fees', `${currency} ${finance.outstandingTotal.toLocaleString()}`, 'All students')}${statCard('Books on loan', library.onLoan, library.overdue ? `${library.overdue} overdue` : 'None overdue')}${statCard('Low stock items', inventory.lowStock.length, `of ${inventory.itemCount} items`)}${statCard('Transport routes', transport.routeCount, transport.rows.some((row) => row.overCapacity) ? 'Some over capacity' : 'All within capacity')}</div></div>`;
  }

  function renderAcademics(body) {
    const attendance = remoteAttendanceOverview(state.data, state.attStart, state.attEnd);
    body.innerHTML = `<div class="space-y-6"><section><div class="flex justify-between items-end flex-wrap gap-3 mb-3"><h2 class="text-sm text-ink-700" style="font-weight:600;">Attendance by class</h2><div class="flex flex-wrap items-end gap-3"><div><label class="label">From</label><input type="date" class="input" id="att-start" value="${escapeHtml(state.attStart)}" /></div><div><label class="label">To</label><input type="date" class="input" id="att-end" value="${escapeHtml(state.attEnd)}" /></div><button class="btn-secondary" id="export-att" ${attendance.every((row) => row.studentsWithRecords === 0) ? 'disabled' : ''}>Export CSV</button></div></div>${attendance.length === 0 ? `<div class="card">${emptyState({ title: 'No classes set up yet' })}</div>` : `<div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Class</th><th class="text-right">Students with records</th><th class="text-right">Average attendance</th></tr></thead><tbody>${attendance.map((row) => `<tr><td style="font-weight:500;">${escapeHtml(row.className)}</td><td class="text-right">${row.studentsWithRecords}</td><td class="text-right">${row.averagePercentage !== null ? `${row.averagePercentage}%` : '—'}</td></tr>`).join('')}</tbody></table></div>`}</section><section><h2 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Exam performance by class</h2><div class="card">${emptyState({ title: 'Examinations are not connected yet', body: 'Examination and report-card data will appear here after that module is migrated to the shared backend.' })}</div></section></div>`;
    qs(body, '#att-start').addEventListener('change', (event) => { state.attStart = event.target.value; render(); });
    qs(body, '#att-end').addEventListener('change', (event) => { state.attEnd = event.target.value; render(); });
    qs(body, '#export-att').addEventListener('click', () => downloadCSV(`attendance-by-class-${state.attStart}-to-${state.attEnd}.csv`, [['Class', 'Students with records', 'Average attendance %'], ...attendance.map((row) => [row.className, row.studentsWithRecords, row.averagePercentage ?? ''])]));
  }

  function renderFinance(body) {
    const finance = remoteFinanceOverview(state.data, daysAgoISO(30), todayISO());
    const currency = state.data.school?.currency ?? 'KES';
    const classById = Object.fromEntries(state.data.classes.map((schoolClass) => [schoolClass.id, schoolClass]));
    body.innerHTML = `<div class="space-y-5"><div class="grid grid-2 sm-grid-3 gap-4">${statCard('Collected (last 30 days)', `${currency} ${finance.collected30d.toLocaleString()}`)}${statCard('Expenses (last 30 days)', `${currency} ${finance.expenses30d.toLocaleString()}`)}${statCard('Total outstanding', `${currency} ${finance.outstandingTotal.toLocaleString()}`)}</div><section><div class="flex justify-between items-center mb-3"><h2 class="text-sm text-ink-700" style="font-weight:600;">Highest outstanding balances</h2><button class="btn-secondary" id="export-fin" ${finance.topOutstanding.length === 0 ? 'disabled' : ''}>Export CSV</button></div>${finance.topOutstanding.length === 0 ? `<div class="card">${emptyState({ title: 'No outstanding balances', body: 'Every invoiced student is fully paid up.' })}</div>` : `<div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Student</th><th>Class</th><th class="text-right">Balance</th></tr></thead><tbody>${finance.topOutstanding.map((row) => `<tr><td style="font-weight:500;">${escapeHtml(fullName(row.student))}</td><td class="text-ink-600">${escapeHtml(classById[row.student.classId ?? '']?.name ?? '—')}</td><td class="text-right" style="font-weight:600;color:var(--bad);">${currency} ${row.balance.toLocaleString()}</td></tr>`).join('')}</tbody></table></div>`}</section></div>`;
    const exportButton = qs(body, '#export-fin');
    if (exportButton) exportButton.addEventListener('click', () => downloadCSV('outstanding-balances.csv', [['Student', 'Class', 'Balance'], ...finance.topOutstanding.map((row) => [fullName(row.student), classById[row.student.classId ?? '']?.name ?? '', row.balance])]));
  }

  function renderOperations(body) {
    const library = remoteLibraryOverview(state.data);
    const inventory = remoteInventoryOverview(state.data);
    const transport = remoteTransportOverview(state.data);
    body.innerHTML = `<div class="space-y-6"><section><h2 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Library</h2><div class="grid grid-2 sm-grid-3 gap-4">${statCard('Books in catalog', library.bookCount)}${statCard('Currently on loan', library.onLoan)}${statCard('Overdue', library.overdue)}</div></section><section><h2 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Inventory</h2><div class="grid grid-2 sm-grid-3 gap-4 mb-3">${statCard('Items tracked', inventory.itemCount)}${statCard('Total quantity', inventory.totalQuantity)}${statCard('Low stock (≤3)', inventory.lowStock.length)}</div>${inventory.lowStock.length ? `<div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Item</th><th class="text-right">Quantity</th></tr></thead><tbody>${inventory.lowStock.map((item) => `<tr><td style="font-weight:500;">${escapeHtml(item.name)}</td><td class="text-right low-stock">${item.quantity}</td></tr>`).join('')}</tbody></table></div>` : ''}</section><section><h2 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Transport</h2>${transport.rows.length === 0 ? `<div class="card">${emptyState({ title: 'No routes set up yet' })}</div>` : `<div class="card overflow-x-auto"><table class="data-table"><thead><tr><th>Route</th><th class="text-right">Seats used</th></tr></thead><tbody>${transport.rows.map((row) => `<tr><td style="font-weight:500;">${escapeHtml(row.name)}</td><td class="text-right" style="${row.overCapacity ? 'color:var(--bad);font-weight:600;' : ''}">${row.occupancy}${row.capacity !== null ? ` / ${row.capacity}` : ''}</td></tr>`).join('')}</tbody></table></div>`}</section></div>`;
  }

  render();
}

  function renderOverview(body) {
    const school = schoolOverview();
    const library = libraryOverview();
    const inventory = inventoryOverview();
    const transport = transportOverview();
    const finance = financeOverview();
    const currency = getSchool()?.currency ?? 'KES';

    body.innerHTML = `
      <div class="space-y-5">
        <div class="grid grid-2 lg-grid-4 gap-4">
          ${statCard('Students', '', undefined, { format: (n) => String(n) })}
          ${statCard('Staff', '', undefined, { format: (n) => String(n) })}
          ${statCard('Classes', '', undefined, { format: (n) => String(n) })}
          ${statCard('Invoices raised', '', undefined, { format: (n) => String(n) })}
        </div>
        <div class="grid grid-2 lg-grid-4 gap-4">
          ${statCard('Outstanding fees', '', 'All students', { format: (n) => `${currency} ${n.toLocaleString()}` })}
          ${statCard('Books on loan', '', library.overdue > 0 ? `${library.overdue} overdue` : 'None overdue', { format: (n) => String(n) })}
          ${statCard('Low stock items', '', `of ${inventory.itemCount} items`, { format: (n) => String(n) })}
          ${statCard('Transport routes', '', transport.rows.some((r) => r.overCapacity) ? 'Some over capacity' : 'All within capacity', { format: (n) => String(n) })}
        </div>
        <p class="text-xs text-ink-400">Open a tab above for the detail behind each number — nothing here is calculated separately from what its own module already shows.</p>
      </div>`;

    runCounters(body, [
      { label: 'Students', target: school.studentCount, format: (n) => String(n) },
      { label: 'Staff', target: school.staffCount, format: (n) => String(n) },
      { label: 'Classes', target: school.classCount, format: (n) => String(n) },
      { label: 'Invoices raised', target: school.invoiceCount, format: (n) => String(n) },
      { label: 'Outstanding fees', target: finance.outstandingTotal, format: (n) => `${currency} ${n.toLocaleString()}` },
      { label: 'Books on loan', target: library.onLoan, format: (n) => String(n) },
      { label: 'Low stock items', target: inventory.lowStock.length, format: (n) => String(n) },
      { label: 'Transport routes', target: transport.routeCount, format: (n) => String(n) },
    ]);
  }

  function renderAcademics(body) {
    function draw() {
      const attendance = attendanceOverview(state.attStart, state.attEnd);
      const { examination, rows: examRows } = academicOverview();

      body.innerHTML = `
        <div class="space-y-6">
          <section>
            <div class="flex justify-between items-end flex-wrap gap-3 mb-3">
              <h2 class="text-sm text-ink-700" style="font-weight:600;">Attendance by class</h2>
              <div class="flex flex-wrap items-end gap-3">
                <div><label class="label">From</label><input type="date" class="input" id="att-start" value="${escapeHtml(state.attStart)}" /></div>
                <div><label class="label">To</label><input type="date" class="input" id="att-end" value="${escapeHtml(state.attEnd)}" /></div>
                <button class="btn-secondary" id="export-att" ${attendance.every((r) => r.studentsWithRecords === 0) ? 'disabled' : ''}>Export CSV</button>
              </div>
            </div>
            ${
              attendance.length === 0
                ? `<div class="card">${emptyState({ title: 'No classes set up yet' })}</div>`
                : `<div class="card overflow-x-auto"><table class="data-table">
                    <thead><tr><th>Class</th><th class="text-right">Students with records</th><th class="text-right">Average attendance</th></tr></thead>
                    <tbody>
                      ${attendance
                        .map((r) => `<tr><td style="font-weight:500;">${escapeHtml(r.className)}</td><td class="text-right">${r.studentsWithRecords}</td><td class="text-right">${r.averagePercentage !== null ? r.averagePercentage + '%' : '—'}</td></tr>`)
                        .join('')}
                    </tbody>
                  </table></div>`
            }
          </section>

          <section>
            <h2 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Exam performance by class</h2>
            ${
              !examination
                ? `<div class="card">${emptyState({ title: 'No examinations recorded yet', body: 'Create one from Exams & Assessments to see class averages here.' })}</div>`
                : `<p class="text-xs text-ink-500 mb-2">Most recent examination: ${escapeHtml(examination.name)}</p>
                   <div class="card overflow-x-auto"><table class="data-table">
                    <thead><tr><th>Class</th><th class="text-right">Scores recorded</th><th class="text-right">Average score</th></tr></thead>
                    <tbody>
                      ${examRows
                        .map((r) => `<tr><td style="font-weight:500;">${escapeHtml(r.className)}</td><td class="text-right">${r.scoresRecorded}</td><td class="text-right">${r.averageScore !== null ? r.averageScore : '—'}</td></tr>`)
                        .join('')}
                    </tbody>
                  </table></div>`
            }
          </section>
        </div>`;

      qs(body, '#att-start').addEventListener('change', (e) => { state.attStart = e.target.value; draw(); });
      qs(body, '#att-end').addEventListener('change', (e) => { state.attEnd = e.target.value; draw(); });
      const exportBtn = qs(body, '#export-att');
      if (exportBtn) exportBtn.addEventListener('click', () => {
        downloadCSV(`attendance-by-class-${state.attStart}-to-${state.attEnd}.csv`, [
          ['Class', 'Students with records', 'Average attendance %'],
          ...attendance.map((r) => [r.className, r.studentsWithRecords, r.averagePercentage ?? '']),
        ]);
      });
    }
    draw();
  }

  function renderFinance(body) {
    const f = financeOverview();
    const currency = getSchool()?.currency ?? 'KES';
    const classById = Object.fromEntries(classesSortedByOrder().map((c) => [c.id, c]));

    body.innerHTML = `
      <div class="space-y-5">
        <div class="grid grid-2 sm-grid-3 gap-4">
          ${statCard('Collected (last 30 days)', `${currency} ${f.collected30d.toLocaleString()}`)}
          ${statCard('Expenses (last 30 days)', `${currency} ${f.expenses30d.toLocaleString()}`)}
          ${statCard('Total outstanding', `${currency} ${f.outstandingTotal.toLocaleString()}`)}
        </div>
        <section>
          <div class="flex justify-between items-center mb-3">
            <h2 class="text-sm text-ink-700" style="font-weight:600;">Highest outstanding balances</h2>
            <button class="btn-secondary" id="export-fin" ${f.topOutstanding.length === 0 ? 'disabled' : ''}>Export CSV</button>
          </div>
          ${
            f.topOutstanding.length === 0
              ? `<div class="card">${emptyState({ title: 'No outstanding balances', body: 'Every invoiced student is fully paid up.' })}</div>`
              : `<div class="card overflow-x-auto"><table class="data-table">
                  <thead><tr><th>Student</th><th>Class</th><th class="text-right">Balance</th></tr></thead>
                  <tbody>
                    ${f.topOutstanding
                      .map((r) => `<tr><td style="font-weight:500;">${escapeHtml(fullName(r.student))}</td><td class="text-ink-600">${escapeHtml(classById[r.student.classId ?? '']?.name ?? '—')}</td><td class="text-right" style="font-weight:600;color:var(--bad);">${currency} ${r.balance.toLocaleString()}</td></tr>`)
                      .join('')}
                  </tbody>
                </table></div>`
          }
        </section>
        <p class="text-xs text-ink-400">Full invoices, payments and class-by-class balances are in Finance → Reports. This is a quick summary.</p>
      </div>`;

    const exportBtn = qs(body, '#export-fin');
    if (exportBtn) exportBtn.addEventListener('click', () => {
      downloadCSV('outstanding-balances.csv', [
        ['Student', 'Class', 'Balance'],
        ...f.topOutstanding.map((r) => [fullName(r.student), classById[r.student.classId ?? '']?.name ?? '', r.balance]),
      ]);
    });
  }

  function renderOperations(body) {
    const library = libraryOverview();
    const inventory = inventoryOverview();
    const transport = transportOverview();

    body.innerHTML = `
      <div class="space-y-6">
        <section>
          <h2 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Library</h2>
          <div class="grid grid-2 sm-grid-3 gap-4">
            ${statCard('Books in catalog', library.bookCount)}
            ${statCard('Currently on loan', library.onLoan)}
            ${statCard('Overdue', library.overdue)}
          </div>
        </section>

        <section>
          <h2 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Inventory</h2>
          <div class="grid grid-2 sm-grid-3 gap-4 mb-3">
            ${statCard('Items tracked', inventory.itemCount)}
            ${statCard('Total quantity', inventory.totalQuantity)}
            ${statCard('Low stock (≤3)', inventory.lowStock.length)}
          </div>
          ${
            inventory.lowStock.length === 0
              ? ''
              : `<div class="card overflow-x-auto"><table class="data-table">
                  <thead><tr><th>Item</th><th class="text-right">Quantity</th></tr></thead>
                  <tbody>${inventory.lowStock.map((i) => `<tr><td style="font-weight:500;">${escapeHtml(i.name)}</td><td class="text-right low-stock">${i.quantity}</td></tr>`).join('')}</tbody>
                </table></div>`
          }
        </section>

        <section>
          <h2 class="text-sm text-ink-700 mb-3" style="font-weight:600;">Transport</h2>
          ${
            transport.rows.length === 0
              ? `<div class="card">${emptyState({ title: 'No routes set up yet' })}</div>`
              : `<div class="card overflow-x-auto"><table class="data-table">
                  <thead><tr><th>Route</th><th class="text-right">Seats used</th></tr></thead>
                  <tbody>
                    ${transport.rows
                      .map((r) => `<tr><td style="font-weight:500;">${escapeHtml(r.name)}</td><td class="text-right" style="${r.overCapacity ? 'color:var(--bad);font-weight:600;' : ''}">${r.occupancy}${r.capacity !== null ? ' / ' + r.capacity : ''}</td></tr>`)
                      .join('')}
                  </tbody>
                </table></div>`
          }
        </section>
      </div>`;
  }

  render();
}
