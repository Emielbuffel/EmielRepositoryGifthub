// Service worker of the installable web/phone app (generated at build time from scripts/sw-template.js).
// - the app itself (HTML, scripts, styles, icons) is cached, so it opens instantly and offline
// - the built-in data files are cached as they are used and refreshed in the background
// - each new build has a new BUILD id: the new worker installs, takes over and the page reloads once (auto-update)
// - data requests to other sites and the /relay are never cached here
const BUILD = '__BUILD__';
const APP = "__APP_FILES__";
const CACHE = 'pd-app-' + BUILD, DATA = 'pd-data';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', ...APP])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pd-app-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin || u.pathname.endsWith('/relay') || u.pathname.endsWith('version.json')) return;
  if (u.pathname.includes('/data/')) { // stale-while-revalidate
    e.respondWith(caches.open(DATA).then(async c => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (e.request.mode === 'navigate') { // the page: network first so a new version shows up, cache when offline
    e.respondWith(fetch(e.request).catch(() => caches.match('./')));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
self.addEventListener('message', e => { if (e.data === 'build') e.source.postMessage({ build: BUILD }); });
