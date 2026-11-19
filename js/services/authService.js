// PROTOTYPE AUTHENTICATION — accounts live in this browser only. Passwords are
// salted and hashed, but anyone with access to the browser profile can still
// read or clear the data. This is a stand-in for real server-side
// authentication, which must replace it before real use.

import { StorageManager } from '../storage/StorageManager.js';
import { uuid } from '../lib/uuid.js';
import { hashPassword, normalizeEmail, MIN_PASSWORD_LENGTH } from '../lib/passwords.js';
import { newSession, sessionState, touched } from '../lib/sessionPolicy.js';
import { getPlan } from '../config/plans.js';
import { setAuditUser } from './auditService.js';
import { setCurrentRole } from './accessService.js';
import { ASSIGNABLE_ROLES, normalizeRole } from '../config/roles.js';

const ACCOUNTS = 'accounts';
const SESSION = 'session';
export const ADMIN_SESSION = 'adminSession';
export { MIN_PASSWORD_LENGTH };

function accounts() {
  return StorageManager.getGlobal(ACCOUNTS) ?? [];
}

// A school registers as "pending" and can't use the system until the platform
// administrator approves it. Accounts made before approvals existed have no
// status and are treated as approved so nobody is locked out of their data.
export function accountStatus(account) {
  if (account?.isStaff) {
    // Staff can only work while their school is approved.
    const owner = accounts().find((a) => !a.isStaff && a.tenantId === account.tenantId);
    return accountStatus(owner);
  }
  return account?.status ?? 'approved';
}

// Business-side access to the account list (used by the platform admin
// service). These hold registration details only — never a school's data.
export function listAccounts() {
  return accounts().filter((a) => !a.isStaff);
}

export function updateAccount(id, patch) {
  StorageManager.setGlobal(ACCOUNTS, accounts().map((a) => (a.id === id ? { ...a, ...patch } : a)));
}

export function clearSchoolSession() {
  StorageManager.removeGlobal(SESSION);
  StorageManager.setTenant(null);
  setAuditUser(undefined);
  setCurrentRole(null);
}

// Signing in as a school ends any administrator session, and a school's data
// space is only opened once the school has been approved.
function activate(account, { restoring = false } = {}) {
  StorageManager.removeGlobal(ADMIN_SESSION);
  // Restoring after a page reload must NOT restart the clock, or sessions would never expire.
  if (!restoring) StorageManager.setGlobal(SESSION, newSession({ accountId: account.id }));
  StorageManager.setTenant(accountStatus(account) === 'approved' ? account.tenantId : null);
  setAuditUser(account.name);
  setCurrentRole(account.role ?? 'admin');
}

// True when an earlier version left school data in this browser and no
// account has claimed it yet — sign-up offers to attach it.
export function legacyDataAvailable() {
  return accounts().length === 0 && StorageManager.hasLegacyData();
}

export function legacySchoolName() {
  return StorageManager.peekLegacySchoolName();
}

export function validateSignup(d) {
  const errors = [];
  if (!d.name?.trim()) errors.push({ field: 'name', message: 'Enter your full name.' });
  if (!d.schoolName?.trim()) errors.push({ field: 'schoolName', message: 'Enter your school\'s name.' });
  const email = normalizeEmail(d.email);
  if (!email) {
    errors.push({ field: 'email', message: 'Enter your email address.' });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push({ field: 'email', message: 'That email address doesn\'t look right.' });
  } else if (accounts().some((a) => a.email === email)) {
    errors.push({ field: 'email', message: 'An account with this email already exists. Try logging in instead.' });
  }
  if (!d.password || d.password.length < MIN_PASSWORD_LENGTH) {
    errors.push({ field: 'password', message: `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.` });
  }
  if (d.password !== d.confirmPassword) errors.push({ field: 'confirmPassword', message: 'The two passwords don\'t match.' });
  if (String(d.studentCount ?? '').trim() !== '') {
    const n = Number(d.studentCount);
    if (!Number.isInteger(n) || n < 1) errors.push({ field: 'studentCount', message: 'Enter a whole number of students, or leave it blank.' });
  }
  if (!getPlan(d.planId)) errors.push({ field: 'planId', message: 'Choose a plan for your school.' });
  if (!d.acceptedTerms) errors.push({ field: 'acceptedTerms', message: 'Please confirm that you accept the Terms, the Privacy Notice and the Data Processing Terms.' });
  return errors;
}

