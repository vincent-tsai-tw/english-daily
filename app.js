// English Daily: the single-page app for a few learners on shared devices. Each device picks a
// profile; that learner's lessons, deck and practice pool are prebuilt JSON under data/u/<slug>/
// (library.js). Progress lives in localStorage, one key per learner (store.js), and once connected
// syncs to that learner's file in a secret gist (sync.js), which the daily lesson generator reads.
// This file only wires the pieces together: routes, shell events and boot.

import * as speech from './speech.js?v=8942a1287a';
import { store, library, syncer } from './state.js?v=8942a1287a';
import { $, put, toast, hideSheet } from './dom.js?v=8942a1287a';
import { Router, hashParts } from './router.js?v=8942a1287a';
import { onRoute } from './nav.js?v=8942a1287a';
import { PULL_EVERY_MS } from './sync.js?v=8942a1287a';
import { LoadError } from './net.js?v=8942a1287a';
import { profilePage, welcomePage, errorBox, setQuiet, paintQuiet, updateBadge, paintSyncLine, paintTodo, paintBell, openUpdates } from './pages/shell.js?v=8942a1287a';
import { homePage } from './pages/home.js?v=8942a1287a';
import { sectionPage, challengePage } from './pages/lesson.js?v=8942a1287a';
import { reviewPage } from './pages/review.js?v=8942a1287a';
import { practicePage } from './pages/practice.js?v=8942a1287a';
import { dashboardPage } from './pages/dashboard.js?v=8942a1287a';
import { historyPage } from './pages/history.js?v=8942a1287a';
import { settingsPage, goalsPage } from './pages/settings.js?v=8942a1287a';
import { notesPage } from './pages/notes.js?v=8942a1287a';
import { weeklyPage } from './pages/weekly.js?v=8942a1287a';
import { LOOKUP_IN, wordAtPoint, openDictionary } from './widgets/dictionary.js?v=8942a1287a';

// `idle` pages have nothing half-typed, so a sync or an app update may re-render or reload them.
const router = new Router()
  .add('', () => homePage(library.currentLessonDate()), { idle: true })
  .add('l/:date', ({ date }) => homePage(date), { idle: true })
  .add('l/:date/challenge/:flag?', ({ date }) => challengePage(date))
  .add('l/:date/:sec/:flag?', ({ date, sec }) => sectionPage(date, sec))
  .add('review', () => reviewPage(), { tab: 'review' })
  .add('practice/:mode?', ({ mode }) => practicePage(mode), { tab: 'practice' })
  .add('progress/:slug?', ({ slug }) => dashboardPage(slug || store.slug), { tab: 'progress', idle: true })
  .add('history', () => historyPage(), { tab: 'history', idle: true })
  .add('archive', () => historyPage(), { tab: 'history', idle: true })
  .add('settings', () => settingsPage(), { tab: 'settings' })
  .add('goals', () => goalsPage(), { tab: 'settings' })
  .add('notes', () => notesPage())
  .add('weekly/:week?', ({ week }) => weeklyPage(week), { tab: 'practice' });

// Pages that work before the first lesson exists.
const NO_LESSON_PAGES = ['settings', 'review', 'progress', 'history'];

const BUILD_CACHE = 'english-daily-8942a1287a'; // the cache the service worker of this build fills (sw.js SHELL_CACHE)
const AUTO_RETRY_MS = 8000; // while a load error is on screen, try again this often

let updateReady = false;
let loading = null; // the first load of the shared data, while it runs
let loaded = false; // the profiles and the signed-in learner's lessons are in memory
let waiting = false; // a load error is on screen: try again when the network may be back
let retryTimer = 0;
let routeSeq = 0; // the newest route() call: an older one that finishes late must not draw over it
const isIdleRoute = () => Boolean(router.match(hashParts())?.idle);

function refreshIfIdle() {
  if (isIdleRoute()) route(); else updateBadge();
}

// Sync with the gist; while a load error is on screen, the same moments (the app comes back to
// the front, the minute timer) try to load the page again instead.
function pull() {
  if (waiting) return route();
  library.refreshIndex().then((newer) => { if (newer) refreshIfIdle(); }).catch(() => {}); // a new day's lesson
  return syncer.now().then((changed) => { if (changed) refreshIfIdle(); else paintSyncLine(); });
}

// What every page needs before it can be drawn. Called until it has worked once.
function loadData() {
  loading ||= (async () => {
    await library.loadShared();
    paintBell();
    if (store.me && !library.profiles.some((p) => p.slug === store.me.slug)) store.signOut();
    if (store.me) await library.loadUser();
    loaded = true;
  })().finally(() => { loading = null; });
  return loading;
}

