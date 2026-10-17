// B285: every step is refined before it goes into a queue. PURE.
// The person, on goal G17: "every item on the backlog automatically Before it gets put in the queue. if main wants to
// put it in the queue automatically/directly, refine it first". The board sends a step to the Advisor by itself, one
// at a time and in the words of the Refine button: a step the person asked to queue, a step the main chat queued before
// it was refined, and a new step once. Old steps are refined when they are about to be queued, not all at once.
// What "refined" means is backlog.mjs `isRefined`.

import { isRefined, refinedAt, refineStateOf } from './backlog.mjs'
import { refinedWords, refineWords } from './say.mjs'

export { isRefined, refineStateOf } from './backlog.mjs'

const numberOf = id => Number(String(id).slice(1))

/**
 * What the board writes down at its first look with refining, or what it wrote then (`kept`): `since`, the highest
 * step number on the backlog, finished ones too (a step above it is new; 0 for an empty backlog), and
 * `queuedBefore`, the steps that were queued then without being refined: they go as before (roles/main.md, point 0).
 */
export function firstLook(kept, state) {
  if (kept !== null && kept !== undefined && Number.isInteger(kept.since)) {
    return { since: kept.since, queuedBefore: Array.isArray(kept.queuedBefore) ? kept.queuedBefore : [] }
  }
  const steps = (state.backlog ?? []).flatMap(activity => activity.steps ?? []).filter(step => typeof step.id === 'string')
  const ids = steps.map(step => numberOf(step.id))
  return {
    since: ids.length === 0 ? 0 : Math.max(...ids),
    queuedBefore: steps.filter(step => step.status === 'queued' && !isRefined(step.refined)).map(step => step.id),
  }
}

/** Whether the Advisor was asked to refine this step (since `from`, ms) and the ask did not fail to arrive. */
const wasAsked = (outbox, id, from = -Infinity) => outbox.some(message => message.command === 'refine' && message.about === id
  && message.state !== 'failed' && message.state !== 'expired' && message.at >= from)

/**
 * Whether a step needs the Advisor now: it has no block and was never asked, or its block is answered and not folded
 * in yet (approved 2026-10-17: "the board sends the step to the Advisor once more to fold them in") and it was not
 * asked since the block was written. A block with questions open waits for the person; a ready one needs nothing.
 */
function needsRefine(step, outbox) {
  const refined = step.refined ?? null
  if (refined === null) return !wasAsked(outbox, step.id)
  if (refineStateOf({ refined }) !== 'answered') return false
  const written = refinedAt(refined)
  return written === null ? !outbox.some(message => message.command === 'refine' && message.about === step.id && message.round > refined.round) : !wasAsked(outbox, step.id, written)
}

/**
 * What the board does by itself at one look (the board that delivers, while there is an Advisor):
 * - `release`: the held queue asks (say.mjs, `held`) whose step is refined now; they go to the main chat;
 * - `drop`: the held asks whose step is no longer open for a queue (finished, queued, in progress, gone);
 * - `refine`: one ask to the Advisor, or null: only while no refine is open (the person's neither), the first step that
 *   needs one (no block and never asked, or answered and not folded in yet: `needsRefine`), by `why`: `queue` (the
 *   person asked to queue it), `queued` (the main chat queued it; not one of `queuedBefore`), `new` (a step above
 *   `since`), then `answered` (any other step whose answers wait to be folded in); never the person's steps,
 *   finished ones or steps in progress;
 * - `notice`: one word to the main chat, or null: a step it queued unrefined (refined because queued) is refined now.
 * `outbox` is everything the board sent, also long ago.
 */
export function refineWhenDue(state, outbox, { since, queuedBefore = [] }) {
  const steps = (state.backlog ?? []).flatMap(activity => activity.steps ?? []).filter(step => typeof step.id === 'string')
  const byId = new Map(steps.map(step => [step.id, step]))
  const held = outbox.filter(message => message.command === 'queue' && message.state === 'held')
  const release = []
  const drop = []
  const waiting = new Set()
  for (const message of held) {
    const step = byId.get(message.about)
    if (step === undefined || step.status !== 'open') drop.push(message.id)
    else if (isRefined(step.refined)) release.push(message.id)
    else waiting.add(step.id)
  }

  const main = state.restart?.main ?? null
  const told = id => outbox.some(message => message.command === 'refined' && message.about === id)
  const queuedThenRefined = steps.find(step => step.status === 'queued' && isRefined(step.refined) && !told(step.id)
    && outbox.some(message => message.command === 'refine' && message.about === step.id && message.why === 'queued'))
  const notice = main === null || queuedThenRefined === undefined ? null : refinedWords(main, queuedThenRefined)

  const advisor = state.advisor?.name ?? null
  let refine = null
  if (advisor !== null && !steps.some(step => step.refineAsk?.isOpen === true)) {
    const isOpen = step => step.status === 'open' || step.status === 'queued'
    const order = [
      ['queue', step => waiting.has(step.id)],
      ['queued', step => step.status === 'queued' && !queuedBefore.includes(step.id)],
      ['new', step => isOpen(step) && numberOf(step.id) > since],
      ['answered', step => isOpen(step) && (step.refined ?? null) !== null],
    ]
    for (const [why, wants] of order) {
      const step = steps.find(one => wants(one) && needsRefine(one, outbox))
      if (step !== undefined) {
        refine = { ...refineWords(advisor, step, (step.refined?.round ?? 0) + 1), why }
        break
      }
    }
  }
  return { release, drop, refine, notice }
}
