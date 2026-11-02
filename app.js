// English Daily: the single-page app. Lessons and the vocabulary deck are prebuilt JSON; all
// learner progress lives in localStorage under STORE_KEY and never leaves the browser.

import * as core from './core.js?v=93650375a3';
import * as speech from './speech.js?v=93650375a3';

const STORE_KEY = 'english-daily:v1';
const WEEKDAYS = '日一二三四五六';
const SLOW_RATE = 0.7;
const RATES = [0.8, 1, 1.2];
const SECTIONS = [
  { id: 'vocab', zh: '單字', en: 'Vocabulary', min: 4, sub: (L) => `${L.vocab.slice(0, 4).map((v) => v.word).join('、')}…` },
  { id: 'read', zh: '閱讀', en: 'Reading', min: 5, sub: (L) => L.reading.title },
  { id: 'grammar', zh: '文法', en: 'Grammar', min: 4, sub: (L) => L.grammar.point_zh },
  { id: 'listen', zh: '聽力', en: 'Listening', min: 5, sub: (L) => L.listening.title },
  { id: 'speak', zh: '口說', en: 'Speaking', min: 4, sub: (L) => `跟讀 ${L.speaking.shadowing.length} 句＋回答 ${L.speaking.prompts.length} 題` },
  { id: 'write', zh: '寫作', en: 'Writing', min: 6, sub: (L) => `中翻英 ${L.translation.length} 句＋短文寫作` },
];

const ICONS = {
  speaker: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  turtle: '<svg viewBox="0 0 24 24"><path d="M4 15c0-4 3.5-7 8-7s8 3 8 7H4z" fill="currentColor"/><path d="M6 15l-1 3M18 15l1 3M20 13h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

// --- State ----------------------------------------------------------------------------------

const defaults = () => ({
  done: {}, answers: {}, srs: {}, mistakes: [], pendingSpeak: [], activity: {}, reviewLog: {},
  settings: { quiet: false, rate: 1, voice: '', newPerDay: 10, reviewMode: 'recognize' },
});

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      const d = defaults();
      return { ...d, ...raw, settings: { ...d.settings, ...(raw.settings || {}) } };
    }
  } catch { /* unreadable or blocked storage: start fresh in memory */ }
  return defaults();
}

let S = loadState();

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch { /* private mode: memory only */ }
}

const today = () => core.localDate();
const wkey = (word) => word.trim().toLowerCase();
const touch = () => { S.activity[today()] = true; };
const ans = (date, key) => S.answers[date]?.[key];
function setAns(date, key, value) {
  (S.answers[date] ||= {})[key] = value;
  touch();
  save();
}
const answerStore = (date, key) => ({ get: () => ans(date, key), set: (v) => setAns(date, key, v) });

function recordMistake(m, correct) {
  const id = `${m.date}|${m.kind}|${m.i}`;
  const has = S.mistakes.some((x) => `${x.date}|${x.kind}|${x.i}` === id);
  if (!correct && !has) S.mistakes.push(m);
  if (correct && has) S.mistakes = S.mistakes.filter((x) => `${x.date}|${x.kind}|${x.i}` !== id);
  save();
}

function addPending(id) {
  if (!S.pendingSpeak.includes(id)) S.pendingSpeak.push(id);
  save();
}
function removePending(id) {
  S.pendingSpeak = S.pendingSpeak.filter((x) => x !== id);
  save();
}

function streak() {
  let d = today();
  if (!S.activity[d]) d = core.addDays(d, -1);
  let n = 0;
  while (S.activity[d]) { n += 1; d = core.addDays(d, -1); }
  return n;
}

// --- Data -----------------------------------------------------------------------------------

let INDEX = [];
let DECK = [];
const lessonCache = new Map();

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`讀取 ${url} 失敗（${res.status}）`);
  return res.json();
}

function lesson(date) {
  if (!lessonCache.has(date)) lessonCache.set(date, getJSON(`data/lessons/${date}.json`));
  return lessonCache.get(date);
}

const currentLessonDate = () => (INDEX.find((x) => x.date <= today()) || INDEX[INDEX.length - 1])?.date;

