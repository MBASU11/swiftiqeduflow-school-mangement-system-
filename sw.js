// Offline app shell for SwiftIQ EduFlow. It caches the app's own files (listed in precache.json) so the
// app opens with no connection. It NEVER handles requests to other sites (the cloud database, fonts), never caches
// non-GET requests, and never stores school data — school data lives in the app's own storage.
const PREFIX = 'eduflow-shell-';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const res = await fetch('./precache.json', { cache: 'no-store' });
    const { version, files } = await res.json();
    const cache = await caches.open(PREFIX + version);
    await cache.addAll(files.map((f) => new Request(f, { cache: 'reload' })));
    self.__version = version;
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const res = await fetch('./precache.json', { cache: 'no-store' }).catch(() => null);
    const current = res ? PREFIX + (await res.json()).version : null;
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== current) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // leave everything else alone
  if (url.pathname.endsWith('/precache.json') || url.pathname.endsWith('/sw.js')) return; // always fresh
  event.respondWith((async () => {
    const keys = (await caches.keys()).filter((k) => k.startsWith(PREFIX));
    const cache = keys.length ? await caches.open(keys.sort().at(-1)) : null;
    if (req.mode === 'navigate') {
      try { return await fetch(req); } catch { return (await cache?.match('./index.html')) ?? (await cache?.match('./')) ?? Response.error(); }
    }
    const hit = await cache?.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); } catch { return Response.error(); }
  })());
});
