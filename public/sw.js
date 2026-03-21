const CACHE_VERSION = 'v53';
const STATIC_CACHE = `infusion100-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `infusion100-dynamic-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  '/css/style.css',
  '/js/app.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.json',
];

// Install — precache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Push notifications
self.addEventListener('push', (event) => {
  const data = event.data?.json() || { title: 'Infusion100', body: '' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/dashboard' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/dashboard';
  event.waitUntil(clients.openWindow(url));
});

// Fetch — cache-first for static, network-first for everything else
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  // Cache-first for static assets — CACHE_VERSION bump on deploy triggers re-precache
  if (
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'font' ||
    url.pathname.startsWith('/icons/')
  ) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request).then((response) => {
          return caches.open(STATIC_CACHE).then((cache) => {
            cache.put(request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // Network-first for HTML and API
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (request.method === 'GET') {
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