function reviewQueue() {
  const t = today();
  const due = DECK.filter((v) => core.isDue(S.srs[wkey(v.word)], t))
    .sort((a, b) => S.srs[wkey(a.word)].due.localeCompare(S.srs[wkey(b.word)].due));
  const log = S.reviewLog[t] || { reviewed: 0, introduced: 0 };
  const room = Math.max(0, S.settings.newPerDay - log.introduced);
  // The current lesson's words are introduced by its vocabulary section, not by review.
  const fresh = DECK.filter((v) => !S.srs[wkey(v.word)] && v.date < currentLessonDate()).slice(0, room);
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
const pct = (x) => `${Math.round(x * 100)}%`;

function formatDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}月${d}日 星期${WEEKDAYS[wd]}`;
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
  sheet.replaceChildren(h('div', { class: 'sheet-inner' },
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
  if (!speech.ttsSupported()) return null;
  return h('button', {
    class: label ? 'chip-btn' : 'icon-btn', type: 'button', 'aria-label': label || '播放發音',
    onclick: (e) => { e.stopPropagation(); speech.say(text, ttsOpts(rate ? { rate } : {})); },
  }, icon(rate ? 'turtle' : 'speaker'), label || null);
}
const slowBtn = (text) => sayBtn(text, '慢速', SLOW_RATE);

function playButton(label, run) {
  if (!speech.ttsSupported()) return h('span', { class: 'muted' }, '這個瀏覽器不支援朗讀');
  const btn = h('button', { class: 'btn play', type: 'button' });
  let playing = false;
  const paint = () => {
    btn.replaceChildren(icon(playing ? 'stop' : 'play'), playing ? '停止' : label);
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
    seg.append(h('button', { type: 'button', 'data-rate': r, onclick: () => { S.settings.rate = r; save(); paint(); } }, `${r}×`));
  }
  paint();
  return seg;
}

function micButton({ continuous = false, label, onText, onDone }) {
  const btn = h('button', { class: 'btn mic', type: 'button' });
  let session = null;
  const paint = () => {
    btn.replaceChildren(icon(session ? 'stop' : 'mic'), session ? (continuous ? '說完了' : '聆聽中…') : label);
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
  const note = score >= 0.9 ? '很好！' : score >= 0.7 ? '不錯，紅字的部分再練一次。' : '再聽一次，跟著節奏慢慢念。';
  return h('p', { class: 'score' }, h('strong', {}, `符合度 ${pct(score)}`), `　${note}`);
}

// Wrap today's words (and older deck words, more subtly) in tappable buttons.
function highlight(text, items) {
  const hits = core.findPhrases(text, items.map((x) => x.v.word));
  const out = [];
  let at = 0;
  for (const hit of hits) {
    const { v, old } = items[hit.index];
    out.push(text.slice(at, hit.start));
    out.push(h('button', {
      class: old ? 'vw old' : 'vw', type: 'button',
      onclick: (e) => {
        e.stopPropagation();
        showSheet(
          h('p', { class: 'sheet-word' }, v.word, ' ', sayBtn(v.word)),
          h('p', { class: 'meta' }, `${v.pos}　${v.ipa}${old ? `　・${formatDate(v.date)} 學過` : ''}`),
          h('p', { class: 'zh-big' }, v.zh),
          h('p', { class: 'def' }, v.definition));
      },
    }, text.slice(hit.start, hit.end)));
    at = hit.end;
  }
  out.push(text.slice(at));
  return out;
}

const vocabItems = (L) => [
  ...L.vocab.map((v) => ({ v: { ...v, date: L.date }, old: false })),
  ...DECK.filter((v) => v.date < L.date).map((v) => ({ v, old: true })),
];

// --- Questions ------------------------------------------------------------------------------

function mcq(item, store, onResult) {
  const box = h('div', { class: 'q' });
  const render = () => {
    const chosen = store.get();
    const answered = chosen != null;
    box.replaceChildren(
      h('p', { class: 'q-text' }, item.q),
      h('div', { class: 'options' }, item.options.map((option, j) => h('button', {
        type: 'button',
        class: `opt${!answered ? '' : j === item.answer ? ' right' : j === chosen ? ' wrong' : ' dim'}`,
        disabled: answered,
        onclick: () => { store.set(j); onResult?.(j === item.answer); render(); },
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
      const input = h('input', {
        class: 'blank', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': '填空',
        onkeydown: (e) => { if (e.key === 'Enter') submit(); },
      });
      const submit = () => {
        if (!input.value.trim()) return;
        const ok = core.checkFill(item, input.value);
        store.set(input.value.trim());
        onResult?.(ok);
        render();
      };
      box.replaceChildren(h('p', { class: 'q-text' }, before, input, after),
        h('button', { class: 'btn', type: 'button', onclick: submit }, '確認'));
    } else {
      const ok = core.checkFill(item, given);
      box.replaceChildren(
        h('p', { class: 'q-text' }, before, h('span', { class: `filled ${ok ? 'ok' : 'bad'}` }, given), after),
        h('p', { class: `explain ${ok ? 'ok' : 'bad'}` }, ok ? '答對了。' : `正確答案：${item.answer}。`, item.explain_zh));
    }
  };
  render();
  return box;
}

const exercise = (item, store, onResult) => (item.type === 'fill' ? fillQ : mcq)(item, store, onResult);

function questionList(L, kind, items) {
  return h('ol', { class: 'questions' }, items.map((item, i) => h('li', {},
    exercise(item, answerStore(L.date, `${kind}.${i}`), (ok) => recordMistake({ date: L.date, kind, i }, ok)))));
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
  const items = vocabItems(L);
  return [
    h('h1', { class: 'title' }, L.reading.title),
    h('div', { class: 'toolbar' }, playButton('朗讀全文', () => speech.say(L.reading.paragraphs.join(' '), ttsOpts())), rateToggle()),
    h('div', { class: 'reading' }, L.reading.paragraphs.map((p) => h('p', {}, highlight(p, items)))),
    h('p', { class: 'hint' }, '藍色底線是今天的單字，灰色虛線是以前學過的字，點一下看解釋。'),
    h('h2', { class: 'section-title' }, '閱讀理解'),
    questionList(L, 'read', L.reading.questions),
  ];
}

function grammarSection(L) {
  const g = L.grammar;
  return [
    h('h1', { class: 'title' }, g.point_zh),
    h('p', { class: 'lede en' }, g.point),
    h('div', { class: 'card' },
      h('p', {}, g.explain_zh),
      h('p', { class: 'pattern' }, g.pattern),
      h('ul', { class: 'examples' }, g.examples.map((x) => h('li', {},
        h('p', { class: 'example' }, x.en, ' ', sayBtn(x.en)), h('p', { class: 'zh-sub' }, x.zh))))),
    h('h2', { class: 'section-title' }, '練習'),
    questionList(L, 'grammar', g.exercises),
  ];
}

function dictationItem(date, i, sentence) {
  const key = `dict.${i}`;
  const input = h('input', {
    class: 'field', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    placeholder: '打出你聽到的句子', onkeydown: (e) => { if (e.key === 'Enter') check(); },
  });
  const out = h('div');
  const check = () => {
    if (!input.value.trim()) return;
    setAns(date, key, input.value);
    const r = core.alignWords(sentence, input.value);
    out.replaceChildren(diffView(r), scoreLine(r.score));
  };
  if (ans(date, key)) { input.value = ans(date, key); check(); }
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('span', { class: 'num' }, `${i + 1}`), sayBtn(sentence, '播放'), slowBtn(sentence)),
    input,
    h('button', { class: 'btn', type: 'button', onclick: check }, '對答案'),
    out);
}

function listenSection(L) {
  const lines = L.listening.lines;
  const transcript = h('ol', { class: 'dialogue concealed' }, lines.map((line) => h('li', {
    class: 'line', onclick: () => speech.say(line.text, { ...ttsOpts(), voice: speech.voicePair(S.settings.voice)[line.speaker === 'B' ? 1 : 0] || ttsOpts().voice }),
  }, h('span', { class: 'who' }, line.name), h('span', { class: 'said' }, line.text))));
  const showBtn = h('button', {
    class: 'btn subtle', type: 'button',
    onclick: () => {
      const hidden = transcript.classList.toggle('concealed');
      showBtn.textContent = hidden ? '顯示對話稿' : '隱藏對話稿';
    },
  }, '顯示對話稿');
  const mark = (i) => transcript.querySelectorAll('.line').forEach((el, k) => el.classList.toggle('playing', k === i));
  return [
    h('h1', { class: 'title' }, L.listening.title),
    h('p', { class: 'lede' }, '先不看文字聽一遍並回答問題，再打開對話稿聽第二遍，最後做聽寫。'),
    h('div', { class: 'toolbar' },
      playButton('播放對話', () => speech.sayLines(lines, { voices: speech.voicePair(S.settings.voice), rate: S.settings.rate, onLine: mark })),
      rateToggle(), showBtn),
    transcript,
    h('h2', { class: 'section-title' }, '聽力理解'),
    questionList(L, 'listen', L.listening.questions),
    h('h2', { class: 'section-title' }, '聽寫 Dictation'),
    h('p', { class: 'hint' }, '按播放聽句子，把聽到的英文打出來。聽不清楚可以按「慢速」。'),
    L.listening.dictation.map((s, i) => dictationItem(L.date, i, s)),
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
      result.replaceChildren(h('p', { class: 'muted' }, '已默念練習，記在口說待補。'));
      return;
    }
    const r = core.alignWords(sentence, said);
    result.replaceChildren(h('p', { class: 'heard' }, '辨識到：', said || '（沒有聽到聲音，再試一次）'), diffView(r), scoreLine(r.score));
  };
  if (ans(L.date, key) != null) show(ans(L.date, key));
  const action = voiceMode()
    ? [micButton({ label: '跟讀', onText: (t) => { live.textContent = t; }, onDone: (said) => { live.textContent = ''; setAns(L.date, key, said); if (said) removePending(id); show(said); } }), laterButton(id)]
    : h('button', { class: 'btn', type: 'button', onclick: () => { setAns(L.date, key, 'quiet'); addPending(id); show('quiet'); } }, '已默念 3 次');
  return h('div', { class: 'card' },
    h('p', { class: 'shadow-text' }, sentence),
    h('div', { class: 'row' }, sayBtn(sentence, '聽'), slowBtn(sentence), action),
    live, result);
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
    result.replaceChildren(
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
  return h('div', { class: 'card' },
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

function translationItem(date, i, t) {
  const key = `trans.${i}`;
  const input = h('textarea', { class: 'field', rows: 2, placeholder: '用英文寫出來' }, ans(date, key) || '');
  const out = h('div');
  const check = () => {
    const value = input.value.trim();
    if (!value) return;
    setAns(date, key, value);
    const score = Math.max(...[t.en, ...(t.alt || [])].map((r) => core.alignWords(r, value).score));
    out.replaceChildren(
      h('p', { class: 'ref' }, '參考：', t.en, ' ', sayBtn(t.en)),
      t.alt?.length ? h('p', { class: 'muted' }, '也可以：', t.alt.join(' ／ ')) : null,
      h('p', { class: 'muted' }, `和參考答案的相似度 ${pct(score)}（意思對就好，不必一字不差）`));
  };
  if (ans(date, key)) check();
  return h('div', { class: 'card' }, h('p', { class: 'zh-big' }, t.zh), input,
    h('button', { class: 'btn', type: 'button', onclick: check }, '對照答案'), out);
}

function writingFeedback(L, text) {
  const w = L.writing;
  const n = core.wordCount(text);
  const checks = [
    { ok: n >= w.min_words && n <= w.max_words, label: `字數 ${n}（目標 ${w.min_words}～${w.max_words}）` },
    ...w.must_use.map((p) => ({ ok: core.mentions(text, p), label: `用到「${p}」` })),
  ];
  const used = L.vocab.filter((v) => core.mentions(text, v.word)).map((v) => v.word);
  return h('div', { class: 'feedback' },
    h('h3', {}, '自動檢查'),
    h('ul', { class: 'checks' }, checks.map((c) => h('li', { class: c.ok ? 'ok' : 'bad' }, icon(c.ok ? 'check' : 'cross'), c.label))),
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
  const draft = ans(L.date, 'write.draft') || '';
  const area = h('textarea', { class: 'field essay', rows: 10, placeholder: 'Write your email here…', spellcheck: 'true' }, draft);
  const chips = h('div', { class: 'chips' });
  const count = h('span', { class: 'count' });
  const feedback = h('div');
  const paint = () => {
    const n = core.wordCount(area.value);
    count.textContent = `${n} / ${w.min_words}～${w.max_words} 字`;
    count.classList.toggle('ok', n >= w.min_words && n <= w.max_words);
    chips.replaceChildren(...w.must_use.map((p) => h('span', { class: `chip${core.mentions(area.value, p) ? ' on' : ''}` }, p)));
  };
  let timer;
  area.addEventListener('input', () => {
    paint();
    clearTimeout(timer);
    timer = setTimeout(() => setAns(L.date, 'write.draft', area.value), 400);
  });
  const submit = () => {
    if (core.wordCount(area.value) < 10) { toast('先寫幾句再交卷。'); return; }
    setAns(L.date, 'write.draft', area.value);
    setAns(L.date, 'write.submitted', true);
    feedback.replaceChildren(writingFeedback(L, area.value));
  };
  paint();
  if (ans(L.date, 'write.submitted')) feedback.replaceChildren(writingFeedback(L, area.value));
  return [
    h('h1', { class: 'title' }, '中翻英暖身'),
    L.translation.map((t, i) => translationItem(L.date, i, t)),
    h('h2', { class: 'section-title' }, '寫作任務'),
    h('div', { class: 'card' }, h('p', { class: 'prompt-q' }, w.task), h('p', { class: 'zh-sub' }, w.task_zh),
      h('p', { class: 'muted' }, '必須用到（用了會變藍）：'), chips),
    area,
    h('div', { class: 'row spread' }, count, h('button', { class: 'btn primary', type: 'button', onclick: submit }, '交卷，看回饋')),
    feedback,
  ];
}

const RENDER = { vocab: vocabSection, read: readSection, grammar: grammarSection, listen: listenSection, speak: speakSection, write: writeSection };

function completeSection(L, id) {
  (S.done[L.date] ||= {})[id] = true;
  touch();
  if (id === 'vocab') {
    const tomorrow = core.addDays(today(), 1);
    for (const v of L.vocab) {
      const k = wkey(v.word);
      if (!S.srs[k]) S.srs[k] = { ...core.newCard(today()), due: tomorrow };
    }
  }
  save();
}

// --- Pages ----------------------------------------------------------------------------------

function stat(value, label) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-num' }, value), h('div', { class: 'stat-label' }, label));
}

async function homePage(date) {
  const L = await lesson(date);
  const done = S.done[date] || {};
  const finished = SECTIONS.filter((s) => done[s.id]).length;
  const next = SECTIONS.find((s) => !done[s.id]);
  const isCurrent = date === currentLessonDate();
  const notToday = isCurrent && date !== today();
  const queue = reviewQueue();
  const pending = S.pendingSpeak.map((x) => x.split('|')[0]);
  return h('div', { class: 'page' },
    h('p', { class: 'eyebrow' }, formatDate(date), notToday ? '・今天的新課還沒產生，先練最近一課' : '', isCurrent ? '' : '・過去的課'),
    h('h1', { class: 'headline' }, L.theme_zh),
    h('p', { class: 'lede' }, h('strong', {}, `${L.theme}. `), L.summary_zh),
    h('div', { class: 'stats' },
      stat(`${streak()}`, '連續天數'), stat(`${finished}/${SECTIONS.length}`, '今日進度'),
      stat(`${queue.length}`, '待複習單字'), stat(`${DECK.length}`, '單字庫')),
    next
      ? h('a', { class: 'btn primary wide', href: `#/l/${date}/${next.id}` }, finished ? `繼續：${next.zh}` : '開始今天的課')
      : h('p', { class: 'done-note' }, icon('check'), '這一課全部完成了！'),
    pending.length ? h('a', { class: 'card notice', href: `#/l/${pending[0]}/speak` },
      h('strong', {}, `口說待補 ${pending.length} 題`), h('span', { class: 'muted' }, '在外面時先默念或打字的題目，回家花幾分鐘用說的補完。')) : null,
    h('h2', { class: 'section-title' }, '今天的六節'),
    h('ul', { class: 'section-list' }, SECTIONS.map((s) => h('li', {},
      h('a', { href: `#/l/${date}/${s.id}`, class: done[s.id] ? 'done' : '' },
        h('span', { class: 'sec-name' }, s.zh, h('small', {}, s.en)),
        h('span', { class: 'sec-sub' }, s.sub(L)),
        h('span', { class: 'sec-meta' }, done[s.id] ? icon('check') : `${s.min} 分`))))),
    queue.length ? h('a', { class: 'card notice', href: '#/review' },
      h('strong', {}, `複習 ${queue.length} 個單字`), h('span', { class: 'muted' }, '間隔複習：快忘記的時候再看一次，記得最牢。')) : null);
}

