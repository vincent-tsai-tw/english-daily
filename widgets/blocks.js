// Blocks shared by lessons, challenges and free practice: reading with tappable vocabulary,
// dictation, dialogues, and the input fields and score lines they use.

import * as core from '../core.js?v=f46691462d';
import * as speech from '../speech.js?v=f46691462d';
import { store, library } from '../state.js?v=f46691462d';
import { h, put, pct, formatDate, showSheet } from '../dom.js?v=f46691462d';
import { sayBtn, slowBtn, playButton, rateToggle, ttsOpts } from './audio.js?v=f46691462d';
import { questionList } from './questions.js?v=f46691462d';

export const PASS = 0.9; // a spoken or typed sentence this close to the original counts as right
export const TRANS_PASS = 0.8; // a translation this close to a reference counts as right in practice

export function diffView(result) {
  return h('p', { class: 'diff' }, result.words.map((w) => [h('span', { class: w.ok ? 'w-ok' : 'w-miss' }, w.word), ' ']));
}

export function scoreLine(score) {
  const note = score >= PASS ? '很好！' : score >= 0.7 ? '不錯，紅字的部分再練一次。' : '再聽一次，跟著節奏慢慢念。';
  return h('p', { class: 'score' }, h('strong', {}, `符合度 ${pct(score)}`), `　${note}`);
}

// A sentence box that grows with the text (dictation): Enter submits, so no line breaks.
export function sentenceField(placeholder, onEnter) {
  const area = h('textarea', {
    class: 'field sentence', rows: 2, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder,
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } },
    oninput: () => { area.style.height = 'auto'; area.style.height = `${area.scrollHeight}px`; },
  });
  return area;
}

export function textField(placeholder, onEnter) {
  return h('input', {
    class: 'field', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder,
    onkeydown: (e) => { if (e.key === 'Enter') onEnter(); },
  });
}

// Wrap vocabulary in tappable buttons: blue underline for new words, dotted for known ones.
export function highlight(text, items) {
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

// Today's words (new) and every earlier word (known), for highlighting a lesson's texts.
export const vocabItems = (L) => [
  ...L.vocab.map((v) => ({ v: { ...v, date: L.date }, old: false })),
  ...library.fullDeck().filter((v) => v.date < L.date).map((v) => ({ v, old: true })),
];

export function readingBlock(L, reading, items, kind, accent) {
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

// A dictation sentence: play it, type it, compare. `answers` is a {get, set(value, score)} pair;
// with `once` the first check is final (the weekly test), otherwise the learner may try again.
export function dictationCard(n, sentence, answers, { attrs = {}, once = false } = {}) {
  const out = h('div');
  const show = (value) => {
    const r = core.alignWords(sentence, value);
    put(out, diffView(r), scoreLine(r.score));
  };
  const freeze = () => { input.disabled = true; btn.hidden = true; };
  const check = () => {
    const value = input.value.trim();
    if (!value || input.disabled) return;
    answers.set(value, core.alignWords(sentence, value).score);
    show(value);
    if (once) freeze();
  };
  const input = sentenceField('打出你聽到的句子', check);
  const btn = h('button', { class: 'btn', type: 'button', onclick: check }, '對答案');
  const prev = answers.get();
  if (prev) { input.value = prev; show(prev); if (once) freeze(); }
  return h('div', { class: 'card', ...attrs },
    h('div', { class: 'row' }, h('span', { class: 'num' }, `${n}`), sayBtn(sentence, '播放'), slowBtn(sentence)),
    input, btn, out);
}

export const dictationItem = (date, key, n, sentence) => dictationCard(n, sentence, store.scoredStore(date, key), { attrs: { 'data-ans': `${date}|${key}` } });

// A sentence to put into English, compared with the reference and its alternatives.
export function translationCard(t, answers, { attrs = {}, once = false } = {}) {
  const input = h('textarea', { class: 'field', rows: 2, placeholder: '用英文寫出來' }, answers.get() || '');
  const out = h('div');
  const show = (value) => put(out,
    h('p', { class: 'ref' }, '參考：', t.en, ' ', sayBtn(t.en)),
    t.alt?.length ? h('p', { class: 'muted' }, '也可以：', t.alt.join(' ／ ')) : null,
    h('p', { class: 'muted' }, `和參考答案的相似度 ${pct(core.translationScore(t, value))}（意思對就好，不必一字不差）`));
  const freeze = () => { input.disabled = true; btn.hidden = true; };
  const check = () => {
    const value = input.value.trim();
    if (!value || input.disabled) return;
    answers.set(value, core.translationScore(t, value));
    show(value);
    if (once) freeze();
  };
  const btn = h('button', { class: 'btn', type: 'button', onclick: check }, '對照答案');
  if (answers.get()) { show(answers.get()); if (once) freeze(); }
  return h('div', { class: 'card', ...attrs }, h('p', { class: 'zh-big' }, t.zh), input, btn, out);
}

// Dialogue with a hidden transcript, comprehension questions and dictation. `prefix` is '' for
// the main lesson and 'ch.' for the challenge, so their answers are kept apart.
export function listeningBlock(L, data, prefix) {
  const lines = data.lines;
  const voices = () => speech.voicePair(store.settings.voice);
  const transcript = h('ol', { class: 'dialogue concealed' }, lines.map((line) => h('li', {
    class: 'line', onclick: () => speech.sayLines([line], { voices: voices(), rate: store.settings.rate }),
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
      playButton('播放對話', () => speech.sayLines(lines, { voices: voices(), rate: store.settings.rate, onLine: mark }),
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
