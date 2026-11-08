// English Daily: the single-page app for a few learners on shared devices. Each device picks a
// profile (ME); that learner's lessons, deck and practice pool are prebuilt JSON under
// data/u/<slug>/. Progress lives in localStorage (one key per learner) and, once connected, syncs
// to that learner's file in a secret gist (sync.js), which the daily lesson generator reads.

import * as core from './core.js?v=ffb1e7dae2';
import * as speech from './speech.js?v=ffb1e7dae2';
import * as sync from './sync.js?v=ffb1e7dae2';

const ME_KEY = 'english-daily:me';
const SYNC_DELAY_MS = 4000;
const PULL_EVERY_MS = 60000;
const WEEKDAYS = '日一二三四五六';
const SLOW_RATE = 0.7;
const RATES = [0.8, 1, 1.2];
const WEAK_EASE = 2.4;
const PASS = 0.9;
const SECTIONS = [
  { id: 'vocab', zh: '單字', en: 'Vocabulary', min: 4, sub: (L) => `${L.vocab.slice(0, 4).map((v) => v.word).join('、')}…` },
  { id: 'read', zh: '閱讀', en: 'Reading', min: 5, sub: (L) => L.reading.title },
  { id: 'grammar', zh: '文法', en: 'Grammar', min: 4, sub: (L) => L.grammar.point_zh + (L.grammar.review ? '＋複習' : '') },
  { id: 'listen', zh: '聽力', en: 'Listening', min: 5, sub: (L) => L.listening.title },
  { id: 'speak', zh: '口說', en: 'Speaking', min: 4, sub: (L) => `跟讀 ${L.speaking.shadowing.length} 句＋回答 ${L.speaking.prompts.length} 題` },
  { id: 'write', zh: '寫作', en: 'Writing', min: 6, sub: (L) => `中翻英 ${L.translation.length} 句＋短文寫作` },
];
const MISTAKE_LABEL = { read: '閱讀', listen: '聽力', grammar: '文法', review: '文法複習', 'ch.read': '挑戰閱讀', 'ch.listen': '挑戰聽力' };
const PRACTICE_MODES = [['dict', '聽寫'], ['shadow', '跟讀'], ['vocab', '單字'], ['grammar', '文法'], ['order', '重組'], ['trans', '翻譯']];
const ORDER_WORDS = [5, 12]; // sentence length (words) used for rebuilding
const DEFAULT_SETTINGS = { quiet: false, rate: 1, voice: '', newPerDay: 10, reviewMode: 'recognize', practiceMode: 'dict' };

const ICONS = {
  speaker: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  turtle: '<svg viewBox="0 0 24 24"><path d="M4 15c0-4 3.5-7 8-7s8 3 8 7H4z" fill="currentColor"/><path d="M6 15l-1 3M18 15l1 3M20 13h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="1.9"/></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13.5 2.5L5 13.5h6l-1 8 8.5-11h-6z" fill="currentColor"/></svg>',
};

// --- State ----------------------------------------------------------------------------------

function freshState() {
  return { ...core.migrateState({}), settings: { ...DEFAULT_SETTINGS } };
}

const storeKey = () => `english-daily:v1:${ME.slug}`;

function loadMe() {
  try { return JSON.parse(localStorage.getItem(ME_KEY) || 'null'); } catch { return null; }
}

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey()) || 'null');
    if (raw && typeof raw === 'object') return { ...core.migrateState(raw), settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) } };
  } catch { /* unreadable or blocked storage: start fresh in memory */ }
  return freshState();
}

let ME = loadMe();
let S = ME ? loadState() : freshState();
let dirty = false;
let syncTimer;
let syncing = null;

function persist() {
  if (!ME) return;
  try { localStorage.setItem(storeKey(), JSON.stringify(S)); } catch { /* private mode: memory only */ }
}

// Save learner progress and schedule a sync. Settings changes use persist(): they never sync.
function save() {
  persist();
  dirty = true;
  scheduleSync();
}

const now = () => Date.now();
const today = () => core.localDate();
const wkey = (word) => word.trim().toLowerCase();
const touch = () => { S.activity[today()] = true; };
const ans = (date, key) => S.answers[date]?.[key]?.v;

// Store an answer; `score` (0..1) also records a result that progress analysis uses.
function setAns(date, key, value, score) {
  (S.answers[date] ||= {})[key] = { v: value, t: now() };
  if (typeof score === 'number' && Number.isFinite(score)) {
    (S.results[date] ||= {})[key] = { s: Math.round(score * 1000) / 1000, t: now() };
  }
  touch();
  save();
  paintTodo();
}

const answered = (date, key) => { const v = ans(date, key); return v != null && v !== ''; };

// Answerable items carry data-ans="<date>|<key>"; `.todo` marks the unanswered ones, which the
// history tab's links (#/l/<date>/<section>/todo) highlight and scroll to.
function paintTodo() {
  document.querySelectorAll('[data-ans]').forEach((el) => {
    const [date, key] = el.dataset.ans.split('|');
    el.classList.toggle('todo', !answered(date, key));
  });
}

const answerStore = (date, key) => ({
  get: () => ans(date, key),
  set: (value, ok) => setAns(date, key, value, ok == null ? undefined : ok ? 1 : 0),
});

const activeMistakes = () => Object.values(S.mistakes).filter((m) => !m.fixed).sort((a, b) => a.t - b.t);

function recordMistake(m, correct) {
  const id = `${m.date}|${m.kind}|${m.i}`;
  const cur = S.mistakes[id];
  if (!correct && (!cur || cur.fixed)) S.mistakes[id] = { date: m.date, kind: m.kind, i: m.i, t: now(), fixed: false };
  else if (correct && cur && !cur.fixed) S.mistakes[id] = { ...cur, t: now(), fixed: true };
  else return;
  save();
}

const pendingIds = () => Object.entries(S.pending).filter(([, p]) => !p.done).map(([id]) => id).sort();
function addPending(id) {
  if (S.pending[id] && !S.pending[id].done) return;
  S.pending[id] = { t: now(), done: false };
  save();
}
function removePending(id) {
  if (!S.pending[id] || S.pending[id].done) return;
  S.pending[id] = { t: now(), done: true };
  save();
}

const setCard = (word, card) => { S.srs[wkey(word)] = { ...card, t: now() }; };
const isWeak = (card) => Boolean(card) && ((card.lapses || 0) > 0 || (card.ease ?? 2.5) < WEAK_EASE);
const isDone = (date, id) => Boolean(S.done[date]?.[id]);
const markDone = (date, id) => { (S.done[date] ||= {})[id] = now(); touch(); };

function logPractice(mode, ok) {
  const day = (S.practice[today()] ||= {});
  const [right, total] = day[mode] || [0, 0];
  day[mode] = [right + (ok ? 1 : 0), total + 1];
  touch();
  save();
}

function streak() {
  let d = today();
  if (!S.activity[d]) d = core.addDays(d, -1);
  let n = 0;
  while (S.activity[d]) { n += 1; d = core.addDays(d, -1); }
  return n;
}

// --- Sync -----------------------------------------------------------------------------------

function scheduleSync() {
  if (!sync.loadConfig().gistId) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(), SYNC_DELAY_MS);
}

// Pull, merge and push. Resolves true when the merge changed this device's data.
function syncNow({ manual = false } = {}) {
  const cfg = sync.loadConfig();
  if (!cfg.token || !cfg.gistId || !ME) return Promise.resolve(false);
  if (syncing) return syncing;
  const slug = ME.slug;
  const file = sync.fileFor(slug);
  clearTimeout(syncTimer);
  syncing = (async () => {
    try {
      const before = core.syncDoc(S);
      const files = await sync.readMany(cfg.token, cfg.gistId, [file, sync.feedbackFor(slug), sync.advisorFor(slug)]);
      const raw = files[file];
      const fb = files[sync.feedbackFor(slug)];
      if (fb && typeof fb === 'object' && !core.sameDoc(fb, FEEDBACK)) {
        FEEDBACK = fb;
        try { localStorage.setItem(feedbackKey(), JSON.stringify(fb)); } catch { /* storage blocked */ }
        toast('老師批改好了，到寫作區看看。');
      }
      const adv = files[sync.advisorFor(slug)];
      if (adv && typeof adv === 'object' && !core.sameDoc(adv, ADVISOR)) {
        ADVISOR = adv;
        try { localStorage.setItem(advisorKey(slug), JSON.stringify(adv)); } catch { /* storage blocked */ }
      }
      if (ME?.slug !== slug) return false; // the profile was switched meanwhile
      const remote = raw ? core.syncDoc(core.migrateState(raw)) : null;
      // Merge again with S: answers given while the request was in flight must not be lost.
      const merged = core.mergeDocs(remote ? core.mergeDocs(before, remote) : before, core.syncDoc(S));
      Object.assign(S, merged);
      persist();
      if (!remote || !core.sameDoc(merged, remote)) await sync.write(cfg.token, cfg.gistId, file, merged);
      dirty = false;
      sync.saveConfig({ ...sync.loadConfig(), last: now(), error: '' });
      return !core.sameDoc(merged, before);
    } catch (err) {
      if (sync.loadConfig().token) sync.saveConfig({ ...sync.loadConfig(), error: err.message });
      if (manual) toast(err.message);
      return false;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

function paintSyncLine() {
  const el = document.getElementById('sync-line');
  if (!el) return;
  const cfg = sync.loadConfig();
  el.classList.toggle('bad', !cfg.gistId || Boolean(cfg.error));
  if (!cfg.gistId) {
    put(el, '這台裝置還沒開啟同步，進度不會和其他裝置共用・', h('a', { href: '#/settings' }, '去設定'));
  } else if (cfg.error) {
    put(el, `同步失敗：${cfg.error}・`, h('a', { href: '#/settings' }, '查看'));
  } else {
    put(el, cfg.last ? `已同步・${formatTime(cfg.last)}` : '同步中…');
  }
}

let updateReady = false;

// Pages without anything half-typed: safe to re-render or reload.
function isIdleRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return !parts.length || (parts[0] === 'l' && parts.length === 2) || ['progress', 'archive', 'history'].includes(parts[0]);
}

function refreshIfIdle() {
  if (isIdleRoute()) route(); else updateBadge();
}

// --- Data -----------------------------------------------------------------------------------

let PROFILES = [];
let FEEDBACK = {};
let DICT_CACHE = {}; // letter -> {word: [ipa, zh, en] | base word}

// The vocabulary deck: every lesson's words plus the words the learner saved from the dictionary.
const deck = () => [...DECK, ...Object.values(S.words || {}).map((w) => ({ pos: '', example_zh: '', audio: {}, ...w }))]; // {date: teacher's correction}, written only by the grading job
const feedbackKey = () => `english-daily:feedback:${ME.slug}`;
function loadFeedback() {
  try { return JSON.parse(localStorage.getItem(feedbackKey()) || '{}') || {}; } catch { return {}; }
}

// {date: report} from the learning advisor (written by the daily lesson job, read-only here).
let ADVISOR = {};
const advisorKey = (slug) => `english-daily:advisor:${slug}`;
function loadAdvisor(slug) {
  try { return JSON.parse(localStorage.getItem(advisorKey(slug)) || '{}') || {}; } catch { return {}; }
}
let CHANGELOG = [];
const SEEN_KEY = 'english-daily:seen-release';

const seenRelease = () => { try { return localStorage.getItem(SEEN_KEY) || ''; } catch { return ''; } };

function paintBell() {
  $('#bell .dot').hidden = !CHANGELOG.length || CHANGELOG[0].version === seenRelease();
}

// The bell: every release with what changed, newest first. Opening it marks everything read.
function openUpdates() {
  const seen = seenRelease();
  showSheet(
    h('p', { class: 'sheet-word' }, '最新更新'),
    h('div', { class: 'releases' }, CHANGELOG.map((r) => h('section', { class: `release${r.version > seen ? ' new' : ''}` },
      h('p', { class: 'release-date' }, formatDate(r.date), r.version > seen ? h('span', { class: 'tag' }, '新') : null),
      h('ul', {}, r.items_zh.map((x) => h('li', {}, x)))))));
  try { localStorage.setItem(SEEN_KEY, CHANGELOG[0]?.version || ''); } catch { /* storage blocked */ }
  paintBell();
}
let INDEX = [];
let DECK = [];
const lessonCache = new Map();
let poolPromise;

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`讀取 ${url} 失敗（${res.status}）`);
  return res.json();
}

async function lesson(date) {
  if (!lessonCache.has(date)) {
    lessonCache.set(date, getJSON(`${dataBase()}/lessons/${date}.json`).then((L) => { speech.addClips(L.audio); return L; }));
  }
  const L = await lessonCache.get(date);
  backfillResults(L);
  return L;
}

// Score answers that have no result yet: answers given before scores were recorded, or synced
// from a device running an older version. Every device computes the same values.
function backfillResults(L) {
  const answers = S.answers[L.date];
  if (!answers) return;
  const res = (S.results[L.date] ||= {});
  let added = 0;
  const v = (key) => answers[key]?.v;
  const score = (key, value) => {
    if (res[key] || typeof value !== 'number' || !Number.isFinite(value)) return;
    res[key] = { s: Math.round(value * 1000) / 1000, t: answers[key]?.t || 0 };
    added += 1;
  };
  const questions = (kind, items) => (items || []).forEach((item, i) => {
    const a = v(`${kind}.${i}`);
    if (a != null) score(`${kind}.${i}`, (item.type === 'fill' ? core.checkFill(item, a) : a === item.answer) ? 1 : 0);
  });
  const spoken = (prefix, sentences) => (sentences || []).forEach((sentence, i) => {
    const a = v(`${prefix}.${i}`);
    if (typeof a === 'string' && a && a !== 'quiet') score(`${prefix}.${i}`, core.alignWords(sentence, a).score);
  });
  questions('read', L.reading.questions);
  questions('listen', L.listening.questions);
  questions('grammar', L.grammar.exercises);
  questions('review', L.grammar.review?.exercises);
  questions('ch.read', L.challenge?.reading.questions);
  questions('ch.listen', L.challenge?.listening.questions);
  spoken('dict', L.listening.dictation);
  spoken('ch.dict', L.challenge?.listening.dictation);
  spoken('shadow', L.speaking.shadowing);
  L.translation.forEach((t, i) => {
    const a = v(`trans.${i}`);
    if (typeof a === 'string' && a) score(`trans.${i}`, translationScore(t, a));
  });
  if (v('write.submitted') && typeof v('write.draft') === 'string') {
    const checks = writingChecks(L, v('write.draft'));
    score('write.submitted', checks.filter((c) => c.ok).length / checks.length);
  }
  if (added) save();
}

function practicePool() {
  poolPromise ||= getJSON(`${dataBase()}/practice.json`)
    .then((pool) => {
      for (const x of [...pool.sentences, ...pool.translate]) if (x.audio) speech.addClips({ [x.en]: x.audio });
      return pool;
    })
    .catch((err) => { poolPromise = null; throw err; });
  return poolPromise;
}

const currentLessonDate = () => (INDEX.find((x) => x.date <= today()) || INDEX[INDEX.length - 1])?.date;
const entryFor = (date) => INDEX.find((x) => x.date === date) || {};
const latestCoach = () => INDEX.find((x) => x.date <= today() && x.coach)?.coach || null;
const dataBase = () => `data/u/${ME.slug}`;

// Load (or switch to) the chosen learner's lessons and local progress.
async function loadUserData() {
  S = loadState();
  FEEDBACK = loadFeedback();
  ADVISOR = loadAdvisor(ME.slug);
  PEOPLE.clear();
  lessonCache.clear();
  poolPromise = null;
  [{ lessons: INDEX }, DECK] = await Promise.all([getJSON(`${dataBase()}/index.json`), getJSON(`${dataBase()}/vocab.json`)]);
  for (const v of DECK) speech.addClips(v.audio);
}

const LEGACY_KEY = 'english-daily:v1'; // progress from before profiles: it belonged to the first learner

async function chooseProfile(profile) {
  ME = { slug: profile.slug, name: profile.name };
  try {
    localStorage.setItem(ME_KEY, JSON.stringify(ME));
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy && profile.slug === PROFILES[0]?.slug && !localStorage.getItem(storeKey())) {
      localStorage.setItem(storeKey(), legacy);
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch { /* storage blocked */ }
  await loadUserData();
  location.hash = '#/';
  await route();
  syncNow().then((changed) => { if (changed) refreshIfIdle(); else paintSyncLine(); });
}

function reviewQueue() {
  const t = today();
  const due = deck().filter((v) => core.isDue(S.srs[wkey(v.word)], t))
    .sort((a, b) => S.srs[wkey(a.word)].due.localeCompare(S.srs[wkey(b.word)].due));
  const log = S.reviewLog[t] || { reviewed: 0, introduced: 0 };
  const room = Math.max(0, S.settings.newPerDay - log.introduced);
  // The current lesson's words are introduced by its vocabulary section, not by review.
  const fresh = deck().filter((v) => !S.srs[wkey(v.word)] && v.date < currentLessonDate()).slice(0, room);
  return [...due.map((v) => ({ v, isNew: false })), ...fresh.map((v) => ({ v, isNew: true }))];
}

// --- DOM helpers ----------------------------------------------------------------------------

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

function icon(name) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = ICONS[name];
  return span;
}

const $ = (sel) => document.querySelector(sel);

// Replace an element's children, skipping null/false. The DOM's own replaceChildren() would
// turn a null into the text "null".
function put(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
}
const pct = (x) => `${Math.round(x * 100)}%`;
const randomItem = (list) => list[Math.floor(Math.random() * list.length)];

function formatDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}月${d}日 星期${WEEKDAYS[wd]}`;
}

function formatTime(ms) {
  const d = new Date(ms);
  const date = core.localDate(d) === today() ? '今天' : formatDate(core.localDate(d));
  return `${date} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

