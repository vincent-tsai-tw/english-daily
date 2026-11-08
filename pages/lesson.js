// The six sections of a lesson, the section page that walks through them, and the challenge page.

import * as core from '../core.js?v=98a517667b';
import * as speech from '../speech.js?v=98a517667b';
import { store, library } from '../state.js?v=98a517667b';
import { today } from '../store.js?v=98a517667b';
import { h, put, icon, toast, formatDate, copyText, pct, levelTag } from '../dom.js?v=98a517667b';
import { SECTIONS, nextSectionOf } from '../sections.js?v=98a517667b';
import { sayBtn, slowBtn, ttsOpts, micButton, voiceMode } from '../widgets/audio.js?v=98a517667b';
import { diffView, scoreLine, vocabItems, readingBlock, listeningBlock } from '../widgets/blocks.js?v=98a517667b';
import { questionList } from '../widgets/questions.js?v=98a517667b';
import { grammarGuide, exampleLine } from '../widgets/grammar.js?v=98a517667b';
import { setQuiet } from './shell.js?v=98a517667b';

// --- Vocabulary, reading, grammar, listening ---------------------------------------------------

function vocabSection(L) {
  const list = h('div', { class: 'cards' }, L.vocab.map((v) => h('article', { class: 'card vocab' },
    h('div', { class: 'vocab-head' }, h('h3', { class: 'word' }, v.word), sayBtn(v.word)),
    h('p', { class: 'meta' }, `${v.pos}　${v.ipa}`),
    h('p', { class: 'zh hideable' }, v.zh),
    h('p', { class: 'def' }, v.definition),
    h('p', { class: 'example' }, v.example, ' ', sayBtn(v.example)),
    h('p', { class: 'zh-sub hideable' }, v.example_zh))));
  list.addEventListener('click', (e) => e.target.closest('.hideable')?.classList.toggle('peek'));
  const toggle = h('button', {
    class: 'btn subtle', type: 'button',
    onclick: () => {
      const on = list.classList.toggle('hide-zh');
      toggle.textContent = on ? '顯示中文' : '遮住中文自我測驗';
    },
  }, '遮住中文自我測驗');
  return [
    h('h1', { class: 'title' }, `今天的 ${L.vocab.length} 個單字`),
    h('p', { class: 'lede' }, '先聽發音、讀例句。完成這一節後，這些單字會進入間隔複習。'),
    h('div', { class: 'toolbar' }, toggle),
    list,
  ];
}

function readSection(L) {
  return [h('h1', { class: 'title' }, L.reading.title), readingBlock(L, L.reading, vocabItems(L), 'read', L.accents?.narrator)];
}

// Lessons before 2026-11-08 have no guide and fall back to the old text explanation.
function grammarSection(L) {
  const g = L.grammar;
  const loose = g.guide ? g.examples.filter((x) => x.use == null) : [];
  const review = g.review;
  return [
    h('h1', { class: 'title' }, g.point_zh),
    h('p', { class: 'lede en' }, g.point),
    g.guide
      ? [grammarGuide(g, g.examples),
        loose.length ? h('div', { class: 'card' }, h('p', { class: 'eyebrow' }, '更多例句'), h('ul', { class: 'examples' }, loose.map(exampleLine))) : null]
      : h('div', { class: 'card' },
        h('p', {}, g.explain_zh),
        h('p', { class: 'pattern' }, g.pattern),
        h('ul', { class: 'examples' }, g.examples.map(exampleLine))),
    h('h2', { class: 'section-title' }, '練習'),
    questionList(L, 'grammar', g.exercises),
    review ? [
      h('h2', { class: 'section-title' }, '文法複習'),
      h('div', { class: 'banner' }, h('p', {}, h('strong', {}, review.point_zh), `　${review.point}`),
        h('p', { class: 'muted' }, '這是你之前比較常錯的文法，再練幾題加深印象。')),
      review.guide ? h('details', { class: 'review-guide' },
        h('summary', {}, '先看重點圖解', review.from ? `（${review.from.slice(5).replace('-', '/')} 教過）` : ''),
        grammarGuide(review, null),
        review.from ? h('p', {}, h('a', { href: `#/l/${review.from}/grammar` }, '回到那天的課看例句 ›')) : null) : null,
      questionList(L, 'review', review.exercises),
    ] : null,
  ];
}

