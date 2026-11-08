// English Daily: the single-page app for a few learners on shared devices. Each device picks a
// profile; that learner's lessons, deck and practice pool are prebuilt JSON under data/u/<slug>/
// (library.js). Progress lives in localStorage, one key per learner (store.js), and once connected
// syncs to that learner's file in a secret gist (sync.js), which the daily lesson generator reads.
// This file only wires the pieces together: routes, shell events and boot.

import * as speech from './speech.js?v=4fbc7a9ae0';
import { store, library, syncer } from './state.js?v=4fbc7a9ae0';
import { $, put, toast, hideSheet } from './dom.js?v=4fbc7a9ae0';
import { Router, hashParts } from './router.js?v=4fbc7a9ae0';
import { onRoute } from './nav.js?v=4fbc7a9ae0';
import { PULL_EVERY_MS } from './sync.js?v=4fbc7a9ae0';
import { profilePage, welcomePage, errorBox, setQuiet, paintQuiet, updateBadge, paintSyncLine, paintTodo, paintBell, openUpdates } from './pages/shell.js?v=4fbc7a9ae0';
import { homePage } from './pages/home.js?v=4fbc7a9ae0';
import { sectionPage, challengePage } from './pages/lesson.js?v=4fbc7a9ae0';
import { reviewPage } from './pages/review.js?v=4fbc7a9ae0';
import { practicePage } from './pages/practice.js?v=4fbc7a9ae0';
import { dashboardPage } from './pages/dashboard.js?v=4fbc7a9ae0';
import { historyPage } from './pages/history.js?v=4fbc7a9ae0';
import { settingsPage, goalsPage } from './pages/settings.js?v=4fbc7a9ae0';
import { notesPage } from './pages/notes.js?v=4fbc7a9ae0';
import { LOOKUP_IN, wordAtPoint, openDictionary } from './widgets/dictionary.js?v=4fbc7a9ae0';

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
  .add('notes', () => notesPage());

// Pages that work before the first lesson exists.
const NO_LESSON_PAGES = ['settings', 'review', 'progress', 'history'];

let updateReady = false;
const isIdleRoute = () => Boolean(router.match(hashParts())?.idle);

function refreshIfIdle() {
  if (isIdleRoute()) route(); else updateBadge();
}

const pull = () => syncer.now().then((changed) => { if (changed) refreshIfIdle(); else paintSyncLine(); });

async function chooseProfile(profile) {
  store.choose(profile, library.profiles[0]?.slug);
  try {
    await library.loadUser();
  } catch (err) {
    store.signOut(); // the picker comes back on the next route instead of a dead end
    put($('#view'), errorBox(err));
    return;
  }
  location.hash = '#/';
  await route();
  pull();
}

async function route() {
  if (updateReady) { location.reload(); return; }
  speech.stop();
  hideSheet();
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
    if (parts[0] === 'l' && parts[1] !== library.currentLessonDate()) tab = 'history';
    put(view, page);
    view.classList.toggle('show-todo', parts[3] === 'todo');
    paintTodo();
  } catch (err) {
    put(view, errorBox(err));
  }
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  paintSyncLine();
  updateBadge();
  window.scrollTo(0, 0);
  if (parts[3] === 'todo') requestAnimationFrame(() => view.querySelector('.todo')?.scrollIntoView({ block: 'center' }));
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
  try {
    await library.loadShared();
    paintBell();
    if (store.me && !library.profiles.some((p) => p.slug === store.me.slug)) store.signOut();
    if (store.me) await library.loadUser();
  } catch (err) {
    put($('#view'), errorBox(err));
    return;
  }
  window.addEventListener('hashchange', route);
  await route();
  pull();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { syncer.flush(); return; }
    pull();
  });
  window.addEventListener('focus', pull);
  window.addEventListener('pageshow', (e) => { if (e.persisted) pull(); });
  setInterval(() => { if (document.visibilityState === 'visible') pull(); }, PULL_EVERY_MS);
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || updateReady) return;
      updateReady = true;
      if (isIdleRoute()) location.reload();
    });
    navigator.serviceWorker.register('sw.js').then((reg) => {
      setInterval(() => reg.update().catch(() => {}), PULL_EVERY_MS * 10);
    }).catch(() => {});
  }
}

boot();
