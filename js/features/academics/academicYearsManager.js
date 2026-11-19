import { escapeHtml, on, qs } from '../../components/dom.js';
import {
  academicYearRepo,
  termRepo,
  academicYearsSorted,
  getTermsForYear,
  setCurrentAcademicYear,
  setCurrentTerm,
  setCurrentAcademicRecordRemote,
} from '../../services/academicService.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { SupabaseRepository } from '../../storage/SupabaseRepository.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { examinationRepo } from '../../services/examService.js';
import { attendanceRepo as localAttendanceRepo } from '../../services/attendanceService.js';
import { LocalStorageRepository } from '../../storage/Repository.js';

export function renderAcademicYearsManager(container) {
  const remote = isSupabaseConfigured();
  const yearsRepo = remote ? new SupabaseRepository('academicYears') : academicYearRepo;
  const termsRepo = remote ? new SupabaseRepository('terms') : termRepo;
  const examsRepo = remote ? new SupabaseRepository('examinations') : examinationRepo;
  const attendanceRepo = remote ? new SupabaseRepository('attendance') : localAttendanceRepo;
  const ratingsRepo = remote ? new SupabaseRepository('competencyRatings') : new LocalStorageRepository('competencyRatings', 'competency rating');
  const lessonsRepo = remote ? new SupabaseRepository('lessonPlans') : new LocalStorageRepository('lessonPlans', 'lesson plan');
  const state = {
    formOpen: false,
    editingId: '',
    editingTermId: '',
    termEdit: {},
    label: String(new Date().getFullYear()),
    startDate: '',
    endDate: '',
    termNames: ['Term 1', 'Term 2', 'Term 3'],
    newTermNameByYear: {},
    error: '',
  };

  async function render() {
    let years;
    let terms;
    let examinations;
    let termDependents;
    try {
      [years, terms, examinations, ...termDependents] = await Promise.all([
        remote ? yearsRepo.getAll() : academicYearsSorted(),
        remote ? termsRepo.getAll() : termRepo.getAll(),
        examsRepo.getAll(),
        attendanceRepo.getAll(),
        ratingsRepo.getAll(),
        lessonsRepo.getAll(),
      ]);
      years.sort((a, b) => b.label.localeCompare(a.label));
    } catch (error) {
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span><button class="btn-secondary btn-sm" id="years-retry">Retry</button></div>`;
      qs(container, '#years-retry').addEventListener('click', render);
      return;
    }
    const termsByYear = terms.reduce((groups, term) => ((groups[term.academicYearId] ??= []).push(term), groups), {});

    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center">
          <p class="text-sm text-ink-500">Manage academic years and their terms. Mark one year and one term as current.</p>
          <button class="btn-primary" id="new-year-btn" data-write-collection="academicYears">+ Add academic year</button>
        </div>

        ${state.formOpen ? formHtml() : ''}

        ${
          years.length === 0
            ? `<div class="card">${emptyState({ iconHtml: icons.calendarCheck(40), title: 'No academic years yet', actionsHtml: `<button class="btn-primary" id="empty-new-btn" data-write-collection="academicYears">+ Add academic year</button>` })}</div>`
            : `<div class="space-y-3">${years.map((year) => yearRowHtml(year, termsByYear[year.id] ?? [])).join('')}</div>`
        }
      </div>
    `;

    qs(container, '#new-year-btn').addEventListener('click', () => { state.formOpen = true; state.editingId = ''; render(); });
    const emptyBtn = qs(container, '#empty-new-btn');
    if (emptyBtn) emptyBtn.addEventListener('click', () => { state.formOpen = true; state.editingId = ''; render(); });

    if (state.formOpen) wireForm();
    on(container, '[data-edit-year]', 'click', (e) => {
      const year = years.find((item) => item.id === e.currentTarget.getAttribute('data-edit-year'));
      if (!year) return;
      state.formOpen = true; state.editingId = year.id; state.label = year.label;
      state.startDate = year.startDate ?? ''; state.endDate = year.endDate ?? '';
      render();
    });

    on(container, '[data-make-year-current]', 'click', async (e) => {
      const id = e.currentTarget.getAttribute('data-make-year-current');
      try {
        if (remote) await setCurrentAcademicRecordRemote('academicYears', id);
        else setCurrentAcademicYear(id);
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
    on(container, '[data-make-term-current]', 'click', async (e) => {
      const id = e.currentTarget.getAttribute('data-make-term-current');
      try {
        if (remote) await setCurrentAcademicRecordRemote('terms', id);
        else setCurrentTerm(id);
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
    on(container, '[data-add-term]', 'click', async (e) => {
      const yearId = e.currentTarget.getAttribute('data-add-term');
      const name = (state.newTermNameByYear[yearId] || '').trim();
      if (!name) return;
      try {
        await termsRepo.create({ academicYearId: yearId, name, startDate: '', endDate: '', isCurrent: false });
        state.newTermNameByYear[yearId] = '';
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
    on(container, '[data-term-input]', 'input', (e) => {
      state.newTermNameByYear[e.target.getAttribute('data-term-input')] = e.target.value;
    });
    on(container, '[data-edit-term]', 'click', (e) => {
      const term = terms.find((item) => item.id === e.currentTarget.getAttribute('data-edit-term'));
      if (!term) return;
      state.editingTermId = term.id;
      state.termEdit[term.id] = { name: term.name, startDate: term.startDate ?? '', endDate: term.endDate ?? '' };
      render();
    });
    on(container, '[data-term-edit-input]', 'input', (e) => {
      const { termEdit } = state;
      termEdit[e.target.getAttribute('data-term-edit-input')][e.target.getAttribute('data-term-edit-field')] = e.target.value;
    });
    on(container, '[data-save-term]', 'click', async (e) => {
      const id = e.currentTarget.getAttribute('data-save-term');
      const patch = state.termEdit[id];
      if (!patch?.name.trim()) return;
      try { await termsRepo.update(id, patch, 'updated term'); state.editingTermId = ''; state.error = ''; }
      catch (error) { state.error = error.message; }
      await render();
    });
    on(container, '[data-cancel-term]', 'click', () => { state.editingTermId = ''; render(); });
    on(container, '[data-remove-term]', 'click', async (e) => {
      const id = e.currentTarget.getAttribute('data-remove-term');
      if (terms.some((term) => term.id === id && term.isCurrent)) {
        state.error = 'The current term cannot be removed. Set another term as current first.';
        return render();
      }
      if (examinations.some((exam) => exam.termId === id) || termDependents.some((records) => records.some((record) => record.termId === id))) {
        state.error = 'This term is used by examinations, attendance, ratings, or lesson plans. Move those records first.';
        return render();
      }
      if (!confirm('Remove this term?')) return;
      try {
        await termsRepo.remove(id, 'removed term');
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
    on(container, '[data-remove-year]', 'click', async (e) => {
      const id = e.currentTarget.getAttribute('data-remove-year');
      const year = years.find((item) => item.id === id);
      const relatedTerms = termsByYear[id] ?? [];
      if (year?.isCurrent) { state.error = 'The current academic year cannot be removed. Set another year as current first.'; return render(); }
      if (relatedTerms.some((term) => term.isCurrent)) { state.error = 'This year contains the current term. Set another term as current first.'; return render(); }
      if (relatedTerms.some((term) => examinations.some((exam) => exam.termId === term.id) || termDependents.some((records) => records.some((record) => record.termId === term.id)))) {
        state.error = 'This academic year has terms used by examinations or other school records. Move those records before removing the year.';
        return render();
      }
      if (!confirm(`Remove this academic year and its ${relatedTerms.length} term${relatedTerms.length === 1 ? '' : 's'}?`)) return;
      try {
        for (const term of (termsByYear[id] ?? [])) await termsRepo.remove(term.id, 'removed term');
        await yearsRepo.remove(id, 'removed academic year');
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
  }

  function yearRowHtml(y, terms) {
    return `
      <div class="card card-p">
        <div class="flex justify-between items-center">
          <div class="flex items-center gap-2">
            <p class="text-sm" style="font-weight:600;">${escapeHtml(y.label)}</p>
            ${y.isCurrent ? `<span class="badge badge-good">Current</span>` : `<button data-make-year-current="${y.id}" data-write-collection="academicYears" class="btn-secondary btn-sm">Make current</button>`}
          </div>
          <span class="flex gap-2"><button data-edit-year="${y.id}" data-write-collection="academicYears" class="btn-secondary btn-sm">Edit</button><button data-remove-year="${y.id}" data-write-collection="academicYears" class="text-bad" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;">Remove</button></span>
        </div>
        <div class="mt-3 space-y-1.5">
          ${terms
            .map(
              (t) => `
            <div class="flex items-center justify-between text-sm">
              ${state.editingTermId === t.id ? `<span class="flex flex-wrap gap-1"><input class="input" style="width:8rem;padding:.3rem .5rem;" data-term-edit-input="${t.id}" data-term-edit-field="name" value="${escapeHtml(state.termEdit[t.id]?.name ?? t.name)}" /><input class="input" type="date" style="width:9rem;padding:.3rem .5rem;" data-term-edit-input="${t.id}" data-term-edit-field="startDate" value="${escapeHtml(state.termEdit[t.id]?.startDate ?? '')}" /><input class="input" type="date" style="width:9rem;padding:.3rem .5rem;" data-term-edit-input="${t.id}" data-term-edit-field="endDate" value="${escapeHtml(state.termEdit[t.id]?.endDate ?? '')}" /><button data-save-term="${t.id}" data-write-collection="terms" class="btn-secondary btn-sm">Save</button><button data-cancel-term="${t.id}" class="btn-secondary btn-sm">Cancel</button></span>` : `<span>${escapeHtml(t.name)}${t.startDate || t.endDate ? ` <small class="text-ink-500">${escapeHtml(t.startDate ?? '')} – ${escapeHtml(t.endDate ?? '')}</small>` : ''}</span>`}
              <span class="flex items-center gap-2">
                ${t.isCurrent ? `<span class="badge badge-good">Current</span>` : `<button data-make-term-current="${t.id}" data-write-collection="terms" class="btn-secondary btn-sm">Make current</button>`}
                ${state.editingTermId !== t.id ? `<button data-edit-term="${t.id}" data-write-collection="terms" class="btn-secondary btn-sm">Edit</button><button data-remove-term="${t.id}" data-write-collection="terms" class="text-bad" style="background:none;border:none;cursor:pointer;font-family:inherit;">✕</button>` : ''}
              </span>
            </div>
          `
            )
            .join('')}
          <div class="flex gap-2 mt-2">
            <input class="input" style="width:10rem;padding:0.35rem 0.6rem;" data-term-input="${y.id}" placeholder="New term name" value="${escapeHtml(state.newTermNameByYear[y.id] || '')}" />
            <button class="btn-secondary btn-sm" data-add-term="${y.id}" data-write-collection="terms">+ Add term</button>
          </div>
        </div>
      </div>
    `;
  }

  function formHtml() {
    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editingId ? 'Edit academic year' : 'New academic year'}</h3>
        <div class="grid sm-grid-3 gap-4">
          <div>
            <label class="label">Label</label>
            <input class="input" id="year-label" value="${escapeHtml(state.label)}" />
          </div>
          <div>
            <label class="label">Start date</label>
            <input type="date" class="input" id="year-start" value="${escapeHtml(state.startDate)}" />
          </div>
          <div>
            <label class="label">End date</label>
            <input type="date" class="input" id="year-end" value="${escapeHtml(state.endDate)}" />
          </div>
        </div>
        <div>
          ${state.editingId ? '' : '<label class="label">Terms</label><div class="space-y-2">'}
          ${state.editingId ? '' : `
            ${state.termNames.map((t, i) => `<input class="input" data-term-index="${i}" value="${escapeHtml(t)}" />`).join('')}
          </div>`}
        </div>
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-year-btn">Cancel</button>
          <button class="btn-primary" id="save-year-btn" data-write-collection="academicYears">${state.editingId ? 'Save changes' : 'Add academic year'}</button>
        </div>
      </div>
    `;
  }

  function wireForm() {
    qs(container, '#year-label').addEventListener('input', (e) => (state.label = e.target.value));
    qs(container, '#year-start').addEventListener('input', (e) => (state.startDate = e.target.value));
    qs(container, '#year-end').addEventListener('input', (e) => (state.endDate = e.target.value));
    container.querySelectorAll('[data-term-index]').forEach((input) => {
      input.addEventListener('input', (e) => {
        state.termNames[Number(e.target.getAttribute('data-term-index'))] = e.target.value;
      });
    });
    qs(container, '#cancel-year-btn').addEventListener('click', () => { state.formOpen = false; state.editingId = ''; render(); });
    qs(container, '#save-year-btn').addEventListener('click', async () => {
      if (!state.label.trim()) return;
      try {
        if (state.editingId) {
          await yearsRepo.update(state.editingId, { label: state.label.trim(), startDate: state.startDate, endDate: state.endDate }, 'updated academic year');
          state.formOpen = false; state.editingId = ''; state.error = '';
          return await render();
        }
        const existingYears = await yearsRepo.getAll();
        const isFirst = existingYears.length === 0;
        const year = await yearsRepo.create({ label: state.label.trim(), startDate: state.startDate, endDate: state.endDate, isCurrent: isFirst });
        for (const [index, termName] of state.termNames.filter((name) => name.trim()).entries()) {
          await termsRepo.create({ academicYearId: year.id, name: termName.trim(), startDate: '', endDate: '', isCurrent: isFirst && index === 0 });
        }
        state.label = String(new Date().getFullYear());
        state.startDate = '';
        state.endDate = '';
        state.termNames = ['Term 1', 'Term 2', 'Term 3'];
        state.formOpen = false;
        state.editingId = '';
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
  }

  render();
}