function showSheet(...nodes) {
  const sheet = $('#sheet');
  put(sheet, h('div', { class: 'sheet-inner' },
    h('button', { class: 'sheet-close', type: 'button', 'aria-label': '關閉', onclick: hideSheet }, '×'), ...nodes));
  sheet.hidden = false;
}
function hideSheet() { $('#sheet').hidden = true; }

async function copyText(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    showSheet(h('p', {}, '無法自動複製，請長按下面的文字全選複製：'), h('textarea', { class: 'field', rows: 8, readonly: true }, text));
  }
}

const ttsOpts = (extra = {}) => ({ voice: speech.voicePair(S.settings.voice)[0], rate: S.settings.rate, ...extra });

function sayBtn(text, label, rate) {
  if (!speech.canSpeak(text)) return null;
  return h('button', {
    class: label ? 'chip-btn' : 'icon-btn', type: 'button', 'aria-label': label || '播放發音',
    onclick: (e) => { e.stopPropagation(); speech.say(text, ttsOpts(rate ? { rate } : {})); },
  }, icon(rate ? 'turtle' : 'speaker'), label || null);
}
const slowBtn = (text) => sayBtn(text, '慢速', SLOW_RATE);

function playButton(label, run, available = speech.ttsSupported()) {
  if (!available) return h('span', { class: 'muted' }, '這個瀏覽器不支援朗讀');
  const btn = h('button', { class: 'btn play', type: 'button' });
  let playing = false;
  const paint = () => {
    put(btn, icon(playing ? 'stop' : 'play'), playing ? '停止' : label);
    btn.classList.toggle('on', playing);
  };
  btn.addEventListener('click', async () => {
    if (playing) { speech.stop(); return; }
    playing = true;
    paint();
    try { await run(); } finally { playing = false; paint(); }
  });
  paint();
  return btn;
}

function rateToggle() {
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '語速' });
  const paint = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.rate) === S.settings.rate));
  for (const r of RATES) {
    seg.append(h('button', { type: 'button', 'data-rate': r, onclick: () => { S.settings.rate = r; persist(); paint(); } }, `${r}×`));
  }
  paint();
  return seg;
}

function micButton({ continuous = false, label, onText, onDone }) {
  const btn = h('button', { class: 'btn mic', type: 'button' });
  let session = null;
  const paint = () => {
    put(btn, icon(session ? 'stop' : 'mic'), session ? (continuous ? '說完了' : '聆聽中・按此結束') : label);
    btn.classList.toggle('on', Boolean(session));
  };
  btn.addEventListener('click', async () => {
    if (session) { session.stop(); return; }
    try {
      session = speech.listen({ continuous, onText });
      paint();
      onDone(await session.done);
    } catch (err) {
      toast(err.message);
    } finally {
      session = null;
      paint();
    }
  });
  paint();
  return btn;
}

function diffView(result) {
  return h('p', { class: 'diff' }, result.words.map((w) => [h('span', { class: w.ok ? 'w-ok' : 'w-miss' }, w.word), ' ']));
}

function scoreLine(score) {
  const note = score >= PASS ? '很好！' : score >= 0.7 ? '不錯，紅字的部分再練一次。' : '再聽一次，跟著節奏慢慢念。';
  return h('p', { class: 'score' }, h('strong', {}, `符合度 ${pct(score)}`), `　${note}`);
}

// A sentence box that grows with the text (dictation): Enter submits, so no line breaks.
function sentenceField(placeholder, onEnter) {
  const area = h('textarea', {
    class: 'field sentence', rows: 2, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder,
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } },
    oninput: () => { area.style.height = 'auto'; area.style.height = `${area.scrollHeight}px`; },
  });
  return area;
}

function textField(placeholder, onEnter) {
  return h('input', {
    class: 'field', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder,
    onkeydown: (e) => { if (e.key === 'Enter') onEnter(); },
  });
}

// Wrap vocabulary in tappable buttons: blue underline for new words, dotted for known ones.
function highlight(text, items) {
  const hits = core.findPhrases(text, items.map((x) => x.v.word));
  const out = [];
  let at = 0;
  for (const hit of hits) {
    const { v, old } = items[hit.index];
    const meta = [v.pos, v.ipa].filter(Boolean).join('　') + (old && v.date ? `　・${formatDate(v.date)} 學過` : '');
    out.push(text.slice(at, hit.start));
    out.push(h('button', {
      class: old ? 'vw old' : 'vw', type: 'button',
      onclick: (e) => {
        e.stopPropagation();
        showSheet(
          h('p', { class: 'sheet-word' }, v.word, ' ', sayBtn(v.word)),
          meta.trim() ? h('p', { class: 'meta' }, meta.trim()) : null,
          h('p', { class: 'zh-big' }, v.zh),
          v.definition ? h('p', { class: 'def' }, v.definition) : null);
      },
    }, text.slice(hit.start, hit.end)));
    at = hit.end;
  }
  out.push(text.slice(at));
  return out;
}

const vocabItems = (L) => [
  ...L.vocab.map((v) => ({ v: { ...v, date: L.date }, old: false })),
  ...deck().filter((v) => v.date < L.date).map((v) => ({ v, old: true })),
];

// --- Dictionary -----------------------------------------------------------------------------

const WORD_CHARS = /[A-Za-z'’-]/;
const LOOKUP_IN = '.reading, .said, .example, .sample, .shadow-text, .prompt-q, .q-text, .ref, .fixed, .orig, .def, .heard';

async function dictLetter(letter) {
  if (!DICT_CACHE[letter]) {
    DICT_CACHE[letter] = getJSON(`data/dict/${letter}.json`).catch(() => ({}));
  }
  return DICT_CACHE[letter];
}

// Look a word up offline (ECDICT subset), following inflections to the base word; falls back to
// a free online dictionary (English only) for words outside the subset.
async function lookup(raw) {
  const word = raw.toLowerCase().replace(/’/g, "'").replace(/^[^a-z]+|[^a-z]+$/g, '');
  if (!word) return null;
  const book = await dictLetter(word[0]);
  let entry = book[word];
  let base = word;
  if (typeof entry === 'string') { base = entry; entry = (await dictLetter(base[0]))[base]; }
  if (Array.isArray(entry)) return { word, base, ipa: entry[0], zh: entry[1], en: entry[2] };
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const meaning = data[0]?.meanings?.[0];
    return { word, base: word, ipa: data[0]?.phonetic || '', zh: '', en: meaning ? `${meaning.partOfSpeech}: ${meaning.definitions?.[0]?.definition || ''}` : '' };
  } catch { return null; }
}

// The word under a tap, from the text node at that point.
function wordAtPoint(x, y) {
  const range = document.caretRangeFromPoint?.(x, y) || (document.caretPositionFromPoint && ((p) => p && { startContainer: p.offsetNode, startOffset: p.offset })(document.caretPositionFromPoint(x, y)));
  const node = range?.startContainer;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent;
  let a = range.startOffset;
  let b = a;
  while (a > 0 && WORD_CHARS.test(text[a - 1])) a -= 1;
  while (b < text.length && WORD_CHARS.test(text[b])) b += 1;
  const word = text.slice(a, b);
  if (!/[A-Za-z]/.test(word)) return null;
  const sentence = (text.match(/[^.!?]*[.!?]?/g) || []).find((seg) => text.indexOf(seg) <= a && text.indexOf(seg) + seg.length >= b) || text;
  return { word, sentence: sentence.trim().slice(0, 200) };
}

async function openDictionary(word, sentence) {
  showSheet(h('p', { class: 'sheet-word' }, word), h('p', { class: 'muted' }, '查字典中…'));
  const hit = await lookup(word);
  if (!hit) { showSheet(h('p', { class: 'sheet-word' }, word), h('p', { class: 'muted' }, '字典裡找不到這個字（可能是人名或縮寫）。')); return; }
  const key = wkey(hit.base);
  const known = deck().some((v) => wkey(v.word) === key);
  const addBtn = h('button', {
    class: 'btn', type: 'button',
    onclick: () => {
      S.words[key] = { word: hit.base, ipa: hit.ipa, zh: hit.zh || hit.en, definition: hit.en, example: sentence, date: today(), t: now() };
      if (!S.srs[key]) setCard(hit.base, { ...core.newCard(today()), due: core.addDays(today(), 1) });
      save();
      updateBadge();
      put(addBtn, icon('check'), '已加入單字本');
      addBtn.disabled = true;
    },
  }, '加入我的單字本');
  showSheet(
    h('p', { class: 'sheet-word' }, hit.base, hit.base !== hit.word ? h('small', { class: 'muted' }, `　（${hit.word} 的原形）`) : null, ' ', sayBtn(hit.base)),
    hit.ipa ? h('p', { class: 'meta' }, `/${hit.ipa.replace(/^\/|\/$/g, '')}/`) : null,
    hit.zh ? h('p', { class: 'zh-big' }, hit.zh) : null,
    hit.en ? h('p', { class: 'def' }, hit.en) : null,
    h('div', { class: 'row' }, known ? h('span', { class: 'muted' }, '已經在你的單字本裡') : addBtn));
}

// --- Questions ------------------------------------------------------------------------------

function mcq(item, store, onResult) {
  const box = h('div', { class: 'q' });
  const render = () => {
    const chosen = store.get();
    const answered = chosen != null;
    put(box, 
      h('p', { class: 'q-text' }, item.q),
      h('div', { class: 'options' }, item.options.map((option, j) => h('button', {
        type: 'button',
        class: `opt${!answered ? '' : j === item.answer ? ' right' : j === chosen ? ' wrong' : ' dim'}`,
        disabled: answered,
        onclick: () => { store.set(j, j === item.answer); onResult?.(j === item.answer); render(); },
      }, option))),
      answered ? h('p', { class: `explain ${chosen === item.answer ? 'ok' : 'bad'}` },
        chosen === item.answer ? '答對了。' : '答錯了。', item.explain_zh) : null);
  };
  render();
  return box;
}

function fillQ(item, store, onResult) {
  const box = h('div', { class: 'q' });
  const [before, after] = item.q.split('___');
  const render = () => {
    const given = store.get();
    if (given == null) {
      const submit = () => {
        if (!input.value.trim()) return;
        const ok = core.checkFill(item, input.value);
        store.set(input.value.trim(), ok);
        onResult?.(ok);
        render();
      };
      const input = h('input', {
        class: 'blank', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': '填空',
        onkeydown: (e) => { if (e.key === 'Enter') submit(); },
      });
      put(box, h('p', { class: 'q-text' }, before, input, after),
        h('button', { class: 'btn', type: 'button', onclick: submit }, '確認'));
    } else {
      const ok = core.checkFill(item, given);
      put(box, 
        h('p', { class: 'q-text' }, before, h('span', { class: `filled ${ok ? 'ok' : 'bad'}` }, given), after),
        h('p', { class: `explain ${ok ? 'ok' : 'bad'}` }, ok ? '答對了。' : `正確答案：${item.answer}。`, item.explain_zh));
    }
  };
  render();
  return box;
}

const exercise = (item, store, onResult) => (item.type === 'fill' ? fillQ : mcq)(item, store, onResult);

function questionList(L, kind, items) {
  return h('ol', { class: 'questions' }, items.map((item, i) => h('li', { 'data-ans': `${L.date}|${kind}.${i}` },
    exercise(item, answerStore(L.date, `${kind}.${i}`), (ok) => recordMistake({ date: L.date, kind, i }, ok)))));
}

// --- Shared blocks --------------------------------------------------------------------------

function readingBlock(L, reading, items, kind, accent) {
  return [
    h('div', { class: 'toolbar' }, playButton('朗讀全文', () => speech.sayAll(reading.paragraphs, ttsOpts()),
      speech.ttsSupported() || reading.paragraphs.every(speech.hasClip)), rateToggle()),
    accent ? h('p', { class: 'hint' }, `朗讀：${accent}口音`) : null,
    h('div', { class: 'reading' }, reading.paragraphs.map((p) => h('p', {}, highlight(p, items)))),
    h('p', { class: 'hint' }, '藍色底線是新的字，灰色虛線是以前學過的字。點任何一個英文字都可以查字典，並加入單字本。'),
    h('h2', { class: 'section-title' }, '閱讀理解'),
    questionList(L, kind, reading.questions),
  ];
}

function dictationItem(date, key, n, sentence) {
  const out = h('div');
  const show = (value) => {
    const r = core.alignWords(sentence, value);
    put(out, diffView(r), scoreLine(r.score));
  };
  const check = () => {
    const value = input.value.trim();
    if (!value) return;
    setAns(date, key, value, core.alignWords(sentence, value).score);
    show(value);
  };
  const input = sentenceField('打出你聽到的句子', check);
  const prev = ans(date, key);
  if (prev) { input.value = prev; show(prev); }
  return h('div', { class: 'card', 'data-ans': `${date}|${key}` },
    h('div', { class: 'row' }, h('span', { class: 'num' }, `${n}`), sayBtn(sentence, '播放'), slowBtn(sentence)),
    input,
    h('button', { class: 'btn', type: 'button', onclick: check }, '對答案'),
    out);
}

