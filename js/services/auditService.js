import { uuid } from '../lib/uuid.js';
import { StorageManager } from '../storage/StorageManager.js';

const COLLECTION = 'auditLog';

// Who is signed in, for the audit trail ("Grace added student ...").
let currentUserName;
export function setAuditUser(name) {
  currentUserName = name;
}

export function logAudit(action, entityType, entityId) {
  const now = new Date().toISOString();
  const entry = { id: uuid(), createdAt: now, updatedAt: now, action, entityType, entityId, userName: currentUserName };
  StorageManager.set(COLLECTION, entry.id, entry);
}

export function getAuditLog() {
  return StorageManager.all(COLLECTION).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
