// The weekly review test as other pages see it: labels, the week's date range, the home-page
// card that offers the test and the dashboard's table of past tests. The rules are in core.js.

import * as core from '../core.js?v=8942a1287a';
import { store, library } from '../state.js?v=8942a1287a';
import { today } from '../store.js?v=8942a1287a';
import { h, pct, shortDate } from '../dom.js?v=8942a1287a';

export const PART_ZH = { vocab: '單字', grammar: '文法', dict: '聽寫', trans: '翻譯' };
export const PARTS = Object.keys(core.WEEKLY_CAPS);

export const weekRange = (week) => `${shortDate(week)}–${shortDate(core.weekEnd(week))}`;

// How a part did: right / answered for questions, the mean score for typed sentences.
export function partScore(prefix, part) {
  if (!part?.answered) return '—';
  return core.ITEMS[prefix].scoring === 'question' ? `${Math.round(part.acc * part.answered)}/${part.answered}` : pct(part.acc);
}

// Offered on the home page from Sunday until the test is handed in.
export function weeklyCard() {
  const due = core.weeklyDue(library.index, store.state, today());
  if (!due || due.status === 'done') return null;
  const which = due.week === core.weekOf(today()) ? '本週' : '上週';
  const sum = core.weeklySummary(due.record);
  return h('a', { class: 'card notice', href: `#/weekly/${due.week}` },
    h('strong', {}, due.status === 'started' ? `${which}總複習做到一半（${sum.answered}/${sum.asked} 題）` : `${which}總複習測驗（${weekRange(due.week)}）`),
    h('span', { class: 'muted' }, `把這 ${due.dates.length} 課的單字、文法、聽寫、翻譯再測一次，老師會依結果安排接下來的課。`));
}

// Finished tests, newest first, one row each. `link` adds the way to the result page.
export function weeklyTable(weekly, link) {
  const done = core.weeklyDone(weekly).slice(0, 8);
  if (!done.length) return null;
  return h('div', { class: 'table-wrap' }, h('table', { class: 'mini-table weekly-table' },
    h('thead', {}, h('tr', {}, h('th', {}, '週'), h('th', {}, '總分'), PARTS.map((p) => h('th', {}, PART_ZH[p])))),
    h('tbody', {}, done.map((r) => {
      const sum = core.weeklySummary(r);
      return h('tr', {},
        h('td', {}, link ? h('a', { href: `#/weekly/${r.week}` }, weekRange(r.week)) : weekRange(r.week)),
        h('td', {}, h('strong', {}, sum.score == null ? '—' : pct(sum.score))),
        PARTS.map((p) => h('td', {}, partScore(p, sum.parts[p]))));
    }))));
}
