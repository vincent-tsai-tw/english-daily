// The parts of the page around the current view: profile picker, welcome and error screens, the
// quiet-mode button, the review badge, the sync line, the unanswered markers and the update bell.

import { store, library, syncer } from '../state.js?v=8942a1287a';
import { readText, writeText } from '../store.js?v=8942a1287a';
import { h, $, put, icon, formatDate, formatTime, toast, showSheet } from '../dom.js?v=8942a1287a';
import { LoadError } from '../net.js?v=8942a1287a';
import { rerender } from '../nav.js?v=8942a1287a';

const SEEN_KEY = 'english-daily:seen-release';

export function profilePage(choose) {
  return h('div', { class: 'page signin' },
    h('p', { class: 'eyebrow' }, 'English Daily'),
    h('h1', { class: 'headline' }, '你是誰？'),
    h('p', { class: 'lede' }, '選一次就好，這台裝置之後會記得。每個人有自己的課程和進度。'),
    h('div', { class: 'profiles' }, library.profiles.map((p) => h('button', {
      class: 'profile', type: 'button', onclick: () => choose(p),
    }, h('span', { class: 'avatar' }, p.name.slice(0, 1).toUpperCase()), h('span', {}, p.name)))));
}

export function welcomePage() {
  return h('div', { class: 'page' },
    h('p', { class: 'eyebrow' }, `歡迎，${store.me.name}`),
    h('h1', { class: 'headline' }, '你的第一課正在準備中'),
    h('p', { class: 'lede' }, '每天早上 6 點多會依你的程度產生一課，明天打開這裡就能開始；之後會依你的作答自動調整難度和加強弱點。'),
    h('p', { class: 'sync-line', id: 'sync-line' }));
}

// What the page shows when it cannot be drawn. `retry` draws it again; a load error (the data
// did not arrive) is also retried by the app on its own once the network is back.
export function errorBox(err, retry) {
  const offline = err instanceof LoadError;
  const again = h('button', {
    class: 'btn primary', type: 'button',
    onclick: () => { again.disabled = true; again.textContent = '連線中…'; retry(); },
  }, '再試一次');
  return h('div', { class: 'page' },
    h('h1', { class: 'title' }, offline ? '還沒連上網路' : '出了點問題'),
    h('p', { class: 'muted' }, offline ? '課程資料沒有載入成功，通常是剛打開時網路還沒接上。網路恢復後會自動再試，也可以直接按下面的按鈕。' : err.message),
    h('div', { class: 'row' }, retry ? again : null, offline ? null : h('a', { class: 'btn', href: '#/' }, '回到今日')),
    offline ? h('p', { class: 'hint' }, `沒載入的檔案：${err.url}`) : null); // so a report says which file
}

export function setQuiet(on, repaint = true) {
  store.setSetting('quiet', on);
  paintQuiet();
  toast(on ? '安靜模式：口說題改成默念或打字。' : '已關閉安靜模式，可以開口練習了。');
  if (repaint) rerender();
}

export function paintQuiet() {
  const btn = $('#quiet');
  put(btn, icon('mic'), store.settings.quiet ? '安靜模式' : '可說話');
  btn.classList.toggle('on', store.settings.quiet);
  btn.setAttribute('aria-pressed', String(store.settings.quiet));
}

export function updateBadge() {
  const n = library.reviewQueue().length;
  const badge = $('#badge');
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.hidden = n === 0;
}

export function paintSyncLine() {
  const el = document.getElementById('sync-line');
  if (!el) return;
  const cfg = syncer.config;
  el.classList.toggle('bad', !cfg.gistId || Boolean(cfg.error));
  if (!cfg.gistId) {
    put(el, '這台裝置還沒開啟同步，進度不會和其他裝置共用・', h('a', { href: '#/settings' }, '去設定'));
  } else if (cfg.error) {
    put(el, `同步失敗：${cfg.error}・`, h('a', { href: '#/settings' }, '查看'));
  } else {
    put(el, cfg.last ? `已同步・${formatTime(cfg.last)}` : '同步中…');
  }
}

// Answerable items carry data-ans="<date>|<key>"; `.todo` marks the unanswered ones, which the
// history tab's links (#/l/<date>/<section>/todo) highlight and scroll to.
export function paintTodo() {
  document.querySelectorAll('[data-ans]').forEach((el) => {
    const [date, key] = el.dataset.ans.split('|');
    el.classList.toggle('todo', !store.answered(date, key));
  });
}

export function paintBell() {
  const log = library.changelog;
  $('#bell .dot').hidden = !log.length || log[0].version === readText(SEEN_KEY);
}

// The bell: every release with what changed, newest first. Opening it marks everything read.
export function openUpdates() {
  const seen = readText(SEEN_KEY);
  showSheet(
    h('p', { class: 'sheet-word' }, '最新更新'),
    h('div', { class: 'releases' }, library.changelog.map((r) => h('section', { class: `release${r.version > seen ? ' new' : ''}` },
      h('p', { class: 'release-date' }, formatDate(r.date), r.version > seen ? h('span', { class: 'tag' }, '新') : null),
      h('ul', {}, r.items_zh.map((x) => h('li', {}, x)))))));
  writeText(SEEN_KEY, library.changelog[0]?.version || '');
  paintBell();
}
