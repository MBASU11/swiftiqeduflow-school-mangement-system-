// One place that wires the offline pieces together for the app: the on-device store, the outbox and
// sync engine, saved copies of rosters (so a register can be opened with no signal), drafts, and the
// auto-sync triggers. Demo mode syncs into the browser's own school data; cloud mode is NOT connected
// yet (backend phase), and the new screens are therefore hidden there.
import { pickAdapter } from './kvStore.js';
import { createSyncEngine } from './syncEngine.js';
import { makeOp } from './outbox.js';
import { lockReasonForWrite } from '../services/reportRunService.js';
import { createLocalTransport, createProcessedLog } from './localTransport.js';
import { isSupabaseConfigured } from '../config/supabase.js';
import { StorageManager } from '../storage/StorageManager.js';
import { attendanceRepo } from '../services/attendanceService.js';
import { assessmentRepo, assessmentScoreRepo } from '../services/assessmentService.js';
import { examinationRepo, examScoreRepo } from '../services/examService.js';
import { canWriteCollection, getCurrentRole } from '../services/accessService.js';
import { currentAccount } from '../services/authService.js';
import { moduleEnabled } from '../services/subscriptionService.js';
import { loadTeacher, myClasses } from '../services/teacherService.js';
import * as T from '../services/teacherLogic.js';

// Whether the new offline screens are offered. Cloud mode waits for the backend phase.
export const offlineAvailable = () => !isSupabaseConfigured();
export const offlineUsable = (moduleKey) => offlineAvailable() && moduleEnabled(moduleKey);

export const store = pickAdapter();
let engine; let listeners = new Set(); let deviceId;

async function getDeviceId() {
  if (deviceId) return deviceId;
  deviceId = await store.get('meta', 'deviceId');
  if (!deviceId) { deviceId = `dev-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`; await store.put('meta', 'deviceId', deviceId); }
  return deviceId;
}

// A teacher may only write to classes assigned to them; everyone else follows their normal role.
let scopeCache = null;
export async function refreshScope() { scopeCache = (await loadTeacher()).scope; return scopeCache; }
export { myClasses };
const classAllowed = (classId) => (scopeCache ? T.classAllowed(scopeCache, classId) : true);

function buildTransport() {
  return createLocalTransport({
    repos: { attendance: attendanceRepo, assessments: assessmentRepo, assessmentScores: assessmentScoreRepo, examinations: examinationRepo, examScores: examScoreRepo },
    canWrite: (c) => canWriteCollection(c),
    classAllowed: (c) => classAllowed(c),
    isLocked: lockReasonForWrite,
    processed: createProcessedLog({ read: () => StorageManager.getGlobal('offlineProcessed') ?? {}, write: (v) => StorageManager.setGlobal('offlineProcessed', v) }),
  });
}

export function getEngine() {
  if (!engine) {
    engine = createSyncEngine({ store, transport: buildTransport(), isOnline: () => globalThis.navigator?.onLine !== false, onChange: (s) => listeners.forEach((fn) => fn(s)) });
  }
  return engine;
}
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export async function queueAttendance({ classId, streamId, date, studentId, status, baseVersion, termId }) {
  const by = currentAccount()?.name ?? getCurrentRole() ?? 'teacher';
  const op = makeOp({ kind: 'attendance', key: `attendance|${classId}|${date}|${studentId}`, payload: { classId, streamId, date, studentId, status, termId, by }, baseVersion, deviceId: await getDeviceId() });
  await getEngine().enqueue(op);
  getEngine().sync();
}

export async function queueScore({ kind, ids, classId, score, baseVersion }) {
  const by = currentAccount()?.name ?? getCurrentRole() ?? 'teacher';
  const key = kind === 'examScore' ? `exam|${ids.examinationId}|${ids.subjectId}|${ids.studentId}` : `assess|${ids.assessmentId}|${ids.studentId}`;
  const op = makeOp({ kind, key, payload: { ...ids, classId, score, by }, baseVersion, deviceId: await getDeviceId() });
  await getEngine().enqueue(op);
}
export const syncNow = () => getEngine().sync();

// ---- saved copies and drafts (all on the device, survive restarts)
export async function withSnapshot(key, loader) {
  try { const data = await loader(); await store.put('snapshots', key, { data, savedAt: Date.now() }); return { data, fromSavedCopy: false }; }
  catch (e) { const saved = await store.get('snapshots', key); if (saved) return { data: saved.data, fromSavedCopy: true, savedAt: saved.savedAt }; throw e; }
}
export const saveDraft = (key, value) => store.put('drafts', key, { value, savedAt: Date.now() });
export const loadDraft = (key) => store.get('drafts', key);
export const clearDraft = (key) => store.delete('drafts', key);

// ---- automatic syncing: when the connection returns, when the app is reopened, and every 30 seconds
export function startAutoSync() {
  if (startAutoSync.on || typeof window === 'undefined') return;
  startAutoSync.on = true;
  // Ask the browser not to evict the unsynced queue when the phone is short of space (it may still say no).
  navigator.storage?.persist?.().catch(() => {});
  const go = () => getEngine().sync();
  window.addEventListener('online', go);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') go(); });
  setInterval(go, 30_000);
  go();
}
