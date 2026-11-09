// DOM helpers shared by every page: element builders, small formatters, the toast and the bottom
// sheet. Nothing here knows about the learner's state.

import * as core from './core.js?v=d4943bd8ca';

export const WEEKDAYS = '日一二三四五六';

export const ICONS = {
  speaker: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  turtle: '<svg viewBox="0 0 24 24"><path d="M4 15c0-4 3.5-7 8-7s8 3 8 7H4z" fill="currentColor"/><path d="M6 15l-1 3M18 15l1 3M20 13h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" stroke-width="1.9"/></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13.5 2.5L5 13.5h6l-1 8 8.5-11h-6z" fill="currentColor"/></svg>',
};

// Build an element: attributes starting with "on" become listeners; null/false children are skipped.
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}

export function icon(name) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = ICONS[name];
  return span;
}

export const $ = (sel) => document.querySelector(sel);

// Replace an element's children, skipping null/false. The DOM's own replaceChildren() would
// turn a null into the text "null".
export function put(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
}

export const pct = (x) => `${Math.round(x * 100)}%`;
export const randomItem = (list) => list[Math.floor(Math.random() * list.length)];

// A shuffled copy (Fisher–Yates).
export function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function formatDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}月${d}日 星期${WEEKDAYS[wd]}`;
}

export const shortDate = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export function formatTime(ms) {
  const d = new Date(ms);
  const date = core.localDate(d) === core.localDate() ? '今天' : formatDate(core.localDate(d));
  return `${date} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function stat(value, label) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-num' }, value), h('div', { class: 'stat-label' }, label));
}

export function levelTag(level, change) {
  return h('span', { class: `level${change === 'up' ? ' up' : change === 'down' ? ' down' : ''}` },
    level, change === 'up' ? ' ↑' : change === 'down' ? ' ↓' : '');
}

let toastTimer;
export function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

export function showSheet(...nodes) {
  const sheet = $('#sheet');
  put(sheet, h('div', { class: 'sheet-inner' },
    h('button', { class: 'sheet-close', type: 'button', 'aria-label': '關閉', onclick: hideSheet }, '×'), ...nodes));
  sheet.hidden = false;
}

export function hideSheet() { $('#sheet').hidden = true; }

export async function copyText(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    showSheet(h('p', {}, '無法自動複製，請長按下面的文字全選複製：'), h('textarea', { class: 'field', rows: 8, readonly: true }, text));
  }
}
