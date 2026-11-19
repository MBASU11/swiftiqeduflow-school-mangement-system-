import { escapeHtml, on, qs } from '../../components/dom.js';
import { assessmentRepo, getScoresFor, saveScores, validateScores } from '../../services/assessmentService.js';
import { assessmentLockMessage } from '../../services/reportRunService.js';
import { studentsForClass, fullName } from '../../services/studentService.js';
import { emptyState } from '../../components/emptyState.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { loadAssessmentWorkspace, remoteStudentsForAssessment, scoresForAssessment, saveRemoteAssessmentScores } from '../../services/supabaseAssessmentService.js';

export function renderMarksEntry(container, assessmentId, onBack) {
  if (isSupabaseConfigured()) return renderRemoteMarksEntry(container, assessmentId, onBack);
  const assessment = assessmentRepo.getById(assessmentId);

  if (!assessment) {
    container.innerHTML = `<div class="card">${emptyState({ title: 'Assessment not found', actionsHtml: `<button class="btn-secondary" id="back-btn">Back</button>` })}</div>`;
    qs(container, '#back-btn').addEventListener('click', onBack);
    return;
  }

  const roster = studentsForClass(assessment.classId);
  const state = { values: {}, saved: false, lockError: '' };
  const existing = getScoresFor(assessment.id);
  roster.forEach((s) => {
    const score = existing.get(s.id)?.score;
    state.values[s.id] = score === null || score === undefined ? '' : String(score);
  });

  function render() {
    const lockMsg = assessmentLockMessage(assessment.id);
    const errors = validateScores(state.values, assessment.maxScore);
    const errorByStudent = Object.fromEntries(errors.map((e) => [e.studentId, e.message]));
    const enteredCount = Object.values(state.values).filter((v) => v.trim() !== '').length;

    container.innerHTML = `
      <div class="space-y-4">
        <button id="back-btn" class="text-sm text-ink-500" style="background:none;border:none;cursor:pointer;font-family:inherit;">← Back to assessments</button>

        <div class="flex justify-between items-center flex-wrap gap-3">
          <div>
            <h2 class="text-lg" style="font-weight:600;font-family:var(--font-display);">${escapeHtml(assessment.name)}</h2>
            <p class="text-sm text-ink-500">Out of ${assessment.maxScore} · ${enteredCount}/${roster.length} entered</p>
          </div>
          <div class="flex items-center gap-3">
            ${state.saved && errors.length === 0 ? `<span class="text-sm text-good">Saved.</span>` : ''}
            <button class="btn-primary" id="save-btn" ${errors.length > 0 || lockMsg ? 'disabled' : ''}>Save marks</button>
          </div>
        </div>
        ${lockMsg || state.lockError ? `<div class="notice" role="status"><span>${lockMsg ? '🔒 ' : ''}${escapeHtml(lockMsg || state.lockError)}</span></div>` : ''}

        ${
          roster.length === 0
            ? `<div class="card">${emptyState({ title: 'No students in this class' })}</div>`
            : `<div class="card" style="overflow:hidden;">
                <table class="data-table">
                  <thead><tr><th>Student</th><th style="width:8rem;">Score</th></tr></thead>
                  <tbody>
                    ${roster
                      .map(
                        (s, i) => `
                      <tr>
                        <td>${escapeHtml(fullName(s))}</td>
                        <td>
                          <input type="number" inputmode="decimal" class="input ${errorByStudent[s.id] ? 'error' : ''}" style="padding:0.4rem 0.6rem;" data-score="${s.id}" data-index="${i}" ${lockMsg ? 'disabled' : ''} value="${escapeHtml(state.values[s.id] ?? '')}" placeholder="—" />
                          ${errorByStudent[s.id] ? `<p class="field-error">${escapeHtml(errorByStudent[s.id])}</p>` : ''}
                        </td>
                      </tr>
                    `
                      )
                      .join('')}
                  </tbody>
                </table>
              </div>`
        }
      </div>
    `;

    qs(container, '#back-btn').addEventListener('click', onBack);
    const saveBtn = qs(container, '#save-btn');
    if (saveBtn) saveBtn.addEventListener('click', () => {
      const currentErrors = validateScores(state.values, assessment.maxScore);
      if (currentErrors.length > 0) {
        render();
        return;
      }
      try { saveScores(assessment.id, state.values); state.saved = true; state.lockError = ''; } catch (error) { state.lockError = error.message; }
      render();
    });

    on(container, '[data-score]', 'input', (e) => {
      state.values[e.target.getAttribute('data-score')] = e.target.value;
      state.saved = false;
    });
    on(container, '[data-score]', 'keydown', (e) => {
      const index = Number(e.target.getAttribute('data-index'));
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        const next = roster[index + 1];
        if (next) qs(container, `[data-score="${next.id}"]`).focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = roster[index - 1];
        if (prev) qs(container, `[data-score="${prev.id}"]`).focus();
      }
    });
    // Re-validate on blur without a full re-render (so typing doesn't lose focus);
    // full re-render only happens on save or navigation.
    on(container, '[data-score]', 'blur', () => {
      const currentErrors = validateScores(state.values, assessment.maxScore);
      const saveButton = qs(container, '#save-btn');
      if (saveButton) saveButton.disabled = currentErrors.length > 0 || Boolean(lockMsg);
    });
  }

  render();
}

