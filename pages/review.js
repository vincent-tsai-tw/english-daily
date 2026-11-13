// Spaced word review (recognise or spell) and the panel that redoes wrong answers.

import * as core from '../core.js?v=8942a1287a';
import { store, library } from '../state.js?v=8942a1287a';
import { today } from '../store.js?v=8942a1287a';
import { h, put, icon, formatDate, toast } from '../dom.js?v=8942a1287a';
import { rerender } from '../nav.js?v=8942a1287a';
import { sayBtn } from '../widgets/audio.js?v=8942a1287a';
import { textField } from '../widgets/blocks.js?v=8942a1287a';
import { exercise } from '../widgets/questions.js?v=8942a1287a';
import { updateBadge } from './shell.js?v=8942a1287a';

export function reviewPage() {
  const t = today();
  const queue = library.reviewQueue();
  const total = queue.length;
  const stage = h('div', { class: 'stage' });
  let pos = 0;

  const modeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '複習方式' },
    [['recognize', '看字想意思'], ['spell', '看意思拼字']].map(([mode, label]) => h('button', {
      type: 'button', class: store.settings.reviewMode === mode ? 'on' : '',
      onclick: () => { store.setSetting('reviewMode', mode); rerender(); },
    }, label)));

  const gradeButtons = (item, suggested) => {
    const card = store.card(item.v.word);
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
      h('p', { class: 'zh-big' }, v.zh), h('p', { class: 'def' }, v.definition), h('p', { class: 'example' }, core.clozeOf(v)),
      input, checkBtn, result);
  };

  const grade = (item, g) => {
    const introduced = item.isNew && !store.card(item.v.word) ? 1 : 0;
    store.setCard(item.v.word, core.schedule(store.card(item.v.word), g, t));
    store.logReview(t, { reviewed: 1, introduced });
    if (g === core.GRADE.again && !item.again) queue.push({ v: item.v, isNew: false, again: true });
    store.save();
    updateBadge();
    pos += 1;
    show();
  };

  const show = () => {
    if (pos >= queue.length) {
      put(stage, h('div', { class: 'flash' },
        h('p', { class: 'done-note' }, icon('check'), total ? '今天的單字複習完成了！' : '目前沒有要複習的單字。'),
        h('p', { class: 'muted center' }, `今天已複習 ${store.reviewLog(t).reviewed} 次。明天會依記憶狀況排出新的複習。`),
        h('a', { class: 'btn', href: '#/practice/vocab' }, '還想練？單字自由練習')));
      return;
    }
    const item = queue[pos];
    put(stage, store.settings.reviewMode === 'spell' ? spellCard(item) : recognizeCard(item));
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

const pickMistake = (L, m) => core.itemOf(L, `${m.kind}.${m.i}`);

function mistakesPanel() {
  const list = store.activeMistakes();
  if (!list.length) return h('p', { class: 'muted' }, '目前沒有錯題。單字小測驗、閱讀、文法、聽力答錯的題目會出現在這裡。');
  const box = h('div');
  const btn = h('button', {
    class: 'btn', type: 'button',
    onclick: async () => {
      btn.disabled = true;
      const rows = await Promise.all(list.map(async (m) => ({ m, item: pickMistake(await library.lesson(m.date), m) })));
      put(box, h('ol', { class: 'questions' }, rows.filter((r) => r.item).map(({ m, item }) => {
        let value = null;
        return h('li', {}, h('p', { class: 'muted' }, `${formatDate(m.date)}・${core.ITEMS[m.kind]?.zh || m.kind}`),
          exercise(item, { get: () => value, set: (v) => { value = v; } }, (ok) => { store.recordMistake(m, ok); if (ok) toast('答對了，已從錯題移除。'); }));
      })));
    },
  }, `重練錯題（${list.length} 題）`);
  box.append(btn);
  return box;
}
