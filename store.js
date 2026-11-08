// The learner's progress on this device. One Store owns the state document (answers, scores,
// word cards, notes, settings), persists it to localStorage under one key per learner and exposes
// the few named operations the pages use. Cross-device merging is in sync.js; the document's
// shape and merge rules are in core.js.

import * as core from './core.js?v=4fbc7a9ae0';

const ME_KEY = 'english-daily:me';
const LEGACY_KEY = 'english-daily:v1'; // progress from before profiles: it belonged to the first learner
export const DEFAULT_SETTINGS = { quiet: false, rate: 1, voice: '', newPerDay: 10, reviewMode: 'recognize', practiceMode: 'dict' };

export const now = () => Date.now();
export const today = () => core.localDate();
export const wkey = core.wkey;
export const isWeak = (card) => core.isWeakCard(card);
export const keyFor = (slug) => `english-daily:v1:${slug}`; // one progress document per learner

// localStorage can be missing or blocked (private mode): every access degrades to memory only.
export function readJSON(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
export function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}
export function readText(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}
export function writeText(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
}
export function removeKey(key) {
  try { localStorage.removeItem(key); } catch { /* storage blocked */ }
}

export const freshState = () => ({ ...core.migrateState({}), settings: { ...DEFAULT_SETTINGS } });
export const withSettings = (raw) => ({ ...core.migrateState(raw), settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) } });

export class Store {
  constructor() {
    this.me = readJSON(ME_KEY);
    this.state = this.me ? this.loadState() : freshState();
    this.dirty = false; // changed since the last successful sync
    this.onSave = () => {}; // set by the app: schedule a sync
    this.onAnswer = () => {}; // set by the app: repaint the unanswered markers
  }

  get slug() { return this.me?.slug; }
  get settings() { return this.state.settings; }
  get key() { return keyFor(this.me.slug); }

  loadState() {
    const raw = readJSON(this.key);
    return raw && typeof raw === 'object' ? withSettings(raw) : freshState();
  }

  // Settings changes use persist(): they never sync. Learner progress uses save().
  persist() { if (this.me) writeJSON(this.key, this.state); }

  save() {
    this.persist();
    this.dirty = true;
    this.onSave();
  }

  replaceState(state) {
    this.state = state;
  }

  // Apply a merged document from the gist without losing anything typed meanwhile.
  merge(doc) {
    Object.assign(this.state, doc);
    this.persist();
  }

  touch() { this.state.activity[today()] = true; }

  // Settings stay on this device: persisted, never synced.
  setSetting(key, value) {
    this.state.settings[key] = value;
    this.persist();
  }

  // Goals, interests and minutes a day: stamped so devices merge on the newest save.
  setProfile({ goals = [], interests = [], minutes }) {
    this.state.profile = { goals, interests, minutes, t: now() };
    this.touch();
    this.save();
  }

  // --- Profiles -------------------------------------------------------------------------------

