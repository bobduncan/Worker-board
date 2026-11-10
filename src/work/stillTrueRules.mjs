// P5 (src/stillTrue.mjs): the two rules the board's re-check shares with the work API, so the server never trusts the list the check made: which
// asks the re-check may withdraw, and when a Supervisor's alarm note is over. Pure.

import { isRecapVerdictAsk, isTakenBack } from './autopilot.mjs'
import { askStepOf } from './askStep.mjs'
import { isKeptLook } from './keptLook.mjs'
import { valueOf } from './item.mjs'

/**
 * Whether the board's re-check leaves an ask alone whatever its step does (the review of 2026-11-11, the blocker): the asks that wait for the goal's
 * recap (`Route: recap`: recapAnswered owns them, and the person's Send there must still find them; a kept look is one), a recap's verdict look or
 * do (`isRecapVerdictAsk`, as rule 15's `mayBeHeld`), an ask the person took back (theirs, never closed by the board), the app's popups
 * (`Via: form`) and the partner's refine questions (`Via: refine`).
 */
export function stillTrueLeaves(item) {
  return valueOf(item, 'Route') === 'recap' || isKeptLook(item) || isRecapVerdictAsk(item) || isTakenBack(item) || ['form', 'refine'].includes(valueOf(item, 'Via'))
}

/**
 * The step an ask is about for the re-check, or null. Its `Of` when that names a step; the first B<n> of its title ONLY for an ask routed to the
 * person ("After B1030 lands, start G61 with A or B?" asked of the partner or by advice is about a goal, not B1030).
 */
export function stillTrueStep(item) {
  const of = valueOf(item, 'Of')
  if (valueOf(item, 'Route') !== 'person' && (of === null || of === '')) return null
  return askStepOf(of, valueOf(item, 'Title') ?? '')
}

/** The states of an incident that are over (the start-up check's ENDED, and a dropped one). */
export const INCIDENT_OVER = ['fixed', 'closed', 'gone', 'dropped']

/**
 * The words a Supervisor's alarm note comes down with ("came down: X1 fixed, X2 gone"), or null while it must stand: an unread note Via supervisor
 * whose `Incidents` are all over (an incident the store no longer holds is gone). `items` the store's items.
 */
export function noteCameDownWords(note, items) {
  if (valueOf(note, 'Kind') !== 'note' || valueOf(note, 'State') !== 'unread' || valueOf(note, 'Via') !== 'supervisor') return null
  const ids = [...new Set((valueOf(note, 'Incidents') ?? '').match(/\bX\d+\b/g) ?? [])]
  if (ids.length === 0) return null
  const states = ids.map(id => (items.has(id) ? valueOf(items.get(id), 'State') : 'gone'))
  return states.every(state => INCIDENT_OVER.includes(state)) ? `came down: ${ids.map((id, at) => `${id} ${states[at]}`).join(', ')}` : null
}
