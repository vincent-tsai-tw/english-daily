// Network first, cache as fallback: always fresh online, still usable offline (e.g. on the MRT).
// Requests revalidate with the server (cache: 'no-cache'), so GitHub Pages' 10-minute HTTP cache
// never serves an outdated page after a new version is published.
const CACHE = 'english-daily-f46691462d';
// The build replaces ["./", "index.html", "style.css?v=f46691462d", "app.js?v=f46691462d", "core.js?v=f46691462d", "dom.js?v=f46691462d", "gist.js?v=f46691462d", "library.js?v=f46691462d", "nav.js?v=f46691462d", "pages/dashboard.js?v=f46691462d", "pages/history.js?v=f46691462d", "pages/home.js?v=f46691462d", "pages/lesson.js?v=f46691462d", "pages/notes.js?v=f46691462d", "pages/practice.js?v=f46691462d", "pages/review.js?v=f46691462d", "pages/settings.js?v=f46691462d", "pages/shell.js?v=f46691462d", "pages/weekly.js?v=f46691462d", "router.js?v=f46691462d", "sections.js?v=f46691462d", "speech.js?v=f46691462d", "state.js?v=f46691462d", "store.js?v=f46691462d", "sync.js?v=f46691462d", "widgets/audio.js?v=f46691462d", "widgets/blocks.js?v=f46691462d", "widgets/dictionary.js?v=f46691462d", "widgets/grammar.js?v=f46691462d", "widgets/notes.js?v=f46691462d", "widgets/questions.js?v=f46691462d", "widgets/weekly.js?v=f46691462d", "data/users.json"] with the list of app files (every JS module, versioned).
const SHELL = ["./", "index.html", "style.css?v=f46691462d", "app.js?v=f46691462d", "core.js?v=f46691462d", "dom.js?v=f46691462d", "gist.js?v=f46691462d", "library.js?v=f46691462d", "nav.js?v=f46691462d", "pages/dashboard.js?v=f46691462d", "pages/history.js?v=f46691462d", "pages/home.js?v=f46691462d", "pages/lesson.js?v=f46691462d", "pages/notes.js?v=f46691462d", "pages/practice.js?v=f46691462d", "pages/review.js?v=f46691462d", "pages/settings.js?v=f46691462d", "pages/shell.js?v=f46691462d", "pages/weekly.js?v=f46691462d", "router.js?v=f46691462d", "sections.js?v=f46691462d", "speech.js?v=f46691462d", "state.js?v=f46691462d", "store.js?v=f46691462d", "sync.js?v=f46691462d", "widgets/audio.js?v=f46691462d", "widgets/blocks.js?v=f46691462d", "widgets/dictionary.js?v=f46691462d", "widgets/grammar.js?v=f46691462d", "widgets/notes.js?v=f46691462d", "widgets/questions.js?v=f46691462d", "widgets/weekly.js?v=f46691462d", "data/users.json"];

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
