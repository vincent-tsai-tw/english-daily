// Tap any English word to look it up: the offline ECDICT subset first (following inflections to
// the base word), a free online dictionary for the rest, and a button that saves it to the deck.

import { store, library } from '../state.js?v=8942a1287a';
import { wkey } from '../store.js?v=8942a1287a';
import { h, icon, put, showSheet } from '../dom.js?v=8942a1287a';
import { sayBtn } from './audio.js?v=8942a1287a';
import { updateBadge } from '../pages/shell.js?v=8942a1287a';

const WORD_CHARS = /[A-Za-z'’-]/;
export const LOOKUP_IN = '.reading, .said, .example, .sample, .shadow-text, .prompt-q, .q-text, .ref, .fixed, .orig, .def, .heard';

export async function lookup(raw) {
  const word = raw.toLowerCase().replace(/’/g, "'").replace(/^[^a-z]+|[^a-z]+$/g, '');
  if (!word) return null;
  const book = await library.dictLetter(word[0]);
  let entry = book[word];
  let base = word;
  if (typeof entry === 'string') { base = entry; entry = (await library.dictLetter(base[0]))[base]; }
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
export function wordAtPoint(x, y) {
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

export async function openDictionary(word, sentence) {
  showSheet(h('p', { class: 'sheet-word' }, word), h('p', { class: 'muted' }, '查字典中…'));
  const hit = await lookup(word);
  if (!hit) { showSheet(h('p', { class: 'sheet-word' }, word), h('p', { class: 'muted' }, '字典裡找不到這個字（可能是人名或縮寫）。')); return; }
  const key = wkey(hit.base);
  const known = library.fullDeck().some((v) => wkey(v.word) === key);
  const addBtn = h('button', {
    class: 'btn', type: 'button',
    onclick: () => {
      store.addWord({ word: hit.base, ipa: hit.ipa, zh: hit.zh || hit.en, definition: hit.en, example: sentence });
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