async function sectionPage(date, id) {
  const L = await lesson(date);
  const idx = SECTIONS.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error('找不到這一節');
  const s = SECTIONS[idx];
  const next = SECTIONS[idx + 1];
  const finish = () => {
    completeSection(L, id);
    location.hash = next ? `#/l/${date}/${next.id}` : `#/l/${date}`;
    if (!next) toast('今天的課完成了，記得做單字複習！');
  };
  return h('div', { class: 'page' },
    h('nav', { class: 'crumbs' }, h('a', { href: `#/l/${date}` }, `‹ ${formatDate(date)}`), h('span', {}, `${idx + 1} / ${SECTIONS.length}`)),
    h('p', { class: 'eyebrow' }, `${s.zh}・${s.en}`),
    RENDER[id](L),
    h('div', { class: 'finish' },
      h('button', { class: 'btn primary wide', type: 'button', onclick: finish }, next ? `完成，下一節：${next.zh}` : '完成今天的課'),
      S.done[date]?.[id] ? h('p', { class: 'muted center' }, '這一節已經完成過了') : null));
}

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
      onclick: () => { S.settings.reviewMode = mode; save(); route(); },
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
    const hit = core.findPhrases(v.example, [v.word])[0];
    const clue = hit ? `${v.example.slice(0, hit.start)}_____${v.example.slice(hit.end)}` : v.example;
    const input = h('input', {
      class: 'field', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      placeholder: '輸入英文', onkeydown: (e) => { if (e.key === 'Enter') check(); },
    });
    const result = h('div');
    const checkBtn = h('button', { class: 'btn primary wide', type: 'button', onclick: () => check() }, '檢查');
    const check = () => {
      if (!input.value.trim() || input.disabled) return;
      const ok = core.normalizeAnswer(input.value) === core.normalizeAnswer(v.word);
      input.disabled = true;
      checkBtn.hidden = true;
      result.replaceChildren(
        h('p', { class: `explain ${ok ? 'ok' : 'bad'}` }, ok ? '正確！' : `答案是 ${v.word}`),
        h('div', { class: 'row center' }, sayBtn(v.word, '發音')),
        h('p', { class: 'example' }, v.example),
        gradeButtons(item, ok ? 2 : 0));
    };
    return h('div', { class: 'flash' }, progress(), item.isNew ? h('span', { class: 'tag' }, '新字') : null,
      h('p', { class: 'zh-big' }, v.zh), h('p', { class: 'def' }, v.definition), h('p', { class: 'example' }, clue),
      input, checkBtn, result);
  };

  const grade = (item, g) => {
    const k = wkey(item.v.word);
    if (item.isNew && !S.srs[k]) log.introduced += 1;
    S.srs[k] = core.schedule(S.srs[k], g, t);
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
      stage.replaceChildren(h('div', { class: 'flash' },
        h('p', { class: 'done-note' }, icon('check'), total ? '今天的單字複習完成了！' : '目前沒有要複習的單字。'),
        h('p', { class: 'muted center' }, `今天已複習 ${log.reviewed} 次。明天會依記憶狀況排出新的複習。`)));
      return;
    }
    const item = queue[pos];
    stage.replaceChildren(S.settings.reviewMode === 'spell' ? spellCard(item) : recognizeCard(item));
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

