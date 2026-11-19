// A tiny async key-value store with named "tables", backed by IndexedDB in the browser (survives
// refreshes, restarts and offline use) or by memory where IndexedDB does not exist (tests, very old
// browsers). Both adapters have the same shape so everything above them is identical.
const DB_NAME = 'swiftiq-offline';
const STORES = ['outbox', 'drafts', 'snapshots', 'meta'];

export function createMemoryAdapter() {
  const data = Object.fromEntries(STORES.map((s) => [s, new Map()]));
  return {
    kind: 'memory',
    async get(store, key) { const v = data[store].get(key); return v === undefined ? undefined : structuredClone(v); },
    async put(store, key, value) { data[store].set(key, structuredClone(value)); },
    async delete(store, key) { data[store].delete(key); },
    async all(store) { return [...data[store].values()].map((v) => structuredClone(v)); },
  };
}

export function createIndexedDbAdapter(idb = globalThis.indexedDB) {
  let dbPromise;
  const open = () => (dbPromise ??= new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, 1);
    req.onupgradeneeded = () => STORES.forEach((s) => { if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = async (store, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const result = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Local storage transaction aborted'));
    });
  };
  return {
    kind: 'indexeddb',
    get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
    put: (store, key, value) => run(store, 'readwrite', (s) => s.put(value, key)),
    delete: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
    all: (store) => run(store, 'readonly', (s) => s.getAll()),
  };
}

export function pickAdapter() {
  try { if (globalThis.indexedDB) return createIndexedDbAdapter(); } catch { /* fall through */ }
  return createMemoryAdapter();
}
