// Hand-rolled service worker: no Workbox, no build plugin, one versioned cache.
const CACHE = 'sizzle-v3';
const SHELL = [
  '/',
  '/eat',
  '/staff.html',
  '/manifest.webmanifest',
  '/manifest-staff.webmanifest',
  '/icons/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/kitchen-icon.svg',
  '/icons/waiter-icon.svg',
  '/icons/cashier-icon.svg',
  '/icons/owner-icon.svg',
];

// The shell is precached so an installed app (or a scanned table QR) opens with no signal.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

// The cache name is the version, so anything older is dead weight once we activate.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

const STATIC = /\.(?:png|svg|webp|jpe?g|gif|ico|woff2?|css|js|webmanifest)$/;

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only GETs are ever touched: caching a POST would replay an order on next launch.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Live data, uploads and the socket stay on the network — they change per second.
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/uploads') ||
    url.pathname.startsWith('/socket.io')
  ) {
    return;
  }
  // Navigations are network-first so guests always see today's menu, prices and offers.
  // Offline, the exact page wins over the shell: the staff installs must not fall back
  // to the guest app's document, which carries a different manifest.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(request).then((hit) => hit || caches.match('/'))),
    );
    return;
  }
  // Icons, fonts and hashed assets are cache-first: Vite fingerprints them per build.
  if (!STATIC.test(url.pathname)) return;
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (!response.ok) return response;
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        }),
    ),
  );
});
