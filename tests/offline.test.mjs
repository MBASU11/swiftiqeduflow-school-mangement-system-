// Run: node tests/offline.test.mjs
import assert from 'node:assert/strict';
const { createMemoryAdapter } = await import('../js/offline/kvStore.js');
const { createSyncEngine } = await import('../js/offline/syncEngine.js');
const { makeOp, applyEdit, backoffFor, STATUS, MAX_AUTO_ATTEMPTS, KEEP_SYNCED } = await import('../js/offline/outbox.js');
const { createLocalTransport, createProcessedLog } = await import('../js/offline/localTransport.js');
let fail = 0; const ok = async (name, fn) => { try { await fn(); console.log('  ✓', name); } catch (e) { fail++; console.error('  ✗', name, '\n    ', e.message); } };
let clock = 1_700_000_000_000; const now = () => clock;
const mkOp = (key, payload, baseVersion = 0, deviceId = 'devA') => makeOp({ kind: 'attendance', key, payload, baseVersion, deviceId, now: clock });
const ops = (store) => store.all('outbox');

// a fake server that applies each opId once and tracks versions per key
function fakeServer() {
  const rec = new Map(), seen = new Map(); let pushes = 0; const log = [];
  return { rec, get pushes() { return pushes; }, log, push: async (op) => {
    pushes += 1; log.push(op.opId);
    if (seen.has(op.opId)) return { status: 'duplicate', version: seen.get(op.opId) };
    const cur = rec.get(op.key) ?? { version: 0, value: null };
    if (cur.version !== op.baseVersion) return { status: 'conflict', server: { version: cur.version, value: cur.value, by: 'other device' } };
    rec.set(op.key, { version: cur.version + 1, value: op.payload }); seen.set(op.opId, cur.version + 1);
    return { status: 'applied', version: cur.version + 1 };
  } };
}
const engineFor = (store, transport, online = () => true) => createSyncEngine({ store, transport, now, isOnline: online });

console.log('Outbox rules');
await ok('edits to one record fold into one op and keep the ORIGINAL base version', () => {
  const a = mkOp('k', { status: 'present' }, 3); const b = applyEdit(a, mkOp('k', { status: 'absent' }, 99)); const c = applyEdit(b, mkOp('k', { status: 'late' }, 99));
  assert.equal(c.baseVersion, 3); assert.equal(c.payload.status, 'late'); assert.equal(c.opId, a.opId);
});
await ok('back-off grows and is capped', () => { assert.deepEqual([1, 2, 3, 4, 5, 6, 50].map(backoffFor), [5000, 15000, 45000, 120000, 300000, 900000, 900000]); });

