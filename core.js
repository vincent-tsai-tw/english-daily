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
