// B285: every step is refined before it goes into a queue. PURE.
// The person, on goal G17: "every item on the backlog automatically Before it gets put in the queue. if main wants to
// put it in the queue automatically/directly, refine it first". The board sends a step to the Advisor by itself, one
// at a time and in the words of the Refine button: a step the person asked to queue, a step the main chat queued before
// it was refined (or asked to queue before it, B303: the store's "Queue when refined"), and a new step, each until it
// is refined (answers folded in once more). Old steps are refined when
// they are about to be queued, not all at once. What "refined" means is backlog.mjs `isRefined`: a head that says
// "; ready" (approved by the person on 2026-10-17).

import { isRefined, refinedAt, refinedKey, refineStateOf } from './backlog.mjs'
import { refinedWords, refineWords } from './say.mjs'

export { isRefined, refineStateOf } from './backlog.mjs'

const numberOf = id => Number(String(id).slice(1))

/** The board's own asks to the Advisor per step, at most this many that arrived, and this many that did not. */
export const BOARD_TRIES = 3
/** After an ask that did not arrive (failed, or waited too long), the board waits this long before it asks again. */
export const RETRY_MS = 15 * 60_000

/**
 * What the board keeps (data/refine-gate.json): `since`, the highest step number at its first look (a step above it is
 * new); `queuedBefore`, the steps queued then without being refined, which go as before (roles/main.md, point 0); and
 * `waiting`, the steps it saw queued while not refined, whose refine it says to the main chat. Taken from `kept` when
 * that holds them; else made now, or null while the backlog shows no step yet (it may not have been read).
 */
export function firstLook(kept, state) {
  if (kept !== null && kept !== undefined && Number.isInteger(kept.since) && Array.isArray(kept.queuedBefore)) {
    return { since: kept.since, queuedBefore: kept.queuedBefore, waiting: Array.isArray(kept.waiting) ? kept.waiting : [] }
  }
  const steps = (state.backlog ?? []).flatMap(activity => activity.steps ?? []).filter(step => typeof step.id === 'string')
  if (steps.length === 0) return null
  return {
    since: Math.max(...steps.map(step => numberOf(step.id))),
    queuedBefore: steps.filter(step => step.status === 'queued' && !isRefined(step.refined)).map(step => step.id),
    waiting: [],
  }
}

const isGone = message => message.state === 'failed' || message.state === 'expired'

/**
 * Whether the board asks the Advisor about this step now: it is not refined, its block does not wait for the person
 * (questions open), and nobody asked about the block as it stands (`before`, the block's key when asked; an older ask
 * without it counts for a block written before it). The board's own asks stop after BOARD_TRIES that arrived (an
 * Advisor that keeps writing a block that is not ready: the person sees the step as answered and refines it), or that
 * did not; after one that did not, it waits RETRY_MS.
 */
function needsRefine(step, outbox, now) {
  const refined = step.refined ?? null
  if (isRefined(refined)) return false
  if (refined !== null && refineStateOf({ refined }) !== 'answered') return false
  const asks = outbox.filter(message => message.command === 'refine' && message.about === step.id)
  const board = asks.filter(message => message.board === true)
  if (board.filter(isGone).length >= BOARD_TRIES || board.filter(message => !isGone(message)).length >= BOARD_TRIES) return false
  const last = asks.at(-1)
  if (last !== undefined && isGone(last) && now - last.at < RETRY_MS) return false
  const key = refinedKey(refined)
  const written = refinedAt(refined)
  const aboutThis = message => (message.before !== undefined ? message.before === key : refined === null || (written !== null && written <= message.at))
  return !asks.some(message => !isGone(message) && aboutThis(message))
}

/**
 * What the board does by itself at one look (the board that delivers). `outbox` is everything it sent, also long ago,
 * with what waited too long marked `expired`; `kept` is `firstLook`'s. Answers:
 * - `release`: the held queue asks (say.mjs, `held`) whose step is refined now, or all of them when there is no
 *   Advisor to refine them; they go to the main chat;
 * - `drop`: the held asks whose step is no longer open for a queue (finished, queued, in progress, gone);
 * - `refine`: one ask to the Advisor, or null: only while no refine is open (the person's neither), the first step
 *   that needs one (`needsRefine`), by `why`: `queue` (the person asked to queue it), `queued` (the main chat queued
 *   it; not one of `queuedBefore`), then `new` (a step above `since`); never the person's steps, finished ones or
 *   steps in progress;
 * - `notice`: one word to the main chat, or null: a step it queued while not refined is refined now;
 * - `kept`: what to keep for the next look.
 */
export function refineWhenDue(state, outbox, kept, now) {
  const steps = (state.backlog ?? []).flatMap(activity => activity.steps ?? []).filter(step => typeof step.id === 'string')
  const byId = new Map(steps.map(step => [step.id, step]))
  const advisor = state.advisor?.name ?? null
  const release = []
  const drop = []
  const held = new Set()
  for (const message of outbox.filter(one => one.command === 'queue' && one.state === 'held')) {
    const step = byId.get(message.about)
    if (step === undefined || step.status !== 'open') drop.push(message.id)
    else if (advisor === null || isRefined(step.refined)) release.push(message.id)
    else held.add(step.id)
  }

  // The steps the main chat queued while not refined: said to it once each is refined, then let go.
  const isWaiting = step => step.status === 'queued' && !isRefined(step.refined) && !kept.queuedBefore.includes(step.id)
  const waiting = new Set([...kept.waiting.filter(id => byId.get(id)?.status === 'queued'), ...steps.filter(isWaiting).map(step => step.id)])
  const main = state.restart?.main ?? null
  const ready = main === null ? undefined : [...waiting].map(id => byId.get(id)).find(step => isRefined(step.refined))
  const notice = ready === undefined ? null : refinedWords(main, ready)
  if (ready !== undefined) waiting.delete(ready.id)

  let refine = null
  if (advisor !== null && !steps.some(step => step.refineAsk?.isOpen === true)) {
    const isOpen = step => step.status === 'open' || step.status === 'queued'
    const order = [
      ['queue', step => held.has(step.id)],
      // B303: a step the main chat asked to queue before its refine ("Queue when refined") counts as one it queued.
      ['queued', step => (step.status === 'queued' && !kept.queuedBefore.includes(step.id)) || (step.status === 'open' && (step.item?.queueWhenRefined ?? null) !== null)],
      ['new', step => isOpen(step) && numberOf(step.id) > kept.since],
    ]
    for (const [why, wants] of order) {
      const step = steps.find(one => wants(one) && needsRefine(one, outbox, now))
      if (step !== undefined) {
        refine = { ...refineWords(advisor, step, (step.refined?.round ?? 0) + 1), why, board: true, before: refinedKey(step.refined) }
        break
      }
    }
  }
  return { release, drop, refine, notice, kept: { ...kept, waiting: [...waiting] } }
}
