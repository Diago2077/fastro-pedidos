// ============================================================
// FASTRO — Service Worker (PWA)
// Estrategia: network-first para archivos propios (online = siempre
// la última versión; offline = sirve lo cacheado). Las llamadas a
// Supabase y CDNs (cross-origin) van SIEMPRE a la red, nunca se cachean.
// ============================================================
// El nombre de la caché incluye la versión: al cambiarla, el evento
// 'activate' borra la caché vieja. Mantenelo igual a APP_VERSION (js/version.js).
const CACHE = 'fastro-v1.5.0';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/version.js',
  './js/auth.js',
  './js/supabase.js',
  './js/utils/helpers.js',
  './js/utils/export.js',
  './js/utils/sizes.js',
  './js/utils/filters.js',
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
  // No llamamos skipWaiting() acá: el SW nuevo queda "en espera" y la app
  // avisa al usuario para actualizar (evita recargar en medio de un pedido).
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
});

// La app pide activar el SW en espera cuando el usuario toca "Actualizar".
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
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
