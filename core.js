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

// Same rule as english_daily/lessons.py mentions(): words in order, inflections and up to two
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

// The app can stay open for days, and nothing reloads it when a lesson is published. Whether to
// look for a new lesson list (`index` is newest first): today's lesson is not in it and the last
// look was a while ago.
export const INDEX_CHECK_MS = 10 * 60 * 1000;
export const indexStale = (index, today, sinceLastCheckMs) => !(index?.[0]?.date >= today) && sinceLastCheckMs >= INDEX_CHECK_MS;

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

export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// A translation scored against the reference and every accepted alternative.
export const translationScore = (t, value) => Math.max(...[t.en, ...(t.alt || [])].map((r) => alignWords(r, value).score));

// The automatic essay checks: word count within the task's range, every must-use phrase present.
export function writingChecks(writing, text) {
  const n = wordCount(text);
  return [
    { ok: n >= writing.min_words && n <= writing.max_words, label: `字數 ${n}（目標 ${writing.min_words}～${writing.max_words}）` },
    ...writing.must_use.map((p) => ({ ok: mentions(text, p), label: `用到「${p}」` })),
  ];
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
export const SYNCED = ['done', 'answers', 'results', 'srs', 'mistakes', 'pending', 'activity', 'reviewLog', 'practice', 'profile', 'words', 'notes', 'weekly'];
export const PROFILE_NOTE_ID = 'profile-note'; // the note migrated from the old single profile.note field
export const STATE_VERSION = 2;

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const stamped = (x) => isObj(x) && 'v' in x && 't' in x;

// Upgrade a stored state from any earlier shape. Version 1 stored plain answers, `true` for done
// sections, and arrays of mistakes and pending speaking items; version 2 timestamps everything so
// devices can merge.
export function migrateState(raw) {
  const s = isObj(raw) ? { ...raw } : {};
  for (const key of SYNCED) s[key] = isObj(s[key]) ? { ...s[key] } : {}; // copies: the input stays untouched
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

// One week's review test taken on two devices. The questions are those of a device that handed
// the test in (else of whichever started first); an answer is final once given, so the earlier
// one stays; the test is finished as soon as either device finished it.
function mergeWeekly(a, b) {
  const rank = (r) => [r.done ? 0 : 1, r.started || 0, stableStringify(r.plan || [])];
  const [ra, rb] = [rank(a), rank(b)];
  const k = ra.findIndex((x, i) => x !== rb[i]);
  const { done: _done, ...base } = k >= 0 && rb[k] < ra[k] ? b : a;
  const done = Math.min(a.done || Infinity, b.done || Infinity);
  const earlier = (x, y) => {
    const [tx, ty] = [x?.t || 0, y?.t || 0];
    return ty < tx || (ty === tx && stableStringify(y) < stableStringify(x)) ? y : x;
  };
  return { ...base, t: Math.max(a.t || 0, b.t || 0), items: mergeMap(a.items, b.items, earlier), ...(Number.isFinite(done) ? { done } : {}) };
}

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
    weekly: mergeMap(a.weekly, b.weekly, mergeWeekly),
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

// The top-level fields of a remote document this build does not know (a newer build on another
// device added them): the sync writes them back untouched instead of dropping them.
export function unknownFields(raw) {
  return Object.fromEntries(Object.entries(isObj(raw) ? raw : {}).filter(([k]) => k !== 'v' && !SYNCED.includes(k)));
}

// --- Answer keys (the same table as english_daily/lessons.py ITEMS) ---------------------------
// Every answer is stored under "<prefix>.<index>" (write.submitted for the essay). This table says
// which section and skill a prefix belongs to, how it is scored, and where its items sit in the
// lesson; everything that walks answers (scoring, history, mistakes, statistics) derives from it.

export const ITEMS = {
  vocab: { section: 'vocab', skill: 'vocabulary', zh: '單字小測驗', scoring: 'question', of: (L) => vocabQuiz(L) },
  read: { section: 'read', skill: 'reading', zh: '閱讀', scoring: 'question', of: (L) => L.reading.questions },
  listen: { section: 'listen', skill: 'listening', zh: '聽力', scoring: 'question', of: (L) => L.listening.questions },
  dict: { section: 'listen', skill: 'listening', zh: '聽寫', scoring: 'spoken', of: (L) => L.listening.dictation },
  grammar: { section: 'grammar', skill: 'grammar', zh: '文法', scoring: 'question', of: (L) => L.grammar.exercises },
  review: { section: 'grammar', skill: 'grammar', zh: '文法複習', scoring: 'question', of: (L) => L.grammar.review?.exercises },
  shadow: { section: 'speak', skill: 'speaking', zh: '跟讀', scoring: 'spoken', of: (L) => L.speaking.shadowing },
  prompt: { section: 'speak', skill: null, zh: '口說回答', scoring: 'prompt', of: (L) => L.speaking.prompts },
  trans: { section: 'write', skill: 'writing', zh: '翻譯', scoring: 'translation', of: (L) => L.translation },
  write: { section: 'write', skill: 'writing', zh: '寫作', scoring: 'essay', of: () => [1] },
  'ch.read': { section: 'challenge', skill: null, zh: '挑戰閱讀', scoring: 'question', of: (L) => L.challenge?.reading.questions },
  'ch.listen': { section: 'challenge', skill: null, zh: '挑戰聽力', scoring: 'question', of: (L) => L.challenge?.listening.questions },
  'ch.dict': { section: 'challenge', skill: null, zh: '挑戰聽寫', scoring: 'spoken', of: (L) => L.challenge?.listening.dictation },
};

// {skill: [prefixes]}, derived from ITEMS (reading [read], listening [listen, dict], ...).
export const SKILLS = Object.entries(ITEMS).reduce((out, [prefix, item]) => {
  if (item.skill) (out[item.skill] ||= []).push(prefix);
  return out;
}, {});
export const SKILL_ZH = { vocabulary: '單字', reading: '閱讀', listening: '聽力', grammar: '文法', speaking: '口說', writing: '寫作' };

// {section: [prefixes]} for the lesson sections, and the challenge's prefixes.
export const SECTION_ITEMS = Object.entries(ITEMS).reduce((out, [prefix, item]) => {
  if (item.section !== 'challenge') (out[item.section] ||= []).push(prefix);
  return out;
}, {});
export const CHALLENGE_ITEMS = Object.keys(ITEMS).filter((p) => ITEMS[p].section === 'challenge');

// The lesson sections in the order the app lists them, and the free-practice modes (same values
// in english_daily/lessons.py SECTION_IDS and PRACTICE_MODES, which the advisor's actions use).
export const SECTION_IDS = ['vocab', 'read', 'grammar', 'listen', 'speak', 'write'];
export const PRACTICE_MODE_IDS = ['dict', 'shadow', 'vocab', 'grammar', 'order', 'trans'];
// Where an advisor method's `action` opens in the app, or null (the same values pass
// english_daily/gist.py ADVISOR_ACTIONS): practice:<mode>, lesson:<section> or a plain name.
export const ADVISOR_PLAIN_ACTIONS = { review: '#/review', history: '#/history', goals: '#/goals', weekly: '#/weekly', challenge: null };
export function advisorHref(action, currentDate) {
  const [kind, arg] = String(action || '').split(':');
  if (kind === 'practice') return PRACTICE_MODE_IDS.includes(arg) ? `#/practice/${arg}` : null;
  if (kind === 'lesson') return SECTION_IDS.includes(arg) ? `#/l/${currentDate}/${arg}` : null;
  if (arg !== undefined || !(kind in ADVISOR_PLAIN_ACTIONS)) return null;
  return ADVISOR_PLAIN_ACTIONS[kind] || `#/l/${currentDate}/${kind}`; // challenge belongs to the current lesson
}
export const REAL_TIME_MS = 1e12; // timestamps below this are placeholders from before timestamps existed

// The key a word is stored under (cards, saved words).
export const wkey = (word) => word.trim().toLowerCase();

// The example sentence with the word blanked out.
export function clozeOf(v) {
  const hit = findPhrases(v.example, [v.word])[0];
  return hit ? `${v.example.slice(0, hit.start)}_____${v.example.slice(hit.end)}` : v.example;
}

// The quiz the vocabulary section gives on a lesson's eight words: one question per word, in word
// order, cycling through three forms so that recognising the meaning, picking the word for a
// definition and spelling the word into its own example are all practised. Wrong options are the
// other words of the same lesson. Everything is derived from the lesson with no randomness, so
// every device and english_daily/lessons.py vocab_quiz build the very same questions (answer keys
// "vocab.<i>" point at word i).
export const QUIZ_FORMS = ['meaning', 'cloze', 'word'];
const QUIZ_OPTIONS = 4;

// One question about word `i` of a lesson's vocabulary in the given form (QUIZ_FORMS); the weekly
// review asks every word in a form the lesson's own quiz did not use. Same as lessons.vocab_question.
export function vocabQuestion(vocab, i, form) {
  const v = vocab[i];
  if (!v) return undefined;
  if (form === 'cloze') {
    const hit = findPhrases(v.example, [v.word])[0];
    const used = hit ? v.example.slice(hit.start, hit.end) : '';
    return {
      form, type: 'fill',
      q: hit ? `${v.example.slice(0, hit.start)}___${v.example.slice(hit.end)}` : `___（${v.definition}）`,
      answer: v.word, accept: used && used.toLowerCase() !== v.word.toLowerCase() ? [used] : [],
      hint_zh: `${v.zh}（${v.pos}）`, explain_zh: `${v.zh}：${v.definition}`,
    };
  }
  const field = form === 'meaning' ? 'zh' : 'word';
  const correct = v[field];
  const others = [];
  for (let k = 1; k < vocab.length && others.length < QUIZ_OPTIONS - 1; k++) {
    const candidate = vocab[(i + k) % vocab.length][field];
    if (candidate !== correct && !others.includes(candidate)) others.push(candidate);
  }
  const answer = (i + 2) % (others.length + 1);
  const options = [...others.slice(0, answer), correct, ...others.slice(answer)];
  return {
    form, type: 'mcq', q: form === 'meaning' ? `「${v.word}」是什麼意思？` : `哪個字的意思是「${v.definition}」？`,
    options, answer, explain_zh: `${v.word}：${v.zh}。${v.example}`,
  };
}

export function vocabQuiz(L) {
  const vocab = L.vocab || [];
  return vocab.map((_, i) => vocabQuestion(vocab, i, QUIZ_FORMS[i % QUIZ_FORMS.length]));
}

// "ch.read.0" -> "ch.read", "write.submitted" -> "write": everything before the last dot.
export function prefixOf(key) {
  const s = String(key);
  const i = s.lastIndexOf('.');
  return i < 0 ? s : s.slice(0, i);
}
export const skillOf = (key) => ITEMS[prefixOf(key)]?.skill || null;

// The lesson item an answer key points at (a question, a sentence, a translation...).
export function itemOf(lesson, key) {
  const prefix = prefixOf(key);
  const index = String(key).slice(prefix.length + 1);
  if (prefix === 'write') return index === 'submitted' ? lesson.writing : undefined;
  return /^\d+$/.test(index) ? ITEMS[prefix]?.of(lesson)?.[Number(index)] : undefined;
}

// The score (0..1) of one answer to a question, a dictated or spoken sentence or a translation;
// undefined when the answer carries no score (nothing typed, quiet mode).
export function scoreItem(scoring, item, a) {
  if (a == null) return undefined;
  if (scoring === 'question') return (item.type === 'fill' ? checkFill(item, a) : a === item.answer) ? 1 : 0;
  if (scoring === 'spoken') return typeof a === 'string' && a && a !== 'quiet' ? alignWords(item, a).score : undefined;
  if (scoring === 'translation') return typeof a === 'string' && a ? translationScore(item, a) : undefined;
  return undefined;
}

// Scores for answers that have none yet: {key: score}. Questions are right or wrong, spoken and
// typed sentences are aligned with the original, translations with the reference (and its
// alternatives), the essay by its automatic checks. Every device computes the same values.
export function scoreAnswers(lesson, answers, results = {}) {
  const out = {};
  for (const [key, entry] of Object.entries(answers || {})) {
    if (results[key]) continue;
    const a = entry?.v;
    const item = itemOf(lesson, key);
    if (a == null || item === undefined) continue;
    const scoring = ITEMS[prefixOf(key)]?.scoring;
    let score = scoreItem(scoring, item, a);
    if (scoring === 'essay' && a) {
      const draft = answers['write.draft']?.v;
      if (typeof draft === 'string') { const checks = writingChecks(item, draft); score = checks.filter((c) => c.ok).length / checks.length; }
    }
    if (typeof score === 'number' && Number.isFinite(score)) out[key] = score;
  }
  return out;
}

// The answer keys a lesson-index entry has for the given prefixes ({items: {prefix: count}}).
export function itemKeys(entry, prefixes) {
  return prefixes.flatMap((p) => {
    const n = entry.items?.[p] || 0;
    return p === 'write' ? (n ? ['write.submitted'] : []) : Array.from({ length: n }, (_, i) => `${p}.${i}`);
  });
}

// {total, missing} answerable items for some prefixes of a lesson; `isAnswered(key)` says which are done.
export function itemStatus(entry, prefixes, isAnswered) {
  const keys = itemKeys(entry, prefixes);
  return { total: keys.length, missing: keys.filter((k) => !isAnswered(k)).length };
}

// --- Weekly review test -------------------------------------------------------------------------
// Once a week (from Sunday on) the learner retakes a sample of everything studied that week: the
// words in a form the lesson's quiz did not use, grammar exercises, dictation and translation.
// The questions are chosen once, when the test starts, and stored with the answers so every
// device and english_daily/progress.py read the same test:
//   weekly: {<Monday>: {week, started, t, plan: [{ref: "<date>|<answer key>", form?}],
//                       items: {<ref>: {v, s, t}}, done?}}
// A week is named by its Monday; its test opens on its Sunday.

export const WEEKLY_CAPS = { vocab: 20, grammar: 12, dict: 4, trans: 4 }; // questions per part, in test order
const WEEKLY_PER_MINUTE = 2.5; // questions a learner gets through in a minute, for the time estimate
const WEEKLY_MIN_MINUTES = 5;
export const weeklyMinutes = (plan) => Math.max(WEEKLY_MIN_MINUTES, Math.round(plan.length / WEEKLY_PER_MINUTE));

// The Monday (YYYY-MM-DD) of the week a day belongs to (english_daily/dates.py week_of).
export function weekOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return addDays(date, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7));
}
export const weekEnd = (week) => addDays(week, 6);
export const weeklyOpen = (week, today) => today >= weekEnd(week);

