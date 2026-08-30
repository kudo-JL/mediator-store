// public/sw.js
// Service worker — offline support + install prompt.
// Strategy:
//  - HTML pages: network-first, fall back to cached "/" when offline.
//  - Static assets (CSS/JS/images/fonts): cache-first.
//  - API endpoints & POSTs: never cached.

const CACHE_VERSION = 'mediator-v1';
const CORE_ASSETS = [
  '/',
  '/static/css/store.css',
  '/static/css/admin.css',
  '/static/js/store.js',
  '/static/js/cart.js',
  '/static/js/admin.js',
  '/static/images/favicon.svg',
  '/static/images/icon-192.png',
  '/static/images/icon-512.png',
  '/static/manifest.json',
  '/offline',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GETs.
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  // Don't try to cache admin POST/PUT etc. (already filtered by method).

  // Skip API & image-proxy (live data).
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/img-proxy') return;
  if (url.pathname.startsWith('/admin/login')) return;
  if (url.pathname.startsWith('/admin/logout')) return;

  // For navigations (HTML pages): network-first, fall back to cached "/".
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          // Cache a copy of successful pages.
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return resp;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // For static assets: cache-first.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((resp) => {
          if (resp && resp.ok && (url.pathname.startsWith('/static/') || url.pathname.startsWith('/uploads/'))) {
            const copy = resp.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return resp;
        })
        .catch(() => cached);
    })
  );
});

// Allow the page to trigger immediate activation.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
