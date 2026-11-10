// Multiple-choice and fill-in questions. `answers` is a {get, set} pair: a lesson's questions
// store into the learner's progress (store.answerStore), practice questions keep a local value.

import * as core from '../core.js?v=4aac385308';
import { store } from '../state.js?v=4aac385308';
import { h, put } from '../dom.js?v=4aac385308';

export function mcq(item, answers, onResult) {
  const box = h('div', { class: 'q' });
  const render = () => {
    const chosen = answers.get();
    const answered = chosen != null;
    put(box,
      h('p', { class: 'q-text' }, item.q),
      h('div', { class: 'options' }, item.options.map((option, j) => h('button', {
        type: 'button',
        class: `opt${!answered ? '' : j === item.answer ? ' right' : j === chosen ? ' wrong' : ' dim'}`,
        disabled: answered,
        onclick: () => { answers.set(j, j === item.answer); onResult?.(j === item.answer); render(); },
      }, option))),
      answered ? h('p', { class: `explain ${chosen === item.answer ? 'ok' : 'bad'}` },
        chosen === item.answer ? '答對了。' : '答錯了。', item.explain_zh) : null);
  };
  render();
  return box;
}

export function fillQ(item, answers, onResult) {
  const box = h('div', { class: 'q' });
  const [before, after] = item.q.split('___');
  const render = () => {
    const given = answers.get();
    if (given == null) {
      const submit = () => {
        if (!input.value.trim()) return;
        const ok = core.checkFill(item, input.value);
        answers.set(input.value.trim(), ok);
        onResult?.(ok);
        render();
      };
      const input = h('input', {
        class: 'blank', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': '填空',
        onkeydown: (e) => { if (e.key === 'Enter') submit(); },
      });
      put(box, h('p', { class: 'q-text' }, before, input, after),
        h('button', { class: 'btn', type: 'button', onclick: submit }, '確認'));
    } else {
      const ok = core.checkFill(item, given);
      put(box,
        h('p', { class: 'q-text' }, before, h('span', { class: `filled ${ok ? 'ok' : 'bad'}` }, given), after),
        h('p', { class: `explain ${ok ? 'ok' : 'bad'}` }, ok ? '答對了。' : `正確答案：${item.answer}。`, item.explain_zh));
    }
  };
  render();
  return box;
}

export const exercise = (item, answers, onResult) => (item.type === 'fill' ? fillQ : mcq)(item, answers, onResult);

// A lesson's questions under one answer-key prefix; wrong answers go to the mistake list. An item
// with `hint_zh` (the vocabulary quiz) shows it above the question; `onResult(ok, i)` is told
// about every answer.
export function questionList(L, kind, items, onResult) {
  return h('ol', { class: 'questions' }, items.map((item, i) => h('li', { 'data-ans': `${L.date}|${kind}.${i}` },
    item.hint_zh ? h('p', { class: 'q-hint' }, `提示：${item.hint_zh}`) : null,
    exercise(item, store.answerStore(L.date, `${kind}.${i}`), (ok) => { store.recordMistake({ date: L.date, kind, i }, ok); onResult?.(ok, i); }))));
}
