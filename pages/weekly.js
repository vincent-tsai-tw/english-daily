// The weekly review test: the list of weeks, what a week's test covers, the test itself (its
// questions are fixed when it starts and every answer is saved at once, so it can be done in
// several sittings) and the result with what the teacher does with it.

import * as core from '../core.js?v=f46691462d';
import { store, library, syncer } from '../state.js?v=f46691462d';
import { today } from '../store.js?v=f46691462d';
import { h, put, pct, icon, toast, formatDate, shortDate, stat, showSheet, hideSheet } from '../dom.js?v=f46691462d';
import { rerender } from '../nav.js?v=f46691462d';
import { sayBtn } from '../widgets/audio.js?v=f46691462d';
import { dictationCard, translationCard } from '../widgets/blocks.js?v=f46691462d';
import { exercise } from '../widgets/questions.js?v=f46691462d';
import { PART_ZH, PARTS, weekRange, partScore, weeklyTable } from '../widgets/weekly.js?v=f46691462d';
import { updateBadge } from './shell.js?v=f46691462d';

const PART_HINT = {
  vocab: '這一週的單字，問法和當天的小測驗不一樣。',
  grammar: '當天答錯或還沒做過的題目優先。',
  dict: '播放後打出整句。每句只對一次答案。',
  trans: '用這一週學的句型寫出來。每句只對照一次。',
};

const crumbs = (label) => h('nav', { class: 'crumbs' }, h('a', { href: '#/weekly' }, '‹ 每週總複習'), label ? h('span', {}, label) : null);

// --- The list of weeks ------------------------------------------------------------------------

function weekRow(w) {
  const sum = core.weeklySummary(w.record);
  let state;
  if (w.record?.done) state = h('span', { class: 'week-state' }, h('strong', {}, sum.score == null ? '—' : pct(sum.score)), ' 看結果 ›');
  else if (w.record) state = h('span', { class: 'week-state on' }, `繼續（${sum.answered}/${sum.asked}）›`);
  else if (w.open) state = h('span', { class: 'week-state on' }, '開始 ›');
  else state = h('span', { class: 'week-state muted' }, `${shortDate(core.weekEnd(w.week))} 週日開放`);
  const body = [h('span', { class: 'week-name' }, weekRange(w.week), h('small', {}, `學了 ${w.dates.length} 課`)), state];
  return h('li', {}, w.open || w.record ? h('a', { href: `#/weekly/${w.week}` }, body) : h('div', { class: 'week-closed' }, body));
}

function listPage() {
  const weeks = core.weeklyList(library.index, store.state, today());
  return h('div', { class: 'page' },
    h('p', { class: 'eyebrow' }, '每週總複習・Weekly review'),
    h('h1', { class: 'headline' }, '每週把學過的再測一次'),
    h('p', { class: 'lede' }, '每週日開放。從那一週學過的課抽出單字、文法、聽寫和翻譯重新測一次，單字會換一種問法。老師和學習顧問會依結果安排下一週的課。'),
    weeks.length
      ? h('ul', { class: 'section-list week-list' }, weeks.map(weekRow))
      : h('p', { class: 'muted' }, '做完第一課之後，這裡會出現那一週的總複習。'));
}

// --- Before the test --------------------------------------------------------------------------

function startPage(week, lessons, isOpen) {
  const dates = Object.keys(lessons).sort();
  const plan = core.weeklyPlan(Object.values(lessons), store.state);
  const counts = PARTS.map((p) => [p, plan.filter((e) => core.parseRef(e.ref).prefix === p).length]).filter(([, n]) => n);
  const todayLesson = week === core.weekOf(today()) && library.entryFor(today()).date && !dates.includes(today());
  return h('div', { class: 'page' },
    crumbs(),
    h('p', { class: 'eyebrow' }, `${weekRange(week)} 總複習`),
    h('h1', { class: 'headline' }, `這一週學了 ${dates.length} 課，一次複習`),
    h('p', { class: 'lede' }, `共 ${plan.length} 題，大約 ${core.weeklyMinutes(plan)} 分鐘。每題作答後馬上看到對錯；可以分幾次做，答案會自動儲存。`),
    h('div', { class: 'chips' }, counts.map(([p, n]) => h('span', { class: 'chip' }, `${PART_ZH[p]} ${n} 題`))),
    h('ul', { class: 'plain week-lessons' }, dates.map((d) => {
      const x = library.entryFor(d);
      return h('li', {}, h('strong', {}, shortDate(d)), `　${x.theme_zh || lessons[d].theme_zh}`, h('small', { class: 'muted' }, `　${x.grammar_zh || lessons[d].grammar.point_zh}`));
    })),
    todayLesson ? h('p', { class: 'banner' }, '今天的課還沒開始：先做完再測，題目會包含今天學的內容。') : null,
    isOpen
      ? h('button', { class: 'btn primary wide', type: 'button', onclick: () => { store.startWeekly(week, plan); rerender(); } }, '開始測驗')
      : h('p', { class: 'muted center' }, `這一週的測驗在 ${formatDate(core.weekEnd(week))} 開放。`));
}

