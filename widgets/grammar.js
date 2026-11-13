// Grammar diagrams: a formula drawn as blocks, a past–now–future timeline, one card per usage with
// its own examples, and wrong/right pairs (lesson-format.md, grammar.guide).

import * as core from '../core.js?v=8942a1287a';
import { h } from '../dom.js?v=8942a1287a';
import { sayBtn } from './audio.js?v=8942a1287a';

const formula = (form) => h('div', { class: 'formula' }, core.formulaParts(form).map((p) =>
  h('span', { class: `fx ${p.kind}` }, p.text)));

export const exampleLine = (x) => h('li', {},
  h('p', { class: 'example' }, x.en, ' ', sayBtn(x.en)), h('p', { class: 'zh-sub' }, x.zh));

function timelineChart(items) {
  const pct = core.timelinePct;
  return h('div', { class: 'card tl' },
    h('p', { class: 'eyebrow' }, '時間圖'),
    h('div', { class: 'tl-body', style: `--now:${pct(0)}%` },
      items.map((t) => {
        const span = t.at == null;
        const from = pct(span ? t.from : t.at);
        const to = pct(span ? t.to : t.at);
        const mid = (from + to) / 2;
        const align = mid < 40 ? 'left' : mid > 60 ? 'right' : 'center';
        return h('div', { class: `tl-row hue${t.use ?? 'x'}` },
          h('p', { class: `tl-label ${align}` }, t.label),
          t.note_zh ? h('p', { class: `tl-note ${align}` }, t.note_zh) : null,
          h('div', { class: 'tl-track' }, span
            ? h('span', { class: 'tl-bar', style: `left:${from}%;width:${to - from}%` })
            : h('span', { class: 'tl-dot', style: `left:${from}%` })));
      })),
    h('div', { class: 'tl-axis' }, h('span', {}, '過去'), h('span', {}, '現在'), h('span', {}, '未來')));
}

function mistakeList(mistakes) {
  return h('div', { class: 'card' },
    h('p', { class: 'eyebrow' }, '常見錯誤'),
    h('ul', { class: 'mistakes' }, mistakes.map((m) => h('li', {},
      h('p', { class: 'wrong' }, h('b', {}, '✗'), ' ', m.wrong),
      h('p', { class: 'right' }, h('b', {}, '✓'), ' ', m.right),
      h('p', { class: 'why' }, m.why_zh)))));
}

// The whole diagram for a grammar point (or a review that carries the teaching lesson's guide).
export function grammarGuide(g, examples) {
  const guide = g.guide;
  return [
    h('div', { class: 'key-point' }, h('span', { class: 'eyebrow' }, '重點'), h('p', {}, guide.key_zh)),
    guide.timeline?.length ? timelineChart(guide.timeline) : null,
    h('h2', { class: 'section-title' }, '怎麼用'),
    h('p', { class: 'fx-legend' }, h('span', { class: 'fx word' }, '實心'), '照著用　',
      h('span', { class: 'fx slot' }, '虛線'), '換成你的內容'),
    h('div', { class: 'uses' }, guide.uses.map((u, i) => {
      const own = (examples || []).filter((x) => x.use === i);
      return h('div', { class: `card use hue${i}` },
        h('p', { class: 'use-label' }, h('span', { class: 'use-n' }, String(i + 1)), u.label_zh),
        formula(u.form),
        u.signal ? h('p', { class: 'signal' }, '常見提示字：', u.signal) : null,
        own.length ? h('ul', { class: 'examples' }, own.map(exampleLine)) : null,
        u.note_zh ? h('p', { class: 'use-note' }, h('b', {}, '注意　'), u.note_zh) : null);
    })),
    guide.mistakes?.length ? mistakeList(guide.mistakes) : null,
  ];
}