export const refOf = (date, key) => `${date}|${key}`;
// "2026-11-03|ch.read.2" -> {date, key: "ch.read.2", prefix: "ch.read", i: 2}; `i` is null when
// the key does not end in a number (progress.parse_ref reads refs the same way).
export function parseRef(ref) {
  const s = String(ref);
  const bar = s.indexOf('|');
  const key = s.slice(bar + 1);
  const prefix = prefixOf(key);
  const tail = key.slice(prefix.length + 1);
  return { date: s.slice(0, bar), key, prefix, i: /^\d+$/.test(tail) ? Number(tail) : null };
}

// The lessons of a week the learner has touched (a section finished or anything answered), oldest
// first (progress.studied_dates: the advisor reports a skipped test by the same rule).
export function weeklyDates(index, state, week) {
  const end = weekEnd(week);
  const touched = (d) => Object.keys(state?.done?.[d] || {}).length + Object.keys(state?.answers?.[d] || {}).length > 0;
  return (index || []).map((x) => x.date).filter((d) => d >= week && d <= end && touched(d)).sort();
}

// A lesson's items of one kind in the order the test draws them: missed on the day first (lowest
// score first; a word whose card is weak counts as missed), then never answered, then the rest.
function weeklyCandidates(L, prefix, results, srs) {
  const scores = results?.[L.date] || {};
  const rows = (ITEMS[prefix].of(L) || []).map((_, i) => {
    const s = scores[`${prefix}.${i}`]?.s;
    const scored = typeof s === 'number';
    const weak = prefix === 'vocab' && isWeakCard(srs?.[wkey(L.vocab[i].word)]);
    return { i, tier: (scored && s < 1) || weak ? 0 : scored ? 2 : 1, s: scored ? s : 1 };
  });
  rows.sort((a, b) => a.tier - b.tier || a.s - b.s || a.i - b.i);
  return rows.map(({ i }) => (prefix === 'vocab'
    ? { ref: refOf(L.date, `vocab.${i}`), form: QUIZ_FORMS[(i + 1) % QUIZ_FORMS.length] } // not the form the lesson asked
    : { ref: refOf(L.date, `${prefix}.${i}`) }));
}

