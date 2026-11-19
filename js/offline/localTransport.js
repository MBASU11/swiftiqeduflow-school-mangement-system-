// The system of record in DEMO mode is the browser's own school data. This transport applies queued
// operations to it with the same safety rules the real server must follow later:
//   duplicate-proof (by opId), conflict detection (by record version), permission and scope checks,
//   validation, and refusal to touch locked/published results.
// Every write goes through the normal repositories, so it is audited like any other change.
// In cloud mode a different transport (not built yet — the backend phase) takes this one's place.

const STATUSES = ['present', 'absent', 'late', 'excused'];

// deps are injected so the rules can be tested without a browser.
export function createLocalTransport({ repos, canWrite, classAllowed, isLocked = () => null, processed, now = () => Date.now() }) {
  const versionOf = (rec) => (rec ? rec.version ?? 1 : 0);
  const reject = (reason) => ({ status: 'rejected', reason });

  // Last-write info for the conflict screen.
  const describe = (rec, value) => ({ version: versionOf(rec), value, by: rec?.updatedBy ?? 'another device', at: rec?.updatedAt });

  function apply({ op, collection, repo, existing, patch, create, same, valueOf }) {
    const cur = versionOf(existing);
    if (existing && op.baseVersion !== cur) {
      if (same(existing)) return { status: 'applied', version: cur }; // someone already stored exactly this: not a conflict
      return { status: 'conflict', server: describe(existing, valueOf(existing)) };
    }
    const meta = { version: cur + 1, lastOpId: op.opId, updatedBy: op.payload.by ?? op.deviceId };
    if (existing) repo.update(existing.id, { ...patch, ...meta }, `synced ${collection} change`);
    else repo.create({ ...create, ...meta }, `synced ${collection} change`);
    return { status: 'applied', version: cur + 1 };
  }

  async function push(op) {
    const prior = processed.get(op.opId);
    if (prior) return { status: 'duplicate', version: prior };
    let result;
    const p = op.payload;

    if (op.kind === 'attendance') {
      if (!canWrite('attendance')) return reject('Your role cannot record attendance.');
      if (!classAllowed(p.classId)) return reject('That class is not assigned to you.');
      if (!STATUSES.includes(p.status)) return reject(`"${p.status}" is not a valid attendance status.`);
      const repo = repos.attendance;
      const existing = repo.getAll().find((r) => r.classId === p.classId && r.date === p.date && r.studentId === p.studentId);
      result = apply({ op, collection: 'attendance', repo, existing, patch: { status: p.status }, create: { studentId: p.studentId, classId: p.classId, streamId: p.streamId, date: p.date, status: p.status, termId: p.termId }, same: (r) => r.status === p.status, valueOf: (r) => ({ status: r.status }) });
    } else if (op.kind === 'assessmentScore' || op.kind === 'examScore') {
      const isExam = op.kind === 'examScore';
      if (!canWrite(isExam ? 'examScores' : 'assessmentScores')) return reject('Your role cannot enter marks.');
      const parent = isExam ? repos.examinations.getById(p.examinationId) : repos.assessments.getById(p.assessmentId);
      if (!parent) return reject(isExam ? 'That examination no longer exists.' : 'That assessment no longer exists.');
      const classId = isExam ? p.classId : parent.classId;
      if (classId && !classAllowed(classId)) return reject('That class is not assigned to you.');
      const locked = isLocked(op.kind, p, parent);
      if (locked) return reject(locked);
      const max = isExam ? 100 : Number(parent.maxScore) || 100;
      if (p.score !== null && (typeof p.score !== 'number' || !Number.isFinite(p.score) || p.score < 0 || p.score > max)) return reject(`A mark must be a number from 0 to ${max}.`);
      const repo = isExam ? repos.examScores : repos.assessmentScores;
      const existing = repo.getAll().find((r) => (isExam ? r.examinationId === p.examinationId && r.subjectId === p.subjectId : r.assessmentId === p.assessmentId) && r.studentId === p.studentId);
      const create = isExam ? { examinationId: p.examinationId, subjectId: p.subjectId, studentId: p.studentId, score: p.score } : { assessmentId: p.assessmentId, studentId: p.studentId, score: p.score };
      result = apply({ op, collection: isExam ? 'examScores' : 'assessmentScores', repo, existing, patch: { score: p.score }, create, same: (r) => (r.score ?? null) === p.score, valueOf: (r) => ({ score: r.score ?? null }) });
    } else {
      return reject(`Unknown change type "${op.kind}".`);
    }

    if (result.status === 'applied') processed.add(op.opId, result.version);
    return result;
  }

  return { push };
}

// opId → version, kept so a retried operation is recognised and never applied twice.
export function createProcessedLog({ read, write, limit = 5000 }) {
  return {
    get: (opId) => read()[opId],
    add(opId, version) {
      const log = read(); log[opId] = version;
      const keys = Object.keys(log);
      if (keys.length > limit) keys.slice(0, keys.length - limit).forEach((k) => delete log[k]);
      write(log);
    },
  };
}
