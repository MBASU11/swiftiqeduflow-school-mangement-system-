// The outbox: every change a teacher makes is written here FIRST, on the device, before any network
// is involved. Pure rules (no storage, no DOM) so they can be tested exhaustively.
//
// An operation ("op") describes ONE record change:
//   { opId, kind, key, payload, baseVersion, status, attempts, nextRetryAt, lastError, deviceId, createdAt, updatedAt, next? }
// - opId       idempotency key: the server applies a given opId at most once
// - key        natural key of the record (e.g. "attendance|class|2026-03-02|student"), so one record = one live op
// - baseVersion the version of the record this device last SAW; if the server has moved on, that is a conflict
// - status     pending → syncing → synced | failed | conflict   (discarded ops are deleted)

export const STATUS = { pending: 'pending', syncing: 'syncing', synced: 'synced', failed: 'failed', conflict: 'conflict' };
export const MAX_AUTO_ATTEMPTS = 8;
export const KEEP_SYNCED = 200; // recent history kept for the "synchronized" display

export const newOpId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export function makeOp({ kind, key, payload, baseVersion, deviceId, now = Date.now(), opId = newOpId() }) {
  return { opId, kind, key, payload, baseVersion: baseVersion ?? 0, status: STATUS.pending, attempts: 0, nextRetryAt: 0, lastError: null, deviceId, createdAt: now, updatedAt: now };
}

// Fold a new edit into the existing op for the same record (or return a new one).
// Rules that make duplicates and lost updates impossible:
//  * nothing live for this key            → a new op
//  * live op is pending/failed/conflict   → replace its payload, KEEP its baseVersion (what the device originally saw)
//  * live op is syncing (in flight)       → remember the edit in `next`; it is sent after the in-flight op finishes
//  * the newest edit equals what is already synced → no op
export function applyEdit(existing, incoming) {
  if (!existing || existing.status === STATUS.synced) return incoming;
  if (existing.status === STATUS.syncing) return { ...existing, next: { payload: incoming.payload, updatedAt: incoming.updatedAt } };
  return { ...existing, payload: incoming.payload, updatedAt: incoming.updatedAt, status: STATUS.pending, attempts: 0, nextRetryAt: 0, lastError: null, conflict: undefined };
}

// Deterministic back-off: 5s, 15s, 45s, 2m, 5m, then 15m between tries.
export const BACKOFF_MS = [5_000, 15_000, 45_000, 120_000, 300_000, 900_000];
export const backoffFor = (attempts) => BACKOFF_MS[Math.min(Math.max(attempts - 1, 0), BACKOFF_MS.length - 1)];

export const isDue = (op, now) => op.status === STATUS.pending && op.nextRetryAt <= now;
export const dueOps = (ops, now) => ops.filter((o) => isDue(o, now)).sort((a, b) => a.createdAt - b.createdAt);

export function summarize(ops) {
  const c = { pending: 0, syncing: 0, synced: 0, failed: 0, conflict: 0 };
  ops.forEach((o) => { c[o.status] += 1; });
  c.unsynced = c.pending + c.syncing + c.failed + c.conflict;
  return c;
}

// What the person sees next to a record. Never "synced" unless the server said so.
export const statusLabel = (status) => ({ pending: 'Waiting to sync', syncing: 'Syncing…', synced: 'Synchronized', failed: 'Failed — needs attention', conflict: 'Conflict — choose which to keep' }[status] ?? status);
