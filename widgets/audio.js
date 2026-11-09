// Buttons that speak, play or listen: pronunciation, read-aloud, speed, and the microphone.

import * as speech from '../speech.js?v=d4943bd8ca';
import { store } from '../state.js?v=d4943bd8ca';
import { h, icon, put, toast } from '../dom.js?v=d4943bd8ca';

export const SLOW_RATE = 0.7;
const RATES = [0.8, 1, 1.2];

export const ttsOpts = (extra = {}) => ({ voice: speech.voicePair(store.settings.voice)[0], rate: store.settings.rate, ...extra });

// Speaking prompts are answered aloud unless the learner is in quiet mode or the browser cannot listen.
export const voiceMode = () => !store.settings.quiet && speech.sttSupported();

export function sayBtn(text, label, rate) {
  if (!speech.canSpeak(text)) return null;
  return h('button', {
    class: label ? 'chip-btn' : 'icon-btn', type: 'button', 'aria-label': label || '播放發音',
    onclick: (e) => { e.stopPropagation(); speech.say(text, ttsOpts(rate ? { rate } : {})); },
  }, icon(rate ? 'turtle' : 'speaker'), label || null);
}

export const slowBtn = (text) => sayBtn(text, '慢速', SLOW_RATE);

export function playButton(label, run, available = speech.ttsSupported()) {
  if (!available) return h('span', { class: 'muted' }, '這個瀏覽器不支援朗讀');
  const btn = h('button', { class: 'btn play', type: 'button' });
  let playing = false;
  const paint = () => {
    put(btn, icon(playing ? 'stop' : 'play'), playing ? '停止' : label);
    btn.classList.toggle('on', playing);
  };
  btn.addEventListener('click', async () => {
    if (playing) { speech.stop(); return; }
    playing = true;
    paint();
    try { await run(); } finally { playing = false; paint(); }
  });
  paint();
  return btn;
}

export function rateToggle() {
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '語速' });
  const paint = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.rate) === store.settings.rate));
  for (const r of RATES) {
    seg.append(h('button', { type: 'button', 'data-rate': r, onclick: () => { store.setSetting('rate', r); paint(); } }, `${r}×`));
  }
  paint();
  return seg;
}

export function micButton({ continuous = false, label, onText, onDone }) {
  const btn = h('button', { class: 'btn mic', type: 'button' });
  let session = null;
  const paint = () => {
    put(btn, icon(session ? 'stop' : 'mic'), session ? (continuous ? '說完了' : '聆聽中・按此結束') : label);
    btn.classList.toggle('on', Boolean(session));
  };
  btn.addEventListener('click', async () => {
    if (session) { session.stop(); return; }
    try {
      session = speech.listen({ continuous, onText });
      paint();
      onDone(await session.done);
    } catch (err) {
      toast(err.message);
    } finally {
      session = null;
      paint();
    }
  });
  paint();
  return btn;
}
