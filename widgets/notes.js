// The learner's notes to the teacher as the home page and dashboard see them: the overview
// (open, closed, answered, unread replies) and the card that links to the notes page.

import * as core from '../core.js?v=eae654e601';
import { store, library } from '../state.js?v=eae654e601';
import { readText } from '../store.js?v=eae654e601';
import { h } from '../dom.js?v=eae654e601';

export const notesSeenKey = () => `english-daily:notes-seen:${store.slug}`; // newest reply date already seen on this device
export const notesOverview = () => core.notesSummary(store.state.notes, library.index, readText(notesSeenKey()));

// Unread replies first, else how many notes are waiting.
export function notesCard() {
  const o = notesOverview();
  if (o.unseen) {
    return h('a', { class: 'card notice', href: '#/notes' }, h('strong', {}, `老師回應了你的留言（${o.unseen}）`),
      h('span', { class: 'muted' }, '看看今天的課怎麼回應你想加強的地方。'));
  }
  return h('a', { class: 'card notice', href: '#/notes' },
    h('strong', {}, o.open.length ? `給老師的留言：${o.open.length} 則${o.replied ? `，已回應 ${o.replied} 則` : ''}` : '想請老師加強什麼？留言給老師'),
    h('span', { class: 'muted' }, '寫下你覺得不夠好的地方，明天的課會回應你。'));
}
