// Prebuilt data and read-only teacher data for the signed-in learner: the lesson index and deck
// built by english_daily/site.py (scripts/build.py), lessons and the practice pool loaded on demand, the dictionary, the
// shared profile list and changelog, and the teacher's essay feedback and advisor reports (written
// only by the Mac, cached here). The Store owns everything the learner writes.

import * as core from './core.js?v=61e1476431';
import * as speech from './speech.js?v=61e1476431';
import * as gist from './gist.js?v=61e1476431';
import { readJSON, writeJSON, today, wkey, keyFor } from './store.js?v=61e1476431';

export async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`讀取 ${url} 失敗（${res.status}）`);
  return res.json();
}

const feedbackKey = (slug) => `english-daily:feedback:${slug}`;
const advisorKey = (slug) => `english-daily:advisor:${slug}`;

export class Library {
  constructor(store) {
    this.store = store;
    this.profiles = []; // every learner: {slug, name}
    this.changelog = [];
    this.index = []; // the signed-in learner's lessons, newest first
    this.deck = []; // their vocabulary, oldest first
    this.feedback = {}; // {date: teacher's correction}
    this.advisor = {}; // {date: advisor report}
    this.lessons = new Map(); // date -> Promise of the lesson
    this.poolPromise = null;
    this.dict = {}; // letter -> {word: [ipa, zh, en] | base word}
    this.people = new Map(); // slug -> Promise of another learner's dashboard data
  }

  get base() { return `data/u/${this.store.slug}`; }

  async loadShared() {
    [this.profiles, this.changelog] = await Promise.all([getJSON('data/users.json'), getJSON('data/changelog.json').catch(() => [])]);
  }

  // Load (or switch to) the signed-in learner's lessons and cached teacher data.
  async loadUser() {
    const slug = this.store.slug;
    this.feedback = readJSON(feedbackKey(slug), {}) || {};
    this.advisor = readJSON(advisorKey(slug), {}) || {};
    this.people.clear();
    this.lessons.clear();
    this.poolPromise = null;
    [{ lessons: this.index }, this.deck] = await Promise.all([getJSON(`${this.base}/index.json`), getJSON(`${this.base}/vocab.json`)]);
    for (const v of this.deck) speech.addClips(v.audio);
  }

  // Teacher data fetched for `slug`; ignored if the profile was switched meanwhile.
  setFeedback(slug, fb) {
    if (slug !== this.store.slug) return;
    this.feedback = fb;
    writeJSON(feedbackKey(slug), fb);
  }

  setAdvisor(slug, adv) {
    if (slug !== this.store.slug) return;
    this.advisor = adv;
    writeJSON(advisorKey(slug), adv);
  }

  // The vocabulary deck: every lesson's words plus the words the learner saved from the dictionary.
  fullDeck() {
    return [...this.deck, ...Object.values(this.store.state.words || {}).map((w) => ({ pos: '', example_zh: '', audio: {}, ...w }))];
  }

  currentLessonDate() { return (this.index.find((x) => x.date <= today()) || this.index[this.index.length - 1])?.date; }
  entryFor(date) { return this.index.find((x) => x.date === date) || {}; }
  latestCoach() { return this.index.find((x) => x.date <= today() && x.coach)?.coach || null; }

  // A lesson, fetched once; a failed fetch (offline, not published yet) is retried next time.
  async lesson(date) {
    if (!this.lessons.has(date)) {
      this.lessons.set(date, getJSON(`${this.base}/lessons/${date}.json`)
        .then((L) => { speech.addClips(L.audio); return L; })
        .catch((err) => { this.lessons.delete(date); throw err; }));
    }
    const L = await this.lessons.get(date);
    this.backfillResults(L);
    return L;
  }

  // Score answers that have no result yet: answers given before scores were recorded, or synced
  // from a device running an older version (core.scoreAnswers, the same on every device).
  backfillResults(L) {
    const S = this.store.state;
    if (!S.answers[L.date]) return;
    this.store.addResults(L.date, core.scoreAnswers(L, S.answers[L.date], S.results[L.date]));
  }

  practicePool() {
    this.poolPromise ||= getJSON(`${this.base}/practice.json`)
      .then((pool) => {
        for (const x of [...pool.sentences, ...pool.translate]) if (x.audio) speech.addClips({ [x.en]: x.audio });
        return pool;
      })
      .catch((err) => { this.poolPromise = null; throw err; });
    return this.poolPromise;
  }

  dictLetter(letter) {
    this.dict[letter] ||= getJSON(`data/dict/${letter}.json`).catch(() => { delete this.dict[letter]; return {}; }); // retried next time
    return this.dict[letter];
  }

  // Words due today, then new words up to the daily limit (core.reviewQueue).
  reviewQueue() {
    const t = today();
    return core.reviewQueue(this.fullDeck(), this.store.state.srs, {
      today: t, currentDate: this.currentLessonDate(), room: this.store.settings.newPerDay - this.store.reviewLog(t).introduced, wordKey: wkey,
    });
  }

  // Everything the dashboard shows about one learner. The signed-in learner is the live local
  // state; another learner is this device's cached copy (if it ever used that profile) merged
  // with the gist copy (when this device has the sync token). Nothing here writes their data.
  personData(slug) {
    const { store } = this;
    if (slug === store.slug) {
      return Promise.resolve({ slug, name: store.me.name, self: true, doc: store.state, index: this.index, deck: this.fullDeck(),
        feedback: this.feedback, advisor: this.advisor, synced: Boolean(gist.loadConfig().gistId) });
    }
    if (!this.people.has(slug)) this.people.set(slug, this.loadPerson(slug).catch((err) => { this.people.delete(slug); throw err; }));
    return this.people.get(slug);
  }

  async loadPerson(slug) {
    const name = this.profiles.find((x) => x.slug === slug)?.name || slug;
    const [{ lessons: index }, vocab] = await Promise.all([getJSON(`data/u/${slug}/index.json`), getJSON(`data/u/${slug}/vocab.json`)]);
    let doc = null;
    const cached = readJSON(keyFor(slug));
    if (cached) doc = core.syncDoc(core.migrateState(cached));
    let feedback = {};
    let advisor = readJSON(advisorKey(slug), {}) || {};
    let synced = false;
    const cfg = gist.loadConfig();
    if (cfg.token && cfg.gistId) {
      try {
        const files = await gist.readMany(cfg.token, cfg.gistId, [gist.fileFor(slug), gist.feedbackFor(slug), gist.advisorFor(slug)]);
        const remote = files[gist.fileFor(slug)];
        if (remote) {
          const theirs = core.syncDoc(core.migrateState(remote));
          doc = doc ? core.mergeDocs(doc, theirs) : theirs;
        }
        feedback = files[gist.feedbackFor(slug)] || {};
        advisor = files[gist.advisorFor(slug)] || advisor;
        synced = true;
      } catch { /* offline: show what this device has */ }
    }
    return { slug, name, self: false, doc, index, deck: [...vocab, ...Object.values(doc?.words || {})], feedback, advisor, synced };
  }
}
