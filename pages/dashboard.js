// The progress dashboard for either learner: advisor report, key numbers, learning calendar,
// skill trends, level history, grammar mastery, vocabulary, essays and habits. Charts follow the
// dataviz rules: one hue per job, no colour alone, text in text colours.

import * as core from '../core.js?v=98a517667b';
import { store, library } from '../state.js?v=98a517667b';
import { today, wkey, isWeak, readJSON, writeJSON } from '../store.js?v=98a517667b';
import { h, svg, put, pct, shortDate, stat, WEEKDAYS } from '../dom.js?v=98a517667b';
import { SECTIONS } from '../sections.js?v=98a517667b';
import { notesCard } from '../widgets/notes.js?v=98a517667b';

// Where an advisor method's `action` opens in the app.
function actionHref(action) {
  const [kind, arg] = String(action || '').split(':');
  if (kind === 'practice' && arg) return `#/practice/${arg}`;
  if (kind === 'lesson' && arg) return `#/l/${library.currentLessonDate()}/${arg}`;
  return { review: '#/review', history: '#/history', goals: '#/goals', challenge: `#/l/${library.currentLessonDate()}/challenge` }[kind] || null;
}

function advisorCard(p, reports) {
  const dates = Object.keys(reports || {}).sort();
  const report = reports[dates[dates.length - 1]];
  const title = p.self ? '學習顧問的建議' : `${p.name} 的學習顧問報告`;
  if (!report) {
    return h('section', { class: 'card advisor' }, h('p', { class: 'adv-title' }, title),
      h('p', { class: 'muted' }, p.self || p.synced ? '顧問每天早上出課前分析一次作答紀錄，有新的作答就會更新報告。' : '這台裝置開啟同步後才看得到顧問報告。'));
  }
  const tickKey = `english-daily:advisor-today:${p.slug}:${report.date}`;
  let ticked = readJSON(tickKey, []);
  const tick = (i, on) => {
    ticked = on ? [...new Set([...ticked, i])] : ticked.filter((x) => x !== i);
    writeJSON(tickKey, ticked);
  };
  const older = dates.slice(0, -1).reverse();
  return h('section', { class: 'card advisor' },
    h('div', { class: 'adv-head' }, h('p', { class: 'adv-title' }, title), h('span', { class: 'meta' }, `${shortDate(report.date)} 分析`)),
    h('p', { class: 'adv-summary' }, report.summary_zh),
    h('p', { class: 'adv-h' }, '最需要加強'),
    h('ol', { class: 'adv-list' }, report.weaknesses.map((w) => h('li', {},
      h('strong', {}, w.title_zh), h('p', {}, w.evidence_zh), h('p', { class: 'muted' }, w.why_zh)))),
    h('p', { class: 'adv-h' }, '最適合的學習方法'),
    h('div', { class: 'adv-methods' }, report.methods.map((m) => {
      const href = p.self ? actionHref(m.action) : null;
      return h('div', { class: 'adv-method' }, h('strong', {}, m.title_zh), h('p', {}, m.how_zh), h('p', { class: 'muted' }, m.why_zh),
        href ? h('a', { class: 'btn subtle', href }, '去做 ›') : null);
    })),
    h('p', { class: 'adv-h' }, p.self ? '今天可以做' : '今天的建議'),
    h('ul', { class: 'adv-today' }, report.today.map((t, i) => h('li', {}, p.self
      ? h('label', {}, h('input', { type: 'checkbox', checked: ticked.includes(i), onchange: (e) => tick(i, e.target.checked) }), h('span', {}, t))
      : t))),
    h('details', { class: 'adv-more' }, h('summary', {}, '做得好的地方・資料說明'),
      h('ul', { class: 'adv-list plain' }, report.strengths.map((x) => h('li', {}, h('strong', {}, x.title_zh), h('p', {}, x.evidence_zh)))),
      h('p', { class: 'muted' }, report.data_note_zh)),
    older.length ? h('details', { class: 'adv-more' }, h('summary', {}, `過去的報告（${older.length}）`),
      h('ul', { class: 'adv-past' }, older.map((d) => h('li', {}, h('strong', {}, shortDate(d)), '　', reports[d].summary_zh)))) : null);
}

function dashSection(title, note, ...body) {
  return h('section', { class: 'dash-sec' }, h('h2', { class: 'section-title' }, title), note ? h('p', { class: 'muted' }, note) : null, ...body);
}

const HEAT_STEPS = [[0, '沒練'], [1, '1–9 分'], [10, '10–19 分'], [20, '20–29 分'], [30, '30 分以上']];
const heatLevel = (a) => (!a ? 0 : Math.max(1, HEAT_STEPS.filter(([min]) => a.minutes >= min).length - 1));