// Dialogue with a hidden transcript, comprehension questions and dictation. `prefix` is '' for
// the main lesson and 'ch.' for the challenge, so their answers are kept apart.
function listeningBlock(L, data, prefix) {
  const lines = data.lines;
  const voices = () => speech.voicePair(S.settings.voice);
  const transcript = h('ol', { class: 'dialogue concealed' }, lines.map((line) => h('li', {
    class: 'line', onclick: () => speech.sayLines([line], { voices: voices(), rate: S.settings.rate }),
  }, h('span', { class: 'who' }, line.name), h('span', { class: 'said' }, line.text))));
  const showBtn = h('button', {
    class: 'btn subtle', type: 'button',
    onclick: () => {
      const hidden = transcript.classList.toggle('concealed');
      showBtn.textContent = hidden ? '顯示對話稿' : '隱藏對話稿';
    },
  }, '顯示對話稿');
  const mark = (i) => transcript.querySelectorAll('.line').forEach((el, k) => el.classList.toggle('playing', k === i));
  const names = { A: lines.find((l) => l.speaker === 'A')?.name, B: lines.find((l) => l.speaker === 'B')?.name };
  return [
    h('div', { class: 'toolbar' },
      playButton('播放對話', () => speech.sayLines(lines, { voices: voices(), rate: S.settings.rate, onLine: mark }),
        speech.ttsSupported() || lines.every((l) => l.audio)),
      rateToggle(), showBtn),
    data.accents ? h('p', { class: 'hint' }, `口音：${names.A} ${data.accents.A}・${names.B} ${data.accents.B}`) : null,
    transcript,
    h('h2', { class: 'section-title' }, '聽力理解'),
    questionList(L, `${prefix}listen`, data.questions),
    h('h2', { class: 'section-title' }, '聽寫 Dictation'),
    h('p', { class: 'hint' }, '按播放聽句子，把聽到的英文打出來。聽不清楚可以按「慢速」。'),
    data.dictation.map((s, i) => dictationItem(L.date, `${prefix}dict.${i}`, i + 1, s)),
  ];
}

// --- Sections -------------------------------------------------------------------------------

function vocabSection(L) {
  const list = h('div', { class: 'cards' }, L.vocab.map((v) => h('article', { class: 'card vocab' },
    h('div', { class: 'vocab-head' }, h('h3', { class: 'word' }, v.word), sayBtn(v.word)),
    h('p', { class: 'meta' }, `${v.pos}　${v.ipa}`),
    h('p', { class: 'zh hideable' }, v.zh),
    h('p', { class: 'def' }, v.definition),
    h('p', { class: 'example' }, v.example, ' ', sayBtn(v.example)),
    h('p', { class: 'zh-sub hideable' }, v.example_zh))));
  list.addEventListener('click', (e) => e.target.closest('.hideable')?.classList.toggle('peek'));
  const toggle = h('button', {
    class: 'btn subtle', type: 'button',
    onclick: () => {
      const on = list.classList.toggle('hide-zh');
      toggle.textContent = on ? '顯示中文' : '遮住中文自我測驗';
    },
  }, '遮住中文自我測驗');
  return [
    h('h1', { class: 'title' }, `今天的 ${L.vocab.length} 個單字`),
    h('p', { class: 'lede' }, '先聽發音、讀例句。完成這一節後，這些單字會進入間隔複習。'),
    h('div', { class: 'toolbar' }, toggle),
    list,
  ];
}

function readSection(L) {
  return [h('h1', { class: 'title' }, L.reading.title), readingBlock(L, L.reading, vocabItems(L), 'read', L.accents?.narrator)];
}

// Grammar diagrams: a formula drawn as blocks, a past–now–future timeline, one card per usage
// with its own examples, and wrong/right pairs. Lessons before 2026-11-08 fall back to text.
const formula = (form) => h('div', { class: 'formula' }, core.formulaParts(form).map((p) =>
  h('span', { class: `fx ${p.kind}` }, p.text)));

const exampleLine = (x) => h('li', {},
  h('p', { class: 'example' }, x.en, ' ', sayBtn(x.en)), h('p', { class: 'zh-sub' }, x.zh));

function timelineChart(items) {
  const pct = core.timelinePct;
  return h('div', { class: 'card tl' },
    h('p', { class: 'eyebrow' }, '時間圖'),
    h('div', { class: 'tl-body', style: `--now:${pct(0)}%` },
      items.map((t) => {
        const span = t.at == null;
        const from = pct(span ? t.from : t.at);
        const to = pct(span ? t.to : t.at);
        const mid = (from + to) / 2;
        const align = mid < 40 ? 'left' : mid > 60 ? 'right' : 'center';
        return h('div', { class: `tl-row hue${t.use ?? 'x'}` },
          h('p', { class: `tl-label ${align}` }, t.label),
          t.note_zh ? h('p', { class: `tl-note ${align}` }, t.note_zh) : null,
          h('div', { class: 'tl-track' }, span
            ? h('span', { class: 'tl-bar', style: `left:${from}%;width:${to - from}%` })
            : h('span', { class: 'tl-dot', style: `left:${from}%` })));
      })),
    h('div', { class: 'tl-axis' }, h('span', {}, '過去'), h('span', {}, '現在'), h('span', {}, '未來')));
}

function mistakeList(mistakes) {
  return h('div', { class: 'card' },
    h('p', { class: 'eyebrow' }, '常見錯誤'),
    h('ul', { class: 'mistakes' }, mistakes.map((m) => h('li', {},
      h('p', { class: 'wrong' }, h('b', {}, '✗'), ' ', m.wrong),
      h('p', { class: 'right' }, h('b', {}, '✓'), ' ', m.right),
      h('p', { class: 'why' }, m.why_zh)))));
}

function grammarGuide(g, examples) {
  const guide = g.guide;
  return [
    h('div', { class: 'key-point' }, h('span', { class: 'eyebrow' }, '重點'), h('p', {}, guide.key_zh)),
    guide.timeline?.length ? timelineChart(guide.timeline) : null,
    h('h2', { class: 'section-title' }, '怎麼用'),
    h('p', { class: 'fx-legend' }, h('span', { class: 'fx word' }, '實心'), '照著用　',
      h('span', { class: 'fx slot' }, '虛線'), '換成你的內容'),
    h('div', { class: 'uses' }, guide.uses.map((u, i) => {
      const own = (examples || []).filter((x) => x.use === i);
      return h('div', { class: `card use hue${i}` },
        h('p', { class: 'use-label' }, h('span', { class: 'use-n' }, String(i + 1)), u.label_zh),
        formula(u.form),
        u.signal ? h('p', { class: 'signal' }, '常見提示字：', u.signal) : null,
        own.length ? h('ul', { class: 'examples' }, own.map(exampleLine)) : null,
        u.note_zh ? h('p', { class: 'use-note' }, h('b', {}, '注意　'), u.note_zh) : null);
    })),
    guide.mistakes?.length ? mistakeList(guide.mistakes) : null,
  ];
}

function grammarSection(L) {
  const g = L.grammar;
  const loose = g.guide ? g.examples.filter((x) => x.use == null) : [];
  const review = g.review;
  return [
    h('h1', { class: 'title' }, g.point_zh),
    h('p', { class: 'lede en' }, g.point),
    g.guide
      ? [grammarGuide(g, g.examples),
        loose.length ? h('div', { class: 'card' }, h('p', { class: 'eyebrow' }, '更多例句'), h('ul', { class: 'examples' }, loose.map(exampleLine))) : null]
      : h('div', { class: 'card' },
        h('p', {}, g.explain_zh),
        h('p', { class: 'pattern' }, g.pattern),
        h('ul', { class: 'examples' }, g.examples.map(exampleLine))),
    h('h2', { class: 'section-title' }, '練習'),
    questionList(L, 'grammar', g.exercises),
    review ? [
      h('h2', { class: 'section-title' }, '文法複習'),
      h('div', { class: 'banner' }, h('p', {}, h('strong', {}, review.point_zh), `　${review.point}`),
        h('p', { class: 'muted' }, '這是你之前比較常錯的文法，再練幾題加深印象。')),
      review.guide ? h('details', { class: 'review-guide' },
        h('summary', {}, '先看重點圖解', review.from ? `（${review.from.slice(5).replace('-', '/')} 教過）` : ''),
        grammarGuide(review, null),
        review.from ? h('p', {}, h('a', { href: `#/l/${review.from}/grammar` }, '回到那天的課看例句 ›')) : null) : null,
      questionList(L, 'review', review.exercises),
    ] : null,
  ];
}

function listenSection(L) {
  return [
    h('h1', { class: 'title' }, L.listening.title),
    h('p', { class: 'lede' }, '先不看文字聽一遍並回答問題，再打開對話稿聽第二遍，最後做聽寫。'),
    listeningBlock(L, L.listening, ''),
  ];
}

const voiceMode = () => !S.settings.quiet && speech.sttSupported();

function laterButton(id) {
  return h('button', { class: 'btn subtle', type: 'button', onclick: () => { addPending(id); toast('已加到「口說待補」，回家再說。'); } }, '稍後再說');
}

function shadowItem(L, i, sentence) {
  const key = `shadow.${i}`;
  const id = `${L.date}|shadow|${i}`;
  const live = h('p', { class: 'live' });
  const result = h('div');
  const show = (said) => {
    if (said === 'quiet') {
      put(result, h('p', { class: 'muted' }, '已默念練習，記在口說待補。'));
      return;
    }
    const r = core.alignWords(sentence, said);
    put(result, h('p', { class: 'heard' }, '辨識到：', said || '（沒有聽到聲音，再試一次）'), diffView(r), scoreLine(r.score));
  };
  if (ans(L.date, key) != null) show(ans(L.date, key));
  const done = (said) => {
    live.textContent = '';
    setAns(L.date, key, said, said ? core.alignWords(sentence, said).score : undefined);
    if (said) removePending(id);
    show(said);
  };
  const action = voiceMode()
    ? [micButton({ label: '跟讀', onText: (t) => { live.textContent = t; }, onDone: done }), laterButton(id)]
    : h('button', { class: 'btn', type: 'button', onclick: () => { setAns(L.date, key, 'quiet'); addPending(id); show('quiet'); } }, '已默念 3 次');
  return h('div', { class: 'card', 'data-ans': `${L.date}|${key}` },
    h('p', { class: 'shadow-text' }, sentence),
    h('div', { class: 'row' }, sayBtn(sentence, '聽'), slowBtn(sentence), action),
    recordRow(sentence),
    live, result);
}

// Record yourself reading the sentence, then listen to yourself and the original in turn.
function recordRow(sentence) {
  if (!speech.recordingSupported() || S.settings.quiet) return null;
  let session = null;
  let url = null;
  const compare = h('div', { class: 'row' });
  const btn = h('button', { class: 'btn', type: 'button' });
  const paint = () => {
    put(btn, icon(session ? 'stop' : 'mic'), session ? '錄音中・按此停止' : url ? '再錄一次' : '錄下自己的聲音');
    btn.classList.toggle('on', Boolean(session));
    put(compare, url ? [
      h('button', { class: 'chip-btn', type: 'button', onclick: () => speech.playRecording(url) }, icon('play'), '聽自己'),
      h('button', { class: 'chip-btn', type: 'button', onclick: () => speech.say(sentence, ttsOpts()) }, icon('speaker'), '聽原音'),
      h('span', { class: 'muted' }, '輪流聽，比較語調和停頓。'),
    ] : null);
  };
  btn.addEventListener('click', async () => {
    if (session) { session.stop(); return; }
    try {
      session = await speech.record();
      paint();
      const got = await session.done;
      if (got) { if (url) URL.revokeObjectURL(url); url = got; } else toast('沒有錄到聲音，再試一次。');
    } catch (err) {
      toast(err.message);
    } finally {
      session = null;
      paint();
    }
  });
  paint();
  return h('div', { class: 'stack' }, btn, compare);
}

function promptItem(L, i, p) {
  const key = `prompt.${i}`;
  const id = `${L.date}|prompt|${i}`;
  const live = h('p', { class: 'live' });
  const result = h('div');
  const show = (text, spoken) => {
    const n = core.wordCount(text);
    const used = L.vocab.filter((v) => core.mentions(text, v.word)).map((v) => v.word);
    const advice = n < 30 ? '有點短：試著加上原因和一個例子。' : n < 60 ? '長度不錯，可以再多一點細節。' : '很完整！';
    put(result, 
      h('p', { class: 'heard' }, spoken ? '你說的：' : '你寫的：', text || '（沒有內容）'),
      h('p', { class: 'muted' }, `${n} 個字・${advice}`),
      h('p', { class: 'muted' }, `用到今天的單字：${used.join('、') || '還沒有，試著用一兩個'}`),
      h('details', { class: 'sample-box' }, h('summary', {}, '看範例答案'), h('p', {}, p.sample, ' ', sayBtn(p.sample))));
  };
  const prev = ans(L.date, key);
  if (prev != null) show(prev, voiceMode());
  let action;
  if (voiceMode()) {
    action = [micButton({
      continuous: true, label: '開始回答',
      onText: (t) => { live.textContent = t; },
      onDone: (said) => { live.textContent = ''; setAns(L.date, key, said); if (said) removePending(id); show(said, true); },
    }), laterButton(id)];
  } else {
    const box = h('textarea', { class: 'field', rows: 4, placeholder: '先用打字回答，回家再用說的' }, typeof prev === 'string' ? prev : '');
    action = [box, h('button', {
      class: 'btn', type: 'button',
      onclick: () => { if (!box.value.trim()) return; setAns(L.date, key, box.value.trim()); addPending(id); show(box.value.trim(), false); },
    }, '完成（記到口說待補）')];
  }
  return h('div', { class: 'card', 'data-ans': `${L.date}|${key}` },
    h('p', { class: 'prompt-q' }, p.question),
    h('p', { class: 'zh-sub' }, p.question_zh),
    h('ul', { class: 'hints' }, p.hints.map((x) => h('li', {}, x))),
    h('div', { class: 'stack' }, action),
    live, result);
}

function speakSection(L) {
  let banner;
  if (S.settings.quiet) {
    banner = h('div', { class: 'banner' }, h('p', {}, '安靜模式開著：口說題改成默念或打字，會記到「口說待補」，方便你之後補說。'),
      h('button', { class: 'btn subtle', type: 'button', onclick: () => setQuiet(false) }, '我現在可以說話'));
  } else if (!speech.sttSupported()) {
    banner = h('div', { class: 'banner' }, h('p', {}, '這個瀏覽器不支援語音辨識（請用 Chrome 或 iPhone 的 Safari），先用打字作答。'));
  } else {
    banner = h('div', { class: 'banner' }, h('p', {}, '戴耳機效果最好。按「跟讀」後直接念出句子，網頁會比對你念的內容；第一次使用要允許麥克風。'),
      h('button', { class: 'btn subtle', type: 'button', onclick: () => setQuiet(true) }, '我在外面，改安靜模式'));
  }
  return [
    h('h1', { class: 'title' }, '跟讀與回答'),
    banner,
    h('h2', { class: 'section-title' }, '跟讀 Shadowing'),
    h('p', { class: 'hint' }, '先聽一次，再模仿語調和停頓念出來。'),
    L.speaking.shadowing.map((s, i) => shadowItem(L, i, s)),
    h('h2', { class: 'section-title' }, '開口回答'),
    h('p', { class: 'hint' }, '每題試著說 30～60 秒，盡量用上今天的單字和句型。'),
    L.speaking.prompts.map((p, i) => promptItem(L, i, p)),
  ];
}

const translationScore = (t, value) => Math.max(...[t.en, ...(t.alt || [])].map((r) => core.alignWords(r, value).score));

function translationItem(date, i, t) {
  const key = `trans.${i}`;
  const input = h('textarea', { class: 'field', rows: 2, placeholder: '用英文寫出來' }, ans(date, key) || '');
  const out = h('div');
  const show = (value) => put(out, 
    h('p', { class: 'ref' }, '參考：', t.en, ' ', sayBtn(t.en)),
    t.alt?.length ? h('p', { class: 'muted' }, '也可以：', t.alt.join(' ／ ')) : null,
    h('p', { class: 'muted' }, `和參考答案的相似度 ${pct(translationScore(t, value))}（意思對就好，不必一字不差）`));
  const check = () => {
    const value = input.value.trim();
    if (!value) return;
    setAns(date, key, value, translationScore(t, value));
    show(value);
  };
  if (ans(date, key)) show(ans(date, key));
  return h('div', { class: 'card', 'data-ans': `${date}|${key}` }, h('p', { class: 'zh-big' }, t.zh), input,
    h('button', { class: 'btn', type: 'button', onclick: check }, '對照答案'), out);
}

