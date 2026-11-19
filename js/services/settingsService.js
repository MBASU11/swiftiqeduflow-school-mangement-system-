import { StorageManager } from '../storage/StorageManager.js';
import { logAudit } from './auditService.js';

const COLLECTION = 'settings';
const SINGLETON_ID = 'the-settings';

export const defaultModuleToggles = {
  admissions: true,
  academics: true,
  attendance: true,
  timetable: true,
  exams: true,
  finance: true,
  communication: true,
  transport: false,
  library: false,
  inventory: false,
  discipline: true,
  health: false,
  hostels: false,
  documents: true,
};

export function getSettings() {
  const existing = StorageManager.get(COLLECTION, SINGLETON_ID);
  if (existing) return existing;
  const now = new Date().toISOString();
  const created = { id: SINGLETON_ID, createdAt: now, updatedAt: now, moduleToggles: { ...defaultModuleToggles } };
  StorageManager.set(COLLECTION, SINGLETON_ID, created);
  return created;
}

export function updateModuleToggles(patch) {
  const current = getSettings();
  const updated = { ...current, moduleToggles: { ...current.moduleToggles, ...patch }, updatedAt: new Date().toISOString() };
  StorageManager.set(COLLECTION, SINGLETON_ID, updated);
  logAudit('changed module settings');
  return updated;
}
