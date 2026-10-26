// T9.4 (the person, 2026-10-26: "yes, build the follow-up for refines and incidents (ask again every 30 min, after 3
// tries to me)"): when a step still waits for its refine after the board's word to the Advisor arrived. The one place that
// says it, for the supervisor's repair rule `refine-again` (it asks the Advisor again) and for the Advisor's waiting
// list on the page (state.mjs), so the two never disagree about what is still open. PURE.

import { refinedAt, refinedKey, refinedOf, refineStateOf, withAsks } from '../backlog.mjs'
import { refineStop } from '../refineGate.mjs'
import { stepNotes } from './adapter.mjs'
import { valueOf } from './item.mjs'
import { refineAsksOf } from './stepAsks.mjs'

const MIN = 60_000

/** A store step's refine block as the backlog reads it (`step.refined`), the asks under the step folded in; null for none. */
export const refinedOfItem = (items, item) => withAsks(refinedOf(stepNotes(item)), refineAsksOf(items, item))

/**
 * B285: whether a refine block answers a refine word of the board's: it shows the round the word asked for, or (the newer
 * form's head names no round) it changed since the word (`before`, the block's key then), or, for a word from before that
 * key, it was written since the word (to the minute).
 */
export function isBlockWritten(refined, message) {
  const round = Number.isInteger(message.round) ? message.round : 1
  const written = refinedAt(refined)
  return (refined?.round ?? 0) >= round || (message.before !== undefined
    ? refinedKey(refined) !== message.before
    : written !== null && written >= Math.floor(message.at / MIN) * MIN)
}

/**
 * Whether a step in `state` still holds the refine a word of the board asked for: a step is refined while it is new; a later
 * round (B387: three in a row) also while it waits refined (as outboxSweep.mjs `whyClosed` reads it).
 */
export const holdsRefine = (state, message) => state === 'new' || (state === 'refined' && (message.round ?? 1) > 1)

/** When a refine word of the board reached the Advisor (the mod took it, or typed it); null while it did not. */
export const arrivedAt = message => (message.state === 'taken' || message.state === 'delivered' ? message.takenAt ?? message.deliveredAt ?? message.at : null)

/**
 * `{ word, since }` for a step the Advisor took the refine of and has not written: the step is new and no fix (a fix's
 * refine has its own follow-up, refineGate `FIX_RETRY_MS`), the board's newest refine word about it arrived (`since`),
 * no block was written since, the block (if any) does not wait for the person's answers, and the board has not stopped
 * on it (`refineStop`). Null otherwise. `items` the store's items, `outbox` the board's words.
 */
export function refineWaitOf(items, item, outbox) {
  if ((valueOf(item, 'Kind') ?? 'step') !== 'step' || valueOf(item, 'State') !== 'new' || valueOf(item, 'Fix of') !== null) return null
  const id = valueOf(item, 'Id')
  const word = outbox.findLast(one => one.command === 'refine' && one.about === id)
  const since = word === undefined ? null : arrivedAt(word)
  if (!Number.isFinite(since)) return null
  const refined = refinedOfItem(items, item)
  if (isBlockWritten(refined, word) || !['none', 'answered'].includes(refineStateOf({ refined }))) return null
  if (refineStop({ id, item: { history: item.sections.get('History') ?? [] } }, outbox) !== null) return null
  return { word, since }
}
