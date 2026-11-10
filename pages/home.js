// The home page of a lesson day: level, coach notes, the next section to do, the six sections,
// the challenge and the review and practice calls to action.

import { store, library } from '../state.js?v=4aac385308';
import { today } from '../store.js?v=4aac385308';
import { h, icon, formatDate, stat, levelTag, showSheet } from '../dom.js?v=4aac385308';
import { SECTIONS, suggestionFor, nextSectionOf } from '../sections.js?v=4aac385308';
import { notesCard } from '../widgets/notes.js?v=4aac385308';

function coachCard(coach) {
  if (!coach?.focus_zh?.length) return null;
  return h('div', { class: 'card coach' },
    h('p', { class: 'coach-head' }, '今天的加強重點'),
    h('ul', {}, coach.focus_zh.map((f) => h('li', {}, f))));
}

function challengeCard(L, allDone) {
  const C = L.challenge;
  if (!C) return null;
  const sub = `${C.reading.title}・${C.listening.title}`;
  if (store.isDone(L.date, 'challenge')) {
    return h('a', { class: 'card challenge done', href: `#/l/${L.date}/challenge` },
      h('strong', {}, icon('check'), `挑戰加練完成（${C.level}）`), h('span', { class: 'muted' }, sub));
  }
  if (!allDone) {
    return h('div', { class: 'card challenge locked' },
      h('strong', {}, icon('lock'), `挑戰加練（${C.level}）`), h('span', { class: 'muted' }, '做完今天的六節就會解鎖：比今天高一級的文章和聽力。'));
  }
  return h('a', { class: 'card challenge', href: `#/l/${L.date}/challenge` },
    h('strong', {}, icon('bolt'), `提早做完了？挑戰加練（${C.level}）`), h('span', { class: 'muted' }, `比今天高一級：${sub}`));
}

export async function homePage(date) {
  const L = await library.lesson(date);
  const entry = library.entryFor(date);
  const done = store.state.done[date] || {};
  const finished = SECTIONS.filter((s) => done[s.id]).length;
  const suggested = suggestionFor(date);
  const next = nextSectionOf(date);
  const isCurrent = date === library.currentLessonDate();
  const notToday = isCurrent && date !== today();
  const queue = library.reviewQueue();
  const pending = store.pendingIds();
  return h('div', { class: 'page' },
    h('p', { class: 'eyebrow' }, levelTag(L.level, entry.coach?.level_change), formatDate(date),
      notToday ? '・今天的新課還沒產生，先練最近一課' : '', isCurrent ? '' : '・過去的課',
      entry.qa ? h('button', {
        class: 'qa-badge', type: 'button',
        onclick: (e) => { e.stopPropagation(); showSheet(h('p', { class: 'sheet-word' }, '母語老師審核'), h('div', { class: 'qa-notes' }, entry.qa.split('\n').map((ln) => h('p', {}, ln.replace(/^- /, ''))))); },
      }, icon('check'), '母語老師已審核', ' ›') : null),
    h('h1', { class: 'headline' }, L.theme_zh),
    h('p', { class: 'lede' }, h('strong', {}, `${L.theme}. `), L.summary_zh),
    h('div', { class: 'stats' },
      stat(`${store.streak()}`, '連續天數'), stat(`${finished}/${SECTIONS.length}`, '今日進度'),
      stat(`${queue.length}`, '待複習單字'), stat(`${library.fullDeck().length}`, '單字庫')),
    h('p', { class: 'sync-line', id: 'sync-line' }),
    isCurrent ? coachCard(entry.coach) : null,
    next
      ? h('a', { class: 'btn primary wide', href: `#/l/${date}/${next.id}` }, finished ? `繼續：${next.zh}` : '開始今天的課：單字')
      : h('p', { class: 'done-note' }, icon('check'), '這一課全部完成了！'),
    !store.state.profile?.t ? h('a', { class: 'card notice', href: '#/goals' },
      h('strong', {}, '告訴老師你的目標和興趣'), h('span', { class: 'muted' }, '花 30 秒選一選，之後的課會更貼近你想用英文的地方。')) : null,
    notesCard(),
    pending.length ? h('a', { class: 'card notice', href: `#/l/${pending[0].split('|')[0]}/speak` },
      h('strong', {}, `口說待補 ${pending.length} 題`), h('span', { class: 'muted' }, '在外面時先默念或打字的題目，回家花幾分鐘用說的補完。')) : null,
    suggested ? h('div', { class: 'card coach' }, h('p', { class: 'coach-head' }, `單字之後先做：${suggested.section.zh}`),
      h('p', { class: 'muted' }, suggested.reason)) : null,
    h('h2', { class: 'section-title' }, '今天的六節'),
    h('ul', { class: 'section-list' }, SECTIONS.map((s) => h('li', {},
      h('a', { href: `#/l/${date}/${s.id}`, class: done[s.id] ? 'done' : '' },
        h('span', { class: 'sec-name' }, s.zh, h('small', {}, s.en), s === suggested?.section ? h('span', { class: 'tag' }, '加強') : null),
        h('span', { class: 'sec-sub' }, s.sub(L)),
        h('span', { class: 'sec-meta' }, done[s.id] ? icon('check') : `${s.min} 分`))))),
    challengeCard(L, !next),
    queue.length ? h('a', { class: 'card notice', href: '#/review' },
      h('strong', {}, `複習 ${queue.length} 個單字`), h('span', { class: 'muted' }, '間隔複習：快忘記的時候再看一次，記得最牢。')) : null,
    !next ? h('a', { class: 'card notice', href: '#/practice' },
      h('strong', {}, '還想練？自由練習'), h('span', { class: 'muted' }, '聽寫、跟讀、單字、文法、翻譯，從學過的課隨機出題，不限題數。')) : null);
}