function writingChecks(L, text) {
  const w = L.writing;
  const n = core.wordCount(text);
  return [
    { ok: n >= w.min_words && n <= w.max_words, label: `字數 ${n}（目標 ${w.min_words}～${w.max_words}）` },
    ...w.must_use.map((p) => ({ ok: core.mentions(text, p), label: `用到「${p}」` })),
  ];
}

function writingFeedback(L, text) {
  const w = L.writing;
  const used = L.vocab.filter((v) => core.mentions(text, v.word)).map((v) => v.word);
  return h('div', { class: 'feedback' },
    h('h3', {}, '自動檢查'),
    h('ul', { class: 'checks' }, writingChecks(L, text).map((c) => h('li', { class: c.ok ? 'ok' : 'bad' }, icon(c.ok ? 'check' : 'cross'), c.label))),
    h('p', { class: 'muted' }, `用到今天的單字：${used.join('、') || '還沒有'}`),
    h('h3', {}, '自我檢查'),
    h('ul', { class: 'selfcheck' }, w.checklist_zh.map((x) => h('li', {}, x))),
    h('h3', {}, '範例'),
    h('div', { class: 'sample' }, w.sample),
    h('div', { class: 'row' }, sayBtn(w.sample, '聽範例')),
    h('h3', {}, '想要逐句批改？'),
    h('p', { class: 'muted' }, '按下面的按鈕會複製「批改指令＋你的作文」，貼到你常用的 AI 聊天工具就能得到逐句修改。'),
    h('button', {
      class: 'btn', type: 'button',
      onclick: () => copyText(core.gradingPrompt({ level: L.level, task: w.task, mustUse: w.must_use, text }), '已複製，貼到 AI 聊天工具就能批改。'),
    }, '複製批改指令'));
}

function writeSection(L) {
  const w = L.writing;
  const area = h('textarea', { class: 'field essay', rows: 10, placeholder: 'Write your email here…', spellcheck: 'true', 'data-ans': `${L.date}|write.submitted` }, ans(L.date, 'write.draft') || '');
  const chips = h('div', { class: 'chips' });
  const count = h('span', { class: 'count' });
  const feedback = h('div');
  const paint = () => {
    const n = core.wordCount(area.value);
    count.textContent = `${n} / ${w.min_words}～${w.max_words} 字`;
    count.classList.toggle('ok', n >= w.min_words && n <= w.max_words);
    put(chips, ...w.must_use.map((p) => h('span', { class: `chip${core.mentions(area.value, p) ? ' on' : ''}` }, p)));
  };
  let timer;
  area.addEventListener('input', () => {
    paint();
    clearTimeout(timer);
    timer = setTimeout(() => setAns(L.date, 'write.draft', area.value), 400);
  });
  const submit = () => {
    if (core.wordCount(area.value) < 10) { toast('先寫幾句再交卷。'); return; }
    const checks = writingChecks(L, area.value);
    setAns(L.date, 'write.draft', area.value);
    setAns(L.date, 'write.submitted', true, checks.filter((c) => c.ok).length / checks.length);
    put(feedback, writingFeedback(L, area.value));
  };
  paint();
  if (ans(L.date, 'write.submitted')) put(feedback, writingFeedback(L, area.value));
  const teacher = ans(L.date, 'write.submitted') ? teacherFeedback(L.date) : null;
  return [
    h('h1', { class: 'title' }, '中翻英暖身'),
    L.translation.map((t, i) => translationItem(L.date, i, t)),
    h('h2', { class: 'section-title' }, '寫作任務'),
    h('div', { class: 'card' }, h('p', { class: 'prompt-q' }, w.task), h('p', { class: 'zh-sub' }, w.task_zh),
      h('p', { class: 'muted' }, '必須用到（用了會變藍）：'), chips),
    area,
    h('div', { class: 'row spread' }, count, h('button', { class: 'btn primary', type: 'button', onclick: submit }, '交卷，看回饋')),
    feedback,
    teacher,
  ];
}

// The native teacher's sentence-by-sentence correction, or where it stands.
function teacherFeedback(date) {
  const fb = FEEDBACK[date];
  if (!fb) {
    return h('div', { class: 'card' }, h('p', { class: 'coach-head' }, '老師批改中'),
      h('p', { class: 'muted' }, '每天 9、12、18、22 點批改，結果會出現在這裡（手機和電腦都看得到）。'));
  }
  return h('div', { class: 'card teacher' },
    h('p', { class: 'coach-head' }, `老師批改・${fb.score}/10`),
    h('p', {}, fb.overall_zh),
    fb.items?.length ? [h('h3', {}, '逐句修改'), h('ol', { class: 'corrections' }, fb.items.map((it) => h('li', {},
      h('p', { class: 'orig' }, it.original), h('p', { class: 'fixed' }, it.corrected, ' ', sayBtn(it.corrected)),
      h('p', { class: 'muted' }, it.note_zh))))] : h('p', { class: 'muted' }, '沒有需要改的句子。'),
    fb.better_zh?.length ? [h('h3', {}, '可以更道地'), h('ul', { class: 'plain' }, fb.better_zh.map((x) => h('li', {}, x)))] : null,
    fb.rewrite ? [h('h3', {}, '改寫版'), h('div', { class: 'sample' }, fb.rewrite), h('div', { class: 'row' }, sayBtn(fb.rewrite, '聽改寫版'))] : null,
    h('p', { class: 'muted' }, `批改時間：${fb.graded_at || ''}`));
}

const RENDER = { vocab: vocabSection, read: readSection, grammar: grammarSection, listen: listenSection, speak: speakSection, write: writeSection };

function completeSection(L, id) {
  markDone(L.date, id);
  if (id === 'vocab') {
    const tomorrow = core.addDays(today(), 1);
    for (const v of L.vocab) if (!S.srs[wkey(v.word)]) setCard(v.word, { ...core.newCard(today()), due: tomorrow });
  }
  save();
}

// --- Lesson pages ---------------------------------------------------------------------------

function stat(value, label) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-num' }, value), h('div', { class: 'stat-label' }, label));
}

function levelTag(level, change) {
  return h('span', { class: `level${change === 'up' ? ' up' : change === 'down' ? ' down' : ''}` },
    level, change === 'up' ? ' ↑' : change === 'down' ? ' ↓' : '');
}

function coachCard(coach) {
  if (!coach?.focus_zh?.length) return null;
  return h('div', { class: 'card coach' },
    h('p', { class: 'coach-head' }, '今天的加強重點'),
    h('ul', {}, coach.focus_zh.map((f) => h('li', {}, f))));
}

function challengeCard(L, allDone) {
  const C = L.challenge;
  if (!C) return null;
  const sub = `${C.reading.title}・${C.listening.title}`;
  if (isDone(L.date, 'challenge')) {
    return h('a', { class: 'card challenge done', href: `#/l/${L.date}/challenge` },
      h('strong', {}, icon('check'), `挑戰加練完成（${C.level}）`), h('span', { class: 'muted' }, sub));
  }
  if (!allDone) {
    return h('div', { class: 'card challenge locked' },
      h('strong', {}, icon('lock'), `挑戰加練（${C.level}）`), h('span', { class: 'muted' }, '做完今天的六節就會解鎖：比今天高一級的文章和聽力。'));
  }
  return h('a', { class: 'card challenge', href: `#/l/${L.date}/challenge` },
    h('strong', {}, icon('bolt'), `提早做完了？挑戰加練（${C.level}）`), h('span', { class: 'muted' }, `比今天高一級：${sub}`));
}

const SKILL_SECTION = { reading: 'read', listening: 'listen', grammar: 'grammar', speaking: 'speak', writing: 'write' };

// The section to do first: the weakest skill from the coach notes, else from local scores.
function suggestedSection(coach, done) {
  let skill = coach?.weak_skill;
  let reason = skill ? coach.focus_zh?.find((f) => f.includes(core.SKILL_ZH[skill])) : '';
  if (!skill) {
    const { stats } = core.skillStats(S.results);
    const weak = Object.entries(stats).filter(([, v]) => v.n >= 4 && v.acc < 0.8).sort((a, b) => a[1].acc - b[1].acc)[0];
    if (!weak) return null;
    skill = weak[0];
    reason = `最近${core.SKILL_ZH[skill]}的正確率 ${pct(weak[1].acc)}，先練最弱的最有效。`;
  }
  const section = SECTIONS.find((s) => s.id === SKILL_SECTION[skill]);
  return section && !done[section.id] ? { section, reason } : null;
}

const SECTION_IDS = SECTIONS.map((s) => s.id);
const sectionById = (id) => SECTIONS.find((s) => s.id === id) || null;

// Today's suggestion (weakest skill), only for the current lesson.
function suggestionFor(date) {
  return date === currentLessonDate() ? suggestedSection(entryFor(date).coach, S.done[date] || {}) : null;
}

function nextSectionOf(date, after = null) {
  return sectionById(core.nextSection(SECTION_IDS, S.done[date] || {}, suggestionFor(date)?.section.id, after));
}

async function homePage(date) {
  const L = await lesson(date);
  const entry = entryFor(date);
  const done = S.done[date] || {};
  const finished = SECTIONS.filter((s) => done[s.id]).length;
  const suggested = suggestionFor(date);
  const next = nextSectionOf(date);
  const isCurrent = date === currentLessonDate();
  const notToday = isCurrent && date !== today();
  const queue = reviewQueue();
  const pending = pendingIds();
  return h('div', { class: 'page' },
    h('p', { class: 'eyebrow' }, levelTag(L.level, entry.coach?.level_change), formatDate(date),
      notToday ? '・今天的新課還沒產生，先練最近一課' : '', isCurrent ? '' : '・過去的課',
      entry.qa ? h('button', {
        class: 'qa-badge', type: 'button',
        onclick: (e) => { e.stopPropagation(); showSheet(h('p', { class: 'sheet-word' }, '母語老師審核'), h('div', { class: 'qa-notes' }, entry.qa.split('\n').map((ln) => h('p', {}, ln.replace(/^- /, ''))))); },
      }, icon('check'), '母語老師已審核', ' ›') : null),
    h('h1', { class: 'headline' }, L.theme_zh),
    h('p', { class: 'lede' }, h('strong', {}, `${L.theme}. `), L.summary_zh),
    h('div', { class: 'stats' },
      stat(`${streak()}`, '連續天數'), stat(`${finished}/${SECTIONS.length}`, '今日進度'),
      stat(`${queue.length}`, '待複習單字'), stat(`${deck().length}`, '單字庫')),
    h('p', { class: 'sync-line', id: 'sync-line' }),
    isCurrent ? coachCard(entry.coach) : null,
    next
      ? h('a', { class: 'btn primary wide', href: `#/l/${date}/${next.id}` }, finished ? `繼續：${next.zh}` : '開始今天的課：單字')
      : h('p', { class: 'done-note' }, icon('check'), '這一課全部完成了！'),
    !S.profile?.t ? h('a', { class: 'card notice', href: '#/goals' },
      h('strong', {}, '告訴老師你的目標和興趣'), h('span', { class: 'muted' }, '花 30 秒選一選，之後的課會更貼近你想用英文的地方。')) : null,
    notesCard(),
    pending.length ? h('a', { class: 'card notice', href: `#/l/${pending[0].split('|')[0]}/speak` },
      h('strong', {}, `口說待補 ${pending.length} 題`), h('span', { class: 'muted' }, '在外面時先默念或打字的題目，回家花幾分鐘用說的補完。')) : null,
    suggested ? h('div', { class: 'card coach' }, h('p', { class: 'coach-head' }, `單字之後先做：${suggested.section.zh}`),
      h('p', { class: 'muted' }, suggested.reason)) : null,
    h('h2', { class: 'section-title' }, '今天的六節'),
    h('ul', { class: 'section-list' }, SECTIONS.map((s) => h('li', {},
      h('a', { href: `#/l/${date}/${s.id}`, class: done[s.id] ? 'done' : '' },
        h('span', { class: 'sec-name' }, s.zh, h('small', {}, s.en), s === suggested?.section ? h('span', { class: 'tag' }, '加強') : null),
        h('span', { class: 'sec-sub' }, s.sub(L)),
        h('span', { class: 'sec-meta' }, done[s.id] ? icon('check') : `${s.min} 分`))))),
    challengeCard(L, !next),
    queue.length ? h('a', { class: 'card notice', href: '#/review' },
      h('strong', {}, `複習 ${queue.length} 個單字`), h('span', { class: 'muted' }, '間隔複習：快忘記的時候再看一次，記得最牢。')) : null,
    !next ? h('a', { class: 'card notice', href: '#/practice' },
      h('strong', {}, '還想練？自由練習'), h('span', { class: 'muted' }, '聽寫、跟讀、單字、文法、翻譯，從學過的課隨機出題，不限題數。')) : null);
}

async function sectionPage(date, id) {
  const L = await lesson(date);
  const idx = SECTIONS.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error('找不到這一節');
  const s = SECTIONS[idx];
  const next = nextSectionOf(date, id);
  const finish = () => {
    completeSection(L, id);
    const then = nextSectionOf(date, id);
    location.hash = then ? `#/l/${date}/${then.id}` : `#/l/${date}`;
    if (!then) toast(L.challenge ? '今天的課完成了！挑戰加練已解鎖。' : '今天的課完成了，記得做單字複習！');
  };
  return h('div', { class: 'page' },
    h('nav', { class: 'crumbs' }, h('a', { href: `#/l/${date}` }, `‹ ${formatDate(date)}`), h('span', {}, `${idx + 1} / ${SECTIONS.length}`)),
    h('p', { class: 'eyebrow' }, `${s.zh}・${s.en}`),
    RENDER[id](L),
    h('div', { class: 'finish' },
      h('button', { class: 'btn primary wide', type: 'button', onclick: finish }, next ? `完成，下一節：${next.zh}` : '完成今天的課'),
      isDone(date, id) ? h('p', { class: 'muted center' }, '這一節已經完成過了') : null));
}

async function challengePage(date) {
  const L = await lesson(date);
  const C = L.challenge;
  if (!C) throw new Error('這一課沒有挑戰加練');
  const items = [
    ...C.glossary.map((g) => ({ v: { word: g.word, zh: g.zh, definition: g.definition || '' }, old: false })),
    ...[...L.vocab.map((v) => ({ ...v, date: L.date })), ...deck().filter((v) => v.date < L.date)].map((v) => ({ v, old: true })),
  ];
  const finish = () => {
    markDone(date, 'challenge');
    save();
    location.hash = `#/l/${date}`;
    toast('挑戰完成！還想練可以到「練習」。');
  };
  return h('div', { class: 'page' },
    h('nav', { class: 'crumbs' }, h('a', { href: `#/l/${date}` }, `‹ ${formatDate(date)}`), h('span', {}, levelTag(C.level))),
    h('p', { class: 'eyebrow' }, `挑戰加練・${C.level}`),
    h('h1', { class: 'title' }, C.reading.title),
    h('p', { class: 'lede' }, '比今天的課高一級：文章更長、對話更快更口語。這裡的答對率也會用來判斷什麼時候升級。'),
    readingBlock(L, C.reading, items, 'ch.read', L.accents?.challenge_narrator),
    h('h2', { class: 'section-title' }, `聽力：${C.listening.title}`),
    listeningBlock(L, C.listening, 'ch.'),
    h('div', { class: 'finish' },
      h('button', { class: 'btn primary wide', type: 'button', onclick: finish }, '完成挑戰'),
      isDone(date, 'challenge') ? h('p', { class: 'muted center' }, '已經完成過了') : null));
}