// Last 8 weeks, Monday-first columns; darker = more minutes. Tap a day for its numbers.
function calendarHeatmap(activity) {
  const end = today();
  const dow = (d) => (new Date(`${d}T00:00:00`).getDay() + 6) % 7;
  const start = core.addDays(end, -dow(end) - 7 * 7);
  const readout = h('p', { class: 'heat-readout', 'aria-live': 'polite' }, '點格子看當天練了多久');
  const cells = [];
  for (let i = 0; i < 56; i++) {
    const d = core.addDays(start, i);
    if (d > end) { cells.push(h('span', { class: 'heat-cell future' })); continue; }
    const a = activity[d];
    const text = `${shortDate(d)}（${WEEKDAYS[(dow(d) + 1) % 7]}）${a ? `${a.minutes ? `${a.minutes} 分鐘` : '有練習'}・${a.events} 次作答` : '沒有練習'}`;
    cells.push(h('button', { type: 'button', class: `heat-cell l${heatLevel(a)}${d === end ? ' today' : ''}`, 'aria-label': text,
      onclick: (e) => { put(readout, text); e.currentTarget.parentNode.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel')); e.currentTarget.classList.add('sel'); } }));
  }
  return h('div', { class: 'heat' },
    h('div', { class: 'heat-wrap' },
      h('div', { class: 'heat-days' }, ['一', '', '三', '', '五', '', '日'].map((x) => h('span', {}, x))),
      h('div', { class: 'heat-grid' }, cells)),
    readout,
    h('div', { class: 'heat-legend' }, HEAT_STEPS.map(([, label], i) => h('span', {}, h('i', { class: `heat-cell l${i}` }), label))));
}

function sparkline(points) {
  const W = 96; const H = 30; const pad = 4;
  const x = (i) => (points.length < 2 ? W / 2 : pad + (i * (W - 2 * pad)) / (points.length - 1));
  const y = (v) => pad + (1 - v) * (H - 2 * pad);
  const last = points[points.length - 1];
  return svg('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' },
    svg('line', { x1: 0, x2: W, y1: y(1), y2: y(1), class: 'spark-ref' }),
    points.length > 1 ? svg('polyline', { points: points.map(([, v], i) => `${x(i)},${y(v)}`).join(' '), class: 'spark-line' }) : null,
    last ? svg('circle', { cx: x(points.length - 1), cy: y(last[1]), r: 4, class: 'spark-dot' }) : null);
}

// One row per skill: sparkline by lesson, recent accuracy, change against earlier lessons.
function skillTrends(results) {
  const series = core.skillSeries(results);
  return h('div', { class: 'trends' }, Object.entries(series).map(([skill, pts]) => {
    const vals = pts.map(([, v]) => v);
    const recent = vals.length ? core.mean(vals.slice(-core.TREND_LESSONS)) : null;
    const before = vals.length >= core.TREND_LESSONS + 2 ? core.mean(vals.slice(0, -core.TREND_LESSONS)) : null; // two earlier lessons at least
    const delta = before == null ? null : recent - before;
    const dir = delta == null || Math.abs(delta) < 0.005 ? '' : delta > 0 ? 'up' : 'down';
    return h('details', { class: 'trend' },
      h('summary', {},
        h('span', { class: 'trend-name' }, core.SKILL_ZH[skill]),
        vals.length ? sparkline(pts) : h('span', { class: 'spark empty' }),
        h('span', { class: 'trend-num' }, recent == null ? '—' : pct(recent)),
        h('span', { class: `trend-delta ${dir}` }, delta == null ? (vals.length ? `共 ${vals.length} 課` : '') : `${dir === 'up' ? '▲' : dir === 'down' ? '▼' : '＝'} ${Math.abs(Math.round(delta * 100))}`)),
      vals.length
        ? h('table', { class: 'mini-table' }, h('tbody', {}, pts.map(([d, v]) => h('tr', {}, h('td', {}, shortDate(d)), h('td', {}, pct(v))))))
        : h('p', { class: 'muted' }, skill === 'speaking' ? '還沒有分數：跟讀用說的完成才會計分（安靜模式不計分）。' : '還沒有作答。'));
  }));
}

function levelJourney(index) {
  const lessons = [...index].reverse().filter((x) => x.date <= today()).slice(-14);
  if (!lessons.length) return h('p', { class: 'muted' }, '還沒有課程。');
  const changes = lessons.filter((x, i) => i && x.level !== lessons[i - 1].level).length;
  return [
    h('p', { class: 'muted' }, changes ? `最近 ${lessons.length} 課換過 ${changes} 次等級。` : `最近 ${lessons.length} 課都在 ${lessons[lessons.length - 1].level}；三項主要能力連續 3 課 85% 以上會升級。`),
    h('div', { class: 'levels' }, lessons.map((x, i) => h('span', { class: `lv${i && x.level !== lessons[i - 1].level ? ' changed' : ''}` },
      h('small', {}, shortDate(x.date)), x.level))),
  ];
}

const masteryClass = (acc) => (acc >= 0.8 ? ['good', '穩'] : acc >= 0.6 ? ['mid', '加強中'] : ['low', '需加強']);

function grammarBars(list) {
  if (!list.length) return h('p', { class: 'muted' }, '還沒有文法作答。');
  return h('ul', { class: 'meters' }, list.map((g) => {
    const [cls, word] = masteryClass(g.acc);
    return h('li', {},
      h('p', { class: 'meter-label' }, g.zh || g.point),
      h('div', { class: 'meter-row' },
        h('span', { class: 'meter' }, h('span', { class: `meter-fill ${cls}`, style: `width:${Math.max(2, Math.round(g.acc * 100))}%` })),
        h('span', { class: 'meter-num' }, `${pct(g.acc)}・${g.n} 題`),
        h('span', { class: `status ${cls}` }, word)));
  }));
}

function vocabBlock(doc, words) {
  const st = core.vocabStatus(doc.srs);
  const inReview = st.mastered + st.learning + st.weak;
  const fresh = Math.max(0, new Set(words.map((v) => wkey(v.word))).size - inReview);
  const parts = [['mastered', '熟了', st.mastered], ['learning', '學習中', st.learning], ['weak', '常忘', st.weak], ['fresh', '還沒開始', fresh]];
  const total = parts.reduce((n, [, , v]) => n + v, 0);
  const byWord = new Map(words.map((v) => [wkey(v.word), v]));
  const weak = Object.entries(doc.srs || {}).filter(([, c]) => isWeak(c))
    .sort((a, b) => (b[1].lapses || 0) - (a[1].lapses || 0) || a[1].ease - b[1].ease).slice(0, 8);
  return [
    total ? h('div', { class: 'segbar', role: 'img', 'aria-label': parts.map(([, l, v]) => `${l} ${v}`).join('、') },
      parts.filter(([, , v]) => v).map(([k, , v]) => h('span', { class: `seg-${k}`, style: `flex-grow:${v}` }, v / total >= 0.12 ? String(v) : ''))) : null,
    h('div', { class: 'legend' }, parts.map(([k, l, v]) => h('span', {}, h('i', { class: `sw seg-${k}` }), `${l} ${v}`))),
    h('p', { class: 'muted' }, `「熟了」＝複習間隔 ${core.MASTERED_INTERVAL} 天以上；「常忘」＝按過忘了或有點難。`),
    weak.length ? h('ul', { class: 'plain' }, weak.map(([w, c]) => h('li', {}, h('strong', {}, byWord.get(w)?.word || w), '　', byWord.get(w)?.zh || '',
      h('span', { class: 'muted' }, c.lapses ? `　忘了 ${c.lapses} 次` : '　有點難')))) : null,
  ];
}

function essayBlock(p) {
  const dates = Object.keys(p.feedback || {}).sort();
  if (!dates.length) return h('p', { class: 'muted' }, '交卷後老師會在當天批改（9、12、18、22 點），分數會出現在這裡。');
  return h('ul', { class: 'meters' }, dates.map((d) => {
    const f = p.feedback[d];
    return h('li', {}, h('div', { class: 'meter-row' },
      p.self ? h('a', { class: 'meter-date', href: `#/l/${d}/write` }, shortDate(d)) : h('span', { class: 'meter-date' }, shortDate(d)),
      h('span', { class: 'meter' }, h('span', { class: 'meter-fill seq', style: `width:${(f.score || 0) * 10}%` })),
      h('span', { class: 'meter-num' }, `${f.score}/10・${(f.items || []).length} 處修改`)));
  }));
}

function habitsBlock(doc, minutes, goal) {
  const parts = core.dayparts(doc);
  const total = parts.reduce((n, [, c]) => n + c, 0);
  const top = Math.max(1, ...parts.map(([, c]) => c));
  const avgMin = minutes.length ? Math.round(core.mean(minutes)) : null;
  const pending = Object.values(doc.pending || {}).filter((x) => x && !x.done).length;
  const extra = Object.values(doc.practice || {}).reduce((n, day) => n + Object.values(day || {}).reduce((m, [, t]) => m + t, 0), 0);
  return [
    total ? h('ul', { class: 'meters compact' }, parts.map(([name, c]) => h('li', {}, h('div', { class: 'meter-row' },
      h('span', { class: 'meter-date' }, name),
      h('span', { class: 'meter' }, h('span', { class: 'meter-fill seq', style: `width:${(c / top) * 100}%` })),
      h('span', { class: 'meter-num' }, c ? `${Math.round((c / total) * 100)}%` : '—'))))) : h('p', { class: 'muted' }, '還沒有作答時間紀錄。'),
    h('p', { class: 'muted' }, '依作答時間分：清晨 0–6、早上 6–11、中午 11–14、下午 14–18、晚上 18–23、深夜 23–24 點。'),
    h('div', { class: 'stats three' },
      stat(avgMin == null ? '—' : `${avgMin}`, goal ? `平均分鐘／目標 ${goal}` : '有練習的日子平均分鐘'),
      stat(`${extra}`, '自由練習題'), stat(`${pending}`, '口說待補')),
  ];
}

export async function dashboardPage(slug) {
  const profiles = library.profiles;
  const p = await library.personData(profiles.some((x) => x.slug === slug) ? slug : store.slug);
  const doc = p.doc || {};
  const latest = p.index.find((x) => x.date <= today()) || p.index[0];
  const coach = p.index.find((x) => x.date <= today() && x.coach)?.coach;
  const activity = core.dayActivity(doc);
  const days = Object.keys(activity);
  const minutes = Object.values(activity).map((a) => a.minutes).filter(Boolean);
  const results = doc.results || {};
  const answered = Object.values(results).reduce((n, d) => n + Object.keys(d || {}).length, 0);
  const completed = p.index.filter((x) => SECTIONS.every((s) => doc.done?.[x.date]?.[s.id])).length;
  const switcher = profiles.length > 1 ? h('div', { class: 'seg', role: 'group', 'aria-label': '看誰的進度' },
    profiles.map((x) => h('a', { class: x.slug === p.slug ? 'on' : '', href: x.slug === store.slug ? '#/progress' : `#/progress/${x.slug}` },
      x.slug === store.slug ? `${x.name}（我）` : x.name))) : null;
  return h('div', { class: 'page dash' },
    h('p', { class: 'eyebrow' }, '進度・Dashboard'),
    switcher,
    h('h1', { class: 'headline' }, `${p.self ? '' : `${p.name}・`}目前等級 ${latest?.level || '—'}`),
    h('p', { class: 'lede' }, coach?.level_reason_zh || '做完幾課之後，這裡會說明升降級的判斷。'),
    p.self && !p.synced ? h('a', { class: 'card notice', href: '#/settings' },
      h('strong', {}, '還沒開啟跨裝置同步'),
      h('span', { class: 'muted' }, '每天出題和學習顧問都看不到你的作答紀錄。到設定頁花一分鐘連線。')) : null,
    !p.self && !p.doc ? h('div', { class: 'card notice' }, h('strong', {}, `這台裝置看不到 ${p.name} 的作答紀錄`),
      h('span', { class: 'muted' }, '開啟跨裝置同步（貼上同一個 token）後，就能在這裡看到對方的進度。')) : null,
    advisorCard(p, p.advisor || {}),
    p.self ? notesCard() : null,
    h('div', { class: 'stats' }, stat(`${core.streakOf(days, today())}`, '連續天數'), stat(`${days.length}`, '練習天數'),
      stat(`${completed}`, '完成的課'), stat(`${answered}`, '答題數')),
    dashSection('學習日曆', '最近 8 週，顏色越深練得越久。', calendarHeatmap(activity)),
    dashSection('五項能力', '每一課的正確率；數字是最近 3 課的平均，有 5 課以上時箭頭和更早的課比。點一列看每課的分數。', skillTrends(results)),
    dashSection('等級歷程', null, levelJourney(p.index)),
    dashSection('文法掌握', '每個學過的文法點（含複習題）的正確率。', grammarBars(core.grammarMastery(results, p.index))),
    dashSection('單字', null, vocabBlock(doc, p.deck)),
    dashSection('作文分數', null, essayBlock(p)),
    dashSection('練習習慣', null, habitsBlock(doc, minutes, doc.profile?.minutes)),
    p.self ? h('a', { class: 'card notice', href: '#/history' },
      h('strong', {}, `所有課程（${library.index.length}）在「紀錄」`), h('span', { class: 'muted' }, '每天的練習都在那裡，可以回去複習，也可以補寫漏掉的題目。')) : null);
}