// Creates the account and the school's own storage space, then signs in.
export function register(d) {
  const plan = getPlan(d.planId);
  const account = {
    id: uuid(),
    tenantId: uuid(),
    name: d.name.trim(),
    email: normalizeEmail(d.email),
    phone: d.phone?.trim() || undefined,
    schoolName: d.schoolName.trim(),
    plan: { planId: plan.id, name: plan.name, billing: ['monthly', 'termly', 'annual'].includes(d.billing) ? d.billing : 'annual' },
    studentCount: String(d.studentCount ?? '').trim() === '' ? undefined : Number(d.studentCount),
    role: 'admin',
    status: 'pending',
    history: [{ at: new Date().toISOString(), action: 'Registered', by: 'School' }],
    salt: uuid(),
    passwordHash: '',
    createdAt: new Date().toISOString(),
    terms: d.legalVersion ? { version: String(d.legalVersion), acceptedAt: new Date().toISOString() } : undefined, // evidence of what was accepted, and when
  };
  account.passwordHash = hashPassword(d.password, account.salt);
  StorageManager.setGlobal(ACCOUNTS, [...accounts(), account]);
  if (d.adoptLegacy && StorageManager.hasLegacyData()) StorageManager.adoptLegacyData(account.tenantId);
  activate(account);
  return account;
}

export function login(email, password) {
  const id = String(email ?? '').trim().toLowerCase(); // an email, or a learner's / parent's username
  const account = accounts().find((a) => a.email === normalizeEmail(email) || (a.username && a.username === id));
  if (!account || account.passwordHash !== hashPassword(password || '', account.salt)) {
    return { ok: false, error: 'That email or password is incorrect.' };
  }
  activate(account);
  return { ok: true, account };
}

// Brings back the signed-in school after a page reload.
export const hasSchoolSession = () => Boolean(StorageManager.getGlobal(SESSION));

export function touchSession() {
  const session = StorageManager.getGlobal(SESSION);
  if (session) StorageManager.setGlobal(SESSION, touched(session));
}

export function restoreSession() {
  const session = StorageManager.getGlobal(SESSION);
  if (session && sessionState(session, 'school') === 'expired') { clearSchoolSession(); return undefined; }
  const account = session && accounts().find((a) => a.id === session.accountId);
  if (!account) {
    StorageManager.setTenant(null);
    return null;
  }
  activate(account, { restoring: true });
  return account;
}

export function currentAccount() {
  const session = StorageManager.getGlobal(SESSION);
  return session ? accounts().find((a) => a.id === session.accountId) : undefined;
}

export function logout() {
  clearSchoolSession();
}

// ---- School staff accounts (prototype) ------------------------------------------
// The school's owner can add colleagues, each with a role that decides what they
// can see and do. They share the school's data space but sign in separately.

const isOwnerAccount = (account) => account && !account.isStaff;

export function listTeam() {
  const me = currentAccount();
  if (!me) return [];
  return accounts()
    .filter((a) => a.tenantId === me.tenantId && a.role !== 'parent' && a.role !== 'student') // parent/learner logins are managed under Family logins
    .map((a) => ({ id: a.id, name: a.name, email: a.email, role: normalizeRole(a.role ?? 'admin'), isOwner: isOwnerAccount(a), createdAt: a.createdAt }))
    .sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name));
}

function requireAdmin() {
  const me = currentAccount();
  if (!me || normalizeRole(me.role ?? 'admin') !== 'school_admin') throw new Error('Only an administrator can manage the team.');
  return me;
}

export function validateStaff(d) {
  const errors = [];
  if (!d.name?.trim()) errors.push({ field: 'name', message: 'Enter the person’s full name.' });
  const email = normalizeEmail(d.email);
  if (!email) errors.push({ field: 'email', message: 'Enter their email address.' });
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ field: 'email', message: 'That email address doesn’t look right.' });
  else if (accounts().some((a) => a.email === email)) errors.push({ field: 'email', message: 'Someone already has an account with this email.' });
  if (!ASSIGNABLE_ROLES.includes(d.role)) errors.push({ field: 'role', message: 'Choose a role.' });
  if (!d.password || d.password.length < MIN_PASSWORD_LENGTH) errors.push({ field: 'password', message: `Use at least ${MIN_PASSWORD_LENGTH} characters for the password.` });
  return errors;
}