// --- Review ---------------------------------------------------------------------------------

function reviewPage() {
  const t = today();
  const queue = reviewQueue();
  const total = queue.length;
  const log = (S.reviewLog[t] ||= { reviewed: 0, introduced: 0 });
  const stage = h('div', { class: 'stage' });
  let pos = 0;

  const modeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '複習方式' },
    [['recognize', '看字想意思'], ['spell', '看意思拼字']].map(([mode, label]) => h('button', {
      type: 'button', class: S.settings.reviewMode === mode ? 'on' : '',
      onclick: () => { S.settings.reviewMode = mode; persist(); route(); },
    }, label)));

  const gradeButtons = (item, suggested) => {
    const card = S.srs[wkey(item.v.word)];
    const labels = ['忘了', '有點難', '記得', '太簡單'];
    return h('div', { class: 'grades' }, labels.map((label, g) => {
      const days = core.schedule(card, g, t).interval;
      return h('button', {
        type: 'button', class: `grade g${g}${suggested === g ? ' suggested' : ''}`, onclick: () => grade(item, g),
      }, h('strong', {}, label), h('small', {}, days ? `${days} 天後` : '等等再看'));
    }));
  };

  const progress = () => h('p', { class: 'muted' }, `${Math.min(pos + 1, queue.length)} / ${queue.length}`);

  const recognizeCard = (item) => {
    const v = item.v;
    const back = h('div', { class: 'back', hidden: true },
      h('p', { class: 'zh-big' }, v.zh), h('p', { class: 'def' }, v.definition),
      h('p', { class: 'example' }, v.example, ' ', sayBtn(v.example)), h('p', { class: 'zh-sub' }, v.example_zh),
      gradeButtons(item));
    const reveal = h('button', { class: 'btn primary wide', type: 'button', onclick: () => { back.hidden = false; reveal.hidden = true; } }, '顯示答案');
    return h('div', { class: 'flash' }, progress(), item.isNew ? h('span', { class: 'tag' }, '新字') : null,
      h('h2', { class: 'flash-word' }, v.word), h('p', { class: 'meta' }, `${v.pos}　${v.ipa}`),
      h('div', { class: 'row center' }, sayBtn(v.word, '發音')), reveal, back);
  };

  const spellCard = (item) => {
    const v = item.v;
    const result = h('div');
    const checkBtn = h('button', { class: 'btn primary wide', type: 'button', onclick: () => check() }, '檢查');
    const check = () => {
      if (!input.value.trim() || input.disabled) return;
      const ok = core.normalizeAnswer(input.value) === core.normalizeAnswer(v.word);
      input.disabled = true;
      checkBtn.hidden = true;
      put(result, 
        h('p', { class: `explain ${ok ? 'ok' : 'bad'}` }, ok ? '正確！' : `答案是 ${v.word}`),
        h('div', { class: 'row center' }, sayBtn(v.word, '發音')),
        h('p', { class: 'example' }, v.example),
        gradeButtons(item, ok ? 2 : 0));
    };
    const input = textField('輸入英文', check);
    return h('div', { class: 'flash' }, progress(), item.isNew ? h('span', { class: 'tag' }, '新字') : null,
      h('p', { class: 'zh-big' }, v.zh), h('p', { class: 'def' }, v.definition), h('p', { class: 'example' }, clozeOf(v)),
      input, checkBtn, result);
  };

  const grade = (item, g) => {
    const k = wkey(item.v.word);
    if (item.isNew && !S.srs[k]) log.introduced += 1;
    setCard(item.v.word, core.schedule(S.srs[k], g, t));
    log.reviewed += 1;
    touch();
    if (g === core.GRADE.again && !item.again) queue.push({ v: item.v, isNew: false, again: true });
    save();
    updateBadge();
    pos += 1;
    show();
  };

  const show = () => {
    if (pos >= queue.length) {
      put(stage, h('div', { class: 'flash' },
        h('p', { class: 'done-note' }, icon('check'), total ? '今天的單字複習完成了！' : '目前沒有要複習的單字。'),
        h('p', { class: 'muted center' }, `今天已複習 ${log.reviewed} 次。明天會依記憶狀況排出新的複習。`),
        h('a', { class: 'btn', href: '#/practice/vocab' }, '還想練？單字自由練習')));
      return;
    }
    const item = queue[pos];
    put(stage, S.settings.reviewMode === 'spell' ? spellCard(item) : recognizeCard(item));
  };
  show();

  return h('div', { class: 'page' },
    h('p', { class: 'eyebrow' }, '間隔複習・Review'),
    h('h1', { class: 'headline' }, total ? `今天要複習 ${total} 個單字` : '單字複習'),
    h('p', { class: 'lede' }, '依你對每個字的熟悉程度安排下一次出現的時間：記得越牢，間隔越長。'),
    h('div', { class: 'toolbar' }, modeSeg),
    stage,
    h('h2', { class: 'section-title' }, '錯題重練'),
    mistakesPanel());
}

function clozeOf(v) {
  const hit = core.findPhrases(v.example, [v.word])[0];
  return hit ? `${v.example.slice(0, hit.start)}_____${v.example.slice(hit.end)}` : v.example;
}

function pickMistake(L, m) {
  const items = {
    read: L.reading.questions, listen: L.listening.questions, grammar: L.grammar.exercises,
    review: L.grammar.review?.exercises, 'ch.read': L.challenge?.reading.questions, 'ch.listen': L.challenge?.listening.questions,
  }[m.kind];
  return items?.[m.i];
}

function mistakesPanel() {
  const list = activeMistakes();
  if (!list.length) return h('p', { class: 'muted' }, '目前沒有錯題。閱讀、文法、聽力答錯的題目會出現在這裡。');
  const box = h('div');
  const btn = h('button', {
    class: 'btn', type: 'button',
    onclick: async () => {
      btn.disabled = true;
      const rows = await Promise.all(list.map(async (m) => ({ m, item: pickMistake(await lesson(m.date), m) })));
      put(box, h('ol', { class: 'questions' }, rows.filter((r) => r.item).map(({ m, item }) => {
        let value = null;
        return h('li', {}, h('p', { class: 'muted' }, `${formatDate(m.date)}・${MISTAKE_LABEL[m.kind] || m.kind}`),
          exercise(item, { get: () => value, set: (v) => { value = v; } }, (ok) => { recordMistake(m, ok); if (ok) toast('答對了，已從錯題移除。'); }));
      })));
    },
  }, `重練錯題（${list.length} 題）`);
  box.append(btn);
  return box;
}

// --- Free practice --------------------------------------------------------------------------

// Press and drag a chip inside `container` to a new position (mouse or finger). `onDrop(from, to)`
// gets the chip's old and new index; a tap without movement still fires the chip's click.
let dragEndedAt = 0;
const justDragged = () => Date.now() - dragEndedAt < 400;

function dragToReorder(chip, container, onDrop) {
  chip.addEventListener('pointerdown', (e) => {
    if (chip.disabled || e.button > 0) return;
    const chips = () => [...container.querySelectorAll('.chip')];
    const from = chips().indexOf(chip);
    const start = { x: e.clientX, y: e.clientY };
    let ghost = null;
    let grab = null;
    const move = (ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
        const r = chip.getBoundingClientRect();
        grab = { x: start.x - r.left, y: start.y - r.top };
        ghost = chip.cloneNode(true);
        ghost.classList.add('drag-ghost');
        ghost.style.width = `${r.width}px`;
        document.body.append(ghost);
        chip.classList.add('drag-source');
      }
      ghost.style.left = `${ev.clientX - grab.x}px`;
      ghost.style.top = `${ev.clientY - grab.y}px`;
      // Place the chip before the first chip the pointer is ahead of, in reading order.
      let before = null;
      for (const c of chips()) {
        if (c === chip) continue;
        const r = c.getBoundingClientRect();
        const sameRow = ev.clientY >= r.top - 6 && ev.clientY <= r.bottom + 6;
        if (ev.clientY < r.top - 6 || (sameRow && ev.clientX < r.left + r.width / 2)) { before = c; break; }
      }
      if (chip.nextElementSibling !== before && chip !== before) container.insertBefore(chip, before);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (!ghost) return;
      ghost.remove();
      chip.classList.remove('drag-source');
      dragEndedAt = Date.now();
      onDrop(from, chips().indexOf(chip));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
}

// Pick a random item not shown in this round; with `weak`, half the picks come from it.
function picker() {
  const seen = new Set();
  return (list, weak = []) => {
    const from = weak.length && Math.random() < 0.5 ? weak : list;
    let fresh = from.filter((x) => !seen.has(x));
    if (!fresh.length) {
      from.forEach((x) => seen.delete(x));
      fresh = from;
    }
    const item = randomItem(fresh);
    seen.add(item);
    return item;
  };
}

function practiceCard(body, nextBtn) {
  return h('div', { class: 'card practice' }, body, h('div', { class: 'row' }, nextBtn));
}

async function practicePage(requested) {
  const mode = PRACTICE_MODES.some(([m]) => m === requested) ? requested : S.settings.practiceMode;
  if (S.settings.practiceMode !== mode) { S.settings.practiceMode = mode; persist(); }
  const pool = await practicePool();
  const pick = picker();
  const stage = h('div');
  const tally = h('p', { class: 'muted' }, '這一輪還沒作答');
  let right = 0;
  let total = 0;
  const counted = (ok) => {
    total += 1;
    if (ok) right += 1;
    tally.textContent = `這一輪：答對 ${right} / ${total}`;
    logPractice(mode, ok);
  };
  const coach = latestCoach();
  const weakPoints = new Set((coach?.weak_grammar || []).map((g) => g.point));
  const words = deck().filter((v) => v.date <= today());

  const nextButton = (play) => h('button', { class: 'btn primary', type: 'button', hidden: true, onclick: () => next(play) }, '下一題');

  const render = {
    dict: () => {
      const s = pick(pool.sentences);
      const nextBtn = nextButton(true);
      const out = h('div');
      const check = () => {
        if (!input.value.trim() || input.disabled) return;
        input.disabled = true;
        const r = core.alignWords(s.en, input.value);
        counted(r.score >= PASS);
        checkBtn.hidden = true;
        nextBtn.hidden = false;
        put(out, diffView(r), scoreLine(r.score), s.zh ? h('p', { class: 'zh-sub' }, s.zh) : null);
      };
      const input = sentenceField('打出你聽到的句子', check);
      const checkBtn = h('button', { class: 'btn', type: 'button', onclick: check }, '對答案');
      return { say: s.en, card: practiceCard([h('div', { class: 'row' }, sayBtn(s.en, '播放'), slowBtn(s.en)), input, out], [checkBtn, nextBtn]) };
    },
    shadow: () => {
      const s = pick(pool.sentences);
      const nextBtn = nextButton(false);
      nextBtn.hidden = false;
      const live = h('p', { class: 'live' });
      const out = h('div');
      const action = voiceMode()
        ? micButton({
          label: '跟讀', onText: (t) => { live.textContent = t; },
          onDone: (said) => {
            live.textContent = '';
            if (!said) { put(out, h('p', { class: 'muted' }, '沒有聽到聲音，再試一次。')); return; }
            const r = core.alignWords(s.en, said);
            counted(r.score >= PASS);
            put(out, h('p', { class: 'heard' }, '辨識到：', said), diffView(r), scoreLine(r.score));
          },
        })
        : h('span', { class: 'muted' }, '安靜模式：默念 3 次再按下一題');
      return { card: practiceCard([h('p', { class: 'shadow-text' }, s.en), s.zh ? h('p', { class: 'zh-sub' }, s.zh) : null,
        h('div', { class: 'row' }, sayBtn(s.en, '聽'), slowBtn(s.en), action), live, out], nextBtn) };
    },
    vocab: () => {
      const v = pick(words, words.filter((x) => isWeak(S.srs[wkey(x.word)])));
      const nextBtn = nextButton(false);
      const out = h('div');
      const check = () => {
        if (!input.value.trim() || input.disabled) return;
        input.disabled = true;
        const ok = core.normalizeAnswer(input.value) === core.normalizeAnswer(v.word);
        counted(ok);
        const card = S.srs[wkey(v.word)];
        if (!ok && card && card.due > today()) {
          setCard(v.word, { ...card, due: today() });
          save();
          updateBadge();
        }
        checkBtn.hidden = true;
        nextBtn.hidden = false;
        put(out, h('p', { class: `explain ${ok ? 'ok' : 'bad'}` }, ok ? '正確！' : `答案是 ${v.word}${card ? '，已加到今天的單字複習。' : ''}`),
          h('p', { class: 'example' }, v.example, ' ', sayBtn(v.example)));
      };
      const input = textField(`${v.word[0]}… 輸入英文`, check);
      const checkBtn = h('button', { class: 'btn', type: 'button', onclick: check }, '檢查');
      return { card: practiceCard([h('p', { class: 'zh-big' }, v.zh), h('p', { class: 'def' }, v.definition), h('p', { class: 'example' }, clozeOf(v)), input, out], [checkBtn, nextBtn]) };
    },
    grammar: () => {
      const g = pick(pool.grammar, pool.grammar.filter((x) => weakPoints.has(x.point)));
      const nextBtn = nextButton(false);
      let value = null;
      const q = exercise(g, { get: () => value, set: (v) => { value = v; } }, (ok) => { counted(ok); nextBtn.hidden = false; });
      return { card: practiceCard([h('p', { class: 'muted' }, g.point_zh, weakPoints.has(g.point) ? '・常錯' : ''), q], nextBtn) };
    },
    order: () => {
      const s = pick(orderable);
      const words = s.en.split(/\s+/);
      let bank = words.map((w, i) => ({ w, i }));
      for (let i = bank.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bank[i], bank[j]] = [bank[j], bank[i]]; }
      if (bank.every((b, k) => b.i === k)) bank.reverse();
      let chosen = [];
      const nextBtn = nextButton(false);
      const answer = h('div', { class: 'chips order-answer' });
      const pool_ = h('div', { class: 'chips' });
      const out = h('div');
      let locked = false;
      const paint = () => {
        put(answer, chosen.length ? chosen.map((b) => {
          const chip = h('button', {
            type: 'button', class: 'chip on', disabled: locked,
            onclick: () => { if (justDragged()) return; chosen = chosen.filter((x) => x !== b); bank.push(b); paint(); },
          }, b.w);
          dragToReorder(chip, answer, (from, to) => { const [moved] = chosen.splice(from, 1); chosen.splice(to, 0, moved); paint(); });
          return chip;
        }) : h('span', { class: 'muted' }, '點下面的字，排成正確的句子'));
        put(pool_, bank.map((b) => h('button', { type: 'button', class: 'chip', disabled: locked, onclick: () => { bank = bank.filter((x) => x !== b); chosen.push(b); paint(); } }, b.w)));
      };
      const check = () => {
        if (locked || chosen.length !== words.length) { if (!locked) toast('還有字沒放進去。'); return; }
        locked = true;
        const ok = chosen.every((b, k) => b.i === k);
        counted(ok);
        checkBtn.hidden = true;
        nextBtn.hidden = false;
        put(out, h('p', { class: `explain ${ok ? 'ok' : 'bad'}` }, ok ? '正確！' : '順序不對。正確的是：'),
          h('p', { class: 'example' }, s.en, ' ', sayBtn(s.en)), s.zh ? h('p', { class: 'zh-sub' }, s.zh) : null);
        paint();
      };
      const checkBtn = h('button', { class: 'btn', type: 'button', onclick: check }, '檢查');
      paint();
      return { card: practiceCard([s.zh ? h('p', { class: 'zh-big' }, s.zh) : h('p', { class: 'muted' }, '把這些字排成一句話'), answer,
        h('p', { class: 'hint' }, '按住已排好的字左右拖曳可以換位置；點一下拿回下面。'), pool_, out], [checkBtn, nextBtn]) };
    },
    trans: () => {
      const t = pick(pool.translate);
      const nextBtn = nextButton(false);
      const out = h('div');
      const input = h('textarea', { class: 'field', rows: 2, placeholder: '用英文寫出來' });
      const check = () => {
        const value = input.value.trim();
        if (!value || input.disabled) return;
        input.disabled = true;
        const score = translationScore(t, value);
        counted(score >= 0.8);
        checkBtn.hidden = true;
        nextBtn.hidden = false;
        put(out, h('p', { class: 'ref' }, '參考：', t.en, ' ', sayBtn(t.en)),
          t.alt?.length ? h('p', { class: 'muted' }, '也可以：', t.alt.join(' ／ ')) : null,
          h('p', { class: 'muted' }, `相似度 ${pct(score)}`));
      };
      const checkBtn = h('button', { class: 'btn', type: 'button', onclick: check }, '對照答案');
      return { card: practiceCard([h('p', { class: 'zh-big' }, t.zh), input, out], [checkBtn, nextBtn]) };
    },
  };

  const orderable = pool.sentences.filter((s) => { const n = s.en.split(/\s+/).length; return n >= ORDER_WORDS[0] && n <= ORDER_WORDS[1]; });
  const empty = { dict: pool.sentences, shadow: pool.sentences, vocab: words, grammar: pool.grammar, order: orderable, trans: pool.translate }[mode];
  function next(play) {
    speech.stop();
    if (!empty.length) { put(stage, h('p', { class: 'muted' }, '還沒有題目。')); return; }
    const { card, say } = render[mode]();
    put(stage, card);
    card.querySelector('input, textarea')?.focus({ preventScroll: true });
    if (play && say) speech.say(say, ttsOpts());
  }
  next(false);

  return h('div', { class: 'page' },
    h('p', { class: 'eyebrow' }, '自由練習・Practice'),
    h('h1', { class: 'headline' }, '想練多少就練多少'),
    h('p', { class: 'lede' }, '從所有學過的課隨機出題，不限題數。常忘的單字和常錯的文法會比較常出現。'),
    h('nav', { class: 'seg wide', 'aria-label': '練習項目' }, PRACTICE_MODES.map(([m, label]) =>
      h('a', { href: `#/practice/${m}`, class: m === mode ? 'on' : '' }, label))),
    tally,
    stage);
}

// --- Progress -------------------------------------------------------------------------------

// --- Dashboard ------------------------------------------------------------------------------

const PEOPLE = new Map(); // slug -> Promise of another learner's data (read-only)
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const shortDate = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}

