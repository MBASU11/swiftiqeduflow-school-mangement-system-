// Strict student-population control: who counts, what the limits are, and the exact
// wording shown when a school is at, near or over its limit. Pure functions — the same
// rules run in the browser and (mirrored) in the database trigger.
import { getCatalogue } from './packageService.js';

export const CAPACITY_LEVELS = {
  ok: 'Within limit',
  warning: 'Approaching limit',
  over_limit: 'Over paid limit',
  full: 'Maximum reached',
};

export const maxReachedMessage = (max) =>
  `Your school has reached its maximum permitted population of ${max} students. Please upgrade your subscription or contact SwiftIQ EduFlow support to request additional capacity.`;

const admKey = (s) => String(s.admissionNumber ?? '').trim().toLowerCase();

// Same student never counts twice: students are identified by admission number when they
// have one (so an imported duplicate of an existing record is one student), otherwise by id.
export function isCounted(student, cat = getCatalogue()) {
  const excluded = cat.capacity?.excludeStatuses ?? ['archived', 'graduated', 'withdrawn', 'transferred'];
  return !excluded.includes(student.status ?? 'active');
}

export function countActiveStudents(students, cat = getCatalogue()) {
  const keys = new Set();
  students.forEach((s) => { if (isCounted(s, cat)) keys.add(admKey(s) || `id:${s.id}`); });
  return keys.size;
}

export function capacityStatus(active, limits, cat = getCatalogue()) {
  const warnPercent = cat.capacity?.warnPercent ?? 90;
  if (!limits || limits.unlimited) {
    return { active, unlimited: true, level: 'ok', paidLimit: null, overflow: 0, max: null, remainingPaid: null, overPaid: 0, remainingOverflow: null, warnAt: null, message: '' };
  }
  const { paidLimit, overflow, max } = limits;
  const warnAt = Math.floor((paidLimit * warnPercent) / 100);
  const overPaid = Math.max(0, active - paidLimit);
  const level = active >= max ? 'full' : active > paidLimit ? 'over_limit' : active > warnAt ? 'warning' : 'ok';
  const remainingPaid = Math.max(0, paidLimit - active);
  const remainingOverflow = Math.max(0, max - Math.max(active, paidLimit));
  let message = '';
  if (level === 'full') message = maxReachedMessage(max);
  else if (level === 'over_limit') message = `Your school is ${overPaid} student${overPaid === 1 ? '' : 's'} over its paid limit of ${paidLimit}. You can add ${max - active} more before the maximum of ${max} is reached — please upgrade your subscription.`;
  else if (level === 'warning') message = `Your school is approaching its paid limit: ${active} of ${paidLimit} students (${remainingPaid} remaining). Consider upgrading before you run out of room.`;
  return { active, unlimited: false, level, paidLimit, overflow, max, remainingPaid, overPaid, remainingOverflow, warnAt, message };
}

// Can `adding` more active students be enrolled? Never partly: callers decide what to do with `room`.
export function checkEnrolment(active, adding, limits, cat = getCatalogue()) {
  if (!limits || limits.unlimited) return { allowed: true, room: Infinity, after: capacityStatus(active + adding, limits, cat), message: '' };
  const room = Math.max(0, limits.max - active);
  const allowed = active + adding <= limits.max;
  return { allowed, room, after: capacityStatus(Math.min(active + adding, limits.max), limits, cat), message: allowed ? '' : maxReachedMessage(limits.max) };
}

export class CapacityError extends Error {
  constructor(max) {
    super(maxReachedMessage(max));
    this.name = 'CapacityError';
    this.code = 'capacity';
  }
}