console.log('Offline use and restarts');
await ok('with no connection nothing is sent, nothing is lost, and the queue survives a restart', async () => {
  const store = createMemoryAdapter(); const srv = fakeServer();
  const e1 = engineFor(store, srv, () => false);
  await e1.enqueue(mkOp('a|1', { status: 'present' })); await e1.enqueue(mkOp('a|2', { status: 'absent' }));
  await e1.sync(); assert.equal(srv.pushes, 0);
  const e2 = engineFor(store, srv, () => true);                 // "browser restarted": new engine, same device storage
  assert.equal((await e2.list()).length, 2);
  await e2.sync(); assert.equal(srv.pushes, 2); assert.ok((await ops(store)).every((o) => o.status === STATUS.synced));
});
await ok('a network failure keeps the op pending with back-off, then it syncs; no duplicate record', async () => {
  const store = createMemoryAdapter(); const srv = fakeServer(); let fails = 2;
  const flaky = { push: async (op) => { if (fails-- > 0) throw new Error('Failed to fetch'); return srv.push(op); } };
  const e = engineFor(store, flaky); await e.enqueue(mkOp('a|1', { status: 'present' }));
  await e.sync(); let [op] = await ops(store); assert.equal(op.status, STATUS.pending); assert.equal(op.attempts, 1); assert.ok(op.nextRetryAt > clock);
  await e.sync(); assert.equal((await ops(store))[0].attempts, 1, 'not retried before its back-off time');
  clock += 6000; await e.sync(); clock += 16000; await e.sync();
  [op] = await ops(store); assert.equal(op.status, STATUS.synced); assert.equal(srv.rec.get('a|1').version, 1);
});
await ok('repeated and overlapping syncs send each op once', async () => {
  const store = createMemoryAdapter(); const srv = fakeServer(); const e = engineFor(store, srv);
  for (let i = 0; i < 5; i++) await e.enqueue(mkOp(`a|${i}`, { status: 'present' }));
  await Promise.all([e.sync(), e.sync(), e.sync()]); await e.sync(); await e.sync();
  assert.equal(srv.pushes, 5);
});
await ok('a crash mid-sync is recovered and the retry is NOT applied twice (idempotent opId)', async () => {
  const store = createMemoryAdapter(); const srv = fakeServer(); const op = mkOp('a|1', { status: 'present' });
  await srv.push(op);                                          // the server applied it…
  await store.put('outbox', op.opId, { ...op, status: STATUS.syncing }); // …but the tab died before hearing back
  const e = engineFor(store, srv); await e.sync();
  assert.equal((await ops(store))[0].status, STATUS.synced); assert.equal(srv.rec.get('a|1').version, 1);
});
await ok('an edit made while a sync is in flight is not lost and is sent after, on the new version', async () => {
  const store = createMemoryAdapter(); const srv = fakeServer(); let e;
  const slow = { push: async (op) => { if (op.payload.status === 'present') await e.enqueue(mkOp('a|1', { status: 'absent' })); return srv.push(op); } };
  e = engineFor(store, slow); await e.enqueue(mkOp('a|1', { status: 'present' }));
  await e.sync(); await e.sync();
  assert.equal(srv.rec.get('a|1').value.status, 'absent'); assert.equal(srv.rec.get('a|1').version, 2);
});
await ok('"synchronized" only appears after the server applies it', async () => {
  const store = createMemoryAdapter(); const e = engineFor(store, { push: async () => ({ status: 'rejected', reason: 'no' }) });
  await e.enqueue(mkOp('a|1', { status: 'present' })); await e.sync(); assert.equal((await ops(store))[0].status, STATUS.failed);
});

console.log('Conflicts and failures');
await ok('two devices: the second is a CONFLICT, nothing is silently overwritten', async () => {
  const srv = fakeServer(); const sA = createMemoryAdapter(), sB = createMemoryAdapter();
  const A = engineFor(sA, srv), B = engineFor(sB, srv);
  await A.enqueue(mkOp('a|1', { status: 'present' }, 0, 'A')); await B.enqueue(mkOp('a|1', { status: 'absent' }, 0, 'B'));
  await A.sync(); await B.sync();
  assert.equal(srv.rec.get('a|1').value.status, 'present');
  const [b] = await ops(sB); assert.equal(b.status, STATUS.conflict); assert.equal(b.conflict.version, 1);
  await B.sync(); assert.equal(srv.pushes, 2, 'a conflict is not retried automatically');
});
await ok('"keep mine" applies on top of the server version; "use server" drops the local edit', async () => {
  const srv = fakeServer(); const sB = createMemoryAdapter(); const B = engineFor(sB, srv);
  await srv.push(mkOp('a|1', { status: 'present' }, 0, 'A'));
  await B.enqueue(mkOp('a|1', { status: 'absent' }, 0, 'B')); await B.sync();
  const [c] = await ops(sB); await B.keepMine(c.opId); await B.sync();
  assert.equal(srv.rec.get('a|1').value.status, 'absent'); assert.equal(srv.rec.get('a|1').version, 2);
  await srv.push(mkOp('a|2', { status: 'present' }, 0)); await B.enqueue(mkOp('a|2', { status: 'late' }, 0)); await B.sync();
  const c2 = (await ops(sB)).find((o) => o.key === 'a|2'); await B.useServer(c2.opId);
  assert.ok(!(await ops(sB)).some((o) => o.key === 'a|2')); assert.equal(srv.rec.get('a|2').value.status, 'present');
});
await ok('permanent refusals are not retried; too many network failures need a manual retry', async () => {
  const store = createMemoryAdapter(); let calls = 0;
  const e = engineFor(store, { push: async () => { calls++; throw new Error('offline'); } }); await e.enqueue(mkOp('a|1', { status: 'present' }));
  for (let i = 0; i < MAX_AUTO_ATTEMPTS + 2; i++) { clock += 1_000_000; await e.sync(); }
  assert.equal(calls, MAX_AUTO_ATTEMPTS); const [o] = await ops(store); assert.equal(o.status, STATUS.failed);
  await e.retry(o.opId); assert.equal((await ops(store))[0].status, STATUS.pending);
});
await ok('only the most recent synced history is kept', async () => {
  const store = createMemoryAdapter(); const srv = fakeServer(); const e = engineFor(store, srv);
  for (let i = 0; i < KEEP_SYNCED + 20; i++) await e.enqueue(mkOp(`a|${i}`, { status: 'present' }));
  await e.sync(); assert.equal((await ops(store)).length, KEEP_SYNCED);
});

