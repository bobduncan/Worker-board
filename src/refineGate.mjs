// B285: every step is refined before it goes into a queue. PURE.
// The person, on goal G17: "every item on the backlog automatically Before it gets put in the queue. if main wants to
// put it in the queue automatically/directly, refine it first". The board sends a step to the Advisor by itself, one
// at a time and in the words of the Refine button: a step the person asked to queue, a step the main chat queued before
// it was refined, and a new step once. Old steps are refined when they are about to be queued, not all at once.
// What "refined" means is backlog.mjs `isRefined`.

import { isRefined } from './backlog.mjs'
import { refinedWords, refineWords } from './say.mjs'

export { isRefined, refineStateOf } from './backlog.mjs'

const numberOf = id => Number(String(id).slice(1))

/**
 * The highest step number at or below which steps count as old: `kept` (what the board wrote down at its first look
 * with refining), else the highest step on the backlog now, finished ones too; 0 for an empty backlog.
 */
export function newSince(kept, state) {
  if (Number.isInteger(kept)) return kept
  const ids = (state.backlog ?? []).flatMap(activity => activity.steps ?? []).filter(step => typeof step.id === 'string').map(step => numberOf(step.id))
  return ids.length === 0 ? 0 : Math.max(...ids)
}

/** Whether the Advisor was asked to refine this step and the ask did not fail to arrive. */
const wasAsked = (outbox, id) => outbox.some(message => message.command === 'refine' && message.about === id && message.state !== 'failed' && message.state !== 'expired')

/**
 * What the board does by itself at one look (the board that delivers, while there is an Advisor):
 * - `release`: the held queue asks (say.mjs, `held`) whose step is refined now; they go to the main chat;
 * - `drop`: the held asks whose step is no longer open for a queue (finished, queued, in progress, gone);
 * - `refine`: one ask to the Advisor, or null: only while no refine is open (the person's neither), the first step
 *   without a refine block and never asked of the Advisor, by `why`: `queue` (the person asked to queue it), `queued`
 *   (the main chat queued it), then `new` (a step above `since`, never the person's, finished or in progress);
 * - `notice`: one word to the main chat, or null: a step it queued unrefined (refined because queued) is refined now.
 * `outbox` is everything the board sent, also long ago.
 */
export function refineWhenDue(state, outbox, { since }) {
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
    const needs = step => (step.refined ?? null) === null && !wasAsked(outbox, step.id)
    const order = [
      ['queue', step => waiting.has(step.id)],
      ['queued', step => step.status === 'queued'],
      ['new', step => (step.status === 'open' || step.status === 'queued') && numberOf(step.id) > since],
    ]
    for (const [why, wants] of order) {
      const step = steps.find(one => wants(one) && needs(one))
      if (step !== undefined) {
        refine = { ...refineWords(advisor, step, 1), why }
        break
      }
    }
  }
  return { release, drop, refine, notice }
}
