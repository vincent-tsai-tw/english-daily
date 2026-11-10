// Every lesson day so far, with the questions left unanswered per section and links that jump
// straight to them.

import * as core from '../core.js?v=4aac385308';
import { store, library } from '../state.js?v=4aac385308';
import { today } from '../store.js?v=4aac385308';
import { h, icon, formatDate } from '../dom.js?v=4aac385308';
import { rerender } from '../nav.js?v=4aac385308';
import { SECTIONS } from '../sections.js?v=4aac385308';

const { SECTION_ITEMS, CHALLENGE_ITEMS } = core;
let historyFilter = 'all';

// {total, missing} answerable items for a section of a lesson.
const itemStatus = (entry, prefixes) => core.itemStatus(entry, prefixes, (k) => store.answered(entry.date, k));

function historyRows() {
  return library.index.filter((x) => x.date <= today()).map((x) => {
    const secs = Object.fromEntries(Object.entries(SECTION_ITEMS).map(([id, p]) => [id, itemStatus(x, p)]));
    // A section counts as skipped once its day is over, or once the learner started or finished it.
    const missed = (id) => {
      const st = secs[id];
      return st.missing && (x.date < today() || store.isDone(x.date, id) || st.missing < st.total) ? st.missing : 0;
    };
    const total = Object.keys(SECTION_ITEMS).reduce((n, id) => n + missed(id), 0);
    return { x, secs, missed, total, ch: x.challenge ? itemStatus(x, CHALLENGE_ITEMS) : null };
  });
}

function historyRow({ x, missed, ch }) {
  const n = SECTIONS.filter((s) => store.isDone(x.date, s.id)).length;
  const chip = (cls, href, ...kids) => h('a', { class: `h-sec${cls ? ` ${cls}` : ''}`, href }, ...kids);
  const chips = SECTIONS.map((s) => {
    const m = SECTION_ITEMS[s.id] ? missed(s.id) : 0;
    if (m) return chip('miss', `#/l/${x.date}/${s.id}/todo`, `${s.zh} 漏 ${m}`);
    if (store.isDone(x.date, s.id)) return chip('ok', `#/l/${x.date}/${s.id}`, icon('check'), s.zh);
    return chip('', `#/l/${x.date}/${s.id}`, s.zh);
  });
  if (ch) {
    const started = ch.missing < ch.total || store.isDone(x.date, 'challenge');
    chips.push(!ch.missing ? chip('ok', `#/l/${x.date}/challenge`, icon('check'), '挑戰')
      : started ? chip('miss', `#/l/${x.date}/challenge/todo`, `挑戰 漏 ${ch.missing}`)
        : chip('', `#/l/${x.date}/challenge`, `挑戰 ${x.challenge}`));
  }
  const fb = library.feedback[x.date];
  if (fb) chips.push(chip('ok', `#/l/${x.date}/write`, `作文 ${fb.score}/10`));
  return h('li', { class: 'card history-card' },
    h('div', { class: 'h-top' },
      h('span', { class: 'h-date' }, formatDate(x.date), x.date === today() ? h('span', { class: 'tag' }, '今天') : null),
      h('span', { class: `arc-prog${n === SECTIONS.length ? ' full' : ''}` }, `${n}/${SECTIONS.length}`)),
    h('a', { class: 'h-title', href: `#/l/${x.date}` }, x.theme_zh, h('small', {}, `${x.theme}・${x.level}`)),
    h('div', { class: 'h-secs' }, chips));
}

export function historyPage() {
  const rows = historyRows();
  const missingDays = rows.filter((r) => r.total).length;
  const totalMissing = rows.reduce((n, r) => n + r.total, 0);
  const shown = historyFilter === 'missing' ? rows.filter((r) => r.total) : rows;
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '篩選' },
    [['all', `全部（${rows.length}）`], ['missing', `有漏寫（${missingDays}）`]].map(([k, label]) => h('button', {
      type: 'button', class: historyFilter === k ? 'on' : '', onclick: () => { historyFilter = k; rerender(); },
    }, label)));
  return h('div', { class: 'page' },
    h('p', { class: 'eyebrow' }, '練習紀錄・History'),
    h('h1', { class: 'headline' }, '每天的練習'),
    h('p', { class: 'lede' }, totalMissing
      ? `還有 ${totalMissing} 題沒寫。點紅色標籤會直接跳到那一節，沒寫的題目會用虛線框起來。`
      : '每一課的題目都寫完了。點任何一天都可以回去複習。'),
    h('div', { class: 'toolbar' }, seg),
    shown.length ? h('ul', { class: 'history' }, shown.map(historyRow)) : h('p', { class: 'muted' }, '沒有漏寫的題目，太棒了。'));
}
