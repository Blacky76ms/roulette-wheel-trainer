// Offline shell. CACHE is stamped by the build with a content hash, so every release gets a
// fresh cache and a client never mixes files from two versions.
const CACHE = 'wheel-trainer-2fe16f86f680';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const fromCache = () => caches.match(event.request, { ignoreSearch: true });
  // The page itself is self-contained, so taking the newest copy when online can never mix versions.
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => fromCache().then((cached) => cached ?? caches.match('./index.html'))));
    return;
  }
  event.respondWith(fromCache().then((cached) => cached ?? fetch(event.request)));
});
