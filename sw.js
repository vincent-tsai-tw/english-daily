// Offline copy and fast start. Four kinds of request:
// - the app's own files under a versioned URL (?v=<build>) never change, so they come from the
//   cache and are downloaded once per build;
// - the page is network first, so a new build is seen at once; when the network fails or stays
//   silent, this worker's own copy of the page answers (never another build's: the page and its
//   modules must match);
// - the data (lessons, index, dictionary) is network first too, with the copy from the last
//   visit as the answer when the network fails: the app still opens on the MRT;
// - everything else (audio, icons) is left to the browser.
// The build id only changes when the app's files change (english_daily/site.py shell_version),
// not with every new lesson, so between releases this worker and its caches stay as they are.
// The decisions here are tested in tests/sw.test.mjs.
const PREFIX = 'english-daily-'; // CacheStorage is shared by every site on this host: touch only our own
const SHELL_CACHE = 'english-daily-8942a1287a'; // this build's files, complete or absent; app.js BUILD_CACHE is the same name
const DATA_CACHE = `${PREFIX}data`; // every data file the app has loaded, kept across builds
// The build replaces ["./", "index.html", "style.css?v=8942a1287a", "app.js?v=8942a1287a", "core.js?v=8942a1287a", "dom.js?v=8942a1287a", "gist.js?v=8942a1287a", "library.js?v=8942a1287a", "nav.js?v=8942a1287a", "net.js?v=8942a1287a", "pages/dashboard.js?v=8942a1287a", "pages/history.js?v=8942a1287a", "pages/home.js?v=8942a1287a", "pages/lesson.js?v=8942a1287a", "pages/notes.js?v=8942a1287a", "pages/practice.js?v=8942a1287a", "pages/review.js?v=8942a1287a", "pages/settings.js?v=8942a1287a", "pages/shell.js?v=8942a1287a", "pages/weekly.js?v=8942a1287a", "router.js?v=8942a1287a", "sections.js?v=8942a1287a", "speech.js?v=8942a1287a", "state.js?v=8942a1287a", "store.js?v=8942a1287a", "sync.js?v=8942a1287a", "widgets/audio.js?v=8942a1287a", "widgets/blocks.js?v=8942a1287a", "widgets/dictionary.js?v=8942a1287a", "widgets/grammar.js?v=8942a1287a", "widgets/notes.js?v=8942a1287a", "widgets/questions.js?v=8942a1287a", "widgets/weekly.js?v=8942a1287a"] with the list of app files (the page, the stylesheet, every module).
const SHELL = ["./", "index.html", "style.css?v=8942a1287a", "app.js?v=8942a1287a", "core.js?v=8942a1287a", "dom.js?v=8942a1287a", "gist.js?v=8942a1287a", "library.js?v=8942a1287a", "nav.js?v=8942a1287a", "net.js?v=8942a1287a", "pages/dashboard.js?v=8942a1287a", "pages/history.js?v=8942a1287a", "pages/home.js?v=8942a1287a", "pages/lesson.js?v=8942a1287a", "pages/notes.js?v=8942a1287a", "pages/practice.js?v=8942a1287a", "pages/review.js?v=8942a1287a", "pages/settings.js?v=8942a1287a", "pages/shell.js?v=8942a1287a", "pages/weekly.js?v=8942a1287a", "router.js?v=8942a1287a", "sections.js?v=8942a1287a", "speech.js?v=8942a1287a", "state.js?v=8942a1287a", "store.js?v=8942a1287a", "sync.js?v=8942a1287a", "widgets/audio.js?v=8942a1287a", "widgets/blocks.js?v=8942a1287a", "widgets/dictionary.js?v=8942a1287a", "widgets/grammar.js?v=8942a1287a", "widgets/notes.js?v=8942a1287a", "widgets/questions.js?v=8942a1287a", "widgets/weekly.js?v=8942a1287a"];
const NETWORK_WAIT_MS = 4000; // with a cached copy at hand, how long the network may take
const KEEP_LESSON_DAYS = 60; // older lesson files leave the offline copy when a new build activates

