// Settings: the current profile, cross-device sync, voice and review options, manual backup;
// and the learning-goals page.

import * as core from '../core.js?v=d4943bd8ca';
import * as speech from '../speech.js?v=d4943bd8ca';
import * as gist from '../gist.js?v=d4943bd8ca';
import { store, syncer } from '../state.js?v=d4943bd8ca';
import { freshState, withSettings } from '../store.js?v=d4943bd8ca';
import { h, put, icon, toast, formatTime, copyText } from '../dom.js?v=d4943bd8ca';
import { rerender } from '../nav.js?v=d4943bd8ca';
import { ttsOpts } from '../widgets/audio.js?v=d4943bd8ca';
import { setQuiet, updateBadge } from './shell.js?v=d4943bd8ca';

function syncGroup() {
  const cfg = syncer.config;
  if (syncer.connected) {
    let armed = false;
    const off = h('button', {
      class: 'btn subtle', type: 'button',
      onclick: () => {
        if (!armed) { armed = true; off.textContent = '再按一次確認中斷'; return; }
        syncer.disconnect();
        toast('已中斷同步。這台裝置的紀錄還在。');
        rerender();
      },
    }, '中斷連線');
    const syncBtn = h('button', {
      class: 'btn', type: 'button',
      onclick: async () => {
        syncBtn.disabled = true;
        await syncer.now({ manual: true });
        if (!syncer.config.error) toast('同步完成。');
        rerender();
      },
    }, '立即同步');
    const share = h('button', {
      class: 'btn', type: 'button',
      onclick: () => copyText(cfg.token, '已複製。到另一台裝置的「設定 → 跨裝置同步」貼上，按「連線」。'),
    }, '複製 token 給另一台裝置');
    const status = cfg.error ? `上次同步失敗：${cfg.error}` : cfg.last ? `上次同步：${formatTime(cfg.last)}` : '還沒同步過';
    return h('div', { class: 'group' }, h('div', { class: 'setting' },
      h('span', {}, h('strong', {}, '跨裝置同步：已連線'),
        h('small', {}, `GitHub 帳號 ${cfg.login}。作答紀錄會自動同步到你的私人 gist，每天出題也會依這些紀錄調整。`)),
      h('p', { class: cfg.error ? 'sync-status bad' : 'sync-status' }, status),
      h('div', { class: 'row' }, syncBtn, off),
      share,
      h('small', { class: 'muted' }, 'Mac 和 iPhone 登入同一個 Apple ID 時，在這裡複製後可以直接到另一台貼上（通用剪貼板）。')));
  }
  const input = h('input', { class: 'field', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: '貼上 ghp_ 開頭的 token' });
  const go = h('button', {
    class: 'btn primary', type: 'button',
    onclick: async () => {
      const token = input.value.trim();
      if (!token) return;
      go.disabled = true;
      go.textContent = '連線中…';
      try {
        await syncer.connect(token);
        toast('已連線，作答紀錄開始同步。');
        rerender();
      } catch (err) {
        toast(err.message);
        go.disabled = false;
        go.textContent = '連線';
      }
    },
  }, '連線');
  return h('div', { class: 'group' }, h('div', { class: 'setting' },
    h('span', {}, h('strong', {}, '跨裝置同步'),
      h('small', {}, '開啟後手機和電腦的進度會一致，每天出題也能看到你的作答紀錄，依弱點加強、依表現調整難度。')),
    h('ol', { class: 'steps' },
      h('li', {}, '按「建立 token」：會開 GitHub 網頁，已經幫你勾好 gist 權限。'),
      h('li', {}, 'Expiration 選「No expiration」，拉到最下面按「Generate token」。'),
      h('li', {}, '複製 ghp_ 開頭的那串字，回到這裡貼上，按「連線」。'),
      h('li', {}, '另一台裝置：在已連線的裝置按「複製 token 給另一台裝置」，到這裡貼上就好，不用再建立。')),
    h('a', { class: 'btn', href: gist.TOKEN_URL, target: '_blank', rel: 'noopener' }, '建立 token'),
    input,
    go,
    h('small', { class: 'muted' }, 'token 只存在這個瀏覽器，只能讀寫你的 gist，碰不到你的 repo。紀錄存在一個不公開的 gist 裡。')));
}

