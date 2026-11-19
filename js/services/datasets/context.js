// Shared plumbing for every import/export dataset: where the data lives
// (browser-local prototype vs Supabase), loading it, and writing it back.
import { isSupabaseConfigured } from '../../config/supabase.js';
import { SupabaseRepository } from '../../storage/SupabaseRepository.js';
import { uuid } from '../../lib/uuid.js';
import { classRepo, streamRepo, subjectRepo, termRepo, academicYearRepo } from '../academicService.js';
import { studentRepo } from '../studentService.js';
import { parentRepo, teacherRepo } from '../peopleService.js';
import { admissionRepo } from '../admissionsService.js';
import { bookRepo } from '../libraryService.js';
import { inventoryItemRepo } from '../inventoryService.js';
import { examinationRepo, examScoreRepo, gradingSystemRepo, gradeBandRepo, reportCardRepo } from '../examService.js';
import { getSchool } from '../schoolService.js';
import { norm, text } from '../importEngine.js';

export const remote = () => isSupabaseConfigured();

const LOCAL = {
  classes: classRepo, streams: streamRepo, subjects: subjectRepo, terms: termRepo, academicYears: academicYearRepo,
  students: studentRepo, parents: parentRepo, teachers: teacherRepo, admissions: admissionRepo,
  libraryBooks: bookRepo, inventory: inventoryItemRepo,
  examinations: examinationRepo, examScores: examScoreRepo, gradingSystems: gradingSystemRepo, gradeBands: gradeBandRepo, reportCards: reportCardRepo,
};

export const repoFor = (collection) => (remote() ? new SupabaseRepository(collection) : LOCAL[collection]);

// Same data shape as the report-card workspace, plus the other importable lists.
export async function loadContext() {
  const names = Object.keys(LOCAL);
  const values = await Promise.all(names.map((name) => Promise.resolve(repoFor(name).getAll())));
  const ctx = Object.fromEntries(names.map((name, index) => [name, values[index]]));
  ctx.school = remote() ? await new SupabaseRepository('school').getAll() : [getSchool()].filter(Boolean);
  ctx.classes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return ctx;
}

export async function createMany(collection, items, label) {
  if (!items.length) return [];
  return remote() ? repoFor(collection).createMany(items) : repoFor(collection).createMany(items, label);
}

export async function updateOne(collection, id, patch, label) {
  return remote() ? repoFor(collection).update(id, patch) : repoFor(collection).update(id, patch, label);
}

// Runs async work a few at a time (remote updates) without hammering the API.
export async function runLimited(list, limit, worker) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const index = next;
      next += 1;
      await worker(list[index], index);
    }
  });
  await Promise.all(lanes);
}

export const DUPLICATE_OPTION = (noun) => ({
  key: 'duplicates',
  type: 'select',
  label: `If a ${noun} already exists`,
  choices: [['skip', 'Skip it (keep what is in the system)'], ['update', 'Update it with the file’s details']],
  default: 'skip',
});

// ---- Classes and streams that may need creating --------------------------------

import { resolveClass } from '../importEngine.js';

// Resolves "Grade 1 A" etc. against existing classes and (optionally) plans new
// classes/streams, giving them ids up front so students can reference them.
export function makeClassResolver(ctx, { createMissing }) {
  const newClasses = new Map();
  const newStreams = new Map();
  let nextOrder = Math.max(0, ...ctx.classes.map((c) => c.order ?? 0)) + 1;

  const allClasses = () => [...ctx.classes, ...newClasses.values()];
  const streamsOf = (classId) => [...ctx.streams.filter((s) => s.classId === classId), ...[...newStreams.values()].filter((s) => s.classId === classId)];

  function resolve(classValue, streamValue = '') {
    let found = resolveClass(classValue, allClasses());
    let created = false;
    if (!found) {
      const name = text(classValue);
      if (!name || !createMissing) return null;
      // "Grade 1 A" / "Form 4B": the trailing letter is a stream, not part of the class name.
      const split = !text(streamValue) && name.match(/^(.*\d)\s*[-/]?\s*([A-Za-z])$/);
      if (split) return resolve(split[1], split[2].toUpperCase());
      const entry = { id: uuid(), name, order: nextOrder, isNew: true };
      nextOrder += 1;
      newClasses.set(norm(name), entry);
      found = { class: entry, rest: '' };
      created = true;
    }
    const streamName = text(streamValue) || text(found.rest);
    let stream = null;
    let streamCreated = false;
    let streamMissing = false;
    if (streamName) {
      stream = streamsOf(found.class.id).find((s) => norm(s.name) === norm(streamName)) ?? null;
      if (!stream && createMissing) {
        stream = { id: uuid(), classId: found.class.id, name: streamName, isNew: true };
        newStreams.set(`${found.class.id}|${norm(streamName)}`, stream);
        streamCreated = true;
      } else if (!stream) streamMissing = streamName;
    }
    return { class: found.class, stream, created, streamCreated, streamMissing };
  }

  // Only the classes/streams actually used by imported records get saved.
  async function commit(usedClassIds, usedStreamIds) {
    const classes = [...newClasses.values()].filter((c) => usedClassIds.has(c.id)).map(({ isNew, ...rest }) => rest);
    const streams = [...newStreams.values()].filter((s) => usedStreamIds.has(s.id) || usedClassIds.has(s.classId)).map(({ isNew, ...rest }) => rest);
    await createMany('classes', classes, 'imported classes');
    await createMany('streams', streams, 'imported streams');
    return { classes: classes.length, streams: streams.length };
  }
  return { resolve, commit, newClasses, newStreams };
}
