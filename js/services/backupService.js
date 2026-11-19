import { StorageManager } from '../storage/StorageManager.js';
import { logAudit } from './auditService.js';

export function exportBackup(schoolName) {
  const json = StorageManager.exportAll();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const datePart = new Date().toISOString().slice(0, 10);
  const safeName = (schoolName || 'school').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  a.href = url;
  a.download = `swiftiq-eduflow-backup-${safeName}-${datePart}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  logAudit('exported a data backup');
}

export function importBackup(json) {
  const result = StorageManager.importAll(json);
  if (result.ok) logAudit('imported a data backup');
  return result;
}

export function resetAllData() {
  StorageManager.clearAll();
}
