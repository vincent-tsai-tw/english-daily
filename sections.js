// The six sections of a lesson and the order the learner should do them in: vocabulary first,
// then the weakest skill, then the rest (core.sectionOrder / core.nextSection).

import * as core from './core.js?v=4fbc7a9ae0';
import { store, library } from './state.js?v=4fbc7a9ae0';
import { pct } from './dom.js?v=4fbc7a9ae0';

const SECTION_INFO = {
  vocab: { zh: '單字', en: 'Vocabulary', min: 4, sub: (L) => `${L.vocab.slice(0, 4).map((v) => v.word).join('、')}…` },
  read: { zh: '閱讀', en: 'Reading', min: 5, sub: (L) => L.reading.title },
  grammar: { zh: '文法', en: 'Grammar', min: 4, sub: (L) => L.grammar.point_zh + (L.grammar.review ? '＋複習' : '') },
  listen: { zh: '聽力', en: 'Listening', min: 5, sub: (L) => L.listening.title },
  speak: { zh: '口說', en: 'Speaking', min: 4, sub: (L) => `跟讀 ${L.speaking.shadowing.length} 句＋回答 ${L.speaking.prompts.length} 題` },
  write: { zh: '寫作', en: 'Writing', min: 6, sub: (L) => `中翻英 ${L.translation.length} 句＋短文寫作` },
};
export const SECTION_IDS = core.SECTION_IDS;
export const SECTIONS = SECTION_IDS.map((id) => ({ id, ...SECTION_INFO[id] }));
export const sectionById = (id) => SECTIONS.find((s) => s.id === id) || null;

// skill -> the section that trains it, from the answer-key table.
const SKILL_SECTION = Object.fromEntries(Object.values(core.ITEMS).filter((i) => i.skill).map((i) => [i.skill, i.section]));

// The section to do first: the weakest skill from the coach notes, else from the learner's scores.
export function suggestedSection(coach, done, results) {
  let skill = coach?.weak_skill;
  let reason = skill ? coach.focus_zh?.find((f) => f.includes(core.SKILL_ZH[skill])) : '';
  if (!skill) {
    const weak = core.weakestSkill(core.skillStats(results).stats);
    if (!weak) return null;
    skill = weak.skill;
    reason = `最近${core.SKILL_ZH[skill]}的正確率 ${pct(weak.acc)}，先練最弱的最有效。`;
  }
  const section = sectionById(SKILL_SECTION[skill]);
  return section && !done[section.id] ? { section, reason } : null;
}

// Today's suggestion (weakest skill), only for the current lesson.
export function suggestionFor(date) {
  if (date !== library.currentLessonDate()) return null;
  return suggestedSection(library.entryFor(date).coach, store.state.done[date] || {}, store.state.results);
}

export function nextSectionOf(date, after = null) {
  return sectionById(core.nextSection(SECTION_IDS, store.state.done[date] || {}, suggestionFor(date)?.section.id, after));
}