// Everything the dashboard shows about one learner. ME is the live local state; the other learner
// is this device's cached copy (if it ever used that profile) merged with the gist copy (when this
// device has the sync token). Nothing here writes the other learner's data.
function personData(slug) {
  if (slug === ME.slug) {
    return Promise.resolve({ slug, name: ME.name, self: true, doc: S, index: INDEX, deck: deck(),
      feedback: FEEDBACK, advisor: ADVISOR, synced: Boolean(sync.loadConfig().gistId) });
  }
  if (!PEOPLE.has(slug)) PEOPLE.set(slug, loadPerson(slug).catch((err) => { PEOPLE.delete(slug); throw err; }));
  return PEOPLE.get(slug);
}

async function loadPerson(slug) {
  const name = PROFILES.find((x) => x.slug === slug)?.name || slug;
  const [{ lessons: index }, vocab] = await Promise.all([getJSON(`data/u/${slug}/index.json`), getJSON(`data/u/${slug}/vocab.json`)]);
  let doc = null;
  try {
    const raw = localStorage.getItem(`english-daily:v1:${slug}`);
    if (raw) doc = core.syncDoc(core.migrateState(JSON.parse(raw)));
  } catch { /* storage blocked or unreadable */ }
  let feedback = {};
  let advisor = loadAdvisor(slug);
  let synced = false;
  const cfg = sync.loadConfig();
  if (cfg.token && cfg.gistId) {
    try {
      const files = await sync.readMany(cfg.token, cfg.gistId, [sync.fileFor(slug), sync.feedbackFor(slug), sync.advisorFor(slug)]);
      const remote = files[sync.fileFor(slug)];
      if (remote) {
        const theirs = core.syncDoc(core.migrateState(remote));
        doc = doc ? core.mergeDocs(doc, theirs) : theirs;
      }
      feedback = files[sync.feedbackFor(slug)] || {};
      advisor = files[sync.advisorFor(slug)] || advisor;
      synced = true;
    } catch { /* offline: show what this device has */ }
  }
  return { slug, name, self: false, doc, index, deck: [...vocab, ...Object.values(doc?.words || {})], feedback, advisor, synced };
}

function actionHref(action) {
  const [kind, arg] = String(action || '').split(':');
  if (kind === 'practice' && arg) return `#/practice/${arg}`;
  if (kind === 'lesson' && arg) return `#/l/${currentLessonDate()}/${arg}`;
  return { review: '#/review', history: '#/history', goals: '#/goals', challenge: `#/l/${currentLessonDate()}/challenge` }[kind] || null;
}

function advisorCard(p, reports) {
  const dates = Object.keys(reports || {}).sort();
  const report = reports[dates[dates.length - 1]];
  const title = p.self ? '學習顧問的建議' : `${p.name} 的學習顧問報告`;
  if (!report) {
    return h('section', { class: 'card advisor' }, h('p', { class: 'adv-title' }, title),
      h('p', { class: 'muted' }, p.self || p.synced ? '顧問每天早上出課前分析一次作答紀錄，有新的作答就會更新報告。' : '這台裝置開啟同步後才看得到顧問報告。'));
  }
  const tickKey = `english-daily:advisor-today:${p.slug}:${report.date}`;
  let ticked = [];
  try { ticked = JSON.parse(localStorage.getItem(tickKey) || '[]'); } catch { /* storage blocked */ }
  const tick = (i, on) => {
    ticked = on ? [...new Set([...ticked, i])] : ticked.filter((x) => x !== i);
    try { localStorage.setItem(tickKey, JSON.stringify(ticked)); } catch { /* storage blocked */ }
  };
  const older = dates.slice(0, -1).reverse();
  return h('section', { class: 'card advisor' },
    h('div', { class: 'adv-head' }, h('p', { class: 'adv-title' }, title), h('span', { class: 'meta' }, `${shortDate(report.date)} 分析`)),
    h('p', { class: 'adv-summary' }, report.summary_zh),
    h('p', { class: 'adv-h' }, '最需要加強'),
    h('ol', { class: 'adv-list' }, report.weaknesses.map((w) => h('li', {},
      h('strong', {}, w.title_zh), h('p', {}, w.evidence_zh), h('p', { class: 'muted' }, w.why_zh)))),
    h('p', { class: 'adv-h' }, '最適合的學習方法'),
    h('div', { class: 'adv-methods' }, report.methods.map((m) => {
      const href = p.self ? actionHref(m.action) : null;
      return h('div', { class: 'adv-method' }, h('strong', {}, m.title_zh), h('p', {}, m.how_zh), h('p', { class: 'muted' }, m.why_zh),
        href ? h('a', { class: 'btn subtle', href }, '去做 ›') : null);
    })),
    h('p', { class: 'adv-h' }, p.self ? '今天可以做' : '今天的建議'),
    h('ul', { class: 'adv-today' }, report.today.map((t, i) => h('li', {}, p.self
      ? h('label', {}, h('input', { type: 'checkbox', checked: ticked.includes(i), onchange: (e) => tick(i, e.target.checked) }), h('span', {}, t))
      : t))),
    h('details', { class: 'adv-more' }, h('summary', {}, '做得好的地方・資料說明'),
      h('ul', { class: 'adv-list plain' }, report.strengths.map((x) => h('li', {}, h('strong', {}, x.title_zh), h('p', {}, x.evidence_zh)))),
      h('p', { class: 'muted' }, report.data_note_zh)),
    older.length ? h('details', { class: 'adv-more' }, h('summary', {}, `過去的報告（${older.length}）`),
      h('ul', { class: 'adv-past' }, older.map((d) => h('li', {}, h('strong', {}, shortDate(d)), '　', reports[d].summary_zh)))) : null);
}

function dashSection(title, note, ...body) {
  return h('section', { class: 'dash-sec' }, h('h2', { class: 'section-title' }, title), note ? h('p', { class: 'muted' }, note) : null, ...body);
}

const HEAT_STEPS = [[0, '沒練'], [1, '1–9 分'], [10, '10–19 分'], [20, '20–29 分'], [30, '30 分以上']];
const heatLevel = (a) => (!a ? 0 : Math.max(1, HEAT_STEPS.filter(([min]) => a.minutes >= min).length - 1));

