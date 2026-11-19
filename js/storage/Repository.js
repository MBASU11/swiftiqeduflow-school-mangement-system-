// A Repository is the contract each *Service uses to persist one entity type.
// LocalStorageRepository is today's implementation. Swapping to a real backend
// later means writing an ApiRepository with the same five methods and pointing
// each service at it — no page needs to change.

import { uuid } from '../lib/uuid.js';
import { StorageManager } from './StorageManager.js';
import { logAudit } from '../services/auditService.js';
import { assertCanWrite } from '../services/accessService.js';
import { guardEnrolment } from '../services/capacityGuard.js';

export class LocalStorageRepository {
  constructor(collection, entityLabel) {
    this.collection = collection;
    this.entityLabel = entityLabel;
  }

  getAll() {
    return StorageManager.all(this.collection);
  }

  getById(id) {
    return StorageManager.get(this.collection, id);
  }

  find(predicate) {
    return StorageManager.filter(this.collection, predicate);
  }

  create(data, auditLabel) {
    assertCanWrite(this.collection);
    guardEnrolment(this.collection, { creating: [data] });
    const now = new Date().toISOString();
    const record = { ...data, id: uuid(), createdAt: now, updatedAt: now };
    StorageManager.set(this.collection, record.id, record);
    logAudit(auditLabel ?? `added ${this.entityLabel}`, this.collection, record.id);
    return record;
  }

  // Bulk create used by imports. Honors a pre-assigned `id` so related records
  // (student <-> parent) can reference each other before they are saved.
  createMany(items, auditLabel) {
    assertCanWrite(this.collection);
    // All or nothing: a bulk import that would pass the maximum is refused as a whole.
    guardEnrolment(this.collection, { creating: items });
    const now = new Date().toISOString();
    const records = items.map((data) => ({ ...data, id: data.id ?? uuid(), createdAt: now, updatedAt: now }));
    StorageManager.setMany(this.collection, records);
    logAudit(auditLabel ?? `imported ${records.length} ${this.entityLabel} records`, this.collection, 'import');
    return records;
  }

  update(id, patch, auditLabel) {
    assertCanWrite(this.collection);
    if (this.collection === 'students') {
      const before = StorageManager.get('students', id);
      if (before) guardEnrolment('students', { update: { before, patch } }); // re-activating counts as enrolling
    }
    const updated = StorageManager.update(this.collection, id, { ...patch, updatedAt: new Date().toISOString() });
    if (updated) logAudit(auditLabel ?? `updated ${this.entityLabel}`, this.collection, id);
    return updated;
  }

  remove(id, auditLabel) {
    assertCanWrite(this.collection);
    const ok = StorageManager.delete(this.collection, id);
    if (ok) logAudit(auditLabel ?? `removed ${this.entityLabel}`, this.collection, id);
    return ok;
  }
}
