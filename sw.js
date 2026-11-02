// Network first, cache as fallback: always fresh online, still usable offline (e.g. on the MRT).
const CACHE = 'english-daily-b30c6574d8';
const SHELL = ['./', 'index.html', 'style.css?v=b30c6574d8', 'app.js?v=b30c6574d8', 'core.js?v=b30c6574d8',
  'speech.js?v=b30c6574d8', 'sync.js?v=b30c6574d8', 'data/index.json', 'data/vocab.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(fetch(req)
    .then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    })
    .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))));
});