// --- The questions (the test, and the same list read-only under the result) --------------------

// `onAnswer` makes the list live: answers go to the Store, which also files wrong ones in the
// mistake list and the word review. Without it the list is the record of a finished test; a
// question that was left blank can still be tried there, uncounted.
function questionBlocks(week, lessons, onAnswer) {
  const record = store.weekly(week);
  const live = Boolean(onAnswer);
  const answersFor = (r) => {
    const question = r.scoring === 'question';
    const answers = store.weeklyStore(week, r.entry.ref, question
      ? { mistake: { date: r.date, kind: r.prefix, i: r.i }, word: r.prefix === 'vocab' ? lessons[r.date].vocab[r.i].word : undefined }
      : {});
    if (live) return { get: answers.get, set: (value, score) => { if (answers.set(value, score)) { onAnswer(); updateBadge(); } } };
    let tried = answers.get();
    return { get: () => tried, set: (value) => { tried = value; } };
  };
  const rows = record.plan.map((entry) => {
    const { date } = core.parseRef(entry.ref);
    return { entry, date, ...(lessons[date] ? core.weeklyQuestion(lessons[date], entry) : null) };
  }).filter((r) => r.item !== undefined && r.prefix);
  return PARTS.map((prefix) => {
    const part = rows.filter((r) => r.prefix === prefix);
    if (!part.length) return null;
    const question = part[0].scoring === 'question';
    const wrap = (r, node) => h('li', { 'data-weekly': r.entry.ref }, node);
    const list = question
      ? part.map((r) => wrap(r, [r.item.hint_zh ? h('p', { class: 'q-hint' }, `提示：${r.item.hint_zh}`) : null, exercise(r.item, answersFor(r))]))
      : part.map((r, n) => wrap(r, prefix === 'dict'
        ? dictationCard(n + 1, r.item, answersFor(r), { once: true })
        : translationCard(r.item, answersFor(r), { once: true })));
    return [
      h('h2', { class: 'section-title' }, `${PART_ZH[prefix]}（${part.length} 題）`),
      h('p', { class: 'hint' }, PART_HINT[prefix]),
      h(question ? 'ol' : 'ul', { class: question ? 'questions' : 'plain weekly-cards' }, list),
    ];
  });
}

function testPage(week, lessons) {
  const view = h('div', { class: 'page' });
  const progress = h('p', { class: 'muted quiz-score' });
  const unanswered = () => { const r = store.weekly(week); return r.plan.filter((e) => !r.items[e.ref]); };
  const paint = () => {
    const sum = core.weeklySummary(store.weekly(week));
    progress.textContent = `已答 ${sum.answered} / ${sum.asked} 題${sum.answered ? `，目前 ${pct(sum.score)}` : ''}`;
  };
  const finish = () => { hideSheet(); store.finishWeekly(week); toast('交卷了！老師會依這次結果安排接下來的課。'); rerender(); };
  const submit = () => {
    const left = unanswered();
    if (!left.length) { finish(); return; }
    showSheet(
      h('p', { class: 'sheet-word' }, `還有 ${left.length} 題沒作答`),
      h('p', { class: 'muted' }, '沒作答的題目不算分，但老師也就看不出你記不記得。'),
      h('div', { class: 'row' },
        h('button', {
          class: 'btn primary', type: 'button',
          onclick: () => { hideSheet(); view.querySelector(`[data-weekly="${left[0].ref}"]`)?.scrollIntoView({ block: 'center' }); },
        }, '回去作答'),
        h('button', { class: 'btn', type: 'button', onclick: finish }, '直接交卷')));
  };
  paint();
  put(view,
    crumbs(),
    h('p', { class: 'eyebrow' }, `${weekRange(week)} 總複習`),
    h('h1', { class: 'title' }, '總複習測驗'),
    h('p', { class: 'lede' }, '每題作答後就定案。中途離開沒關係，回來會接著做。'),
    questionBlocks(week, lessons, paint),
    h('div', { class: 'finish' }, progress, h('button', { class: 'btn primary wide', type: 'button', onclick: (e) => { e.stopPropagation(); submit(); } }, '交卷，看結果')));
  return view;
}

// --- The result -------------------------------------------------------------------------------