console.log('Local transport rules');
class Repo { constructor(rows = []) { this.rows = rows; this.n = 0; } getAll() { return this.rows.map((r) => ({ ...r })); } getById(id) { return this.rows.find((r) => r.id === id); } create(d) { const r = { id: `r${++this.n}`, ...d, updatedAt: 'now' }; this.rows.push(r); return r; } update(id, p) { Object.assign(this.getById(id), p); } }
const mem = () => { const o = {}; return createProcessedLog({ read: () => o, write: () => {} }); };
function setup(extra = {}) {
  const repos = { attendance: new Repo(), assessments: new Repo([{ id: 'as1', classId: 'c1', maxScore: 50 }]), assessmentScores: new Repo(), examinations: new Repo([{ id: 'ex1' }]), examScores: new Repo() };
  const t = createLocalTransport({ repos, canWrite: () => true, classAllowed: (c) => c === 'c1', processed: mem(), ...extra });
  return { repos, t };
}
const att = (status, baseVersion = 0, id = undefined) => ({ ...makeOp({ kind: 'attendance', key: 'k', payload: { classId: 'c1', date: 'D', studentId: 's1', status, by: 'T' }, baseVersion, deviceId: 'x' }), ...(id ? { opId: id } : {}) });
await ok('attendance: create → update bumps the version; the same opId is never applied twice', async () => {
  const { repos, t } = setup(); const r1 = await t.push(att('present', 0, 'o1'));
  assert.deepEqual(r1, { status: 'applied', version: 1 });
  assert.deepEqual(await t.push(att('present', 0, 'o1')), { status: 'duplicate', version: 1 });
  assert.equal(repos.attendance.rows.length, 1);
  assert.deepEqual(await t.push(att('absent', 1, 'o2')), { status: 'applied', version: 2 }); assert.equal(repos.attendance.rows.length, 1);
});
await ok('attendance: a second device with a stale version conflicts unless it stored the same value', async () => {
  const { t } = setup(); await t.push(att('present', 0));
  assert.equal((await t.push(att('absent', 0))).status, 'conflict');
  assert.equal((await t.push(att('present', 0))).status, 'applied');
});
await ok('attendance: unassigned class, bad status and read-only roles are rejected, not stored', async () => {
  const { repos, t } = setup(); const bad = (p) => makeOp({ kind: 'attendance', key: 'k', payload: { classId: 'c1', date: 'D', studentId: 's', status: 'present', ...p }, deviceId: 'x' });
  assert.equal((await t.push(bad({ classId: 'c9' }))).status, 'rejected'); assert.equal((await t.push(bad({ status: 'sleeping' }))).status, 'rejected');
  const ro = setup({ canWrite: () => false }); assert.equal((await ro.t.push(bad({}))).status, 'rejected');
  assert.equal(repos.attendance.rows.length, 0);
});
const sc = (score, extra = {}, kind = 'assessmentScore') => makeOp({ kind, key: 's', payload: kind === 'assessmentScore' ? { assessmentId: 'as1', studentId: 's1', score, ...extra } : { examinationId: 'ex1', subjectId: 'sub', studentId: 's1', classId: 'c1', score, ...extra }, deviceId: 'x' });
await ok('marks: range checked against the assessment maximum; blank (null) clears a mark; exam marks work too', async () => {
  const { repos, t } = setup();
  assert.equal((await t.push(sc(51))).status, 'rejected'); assert.equal((await t.push(sc(-1))).status, 'rejected'); assert.equal((await t.push(sc(Number.NaN))).status, 'rejected'); assert.equal((await t.push(sc('40'))).status, 'rejected');
  assert.equal((await t.push(sc(40))).status, 'applied'); assert.equal(repos.assessmentScores.rows[0].score, 40);
  const clear = await t.push({ ...sc(null), baseVersion: 1 }); assert.equal(clear.status, 'applied'); assert.equal(repos.assessmentScores.rows[0].score, null);
  assert.equal((await t.push(sc(88, {}, 'examScore'))).status, 'applied'); assert.equal((await t.push(sc(101, {}, 'examScore'))).status, 'rejected');
});
await ok('marks: published/locked results and missing assessments are refused', async () => {
  const locked = setup({ isLocked: () => 'Results are published.' }); assert.match((await locked.t.push(sc(10))).reason, /published/);
  const { t } = setup(); assert.equal((await t.push(sc(10, { assessmentId: 'nope' }))).status, 'rejected');
});
await ok('end to end: two devices share one record store — the loser sees a conflict, the winner is intact', async () => {
  const { repos, t } = setup(); const sA = createMemoryAdapter(), sB = createMemoryAdapter(); const A = engineFor(sA, t), B = engineFor(sB, t);
  await A.enqueue(mkOp('k', { classId: 'c1', date: 'D', studentId: 's1', status: 'present' }, 0, 'A')); await B.enqueue(mkOp('k', { classId: 'c1', date: 'D', studentId: 's1', status: 'absent' }, 0, 'B'));
  await A.sync(); await B.sync();
  assert.equal(repos.attendance.rows.length, 1); assert.equal(repos.attendance.rows[0].status, 'present'); assert.equal((await sB.all('outbox'))[0].status, STATUS.conflict);
});
console.log('Marks entry checks');
const store0 = new Map(); globalThis.window ??= { localStorage: { getItem: (k) => store0.get(k) ?? null, setItem: (k, v) => store0.set(k, String(v)), removeItem: (k) => store0.delete(k) } }; globalThis.document ??= undefined;
const { checkMark } = await import('../js/features/offline/mobileMarks.js');
await ok('typed marks: blank is "not entered", text and out-of-range are errors, decimals allowed', () => {
  assert.deepEqual(checkMark('', 50), { value: null, error: '' }); assert.deepEqual(checkMark('  ', 50), { value: null, error: '' });
  assert.equal(checkMark('abc', 50).error, 'Enter a number'); assert.equal(checkMark('-3', 50).error, 'Enter a number'); assert.equal(checkMark('51', 50).error, 'Must be 0–50');
  assert.deepEqual(checkMark('42.5', 50), { value: 42.5, error: '' }); assert.deepEqual(checkMark('0', 50), { value: 0, error: '' }); assert.equal(checkMark('1e3', 2000).error, 'Enter a number');
});
console.log(fail ? `\n${fail} FAILED` : '\nAll passed'); process.exitCode = fail ? 1 : 0;
