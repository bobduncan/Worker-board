// Focus 3 (spec 2026-10-18, section 5): the partner's daily note on the focus goal, a note of the work store
// (`Kind: note`, `To: you`, `Of: G<n>`) with two sections: `## Decided for you` (one line each) and `## Needs you`
// (the ids of its asks). The person's Undo of a decided line adds it under `## Undo asked`, with its time, once.

import { valueOf } from './item.mjs'

export const GOAL_ID = /^G\d+$/
export const DECIDED = 'Decided for you'
export const NEEDS = 'Needs you'
export const UNDONE = 'Undo asked'

const point = one => one.trim().replace(/^[-*]\s+/, '').trim()
const pointsOf = (item, name) => (item.sections.get(name) ?? []).map(point).filter(one => one !== '')

/** Whether the item is a daily note: a note of a goal with its "Decided for you" section. */
export const isDailyNote = item => valueOf(item, 'Kind') === 'note' && GOAL_ID.test(valueOf(item, 'Of') ?? '') && item.sections.has(DECIDED)

/** The decided lines of a daily note. */
export const decidedOf = item => pointsOf(item, DECIDED)

/** The decided lines the person asked to undo (without the time behind each). */
export const undoneOf = item => pointsOf(item, UNDONE).map(one => one.replace(/\s+\(\d{4}-\d\d-\d\d \d\d:\d\d\)$/, ''))

/** The ids of the asks the note names under "Needs you". */
export const needsOf = item => pointsOf(item, NEEDS).flatMap(one => one.match(/\bQ\d+\b/g) ?? [])

/** A daily note as the Focus page reads it: `{ id, since, decided: [{ text, undoAsked }], needs }`. */
export function dailyNote(item) {
  const undone = new Set(undoneOf(item))
  return {
    id: valueOf(item, 'Id'),
    since: valueOf(item, 'Since'),
    decided: decidedOf(item).map(text => ({ text, undoAsked: undone.has(text) })),
    needs: needsOf(item),
  }
}