function listenSection(L) {
  return [
    h('h1', { class: 'title' }, L.listening.title),
    h('p', { class: 'lede' }, '先不看文字聽一遍並回答問題，再打開對話稿聽第二遍，最後做聽寫。'),
    listeningBlock(L, L.listening, ''),
  ];
}

// --- Speaking ---------------------------------------------------------------------------------

function laterButton(id) {
  return h('button', { class: 'btn subtle', type: 'button', onclick: () => { store.addPending(id); toast('已加到「口說待補」，回家再說。'); } }, '稍後再說');
}

function shadowItem(L, i, sentence) {
  const key = `shadow.${i}`;
  const id = `${L.date}|shadow|${i}`;
  const live = h('p', { class: 'live' });
  const result = h('div');
  const show = (said) => {
    if (said === 'quiet') {
      put(result, h('p', { class: 'muted' }, '已默念練習，記在口說待補。'));
      return;
    }
    const r = core.alignWords(sentence, said);
    put(result, h('p', { class: 'heard' }, '辨識到：', said || '（沒有聽到聲音，再試一次）'), diffView(r), scoreLine(r.score));
  };
  if (store.ans(L.date, key) != null) show(store.ans(L.date, key));
  const done = (said) => {
    live.textContent = '';
    store.setAns(L.date, key, said, said ? core.alignWords(sentence, said).score : undefined);
    if (said) store.removePending(id);
    show(said);
  };
  const action = voiceMode()
    ? [micButton({ label: '跟讀', onText: (t) => { live.textContent = t; }, onDone: done }), laterButton(id)]
    : h('button', { class: 'btn', type: 'button', onclick: () => { store.setAns(L.date, key, 'quiet'); store.addPending(id); show('quiet'); } }, '已默念 3 次');
  return h('div', { class: 'card', 'data-ans': `${L.date}|${key}` },
    h('p', { class: 'shadow-text' }, sentence),
    h('div', { class: 'row' }, sayBtn(sentence, '聽'), slowBtn(sentence), action),
    recordRow(sentence),
    live, result);
}

// Record yourself reading the sentence, then listen to yourself and the original in turn.
function recordRow(sentence) {
  if (!speech.recordingSupported() || store.settings.quiet) return null;
  let session = null;
  let url = null;
  const compare = h('div', { class: 'row' });
  const btn = h('button', { class: 'btn', type: 'button' });
  const paint = () => {
    put(btn, icon(session ? 'stop' : 'mic'), session ? '錄音中・按此停止' : url ? '再錄一次' : '錄下自己的聲音');
    btn.classList.toggle('on', Boolean(session));
    put(compare, url ? [
      h('button', { class: 'chip-btn', type: 'button', onclick: () => speech.playRecording(url) }, icon('play'), '聽自己'),
      h('button', { class: 'chip-btn', type: 'button', onclick: () => speech.say(sentence, ttsOpts()) }, icon('speaker'), '聽原音'),
      h('span', { class: 'muted' }, '輪流聽，比較語調和停頓。'),
    ] : null);
  };
  btn.addEventListener('click', async () => {
    if (session) { session.stop(); return; }
    try {
      session = await speech.record();
      paint();
      const got = await session.done;
      if (got) { if (url) URL.revokeObjectURL(url); url = got; } else toast('沒有錄到聲音，再試一次。');
    } catch (err) {
      toast(err.message);
    } finally {
      session = null;
      paint();
    }
  });
  paint();
  return h('div', { class: 'stack' }, btn, compare);
}