export function createStaffAccount(d) {
  const owner = requireAdmin();
  const errors = validateStaff(d);
  if (errors.length) return { ok: false, errors };
  const salt = uuid();
  const account = {
    id: uuid(),
    tenantId: owner.tenantId,
    name: d.name.trim(),
    email: normalizeEmail(d.email),
    schoolName: owner.schoolName,
    plan: owner.plan,
    role: d.role,
    isStaff: true,
    status: 'approved',
    salt,
    passwordHash: hashPassword(d.password, salt),
    createdAt: new Date().toISOString(),
    createdBy: owner.name,
  };
  StorageManager.setGlobal(ACCOUNTS, [...accounts(), account]);
  return { ok: true, account };
}

export function setStaffRole(id, role) {
  const me = requireAdmin();
  const target = accounts().find((a) => a.id === id && a.tenantId === me.tenantId);
  if (!target) return { ok: false, error: 'That person was not found.' };
  if (!ASSIGNABLE_ROLES.includes(role)) return { ok: false, error: 'Choose a valid role.' };
  if (isOwnerAccount(target)) return { ok: false, error: 'The school owner is always an administrator.' };
  if (target.role === 'parent' || target.role === 'student') return { ok: false, error: 'Parent and learner logins cannot be given staff roles.' };
  updateAccount(id, { role });
  return { ok: true };
}

export function resetStaffPassword(id, password) {
  const me = requireAdmin();
  const target = accounts().find((a) => a.id === id && a.tenantId === me.tenantId);
  if (!target) return { ok: false, error: 'That person was not found.' };
  if (!password || password.length < MIN_PASSWORD_LENGTH) return { ok: false, error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  const salt = uuid();
  updateAccount(id, { salt, passwordHash: hashPassword(password, salt) });
  return { ok: true };
}

export function removeStaffAccount(id) {
  const me = requireAdmin();
  const target = accounts().find((a) => a.id === id && a.tenantId === me.tenantId);
  if (!target) return { ok: false, error: 'That person was not found.' };
  if (isOwnerAccount(target)) return { ok: false, error: 'The school owner cannot be removed.' };
  StorageManager.setGlobal(ACCOUNTS, accounts().filter((a) => a.id !== id));
  return { ok: true };
}

// ---- Parent and learner logins (demo mode) ----------------------------------------------------
// An administrator gives a parent or learner a username (a learner's is usually their admission number) and a password.
// The account is tied to ONE parent or student record and can only open the portal, never the school's screens.
export function listFamilyAccounts() {
  const me = currentAccount();
  if (!me) return [];
  return accounts().filter((a) => a.tenantId === me.tenantId && (a.role === 'parent' || a.role === 'student'))
    .map((a) => ({ id: a.id, name: a.name, role: a.role, linkedId: a.linkedId, username: a.username, createdAt: a.createdAt }));
}

export function createFamilyAccount({ role, linkedId, name, username, password }) {
  const owner = requireAdmin();
  const errors = [];
  const user = String(username ?? '').trim().toLowerCase();
  if (!['parent', 'student'].includes(role)) errors.push('Choose parent or learner.');
  if (!linkedId) errors.push('Choose who this login is for.');
  if (user.length < 2 || /\s/.test(user)) errors.push('The username needs at least 2 characters and no spaces.');
  else if (accounts().some((a) => a.username === user || a.email === user)) errors.push('That username is already taken.');
  if (!password || password.length < MIN_PASSWORD_LENGTH) errors.push(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
  if (accounts().some((a) => a.tenantId === owner.tenantId && a.role === role && a.linkedId === linkedId)) errors.push('This person already has a login. Reset its password instead.');
  if (errors.length) return { ok: false, errors };
  const salt = uuid();
  const account = { id: uuid(), tenantId: owner.tenantId, name: String(name ?? '').trim() || user, email: `${user}@portal.invalid`, username: user, schoolName: owner.schoolName, plan: owner.plan,
    role, linkedId, isStaff: true, status: 'approved', salt, passwordHash: hashPassword(password, salt), createdAt: new Date().toISOString(), createdBy: owner.name };
  StorageManager.setGlobal(ACCOUNTS, [...accounts(), account]);
  return { ok: true, account };
}
