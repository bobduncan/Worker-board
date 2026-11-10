// The asks of the board that stay open a while after they arrived: a removal of a worker (B143) and a refine (B233, B868),
// moved here from state.mjs unchanged (P7, the review: the one status per step, src/stepStatus.mjs, reads the refine gate's own
// `refineAsk` instead of a second rule of its own). PURE.

import { isBlockWritten } from './refineWait.mjs'

const MIN = 60_000
/** B143: an ask to remove a worker that arrived stays open this long while the worker is still in the list. */
const REMOVE_OPEN_MS = 15 * MIN
/** B233: an ask to refine a step that arrived stays open this long while the step lacks that round. */
export const REFINE_OPEN_MS = 30 * MIN

/**
 * B143: the newest ask to remove a worker and how it fares. It is open while it is on its way, and after it arrived
 * for 15 minutes at most while the worker is still in the list: a worker that is gone has no lane to show it.
 */
export function removalAsk(message, now, openMs = REMOVE_OPEN_MS) {
  if (message === undefined) return null
  const isOnItsWay = message.state === 'waiting' || message.state === 'taken'
  const isOpen = isOnItsWay || (message.state === 'delivered' && now - (message.deliveredAt ?? message.at) < openMs)
  return { at: message.at, state: message.state, isOpen }
}

/**
 * B233: the newest ask to the Advisor to refine a step, open while it is on its way and after it arrived until the
 * step's refine block shows the round it asked for, for half an hour at most (`openMs`). T9.4: the Advisor's waiting list
 * passes Infinity for it: a refine it took and has not written stays in its list (refineWait.mjs `isBlockWritten`).
 */
export function refineAsk(step, sent, now, openMs = REFINE_OPEN_MS) {
  if (step.id === null) return null
  const message = sent.findLast(one => one.command === 'refine' && one.about === step.id)
  const ask = removalAsk(message, now, openMs)
  if (ask === null) return null
  const round = Number.isInteger(message.round) ? message.round : 1
  // B868 (X115): the gate that sends the next refine is held by an ask only while its step is still open for a refine (not
  // done or dropped, not in progress), and by a word that did not arrive (waiting, taken) for `openMs` at most, as one that did.
  const isStale = (message.state === 'waiting' || message.state === 'taken') && now - (message.state === 'taken' ? message.takenAt ?? message.at : message.at) >= openMs
  const isStepOpen = step.status !== 'done' && step.status !== 'progress'
  return { ...ask, round, isOpen: ask.isOpen && isStepOpen && !isStale && !isBlockWritten(step.refined, message) }
}