// All or nothing: if one file does not arrive the install fails, the previous worker and its
// cache stay in charge and the browser tries again on a later visit. The page is fetched past the
// HTTP cache; a versioned file is the same wherever it comes from.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE)
    .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, url.includes('?v=') ? {} : { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

const isData = (url) => new URL(url).pathname.includes('/data/');

// Before an older build's cache is deleted, keep the data it holds (workers before the shared
// data cache stored lessons next to the app's files; a renamed data cache is carried over too).
async function retire(name) {
  const [old, data] = await Promise.all([caches.open(name), caches.open(DATA_CACHE)]);
  for (const req of await old.keys()) {
    if (!isData(req.url) || await data.match(req)) continue;
    const res = await old.match(req);
    if (res) await data.put(req, res);
  }
  await caches.delete(name);
}

async function trimLessons() {
  const data = await caches.open(DATA_CACHE);
  const cutoff = new Date(Date.now() - KEEP_LESSON_DAYS * 86400000).toISOString().slice(0, 10);
  for (const req of await data.keys()) {
    const date = req.url.match(/\/lessons\/(\d{4}-\d{2}-\d{2})\.json$/)?.[1];
    if (date && date < cutoff) await data.delete(req);
  }
}

// The page is claimed only after the old caches are gone, so when it hears `controllerchange`
// it can tell from the cache names whether this worker is of its own build (app.js).
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== SHELL_CACHE && k !== DATA_CACHE)
      .map((k) => retire(k).catch(() => caches.delete(k)))))
    .then(trimLessons)
    .catch(() => {})
    .then(() => self.clients.claim()));
});

// Let a cache write finish even if the answer has already gone out and the worker is idle.
function keepAlive(event, promise) {
  try { event.waitUntil(promise); } catch { /* the event is over: the write still runs while the worker lives */ }
}

async function cacheFirst(event, req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req).catch(() => fetch(req)); // one more try: a missing module leaves the app blank
  if (res.ok && res.status === 200) {
    const copy = res.clone();
    keepAlive(event, caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy)).catch(() => {}));
  }
  return res;
}

// The network's answer. With a cached copy at hand (`cacheName` + `key`, or `fallback()`), that
// copy answers instead when the network fails, the server errs or nothing comes within
// NETWORK_WAIT_MS. Without one, the page gets the network's answer or its failure and tries
// again itself (app/net.js). A good answer is stored under `key` when `cacheName` is given.
function networkFirst(event, request, { cacheName, key, fallback }) {
  const store = (res) => {
    if (!cacheName || !res.ok || res.status !== 200) return undefined;
    const copy = res.clone();
    return caches.open(cacheName).then((cache) => cache.put(key, copy));
  };
  const fresh = fetch(request);
  keepAlive(event, fresh.then(store).catch(() => {})); // registered first: the copy is taken before the answer is used
  const stored = cacheName ? caches.open(cacheName).then((cache) => cache.match(key)) : Promise.resolve(undefined);
  return stored.then((hit) => hit || (fallback ? fallback() : undefined)).then((cached) => {
    if (!cached) return fresh;
    return Promise.race([
      fresh.then((res) => (res.status >= 500 ? cached : res), () => cached),
      new Promise((resolve) => { setTimeout(() => resolve(cached), NETWORK_WAIT_MS); }),
    ]);
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Audio is streamed with range requests; Safari only plays it reliably without the worker.
  if (req.headers.has('range') || req.destination === 'audio' || url.pathname.includes('/audio/')) return;
  if (url.searchParams.has('v')) {
    event.respondWith(cacheFirst(event, req));
  } else if (req.mode === 'navigate') {
    // A navigation request cannot be copied with new options, so its URL is fetched instead. The
    // answer is not stored: the shell cache holds exactly the build this worker installed.
    const request = new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' });
    const ownPage = () => caches.open(SHELL_CACHE).then((cache) => cache.match('index.html'));
    event.respondWith(networkFirst(event, request, { fallback: ownPage }));
  } else if (isData(req.url)) {
    event.respondWith(networkFirst(event, new Request(req, { cache: 'no-cache' }), { cacheName: DATA_CACHE, key: req }));
  }
});
