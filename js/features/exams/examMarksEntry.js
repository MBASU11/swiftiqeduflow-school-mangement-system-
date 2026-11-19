import { escapeHtml, on, qs } from '../../components/dom.js';
import { classesSortedByOrder, getSubjectsForClass } from '../../services/academicService.js';
import { examinationRepo, examScoreRepo, getExamScoresFor, saveExamScores, lockedRunFor } from '../../services/examService.js';
import { lockMessage } from '../../services/academicEngine.js';
import { studentsForClass, fullName } from '../../services/studentService.js';
import { validateScores } from '../../services/assessmentService.js';
import { emptyState } from '../../components/emptyState.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { loadExamWorkspace, remoteScoresForExam, remoteStudentsForExamClass, remoteSubjectsForClass, saveRemoteExamScores } from '../../services/supabaseExamService.js';

export function renderExamMarksEntry(container, examinationId, onBack) {
  if (isSupabaseConfigured()) return renderRemoteExamMarksEntry(container, examinationId, onBack);
  const examination = examinationRepo.getById(examinationId);
  if (!examination) {
    container.innerHTML = `<div class="card">${emptyState({ title: 'Examination not found', actionsHtml: `<button class="btn-secondary" id="back-btn">Back</button>` })}</div>`;
    qs(container, '#back-btn').addEventListener('click', onBack);
    return;
  }

  const allClasses = classesSortedByOrder();
  const examClasses = allClasses.filter((c) => (examination.classIds || []).includes(c.id));
  const MAX_SCORE = 100;

  const state = { classId: examClasses[0]?.id ?? '', subjectId: '', values: {}, saved: false };

  function loadValues() {
    if (!state.classId || !state.subjectId) {
      state.values = {};
      return;
    }
    const roster = studentsForClass(state.classId);
    const existing = getExamScoresFor(examinationId, state.subjectId);
    const next = {};
    roster.forEach((s) => {
      const score = existing.get(s.id)?.score;
      next[s.id] = score === null || score === undefined ? '' : String(score);
    });
    state.values = next;
    state.saved = false;
  }

  function render() {
    const subjects = state.classId ? getSubjectsForClass(state.classId) : [];
    if (!state.subjectId && subjects.length > 0) state.subjectId = subjects[0].id;
    const roster = state.classId ? studentsForClass(state.classId) : [];
    const savedScoreCount = state.subjectId ? examScoreRepo.find((score) => score.examinationId === examinationId && score.subjectId === state.subjectId && roster.some((student) => student.id === score.studentId) && score.score !== null && score.score !== undefined).length : 0;
    const errors = validateScores(state.values, MAX_SCORE);
    const lockRun = state.classId ? lockedRunFor(examinationId, state.classId) : null;
    const errorByStudent = Object.fromEntries(errors.map((e) => [e.studentId, e.message]));

    container.innerHTML = `
      <div class="space-y-4">
        <button id="back-btn" class="text-sm text-ink-500" style="background:none;border:none;cursor:pointer;font-family:inherit;">← Back to examinations</button>

        <div>
          <h2 class="text-lg" style="font-weight:600;font-family:var(--font-display);">${escapeHtml(examination.name)}</h2>
          <p class="text-sm text-ink-500">Out of ${MAX_SCORE} per subject</p>
        </div>

        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="label">Class</label>
            <select class="input" id="class-select" style="min-width:10rem">
              ${examClasses.map((c) => `<option value="${c.id}" ${state.classId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="label">Subject</label>
            <select class="input" id="subject-select" style="min-width:10rem" ${subjects.length === 0 ? 'disabled' : ''}>
              ${subjects.length === 0 ? '<option>No subjects for this class</option>' : subjects.map((s) => `<option value="${s.id}" ${state.subjectId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
            </select>
          </div>
          <button class="btn-primary" id="save-btn" data-write-collection="examScores" ${errors.length > 0 || !state.subjectId || lockRun ? 'disabled' : ''} style="margin-left:auto">Save marks</button>
          ${savedScoreCount ? `<button class="btn-secondary" id="clear-scores-btn" data-write-collection="examScores" ${lockRun ? 'disabled' : ''}>Clear scores (${savedScoreCount})</button>` : ''}
          ${state.saved && errors.length === 0 ? `<span class="text-sm text-good">Saved.</span>` : ''}
        </div>
        ${lockRun ? `<div class="notice" role="status"><span>🔒 ${escapeHtml(lockMessage(lockRun))}</span></div>` : state.lockError ? `<div class="notice" role="alert"><span>${escapeHtml(state.lockError)}</span></div>` : ''}

        ${
          roster.length === 0
            ? `<div class="card">${emptyState({ title: 'No students in this class' })}</div>`
            : !state.subjectId
            ? `<div class="card">${emptyState({ title: 'This class has no subjects yet', body: 'Add subjects to this class from the setup wizard or a later Academics module.' })}</div>`
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
                          <input type="number" inputmode="decimal" class="input ${errorByStudent[s.id] ? 'error' : ''}" style="padding:0.4rem 0.6rem;" data-score="${s.id}" data-index="${i}" ${lockRun ? 'disabled' : ''} value="${escapeHtml(state.values[s.id] ?? '')}" placeholder="—" />
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
    qs(container, '#class-select').addEventListener('change', (e) => {
      state.classId = e.target.value;
      state.subjectId = '';
      loadValues();
      render();
    });
    const subjectSelect = qs(container, '#subject-select');
    if (subjectSelect) subjectSelect.addEventListener('change', (e) => {
      state.subjectId = e.target.value;
      loadValues();
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

    const saveBtn = qs(container, '#save-btn');
    if (saveBtn) saveBtn.addEventListener('click', () => {
      const currentErrors = validateScores(state.values, MAX_SCORE);
      if (currentErrors.length > 0) {
        render();
        return;
      }
      try { saveExamScores(examinationId, state.subjectId, state.values); state.saved = true; state.lockError = ''; } catch (error) { state.lockError = error.message; }
      render();
    });
    const clearScores = qs(container, '#clear-scores-btn');
    if (clearScores) clearScores.addEventListener('click', () => {
      if (!confirm(`Clear ${savedScoreCount} saved score${savedScoreCount === 1 ? '' : 's'} for this class and subject?`)) return;
      try {
        saveExamScores(examinationId, state.subjectId, Object.fromEntries(roster.map((student) => [student.id, ''])));
        state.lockError = '';
        loadValues();
      } catch (error) { state.lockError = error.message; }
      render();
    });
  }

  loadValues();
  render();
}

async function renderRemoteExamMarksEntry(container, examinationId, onBack) {
  let data;
  try { data = await loadExamWorkspace(); }
  catch (error) {
    container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span><button class="btn-secondary btn-sm" id="exam-marks-retry">Retry</button></div>`;
    qs(container, '#exam-marks-retry').addEventListener('click', () => renderRemoteExamMarksEntry(container, examinationId, onBack));
    return;
  }
  const examination = data.examinations.find((exam) => exam.id === examinationId);
  if (!examination) {
    container.innerHTML = `<div class="card">${emptyState({ title: 'Examination not found', actionsHtml: `<button class="btn-secondary" id="back-btn">Back</button>` })}</div>`;
    qs(container, '#back-btn').addEventListener('click', onBack);
    return;
  }
  const examClasses = data.classes.filter((schoolClass) => (examination.classIds ?? []).includes(schoolClass.id));
  const maxScore = 100;
  const state = { classId: examClasses[0]?.id ?? '', subjectId: '', values: {}, saved: false, error: '', busy: false };

  function loadValues() {
    if (!state.classId || !state.subjectId) { state.values = {}; return; }
    const roster = remoteStudentsForExamClass(data, state.classId);
    const scores = remoteScoresForExam(data, examinationId, state.subjectId);
    state.values = Object.fromEntries(roster.map((student) => {
      const score = scores.get(student.id)?.score;
      return [student.id, score === null || score === undefined ? '' : String(score)];
    }));
    state.saved = false;
  }

  function render() {
    const subjects = state.classId ? remoteSubjectsForClass(data, state.classId) : [];
    if (!state.subjectId && subjects.length) state.subjectId = subjects[0].id;
    const roster = state.classId ? remoteStudentsForExamClass(data, state.classId) : [];
    const errors = validateScores(state.values, maxScore);
    const errorByStudent = Object.fromEntries(errors.map((error) => [error.studentId, error.message]));
    const savedScoreCount = state.subjectId ? data.examScores.filter((score) => score.examinationId === examinationId && score.subjectId === state.subjectId && roster.some((student) => student.id === score.studentId) && score.score !== null && score.score !== undefined).length : 0;
    container.innerHTML = `<div class="space-y-4"><button id="back-btn" class="text-sm text-ink-500" style="background:none;border:none;cursor:pointer;font-family:inherit;">← Back to examinations</button>${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}<div><h2 class="text-lg" style="font-weight:600;font-family:var(--font-display);">${escapeHtml(examination.name)}</h2><p class="text-sm text-ink-500">Out of ${maxScore} per subject</p></div><div class="flex flex-wrap items-end gap-3"><div><label class="label">Class</label><select class="input" id="class-select" style="min-width:10rem">${examClasses.map((schoolClass) => `<option value="${schoolClass.id}" ${state.classId === schoolClass.id ? 'selected' : ''}>${escapeHtml(schoolClass.name)}</option>`).join('')}</select></div><div><label class="label">Subject</label><select class="input" id="subject-select" style="min-width:10rem" ${subjects.length === 0 ? 'disabled' : ''}>${subjects.length === 0 ? '<option>No subjects for this class</option>' : subjects.map((subject) => `<option value="${subject.id}" ${state.subjectId === subject.id ? 'selected' : ''}>${escapeHtml(subject.name)}</option>`).join('')}</select></div><button class="btn-primary" id="save-btn" data-write-collection="examScores" ${errors.length || !state.subjectId || state.busy ? 'disabled' : ''} style="margin-left:auto">${state.busy ? 'Saving...' : 'Save marks'}</button>${savedScoreCount ? `<button class="btn-secondary" id="clear-scores-btn" data-write-collection="examScores" ${state.busy ? 'disabled' : ''}>Clear scores (${savedScoreCount})</button>` : ''}${state.saved && errors.length === 0 ? '<span class="text-sm text-good">Saved.</span>' : ''}</div>${roster.length === 0 ? `<div class="card">${emptyState({ title: 'No students in this class' })}</div>` : !state.subjectId ? `<div class="card">${emptyState({ title: 'This class has no subjects yet' })}</div>` : `<div class="card" style="overflow:hidden;"><table class="data-table"><thead><tr><th>Student</th><th style="width:8rem;">Score</th></tr></thead><tbody>${roster.map((student, index) => `<tr><td>${escapeHtml(fullName(student))}</td><td><input type="number" inputmode="decimal" class="input ${errorByStudent[student.id] ? 'error' : ''}" style="padding:0.4rem 0.6rem;" data-score="${student.id}" data-index="${index}" value="${escapeHtml(state.values[student.id] ?? '')}" placeholder="—" />${errorByStudent[student.id] ? `<p class="field-error">${escapeHtml(errorByStudent[student.id])}</p>` : ''}</td></tr>`).join('')}</tbody></table></div>`}</div>`;
    qs(container, '#back-btn').addEventListener('click', onBack);
    qs(container, '#class-select').addEventListener('change', (event) => { state.classId = event.target.value; state.subjectId = ''; loadValues(); render(); });
    const subjectSelect = qs(container, '#subject-select');
    if (subjectSelect) subjectSelect.addEventListener('change', (event) => { state.subjectId = event.target.value; loadValues(); render(); });
    on(container, '[data-score]', 'input', (event) => { state.values[event.target.getAttribute('data-score')] = event.target.value; state.saved = false; });
    on(container, '[data-score]', 'keydown', (event) => {
      const index = Number(event.target.getAttribute('data-index'));
      if (event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); if (roster[index + 1]) qs(container, `[data-score="${roster[index + 1].id}"]`).focus(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); if (roster[index - 1]) qs(container, `[data-score="${roster[index - 1].id}"]`).focus(); }
    });
    const saveButton = qs(container, '#save-btn');
    if (saveButton) saveButton.addEventListener('click', async () => {
      if (validateScores(state.values, maxScore).length) return render();
      state.busy = true; state.error = ''; render();
      try { await saveRemoteExamScores(examinationId, state.subjectId, state.values); state.saved = true; }
      catch (error) { state.error = error.message; }
      state.busy = false; render();
    });
    const clearScores = qs(container, '#clear-scores-btn');
    if (clearScores) clearScores.addEventListener('click', async () => {
      if (!confirm(`Clear ${savedScoreCount} saved score${savedScoreCount === 1 ? '' : 's'} for this class and subject?`)) return;
      state.busy = true; state.error = ''; render();
      try {
        await saveRemoteExamScores(examinationId, state.subjectId, Object.fromEntries(roster.map((student) => [student.id, ''])));
        data = await loadExamWorkspace();
        loadValues();
      } catch (error) { state.error = error.message; }
      state.busy = false; render();
    });
  }
  loadValues();
  render();
}