function pickMistake(L, m) {
  if (m.kind === 'read') return L.reading.questions[m.i];
  if (m.kind === 'listen') return L.listening.questions[m.i];
  return L.grammar.exercises[m.i];
}

function mistakesPanel() {
  const box = h('div');
  if (!S.mistakes.length) return h('p', { class: 'muted' }, '目前沒有錯題。閱讀、文法、聽力答錯的題目會出現在這裡。');
  const label = { read: '閱讀', listen: '聽力', grammar: '文法' };
  const btn = h('button', {
    class: 'btn', type: 'button',
    onclick: async () => {
      btn.disabled = true;
      const rows = await Promise.all(S.mistakes.map(async (m) => ({ m, item: pickMistake(await lesson(m.date), m) })));
      box.replaceChildren(h('ol', { class: 'questions' }, rows.filter((r) => r.item).map(({ m, item }) => {
        let value = null;
        return h('li', {}, h('p', { class: 'muted' }, `${formatDate(m.date)}・${label[m.kind]}`),
          exercise(item, { get: () => value, set: (v) => { value = v; } }, (ok) => { recordMistake(m, ok); if (ok) toast('答對了，已從錯題移除。'); }));
      })));
    },
  }, `重練錯題（${S.mistakes.length} 題）`);
  box.append(btn);
  return box;
}

