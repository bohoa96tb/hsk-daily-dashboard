// Service worker — network-first with cache fallback.
// Fresh content wins whenever the network works; the cached shell and data
// keep the app usable offline. Bump CACHE when the shell changes.
const CACHE = 'hsk-daily-v1.2';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return; // data JSON is cached by the app itself; the SW must not mask its freshness
  e.respondWith((async () => {
    try {
      const fresh = await fetch(e.request);
      if (!fresh.ok) return fresh;
      const copy = fresh.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return fresh;
    } catch {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      throw new Error('offline and not cached');
    }
  })());
});
