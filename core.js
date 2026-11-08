// Pure helpers shared by the app and the Node tests: dates, word alignment for dictation and
// speaking, spaced-repetition scheduling, and the writing checks. No DOM access here.

export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const CONTRACTIONS = [
  // Contractions typed without the apostrophe, common on phone keyboards.
  [/\b(do|does|did|is|are|was|were|has|have|had|could|would|should)nt\b/g, "$1n't"],
  [/\bim\b/g, "i'm"], [/\bive\b/g, "i've"], [/\bdont\b/g, "don't"],
  [/\bcan't\b/g, 'can not'], [/\bcannot\b/g, 'can not'], [/\bwon't\b/g, 'will not'],
  [/n't\b/g, ' not'], [/'re\b/g, ' are'], [/'m\b/g, ' am'], [/'ll\b/g, ' will'],
  [/'ve\b/g, ' have'], [/'d\b/g, ' would'],
];

// Lower-case words with contractions expanded and hyphens split, so "trade-off" said as
// "trade off" and "I'm" recognised as "I am" still count as matches.
export function tokenize(text) {
  let s = String(text).toLowerCase().replace(/[‘’]/g, "'");
  for (const [re, rep] of CONTRACTIONS) s = s.replace(re, rep);
  return s
    .replace(/[-–—]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '').replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

// Align what was said or typed against the target sentence (longest common subsequence).
// Returns the target's display words, each marked ok when all of its tokens were matched.
export function alignWords(target, said) {
  const display = String(target).split(/\s+/).filter(Boolean);
  const owner = [];
  const t = [];
  display.forEach((word, i) => tokenize(word).forEach((tok) => { t.push(tok); owner.push(i); }));
  const s = tokenize(said);
  const n = t.length;
  const m = s.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = t[i] === s[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hit = new Array(n).fill(false);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (t[i] === s[j]) { hit[i] = true; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  const missing = new Set(owner.filter((_, k) => !hit[k]));
  const matched = hit.filter(Boolean).length;
  return {
    words: display.map((word, i) => ({ word, ok: !missing.has(i) })),
    score: n ? matched / n : 0,
    extra: m - matched,
  };
}

// --- Spaced repetition (a small SM-2 variant) ------------------------------------------------

export const GRADE = { again: 0, hard: 1, good: 2, easy: 3 };
const FIRST = [0, 1, 1, 3];
const SECOND = [0, 2, 3, 5];
const EASE_STEP = [-0.2, -0.15, 0, 0.15];

export function newCard(today) {
  return { reps: 0, interval: 0, ease: 2.5, lapses: 0, due: today };
}

// Return the card's next state after a grade on `today`. "Again" keeps it due today so the
// review session shows it once more.
export function schedule(card, grade, today) {
  const c = { ...newCard(today), ...card };
  c.ease = Math.min(3, Math.max(1.3, c.ease + EASE_STEP[grade]));
  if (grade === GRADE.again) {
    if (c.reps > 0) c.lapses += 1;
    c.reps = 0;
    c.interval = 0;
    c.due = today;
  } else {
    let next;
    if (c.reps === 0) next = FIRST[grade];
    else if (c.reps === 1) next = SECOND[grade];
    else next = Math.round(c.interval * (grade === GRADE.hard ? 1.2 : grade === GRADE.good ? c.ease : c.ease * 1.3));
    c.interval = Math.max(1, next, grade === GRADE.hard ? c.interval : c.interval + 1);
    c.reps += 1;
    c.due = addDays(today, c.interval);
  }
  c.last = today;
  return c;
}

export function isDue(card, today) {
  return Boolean(card) && card.due <= today;
}

// --- Writing ---------------------------------------------------------------------------------

export function wordCount(text) {
  return (String(text).match(/[A-Za-z0-9'’]+(?:-[A-Za-z0-9'’]+)*/g) || []).length;
}

function stem(token) {
  return token.length <= 4 ? token : token.slice(0, Math.max(4, token.length - 2));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

function phrasePattern(phrase) {
  const tokens = String(phrase).toLowerCase().match(/[a-z0-9'-]+/g) || [];
  if (!tokens.length) return null;
  const gap = "[^a-z0-9]+(?:[a-z0-9'-]+[^a-z0-9]+){0,2}";
  return tokens.map((t) => `\\b${escapeRe(stem(t))}[a-z0-9'-]*`).join(gap);
}

// Same rule as scripts/lessons.py mentions(): words in order, inflections and up to two
// words in between allowed.
export function mentions(text, phrase) {
  const p = phrasePattern(phrase);
  return p ? new RegExp(p).test(String(text).toLowerCase().replace(/’/g, "'")) : false;
}

// Character ranges in `text` where any of `phrases` occurs, for highlighting vocabulary.
export function findPhrases(text, phrases) {
  const lower = String(text).toLowerCase().replace(/’/g, "'");
  const hits = [];
  phrases.forEach((phrase, index) => {
    const p = phrasePattern(phrase);
    if (!p) return;
    const re = new RegExp(p, 'g');
    for (let m = re.exec(lower); m; m = re.exec(lower)) hits.push({ start: m.index, end: m.index + m[0].length, index });
  });
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  for (const h of hits) if (!out.length || h.start >= out[out.length - 1].end) out.push(h);
  return out;
}

// Grammar formulas such as "I'd suggest (that) + S + V（原形）?" split into blocks for the
// diagram: fixed words, slots the learner fills in (S, V, V-ing, Chinese labels…), optional
// words in ASCII parentheses, and trailing punctuation.
const SLOT = /^(S|V|O|N|V-?ing|V-?ed|p\.?p\.?|adj\.?|adv\.?|sb|sth|to V)$/;
const CJK = /[㐀-鿿]/;

export function formulaParts(form) {
  const out = [];
  for (const raw of String(form).split(/\s+\+\s+/)) {
    let token = raw.trim();
    const punct = token.match(/[?.!]+$/)?.[0];
    if (punct) token = token.slice(0, -punct.length).trim();
    for (const piece of token.split(/(\([^)]*\))/).map((p) => p.trim()).filter(Boolean)) {
      const base = piece.replace(/（[^）]*）/g, '').trim();
      const kind = /^\(.*\)$/.test(piece) ? 'opt' : SLOT.test(base) || CJK.test(base) ? 'slot' : 'word';
      out.push({ text: piece, kind });
    }
    if (punct) out.push({ text: punct, kind: 'punct' });
  }
  return out;
}

// Position (percent across the track) of a timeline point from -3 (long ago) to 3 (later).
export const timelinePct = (v) => 6 + ((Math.max(-3, Math.min(3, v)) + 3) / 6) * 88;

// Order to work through a lesson: vocabulary first (its words come back in the reading and
// dialogue), then the suggested weakest skill, then the rest in list order.
export function sectionOrder(ids, suggested) {
  return [...new Set([ids[0], suggested, ...ids].filter(Boolean))];
}

// The section to go to after finishing `after`: the first unfinished one in that order.
export function nextSection(ids, done, suggested, after) {
  return sectionOrder(ids, suggested).find((id) => id !== after && !done[id]) || null;
}

export function normalizeAnswer(s) {
  return String(s).toLowerCase().replace(/’/g, "'").replace(/[.!?,;:]+$/g, '').replace(/\s+/g, ' ').trim();
}

export function checkFill(item, value) {
  const given = normalizeAnswer(value);
  return [item.answer, ...(item.accept || [])].some((a) => normalizeAnswer(a) === given);
}

export function gradingPrompt({ level, task, mustUse, text }) {
  return [
    `你是一位英文寫作老師。請批改下面這篇 ${level} 程度學習者的英文作文。`,
    `題目：${task}`,
    `必須用到：${mustUse.join('、')}`,
    '',
    '請用繁體中文回答，依序列出：',
    '1. 文法與用字錯誤（原句 → 改正，並說明原因）',
    '2. 可以更自然、更道地的說法',
    '3. 1～10 分的分數與一句總評',
    '4. 修改後的完整版本',
    '',
    '我的作文：',
    '"""',
    text.trim(),
    '"""',
  ].join('\n');
}

// --- Progress state, migration and cross-device merge ---------------------------------------

// Fields that sync between devices. Settings and the sync token stay on each device.
export const SYNCED = ['done', 'answers', 'results', 'srs', 'mistakes', 'pending', 'activity', 'reviewLog', 'practice', 'profile', 'words', 'notes'];
export const PROFILE_NOTE_ID = 'profile-note'; // the note migrated from the old single profile.note field
export const STATE_VERSION = 2;

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const stamped = (x) => isObj(x) && 'v' in x && 't' in x;

// Upgrade a stored state from any earlier shape. Version 1 stored plain answers, `true` for done
// sections, and arrays of mistakes and pending speaking items; version 2 timestamps everything so
// devices can merge.
export function migrateState(raw) {
  const s = isObj(raw) ? { ...raw } : {};
  for (const key of SYNCED) if (!isObj(s[key])) s[key] = {};
  for (const [date, items] of Object.entries(s.answers)) {
    s.answers[date] = Object.fromEntries(Object.entries(items || {}).map(([k, v]) => [k, stamped(v) ? v : { v, t: 0 }]));
  }
  for (const [date, secs] of Object.entries(s.done)) {
    s.done[date] = Object.fromEntries(Object.entries(secs || {}).map(([k, v]) => [k, typeof v === 'number' ? v : 1]));
  }
  if (Array.isArray(raw?.mistakes)) {
    s.mistakes = Object.fromEntries(raw.mistakes.map((m) => [`${m.date}|${m.kind}|${m.i}`, { ...m, t: 0, fixed: false }]));
  }
  if (Array.isArray(raw?.pendingSpeak)) {
    for (const id of raw.pendingSpeak) s.pending[id] = { t: 0, done: false };
  }
  delete s.pendingSpeak;
  for (const [word, card] of Object.entries(s.srs)) if (isObj(card) && !('t' in card)) s.srs[word] = { ...card, t: 0 };
  // The free-text "tell the teacher" field became the notes board: move it once, under a fixed id
  // so two devices migrating separately still merge into one note.
  if (isObj(s.profile) && 'note' in s.profile) {
    const { note, ...rest } = s.profile;
    if (typeof note === 'string' && note.trim() && !s.notes[PROFILE_NOTE_ID]) {
      s.notes[PROFILE_NOTE_ID] = { id: PROFILE_NOTE_ID, t: rest.t || 0, text: note.trim() };
    }
    s.profile = rest;
  }
  s.v = STATE_VERSION;
  return s;
}

export function syncDoc(state) {
  const doc = { v: STATE_VERSION };
  for (const key of SYNCED) doc[key] = state[key] || {};
  return doc;
}

const newer = (a, b) => ((b?.t || 0) > (a?.t || 0) ? b : a);

function mergeMap(a, b, pick) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) out[k] = k in out ? pick(out[k], v) : v;
  return out;
}
const mergeNested = (a, b, pick) => mergeMap(a, b, (x, y) => mergeMap(x, y, pick));

// Merge two synced documents. Every entry carries a timestamp and the newer one wins, so the
// result does not depend on which device merges first.
export function mergeDocs(a, b) {
  return {
    v: STATE_VERSION,
    done: mergeNested(a.done, b.done, (x, y) => Math.max(x, y)),
    answers: mergeNested(a.answers, b.answers, newer),
    results: mergeNested(a.results, b.results, newer),
    srs: mergeMap(a.srs, b.srs, newer),
    mistakes: mergeMap(a.mistakes, b.mistakes, newer),
    pending: mergeMap(a.pending, b.pending, newer),
    activity: mergeMap(a.activity, b.activity, (x, y) => x || y),
    reviewLog: mergeMap(a.reviewLog, b.reviewLog, (x, y) => ({
      reviewed: Math.max(x.reviewed || 0, y.reviewed || 0),
      introduced: Math.max(x.introduced || 0, y.introduced || 0),
    })),
    practice: mergeNested(a.practice, b.practice, (x, y) => (y[1] > x[1] ? y : x)),
    profile: newer(a.profile || {}, b.profile || {}),
    words: mergeMap(a.words, b.words, newer),
    notes: mergeMap(a.notes, b.notes, newer),
  };
}

// --- Notes to the teacher ---------------------------------------------------------------------
// notes: {id: {id, t, text, skill?, closed?}}; a note is never deleted, "closed" keeps it as a
// tombstone. Lessons answer notes through their `replies` ([{to: id, zh}]), carried by the index.

// Replies the lessons gave to one note, oldest first: [{date, zh}].
export function noteReplies(note, index) {
  return (index || [])
    .flatMap((x) => (x.replies || []).filter((r) => r.to === note.id).map((r) => ({ date: x.date, zh: r.zh })))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Open and closed notes (newest first) with their replies, plus the counts the home card shows.
// `seenDate` is the newest reply date the learner has already opened the board for.
export function notesSummary(notes, index, seenDate = '') {
  const all = Object.values(notes || {})
    .filter((n) => isObj(n) && typeof n.text === 'string' && n.text.trim())
    .map((n) => ({ ...n, replies: noteReplies(n, index) }));
  const open = all.filter((n) => !n.closed).sort((a, b) => (b.t || 0) - (a.t || 0));
  const closed = all.filter((n) => n.closed).sort((a, b) => b.closed - a.closed);
  const replied = open.filter((n) => n.replies.length);
  const unseen = replied.filter((n) => n.replies[n.replies.length - 1].date > seenDate).length;
  const latestReply = all.reduce((m, n) => n.replies.reduce((mm, r) => (r.date > mm ? r.date : mm), m), '');
  return { open, closed, replied: replied.length, unseen, latestReply };
}

// JSON with sorted keys, so two documents with the same content compare equal.
export function stableStringify(x) {
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(',')}]`;
  if (isObj(x)) return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(x[k])}`).join(',')}}`;
  return JSON.stringify(x);
}

export const sameDoc = (a, b) => stableStringify(a) === stableStringify(b);

// --- Skill statistics (same prefixes as scripts/progress.py SKILLS) ---------------------------

export const SKILLS = {
  reading: ['read'], listening: ['listen', 'dict'], grammar: ['grammar', 'review'], speaking: ['shadow'], writing: ['trans', 'write'],
};
export const SKILL_ZH = { reading: '閱讀', listening: '聽力', grammar: '文法', speaking: '口說', writing: '寫作' };

export function skillOf(key) {
  const prefix = String(key).split('.')[0];
  return Object.keys(SKILLS).find((s) => SKILLS[s].includes(prefix)) || null;
}

// Mean score and attempt count per skill over the most recent `window` lessons with answers.
export function skillStats(results, window = 7) {
  const dates = Object.keys(results || {})
    .filter((d) => Object.keys(results[d]).some((k) => skillOf(k)))
    .sort()
    .slice(-window);
  const acc = Object.fromEntries(Object.keys(SKILLS).map((s) => [s, []]));
  for (const d of dates) {
    for (const [k, r] of Object.entries(results[d])) {
      const s = skillOf(k);
      if (s && typeof r?.s === 'number') acc[s].push(r.s);
    }
  }
  const stats = Object.fromEntries(Object.entries(acc).map(([s, v]) => [s, {
    acc: v.length ? v.reduce((x, y) => x + y, 0) / v.length : null, n: v.length,
  }]));
  return { lessons: dates.length, stats };
}

// --- Dashboard (same rules as scripts/advisor.py) ---------------------------------------------

export const SESSION_GAP_MS = 5 * 60 * 1000;
export const MASTERED_INTERVAL = 21;
export const DAYPARTS = [['清晨', 0, 6], ['早上', 6, 11], ['中午', 11, 14], ['下午', 14, 18], ['晚上', 18, 23], ['深夜', 23, 24]];

// Every real answer, section and word-review time (ms) in a progress document.
export function eventTimes(doc) {
  const out = new Set();
  const real = (t) => typeof t === 'number' && t > 1e12;
  for (const days of [doc?.answers, doc?.results]) {
    for (const items of Object.values(days || {})) for (const v of Object.values(items || {})) if (real(v?.t)) out.add(v.t);
  }
  for (const marks of Object.values(doc?.done || {})) for (const t of Object.values(marks || {})) if (real(t)) out.add(t);
  for (const c of Object.values(doc?.srs || {})) if (real(c?.t)) out.add(c.t);
  return [...out].sort((a, b) => a - b);
}

// {local day: {minutes, events}}. A gap over SESSION_GAP_MS starts a new sitting (counted as 1 minute).
export function dayActivity(doc) {
  const byDay = {};
  for (const t of eventTimes(doc)) (byDay[localDate(new Date(t))] ||= []).push(t);
  const out = {};
  for (const [day, ts] of Object.entries(byDay)) {
    let ms = 60000;
    for (let i = 1; i < ts.length; i++) { const gap = ts[i] - ts[i - 1]; ms += gap <= SESSION_GAP_MS ? gap : 60000; }
    out[day] = { minutes: Math.round(ms / 60000), events: ts.length };
  }
  for (const [day, on] of Object.entries(doc?.activity || {})) if (on && !out[day]) out[day] = { minutes: 0, events: 0 };
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export function streakOf(days, today) {
  const have = new Set(days);
  let d = have.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (have.has(d)) { n += 1; d = addDays(d, -1); }
  return n;
}

// {skill: [[lesson date, mean score]]}, oldest first, for lessons with answers in that skill.
export function skillSeries(results) {
  const out = Object.fromEntries(Object.keys(SKILLS).map((s) => [s, []]));
  for (const date of Object.keys(results || {}).sort()) {
    const by = {};
    for (const [k, r] of Object.entries(results[date] || {})) {
      const s = skillOf(k);
      if (s && typeof r?.s === 'number') (by[s] ||= []).push(r.s);
    }
    for (const [s, v] of Object.entries(by)) out[s].push([date, v.reduce((a, b) => a + b, 0) / v.length]);
  }
  return out;
}

// Per grammar point (taught or reviewed): {point, zh, acc, n, first}, in the order first taught.
export function grammarMastery(results, entries) {
  const points = new Map();
  const add = (point, zh, date, prefix) => {
    if (!point) return;
    const p = points.get(point) || { point, zh, first: date, scores: [] };
    p.zh ||= zh;
    if (date < p.first) p.first = date;
    for (const [k, r] of Object.entries(results?.[date] || {})) if (k.startsWith(`${prefix}.`) && typeof r?.s === 'number') p.scores.push(r.s);
    points.set(point, p);
  };
  // Oldest first, so each point keeps the name from the lesson that taught it.
  for (const e of [...(entries || [])].sort((a, b) => a.date.localeCompare(b.date))) {
    add(e.grammar, e.grammar_zh, e.date, 'grammar');
    add(e.review, e.review_zh, e.date, 'review');
  }
  return [...points.values()].filter((p) => p.scores.length)
    .map(({ scores, ...p }) => ({ ...p, n: scores.length, acc: scores.reduce((a, b) => a + b, 0) / scores.length }))
    .sort((a, b) => a.first.localeCompare(b.first));
}

export function dayparts(doc) {
  const counts = Object.fromEntries(DAYPARTS.map(([name]) => [name, 0]));
  for (const t of eventTimes(doc)) {
    const hour = new Date(t).getHours();
    counts[DAYPARTS.find(([, lo, hi]) => hour >= lo && hour < hi)[0]] += 1;
  }
  return DAYPARTS.map(([name]) => [name, counts[name]]);
}

// Word cards by state: often forgotten (a lapse or a lowered ease), well known, still learning.
export function vocabStatus(srs, weakEase = 2.4) {
  const out = { mastered: 0, learning: 0, weak: 0 };
  for (const c of Object.values(srs || {})) {
    if (!c || typeof c !== 'object') continue;
    if ((c.lapses || 0) > 0 || (c.ease ?? 2.5) < weakEase) out.weak += 1;
    else if ((c.interval || 0) >= MASTERED_INTERVAL) out.mastered += 1;
    else out.learning += 1;
  }
  return out;
}
