// Notes to the teacher: the learner writes what they want to work on; the next lessons answer
// through their `replies`, which the index carries (core.notesSummary pairs them up).

import * as core from '../core.js?v=8942a1287a';
import { store } from '../state.js?v=8942a1287a';
import { writeText } from '../store.js?v=8942a1287a';
import { h, toast, formatDate, shortDate } from '../dom.js?v=8942a1287a';
import { rerender } from '../nav.js?v=8942a1287a';
import { notesOverview as overview, notesSeenKey as seenKey } from '../widgets/notes.js?v=8942a1287a';

const NOTE_SKILLS = ['單字', '閱讀', '文法', '聽力', '口說', '寫作', '其他'];

function noteCard(n, closed) {
  const toggle = h('button', {
    class: 'btn subtle', type: 'button',
    onclick: () => { store.setNoteClosed(n.id, !closed); toast(closed ? '已重新打開，老師會再看到。' : '已收起。'); rerender(); },
  }, closed ? '重新打開' : '學會了，收起');
  return h('div', { class: `card note${closed ? ' closed' : ''}` },
    h('p', { class: 'note-meta' }, formatDate(core.localDate(new Date(n.t || 0))), n.skill ? h('span', { class: 'chip' }, n.skill) : null),
    h('p', { class: 'note-text' }, n.text),
    n.replies.length
      ? n.replies.map((r) => h('div', { class: 'note-reply' },
        h('strong', {}, `老師在 ${shortDate(r.date)} 的課回應了`), h('p', {}, r.zh), h('a', { href: `#/l/${r.date}` }, '看那天的課 ›')))
      : (closed ? null : h('p', { class: 'muted' }, '老師還沒看到，明天早上的課會回應。')),
    h('div', { class: 'row' }, toggle));
}

export function notesPage() {
  const o = overview();
  if (o.latestReply) writeText(seenKey(), o.latestReply);
  let skill = '';
  const text = h('textarea', { class: 'field', rows: 4, placeholder: '例如：完成式還是會搞錯、想練電話會議的開場、聽快一點的對話會跟不上…' });
  const chips = h('div', { class: 'chips pick' }, NOTE_SKILLS.map((s) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': 'false',
    onclick: () => {
      skill = skill === s ? '' : s;
      chips.querySelectorAll('.chip').forEach((b) => { const on = b.textContent === skill; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    },
  }, s)));
  const send = h('button', {
    class: 'btn primary wide', type: 'button',
    onclick: () => {
      const v = text.value.trim();
      if (!v) { toast('先寫一點想加強的地方。'); text.focus(); return; }
      store.addNote(v, skill);
      toast('已送出。明天的課會回應你。');
      rerender();
    },
  }, '送出給老師');
  return h('div', { class: 'page' },
    h('p', { class: 'eyebrow' }, '給老師的留言・Notes'),
    h('h1', { class: 'headline' }, '哪裡想加強？告訴老師'),
    h('p', { class: 'lede' }, '寫下你覺得不夠好、想多練的地方。明天的課會回應你，學習顧問也會參考。'),
    text,
    h('p', { class: 'muted' }, '類別（選填）'), chips,
    send,
    o.open.length ? h('h2', { class: 'section-title' }, `留言（${o.open.length}）`) : null,
    o.open.map((n) => noteCard(n, false)),
    o.closed.length ? h('details', { class: 'adv-more' }, h('summary', {}, `已收起的留言（${o.closed.length}）`),
      o.closed.map((n) => noteCard(n, true))) : null);
}