async function renderRemoteMarksEntry(container, assessmentId, onBack) {
  let data;
  try {
    data = await loadAssessmentWorkspace();
  } catch (error) {
    container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span><button class="btn-secondary btn-sm" id="marks-retry">Retry</button></div>`;
    qs(container, '#marks-retry').addEventListener('click', () => renderRemoteMarksEntry(container, assessmentId, onBack));
    return;
  }
  const assessment = data.assessments.find((item) => item.id === assessmentId);
  if (!assessment) {
    container.innerHTML = `<div class="card">${emptyState({ title: 'Assessment not found', actionsHtml: `<button class="btn-secondary" id="back-btn">Back</button>` })}</div>`;
    qs(container, '#back-btn').addEventListener('click', onBack);
    return;
  }
  const roster = remoteStudentsForAssessment(data, assessment);
  const existing = scoresForAssessment(data, assessment.id);
  const state = {
    values: Object.fromEntries(roster.map((student) => {
      const score = existing.get(student.id)?.score;
      return [student.id, score === null || score === undefined ? '' : String(score)];
    })),
    saved: false,
    busy: false,
    error: '',
  };

  function render() {
    const errors = validateScores(state.values, assessment.maxScore);
    const errorByStudent = Object.fromEntries(errors.map((error) => [error.studentId, error.message]));
    const enteredCount = Object.values(state.values).filter((value) => value.trim() !== '').length;
    container.innerHTML = `
      <div class="space-y-4">
        <button id="back-btn" class="text-sm text-ink-500" style="background:none;border:none;cursor:pointer;font-family:inherit;">← Back to assessments</button>
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center flex-wrap gap-3"><div><h2 class="text-lg" style="font-weight:600;font-family:var(--font-display);">${escapeHtml(assessment.name)}</h2><p class="text-sm text-ink-500">Out of ${assessment.maxScore} · ${enteredCount}/${roster.length} entered</p></div><div class="flex items-center gap-3">${state.saved && errors.length === 0 ? '<span class="text-sm text-good">Saved.</span>' : ''}<button class="btn-primary" id="save-btn" ${errors.length > 0 || state.busy ? 'disabled' : ''}>${state.busy ? 'Saving...' : 'Save marks'}</button></div></div>
        ${roster.length === 0
          ? `<div class="card">${emptyState({ title: 'No students in this class' })}</div>`
          : `<div class="card" style="overflow:hidden;"><table class="data-table"><thead><tr><th>Student</th><th style="width:8rem;">Score</th></tr></thead><tbody>${roster.map((student, index) => `<tr><td>${escapeHtml(fullName(student))}</td><td><input type="number" inputmode="decimal" class="input ${errorByStudent[student.id] ? 'error' : ''}" style="padding:0.4rem 0.6rem;" data-score="${student.id}" data-index="${index}" value="${escapeHtml(state.values[student.id] ?? '')}" placeholder="—" />${errorByStudent[student.id] ? `<p class="field-error">${escapeHtml(errorByStudent[student.id])}</p>` : ''}</td></tr>`).join('')}</tbody></table></div>`}
      </div>`;

    qs(container, '#back-btn').addEventListener('click', onBack);
    const saveButton = qs(container, '#save-btn');
    if (saveButton) saveButton.addEventListener('click', async () => {
      const validationErrors = validateScores(state.values, assessment.maxScore);
      if (validationErrors.length) return render();
      state.busy = true;
      state.error = '';
      render();
      try {
        await saveRemoteAssessmentScores(assessment.id, state.values);
        state.saved = true;
      } catch (error) {
        state.error = error.message;
      }
      state.busy = false;
      render();
    });
    on(container, '[data-score]', 'input', (event) => {
      state.values[event.target.getAttribute('data-score')] = event.target.value;
      state.saved = false;
    });
    on(container, '[data-score]', 'keydown', (event) => {
      const index = Number(event.target.getAttribute('data-index'));
      if (event.key === 'ArrowDown' || event.key === 'Enter') {
        event.preventDefault();
        const next = roster[index + 1];
        if (next) qs(container, `[data-score="${next.id}"]`).focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const previous = roster[index - 1];
        if (previous) qs(container, `[data-score="${previous.id}"]`).focus();
      }
    });
    on(container, '[data-score]', 'blur', () => {
      const currentErrors = validateScores(state.values, assessment.maxScore);
      const button = qs(container, '#save-btn');
      if (button) button.disabled = currentErrors.length > 0 || state.busy;
    });
  }

  render();
}
