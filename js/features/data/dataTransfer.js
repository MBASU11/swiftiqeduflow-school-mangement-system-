import { escapeHtml, on, qs } from '../../components/dom.js';
import { icons } from '../../components/icons.js';
import { readSpreadsheet, downloadWorkbook } from '../../lib/spreadsheet.js';
import { DATASETS, DATASET_BY_KEY, EXPORT_ALL, loadContext } from '../../services/datasets/index.js';
import { detectHeaderRow, autoMap, extractRows, unusedColumns, text, fileStamp, safeFileName } from '../../services/importEngine.js';
import { datasetPermissions, canWriteCollection, roleLabel, getCurrentRole } from '../../services/accessService.js';

const NEXT_STEPS = {
  students: [['#/students', 'View students']],
  marks: [['#/exams', 'Open report cards (Exams → Report cards)']],
  admissions: [['#/admissions', 'View admissions']],
  staff: [['#/staff', 'View staff']],
  subjects: [['#/academics', 'View subjects']],
  classes: [['#/academics', 'View classes']],
  library: [['#/library', 'View library']],
  inventory: [['#/inventory', 'View inventory']],
};

const EXPORT_OPTIONS = {
  students: [{ key: 'classId', type: 'class', label: 'Class (leave blank for the whole school)', optional: true }],
  marks: [
    { key: 'examinationId', type: 'exam', label: 'Examination', required: true },
    { key: 'classId', type: 'examClass', label: 'Class', required: true },
  ],
};

const MAX_PREVIEW = 200;

