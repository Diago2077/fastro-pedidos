// ============================================================
// FASTRO — Service Worker (PWA)
// Estrategia: network-first para archivos propios (online = siempre
// la última versión; offline = sirve lo cacheado). Las llamadas a
// Supabase y CDNs (cross-origin) van SIEMPRE a la red, nunca se cachean.
// ============================================================
const CACHE = 'fastro-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/auth.js',
  './js/supabase.js',
  './js/utils/helpers.js',
  './js/utils/export.js',
  './js/modules/dashboard.js',
  './js/modules/clients.js',
  './js/modules/products.js',
  './js/modules/orders.js',
  './js/modules/providers.js',
  './js/modules/users.js',
  './js/modules/reports.js',
  './js/modules/settings.js',
  './assets/logo.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()) // si algún archivo falla, igual instala
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo same-origin GET. Supabase / CDNs (cross-origin) van directo a la red.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Network-first: intenta la red (y actualiza la caché); si falla, usa la caché.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
