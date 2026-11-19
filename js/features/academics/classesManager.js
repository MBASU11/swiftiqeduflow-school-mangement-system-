import { escapeHtml, on, qs } from '../../components/dom.js';
import { classRepo, streamRepo, subjectRepo, classesSortedByOrder, getStreamsForClass, nextClassOrder, curriculumRepo, removeClassRemote } from '../../services/academicService.js';
import { studentRepo, studentsForClass } from '../../services/studentService.js';
import { isSupabaseConfigured } from '../../config/supabase.js';
import { SupabaseRepository } from '../../storage/SupabaseRepository.js';
import { emptyState } from '../../components/emptyState.js';
import { icons } from '../../components/icons.js';
import { KENYA_GRADE_LEVELS } from '../../config/kenyaEducation.js';
import { examinationRepo } from '../../services/examService.js';

export function renderClassesManager(container) {
  const remote = isSupabaseConfigured();
  const classesRepo = remote ? new SupabaseRepository('classes') : classRepo;
  const curriculaRepo = remote ? new SupabaseRepository('curricula') : curriculumRepo;
  const streamsRepo = remote ? new SupabaseRepository('streams') : streamRepo;
  const studentsRepository = remote ? new SupabaseRepository('students') : studentRepo;
  const subjectsRepo = remote ? new SupabaseRepository('subjects') : subjectRepo;
  const examsRepo = remote ? new SupabaseRepository('examinations') : examinationRepo;
  const state = { formOpen: false, editingId: '', name: '', curriculumId: '', editStreamId: '', editStreamName: '', newStreamNameByClass: {}, subjectsOpen: {}, error: '' };

  async function render() {
    let classes;
    let curricula;
    let streams;
    let students;
    let subjects;
    let examinations;
    try {
      [classes, curricula, streams, students, subjects, examinations] = remote
        ? await Promise.all([classesRepo.getAll(), curriculaRepo.getAll(), streamsRepo.getAll(), studentsRepository.getAll(), subjectsRepo.getAll(), examsRepo.getAll()])
        : [classesSortedByOrder(), curriculumRepo.getAll(), streamRepo.getAll(), studentRepo.getAll(), subjectRepo.getAll(), examsRepo.getAll()];
      subjects.sort((a, b) => a.name.localeCompare(b.name));
      classes.sort((a, b) => a.order - b.order);
    } catch (error) {
      container.innerHTML = `<div class="notice" role="alert"><span>${escapeHtml(error.message)}</span><button class="btn-secondary btn-sm" id="classes-retry">Retry</button></div>`;
      qs(container, '#classes-retry').addEventListener('click', render);
      return;
    }
    const curriculumById = Object.fromEntries(curricula.map((c) => [c.id, c]));
    const streamsByClass = Object.groupBy
      ? Object.groupBy(streams, (stream) => stream.classId)
      : streams.reduce((groups, stream) => ((groups[stream.classId] ??= []).push(stream), groups), {});
    const studentCountByClass = students.reduce((counts, student) => {
      if (student.status === 'active' && student.classId) counts[student.classId] = (counts[student.classId] ?? 0) + 1;
      return counts;
    }, {});

    container.innerHTML = `
      <div class="space-y-4">
        ${state.error ? `<div class="notice" role="alert"><span>${escapeHtml(state.error)}</span></div>` : ''}
        <div class="flex justify-between items-center">
          <p class="text-sm text-ink-500">Classes and their streams. Removing a class with students is blocked.</p>
          <button class="btn-primary" id="new-class-btn" data-write-collection="classes">+ Add class</button>
        </div>

        ${state.formOpen ? formHtml(curricula) : ''}

        ${
          classes.length === 0
            ? `            <div class="card">${emptyState({ iconHtml: icons.book(40), title: 'No classes yet', actionsHtml: `<button class="btn-primary" id="empty-new-btn" data-write-collection="classes">+ Add class</button>` })}</div>`
            : `<div class="space-y-3">
                ${classes.map((c) => classRowHtml(c, curriculumById, streamsByClass[c.id] ?? [], studentCountByClass[c.id] ?? 0, subjects, classes)).join('')}
              </div>`
        }
        <datalist id="kenya-grade-levels">${KENYA_GRADE_LEVELS.map(([, label]) => `<option value="${escapeHtml(label)}"></option>`).join('')}</datalist>
      </div>
    `;

    qs(container, '#new-class-btn').addEventListener('click', () => { state.formOpen = true; state.editingId = ''; state.name = ''; state.curriculumId = ''; render(); });
    const emptyBtn = qs(container, '#empty-new-btn');
    if (emptyBtn) emptyBtn.addEventListener('click', () => { state.formOpen = true; state.editingId = ''; state.name = ''; state.curriculumId = ''; render(); });

    if (state.formOpen) wireForm();
    on(container, '[data-edit-class]', 'click', (e) => {
      const schoolClass = classes.find((item) => item.id === e.currentTarget.getAttribute('data-edit-class'));
      if (!schoolClass) return;
      state.formOpen = true; state.editingId = schoolClass.id; state.name = schoolClass.name;
      state.curriculumId = schoolClass.curriculumId ?? '';
      render();
    });

    on(container, '[data-remove-class]', 'click', async (e) => {
      const id = e.currentTarget.getAttribute('data-remove-class');
      const classStreamIds = (streamsByClass[id] ?? []).map((stream) => stream.id);
      const enrolled = students.filter((student) => student.classId === id || classStreamIds.includes(student.streamId)).length;
      if (enrolled > 0) {
        alert('This class has students enrolled. Move or archive them first.');
        return;
      }
      if (subjects.some((subject) => (subject.classIds ?? []).includes(id))) {
        state.error = 'This class is assigned to subjects. Unassign those subjects before removing the class.';
        return render();
      }
      if (examinations.some((exam) => (exam.classIds ?? []).includes(id))) {
        state.error = 'This class is included in one or more examinations. Remove it from those examinations first.';
        return render();
      }
      if (!confirm('Remove this class and its streams?')) return;
      try {
        if (remote) await removeClassRemote(id);
        else {
          for (const stream of (streamsByClass[id] ?? [])) await streamsRepo.remove(stream.id, 'removed stream');
          await classesRepo.remove(id, 'removed class');
        }
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
    on(container, '[data-remove-stream]', 'click', async (e) => {
      try {
        const streamId = e.currentTarget.getAttribute('data-remove-stream');
        if (students.some((student) => student.streamId === streamId)) {
          state.error = 'This stream has students assigned. Reassign them before removing the stream.';
        } else if (confirm('Remove this stream?')) {
          await streamsRepo.remove(streamId, 'removed stream');
          state.error = '';
        }
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
    on(container, '[data-edit-stream]', 'click', (e) => {
      const stream = streams.find((item) => item.id === e.currentTarget.getAttribute('data-edit-stream'));
      if (!stream) return;
      state.editStreamId = stream.id; state.editStreamName = stream.name; render();
    });
    on(container, '[data-save-stream]', 'click', async (e) => {
      const id = e.currentTarget.getAttribute('data-save-stream');
      const name = (state.editStreamName || '').trim();
      if (!name) return;
      try { await streamsRepo.update(id, { name }, 'updated stream'); state.editStreamId = ''; state.error = ''; }
      catch (error) { state.error = error.message; }
      await render();
    });
    on(container, '[data-cancel-stream]', 'click', () => { state.editStreamId = ''; state.editStreamName = ''; render(); });
    on(container, '[data-add-stream]', 'click', async (e) => {
      const classId = e.currentTarget.getAttribute('data-add-stream');
      const name = (state.newStreamNameByClass[classId] || '').trim();
      if (!name) return;
      try {
        await streamsRepo.create({ classId, name });
        state.newStreamNameByClass[classId] = '';
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
    on(container, '[data-toggle-subjects]', 'click', (e) => {
      const id = e.currentTarget.getAttribute('data-toggle-subjects');
      state.subjectsOpen[id] = !state.subjectsOpen[id];
      render();
    });
    on(container, '[data-subject-check]', 'change', async (e) => {
      const [classId, subjectId] = e.target.getAttribute('data-subject-check').split('|');
      const subject = subjects.find((item) => item.id === subjectId);
      if (!subject) return;
      const current = subject.classIds ?? [];
      const classIds = e.target.checked ? [...new Set([...current, classId])] : current.filter((id) => id !== classId);
      try {
        await subjectsRepo.update(subjectId, { classIds }, 'updated subject grades');
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
    on(container, '[data-copy-subjects]', 'change', async (e) => {
      const targetId = e.target.getAttribute('data-copy-subjects');
      const sourceId = e.target.value;
      if (!sourceId) return;
      try {
        for (const subject of subjects.filter((item) => (item.classIds ?? []).includes(sourceId))) {
          if (!(subject.classIds ?? []).includes(targetId)) {
            await subjectsRepo.update(subject.id, { classIds: [...(subject.classIds ?? []), targetId] }, 'copied subjects between grades');
          }
        }
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
    on(container, '[data-stream-input]', 'input', (e) => {
      state.newStreamNameByClass[e.target.getAttribute('data-stream-input')] = e.target.value;
    });
    on(container, '[data-stream-edit-input]', 'input', (e) => { state.editStreamName = e.target.value; });
  }

  function classRowHtml(c, curriculumById, streams, studentCount, subjects, classes) {
    const assigned = subjects.filter((s) => (s.classIds ?? []).includes(c.id));
    const open = Boolean(state.subjectsOpen[c.id]);
    const otherGrades = classes.filter((other) => other.id !== c.id);
    return `
      <div class="card card-p">
        <div class="flex justify-between items-center">
          <div>
            <p class="text-sm" style="font-weight:600;">${escapeHtml(c.name)}</p>
            <p class="text-xs text-ink-500 mt-1">${escapeHtml(curriculumById[c.curriculumId ?? '']?.name ?? 'No curriculum set')} · ${studentCount} student${studentCount === 1 ? '' : 's'}</p>
          </div>
          <span class="flex gap-2"><button data-edit-class="${c.id}" data-write-collection="classes" class="btn-secondary btn-sm">Edit</button><button data-remove-class="${c.id}" data-write-collection="classes" class="text-bad" style="background:none;border:none;cursor:pointer;text-decoration:underline;font-family:inherit;">Remove class</button></span>
        </div>
        <div class="mt-3">
          <p class="text-xs text-ink-500 mb-1.5">Streams</p>
          <div class="flex flex-wrap gap-2 items-center">
            ${streams
              .map(
                (s) => state.editStreamId === s.id
                  ? `<span class="flex gap-1"><input class="input" style="width:8rem;padding:0.25rem 0.4rem;" data-stream-edit-input="${s.id}" value="${escapeHtml(state.editStreamName)}" /><button class="btn-secondary btn-sm" data-save-stream="${s.id}" data-write-collection="streams">Save</button><button class="btn-secondary btn-sm" data-cancel-stream="${s.id}">Cancel</button></span>`
                  : `<span class="badge" style="background:var(--ink-100);color:var(--ink-700);">${escapeHtml(s.name)} <button data-edit-stream="${s.id}" data-write-collection="streams" style="background:none;border:none;cursor:pointer;color:var(--ink-600);margin-left:0.3rem;font-family:inherit;" aria-label="Edit ${escapeHtml(s.name)}">✎</button><button data-remove-stream="${s.id}" data-write-collection="streams" style="background:none;border:none;cursor:pointer;color:var(--bad);margin-left:0.3rem;font-family:inherit;">✕</button></span>`
              )
              .join('')}
            <input class="input" style="width:8rem;padding:0.35rem 0.6rem;" data-stream-input="${c.id}" placeholder="New stream" value="${escapeHtml(state.newStreamNameByClass[c.id] || '')}" />
            <button class="btn-secondary btn-sm" data-add-stream="${c.id}" data-write-collection="streams">+ Add</button>
          </div>
        </div>
        <div class="mt-3">
          <div class="flex items-center justify-between">
            <p class="text-xs text-ink-500 mb-1.5">Subjects (${assigned.length}) — shown on this grade's report cards and timetable</p>
            <button class="btn-secondary btn-sm" data-toggle-subjects="${c.id}">${open ? 'Done' : 'Manage subjects'}</button>
          </div>
          ${
            assigned.length
              ? `<div class="flex flex-wrap gap-2">${assigned.map((s) => `<span class="badge" style="background:var(--ink-100);color:var(--ink-700);">${escapeHtml(s.name)}</span>`).join('')}</div>`
              : `<p class="text-sm text-ink-400">No subjects assigned yet.</p>`
          }
          ${
            open
              ? `<div class="mt-3" style="border-top:1px solid var(--ink-100);padding-top:0.75rem;">
                  ${
                    subjects.length === 0
                      ? `<p class="text-sm text-ink-400">Create subjects first on the Subjects tab.</p>`
                      : `<div class="flex flex-wrap gap-x-5 gap-y-2">${subjects.map((s) => `<label class="flex items-center gap-1.5 text-sm"><input type="checkbox" data-subject-check="${c.id}|${s.id}" ${(s.classIds ?? []).includes(c.id) ? 'checked' : ''}/> ${escapeHtml(s.name)}</label>`).join('')}</div>
                         ${
                           otherGrades.length
                             ? `<div class="flex items-center gap-2 mt-3"><span class="text-xs text-ink-500">Copy subjects from</span>
                                 <select class="input" style="width:11rem;padding:0.35rem 0.6rem;" data-copy-subjects="${c.id}"><option value="">Choose grade…</option>${otherGrades.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}</select></div>`
                             : ''
                         }`
                  }
                </div>`
              : ''
          }
        </div>
      </div>
    `;
  }

  function formHtml(curricula) {
    return `
      <div class="card card-p space-y-4">
        <h3 class="text-sm text-ink-700" style="font-weight:600;">${state.editingId ? 'Edit class' : 'New class'}</h3>
        <div class="grid sm-grid-2 gap-4">
          <div>
            <label class="label">Class name</label>
            <input class="input" id="class-name" list="kenya-grade-levels" value="${escapeHtml(state.name)}" placeholder="e.g. Grade 7" />
          </div>
          <div>
            <label class="label">Curriculum (optional)</label>
            <select class="input" id="class-curriculum">
              <option value="">None</option>
              ${curricula.map((c) => `<option value="${c.id}" ${state.curriculumId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="flex justify-end gap-3">
          <button class="btn-secondary" id="cancel-class-btn">Cancel</button>
          <button class="btn-primary" id="save-class-btn" data-write-collection="classes">${state.editingId ? 'Save changes' : 'Add class'}</button>
        </div>
      </div>
    `;
  }

  function wireForm() {
    qs(container, '#class-name').addEventListener('input', (e) => (state.name = e.target.value));
    qs(container, '#class-curriculum').addEventListener('change', (e) => (state.curriculumId = e.target.value));
    qs(container, '#cancel-class-btn').addEventListener('click', () => { state.formOpen = false; state.editingId = ''; render(); });
    qs(container, '#save-class-btn').addEventListener('click', async () => {
      if (!state.name.trim()) return;
      try {
        if (state.editingId) {
          await classesRepo.update(state.editingId, { name: state.name.trim(), curriculumId: state.curriculumId || undefined }, 'updated class');
        } else if (remote) {
          const existing = await classesRepo.getAll();
          await classesRepo.create({ name: state.name.trim(), order: existing.length ? Math.max(...existing.map((item) => item.order)) + 1 : 1, curriculumId: state.curriculumId || undefined });
        } else {
          await classesRepo.create({ name: state.name.trim(), order: nextClassOrder(), curriculumId: state.curriculumId || undefined });
        }
        state.name = '';
        state.editingId = '';
        state.curriculumId = '';
        state.formOpen = false;
        state.error = '';
      } catch (error) {
        state.error = error.message;
      }
      await render();
    });
  }

  render();
}
