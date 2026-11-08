// Network first, cache as fallback: always fresh online, still usable offline (e.g. on the MRT).
// Requests revalidate with the server (cache: 'no-cache'), so GitHub Pages' 10-minute HTTP cache
// never serves an outdated page after a new version is published.
const CACHE = 'english-daily-98a517667b';
// The build replaces ["./", "index.html", "style.css?v=98a517667b", "app.js?v=98a517667b", "core.js?v=98a517667b", "dom.js?v=98a517667b", "gist.js?v=98a517667b", "library.js?v=98a517667b", "nav.js?v=98a517667b", "pages/dashboard.js?v=98a517667b", "pages/history.js?v=98a517667b", "pages/home.js?v=98a517667b", "pages/lesson.js?v=98a517667b", "pages/notes.js?v=98a517667b", "pages/practice.js?v=98a517667b", "pages/review.js?v=98a517667b", "pages/settings.js?v=98a517667b", "pages/shell.js?v=98a517667b", "router.js?v=98a517667b", "sections.js?v=98a517667b", "speech.js?v=98a517667b", "state.js?v=98a517667b", "store.js?v=98a517667b", "sync.js?v=98a517667b", "widgets/audio.js?v=98a517667b", "widgets/blocks.js?v=98a517667b", "widgets/dictionary.js?v=98a517667b", "widgets/grammar.js?v=98a517667b", "widgets/notes.js?v=98a517667b", "widgets/questions.js?v=98a517667b", "data/users.json"] with the list of app files (every JS module, versioned).
const SHELL = ["./", "index.html", "style.css?v=98a517667b", "app.js?v=98a517667b", "core.js?v=98a517667b", "dom.js?v=98a517667b", "gist.js?v=98a517667b", "library.js?v=98a517667b", "nav.js?v=98a517667b", "pages/dashboard.js?v=98a517667b", "pages/history.js?v=98a517667b", "pages/home.js?v=98a517667b", "pages/lesson.js?v=98a517667b", "pages/notes.js?v=98a517667b", "pages/practice.js?v=98a517667b", "pages/review.js?v=98a517667b", "pages/settings.js?v=98a517667b", "pages/shell.js?v=98a517667b", "router.js?v=98a517667b", "sections.js?v=98a517667b", "speech.js?v=98a517667b", "state.js?v=98a517667b", "store.js?v=98a517667b", "sync.js?v=98a517667b", "widgets/audio.js?v=98a517667b", "widgets/blocks.js?v=98a517667b", "widgets/dictionary.js?v=98a517667b", "widgets/grammar.js?v=98a517667b", "widgets/notes.js?v=98a517667b", "widgets/questions.js?v=98a517667b", "data/users.json"];

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
