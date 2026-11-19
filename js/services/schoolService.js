import { StorageManager } from '../storage/StorageManager.js';
import { logAudit } from './auditService.js';

// The school profile is a single record, not a collection of many —
// so this service is a thin wrapper around one fixed key rather than a
// generic Repository.
const COLLECTION = 'school';
const SINGLETON_ID = 'the-school';

export function getSchool() {
  return StorageManager.get(COLLECTION, SINGLETON_ID);
}

export function isSetupComplete() {
  return getSchool()?.setupComplete ?? false;
}

export function saveSchool(data) {
  const existing = getSchool();
  const now = new Date().toISOString();
  const record = { ...data, id: SINGLETON_ID, createdAt: existing?.createdAt ?? now, updatedAt: now };
  StorageManager.set(COLLECTION, SINGLETON_ID, record);
  logAudit(existing ? 'updated school profile' : 'completed school setup', COLLECTION, SINGLETON_ID);
  return record;
}

export function updateSchool(patch) {
  const existing = getSchool();
  if (!existing) return undefined;
  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  StorageManager.set(COLLECTION, SINGLETON_ID, updated);
  logAudit('updated school profile', COLLECTION, SINGLETON_ID);
  return updated;
}