const GOALS = ['職場溝通', '開會與簡報', '出國旅遊', '日常聊天', '看影集電影', '考試（多益等）', '閱讀新聞文章'];
const INTERESTS = ['科技', '商業財經', '美食', '旅遊', '運動健身', '電影影集', '音樂', '家庭親子', '健康', '寵物', '藝術設計', '科學'];
const MINUTES = [10, 20, 30, 45];

// What the learner wants: shapes the themes, examples and length of their next lessons.
export function goalsPage() {
  const p = store.state.profile || {};
  const chosen = { goals: new Set(p.goals || []), interests: new Set(p.interests || []) };
  let minutes = p.minutes || 30;
  const chips = (key, options) => h('div', { class: 'chips pick' }, options.map((o) => {
    const chip = h('button', {
      type: 'button', class: `chip${chosen[key].has(o) ? ' on' : ''}`, 'aria-pressed': String(chosen[key].has(o)),
      onclick: () => {
        if (chosen[key].has(o)) chosen[key].delete(o); else chosen[key].add(o);
        chip.classList.toggle('on', chosen[key].has(o));
        chip.setAttribute('aria-pressed', String(chosen[key].has(o)));
      },
    }, o);
    return chip;
  }));
  const timeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': '每天練習時間' });
  const paintTime = () => timeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.m) === minutes));
  for (const m of MINUTES) timeSeg.append(h('button', { type: 'button', 'data-m': m, onclick: () => { minutes = m; paintTime(); } }, `${m} 分`));
  paintTime();
  const saveBtn = h('button', {
    class: 'btn primary wide', type: 'button',
    onclick: () => {
      store.setProfile({ goals: [...chosen.goals], interests: [...chosen.interests], minutes });
      toast('已儲存。明天早上的課會照你的目標和興趣出題。');
      location.hash = '#/';
    },
  }, '儲存');
  return h('div', { class: 'page' },
    h('p', { class: 'eyebrow' }, '學習目標・Goals'),
    h('h1', { class: 'headline' }, `${store.me.name}，你想把英文用在哪裡？`),
    h('p', { class: 'lede' }, '每天出題時會參考這裡：情境和例句會貼近你的目標與興趣，課程長度也會配合你的時間。隨時可以改。'),
    h('h2', { class: 'section-title' }, '學習目標'), chips('goals', GOALS),
    h('h2', { class: 'section-title' }, '興趣'), chips('interests', INTERESTS),
    h('h2', { class: 'section-title' }, '每天大約有多少時間？'), timeSeg,
    h('h2', { class: 'section-title' }, '還想告訴老師什麼？'),
    h('a', { class: 'card notice', href: '#/notes' }, h('strong', {}, '到「給老師的留言」寫 ›'),
      h('span', { class: 'muted' }, '哪裡覺得不夠好、想多練什麼情境，寫在那裡，隔天的課會回應你。')),
    h('div', { class: 'finish' }, saveBtn));
}

function profileGroup() {
  return h('div', { class: 'group' }, h('div', { class: 'setting' },
    h('span', {}, h('strong', {}, `目前使用者：${store.me.name}`),
      h('small', {}, '這台裝置顯示的是這個人的課程和進度。家人共用裝置時可以切換。')),
    h('div', { class: 'row' }, h('button', {
      class: 'btn', type: 'button',
      onclick: async () => {
        await syncer.flush();
        store.signOut();
        location.hash = '#/';
        rerender();
      },
    }, '切換使用者'), h('a', { class: 'btn', href: '#/goals' }, '學習目標與興趣'))));
}

