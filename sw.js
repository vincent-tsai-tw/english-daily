// Network first, cache as fallback: always fresh online, still usable offline (e.g. on the MRT).
// Requests revalidate with the server (cache: 'no-cache'), so GitHub Pages' 10-minute HTTP cache
// never serves an outdated page after a new version is published.
const CACHE = 'english-daily-d4943bd8ca';
// The build replaces ["./", "index.html", "style.css?v=d4943bd8ca", "app.js?v=d4943bd8ca", "core.js?v=d4943bd8ca", "dom.js?v=d4943bd8ca", "gist.js?v=d4943bd8ca", "library.js?v=d4943bd8ca", "nav.js?v=d4943bd8ca", "pages/dashboard.js?v=d4943bd8ca", "pages/history.js?v=d4943bd8ca", "pages/home.js?v=d4943bd8ca", "pages/lesson.js?v=d4943bd8ca", "pages/notes.js?v=d4943bd8ca", "pages/practice.js?v=d4943bd8ca", "pages/review.js?v=d4943bd8ca", "pages/settings.js?v=d4943bd8ca", "pages/shell.js?v=d4943bd8ca", "router.js?v=d4943bd8ca", "sections.js?v=d4943bd8ca", "speech.js?v=d4943bd8ca", "state.js?v=d4943bd8ca", "store.js?v=d4943bd8ca", "sync.js?v=d4943bd8ca", "widgets/audio.js?v=d4943bd8ca", "widgets/blocks.js?v=d4943bd8ca", "widgets/dictionary.js?v=d4943bd8ca", "widgets/grammar.js?v=d4943bd8ca", "widgets/notes.js?v=d4943bd8ca", "widgets/questions.js?v=d4943bd8ca", "data/users.json"] with the list of app files (every JS module, versioned).
const SHELL = ["./", "index.html", "style.css?v=d4943bd8ca", "app.js?v=d4943bd8ca", "core.js?v=d4943bd8ca", "dom.js?v=d4943bd8ca", "gist.js?v=d4943bd8ca", "library.js?v=d4943bd8ca", "nav.js?v=d4943bd8ca", "pages/dashboard.js?v=d4943bd8ca", "pages/history.js?v=d4943bd8ca", "pages/home.js?v=d4943bd8ca", "pages/lesson.js?v=d4943bd8ca", "pages/notes.js?v=d4943bd8ca", "pages/practice.js?v=d4943bd8ca", "pages/review.js?v=d4943bd8ca", "pages/settings.js?v=d4943bd8ca", "pages/shell.js?v=d4943bd8ca", "router.js?v=d4943bd8ca", "sections.js?v=d4943bd8ca", "speech.js?v=d4943bd8ca", "state.js?v=d4943bd8ca", "store.js?v=d4943bd8ca", "sync.js?v=d4943bd8ca", "widgets/audio.js?v=d4943bd8ca", "widgets/blocks.js?v=d4943bd8ca", "widgets/dictionary.js?v=d4943bd8ca", "widgets/grammar.js?v=d4943bd8ca", "widgets/notes.js?v=d4943bd8ca", "widgets/questions.js?v=d4943bd8ca", "data/users.json"];

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