export function renderDataTransfer(container, params = {}) {
  const state = {
    ctx: null,
    key: params.dataset && DATASET_BY_KEY[params.dataset] ? params.dataset : '',
    importOptions: {}, exportOptions: {},
    file: null, sheets: [], sheetIndex: 0, headerRow: 0, mapping: {}, fields: [], prepared: null, items: [], unused: [],
    filter: 'all', skipProblems: true,
    busy: '', progress: '', result: null, error: '', notice: '',
  };

  const dataset = () => DATASET_BY_KEY[state.key];

  async function render() {
    try {
      state.ctx ??= await loadContext();
    } catch (error) {
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span><button class="btn-secondary btn-sm" id="dt-retry">Retry</button></div>`;
      qs(container, '#dt-retry').addEventListener('click', () => { state.ctx = null; render(); });
      return;
    }
    const available = DATASETS.filter((d) => { const p = datasetPermissions(d.key); return p.import || p.export; });
    if (!available.length) {
      container.innerHTML = `<div class="card card-p"><h1 class="text-lg" style="font-weight:600;">Import &amp; Export</h1><p class="text-sm text-ink-500 mt-2">Your role (${escapeHtml(roleLabel())}) can't import or export school data.</p></div>`;
      return;
    }
    if (state.key && !available.some((d) => d.key === state.key)) state.key = '';

    container.innerHTML = `
      <div class="space-y-5">
        <div class="flex justify-between items-end flex-wrap gap-3">
          <div>
            <h1 class="text-xl" style="font-weight:600;">Import &amp; Export</h1>
            <p class="text-sm text-ink-500 mt-1">Bring in lists you already keep in Excel or CSV, or take your data out. ${getCurrentRole() && getCurrentRole() !== 'school_admin' ? `Showing what your role (${escapeHtml(roleLabel())}) can use.` : ''}</p>
          </div>
          ${EXPORT_ALL.some((d) => datasetPermissions(d.key).export) ? `<button class="btn-secondary" id="export-all" ${state.busy ? 'disabled' : ''}>Download everything (Excel)</button>` : ''}
        </div>
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        ${state.notice ? `<div class="notice"><span>${escapeHtml(state.notice)}</span></div>` : ''}

        <div class="grid sm-grid-2 lg-grid-4 gap-3" role="list">
          ${available.map((d) => {
            const p = datasetPermissions(d.key);
            return `<button class="card" role="listitem" data-pick="${d.key}" style="text-align:left;padding:0.9rem 1rem;cursor:pointer;border:2px solid ${state.key === d.key ? 'var(--brand-600, #2f6fb0)' : 'var(--ink-100)'};">
              <p class="text-sm" style="font-weight:600;">${escapeHtml(d.label)}</p>
              <p class="text-xs text-ink-500 mt-1">${escapeHtml(d.description)}</p>
              <p class="text-xs mt-2" style="display:flex;gap:0.35rem;">${p.import ? '<span class="badge" style="background:var(--ink-100);color:var(--ink-700);">Import</span>' : ''}${p.export ? '<span class="badge" style="background:var(--ink-100);color:var(--ink-700);">Export</span>' : ''}</p>
            </button>`;
          }).join('')}
        </div>

        ${state.key ? datasetSectionsHtml() : `<div class="card card-p"><p class="text-sm text-ink-500">Choose a list above to import or export it. Tip: start with <b>Classes &amp; streams</b> and <b>Subjects</b>, then <b>Students</b>, then <b>Marks</b>.</p></div>`}
      </div>`;
    wire();
  }

  // ---- Option controls -----------------------------------------------------
  function optionHtml(opt, values, scope) {
    const id = `${scope}-${opt.key}`;
    const ctx = state.ctx;
    const disabled = state.busy ? 'disabled' : '';
    if (opt.type === 'checkbox') {
      const locked = opt.key === 'createMissing' && !canWriteCollection('classes');
      return `<label class="flex items-center gap-2 text-sm"><input type="checkbox" data-opt="${scope}|${opt.key}" ${values[opt.key] && !locked ? 'checked' : ''} ${locked || state.busy ? 'disabled' : ''}/> ${escapeHtml(opt.label)}${locked ? ' <span class="text-xs text-ink-400">(your role can’t create classes)</span>' : ''}</label>`;
    }
    let choices = [];
    if (opt.type === 'class') choices = ctx.classes.map((c) => [c.id, c.name]);
    else if (opt.type === 'exam') choices = ctx.examinations.map((e) => [e.id, e.name]);
    else if (opt.type === 'examClass') {
      const exam = ctx.examinations.find((e) => e.id === values.examinationId);
      choices = ctx.classes.filter((c) => (exam?.classIds ?? []).includes(c.id)).map((c) => [c.id, c.name]);
    } else if (opt.type === 'select') choices = opt.choices;
    const blank = opt.optional || opt.type !== 'select' ? `<option value="">${opt.optional ? '— none —' : 'Choose…'}</option>` : '';
    return `<div><label class="label" for="${id}">${escapeHtml(opt.label)}</label>
      <select class="input" id="${id}" data-opt="${scope}|${opt.key}" ${disabled}>${blank}${choices.map(([v, l]) => `<option value="${escapeHtml(v)}" ${values[opt.key] === v ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>
      ${opt.help ? `<p class="text-xs text-ink-400 mt-1">${escapeHtml(opt.help)}</p>` : ''}</div>`;
  }

  function ensureDefaults() {
    const d = dataset();
    d.options.forEach((o) => { if (state.importOptions[o.key] === undefined) state.importOptions[o.key] = o.default ?? (o.type === 'checkbox' ? false : ''); });
    (EXPORT_OPTIONS[d.key] ?? []).forEach((o) => { if (state.exportOptions[o.key] === undefined) state.exportOptions[o.key] = ''; });
    if (!canWriteCollection('classes') && 'createMissing' in state.importOptions) state.importOptions.createMissing = false;
  }

  const importReady = () => { const d = dataset(); return d.ready ? d.ready(state.importOptions) : true; };
  const exportReady = () => { const d = dataset(); return d.key === 'marks' ? Boolean(state.exportOptions.examinationId && state.exportOptions.classId) : true; };

  // ---- Page sections -------------------------------------------------------------
  function datasetSectionsHtml() {
    ensureDefaults();
    const d = dataset();
    const perm = datasetPermissions(d.key);
    return `
      <div class="grid lg-grid-2 gap-4" style="align-items:start;">
        ${perm.export ? exportCardHtml(d) : `<div class="card card-p"><h2 class="text-sm text-ink-700" style="font-weight:600;">Export</h2><p class="text-sm text-ink-500 mt-2">Your role can't export this list.</p></div>`}
        ${perm.import ? importCardHtml(d) : `<div class="card card-p"><h2 class="text-sm text-ink-700" style="font-weight:600;">Import</h2><p class="text-sm text-ink-500 mt-2">Your role can look at this list but not change it, so importing isn't available.</p></div>`}
      </div>
      ${perm.import && state.file ? reviewHtml(d) : ''}
      ${state.result ? resultHtml(d) : ''}`;
  }

  function exportCardHtml(d) {
    const opts = EXPORT_OPTIONS[d.key] ?? [];
    return `<div class="card card-p space-y-3">
      <div><h2 class="text-sm text-ink-700" style="font-weight:600;">Export ${escapeHtml(d.label.toLowerCase())}</h2><p class="text-xs text-ink-500 mt-1">${d.key === 'marks' ? 'Results with total, average, grade and class position for one class.' : 'Download your current data. The file can be imported again later with no changes.'}</p></div>
      ${opts.map((o) => optionHtml(o, state.exportOptions, 'export')).join('')}
      <div class="flex gap-2 flex-wrap">
        <button class="btn-primary" id="export-xlsx" ${!exportReady() || state.busy ? 'disabled' : ''}>Download Excel</button>
        <button class="btn-secondary" id="export-csv" ${!exportReady() || state.busy ? 'disabled' : ''}>Download CSV</button>
      </div>
    </div>`;
  }

  function importCardHtml(d) {
    const ready = importReady();
    return `<div class="card card-p space-y-3">
      <div><h2 class="text-sm text-ink-700" style="font-weight:600;">Import ${escapeHtml(d.label.toLowerCase())}</h2><p class="text-xs text-ink-500 mt-1">Upload an Excel (.xlsx, .xls) or CSV file. Your own column headings are fine — you'll check the matching before anything is saved.</p></div>
      ${d.options.map((o) => optionHtml(o, state.importOptions, 'import')).join('')}
      <div class="flex gap-2 flex-wrap items-center">
        <button class="btn-secondary" id="download-template" ${(d.key === 'marks' && !ready) || state.busy ? 'disabled' : ''}>${d.key === 'marks' ? 'Download class marks sheet' : 'Download blank template'}</button>
        ${d.key === 'marks' && !ready ? '<span class="text-xs text-ink-400">Choose an examination and class first.</span>' : ''}
      </div>
      <label id="dropzone" style="display:block;border:2px dashed var(--ink-200, #cfd6df);border-radius:0.6rem;padding:1.2rem;text-align:center;cursor:${ready ? 'pointer' : 'not-allowed'};opacity:${ready ? 1 : 0.55};">
        <input type="file" id="file-input" accept=".xlsx,.xls,.csv,.ods" style="display:none;" ${ready && !state.busy ? '' : 'disabled'} data-keep-visible />
        <span class="text-sm" style="font-weight:500;">${state.file ? escapeHtml(state.file.name) : ready ? 'Choose a file or drop it here' : 'Choose the options above first'}</span>
        ${state.file ? '<span class="text-xs text-ink-400" style="display:block;margin-top:0.25rem;">Choose another file to start again</span>' : ''}
      </label>
    </div>`;
  }

  function reviewHtml(d) {
    const rows = state.sheets[state.sheetIndex].rows;
    const headers = rows[state.headerRow] ?? [];
    const counts = { ok: 0, warn: 0, skip: 0, error: 0 };
    state.items.forEach((i) => { counts[i.status] += 1; });
    const importable = counts.ok + counts.warn;
    const visible = (state.filter === 'problems' ? state.items.filter((i) => i.status !== 'ok') : state.items).slice(0, MAX_PREVIEW);
    const canGo = importable > 0 && (counts.error === 0 || state.skipProblems) && !state.busy;
    const colOptions = (selected) => `<option value="-1">— not in my file —</option>${headers.map((h, i) => (text(h) ? `<option value="${i}" ${selected === i ? 'selected' : ''}>${escapeHtml(text(h))}</option>` : '')).join('')}`;
    const sample = (index) => { for (let r = state.headerRow + 1; r < Math.min(rows.length, state.headerRow + 8); r += 1) { const v = text(rows[r]?.[index]); if (v) return v; } return ''; };
    return `
      <div class="card card-p space-y-4" id="review">
        <div class="flex justify-between items-start flex-wrap gap-3">
          <div><h2 class="text-sm text-ink-700" style="font-weight:600;">Check before importing</h2>
          <p class="text-xs text-ink-500 mt-1">${escapeHtml(state.file.name)} · ${state.items.length} row${state.items.length === 1 ? '' : 's'} found · headings on row ${state.headerRow + 1}</p></div>
          <div class="flex gap-3 items-end flex-wrap">
            ${state.sheets.length > 1 ? `<div><label class="label">Sheet</label><select class="input" id="sheet-select">${state.sheets.map((s, i) => `<option value="${i}" ${i === state.sheetIndex ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select></div>` : ''}
            <div><label class="label">Headings are on row</label><input class="input" type="number" min="1" max="${Math.min(rows.length, 50)}" id="header-row" value="${state.headerRow + 1}" style="width:5.5rem;" /></div>
          </div>
        </div>

        <details ${counts.error && importable === 0 ? 'open' : ''}>
          <summary class="text-sm" style="cursor:pointer;font-weight:500;">Column matching <span class="text-xs text-ink-400">(${state.fields.filter((f) => state.mapping[f.key] >= 0).length} of ${state.fields.length} matched — change if something is wrong)</span></summary>
          <div class="overflow-x-auto mt-2"><table class="data-table">
            <thead><tr><th>We need</th><th>Your column</th><th>Example from your file</th></tr></thead>
            <tbody>${state.fields.map((f) => `<tr>
              <td><span style="font-weight:500;">${escapeHtml(f.label)}</span>${f.hint ? `<br><span class="text-xs text-ink-400">${escapeHtml(f.hint)}</span>` : ''}</td>
              <td><select class="input" data-map="${escapeHtml(f.key)}" style="min-width:12rem;">${colOptions(state.mapping[f.key])}</select></td>
              <td class="text-ink-500 text-sm">${escapeHtml(sample(state.mapping[f.key]))}</td></tr>`).join('')}</tbody>
          </table></div>
          ${state.unused.length ? `<p class="text-xs text-ink-500 mt-2">Not used: ${state.unused.map(escapeHtml).join(', ')}${d.key === 'marks' ? ' — either not a subject for this grade, or calculated automatically (total, grade, position).' : '.'}</p>` : ''}
        </details>

        <div class="flex flex-wrap gap-4 text-sm items-center">
          <span class="text-good" style="font-weight:600;">${counts.ok} ready</span>
          ${counts.warn ? `<span class="text-warn" style="font-weight:600;">${counts.warn} with notes</span>` : ''}
          ${counts.skip ? `<span class="text-ink-500" style="font-weight:600;">${counts.skip} skipped</span>` : ''}
          ${counts.error ? `<span class="text-bad" style="font-weight:600;">${counts.error} with problems</span>` : ''}
          <span style="margin-left:auto;" class="pill-group"><button class="pill ${state.filter === 'all' ? 'active' : ''}" data-filter="all">All rows</button><button class="pill ${state.filter === 'problems' ? 'active' : ''}" data-filter="problems">Needs attention</button></span>
        </div>

        ${state.items.length === 0 ? `<p class="text-sm text-bad">No data rows were found under the headings. Check the “Headings are on row” number${d.key === 'marks' ? ' and that the class has subjects assigned' : ''}.</p>` : `
        <div class="overflow-x-auto" style="max-height:24rem;overflow-y:auto;"><table class="data-table">
          <thead><tr><th>Row</th><th></th><th>What will happen</th><th>Notes</th></tr></thead>
          <tbody>${visible.map((i) => `<tr>
            <td class="text-ink-500">${i.rowNumber}</td>
            <td>${statusBadge(i.status)}</td>
            <td>${escapeHtml(i.summary)}</td>
            <td class="text-sm ${i.status === 'error' ? 'text-bad' : 'text-ink-600'}">${i.messages.map(escapeHtml).join('<br>')}</td></tr>`).join('')}
          ${visible.length === 0 ? '<tr><td colspan="4" class="text-sm text-ink-400">Nothing needs attention.</td></tr>' : ''}</tbody>
        </table></div>
        ${state.items.length > MAX_PREVIEW && state.filter === 'all' ? `<p class="text-xs text-ink-400">Showing the first ${MAX_PREVIEW} rows. Everything in the file is still checked and imported.</p>` : ''}`}

        <div class="flex justify-between items-center flex-wrap gap-3">
          <div>
            ${counts.error ? `<label class="flex items-center gap-2 text-sm"><input type="checkbox" id="skip-problems" ${state.skipProblems ? 'checked' : ''}/> Import the good rows and skip the ${counts.error} with problems</label>` : ''}
            ${state.busy ? `<p class="text-sm text-ink-500" role="status">${escapeHtml(state.progress || 'Working…')}</p>` : ''}
          </div>
          <div class="flex gap-2">
            ${counts.error + counts.skip ? '<button class="btn-secondary" id="download-problems">Download problem rows</button>' : ''}
            <button class="btn-primary" id="run-import" ${canGo ? '' : 'disabled'}>${state.busy ? 'Importing…' : `Import ${importable} row${importable === 1 ? '' : 's'}`}</button>
          </div>
        </div>
      </div>`;
  }

  const statusBadge = (s) => ({
    ok: '<span class="text-good" title="Ready">●</span> <span class="text-xs text-ink-500">Ready</span>',
    warn: '<span class="text-warn" title="Will import, with a note">▲</span> <span class="text-xs text-ink-500">Note</span>',
    skip: '<span class="text-ink-400" title="Skipped">○</span> <span class="text-xs text-ink-500">Skipped</span>',
    error: '<span class="text-bad" title="Problem">✕</span> <span class="text-xs text-bad">Problem</span>',
  }[s]);

  function resultHtml(d) {
    const r = state.result;
    const parts = [
      r.created ? `${r.created} added` : '', r.updated ? `${r.updated} updated` : '',
      r.marks ? `${r.marks} marks saved for ${r.students} student${r.students === 1 ? '' : 's'} in ${r.subjects} subject${r.subjects === 1 ? '' : 's'}` : '',
      r.parents ? `${r.parents} parent${r.parents === 1 ? '' : 's'} added` : '',
      r.classes ? `${r.classes} class${r.classes === 1 ? '' : 'es'} created` : '', r.streams ? `${r.streams} stream${r.streams === 1 ? '' : 's'} created` : '',
    ].filter(Boolean);
    return `<div class="card card-p" style="border-color:var(--good, #2e7d4f);">
      <h2 class="text-sm" style="font-weight:600;color:var(--good, #2e7d4f);">Import finished</h2>
      <p class="text-sm mt-1">${escapeHtml(parts.join(' · ') || 'Nothing new was added.')}${r.skipped ? ` · ${r.skipped} row${r.skipped === 1 ? '' : 's'} skipped` : ''}</p>
      <div class="flex gap-2 mt-3 flex-wrap">${(NEXT_STEPS[d.key] ?? []).map(([href, label]) => `<a class="btn-secondary btn-sm" href="${href}">${escapeHtml(label)}</a>`).join('')}</div>
    </div>`;
  }

  // ---- Behaviour --------------------------------------------------------------------
  function analyze({ keepMapping = false } = {}) {
    const d = dataset();
    const rows = state.sheets[state.sheetIndex].rows;
    state.fields = d.getFields(state.ctx, state.importOptions);
    if (!keepMapping) state.headerRow = detectHeaderRow(rows, state.fields);
    state.mapping = autoMap(rows[state.headerRow] ?? [], state.fields);
    revalidate();
  }

  function revalidate() {
    const d = dataset();
    const rows = state.sheets[state.sheetIndex].rows;
    const extracted = extractRows(rows, state.headerRow, state.mapping);
    state.prepared = d.prepare(extracted, state.ctx, state.importOptions);
    state.items = state.prepared.items;
    state.unused = unusedColumns(rows[state.headerRow] ?? [], state.mapping);
    state.result = null;
  }

  async function loadFile(file) {
    state.error = ''; state.notice = ''; state.result = null;
    try {
      state.sheets = await readSpreadsheet(file);
      state.file = { name: file.name };
      state.sheetIndex = 0;
      analyze();
    } catch (error) {
      state.file = null; state.sheets = []; state.items = [];
      state.error = error.message;
    }
    await render();
  }

  async function downloadSheets(built, csv) {
    await downloadWorkbook(built.sheets, `${safeFileName(built.fileName)}-${fileStamp()}`, { csv });
  }

  async function safely(task) {
    state.error = ''; state.notice = '';
    try { await task(); } catch (error) { state.error = error.message; }
    await render();
  }

  function wire() {
    on(container, '[data-pick]', 'click', (e) => {
      const key = e.currentTarget.getAttribute('data-pick');
      if (key === state.key) return;
      Object.assign(state, { key, importOptions: {}, exportOptions: {}, file: null, sheets: [], items: [], result: null, error: '', notice: '' });
      render();
    });

    on(container, '[data-opt]', 'change', (e) => {
      const [scope, key] = e.target.getAttribute('data-opt').split('|');
      const target = scope === 'import' ? state.importOptions : state.exportOptions;
      target[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (key === 'examinationId') target.classId = '';
      if (scope === 'import' && state.file) analyze(); // options change which rows/columns are valid
      render();
    });

    qs(container, '#export-all')?.addEventListener('click', () => safely(async () => {
      state.ctx = await loadContext();
      const sheets = EXPORT_ALL.filter((d) => datasetPermissions(d.key).export).flatMap((d) => d.export(state.ctx, {}).sheets);
      await downloadWorkbook(sheets, `school-data-${fileStamp()}`);
      state.notice = `Downloaded ${sheets.length} sheet${sheets.length === 1 ? '' : 's'}: ${sheets.map((s) => s.name).join(', ')}.`;
    }));
    qs(container, '#export-xlsx')?.addEventListener('click', () => safely(async () => {
      state.ctx = await loadContext();
      const built = dataset().export(state.ctx, state.exportOptions);
      await downloadSheets(built, false);
      state.notice = `Downloaded ${built.count} row${built.count === 1 ? '' : 's'}.`;
    }));
    qs(container, '#export-csv')?.addEventListener('click', () => safely(async () => {
      state.ctx = await loadContext();
      const built = dataset().export(state.ctx, state.exportOptions);
      await downloadSheets(built, true);
      state.notice = `Downloaded ${built.count} row${built.count === 1 ? '' : 's'}.`;
    }));
    qs(container, '#download-template')?.addEventListener('click', () => safely(async () => {
      const built = dataset().template(state.ctx, state.importOptions);
      await downloadSheets(built, false);
    }));

    const input = qs(container, '#file-input');
    input?.addEventListener('change', () => { if (input.files[0]) loadFile(input.files[0]); });
    const zone = qs(container, '#dropzone');
    if (zone && importReady()) {
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.background = 'var(--ink-50)'; });
      zone.addEventListener('dragleave', () => { zone.style.background = ''; });
      zone.addEventListener('drop', (e) => { e.preventDefault(); zone.style.background = ''; if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
    }

    qs(container, '#sheet-select')?.addEventListener('change', (e) => { state.sheetIndex = Number(e.target.value); analyze(); render(); });
    qs(container, '#header-row')?.addEventListener('change', (e) => { state.headerRow = Math.max(0, Number(e.target.value) - 1); analyze({ keepMapping: true }); render(); });
    on(container, '[data-map]', 'change', (e) => { state.mapping[e.target.getAttribute('data-map')] = Number(e.target.value); revalidate(); render(); });
    on(container, '[data-filter]', 'click', (e) => { state.filter = e.currentTarget.getAttribute('data-filter'); render(); });
    qs(container, '#skip-problems')?.addEventListener('change', (e) => { state.skipProblems = e.target.checked; render(); });

    qs(container, '#download-problems')?.addEventListener('click', () => safely(async () => {
      const rows = state.sheets[state.sheetIndex].rows;
      const header = rows[state.headerRow] ?? [];
      const bad = state.items.filter((i) => i.status === 'error' || i.status === 'skip');
      await downloadWorkbook([{ name: 'Problem rows', rows: [['Row', 'Status', 'What to fix', ...header], ...bad.map((i) => [i.rowNumber, i.status === 'error' ? 'Problem' : 'Skipped', i.messages.join(' '), ...(rows[i.rowNumber - 1] ?? [])])] }], `problem-rows-${safeFileName(dataset().key)}-${fileStamp()}`);
    }));

    qs(container, '#run-import')?.addEventListener('click', async () => {
      const d = dataset();
      state.busy = 'import'; state.error = ''; state.notice = ''; state.progress = 'Starting…';
      await render();
      try {
        const result = await d.commit(state.items, state.ctx, state.importOptions, (done, total, label) => {
          state.progress = `${label ?? 'Importing…'} ${total ? `${done}/${total}` : ''}`;
          const el = qs(container, '[role="status"]'); if (el) el.textContent = state.progress;
        }, state.prepared);
        const skipped = state.items.filter((i) => i.status === 'error' || i.status === 'skip').length;
        state.ctx = null;
        state.file = null; state.sheets = []; state.items = [];
        state.result = { ...result, skipped };
      } catch (error) {
        state.error = `The import stopped part-way: ${error.message}. Some rows may already have been saved — check the list, then re-run the import (rows already saved will be skipped).`;
        state.ctx = null;
      }
      state.busy = '';
      await render();
    });
  }

  render();
}
