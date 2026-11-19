// The signed-in person's role, and the questions the rest of the app asks about it.
// With no role set (first-time setup, platform admin tools, unit tests) nothing is restricted.
import { collectionAccess, moduleAccess, moduleForPath, normalizeRole, ROLES, datasetAccess } from '../config/roles.js';

let currentRole = null;
// Per-person exceptions to the role table (e.g. welfare records granted to one named teacher).
// A hook returns 'write' | 'read' | 'none', or undefined to fall back to the role table.
let collectionOverride = () => undefined;
export const setCollectionOverride = (fn) => { collectionOverride = fn; };
const listeners = new Set();

export function setCurrentRole(role) {
  currentRole = role ? normalizeRole(role) : null;
  listeners.forEach((fn) => fn(currentRole));
}
export const getCurrentRole = () => currentRole;
export const onRoleChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const roleLabel = (role = currentRole) => (role ? ROLES[normalizeRole(role)].label : 'Administrator');
export const isAdmin = () => currentRole === null || currentRole === 'school_admin';

export function canAccessModule(moduleKey) {
  return currentRole === null || moduleAccess(currentRole, moduleKey) !== 'none';
}
export function canWriteModule(moduleKey) {
  return currentRole === null || moduleAccess(currentRole, moduleKey) === 'write';
}
export function canReadCollection(collection) {
  if (currentRole === null) return true;
  const o = collectionOverride(collection);
  return (o ?? collectionAccess(currentRole, collection)) !== 'none';
}
export function canWriteCollection(collection) {
  if (currentRole === null) return true;
  const o = collectionOverride(collection);
  return (o ?? collectionAccess(currentRole, collection)) === 'write';
}
export function canAccessPath(path) {
  return canAccessModule(moduleForPath(path));
}
export const datasetPermissions = (datasetKey) => (currentRole === null ? { import: true, export: true } : datasetAccess(currentRole, datasetKey));

export class PermissionError extends Error {
  constructor(collection) {
    super(`Your role (${roleLabel()}) can't change ${collection} records. Ask an administrator if you need access.`);
    this.name = 'PermissionError';
  }
}
export function assertCanWrite(collection) {
  if (!canWriteCollection(collection)) throw new PermissionError(collection);
}

// First page a role should land on.
export function homePathFor() {
  return '#/';
}

// Hides controls the person isn't allowed to use, for pages they can open read-only.
// The database is the real gatekeeper; this just keeps the screen honest and uncluttered.
//   - data-write-collection="examinations": hide when the role can't write that collection
//   - data-admin-only: hide for anyone but administrators
// In a read-only module, also hide the usual add / edit / delete / save controls.
const WRITE_WORDS = /^\s*(\+|add\b|new\b|create\b|edit\b|delete\b|remove\b|archive\b|save\b|import\b|record\b|upload\b|assign\b|admit\b|convert\b|approve\b|reject\b|mark\b|issue\b)/i;
export function applyAccessToContainer(root, moduleKey) {
  if (currentRole === null || !root) return () => {};
  const readOnly = !canWriteModule(moduleKey);
  const sweep = () => {
    root.querySelectorAll('[data-write-collection]').forEach((el) => {
      if (!canWriteCollection(el.getAttribute('data-write-collection'))) el.hidden = true;
    });
    root.querySelectorAll('[data-admin-only]').forEach((el) => { if (!isAdmin()) el.hidden = true; });
    if (readOnly) {
      root.querySelectorAll('button, a.btn, a.btn-primary, a.btn-secondary, [data-edit], [data-remove], [data-delete], input[type="file"]').forEach((el) => {
        if (el.hasAttribute('data-keep-visible')) return;
        // Screens that check permission per record type themselves (teacher tools) opt out of the
        // blanket "hide anything that looks like a write button" rule; the repository still refuses
        // any write the role is not allowed, and says why.
        if (el.closest('[data-own-permissions]')) return;
        const label = el.textContent ?? '';
        if (el.matches('[data-edit], [data-remove], [data-delete], input[type="file"]') || WRITE_WORDS.test(label)) el.hidden = true;
      });
    }
  };
  sweep();
  if (typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(() => sweep());
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