// Take the first of every list, then the second of every list... up to `cap` entries.
function roundRobin(lists, cap) {
  const out = [];
  for (let r = 0; out.length < cap && lists.some((l) => r < l.length); r++) {
    for (const l of lists) if (r < l.length && out.length < cap) out.push(l[r]);
  }
  return out;
}

// The questions of a week's test, drawn evenly from the week's lessons. Parts alternate the
// lesson order so the short parts (dictation, translation) do not all fall on the early lessons.
export function weeklyPlan(lessons, { results = {}, srs = {} } = {}, caps = WEEKLY_CAPS) {
  const byDate = [...lessons].sort((a, b) => a.date.localeCompare(b.date));
  return Object.entries(caps).flatMap(([prefix, cap], k) => roundRobin(
    (k % 2 ? [...byDate].reverse() : byDate).map((L) => weeklyCandidates(L, prefix, results, srs)), cap));
}

// What a plan entry asks: {prefix, i, scoring, item}, or null when the lesson no longer has it.
export function weeklyQuestion(lesson, entry) {
  const { key, prefix, i } = parseRef(entry.ref);
  if (!ITEMS[prefix] || i == null) return null;
  const item = prefix === 'vocab' && entry.form ? vocabQuestion(lesson.vocab || [], i, entry.form) : itemOf(lesson, key);
  return item === undefined ? null : { prefix, i, scoring: ITEMS[prefix].scoring, item };
}

