const CACHE = 'alexander-dashboard-shell-v3';
const SHELL = ['/', '/index.html', '/calendar-view.js', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('alexander-dashboard-shell-') && key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Calendar failure must reach the UI. Never replay API responses as fresh live data,
  // cache OAuth callbacks, or answer API requests with the HTML app shell.
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (!SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    if (event.request.mode === 'navigate') return caches.match('/index.html');
    return Response.error();
  }));
});
