// Pushes the outbox to a "transport" (the system of record) safely:
//  * single-flight — two overlapping runs can never send the same op twice at once
//  * idempotent    — a retried op carries the same opId, so the server applies it once
//  * never silent  — conflicts and rejections are kept and shown; nothing is overwritten or dropped
//  * honest        — an op becomes "synced" ONLY when the transport says it was applied
import { STATUS, MAX_AUTO_ATTEMPTS, KEEP_SYNCED, applyEdit, backoffFor, dueOps, summarize, makeOp } from './outbox.js';

// transport.push(op) → one of
//   { status: 'applied',   version }                          the server stored it
//   { status: 'duplicate', version }                          the server had already applied this opId
//   { status: 'conflict',  server: { version, value, by, at } } the record changed since this device last saw it
//   { status: 'rejected',  reason }                           permanently refused (permission, validation, locked)
// or it THROWS for network/transient problems (the op is retried later).
export function createSyncEngine({ store, transport, now = () => Date.now(), isOnline = () => true, onChange = () => {} }) {
  let running = null;
  let recovered = false;

  const loadAll = () => store.all('outbox');
  const save = (op) => store.put('outbox', op.opId, op);
  const byKey = async (key) => (await loadAll()).find((o) => o.key === key && o.status !== STATUS.synced);
  const notify = async () => onChange(summarize(await loadAll()));

  // A crash or closed tab can leave ops stuck "syncing". Their opId makes re-sending safe.
  async function recover() {
    if (recovered) return;
    recovered = true;
    for (const op of await loadAll()) if (op.status === STATUS.syncing) await save({ ...op, status: STATUS.pending, nextRetryAt: 0 });
  }

  async function enqueue(newOp) {
    await recover();
    const existing = await byKey(newOp.key);
    const folded = applyEdit(existing, newOp);
    // If the existing live op was folded into, keep its opId; a brand-new op keeps its own.
    await save(folded);
    await notify();
    return folded;
  }

  async function finish(op, patch) {
    const done = { ...op, ...patch, updatedAt: now() };
    if (patch.status === STATUS.synced && op.next) {
      // An edit made while this op was in flight becomes a NEW op, based on the version the server just stored.
      await save({ ...done, next: undefined });
      await save(makeOp({ kind: op.kind, key: op.key, payload: op.next.payload, baseVersion: patch.version ?? op.baseVersion, deviceId: op.deviceId, now: now() }));
      return;
    }
    await save(done);
  }

  async function runOnce() {
    await recover();
    let progressed = 0;
    for (const op of dueOps(await loadAll(), now())) {
      if (!isOnline()) break;
      await save({ ...op, status: STATUS.syncing, updatedAt: now() });
      await notify();
      const live = { ...op, status: STATUS.syncing };
      let res;
      try {
        res = await transport.push(live);
      } catch (e) {
        const attempts = op.attempts + 1;
        const exhausted = attempts >= MAX_AUTO_ATTEMPTS;
        await finish(live, { status: exhausted ? STATUS.failed : STATUS.pending, attempts, nextRetryAt: now() + backoffFor(attempts), lastError: e?.message ?? 'Network problem', next: (await store.get('outbox', op.opId))?.next });
        await notify();
        if (!isOnline()) break;
        continue;
      }
      // pick up any edit made while we were waiting for the server
      const fresh = (await store.get('outbox', op.opId)) ?? live;
      const carry = { next: fresh.next, payload: live.payload };
      if (res.status === 'applied' || res.status === 'duplicate') {
        await finish({ ...fresh, ...carry }, { status: STATUS.synced, version: res.version, lastError: null, syncedAt: now(), attempts: op.attempts });
        progressed += 1;
      } else if (res.status === 'conflict') {
        await finish({ ...fresh, ...carry }, { status: STATUS.conflict, conflict: res.server, lastError: 'Someone else changed this record.' });
      } else {
        await finish({ ...fresh, ...carry }, { status: STATUS.failed, attempts: op.attempts + 1, lastError: res.reason ?? 'The server refused this change.', permanent: true });
      }
      await notify();
    }
    await prune();
    return progressed;
  }

  // Single-flight: callers during a run all wait for that same run.
  function sync() {
    if (running) return running;
    running = runOnce().finally(() => { running = null; });
    return running;
  }

  async function prune() {
    const synced = (await loadAll()).filter((o) => o.status === STATUS.synced).sort((a, b) => b.updatedAt - a.updatedAt);
    for (const old of synced.slice(KEEP_SYNCED)) await store.delete('outbox', old.opId);
  }

  // The person's choices for problems the engine will not decide for them.
  async function keepMine(opId) {
    const op = await store.get('outbox', opId);
    if (!op || op.status !== STATUS.conflict) return;
    // Their value wins, knowingly: base it on the version the server now has, so it applies cleanly.
    await save({ ...op, baseVersion: op.conflict?.version ?? op.baseVersion, status: STATUS.pending, attempts: 0, nextRetryAt: 0, lastError: null, resolution: 'kept-mine', conflict: undefined });
    await notify();
  }
  async function useServer(opId) { await store.delete('outbox', opId); await notify(); }
  async function retry(opId) {
    const op = await store.get('outbox', opId);
    if (op && op.status === STATUS.failed && !op.permanent) { await save({ ...op, status: STATUS.pending, attempts: 0, nextRetryAt: 0, lastError: null }); await notify(); }
  }
  async function discard(opId) { await store.delete('outbox', opId); await notify(); }

  return { enqueue, sync, keepMine, useServer, retry, discard, list: loadAll, summary: async () => summarize(await loadAll()), recover };
}