export function settingsPage() {
  const S = store.state;
  const voiceSel = h('select', { class: 'field', 'aria-label': '朗讀聲音', onchange: () => store.setSetting('voice', voiceSel.value) });
  speech.voicesReady().then((voices) => {
    put(voiceSel, h('option', { value: '' }, '自動選擇（推薦）'),
      ...voices.map((v) => h('option', { value: v.name, selected: v.name === S.settings.voice }, `${v.name}（${v.lang}）`)));
  });
  const rateSel = h('select', { class: 'field', 'aria-label': '語速', onchange: () => store.setSetting('rate', Number(rateSel.value)) },
    [0.7, 0.8, 0.9, 1, 1.1, 1.2].map((r) => h('option', { value: r, selected: r === S.settings.rate }, `${r}×`)));
  const newSel = h('select', { class: 'field', 'aria-label': '每天新字上限', onchange: () => { store.setSetting('newPerDay', Number(newSel.value)); updateBadge(); } },
    [5, 10, 15, 20, 30].map((n) => h('option', { value: n, selected: n === S.settings.newPerDay }, `${n} 個`)));
  const quiet = h('input', { type: 'checkbox', class: 'switch', checked: S.settings.quiet, onchange: () => setQuiet(quiet.checked, false) });

  const exportBox = h('textarea', { class: 'field mono', rows: 4, readonly: true }, JSON.stringify(S));
  const importBox = h('textarea', { class: 'field mono', rows: 4, placeholder: '貼上從另一台裝置匯出的紀錄' });
  const doImport = () => {
    try {
      const data = JSON.parse(importBox.value);
      if (!data || typeof data.srs !== 'object' || typeof data.done !== 'object') throw new Error('format');
      store.replaceState(withSettings(data));
      store.save();
      toast('匯入完成。');
      rerender();
    } catch {
      toast('格式不對：請貼上完整的匯出內容。');
    }
  };
  let armed = false;
  const resetBtn = h('button', {
    class: 'btn danger', type: 'button',
    onclick: () => {
      if (!armed) { armed = true; resetBtn.textContent = '再按一次確認清除'; return; }
      store.replaceState(freshState());
      store.persist();
      toast('這台裝置的學習紀錄已清除。');
      rerender();
    },
  }, '清除這台裝置的紀錄');

  return h('div', { class: 'page' },
    h('p', { class: 'eyebrow' }, '設定・Settings'),
    h('h1', { class: 'headline' }, '設定'),
    profileGroup(),
    syncGroup(),
    h('div', { class: 'group' },
      h('label', { class: 'setting' }, h('span', {}, h('strong', {}, '安靜模式'), h('small', {}, '在外面不方便說話時開啟：口說題改成默念或打字，記到「口說待補」。')), quiet),
      h('label', { class: 'setting' }, h('span', {}, h('strong', {}, '備用朗讀聲音'), h('small', {}, '最近的課都有預先錄好的真人感語音，會優先播放；這裡的聲音只用在沒有錄音的句子。')), voiceSel),
      h('div', { class: 'row' }, h('button', { class: 'btn subtle', type: 'button', onclick: () => speech.say('Hi! This is how I sound. Is the speed comfortable for you?', ttsOpts()) }, icon('speaker'), '試聽')),
      h('label', { class: 'setting' }, h('span', {}, h('strong', {}, '語速')), rateSel),
      h('label', { class: 'setting' }, h('span', {}, h('strong', {}, '每天新單字上限'), h('small', {}, '複習頁每天最多加入幾個沒學過的字。')), newSel)),
    h('h2', { class: 'section-title' }, '手動備份'),
    h('p', { class: 'muted' }, '沒開同步時，可以在舊裝置複製匯出內容，再到新裝置貼上匯入。開了同步就不需要。'),
    exportBox,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => copyText(exportBox.value, '已複製匯出內容。') }, '複製匯出內容')),
    importBox,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: doImport }, '匯入'), resetBtn),
    h('p', { class: 'muted' }, '開著同步時，清除只會清這台裝置；下次同步會把雲端的紀錄拿回來。'),
    h('h2', { class: 'section-title' }, '關於'),
    h('p', { class: 'muted' }, '每天的題目由 AI 自動生成並經母語老師審核，仍可能有錯。字典資料來自開源的 ECDICT（MIT 授權）；查不到的字改用線上字典。'));
}