// Last 8 weeks, Monday-first columns; darker = more minutes. Tap a day for its numbers.
function calendarHeatmap(activity) {
  const end = today();
  const dow = (d) => (new Date(`${d}T00:00:00`).getDay() + 6) % 7;
  const start = core.addDays(end, -dow(end) - 7 * 7);
  const readout = h('p', { class: 'heat-readout', 'aria-live': 'polite' }, '點格子看當天練了多久');
  const cells = [];
  for (let i = 0; i < 56; i++) {
    const d = core.addDays(start, i);
    if (d > end) { cells.push(h('span', { class: 'heat-cell future' })); continue; }
    const a = activity[d];
    const text = `${shortDate(d)}（${WEEKDAYS[(dow(d) + 1) % 7]}）${a ? `${a.minutes ? `${a.minutes} 分鐘` : '有練習'}・${a.events} 次作答` : '沒有練習'}`;
    cells.push(h('button', { type: 'button', class: `heat-cell l${heatLevel(a)}${d === end ? ' today' : ''}`, 'aria-label': text,
      onclick: (e) => { put(readout, text); e.currentTarget.parentNode.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel')); e.currentTarget.classList.add('sel'); } }));
  }
  return h('div', { class: 'heat' },
    h('div', { class: 'heat-wrap' },
      h('div', { class: 'heat-days' }, ['一', '', '三', '', '五', '', '日'].map((x) => h('span', {}, x))),
      h('div', { class: 'heat-grid' }, cells)),
    readout,
    h('div', { class: 'heat-legend' }, HEAT_STEPS.map(([, label], i) => h('span', {}, h('i', { class: `heat-cell l${i}` }), label))));
}

function sparkline(points) {
  const W = 96; const H = 30; const pad = 4;
  const x = (i) => (points.length < 2 ? W / 2 : pad + (i * (W - 2 * pad)) / (points.length - 1));
  const y = (v) => pad + (1 - v) * (H - 2 * pad);
  const last = points[points.length - 1];
  return svg('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' },
    svg('line', { x1: 0, x2: W, y1: y(1), y2: y(1), class: 'spark-ref' }),
    points.length > 1 ? svg('polyline', { points: points.map(([, v], i) => `${x(i)},${y(v)}`).join(' '), class: 'spark-line' }) : null,
    last ? svg('circle', { cx: x(points.length - 1), cy: y(last[1]), r: 4, class: 'spark-dot' }) : null);
}

// One row per skill: sparkline by lesson, recent accuracy, change against earlier lessons.
function skillTrends(results) {
  const series = core.skillSeries(results);
  return h('div', { class: 'trends' }, Object.entries(series).map(([skill, pts]) => {
    const vals = pts.map(([, v]) => v);
    const recent = vals.length ? mean(vals.slice(-3)) : null;
    const before = vals.length >= 5 ? mean(vals.slice(0, -3)) : null; // at least two earlier lessons to compare with
    const delta = before == null ? null : recent - before;
    const dir = delta == null || Math.abs(delta) < 0.005 ? '' : delta > 0 ? 'up' : 'down';
    return h('details', { class: 'trend' },
      h('summary', {},
        h('span', { class: 'trend-name' }, core.SKILL_ZH[skill]),
        vals.length ? sparkline(pts) : h('span', { class: 'spark empty' }),
        h('span', { class: 'trend-num' }, recent == null ? '—' : pct(recent)),
        h('span', { class: `trend-delta ${dir}` }, delta == null ? (vals.length ? `共 ${vals.length} 課` : '') : `${dir === 'up' ? '▲' : dir === 'down' ? '▼' : '＝'} ${Math.abs(Math.round(delta * 100))}`)),
      vals.length
        ? h('table', { class: 'mini-table' }, h('tbody', {}, pts.map(([d, v]) => h('tr', {}, h('td', {}, shortDate(d)), h('td', {}, pct(v))))))
        : h('p', { class: 'muted' }, skill === 'speaking' ? '還沒有分數：跟讀用說的完成才會計分（安靜模式不計分）。' : '還沒有作答。'));
  }));
}

function levelJourney(index) {
  const lessons = [...index].reverse().filter((x) => x.date <= today()).slice(-14);
  if (!lessons.length) return h('p', { class: 'muted' }, '還沒有課程。');
  const changes = lessons.filter((x, i) => i && x.level !== lessons[i - 1].level).length;
  return [
    h('p', { class: 'muted' }, changes ? `最近 ${lessons.length} 課換過 ${changes} 次等級。` : `最近 ${lessons.length} 課都在 ${lessons[lessons.length - 1].level}；三項主要能力連續 3 課 85% 以上會升級。`),
    h('div', { class: 'levels' }, lessons.map((x, i) => h('span', { class: `lv${i && x.level !== lessons[i - 1].level ? ' changed' : ''}` },
      h('small', {}, shortDate(x.date)), x.level))),
  ];
}

const masteryClass = (acc) => (acc >= 0.8 ? ['good', '穩'] : acc >= 0.6 ? ['mid', '加強中'] : ['low', '需加強']);

function grammarBars(list) {
  if (!list.length) return h('p', { class: 'muted' }, '還沒有文法作答。');
  return h('ul', { class: 'meters' }, list.map((g) => {
    const [cls, word] = masteryClass(g.acc);
    return h('li', {},
      h('p', { class: 'meter-label' }, g.zh || g.point),
      h('div', { class: 'meter-row' },
        h('span', { class: 'meter' }, h('span', { class: `meter-fill ${cls}`, style: `width:${Math.max(2, Math.round(g.acc * 100))}%` })),
        h('span', { class: 'meter-num' }, `${pct(g.acc)}・${g.n} 題`),
        h('span', { class: `status ${cls}` }, word)));
  }));
}

function vocabBlock(doc, words) {
  const st = core.vocabStatus(doc.srs, WEAK_EASE);
  const inReview = st.mastered + st.learning + st.weak;
  const fresh = Math.max(0, new Set(words.map((v) => wkey(v.word))).size - inReview);
  const parts = [['mastered', '熟了', st.mastered], ['learning', '學習中', st.learning], ['weak', '常忘', st.weak], ['fresh', '還沒開始', fresh]];
  const total = parts.reduce((n, [, , v]) => n + v, 0);
  const byWord = new Map(words.map((v) => [wkey(v.word), v]));
  const weak = Object.entries(doc.srs || {}).filter(([, c]) => isWeak(c))
    .sort((a, b) => (b[1].lapses || 0) - (a[1].lapses || 0) || a[1].ease - b[1].ease).slice(0, 8);
  return [
    total ? h('div', { class: 'segbar', role: 'img', 'aria-label': parts.map(([, l, v]) => `${l} ${v}`).join('、') },
      parts.filter(([, , v]) => v).map(([k, , v]) => h('span', { class: `seg-${k}`, style: `flex-grow:${v}` }, v / total >= 0.12 ? String(v) : ''))) : null,
    h('div', { class: 'legend' }, parts.map(([k, l, v]) => h('span', {}, h('i', { class: `sw seg-${k}` }), `${l} ${v}`))),
    h('p', { class: 'muted' }, `「熟了」＝複習間隔 ${core.MASTERED_INTERVAL} 天以上；「常忘」＝按過忘了或有點難。`),
    weak.length ? h('ul', { class: 'plain' }, weak.map(([w, c]) => h('li', {}, h('strong', {}, byWord.get(w)?.word || w), '　', byWord.get(w)?.zh || '',
      h('span', { class: 'muted' }, c.lapses ? `　忘了 ${c.lapses} 次` : '　有點難')))) : null,
  ];
}

function essayBlock(p) {
  const dates = Object.keys(p.feedback || {}).sort();
  if (!dates.length) return h('p', { class: 'muted' }, '交卷後老師會在當天批改（9、12、18、22 點），分數會出現在這裡。');
  return h('ul', { class: 'meters' }, dates.map((d) => {
    const f = p.feedback[d];
    return h('li', {}, h('div', { class: 'meter-row' },
      p.self ? h('a', { class: 'meter-date', href: `#/l/${d}/write` }, shortDate(d)) : h('span', { class: 'meter-date' }, shortDate(d)),
      h('span', { class: 'meter' }, h('span', { class: 'meter-fill seq', style: `width:${(f.score || 0) * 10}%` })),
      h('span', { class: 'meter-num' }, `${f.score}/10・${(f.items || []).length} 處修改`)));
  }));
}

function habitsBlock(doc, minutes, goal) {
  const parts = core.dayparts(doc);
  const total = parts.reduce((n, [, c]) => n + c, 0);
  const top = Math.max(1, ...parts.map(([, c]) => c));
  const avgMin = minutes.length ? Math.round(mean(minutes)) : null;
  const pending = Object.values(doc.pending || {}).filter((x) => x && !x.done).length;
  const extra = Object.values(doc.practice || {}).reduce((n, day) => n + Object.values(day || {}).reduce((m, [, t]) => m + t, 0), 0);
  return [
    total ? h('ul', { class: 'meters compact' }, parts.map(([name, c]) => h('li', {}, h('div', { class: 'meter-row' },
      h('span', { class: 'meter-date' }, name),
      h('span', { class: 'meter' }, h('span', { class: 'meter-fill seq', style: `width:${(c / top) * 100}%` })),
      h('span', { class: 'meter-num' }, c ? `${Math.round((c / total) * 100)}%` : '—'))))) : h('p', { class: 'muted' }, '還沒有作答時間紀錄。'),
    h('p', { class: 'muted' }, '依作答時間分：清晨 0–6、早上 6–11、中午 11–14、下午 14–18、晚上 18–23、深夜 23–24 點。'),
    h('div', { class: 'stats three' },
      stat(avgMin == null ? '—' : `${avgMin}`, goal ? `平均分鐘／目標 ${goal}` : '有練習的日子平均分鐘'),
      stat(`${extra}`, '自由練習題'), stat(`${pending}`, '口說待補')),
  ];
}

async function dashboardPage(slug) {
  const p = await personData(PROFILES.some((x) => x.slug === slug) ? slug : ME.slug);
  const doc = p.doc || {};
  const latest = p.index.find((x) => x.date <= today()) || p.index[0];
  const coach = p.index.find((x) => x.date <= today() && x.coach)?.coach;
  const activity = core.dayActivity(doc);
  const days = Object.keys(activity);
  const minutes = Object.values(activity).map((a) => a.minutes).filter(Boolean);
  const results = doc.results || {};
  const answered = Object.values(results).reduce((n, d) => n + Object.keys(d || {}).length, 0);
  const completed = p.index.filter((x) => SECTIONS.every((s) => doc.done?.[x.date]?.[s.id])).length;
  const switcher = PROFILES.length > 1 ? h('div', { class: 'seg', role: 'group', 'aria-label': '看誰的進度' },
    PROFILES.map((x) => h('a', { class: x.slug === p.slug ? 'on' : '', href: x.slug === ME.slug ? '#/progress' : `#/progress/${x.slug}` },
      x.slug === ME.slug ? `${x.name}（我）` : x.name))) : null;
  return h('div', { class: 'page dash' },
    h('p', { class: 'eyebrow' }, '進度・Dashboard'),
    switcher,
    h('h1', { class: 'headline' }, `${p.self ? '' : `${p.name}・`}目前等級 ${latest?.level || '—'}`),
    h('p', { class: 'lede' }, coach?.level_reason_zh || '做完幾課之後，這裡會說明升降級的判斷。'),
    p.self && !p.synced ? h('a', { class: 'card notice', href: '#/settings' },
      h('strong', {}, '還沒開啟跨裝置同步'),
      h('span', { class: 'muted' }, '每天出題和學習顧問都看不到你的作答紀錄。到設定頁花一分鐘連線。')) : null,
    !p.self && !p.doc ? h('div', { class: 'card notice' }, h('strong', {}, `這台裝置看不到 ${p.name} 的作答紀錄`),
      h('span', { class: 'muted' }, '開啟跨裝置同步（貼上同一個 token）後，就能在這裡看到對方的進度。')) : null,
    advisorCard(p, p.advisor || {}),
    p.self ? notesCard() : null,
    h('div', { class: 'stats' }, stat(`${core.streakOf(days, today())}`, '連續天數'), stat(`${days.length}`, '練習天數'),
      stat(`${completed}`, '完成的課'), stat(`${answered}`, '答題數')),
    dashSection('學習日曆', '最近 8 週，顏色越深練得越久。', calendarHeatmap(activity)),
    dashSection('五項能力', '每一課的正確率；數字是最近 3 課的平均，有 5 課以上時箭頭和更早的課比。點一列看每課的分數。', skillTrends(results)),
    dashSection('等級歷程', null, levelJourney(p.index)),
    dashSection('文法掌握', '每個學過的文法點（含複習題）的正確率。', grammarBars(core.grammarMastery(results, p.index))),
    dashSection('單字', null, vocabBlock(doc, p.deck)),
    dashSection('作文分數', null, essayBlock(p)),
    dashSection('練習習慣', null, habitsBlock(doc, minutes, doc.profile?.minutes)),
    p.self ? h('a', { class: 'card notice', href: '#/history' },
      h('strong', {}, `所有課程（${INDEX.length}）在「紀錄」`), h('span', { class: 'muted' }, '每天的練習都在那裡，可以回去複習，也可以補寫漏掉的題目。')) : null);
}

// --- History --------------------------------------------------------------------------------

const SECTION_ITEMS = { read: ['read'], grammar: ['grammar', 'review'], listen: ['listen', 'dict'], speak: ['shadow', 'prompt'], write: ['trans', 'write'] };
const CHALLENGE_ITEMS = ['ch.read', 'ch.listen', 'ch.dict'];
let historyFilter = 'all';

function itemKeys(entry, prefixes) {
  return prefixes.flatMap((p) => {
    const n = entry.items?.[p] || 0;
    return p === 'write' ? (n ? ['write.submitted'] : []) : Array.from({ length: n }, (_, i) => `${p}.${i}`);
  });
}

// {total, missing} answerable items for a section of a lesson.
function itemStatus(entry, prefixes) {
  const keys = itemKeys(entry, prefixes);
  return { total: keys.length, missing: keys.filter((k) => !answered(entry.date, k)).length };
}

function historyRows() {
  return INDEX.filter((x) => x.date <= today()).map((x) => {
    const secs = Object.fromEntries(Object.entries(SECTION_ITEMS).map(([id, p]) => [id, itemStatus(x, p)]));
    // A section counts as skipped once its day is over, or once the learner started or finished it.
    const missed = (id) => {
      const st = secs[id];
      return st.missing && (x.date < today() || isDone(x.date, id) || st.missing < st.total) ? st.missing : 0;
    };
    const total = Object.keys(SECTION_ITEMS).reduce((n, id) => n + missed(id), 0);
    return { x, secs, missed, total, ch: x.challenge ? itemStatus(x, CHALLENGE_ITEMS) : null };
  });
}

function historyRow({ x, missed, ch }) {
  const n = SECTIONS.filter((s) => isDone(x.date, s.id)).length;
  const chip = (cls, href, ...kids) => h('a', { class: `h-sec${cls ? ` ${cls}` : ''}`, href }, ...kids);
  const chips = SECTIONS.map((s) => {
    const m = SECTION_ITEMS[s.id] ? missed(s.id) : 0;
    if (m) return chip('miss', `#/l/${x.date}/${s.id}/todo`, `${s.zh} 漏 ${m}`);
    if (isDone(x.date, s.id)) return chip('ok', `#/l/${x.date}/${s.id}`, icon('check'), s.zh);
    return chip('', `#/l/${x.date}/${s.id}`, s.zh);
  });
  if (ch) {
    const started = ch.missing < ch.total || isDone(x.date, 'challenge');
    chips.push(!ch.missing ? chip('ok', `#/l/${x.date}/challenge`, icon('check'), '挑戰')
      : started ? chip('miss', `#/l/${x.date}/challenge/todo`, `挑戰 漏 ${ch.missing}`)
        : chip('', `#/l/${x.date}/challenge`, `挑戰 ${x.challenge}`));
  }
  const fb = FEEDBACK[x.date];
  if (fb) chips.push(chip('ok', `#/l/${x.date}/write`, `作文 ${fb.score}/10`));
  return h('li', { class: 'card history-card' },
    h('div', { class: 'h-top' },
      h('span', { class: 'h-date' }, formatDate(x.date), x.date === today() ? h('span', { class: 'tag' }, '今天') : null),
      h('span', { class: `arc-prog${n === SECTIONS.length ? ' full' : ''}` }, `${n}/${SECTIONS.length}`)),
    h('a', { class: 'h-title', href: `#/l/${x.date}` }, x.theme_zh, h('small', {}, `${x.theme}・${x.level}`)),
    h('div', { class: 'h-secs' }, chips));
}

function historyPage() {
  const rows = historyRows();
  const missingDays = rows.filter((r) => r.total).length;
  const totalMissing = rows.reduce((n, r) => n + r.total, 0);
  const shown = historyFilter === 'missing' ? rows.filter((r) => r.total) : rows;
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '篩選' },
    [['all', `全部（${rows.length}）`], ['missing', `有漏寫（${missingDays}）`]].map(([k, label]) => h('button', {
      type: 'button', class: historyFilter === k ? 'on' : '', onclick: () => { historyFilter = k; route(); },
    }, label)));
  return h('div', { class: 'page' },
    h('p', { class: 'eyebrow' }, '練習紀錄・History'),
    h('h1', { class: 'headline' }, '每天的練習'),
    h('p', { class: 'lede' }, totalMissing
      ? `還有 ${totalMissing} 題沒寫。點紅色標籤會直接跳到那一節，沒寫的題目會用虛線框起來。`
      : '每一課的題目都寫完了。點任何一天都可以回去複習。'),
    h('div', { class: 'toolbar' }, seg),
    shown.length ? h('ul', { class: 'history' }, shown.map(historyRow)) : h('p', { class: 'muted' }, '沒有漏寫的題目，太棒了。'));
}

// --- Settings -------------------------------------------------------------------------------

function syncGroup() {
  const cfg = sync.loadConfig();
  if (cfg.token && cfg.gistId) {
    let armed = false;
    const off = h('button', {
      class: 'btn subtle', type: 'button',
      onclick: () => {
        if (!armed) { armed = true; off.textContent = '再按一次確認中斷'; return; }
        sync.clearConfig();
        toast('已中斷同步。這台裝置的紀錄還在。');
        route();
      },
    }, '中斷連線');
    const syncBtn = h('button', {
      class: 'btn', type: 'button',
      onclick: async () => {
        syncBtn.disabled = true;
        await syncNow({ manual: true });
        if (!sync.loadConfig().error) toast('同步完成。');
        route();
      },
    }, '立即同步');
    const share = h('button', {
      class: 'btn', type: 'button',
      onclick: () => copyText(cfg.token, '已複製。到另一台裝置的「設定 → 跨裝置同步」貼上，按「連線」。'),
    }, '複製 token 給另一台裝置');
    const status = cfg.error ? `上次同步失敗：${cfg.error}` : cfg.last ? `上次同步：${formatTime(cfg.last)}` : '還沒同步過';
    return h('div', { class: 'group' }, h('div', { class: 'setting' },
      h('span', {}, h('strong', {}, '跨裝置同步：已連線'),
        h('small', {}, `GitHub 帳號 ${cfg.login}。作答紀錄會自動同步到你的私人 gist，每天出題也會依這些紀錄調整。`)),
      h('p', { class: cfg.error ? 'sync-status bad' : 'sync-status' }, status),
      h('div', { class: 'row' }, syncBtn, off),
      share,
      h('small', { class: 'muted' }, 'Mac 和 iPhone 登入同一個 Apple ID 時，在這裡複製後可以直接到另一台貼上（通用剪貼板）。')));
  }
  const input = h('input', { class: 'field', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: '貼上 ghp_ 開頭的 token' });
  const go = h('button', {
    class: 'btn primary', type: 'button',
    onclick: async () => {
      const token = input.value.trim();
      if (!token) return;
      go.disabled = true;
      go.textContent = '連線中…';
      try {
        const login = await sync.whoAmI(token);
        const gistId = await sync.findOrCreateGist(token, sync.fileFor(ME.slug), core.syncDoc(S));
        sync.saveConfig({ token, gistId, login });
        await syncNow({ manual: true });
        toast('已連線，作答紀錄開始同步。');
        route();
      } catch (err) {
        toast(err.message);
        go.disabled = false;
        go.textContent = '連線';
      }
    },
  }, '連線');
  return h('div', { class: 'group' }, h('div', { class: 'setting' },
    h('span', {}, h('strong', {}, '跨裝置同步'),
      h('small', {}, '開啟後手機和電腦的進度會一致，每天出題也能看到你的作答紀錄，依弱點加強、依表現調整難度。')),
    h('ol', { class: 'steps' },
      h('li', {}, '按「建立 token」：會開 GitHub 網頁，已經幫你勾好 gist 權限。'),
      h('li', {}, 'Expiration 選「No expiration」，拉到最下面按「Generate token」。'),
      h('li', {}, '複製 ghp_ 開頭的那串字，回到這裡貼上，按「連線」。'),
      h('li', {}, '另一台裝置：在已連線的裝置按「複製 token 給另一台裝置」，到這裡貼上就好，不用再建立。')),
    h('a', { class: 'btn', href: sync.TOKEN_URL, target: '_blank', rel: 'noopener' }, '建立 token'),
    input,
    go,
    h('small', { class: 'muted' }, 'token 只存在這個瀏覽器，只能讀寫你的 gist，碰不到你的 repo。紀錄存在一個不公開的 gist 裡。')));
}

const GOALS = ['職場溝通', '開會與簡報', '出國旅遊', '日常聊天', '看影集電影', '考試（多益等）', '閱讀新聞文章'];
const INTERESTS = ['科技', '商業財經', '美食', '旅遊', '運動健身', '電影影集', '音樂', '家庭親子', '健康', '寵物', '藝術設計', '科學'];
const MINUTES = [10, 20, 30, 45];

// What the learner wants: shapes the themes, examples and length of their next lessons.
function goalsPage() {
  const p = S.profile || {};
  const chosen = { goals: new Set(p.goals || []), interests: new Set(p.interests || []) };
  let minutes = p.minutes || 30;
  const chips = (key, options) => h('div', { class: 'chips pick' }, options.map((o) => {
    const chip = h('button', {
      type: 'button', class: `chip${chosen[key].has(o) ? ' on' : ''}`, 'aria-pressed': String(chosen[key].has(o)),
      onclick: () => {
        if (chosen[key].has(o)) chosen[key].delete(o); else chosen[key].add(o);
        chip.classList.toggle('on', chosen[key].has(o));
        chip.setAttribute('aria-pressed', String(chosen[key].has(o)));
      },
    }, o);
    return chip;
  }));
  const timeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '每天練習時間' });
  const paintTime = () => timeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.m) === minutes));
  for (const m of MINUTES) timeSeg.append(h('button', { type: 'button', 'data-m': m, onclick: () => { minutes = m; paintTime(); } }, `${m} 分`));
  paintTime();
  const saveBtn = h('button', {
    class: 'btn primary wide', type: 'button',
    onclick: () => {
      S.profile = { goals: [...chosen.goals], interests: [...chosen.interests], minutes, t: now() };
      touch();
      save();
      toast('已儲存。明天早上的課會照你的目標和興趣出題。');
      location.hash = '#/';
    },
  }, '儲存');
  return h('div', { class: 'page' },
    h('p', { class: 'eyebrow' }, '學習目標・Goals'),
    h('h1', { class: 'headline' }, `${ME.name}，你想把英文用在哪裡？`),
    h('p', { class: 'lede' }, '每天出題時會參考這裡：情境和例句會貼近你的目標與興趣，課程長度也會配合你的時間。隨時可以改。'),
    h('h2', { class: 'section-title' }, '學習目標'), chips('goals', GOALS),
    h('h2', { class: 'section-title' }, '興趣'), chips('interests', INTERESTS),
    h('h2', { class: 'section-title' }, '每天大約有多少時間？'), timeSeg,
    h('h2', { class: 'section-title' }, '還想告訴老師什麼？'),
    h('a', { class: 'card notice', href: '#/notes' }, h('strong', {}, '到「給老師的留言」寫 ›'),
      h('span', { class: 'muted' }, '哪裡覺得不夠好、想多練什麼情境，寫在那裡，隔天的課會回應你。')),
    h('div', { class: 'finish' }, saveBtn));
}