// The numbers of one test (same as progress.weekly_summary): questions asked and answered, the
// mean score of the answered ones, the same per part, and the refs of the missed questions
// (words and grammar answered wrong; dictation and translation only carry a score).
export function weeklySummary(record) {
  const parts = {};
  const missed = [];
  let asked = 0;
  let answered = 0;
  let sum = 0;
  for (const entry of record?.plan || []) {
    const { prefix } = parseRef(entry.ref);
    const part = (parts[prefix] ||= { asked: 0, answered: 0, sum: 0 });
    const s = record.items?.[entry.ref]?.s;
    asked += 1;
    part.asked += 1;
    if (typeof s !== 'number') continue;
    answered += 1;
    part.answered += 1;
    sum += s;
    part.sum += s;
    if (ITEMS[prefix]?.scoring === 'question' && s < 1) missed.push(entry.ref);
  }
  return {
    asked, answered, score: answered ? sum / answered : null, missed,
    parts: Object.fromEntries(Object.entries(parts).map(([p, v]) => [p, { asked: v.asked, answered: v.answered, acc: v.answered ? v.sum / v.answered : null }])),
  };
}

// Finished tests, newest first.
export const weeklyDone = (weekly) => Object.values(weekly || {}).filter((r) => r?.done && r.plan?.length).sort((a, b) => b.week.localeCompare(a.week));

