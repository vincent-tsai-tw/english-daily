// Network first, cache as fallback: always fresh online, still usable offline (e.g. on the MRT).
// Requests revalidate with the server (cache: 'no-cache'), so GitHub Pages' 10-minute HTTP cache
// never serves an outdated page after a new version is published.
const CACHE = 'english-daily-eae654e601';
// The build replaces ["./", "index.html", "style.css?v=eae654e601", "app.js?v=eae654e601", "core.js?v=eae654e601", "dom.js?v=eae654e601", "gist.js?v=eae654e601", "library.js?v=eae654e601", "nav.js?v=eae654e601", "pages/dashboard.js?v=eae654e601", "pages/history.js?v=eae654e601", "pages/home.js?v=eae654e601", "pages/lesson.js?v=eae654e601", "pages/notes.js?v=eae654e601", "pages/practice.js?v=eae654e601", "pages/review.js?v=eae654e601", "pages/settings.js?v=eae654e601", "pages/shell.js?v=eae654e601", "pages/weekly.js?v=eae654e601", "router.js?v=eae654e601", "sections.js?v=eae654e601", "speech.js?v=eae654e601", "state.js?v=eae654e601", "store.js?v=eae654e601", "sync.js?v=eae654e601", "widgets/audio.js?v=eae654e601", "widgets/blocks.js?v=eae654e601", "widgets/dictionary.js?v=eae654e601", "widgets/grammar.js?v=eae654e601", "widgets/notes.js?v=eae654e601", "widgets/questions.js?v=eae654e601", "widgets/weekly.js?v=eae654e601", "data/users.json"] with the list of app files (every JS module, versioned).
const SHELL = ["./", "index.html", "style.css?v=eae654e601", "app.js?v=eae654e601", "core.js?v=eae654e601", "dom.js?v=eae654e601", "gist.js?v=eae654e601", "library.js?v=eae654e601", "nav.js?v=eae654e601", "pages/dashboard.js?v=eae654e601", "pages/history.js?v=eae654e601", "pages/home.js?v=eae654e601", "pages/lesson.js?v=eae654e601", "pages/notes.js?v=eae654e601", "pages/practice.js?v=eae654e601", "pages/review.js?v=eae654e601", "pages/settings.js?v=eae654e601", "pages/shell.js?v=eae654e601", "pages/weekly.js?v=eae654e601", "router.js?v=eae654e601", "sections.js?v=eae654e601", "speech.js?v=eae654e601", "state.js?v=eae654e601", "store.js?v=eae654e601", "sync.js?v=eae654e601", "widgets/audio.js?v=eae654e601", "widgets/blocks.js?v=eae654e601", "widgets/dictionary.js?v=eae654e601", "widgets/grammar.js?v=eae654e601", "widgets/notes.js?v=eae654e601", "widgets/questions.js?v=eae654e601", "widgets/weekly.js?v=eae654e601", "data/users.json"];

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