function resultPage(week, lessons) {
  const record = store.weekly(week);
  const sum = core.weeklySummary(record);
  const { words, grammar, missedGrammar } = core.weeklyReview(record, lessons);
  // The test before this one that has a score, to say whether the learner kept more this week.
  const before = core.weeklyDone(store.state.weekly).find((r) => r.week < week && core.weeklySummary(r).score != null);
  const delta = before && sum.score != null ? Math.round((sum.score - core.weeklySummary(before).score) * 100) : null;
  return h('div', { class: 'page' },
    crumbs(),
    h('p', { class: 'eyebrow' }, `${weekRange(week)} 總複習・結果`),
    h('h1', { class: 'headline' }, sum.score == null ? '沒有作答' : `總分 ${pct(sum.score)}`),
    h('p', { class: 'lede' }, `${sum.asked} 題作答 ${sum.answered} 題，${shortDate(core.localDate(new Date(record.done)))} 交卷。`,
      delta == null ? '' : delta === 0 ? ` 和上一次（${weekRange(before.week)}）一樣。` : ` 比上一次（${weekRange(before.week)}）${delta > 0 ? '進步' : '退步'} ${Math.abs(delta)} 分。`),
    h('div', { class: 'stats' }, PARTS.filter((p) => sum.parts[p]).map((p) => stat(partScore(p, sum.parts[p]), PART_ZH[p]))),
    h('div', { class: 'card coach' },
      h('p', { class: 'coach-head' }, '老師接下來會這樣安排'),
      h('ul', {},
        h('li', {}, words.length ? `忘掉的 ${words.length} 個字會在接下來幾天的文章和對話裡再出現，也已經排回單字複習。`
          : sum.parts.vocab?.answered ? '這一週的單字都記得：接下來會繼續加新的字。' : '單字題沒有作答，老師看不出哪些字要帶回來。'),
        h('li', {}, missedGrammar.length ? `答錯的文法（${missedGrammar.map((g) => g.zh).join('、')}）會計入文法複習的判斷：錯得多的會排進之後的課再練。`
          : grammar.length ? '這一週的文法題都答對了。' : '文法題沒有作答，老師看不出哪個文法要複習。'),
        h('li', {}, '學習顧問明天早上會把這次測驗和每天的作答一起分析，更新「進度」頁的建議。')),
      syncer.connected ? null : h('p', { class: 'muted' }, '這台裝置還沒開啟同步，老師看不到這份結果。', h('a', { href: '#/settings' }, '到設定頁連線 ›'))),
    words.length ? [
      h('h2', { class: 'section-title' }, `忘掉的單字（${words.length}）`),
      h('ul', { class: 'plain missed-words' }, words.map((v) => h('li', {}, h('strong', {}, v.word), sayBtn(v.word), h('span', {}, v.zh), h('small', { class: 'muted' }, v.example)))),
      h('a', { class: 'btn', href: '#/review' }, icon('check'), '現在去複習這些字'),
    ] : null,
    grammar.length ? [
      h('h2', { class: 'section-title' }, '文法'),
      h('ul', { class: 'section-list' }, grammar.map((g) => h('li', {}, h('a', { href: `#/l/${g.date}/grammar` },
        h('span', { class: 'sec-name' }, g.zh, h('small', {}, shortDate(g.date))),
        h('span', { class: 'sec-meta' }, `${Math.round(g.right)}/${g.n}`))))),
      missedGrammar.length ? h('p', { class: 'muted' }, '點進去重看圖解；答錯的題目也在「複習」頁的錯題重練。') : null,
    ] : null,
    h('a', { class: 'card notice', href: '#/notes' },
      h('strong', {}, '測完覺得哪裡最卡？留言給老師'), h('span', { class: 'muted' }, '寫下來，明天的課會回應你。')),
    h('details', { class: 'review-guide' }, h('summary', {}, `看每一題（${sum.asked}）`), questionBlocks(week, lessons)),
    h('h2', { class: 'section-title' }, '歷次總複習'),
    weeklyTable(store.state.weekly, true));
}

// --- Routing ----------------------------------------------------------------------------------

export async function weeklyPage(week) {
  if (!week) return listPage();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || core.weekOf(week) !== week) throw new Error('找不到這一週的總複習');
  const record = store.weekly(week);
  const dates = record
    ? [...new Set(record.plan.map((e) => core.parseRef(e.ref).date))].filter((d) => library.entryFor(d).date)
    : core.weeklyDates(library.index, store.state, week);
  if (!dates.length) {
    return h('div', { class: 'page' }, crumbs(), h('h1', { class: 'headline' }, `${weekRange(week)} 沒有可以複習的課`),
      h('p', { class: 'lede' }, '這一週還沒有做過任何一課。做完課之後，週日就能在這裡總複習。'));
  }
  const lessons = Object.fromEntries(await Promise.all(dates.map(async (d) => [d, await library.lesson(d)])));
  if (!record) return startPage(week, lessons, core.weeklyOpen(week, today()));
  return record.done ? resultPage(week, lessons) : testPage(week, lessons);
}