// Show why the page could not be drawn. Data that did not arrive is asked for again on its own:
// every AUTO_RETRY_MS while the app is in front, when the phone reports it is online again and
// when the app comes back to the front (see pull).
function showError(err) {
  put($('#view'), errorBox(err, route));
  waiting = err instanceof LoadError;
  clearTimeout(retryTimer);
  if (waiting) retryTimer = setTimeout(() => { if (waiting && document.visibilityState === 'visible') route(); }, AUTO_RETRY_MS);
}

async function chooseProfile(profile) {
  store.choose(profile, library.profiles[0]?.slug);
  try {
    await library.loadUser();
  } catch (err) {
    store.signOut(); // the picker comes back on the next route instead of a dead end
    showError(err);
    return;
  }
  location.hash = '#/';
  await route();
  if (!waiting) pull();
}

// Draw the page for the current address. Loading can take seconds on a bad network (net.js tries
// again), and taps, the retry timer and the sync all call this: only the newest call draws.
async function route() {
  if (updateReady) { location.reload(); return; }
  const seq = ++routeSeq;
  const recovering = waiting;
  speech.stop();
  hideSheet();
  clearTimeout(retryTimer);
  if (!loaded) {
    try { await loadData(); } catch (err) { if (seq === routeSeq) showError(err); return; }
    if (seq !== routeSeq) return;
  }
  waiting = false;
  document.body.classList.toggle('signed-out', !store.me);
  if (!store.me) { put($('#view'), profilePage(chooseProfile)); window.scrollTo(0, 0); return; }
  const parts = hashParts();
  const view = $('#view');
  let tab = 'home';
  try {
    let page;
    const hit = router.match(parts);
    if (!library.index.length && !NO_LESSON_PAGES.includes(parts[0])) page = welcomePage();
    else if (hit) { tab = hit.tab; page = await hit.handler(hit.params); }
    else throw new Error('找不到這個頁面');
    if (seq !== routeSeq) return;
    if (parts[0] === 'l' && parts[1] !== library.currentLessonDate()) tab = 'history';
    put(view, page);
    view.classList.toggle('show-todo', parts[3] === 'todo');
    paintTodo();
  } catch (err) {
    if (seq !== routeSeq) return;
    showError(err);
  }
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  paintSyncLine();
  updateBadge();
  window.scrollTo(0, 0);
  if (parts[3] === 'todo') requestAnimationFrame(() => view.querySelector('.todo')?.scrollIntoView({ block: 'center' }));
  if (recovering && !waiting) pull(); // back after a load error: catch up on the sync that was skipped
}

async function boot() {
  onRoute(route);
  store.onAnswer = paintTodo;
  syncer.onFeedback = () => toast('老師批改好了，到寫作區看看。');
  syncer.onError = (err) => toast(err.message);
  $('#quiet').addEventListener('click', () => setQuiet(!store.settings.quiet));
  $('#bell').addEventListener('click', (e) => { e.stopPropagation(); openUpdates(); });
  document.addEventListener('click', (e) => {
    const sheet = $('#sheet');
    if (!sheet.hidden && !sheet.contains(e.target)) hideSheet();
  });
  // Tap any English word in lesson text to look it up.
  $('#view').addEventListener('click', (e) => {
    if (e.target.closest('button, a, input, textarea, select, summary, .vw') || !e.target.closest(LOOKUP_IN)) return;
    const hit = wordAtPoint(e.clientX, e.clientY);
    if (hit) openDictionary(hit.word, hit.sentence);
  });
  paintQuiet();
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => { if (waiting) route(); });
  await route(); // loads the data first; a failure leaves the error page, which keeps trying
  if (!waiting) pull();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { syncer.flush(); return; }
    pull();
  });
  window.addEventListener('focus', pull);
  window.addEventListener('pageshow', (e) => { if (e.persisted) pull(); });
  setInterval(() => { if (document.visibilityState === 'visible') pull(); }, PULL_EVERY_MS);
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', async () => {
      if (!hadController || updateReady) return;
      // A worker of this very build took over (the page was loaded fresh from the network before
      // the worker updated): the page is already the new version, nothing to reload.
      if (await caches.has(BUILD_CACHE).catch(() => false)) return;
      updateReady = true;
      if (isIdleRoute()) location.reload();
    });
    navigator.serviceWorker.register('sw.js').then((reg) => {
      setInterval(() => reg.update().catch(() => {}), PULL_EVERY_MS * 10);
    }).catch(() => {});
  }
}

boot();