  choose(profile, firstSlug) {
    this.me = { slug: profile.slug, name: profile.name };
    writeJSON(ME_KEY, this.me);
    try {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy && profile.slug === firstSlug && !localStorage.getItem(this.key)) {
        localStorage.setItem(this.key, legacy);
        localStorage.removeItem(LEGACY_KEY);
      }
    } catch { /* storage blocked */ }
    this.state = this.loadState();
    this.dirty = false;
  }

  signOut() {
    this.me = null;
    removeKey(ME_KEY);
    this.state = freshState();
    this.dirty = false;
  }

  // --- Answers and scores ---------------------------------------------------------------------

  ans(date, key) { return this.state.answers[date]?.[key]?.v; }

  answered(date, key) {
    const v = this.ans(date, key);
    return v != null && v !== '';
  }

  // Store an answer; `score` (0..1) also records a result that progress analysis uses.
  setAns(date, key, value, score) {
    (this.state.answers[date] ||= {})[key] = { v: value, t: now() };
    if (typeof score === 'number' && Number.isFinite(score)) {
      (this.state.results[date] ||= {})[key] = { s: Math.round(score * 1000) / 1000, t: now() };
    }
    this.touch();
    this.save();
    this.onAnswer();
  }

  answerStore(date, key) {
    return {
      get: () => this.ans(date, key),
      set: (value, ok) => this.setAns(date, key, value, ok == null ? undefined : ok ? 1 : 0),
    };
  }

  activeMistakes() {
    return Object.values(this.state.mistakes).filter((m) => !m.fixed).sort((a, b) => a.t - b.t);
  }

  recordMistake(m, correct) {
    const id = `${m.date}|${m.kind}|${m.i}`;
    const cur = this.state.mistakes[id];
    if (!correct && (!cur || cur.fixed)) this.state.mistakes[id] = { date: m.date, kind: m.kind, i: m.i, t: now(), fixed: false };
    else if (correct && cur && !cur.fixed) this.state.mistakes[id] = { ...cur, t: now(), fixed: true };
    else return;
    this.save();
  }

  // --- Speaking left for later ----------------------------------------------------------------

  pendingIds() {
    return Object.entries(this.state.pending).filter(([, p]) => !p.done).map(([id]) => id).sort();
  }

  addPending(id) {
    if (this.state.pending[id] && !this.state.pending[id].done) return;
    this.state.pending[id] = { t: now(), done: false };
    this.save();
  }

  removePending(id) {
    if (!this.state.pending[id] || this.state.pending[id].done) return;
    this.state.pending[id] = { t: now(), done: true };
    this.save();
  }

  // --- Word cards, sections, practice ---------------------------------------------------------

  card(word) { return this.state.srs[wkey(word)]; }
  setCard(word, card) { this.state.srs[wkey(word)] = { ...card, t: now() }; }

  // A word saved from the dictionary joins the deck and tomorrow's review.
  addWord(entry) {
    const key = wkey(entry.word);
    this.state.words[key] = { ...entry, date: today(), t: now() };
    if (!this.state.srs[key]) this.setCard(entry.word, { ...core.newCard(today()), due: core.addDays(today(), 1) });
    this.touch();
    this.save();
  }

  // Scores computed later for answers that had none (see core.scoreAnswers).
  addResults(date, scores) {
    const res = (this.state.results[date] ||= {});
    const answers = this.state.answers[date] || {};
    let added = 0;
    for (const [key, s] of Object.entries(scores)) {
      if (res[key]) continue;
      res[key] = { s: Math.round(s * 1000) / 1000, t: answers[key]?.t || 0 };
      added += 1;
    }
    if (added) this.save();
    return added;
  }

  // Today's review counters, read fresh each time: a sync may replace the reviewLog object.
  reviewLog(date) { return this.state.reviewLog[date] || { reviewed: 0, introduced: 0 }; }

  logReview(date, { reviewed = 0, introduced = 0 }) {
    const cur = this.reviewLog(date);
    this.state.reviewLog[date] = { reviewed: cur.reviewed + reviewed, introduced: cur.introduced + introduced };
    this.touch();
  }

  isDone(date, id) { return Boolean(this.state.done[date]?.[id]); }

  markDone(date, id) {
    (this.state.done[date] ||= {})[id] = now();
    this.touch();
  }

  logPractice(mode, ok) {
    const day = (this.state.practice[today()] ||= {});
    const [right, total] = day[mode] || [0, 0];
    day[mode] = [right + (ok ? 1 : 0), total + 1];
    this.touch();
    this.save();
  }

  // Consecutive days with any activity, counted the way the dashboard counts them.
  streak() {
    return core.streakOf(Object.keys(core.dayActivity(this.state)), today());
  }

  // --- Notes to the teacher -------------------------------------------------------------------

  addNote(text, skill) {
    const id = `${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.state.notes[id] = { id, t: now(), text, ...(skill ? { skill } : {}) };
    this.touch();
    this.save();
  }

  setNoteClosed(id, closed) {
    const n = this.state.notes[id];
    if (!n) return;
    const { closed: _was, ...rest } = n;
    this.state.notes[id] = closed ? { ...rest, t: now(), closed: now() } : { ...rest, t: now() };
    this.save();
  }
}
