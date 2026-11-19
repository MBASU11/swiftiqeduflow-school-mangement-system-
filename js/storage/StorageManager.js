// StorageManager is the ONLY module in the app that touches window.localStorage.
// Everything else (repositories, services, pages) goes through this.
// This is what makes it possible to later swap local storage for a real API
// without rewriting any page: repositories depend on this module's functions,
// not on localStorage directly.

const ROOT = 'swiftIQEduFlow';
const ACCOUNTS_ROOT = 'swiftIQAccounts';
export const STORAGE_SCHEMA_VERSION = 1;

// Every school (tenant) gets its own key prefix, so several schools can be
// registered in one browser without seeing each other's data. Until a school
// is signed in, school data can't be read or written at all.
let namespace = null;

function isQuotaError(err) {
  return err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

export class StorageError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = 'StorageError';
  }
}

function key(collection) {
  if (!namespace) throw new StorageError('Sign in to a school before using its data.', 'unavailable');
  return `${namespace}:${collection}`;
}

function readEnvelope(collection) {
  const raw = window.localStorage.getItem(key(collection));
  if (!raw) return { schemaVersion: STORAGE_SCHEMA_VERSION, records: {} };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.records) throw new Error('malformed envelope');
    // Future migrations would branch on parsed.schemaVersion here.
    return parsed;
  } catch {
    // Corrupt data should never crash the app. Quarantine it and start clean
    // so one bad write doesn't take down the whole collection.
    window.localStorage.setItem(`${key(collection)}:corrupt-backup:${Date.now()}`, raw);
    return { schemaVersion: STORAGE_SCHEMA_VERSION, records: {} };
  }
}

function writeEnvelope(collection, envelope) {
  try {
    window.localStorage.setItem(key(collection), JSON.stringify(envelope));
  } catch (err) {
    if (isQuotaError(err)) {
      throw new StorageError('Local storage is full. Export a backup and clear old data to keep saving.', 'quota');
    }
    throw new StorageError('Could not save data to this browser.', 'unknown');
  }
}

const LEGACY_TENANT_KEY = /^swiftIQEduFlow:t_/;

export const StorageManager = {
  // ---- which school is signed in ----
  setTenant(tenantId) {
    namespace = tenantId ? `${ROOT}:t_${tenantId}` : null;
  },

  hasTenant() {
    return namespace !== null;
  },

  // Counting only: the platform console needs a school's student population to show
  // capacity, without ever being handed the records themselves.
  peekTenantRecords(tenantId, collection) {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(`${ROOT}:t_${tenantId}:${collection}`));
      return Object.values(parsed?.records ?? {}).map((r) => ({ id: r.id, admissionNumber: r.admissionNumber, status: r.status }));
    } catch {
      return [];
    }
  },

  // ---- data shared across schools (accounts, session) ----
  getGlobal(name) {
    const raw = window.localStorage.getItem(`${ACCOUNTS_ROOT}:${name}`);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  },

  setGlobal(name, value) {
    try {
      window.localStorage.setItem(`${ACCOUNTS_ROOT}:${name}`, JSON.stringify(value));
    } catch (err) {
      if (isQuotaError(err)) throw new StorageError('Local storage is full. Export a backup and clear old data to keep saving.', 'quota');
      throw new StorageError('Could not save data to this browser.', 'unknown');
    }
  },

  removeGlobal(name) {
    window.localStorage.removeItem(`${ACCOUNTS_ROOT}:${name}`);
  },

  // ---- data saved by earlier versions, before schools had accounts ----
  hasLegacyData() {
    return window.localStorage.getItem(`${ROOT}:school`) !== null;
  },

  peekLegacySchoolName() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(`${ROOT}:school`));
      return parsed?.records?.['the-school']?.name;
    } catch {
      return undefined;
    }
  },

  // Moves earlier un-namespaced data under a school's own prefix.
  adoptLegacyData(tenantId) {
    const moves = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(`${ROOT}:`) && !LEGACY_TENANT_KEY.test(k)) moves.push(k);
    }
    moves.forEach((k) => {
      const value = window.localStorage.getItem(k);
      window.localStorage.setItem(`${ROOT}:t_${tenantId}:${k.slice(ROOT.length + 1)}`, value);
      window.localStorage.removeItem(k);
    });
  },

  // ---- school data ----
  get(collection, id) {
    return readEnvelope(collection).records[id];
  },

  set(collection, id, value) {
    const envelope = readEnvelope(collection);
    envelope.records[id] = value;
    writeEnvelope(collection, envelope);
    return value;
  },

  // Writes many records with a single read/write of the collection (bulk imports).
  setMany(collection, records) {
    const envelope = readEnvelope(collection);
    records.forEach((record) => { envelope.records[record.id] = record; });
    writeEnvelope(collection, envelope);
    return records;
  },

  update(collection, id, patch) {
    const envelope = readEnvelope(collection);
    const existing = envelope.records[id];
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    envelope.records[id] = updated;
    writeEnvelope(collection, envelope);
    return updated;
  },

  delete(collection, id) {
    const envelope = readEnvelope(collection);
    if (!(id in envelope.records)) return false;
    delete envelope.records[id];
    writeEnvelope(collection, envelope);
    return true;
  },

  find(collection, id) {
    return this.get(collection, id);
  },

  filter(collection, predicate) {
    return Object.values(readEnvelope(collection).records).filter(predicate);
  },

  all(collection) {
    return Object.values(readEnvelope(collection).records);
  },

  clear(collection) {
    writeEnvelope(collection, { schemaVersion: STORAGE_SCHEMA_VERSION, records: {} });
  },

  clearAll() {
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(`${namespace}:`)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  },

  // Exports every SwiftIQ EduFlow collection as one JSON backup file.
  exportAll() {
    const dump = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(`${namespace}:`) && !k.includes(':corrupt-backup:')) {
        const collection = k.slice(namespace.length + 1);
        dump[collection] = readEnvelope(collection);
      }
    }
    return JSON.stringify({ exportedAt: new Date().toISOString(), schemaVersion: STORAGE_SCHEMA_VERSION, data: dump }, null, 2);
  },

  // Restores a backup produced by exportAll. Validates shape before writing anything.
  importAll(json) {
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { ok: false, error: 'This file is not valid JSON.' };
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.data) {
      return { ok: false, error: 'This file is not a SwiftIQ EduFlow backup.' };
    }
    for (const [collection, envelope] of Object.entries(parsed.data)) {
      if (!envelope || typeof envelope !== 'object' || !('records' in envelope)) {
        return { ok: false, error: `The "${collection}" section of this backup looks corrupted.` };
      }
    }
    for (const [collection, envelope] of Object.entries(parsed.data)) {
      writeEnvelope(collection, envelope);
    }
    return { ok: true };
  },
};