function promptItem(L, i, p) {
  const key = `prompt.${i}`;
  const id = `${L.date}|prompt|${i}`;
  const live = h('p', { class: 'live' });
  const result = h('div');
  const show = (text, spoken) => {
    const n = core.wordCount(text);
    const used = L.vocab.filter((v) => core.mentions(text, v.word)).map((v) => v.word);
    const advice = n < 30 ? '有點短：試著加上原因和一個例子。' : n < 60 ? '長度不錯，可以再多一點細節。' : '很完整！';
    put(result,
      h('p', { class: 'heard' }, spoken ? '你說的：' : '你寫的：', text || '（沒有內容）'),
      h('p', { class: 'muted' }, `${n} 個字・${advice}`),
      h('p', { class: 'muted' }, `用到今天的單字：${used.join('、') || '還沒有，試著用一兩個'}`),
      h('details', { class: 'sample-box' }, h('summary', {}, '看範例答案'), h('p', {}, p.sample, ' ', sayBtn(p.sample))));
  };
  const prev = store.ans(L.date, key);
  if (prev != null) show(prev, voiceMode());
  let action;
  if (voiceMode()) {
    action = [micButton({
      continuous: true, label: '開始回答',
      onText: (t) => { live.textContent = t; },
      onDone: (said) => { live.textContent = ''; store.setAns(L.date, key, said); if (said) store.removePending(id); show(said, true); },
    }), laterButton(id)];
  } else {
    const box = h('textarea', { class: 'field', rows: 4, placeholder: '先用打字回答，回家再用說的' }, typeof prev === 'string' ? prev : '');
    action = [box, h('button', {
      class: 'btn', type: 'button',
      onclick: () => { if (!box.value.trim()) return; store.setAns(L.date, key, box.value.trim()); store.addPending(id); show(box.value.trim(), false); },
    }, '完成（記到口說待補）')];
  }
  return h('div', { class: 'card', 'data-ans': `${L.date}|${key}` },
    h('p', { class: 'prompt-q' }, p.question),
    h('p', { class: 'zh-sub' }, p.question_zh),
    h('ul', { class: 'hints' }, p.hints.map((x) => h('li', {}, x))),
    h('div', { class: 'stack' }, action),
    live, result);
}

function speakSection(L) {
  let banner;
  if (store.settings.quiet) {
    banner = h('div', { class: 'banner' }, h('p', {}, '安靜模式開著：口說題改成默念或打字，會記到「口說待補」，方便你之後補說。'),
      h('button', { class: 'btn subtle', type: 'button', onclick: () => setQuiet(false) }, '我現在可以說話'));
  } else if (!speech.sttSupported()) {
    banner = h('div', { class: 'banner' }, h('p', {}, '這個瀏覽器不支援語音辨識（請用 Chrome 或 iPhone 的 Safari），先用打字作答。'));
  } else {
    banner = h('div', { class: 'banner' }, h('p', {}, '戴耳機效果最好。按「跟讀」後直接念出句子，網頁會比對你念的內容；第一次使用要允許麥克風。'),
      h('button', { class: 'btn subtle', type: 'button', onclick: () => setQuiet(true) }, '我在外面，改安靜模式'));
  }
  return [
    h('h1', { class: 'title' }, '跟讀與回答'),
    banner,
    h('h2', { class: 'section-title' }, '跟讀 Shadowing'),
    h('p', { class: 'hint' }, '先聽一次，再模仿語調和停頓念出來。'),
    L.speaking.shadowing.map((s, i) => shadowItem(L, i, s)),
    h('h2', { class: 'section-title' }, '開口回答'),
    h('p', { class: 'hint' }, '每題試著說 30～60 秒，盡量用上今天的單字和句型。'),
    L.speaking.prompts.map((p, i) => promptItem(L, i, p)),
  ];
}

// --- Writing ----------------------------------------------------------------------------------

function translationItem(date, i, t) {
  const key = `trans.${i}`;
  const input = h('textarea', { class: 'field', rows: 2, placeholder: '用英文寫出來' }, store.ans(date, key) || '');
  const out = h('div');
  const show = (value) => put(out,
    h('p', { class: 'ref' }, '參考：', t.en, ' ', sayBtn(t.en)),
    t.alt?.length ? h('p', { class: 'muted' }, '也可以：', t.alt.join(' ／ ')) : null,
    h('p', { class: 'muted' }, `和參考答案的相似度 ${pct(core.translationScore(t, value))}（意思對就好，不必一字不差）`));
  const check = () => {
    const value = input.value.trim();
    if (!value) return;
    store.setAns(date, key, value, core.translationScore(t, value));
    show(value);
  };
  if (store.ans(date, key)) show(store.ans(date, key));
  return h('div', { class: 'card', 'data-ans': `${date}|${key}` }, h('p', { class: 'zh-big' }, t.zh), input,
    h('button', { class: 'btn', type: 'button', onclick: check }, '對照答案'), out);
}

