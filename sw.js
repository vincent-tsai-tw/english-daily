// Network first, cache as fallback: always fresh online, still usable offline (e.g. on the MRT).
// Requests revalidate with the server (cache: 'no-cache'), so GitHub Pages' 10-minute HTTP cache
// never serves an outdated page after a new version is published.
const CACHE = 'english-daily-4fbc7a9ae0';
// The build replaces ["./", "index.html", "style.css?v=4fbc7a9ae0", "app.js?v=4fbc7a9ae0", "core.js?v=4fbc7a9ae0", "dom.js?v=4fbc7a9ae0", "gist.js?v=4fbc7a9ae0", "library.js?v=4fbc7a9ae0", "nav.js?v=4fbc7a9ae0", "pages/dashboard.js?v=4fbc7a9ae0", "pages/history.js?v=4fbc7a9ae0", "pages/home.js?v=4fbc7a9ae0", "pages/lesson.js?v=4fbc7a9ae0", "pages/notes.js?v=4fbc7a9ae0", "pages/practice.js?v=4fbc7a9ae0", "pages/review.js?v=4fbc7a9ae0", "pages/settings.js?v=4fbc7a9ae0", "pages/shell.js?v=4fbc7a9ae0", "router.js?v=4fbc7a9ae0", "sections.js?v=4fbc7a9ae0", "speech.js?v=4fbc7a9ae0", "state.js?v=4fbc7a9ae0", "store.js?v=4fbc7a9ae0", "sync.js?v=4fbc7a9ae0", "widgets/audio.js?v=4fbc7a9ae0", "widgets/blocks.js?v=4fbc7a9ae0", "widgets/dictionary.js?v=4fbc7a9ae0", "widgets/grammar.js?v=4fbc7a9ae0", "widgets/notes.js?v=4fbc7a9ae0", "widgets/questions.js?v=4fbc7a9ae0", "data/users.json"] with the list of app files (every JS module, versioned).
const SHELL = ["./", "index.html", "style.css?v=4fbc7a9ae0", "app.js?v=4fbc7a9ae0", "core.js?v=4fbc7a9ae0", "dom.js?v=4fbc7a9ae0", "gist.js?v=4fbc7a9ae0", "library.js?v=4fbc7a9ae0", "nav.js?v=4fbc7a9ae0", "pages/dashboard.js?v=4fbc7a9ae0", "pages/history.js?v=4fbc7a9ae0", "pages/home.js?v=4fbc7a9ae0", "pages/lesson.js?v=4fbc7a9ae0", "pages/notes.js?v=4fbc7a9ae0", "pages/practice.js?v=4fbc7a9ae0", "pages/review.js?v=4fbc7a9ae0", "pages/settings.js?v=4fbc7a9ae0", "pages/shell.js?v=4fbc7a9ae0", "router.js?v=4fbc7a9ae0", "sections.js?v=4fbc7a9ae0", "speech.js?v=4fbc7a9ae0", "state.js?v=4fbc7a9ae0", "store.js?v=4fbc7a9ae0", "sync.js?v=4fbc7a9ae0", "widgets/audio.js?v=4fbc7a9ae0", "widgets/blocks.js?v=4fbc7a9ae0", "widgets/dictionary.js?v=4fbc7a9ae0", "widgets/grammar.js?v=4fbc7a9ae0", "widgets/notes.js?v=4fbc7a9ae0", "widgets/questions.js?v=4fbc7a9ae0", "data/users.json"];

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