function archivePage() {
  return h('div', { class: 'page' },
    h('p', { class: 'eyebrow' }, '題庫・Archive'),
    h('h1', { class: 'headline' }, `已經有 ${INDEX.length} 課`),
    h('p', { class: 'lede' }, '每天早上會自動產生新的一課。點任何一課都可以重做。'),
    h('ul', { class: 'archive' }, INDEX.map((x) => {
      const n = SECTIONS.filter((s) => S.done[x.date]?.[s.id]).length;
      return h('li', {}, h('a', { href: `#/l/${x.date}` },
        h('span', { class: 'arc-date' }, formatDate(x.date), h('small', {}, x.track === 'work' ? '職場' : '生活')),
        h('span', { class: 'arc-title' }, x.theme_zh, h('small', {}, x.theme)),
        h('span', { class: 'arc-meta' }, x.grammar),
        h('span', { class: `arc-prog${n === SECTIONS.length ? ' full' : ''}` }, `${n}/${SECTIONS.length}`)));
    })));
}

function settingsPage() {
  const voiceSel = h('select', { class: 'field', 'aria-label': '朗讀聲音', onchange: () => { S.settings.voice = voiceSel.value; save(); } });
  speech.voicesReady().then((voices) => {
    voiceSel.replaceChildren(h('option', { value: '' }, '自動選擇（推薦）'),
      ...voices.map((v) => h('option', { value: v.name, selected: v.name === S.settings.voice }, `${v.name}（${v.lang}）`)));
  });
  const rateSel = h('select', { class: 'field', 'aria-label': '語速', onchange: () => { S.settings.rate = Number(rateSel.value); save(); } },
    [0.7, 0.8, 0.9, 1, 1.1, 1.2].map((r) => h('option', { value: r, selected: r === S.settings.rate }, `${r}×`)));
  const newSel = h('select', { class: 'field', 'aria-label': '每天新字上限', onchange: () => { S.settings.newPerDay = Number(newSel.value); save(); updateBadge(); } },
    [5, 10, 15, 20, 30].map((n) => h('option', { value: n, selected: n === S.settings.newPerDay }, `${n} 個`)));
  const quiet = h('input', { type: 'checkbox', class: 'switch', checked: S.settings.quiet, onchange: () => setQuiet(quiet.checked, false) });

  const exportBox = h('textarea', { class: 'field mono', rows: 4, readonly: true }, JSON.stringify(S));
  const importBox = h('textarea', { class: 'field mono', rows: 4, placeholder: '貼上從另一台裝置匯出的紀錄' });
  const doImport = () => {
    try {
      const data = JSON.parse(importBox.value);
      if (!data || typeof data.srs !== 'object' || typeof data.done !== 'object') throw new Error('format');
      const d = defaults();
      S = { ...d, ...data, settings: { ...d.settings, ...(data.settings || {}) } };
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
      S = defaults();
      save();
      toast('學習紀錄已清除。');
      route();
    },
  }, '清除所有學習紀錄');

  return h('div', { class: 'page' },
    h('p', { class: 'eyebrow' }, '設定・Settings'),
    h('h1', { class: 'headline' }, '設定'),
    h('div', { class: 'group' },
      h('label', { class: 'setting' }, h('span', {}, h('strong', {}, '安靜模式'), h('small', {}, '在外面不方便說話時開啟：口說題改成默念或打字，記到「口說待補」。')), quiet),
      h('label', { class: 'setting' }, h('span', {}, h('strong', {}, '朗讀聲音'), h('small', {}, '名稱有 Premium／Enhanced／Natural 的聲音最自然。iPhone 可到「設定 → 輔助使用 → 語音內容 → 聲音」下載。')), voiceSel),
      h('div', { class: 'row' }, h('button', { class: 'btn subtle', type: 'button', onclick: () => speech.say('Hi! This is how I sound. Is the speed comfortable for you?', ttsOpts()) }, icon('speaker'), '試聽')),
      h('label', { class: 'setting' }, h('span', {}, h('strong', {}, '語速')), rateSel),
      h('label', { class: 'setting' }, h('span', {}, h('strong', {}, '每天新單字上限'), h('small', {}, '複習頁每天最多加入幾個沒學過的字。')), newSel)),
    h('h2', { class: 'section-title' }, '學習紀錄'),
    h('p', { class: 'muted' }, '紀錄只存在這個瀏覽器。換手機或電腦時，先在舊裝置複製匯出內容，再到新裝置貼上匯入。'),
    exportBox,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => copyText(exportBox.value, '已複製匯出內容。') }, '複製匯出內容')),
    importBox,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: doImport }, '匯入'), resetBtn),
    h('h2', { class: 'section-title' }, '關於'),
    h('p', { class: 'muted' }, '每天的題目由 AI 自動生成，可能有錯；遇到奇怪的地方請以字典為準。聽力使用裝置內建的朗讀聲音，口說使用瀏覽器的語音辨識。'));
}