function writingFeedback(L, text) {
  const w = L.writing;
  const used = L.vocab.filter((v) => core.mentions(text, v.word)).map((v) => v.word);
  return h('div', { class: 'feedback' },
    h('h3', {}, '自動檢查'),
    h('ul', { class: 'checks' }, core.writingChecks(w, text).map((c) => h('li', { class: c.ok ? 'ok' : 'bad' }, icon(c.ok ? 'check' : 'cross'), c.label))),
    h('p', { class: 'muted' }, `用到今天的單字：${used.join('、') || '還沒有'}`),
    h('h3', {}, '自我檢查'),
    h('ul', { class: 'selfcheck' }, w.checklist_zh.map((x) => h('li', {}, x))),
    h('h3', {}, '範例'),
    h('div', { class: 'sample' }, w.sample),
    h('div', { class: 'row' }, sayBtn(w.sample, '聽範例')),
    h('h3', {}, '想要逐句批改？'),
    h('p', { class: 'muted' }, '按下面的按鈕會複製「批改指令＋你的作文」，貼到你常用的 AI 聊天工具就能得到逐句修改。'),
    h('button', {
      class: 'btn', type: 'button',
      onclick: () => copyText(core.gradingPrompt({ level: L.level, task: w.task, mustUse: w.must_use, text }), '已複製，貼到 AI 聊天工具就能批改。'),
    }, '複製批改指令'));
}

function writeSection(L) {
  const w = L.writing;
  const area = h('textarea', { class: 'field essay', rows: 10, placeholder: 'Write your email here…', spellcheck: 'true', 'data-ans': `${L.date}|write.submitted` }, store.ans(L.date, 'write.draft') || '');
  const chips = h('div', { class: 'chips' });
  const count = h('span', { class: 'count' });
  const feedback = h('div');
  const paint = () => {
    const n = core.wordCount(area.value);
    count.textContent = `${n} / ${w.min_words}～${w.max_words} 字`;
    count.classList.toggle('ok', n >= w.min_words && n <= w.max_words);
    put(chips, ...w.must_use.map((p) => h('span', { class: `chip${core.mentions(area.value, p) ? ' on' : ''}` }, p)));
  };
  let timer;
  area.addEventListener('input', () => {
    paint();
    clearTimeout(timer);
    timer = setTimeout(() => store.setAns(L.date, 'write.draft', area.value), 400);
  });
  const submit = () => {
    if (core.wordCount(area.value) < 10) { toast('先寫幾句再交卷。'); return; }
    const checks = core.writingChecks(w, area.value);
    store.setAns(L.date, 'write.draft', area.value);
    store.setAns(L.date, 'write.submitted', true, checks.filter((c) => c.ok).length / checks.length);
    put(feedback, writingFeedback(L, area.value));
  };
  paint();
  if (store.ans(L.date, 'write.submitted')) put(feedback, writingFeedback(L, area.value));
  const teacher = store.ans(L.date, 'write.submitted') ? teacherFeedback(L.date) : null;
  return [
    h('h1', { class: 'title' }, '中翻英暖身'),
    L.translation.map((t, i) => translationItem(L.date, i, t)),
    h('h2', { class: 'section-title' }, '寫作任務'),
    h('div', { class: 'card' }, h('p', { class: 'prompt-q' }, w.task), h('p', { class: 'zh-sub' }, w.task_zh),
      h('p', { class: 'muted' }, '必須用到（用了會變藍）：'), chips),
    area,
    h('div', { class: 'row spread' }, count, h('button', { class: 'btn primary', type: 'button', onclick: submit }, '交卷，看回饋')),
    feedback,
    teacher,
  ];
}

