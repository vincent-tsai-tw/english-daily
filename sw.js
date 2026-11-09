// Network first, cache as fallback: always fresh online, still usable offline (e.g. on the MRT).
// Requests revalidate with the server (cache: 'no-cache'), so GitHub Pages' 10-minute HTTP cache
// never serves an outdated page after a new version is published.
const CACHE = 'english-daily-ec537f59b3';
// The build replaces ["./", "index.html", "style.css?v=ec537f59b3", "app.js?v=ec537f59b3", "core.js?v=ec537f59b3", "dom.js?v=ec537f59b3", "gist.js?v=ec537f59b3", "library.js?v=ec537f59b3", "nav.js?v=ec537f59b3", "pages/dashboard.js?v=ec537f59b3", "pages/history.js?v=ec537f59b3", "pages/home.js?v=ec537f59b3", "pages/lesson.js?v=ec537f59b3", "pages/notes.js?v=ec537f59b3", "pages/practice.js?v=ec537f59b3", "pages/review.js?v=ec537f59b3", "pages/settings.js?v=ec537f59b3", "pages/shell.js?v=ec537f59b3", "router.js?v=ec537f59b3", "sections.js?v=ec537f59b3", "speech.js?v=ec537f59b3", "state.js?v=ec537f59b3", "store.js?v=ec537f59b3", "sync.js?v=ec537f59b3", "widgets/audio.js?v=ec537f59b3", "widgets/blocks.js?v=ec537f59b3", "widgets/dictionary.js?v=ec537f59b3", "widgets/grammar.js?v=ec537f59b3", "widgets/notes.js?v=ec537f59b3", "widgets/questions.js?v=ec537f59b3", "data/users.json"] with the list of app files (every JS module, versioned).
const SHELL = ["./", "index.html", "style.css?v=ec537f59b3", "app.js?v=ec537f59b3", "core.js?v=ec537f59b3", "dom.js?v=ec537f59b3", "gist.js?v=ec537f59b3", "library.js?v=ec537f59b3", "nav.js?v=ec537f59b3", "pages/dashboard.js?v=ec537f59b3", "pages/history.js?v=ec537f59b3", "pages/home.js?v=ec537f59b3", "pages/lesson.js?v=ec537f59b3", "pages/notes.js?v=ec537f59b3", "pages/practice.js?v=ec537f59b3", "pages/review.js?v=ec537f59b3", "pages/settings.js?v=ec537f59b3", "pages/shell.js?v=ec537f59b3", "router.js?v=ec537f59b3", "sections.js?v=ec537f59b3", "speech.js?v=ec537f59b3", "state.js?v=ec537f59b3", "store.js?v=ec537f59b3", "sync.js?v=ec537f59b3", "widgets/audio.js?v=ec537f59b3", "widgets/blocks.js?v=ec537f59b3", "widgets/dictionary.js?v=ec537f59b3", "widgets/grammar.js?v=ec537f59b3", "widgets/notes.js?v=ec537f59b3", "widgets/questions.js?v=ec537f59b3", "data/users.json"];

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
