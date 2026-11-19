import { uuid } from '../../lib/uuid.js';
import { escapeHtml, on, qs, qsa } from '../../components/dom.js';
import { saveSchool } from '../../services/schoolService.js';
import { academicYearRepo, classRepo, curriculumRepo, streamRepo, subjectRepo, termRepo } from '../../services/academicService.js';
import { completeSchoolSetup } from '../../services/supabaseSchoolSetupService.js';
import { KENYA_COUNTIES, KENYA_GRADE_LEVELS, KENYA_SCHOOL_TYPES, KENYA_TERM_TEMPLATES } from '../../config/kenyaEducation.js';

const CURRICULUM_TYPES = [
  ['cbc', 'CBC / CBE'],
  ['cambridge', 'Cambridge'],
  ['custom', 'Custom'],
];
const STEP_LABELS = ['School', 'Type & curriculum', 'Academic year', 'Classes', 'Subjects', 'Finish'];

export function renderSetupWizard(rootEl, onComplete, prefill = {}) {
  const state = {
    step: 0,
    name: prefill.name ?? '',
    phone: prefill.phone ?? '',
    email: prefill.email ?? '',
    address: '',
    countyCode: '',
    logoUrl: '',
    letterheadUrl: '',
    schoolType: 'primary',
    curriculumType: 'cbc',
    curriculumName: 'CBC / CBE',
    yearLabel: String(new Date().getFullYear()),
    yearStart: '',
    yearEnd: '',
    termNames: KENYA_TERM_TEMPLATES.map(([, label]) => label),
    classes: [{ tempId: uuid(), name: '', streams: [''] }],
    subjects: [{ tempId: uuid(), name: '', code: '' }],
    error: null,
    saving: false,
  };

  render();

  function render() {
    rootEl.innerHTML = `
      <div style="min-height:100vh; display:flex; flex-direction:column;">
        <header class="wizard-header">
          <div class="container">
            <div class="flex items-center justify-between" style="margin-bottom:0.5rem;">
              <div class="flex items-center gap-2">
                <img src="./assets/logo-badge.png" alt="" width="28" height="28" class="brand-mark" />
                <p class="text-xs text-brand-700" style="font-weight:500;">SwiftIQ EduFlow</p>
              </div>
              ${prefill.onLogout ? `<button type="button" class="btn-ghost text-sm" id="wizard-logout">Log out</button>` : ''}
            </div>
            <h1 class="text-2xl" style="font-weight:600;">Let's set up your school</h1>
          </div>
        </header>
        <div class="wizard-steps">
          ${STEP_LABELS.map((label, i) => `<span class="${i === state.step ? 'current' : i < state.step ? 'done' : ''}">${i + 1}. ${escapeHtml(label)}</span>`).join('')}
        </div>
        <main class="container" style="flex:1; width:100%; padding: 1.5rem 1rem;">
          <div class="card card-p" id="wizard-step-body"></div>
        </main>
      </div>
    `;
    const logoutBtn = qs(rootEl, '#wizard-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', prefill.onLogout);
    renderStepBody();
  }

  function renderStepBody() {
    const body = qs(rootEl, '#wizard-step-body');
    body.innerHTML = stepHtml() + footerHtml();
    wireStepEvents(body);
  }

  function stepHtml() {
    switch (state.step) {
      case 0:
        return `
          <div class="space-y-4">
            <h2 class="text-lg" style="font-weight:600;">School information</h2>
            <div>
              <label class="label">School name</label>
              <input class="input" data-field="name" value="${escapeHtml(state.name)}" placeholder="e.g. Greenview Academy" />
            </div>
            <div class="grid sm-grid-2 gap-4">
              <div>
                <label class="label">Phone</label>
                <input class="input" data-field="phone" value="${escapeHtml(state.phone)}" placeholder="07XX XXX XXX" />
              </div>
              <div>
                <label class="label">Email</label>
                <input class="input" data-field="email" value="${escapeHtml(state.email)}" placeholder="info@school.ac.ke" />
              </div>
            </div>
            <div>
              <label class="label">Address</label>
              <input class="input" data-field="address" value="${escapeHtml(state.address)}" />
            </div>
            <div class="grid sm-grid-2 gap-4">
              <div>
                <label class="label" for="school-logo">School logo (optional)</label>
                <input class="input" id="school-logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" />
                ${state.logoUrl ? `<div class="mt-2"><img src="${escapeHtml(state.logoUrl)}" alt="School logo preview" style="width:72px;height:72px;object-fit:contain;border:1px solid var(--ink-200);border-radius:0.5rem;padding:0.25rem;" /></div>` : ''}
              </div>
              <div>
                <label class="label" for="school-letterhead">Letterhead (optional)</label>
                <input class="input" id="school-letterhead" type="file" accept="image/png,image/jpeg,image/webp" />
                ${state.letterheadUrl ? `<div class="mt-2"><img src="${escapeHtml(state.letterheadUrl)}" alt="Letterhead preview" style="width:100%;height:72px;object-fit:contain;border:1px solid var(--ink-200);border-radius:0.5rem;padding:0.25rem;" /></div>` : ''}
              </div>
            </div>
            <p class="text-xs text-ink-500">PNG, JPG, WEBP or SVG files up to 2 MB. This branding will be used on report cards and printable documents.</p>
            <div>
              <label class="label" for="school-county">County</label>
              <select class="input" id="school-county" data-field="countyCode">
                <option value="">Select county (optional)</option>
                ${KENYA_COUNTIES.map(([code, name]) => `<option value="${code}" ${state.countyCode === code ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
              </select>
            </div>
          </div>
        `;
      case 1:
        return `
          <div class="space-y-5">
            <div>
              <h2 class="text-lg" style="font-weight:600;">School type</h2>
              <div class="type-grid sm-grid-3 mt-3">
                ${KENYA_SCHOOL_TYPES.map(([v, label]) => `<button type="button" class="type-choice ${state.schoolType === v ? 'active' : ''}" data-school-type="${v}">${escapeHtml(label)}</button>`).join('')}
              </div>
            </div>
            <div>
              <h2 class="text-lg" style="font-weight:600;">Curriculum</h2>
              <p class="text-sm text-ink-500 mt-1">You can add more curricula later per class.</p>
              <div class="grid" style="grid-template-columns:repeat(3,1fr);" class="mt-3 gap-2">
                ${CURRICULUM_TYPES.map(([v, label]) => `<button type="button" class="type-choice ${state.curriculumType === v ? 'active' : ''}" data-curriculum-type="${v}" data-curriculum-label="${escapeHtml(label)}">${escapeHtml(label)}</button>`).join('')}
              </div>
              <div class="mt-3">
                <label class="label">Curriculum name</label>
                <input class="input" data-field="curriculumName" value="${escapeHtml(state.curriculumName)}" />
              </div>
            </div>
          </div>
        `;
      case 2:
        return `
          <div class="space-y-4">
            <h2 class="text-lg" style="font-weight:600;">Academic year & terms</h2>
            <div>
              <label class="label">Academic year label</label>
              <input class="input" style="max-width:160px" data-field="yearLabel" value="${escapeHtml(state.yearLabel)}" />
            </div>
            <div class="grid sm-grid-2 gap-4">
              <div>
                <label class="label">Start date</label>
                <input type="date" class="input" data-field="yearStart" value="${escapeHtml(state.yearStart)}" />
              </div>
              <div>
                <label class="label">End date</label>
                <input type="date" class="input" data-field="yearEnd" value="${escapeHtml(state.yearEnd)}" />
              </div>
            </div>
            <div>
              <label class="label">Terms</label>
              <div class="space-y-2">
                ${state.termNames.map((t, i) => `<input class="input" data-term-index="${i}" value="${escapeHtml(t)}" />`).join('')}
              </div>
            </div>
          </div>
        `;
      case 3:
        return `
          <div class="space-y-4">
            <h2 class="text-lg" style="font-weight:600;">Classes & streams</h2>
            <p class="text-sm text-ink-500">Add a stream name per line; leave blank if a class has none.</p>
            <div class="space-y-4">
              ${state.classes
                .map(
                  (c) => `
                <div class="card card-p" data-class-row="${c.tempId}" style="border:1px solid var(--ink-200); box-shadow:none;">
                  <div class="flex items-end gap-3">
                    <div class="flex-1">
                      <label class="label">Class name</label>
                      <input class="input" data-class-name="${c.tempId}" list="kenya-grade-levels" placeholder="e.g. Grade 6" value="${escapeHtml(c.name)}" />
                    </div>
                    ${state.classes.length > 1 ? `<button type="button" class="btn-ghost" data-remove-class="${c.tempId}">Remove</button>` : ''}
                  </div>
                  <div class="mt-3">
                    <label class="label">Streams (optional)</label>
                    <div class="flex flex-wrap gap-2">
                      ${c.streams
                        .map(
                          (s, i) =>
                            `<input class="input" style="width:7rem" data-stream="${c.tempId}:${i}" placeholder="${escapeHtml(c.name || 'Class')}${String.fromCharCode(65 + i)}" value="${escapeHtml(s)}" />`
                        )
                        .join('')}
                      <button type="button" class="btn-ghost text-sm" data-add-stream="${c.tempId}">+ Stream</button>
                    </div>
                  </div>
                </div>
              `
                )
                .join('')}
            </div>
            <button type="button" class="btn-secondary" id="add-class-btn">+ Add class</button>
            <datalist id="kenya-grade-levels">${KENYA_GRADE_LEVELS.map(([, label]) => `<option value="${escapeHtml(label)}"></option>`).join('')}</datalist>
          </div>
        `;
      case 4:
        return `
          <div class="space-y-4">
            <h2 class="text-lg" style="font-weight:600;">Subjects</h2>
            <p class="text-sm text-ink-500">Setup assigns these to all classes. Adjust subject assignments per grade afterward in Academics → Classes.</p>
            <div class="space-y-2">
              ${state.subjects
                .map(
                  (s) => `
                <div class="flex gap-2" data-subject-row="${s.tempId}">
                  <input class="input flex-1" placeholder="Subject name, e.g. Mathematics" data-subject-name="${s.tempId}" value="${escapeHtml(s.name)}" />
                  <input class="input" style="width:6rem" placeholder="Code" data-subject-code="${s.tempId}" value="${escapeHtml(s.code)}" />
                  ${state.subjects.length > 1 ? `<button type="button" class="btn-ghost" data-remove-subject="${s.tempId}">Remove</button>` : ''}
                </div>
              `
                )
                .join('')}
            </div>
            <button type="button" class="btn-secondary" id="add-subject-btn">+ Add subject</button>
          </div>
        `;
      case 5: {
        const classCount = state.classes.filter((c) => c.name.trim()).length;
        const subjectCount = state.subjects.filter((s) => s.name.trim()).length;
        return `
          <div class="space-y-4">
            <h2 class="text-lg" style="font-weight:600;">Review & finish</h2>
            <dl class="text-sm">
              ${row('School', state.name || '—')}
              ${row('Type', KENYA_SCHOOL_TYPES.find(([v]) => v === state.schoolType)?.[1] ?? '')}
              ${row('County', KENYA_COUNTIES.find(([code]) => code === state.countyCode)?.[1] ?? 'Not specified')}
              ${row('Curriculum', state.curriculumName)}
              ${row('Academic year', state.yearLabel)}
              ${row('Classes', String(classCount))}
              ${row('Subjects', String(subjectCount))}
            </dl>
            <p class="text-sm text-ink-500">
              Teachers, fee structures and detailed permissions can be filled in any time from Settings and their
              respective modules — you don't need everything ready to get started.
            </p>
          </div>
        `;
      }
      default:
        return '';
    }
  }

  function row(label, value) {
    return `<div class="flex justify-between" style="padding:0.5rem 0; border-bottom:1px solid var(--ink-100);"><dt class="text-ink-500">${escapeHtml(label)}</dt><dd style="font-weight:500;">${escapeHtml(value)}</dd></div>`;
  }

  function footerHtml() {
    return `
      ${state.error ? `<p class="mt-4 text-sm text-bad">${escapeHtml(state.error)}</p>` : ''}
      <div class="flex items-center justify-between mt-4" style="border-top:1px solid var(--ink-100); padding-top:1.25rem;">
        <button type="button" class="btn-ghost" id="wizard-back" ${state.step === 0 ? 'disabled' : ''}>Back</button>
        ${
          state.step < STEP_LABELS.length - 1
            ? `<button type="button" class="btn-primary" id="wizard-next">Continue</button>`
            : `<button type="button" class="btn-primary" id="wizard-finish" ${state.saving ? 'disabled' : ''}>${state.saving ? 'Setting up…' : 'Finish setup'}</button>`
        }
      </div>
    `;
  }

  function wireStepEvents(body) {
    const readBrandImage = (inputId, fieldName, maxSize) => {
      const input = qs(body, inputId);
      if (!input) return;
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > maxSize) {
          state.error = 'The selected image must be 2 MB or smaller.';
          renderStepBody();
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          state[fieldName] = String(reader.result);
          state.error = null;
          renderStepBody();
        };
        reader.readAsDataURL(file);
      });
    };
    readBrandImage('#school-logo', 'logoUrl', 2 * 1024 * 1024);
    readBrandImage('#school-letterhead', 'letterheadUrl', 2 * 1024 * 1024);

    // Plain text/date fields: update state directly, no re-render needed.
    qsa(body, '[data-field]').forEach((input) => {
      const updateField = () => {
        state[input.getAttribute('data-field')] = input.value;
      };
      input.addEventListener('input', updateField);
      input.addEventListener('change', updateField);
    });
    qsa(body, '[data-term-index]').forEach((input) => {
      input.addEventListener('input', () => {
        state.termNames[Number(input.getAttribute('data-term-index'))] = input.value;
      });
    });
    qsa(body, '[data-class-name]').forEach((input) => {
      input.addEventListener('input', () => {
        const tempId = input.getAttribute('data-class-name');
        state.classes.find((c) => c.tempId === tempId).name = input.value;
      });
    });
    qsa(body, '[data-stream]').forEach((input) => {
      input.addEventListener('input', () => {
        const [tempId, idx] = input.getAttribute('data-stream').split(':');
        state.classes.find((c) => c.tempId === tempId).streams[Number(idx)] = input.value;
      });
    });
    qsa(body, '[data-subject-name]').forEach((input) => {
      input.addEventListener('input', () => {
        const tempId = input.getAttribute('data-subject-name');
        state.subjects.find((s) => s.tempId === tempId).name = input.value;
      });
    });
    qsa(body, '[data-subject-code]').forEach((input) => {
      input.addEventListener('input', () => {
        const tempId = input.getAttribute('data-subject-code');
        state.subjects.find((s) => s.tempId === tempId).code = input.value;
      });
    });

    on(body, '[data-school-type]', 'click', (e) => {
      state.schoolType = e.currentTarget.getAttribute('data-school-type');
      renderStepBody();
    });
    on(body, '[data-curriculum-type]', 'click', (e) => {
      state.curriculumType = e.currentTarget.getAttribute('data-curriculum-type');
      state.curriculumName = e.currentTarget.getAttribute('data-curriculum-label');
      renderStepBody();
    });

    const addClassBtn = qs(body, '#add-class-btn');
    if (addClassBtn) addClassBtn.addEventListener('click', () => {
      state.classes.push({ tempId: uuid(), name: '', streams: [''] });
      renderStepBody();
    });
    on(body, '[data-remove-class]', 'click', (e) => {
      const tempId = e.currentTarget.getAttribute('data-remove-class');
      state.classes = state.classes.filter((c) => c.tempId !== tempId);
      renderStepBody();
    });
    on(body, '[data-add-stream]', 'click', (e) => {
      const tempId = e.currentTarget.getAttribute('data-add-stream');
      state.classes.find((c) => c.tempId === tempId).streams.push('');
      renderStepBody();
    });

    const addSubjectBtn = qs(body, '#add-subject-btn');
    if (addSubjectBtn) addSubjectBtn.addEventListener('click', () => {
      state.subjects.push({ tempId: uuid(), name: '', code: '' });
      renderStepBody();
    });
    on(body, '[data-remove-subject]', 'click', (e) => {
      const tempId = e.currentTarget.getAttribute('data-remove-subject');
      state.subjects = state.subjects.filter((s) => s.tempId !== tempId);
      renderStepBody();
    });

    const backBtn = qs(body, '#wizard-back');
    if (backBtn) backBtn.addEventListener('click', () => {
      state.error = null;
      state.step = Math.max(0, state.step - 1);
      renderStepBody();
    });
    const nextBtn = qs(body, '#wizard-next');
    if (nextBtn) nextBtn.addEventListener('click', () => {
      state.error = null;
      if (state.step === 0 && !state.name.trim()) {
        state.error = 'School name is required.';
        renderStepBody();
        return;
      }
      state.step = Math.min(STEP_LABELS.length - 1, state.step + 1);
      renderStepBody();
    });
    const finishBtn = qs(body, '#wizard-finish');
    if (finishBtn) finishBtn.addEventListener('click', finish);
  }

  async function finish() {
    state.saving = true;
    state.error = null;
    renderStepBody();
    if (prefill.backend) {
      try {
        await completeSchoolSetup(state, prefill);
        onComplete();
      } catch (e) {
        state.saving = false;
        state.error = `Setup could not be saved: ${e.message}`;
        renderStepBody();
      }
      return;
    }
    try {
      const curriculum = curriculumRepo.create({
        name: state.curriculumName.trim() || 'Default curriculum',
        type: state.curriculumType,
        appliesTo: [],
      });

      saveSchool({
        name: state.name.trim(),
        type: state.schoolType,
        curricula: [curriculum.id],
        phone: state.phone.trim() || undefined,
        email: state.email.trim() || undefined,
        address: state.address.trim() || undefined,
        logoUrl: state.logoUrl || undefined,
        letterheadUrl: state.letterheadUrl || undefined,
        countyCode: state.countyCode || undefined,
        currency: 'KES',
        timezone: 'Africa/Nairobi',
        country: 'Kenya',
        plan: prefill.plan,
        setupComplete: true,
      });

      const year = academicYearRepo.create({
        label: state.yearLabel.trim() || String(new Date().getFullYear()),
        startDate: state.yearStart,
        endDate: state.yearEnd,
        isCurrent: true,
      });

      state.termNames
        .filter((t) => t.trim())
        .forEach((t, i) => termRepo.create({ academicYearId: year.id, name: t.trim(), startDate: '', endDate: '', isCurrent: i === 0 }));

      const createdClassIds = [];
      state.classes
        .filter((c) => c.name.trim())
        .forEach((c, i) => {
          const created = classRepo.create({ name: c.name.trim(), order: i + 1, curriculumId: curriculum.id });
          createdClassIds.push(created.id);
          c.streams.filter((s) => s.trim()).forEach((s) => streamRepo.create({ classId: created.id, name: s.trim() }));
        });

      state.subjects
        .filter((s) => s.name.trim())
        .forEach((s) => {
          subjectRepo.create({
            name: s.name.trim(),
            code: s.code.trim() || s.name.trim().slice(0, 3).toUpperCase(),
            curriculumId: curriculum.id,
            classIds: createdClassIds,
            teacherIds: [],
          });
        });

      onComplete();
    } catch (e) {
      state.saving = false;
      state.error = 'Something went wrong while saving setup. Please try again.';
      renderStepBody();
    }
  }
}