// --- Notes to the teacher -------------------------------------------------------------------

const NOTE_SKILLS = ['單字', '閱讀', '文法', '聽力', '口說', '寫作', '其他'];
const notesSeenKey = () => `english-daily:notes-seen:${ME.slug}`; // newest reply date already seen (this device)
const notesSeen = () => { try { return localStorage.getItem(notesSeenKey()) || ''; } catch { return ''; } };
const notesOverview = () => core.notesSummary(S.notes, INDEX, notesSeen());

function addNote(text, skill) {
  const id = `${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  S.notes[id] = { id, t: now(), text, ...(skill ? { skill } : {}) };
  touch();
  save();
}

function setNoteClosed(id, closed) {
  const n = S.notes[id];
  if (!n) return;
  const { closed: _was, ...rest } = n;
  S.notes[id] = closed ? { ...rest, t: now(), closed: now() } : { ...rest, t: now() };
  save();
}

// The home and dashboard card: unread replies first, else how many notes are waiting.
function notesCard() {
  const o = notesOverview();
  if (o.unseen) {
    return h('a', { class: 'card notice', href: '#/notes' }, h('strong', {}, `老師回應了你的留言（${o.unseen}）`),
      h('span', { class: 'muted' }, '看看今天的課怎麼回應你想加強的地方。'));
  }
  return h('a', { class: 'card notice', href: '#/notes' },
    h('strong', {}, o.open.length ? `給老師的留言：${o.open.length} 則${o.replied ? `，已回應 ${o.replied} 則` : ''}` : '想請老師加強什麼？留言給老師'),
    h('span', { class: 'muted' }, '寫下你覺得不夠好的地方，明天的課會回應你。'));
}

function noteCard(n, closed) {
  const toggle = h('button', {
    class: 'btn subtle', type: 'button',
    onclick: () => { setNoteClosed(n.id, !closed); toast(closed ? '已重新打開，老師會再看到。' : '已收起。'); route(); },
  }, closed ? '重新打開' : '學會了，收起');
  return h('div', { class: `card note${closed ? ' closed' : ''}` },
    h('p', { class: 'note-meta' }, formatDate(core.localDate(new Date(n.t || 0))), n.skill ? h('span', { class: 'chip' }, n.skill) : null),
    h('p', { class: 'note-text' }, n.text),
    n.replies.length
      ? n.replies.map((r) => h('div', { class: 'note-reply' },
        h('strong', {}, `老師在 ${shortDate(r.date)} 的課回應了`), h('p', {}, r.zh), h('a', { href: `#/l/${r.date}` }, '看那天的課 ›')))
      : (closed ? null : h('p', { class: 'muted' }, '老師還沒看到，明天早上的課會回應。')),
    h('div', { class: 'row' }, toggle));
}

function notesPage() {
  const o = notesOverview();
  try { if (o.latestReply) localStorage.setItem(notesSeenKey(), o.latestReply); } catch { /* storage blocked */ }
  let skill = '';
  const text = h('textarea', { class: 'field', rows: 4, placeholder: '例如：完成式還是會搞錯、想練電話會議的開場、聽快一點的對話會跟不上…' });
  const chips = h('div', { class: 'chips pick' }, NOTE_SKILLS.map((s) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': 'false',
    onclick: () => {
      skill = skill === s ? '' : s;
      chips.querySelectorAll('.chip').forEach((b) => { const on = b.textContent === skill; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    },
  }, s)));
  const send = h('button', {
    class: 'btn primary wide', type: 'button',
    onclick: () => {
      const v = text.value.trim();
      if (!v) { toast('先寫一點想加強的地方。'); text.focus(); return; }
      addNote(v, skill);
      toast('已送出。明天的課會回應你。');
      route();
    },
  }, '送出給老師');
  return h('div', { class: 'page' },
    h('p', { class: 'eyebrow' }, '給老師的留言・Notes'),
    h('h1', { class: 'headline' }, '哪裡想加強？告訴老師'),
    h('p', { class: 'lede' }, '寫下你覺得不夠好、想多練的地方。明天的課會回應你，學習顧問也會參考。'),
    text,
    h('p', { class: 'muted' }, '類別（選填）'), chips,
    send,
    o.open.length ? h('h2', { class: 'section-title' }, `留言（${o.open.length}）`) : null,
    o.open.map((n) => noteCard(n, false)),
    o.closed.length ? h('details', { class: 'adv-more' }, h('summary', {}, `已收起的留言（${o.closed.length}）`),
      o.closed.map((n) => noteCard(n, true))) : null);
}

function profileGroup() {
  return h('div', { class: 'group' }, h('div', { class: 'setting' },
    h('span', {}, h('strong', {}, `目前使用者：${ME.name}`),
      h('small', {}, '這台裝置顯示的是這個人的課程和進度。家人共用裝置時可以切換。')),
    h('div', { class: 'row' }, h('button', {
      class: 'btn', type: 'button',
      onclick: async () => {
        if (dirty) await syncNow();
        ME = null;
        try { localStorage.removeItem(ME_KEY); } catch { /* storage blocked */ }
        location.hash = '#/';
        route();
      },
    }, '切換使用者'), h('a', { class: 'btn', href: '#/goals' }, '學習目標與興趣'))));
}

function settingsPage() {
  const voiceSel = h('select', { class: 'field', 'aria-label': '朗讀聲音', onchange: () => { S.settings.voice = voiceSel.value; persist(); } });
  speech.voicesReady().then((voices) => {
    put(voiceSel, h('option', { value: '' }, '自動選擇（推薦）'),
      ...voices.map((v) => h('option', { value: v.name, selected: v.name === S.settings.voice }, `${v.name}（${v.lang}）`)));
  });
  const rateSel = h('select', { class: 'field', 'aria-label': '語速', onchange: () => { S.settings.rate = Number(rateSel.value); persist(); } },
    [0.7, 0.8, 0.9, 1, 1.1, 1.2].map((r) => h('option', { value: r, selected: r === S.settings.rate }, `${r}×`)));
  const newSel = h('select', { class: 'field', 'aria-label': '每天新字上限', onchange: () => { S.settings.newPerDay = Number(newSel.value); persist(); updateBadge(); } },
    [5, 10, 15, 20, 30].map((n) => h('option', { value: n, selected: n === S.settings.newPerDay }, `${n} 個`)));
  const quiet = h('input', { type: 'checkbox', class: 'switch', checked: S.settings.quiet, onchange: () => setQuiet(quiet.checked, false) });

  const exportBox = h('textarea', { class: 'field mono', rows: 4, readonly: true }, JSON.stringify(S));
  const importBox = h('textarea', { class: 'field mono', rows: 4, placeholder: '貼上從另一台裝置匯出的紀錄' });
  const doImport = () => {
    try {
      const data = JSON.parse(importBox.value);
      if (!data || typeof data.srs !== 'object' || typeof data.done !== 'object') throw new Error('format');
      S = { ...core.migrateState(data), settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) } };
      save();
      toast('匯入完成。');
      route();
    } catch {
      toast('格式不對：請貼上完整的匯出內容。');
    }
  };
  let armed = false;
  const resetBtn = h('button', {
    class: 'btn danger', type: 'button',
    onclick: () => {
      if (!armed) { armed = true; resetBtn.textContent = '再按一次確認清除'; return; }
      S = freshState();
      persist();
      toast('這台裝置的學習紀錄已清除。');
      route();
    },
  }, '清除這台裝置的紀錄');

  return h('div', { class: 'page' },
    h('p', { class: 'eyebrow' }, '設定・Settings'),
    h('h1', { class: 'headline' }, '設定'),
    profileGroup(),
    syncGroup(),
    h('div', { class: 'group' },
      h('label', { class: 'setting' }, h('span', {}, h('strong', {}, '安靜模式'), h('small', {}, '在外面不方便說話時開啟：口說題改成默念或打字，記到「口說待補」。')), quiet),
      h('label', { class: 'setting' }, h('span', {}, h('strong', {}, '備用朗讀聲音'), h('small', {}, '最近的課都有預先錄好的真人感語音，會優先播放；這裡的聲音只用在沒有錄音的句子。')), voiceSel),
      h('div', { class: 'row' }, h('button', { class: 'btn subtle', type: 'button', onclick: () => speech.say('Hi! This is how I sound. Is the speed comfortable for you?', ttsOpts()) }, icon('speaker'), '試聽')),
      h('label', { class: 'setting' }, h('span', {}, h('strong', {}, '語速')), rateSel),
      h('label', { class: 'setting' }, h('span', {}, h('strong', {}, '每天新單字上限'), h('small', {}, '複習頁每天最多加入幾個沒學過的字。')), newSel)),
    h('h2', { class: 'section-title' }, '手動備份'),
    h('p', { class: 'muted' }, '沒開同步時，可以在舊裝置複製匯出內容，再到新裝置貼上匯入。開了同步就不需要。'),
    exportBox,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => copyText(exportBox.value, '已複製匯出內容。') }, '複製匯出內容')),
    importBox,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: doImport }, '匯入'), resetBtn),
    h('p', { class: 'muted' }, '開著同步時，清除只會清這台裝置；下次同步會把雲端的紀錄拿回來。'),
    h('h2', { class: 'section-title' }, '關於'),
    h('p', { class: 'muted' }, '每天的題目由 AI 自動生成並經母語老師審核，仍可能有錯。字典資料來自開源的 ECDICT（MIT 授權）；查不到的字改用線上字典。'));
}

// --- Shell ----------------------------------------------------------------------------------

function setQuiet(on, rerender = true) {
  S.settings.quiet = on;
  persist();
  paintQuiet();
  toast(on ? '安靜模式：口說題改成默念或打字。' : '已關閉安靜模式，可以開口練習了。');
  if (rerender) route();
}

function paintQuiet() {
  const btn = $('#quiet');
  put(btn, icon('mic'), S.settings.quiet ? '安靜模式' : '可說話');
  btn.classList.toggle('on', S.settings.quiet);
  btn.setAttribute('aria-pressed', String(S.settings.quiet));
}

function updateBadge() {
  const n = reviewQueue().length;
  const badge = $('#badge');
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.hidden = n === 0;
}

function profilePage() {
  return h('div', { class: 'page signin' },
    h('p', { class: 'eyebrow' }, 'English Daily'),
    h('h1', { class: 'headline' }, '你是誰？'),
    h('p', { class: 'lede' }, '選一次就好，這台裝置之後會記得。每個人有自己的課程和進度。'),
    h('div', { class: 'profiles' }, PROFILES.map((p) => h('button', {
      class: 'profile', type: 'button', onclick: () => chooseProfile(p),
    }, h('span', { class: 'avatar' }, p.name.slice(0, 1).toUpperCase()), h('span', {}, p.name)))));
}

function welcomePage() {
  return h('div', { class: 'page' },
    h('p', { class: 'eyebrow' }, `歡迎，${ME.name}`),
    h('h1', { class: 'headline' }, '你的第一課正在準備中'),
    h('p', { class: 'lede' }, '每天早上 6 點多會依你的程度產生一課，明天打開這裡就能開始；之後會依你的作答自動調整難度和加強弱點。'),
    h('p', { class: 'sync-line', id: 'sync-line' }));
}

function errorBox(err) {
  return h('div', { class: 'page' }, h('h1', { class: 'title' }, '出了點問題'), h('p', { class: 'muted' }, err.message),
    h('a', { class: 'btn', href: '#/' }, '回到今日'));
}

async function route() {
  if (updateReady) { location.reload(); return; }
  speech.stop();
  hideSheet();
  document.body.classList.toggle('signed-out', !ME);
  if (!ME) { put($('#view'), profilePage()); window.scrollTo(0, 0); return; }
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const view = $('#view');
  let tab = 'home';
  try {
    let page;
    if (!INDEX.length && !['settings', 'review', 'progress', 'history'].includes(parts[0])) page = welcomePage();
    else if (!parts.length) page = await homePage(currentLessonDate());
    else if (parts[0] === 'l' && parts.length === 2) page = await homePage(parts[1]);
    else if (parts[0] === 'l' && parts[2] === 'challenge') page = await challengePage(parts[1]);
    else if (parts[0] === 'l' && parts.length >= 3) page = await sectionPage(parts[1], parts[2]);
    else if (parts[0] === 'review') { tab = 'review'; page = reviewPage(); }
    else if (parts[0] === 'practice') { tab = 'practice'; page = await practicePage(parts[1]); }
    else if (parts[0] === 'progress') { tab = 'progress'; page = await dashboardPage(parts[1] || ME.slug); }
    else if (parts[0] === 'history' || parts[0] === 'archive') { tab = 'history'; page = historyPage(); }
    else if (parts[0] === 'settings') { tab = 'settings'; page = settingsPage(); }
    else if (parts[0] === 'goals') { tab = 'settings'; page = goalsPage(); }
    else if (parts[0] === 'notes') page = notesPage();
    else throw new Error('找不到這個頁面');
    if (parts[0] === 'l' && parts[1] !== currentLessonDate()) tab = 'history';
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
  $('#quiet').addEventListener('click', () => setQuiet(!S.settings.quiet));
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
    [PROFILES, CHANGELOG] = await Promise.all([getJSON('data/users.json'), getJSON('data/changelog.json').catch(() => [])]);
    paintBell();
    if (ME && !PROFILES.some((p) => p.slug === ME.slug)) ME = null;
    if (ME) await loadUserData();
  } catch (err) {
    put($('#view'), errorBox(err));
    return;
  }
  window.addEventListener('hashchange', route);
  await route();
  const pull = () => syncNow().then((changed) => { if (changed) refreshIfIdle(); else paintSyncLine(); });
  pull();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (dirty) syncNow(); return; }
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