// What a finished test showed (progress.weekly_tests reads the same from the record): the words
// that were missed and how each lesson's grammar did when asked again, weakest first.
// `lessons` is {date: lesson}; questions about a lesson that is not there are skipped.
export function weeklyReview(record, lessons) {
  const missed = new Set(weeklySummary(record).missed);
  const words = [];
  const byDate = {};
  for (const entry of record?.plan || []) {
    const { date, prefix, i } = parseRef(entry.ref);
    const L = lessons?.[date];
    if (!L || i == null) continue;
    if (prefix === 'vocab' && missed.has(entry.ref) && L.vocab?.[i]) words.push({ ...L.vocab[i], date });
    const s = record.items?.[entry.ref]?.s;
    if (prefix !== 'grammar' || typeof s !== 'number') continue;
    const row = (byDate[date] ||= { date, point: L.grammar.point, zh: L.grammar.point_zh, right: 0, n: 0 });
    row.right += s;
    row.n += 1;
  }
  const grammar = Object.values(byDate).sort((a, b) => a.right / a.n - b.right / b.n);
  return { words, grammar, missedGrammar: grammar.filter((g) => g.right < g.n) };
}

// Every week with something to test or a test on record, newest first:
// [{week, dates, open, record}] (`dates`: the lessons studied that week).
export function weeklyList(index, state, today) {
  const first = [...(index || []).map((x) => x.date), ...Object.keys(state?.weekly || {})].sort()[0];
  const out = [];
  for (let week = weekOf(today); first && week >= weekOf(first); week = addDays(week, -7)) {
    const dates = weeklyDates(index, state, week);
    const record = state?.weekly?.[week] || null;
    if (dates.length || record) out.push({ week, dates, open: weeklyOpen(week, today), record });
  }
  return out;
}