// The native teacher's sentence-by-sentence correction, or where it stands.
function teacherFeedback(date) {
  const fb = library.feedback[date];
  if (!fb) {
    return h('div', { class: 'card' }, h('p', { class: 'coach-head' }, '老師批改中'),
      h('p', { class: 'muted' }, '每天 9、12、18、22 點批改，結果會出現在這裡（手機和電腦都看得到）。'));
  }
  return h('div', { class: 'card teacher' },
    h('p', { class: 'coach-head' }, `老師批改・${fb.score}/10`),
    h('p', {}, fb.overall_zh),
    fb.items?.length ? [h('h3', {}, '逐句修改'), h('ol', { class: 'corrections' }, fb.items.map((it) => h('li', {},
      h('p', { class: 'orig' }, it.original), h('p', { class: 'fixed' }, it.corrected, ' ', sayBtn(it.corrected)),
      h('p', { class: 'muted' }, it.note_zh))))] : h('p', { class: 'muted' }, '沒有需要改的句子。'),
    fb.better_zh?.length ? [h('h3', {}, '可以更道地'), h('ul', { class: 'plain' }, fb.better_zh.map((x) => h('li', {}, x)))] : null,
    fb.rewrite ? [h('h3', {}, '改寫版'), h('div', { class: 'sample' }, fb.rewrite), h('div', { class: 'row' }, sayBtn(fb.rewrite, '聽改寫版'))] : null,
    h('p', { class: 'muted' }, `批改時間：${fb.graded_at || ''}`));
}

// --- Pages ------------------------------------------------------------------------------------

const RENDER = { vocab: vocabSection, read: readSection, grammar: grammarSection, listen: listenSection, speak: speakSection, write: writeSection };

// Finishing the vocabulary section puts today's words into tomorrow's review.
function completeSection(L, id) {
  store.markDone(L.date, id);
  if (id === 'vocab') {
    const tomorrow = core.addDays(today(), 1);
    for (const v of L.vocab) if (!store.card(v.word)) store.setCard(v.word, { ...core.newCard(today()), due: tomorrow });
  }
  store.save();
}

export async function sectionPage(date, id) {
  const L = await library.lesson(date);
  const idx = SECTIONS.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error('找不到這一節');
  const s = SECTIONS[idx];
  const next = nextSectionOf(date, id);
  const finish = () => {
    completeSection(L, id);
    const then = nextSectionOf(date, id);
    location.hash = then ? `#/l/${date}/${then.id}` : `#/l/${date}`;
    if (!then) toast(L.challenge ? '今天的課完成了！挑戰加練已解鎖。' : '今天的課完成了，記得做單字複習！');
  };
  return h('div', { class: 'page' },
    h('nav', { class: 'crumbs' }, h('a', { href: `#/l/${date}` }, `‹ ${formatDate(date)}`), h('span', {}, `${idx + 1} / ${SECTIONS.length}`)),
    h('p', { class: 'eyebrow' }, `${s.zh}・${s.en}`),
    RENDER[id](L),
    h('div', { class: 'finish' },
      h('button', { class: 'btn primary wide', type: 'button', onclick: finish }, next ? `完成，下一節：${next.zh}` : '完成今天的課'),
      store.isDone(date, id) ? h('p', { class: 'muted center' }, '這一節已經完成過了') : null));
}

export async function challengePage(date) {
  const L = await library.lesson(date);
  const C = L.challenge;
  if (!C) throw new Error('這一課沒有挑戰加練');
  const items = [
    ...C.glossary.map((g) => ({ v: { word: g.word, zh: g.zh, definition: g.definition || '' }, old: false })),
    ...[...L.vocab.map((v) => ({ ...v, date: L.date })), ...library.fullDeck().filter((v) => v.date < L.date)].map((v) => ({ v, old: true })),
  ];
  const finish = () => {
    store.markDone(date, 'challenge');
    store.save();
    location.hash = `#/l/${date}`;
    toast('挑戰完成！還想練可以到「練習」。');
  };
  return h('div', { class: 'page' },
    h('nav', { class: 'crumbs' }, h('a', { href: `#/l/${date}` }, `‹ ${formatDate(date)}`), h('span', {}, levelTag(C.level))),
    h('p', { class: 'eyebrow' }, `挑戰加練・${C.level}`),
    h('h1', { class: 'title' }, C.reading.title),
    h('p', { class: 'lede' }, '比今天的課高一級：文章更長、對話更快更口語。這裡的答對率也會用來判斷什麼時候升級。'),
    readingBlock(L, C.reading, items, 'ch.read', L.accents?.challenge_narrator),
    h('h2', { class: 'section-title' }, `聽力：${C.listening.title}`),
    listeningBlock(L, C.listening, 'ch.'),
    h('div', { class: 'finish' },
      h('button', { class: 'btn primary wide', type: 'button', onclick: finish }, '完成挑戰'),
      store.isDone(date, 'challenge') ? h('p', { class: 'muted center' }, '已經完成過了') : null));
}
