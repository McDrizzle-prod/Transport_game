// Service worker: lets the game be installed as an app and opens offline (the game itself needs the server).
const CACHE = 'transportrijk-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;

  const store = (response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    }
    return response;
  };

  if (url.pathname.startsWith('/assets/')) {
    // Hashed build files never change: cache first.
    event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request).then(store)));
    return;
  }
  // Everything else: network first so updates arrive immediately, cache as offline fallback.
  event.respondWith(
    fetch(event.request)
      .then(store)
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/'))),
  );
});
