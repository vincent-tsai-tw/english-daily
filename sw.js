// Network first, cache as fallback: always fresh online, still usable offline (e.g. on the MRT).
// Requests revalidate with the server (cache: 'no-cache'), so GitHub Pages' 10-minute HTTP cache
// never serves an outdated page after a new version is published.
const CACHE = 'english-daily-61e1476431';
// The build replaces ["./", "index.html", "style.css?v=61e1476431", "app.js?v=61e1476431", "core.js?v=61e1476431", "dom.js?v=61e1476431", "gist.js?v=61e1476431", "library.js?v=61e1476431", "nav.js?v=61e1476431", "pages/dashboard.js?v=61e1476431", "pages/history.js?v=61e1476431", "pages/home.js?v=61e1476431", "pages/lesson.js?v=61e1476431", "pages/notes.js?v=61e1476431", "pages/practice.js?v=61e1476431", "pages/review.js?v=61e1476431", "pages/settings.js?v=61e1476431", "pages/shell.js?v=61e1476431", "router.js?v=61e1476431", "sections.js?v=61e1476431", "speech.js?v=61e1476431", "state.js?v=61e1476431", "store.js?v=61e1476431", "sync.js?v=61e1476431", "widgets/audio.js?v=61e1476431", "widgets/blocks.js?v=61e1476431", "widgets/dictionary.js?v=61e1476431", "widgets/grammar.js?v=61e1476431", "widgets/notes.js?v=61e1476431", "widgets/questions.js?v=61e1476431", "data/users.json"] with the list of app files (every JS module, versioned).
const SHELL = ["./", "index.html", "style.css?v=61e1476431", "app.js?v=61e1476431", "core.js?v=61e1476431", "dom.js?v=61e1476431", "gist.js?v=61e1476431", "library.js?v=61e1476431", "nav.js?v=61e1476431", "pages/dashboard.js?v=61e1476431", "pages/history.js?v=61e1476431", "pages/home.js?v=61e1476431", "pages/lesson.js?v=61e1476431", "pages/notes.js?v=61e1476431", "pages/practice.js?v=61e1476431", "pages/review.js?v=61e1476431", "pages/settings.js?v=61e1476431", "pages/shell.js?v=61e1476431", "router.js?v=61e1476431", "sections.js?v=61e1476431", "speech.js?v=61e1476431", "state.js?v=61e1476431", "store.js?v=61e1476431", "sync.js?v=61e1476431", "widgets/audio.js?v=61e1476431", "widgets/blocks.js?v=61e1476431", "widgets/dictionary.js?v=61e1476431", "widgets/grammar.js?v=61e1476431", "widgets/notes.js?v=61e1476431", "widgets/questions.js?v=61e1476431", "data/users.json"];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
    .catch(() => {})
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Versioned files (?v=) never change; everything else is revalidated with the server.
function revalidate(req) {
  if (new URL(req.url).searchParams.has('v')) return fetch(req);
  // A navigation request cannot be copied with new options, so fetch its URL instead.
  if (req.mode === 'navigate') return fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
  return fetch(new Request(req, { cache: 'no-cache' }));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Audio is streamed with range requests; Safari only plays it reliably without the worker.
  if (req.headers.has('range') || req.destination === 'audio') return;
  event.respondWith(revalidate(req)
    .then((res) => {
      if (res.ok && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
      }
      return res;
    })
    .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))));
});
