// Free practice: unlimited random items from every lesson so far, in six modes. Weak words and
// weak grammar points come up more often.

import * as core from '../core.js?v=d4943bd8ca';
import * as speech from '../speech.js?v=d4943bd8ca';
import { store, library } from '../state.js?v=d4943bd8ca';
import { today, isWeak } from '../store.js?v=d4943bd8ca';
import { h, put, toast, pct, randomItem, shuffle } from '../dom.js?v=d4943bd8ca';
import { sayBtn, slowBtn, ttsOpts, micButton, voiceMode } from '../widgets/audio.js?v=d4943bd8ca';
import { PASS, TRANS_PASS, diffView, scoreLine, sentenceField, textField } from '../widgets/blocks.js?v=d4943bd8ca';
import { exercise } from '../widgets/questions.js?v=d4943bd8ca';
import { updateBadge } from './shell.js?v=d4943bd8ca';

const MODE_ZH = { dict: '聽寫', shadow: '跟讀', vocab: '單字', grammar: '文法', order: '重組', trans: '翻譯' };
export const PRACTICE_MODES = core.PRACTICE_MODE_IDS.map((id) => [id, MODE_ZH[id]]);
const ORDER_WORDS = [5, 12]; // sentence length (words) used for rebuilding

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

export async function practicePage(requested) {
  const mode = PRACTICE_MODES.some(([m]) => m === requested) ? requested : store.settings.practiceMode;
  if (store.settings.practiceMode !== mode) store.setSetting('practiceMode', mode);
  const pool = await library.practicePool();
  const pick = picker();
  const stage = h('div');
  const tally = h('p', { class: 'muted' }, '這一輪還沒作答');
  let right = 0;
  let total = 0;
  const counted = (ok) => {
    total += 1;
    if (ok) right += 1;
    tally.textContent = `這一輪：答對 ${right} / ${total}`;
    store.logPractice(mode, ok);
  };
  const coach = library.latestCoach();
  const weakPoints = new Set((coach?.weak_grammar || []).map((g) => g.point));
  const words = library.fullDeck().filter((v) => v.date <= today());

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
      const v = pick(words, words.filter((x) => isWeak(store.card(x.word))));
      const nextBtn = nextButton(false);
      const out = h('div');
      const check = () => {
        if (!input.value.trim() || input.disabled) return;
        input.disabled = true;
        const ok = core.normalizeAnswer(input.value) === core.normalizeAnswer(v.word);
        counted(ok);
        const card = store.card(v.word);
        if (!ok && card && card.due > today()) {
          store.setCard(v.word, { ...card, due: today() });
          store.save();
          updateBadge();
        }
        checkBtn.hidden = true;
        nextBtn.hidden = false;
        put(out, h('p', { class: `explain ${ok ? 'ok' : 'bad'}` }, ok ? '正確！' : `答案是 ${v.word}${card ? '，已加到今天的單字複習。' : ''}`),
          h('p', { class: 'example' }, v.example, ' ', sayBtn(v.example)));
      };
      const input = textField(`${v.word[0]}… 輸入英文`, check);
      const checkBtn = h('button', { class: 'btn', type: 'button', onclick: check }, '檢查');
      return { card: practiceCard([h('p', { class: 'zh-big' }, v.zh), h('p', { class: 'def' }, v.definition), h('p', { class: 'example' }, core.clozeOf(v)), input, out], [checkBtn, nextBtn]) };
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
      const words_ = s.en.split(/\s+/);
      let bank = shuffle(words_.map((w, i) => ({ w, i })));
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
        if (locked || chosen.length !== words_.length) { if (!locked) toast('還有字沒放進去。'); return; }
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
        const score = core.translationScore(t, value);
        counted(score >= TRANS_PASS);
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
