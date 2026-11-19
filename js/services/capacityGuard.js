// The single choke point for "does this operation increase active enrolment?".
// Kept free of app imports so the storage layer can use it without import cycles; the
// subscription service plugs in where the school's limits come from.
import { countActiveStudents, isCounted, CapacityError } from './capacityService.js';
import { StorageManager } from '../storage/StorageManager.js';

let limitsProvider = () => null; // null / {unlimited:true} = no limit (legacy schools, setup, tests)
export const setLimitsProvider = (fn) => { limitsProvider = fn; };

const key = (s) => String(s.admissionNumber ?? '').trim().toLowerCase() || `id:${s.id}`;

// How many NEW active students would this change add? The same person (same admission number)
// never counts twice, and records that stay inactive add nobody.
export function addedActive({ existing, creating = [], update = null }) {
  const counted = new Set(existing.filter((s) => isCounted(s)).map(key));
  if (update) {
    const wasCounted = isCounted(update.before);
    const nowCounted = isCounted({ ...update.before, ...update.patch });
    if (wasCounted || !nowCounted) return 0;
    const k = key({ ...update.before, ...update.patch });
    const others = new Set(existing.filter((s) => s.id !== update.before.id && isCounted(s)).map(key));
    return others.has(k) ? 0 : 1;
  }
  let added = 0;
  creating.forEach((s) => {
    if (!isCounted(s)) return;
    const k = key(s);
    if (!counted.has(k)) { counted.add(k); added += 1; }
  });
  return added;
}

// Throws CapacityError (nothing is saved) when the change would pass the school's maximum.
export function guardEnrolment(collection, change) {
  if (collection !== 'students') return;
  const limits = limitsProvider();
  if (!limits || limits.unlimited) return;
  const existing = StorageManager.all('students');
  const adding = addedActive({ existing, ...change });
  if (adding === 0) return;
  if (countActiveStudents(existing) + adding > limits.max) throw new CapacityError(limits.max);
}