// The test to offer now: this week's from Sunday, else last week's; null when neither has
// anything to test. `status` is new, started or done.
export function weeklyDue(index, state, today) {
  const row = weeklyList(index, state, today).find((w) => w.open && w.week >= addDays(weekOf(today), -7));
  return row ? { ...row, status: row.record?.done ? 'done' : row.record ? 'started' : 'new' } : null;
}

// --- Skill statistics (same thresholds as english_daily/progress.py) -------------------------

export const MIN_SKILL_ATTEMPTS = 4; // answers in a skill before it can count as the weakest
export const WEAK_SKILL = 0.8; // accuracy below this makes a skill "weak"
export const TREND_LESSONS = 3; // the recent lessons a trend compares with the earlier ones

// The weakest skill (below WEAK_SKILL with enough attempts), or null.
export function weakestSkill(stats, { minAttempts = MIN_SKILL_ATTEMPTS, weakBelow = WEAK_SKILL } = {}) {
  const weak = Object.entries(stats).filter(([, v]) => v.n >= minAttempts && v.acc < weakBelow).sort((a, b) => a[1].acc - b[1].acc)[0];
  return weak ? { skill: weak[0], acc: weak[1].acc } : null;
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

// --- Dashboard (same rules as english_daily/advisor.py) ---------------------------------------------

export const SESSION_GAP_MS = 5 * 60 * 1000;
export const MASTERED_INTERVAL = 21;
export const DAYPARTS = [['清晨', 0, 6], ['早上', 6, 11], ['中午', 11, 14], ['下午', 14, 18], ['晚上', 18, 23], ['深夜', 23, 24]];

// Every real answer, section, word-review and weekly-test time (ms) in a progress document.
export function eventTimes(doc) {
  const out = new Set();
  const real = (t) => typeof t === 'number' && t > REAL_TIME_MS;
  for (const days of [doc?.answers, doc?.results]) {
    for (const items of Object.values(days || {})) for (const v of Object.values(items || {})) if (real(v?.t)) out.add(v.t);
  }
  for (const marks of Object.values(doc?.done || {})) for (const t of Object.values(marks || {})) if (real(t)) out.add(t);
  for (const c of Object.values(doc?.srs || {})) if (real(c?.t)) out.add(c.t);
  for (const w of Object.values(doc?.weekly || {})) {
    for (const t of [w?.started, w?.done, ...Object.values(w?.items || {}).map((x) => x?.t)]) if (real(t)) out.add(t);
  }
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

export const WEAK_EASE = 2.4; // below the starting ease of 2.5: graded "hard" or "again" at least once

// A card the learner keeps forgetting: a lapse, or an ease lowered below WEAK_EASE.
export const isWeakCard = (card, weakEase = WEAK_EASE) => Boolean(card) && typeof card === 'object'
  && ((card.lapses || 0) > 0 || (card.ease ?? 2.5) < weakEase);

// Word cards by state: often forgotten, well known, still learning.
export function vocabStatus(srs, weakEase = WEAK_EASE) {
  const out = { mastered: 0, learning: 0, weak: 0 };
  for (const c of Object.values(srs || {})) {
    if (!c || typeof c !== 'object') continue;
    if (isWeakCard(c, weakEase)) out.weak += 1;
    else if ((c.interval || 0) >= MASTERED_INTERVAL) out.mastered += 1;
    else out.learning += 1;
  }
  return out;
}

// --- Review queue ------------------------------------------------------------------------------

// Words due today (earliest due first), then new words up to `room` (the daily limit minus the
// words already introduced today); words from the current lesson are introduced by its own section.
export function reviewQueue(deck, srs, { today, currentDate, room, wordKey = wkey }) {
  const card = (v) => srs[wordKey(v.word)];
  const due = deck.filter((v) => isDue(card(v), today)).sort((a, b) => card(a).due.localeCompare(card(b).due));
  const fresh = deck.filter((v) => !card(v) && v.date < currentDate).slice(0, Math.max(0, room));
  return [...due.map((v) => ({ v, isNew: false })), ...fresh.map((v) => ({ v, isNew: true }))];
}