// --- Shell ----------------------------------------------------------------------------------

function setQuiet(on, rerender = true) {
  S.settings.quiet = on;
  save();
  paintQuiet();
  toast(on ? '安靜模式：口說題改成默念或打字。' : '已關閉安靜模式，可以開口練習了。');
  if (rerender) route();
}

function paintQuiet() {
  const btn = $('#quiet');
  btn.replaceChildren(icon('mic'), S.settings.quiet ? '安靜模式' : '可說話');
  btn.classList.toggle('on', S.settings.quiet);
  btn.setAttribute('aria-pressed', String(S.settings.quiet));
}

function updateBadge() {
  const n = reviewQueue().length;
  const badge = $('#badge');
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.hidden = n === 0;
}

function errorBox(err) {
  return h('div', { class: 'page' }, h('h1', { class: 'title' }, '出了點問題'), h('p', { class: 'muted' }, err.message),
    h('a', { class: 'btn', href: '#/' }, '回到今日'));
}

async function route() {
  speech.stop();
  hideSheet();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const view = $('#view');
  let tab = 'home';
  try {
    let page;
    if (!parts.length) page = await homePage(currentLessonDate());
    else if (parts[0] === 'l' && parts.length === 2) page = await homePage(parts[1]);
    else if (parts[0] === 'l' && parts.length === 3) page = await sectionPage(parts[1], parts[2]);
    else if (parts[0] === 'review') { tab = 'review'; page = reviewPage(); }
    else if (parts[0] === 'archive') { tab = 'archive'; page = archivePage(); }
    else if (parts[0] === 'settings') { tab = 'settings'; page = settingsPage(); }
    else throw new Error('找不到這個頁面');
    if (parts[0] === 'l' && parts[1] !== currentLessonDate()) tab = 'archive';
    view.replaceChildren(page);
  } catch (err) {
    view.replaceChildren(errorBox(err));
  }
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  updateBadge();
  window.scrollTo(0, 0);
}

async function boot() {
  $('#quiet').addEventListener('click', () => setQuiet(!S.settings.quiet));
  document.addEventListener('click', (e) => {
    const sheet = $('#sheet');
    if (!sheet.hidden && !sheet.contains(e.target)) hideSheet();
  });
  paintQuiet();
  try {
    [{ lessons: INDEX }, DECK] = await Promise.all([getJSON('data/index.json'), getJSON('data/vocab.json')]);
  } catch (err) {
    $('#view').replaceChildren(errorBox(err));
    return;
  }
  window.addEventListener('hashchange', route);
  await route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
