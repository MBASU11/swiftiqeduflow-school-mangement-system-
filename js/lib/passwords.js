// Prototype password handling shared by school accounts and the platform
// administrator: salted, repeatedly hashed, never stored in plain text.
import { sha256 } from './sha256.js';

export const MIN_PASSWORD_LENGTH = 8;

export function hashPassword(password, salt) {
  let h = `${salt}:${password}`;
  for (let i = 0; i < 1000; i++) h = sha256(`${h}:${salt}`);
  return h;
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}
