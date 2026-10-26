// B285: every step is refined before it goes into a queue. PURE.
// The person, on goal G17: "every item on the backlog automatically Before it gets put in the queue. if main wants to
// put it in the queue automatically/directly, refine it first". The board sends a step to the Advisor by itself, one
// at a time and in the words of the Refine button: a step the person asked to queue, a step the main chat queued before
// it was refined (or asked to queue before it, B303: the store's "Queue when refined"), a step the person answered on
// since its block was last written (B312, also an old one), and a new step, each until it
// is refined (answers folded in once more). Old steps are refined when
// they are about to be queued, not all at once. What "refined" means is backlog.mjs `isRefined`: a head that says
// "; ready" (approved by the person on 2026-10-17).

import { isRefined, refinedAt, refinedKey, refineStateOf } from './backlog.mjs'
import { refineWords } from './say.mjs'

export { isRefined, refineStateOf } from './backlog.mjs'

const numberOf = id => Number(String(id).slice(1))

/** The board's own asks to the Advisor per step, at most this many that arrived, and this many that did not. */
export const BOARD_TRIES = 3
/** After an ask that did not arrive (failed, or waited too long), the board waits this long before it asks again. */
export const RETRY_MS = 15 * 60_000
/**
 * B667 (B664's check: an open fix the partner never refines had no follow-up): a fix's refine word that arrived but got
 * no round is typed again after this long, up to BOARD_TRIES; the watch rule open-fix names it meanwhile.
 */
export const FIX_RETRY_MS = 60 * 60_000

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

const MIN = 60_000
const STAMP = /^(\d{4}-\d\d-\d\d \d\d:\d\d)\s+[^:]+:\s+/
/** B312: a line of a step's History that says the person answered: an ask under it, the refine questions, or accepted. */
const ANSWERED = /^\d{4}-\d\d-\d\d \d\d:\d\d\s+[^:]+:\s+(?:Q\d+ answered|answered the refine questions|accepted the refine)\b/
/** B312: a line of a step's History that says the Advisor wrote its refine block (as work/stepAsks.mjs reads it). */
const WRITTEN = /^\d{4}-\d\d-\d\d \d\d:\d\d\s+[^:]+:\s+refined(?:, round \d+| is ready)\s*$/
const msOf = line => {
  const at = Date.parse((line.match(STAMP)?.[1] ?? '').replace(' ', 'T'))
  return Number.isFinite(at) ? at : null
}
const historyOf = step => (Array.isArray(step.item?.history) ? step.item.history.map(line => String(line).replace(/^[-*]\s+/, '').trim()) : [])

/**
 * B312: when the person last answered on a step, by its History (an ask under it answered, its refine questions
 * answered, the refine accepted), as the end of the minute written there: a round sent within that minute may have
 * gone before the answer. Null when it says none.
 */
export function lastAnswerAt(step) {
  const line = historyOf(step).findLast(one => ANSWERED.test(one))
  const at = line === undefined ? null : msOf(line)
  return at === null ? null : at + MIN - 1
}

/**
 * B312: whether the person answered on a step after its refine block was last written, so a round folds that in: the
 * answer's line comes after the Advisor's last "refined" line in its History, or, without one, the answer is not older
 * than the block's head (to the minute). A step without a block has nothing to fold.
 */
function hasNewAnswer(step) {
  if ((step.refined ?? null) === null) return false
  const history = historyOf(step)
  const answer = history.findLastIndex(one => ANSWERED.test(one))
  if (answer < 0) return false
  const written = history.findLastIndex(one => WRITTEN.test(one))
  if (written >= 0) return answer > written
  const block = refinedAt(step.refined)
  const at = msOf(history[answer])
  return block === null || (at !== null && at >= block)
}

/**
 * B312: the board's own refine rounds for a step that count towards BOARD_TRIES: those sent after the person last
 * answered on it (`lastAnswerAt`). `{ rounds, at }` (how many, and when the last went) once either those that arrived
 * or those that did not reach BOARD_TRIES: the board stopped on it, until a new answer or the person's own round;
 * else null.
 */
export function refineStop(step, outbox) {
  const since = lastAnswerAt(step) ?? -Infinity
  const board = (outbox ?? []).filter(message => message.command === 'refine' && message.about === step.id && message.board === true && message.at > since)
  if (board.filter(isGone).length < BOARD_TRIES && board.filter(message => !isGone(message)).length < BOARD_TRIES) return null
  return { rounds: board.length, at: Math.max(...board.map(message => message.at)) }
}

/**
 * Whether the board asks the Advisor about this step now: it is not refined, its block does not wait for the person
 * (questions open), and nobody asked about the block as it stands (`before`, the block's key when asked; an older ask
 * without it counts for a block written before it). The board's own asks stop after BOARD_TRIES that arrived (an
 * Advisor that keeps writing a block that is not ready: the person sees the step as answered and refines it), or that
 * did not; B312: only those sent since the person last answered on the step count (`refineStop`). After one that did
 * not arrive, it waits RETRY_MS. B667: with `again` (a fix), an ask that arrived counts only for that long: then it asks
 * again.
 */
function needsRefine(step, outbox, now, again = Infinity) {
  const refined = step.refined ?? null
  if (isRefined(refined)) return false
  if (refined !== null && refineStateOf({ refined }) !== 'answered') return false
  const asks = outbox.filter(message => message.command === 'refine' && message.about === step.id)
  if (refineStop(step, outbox) !== null) return false
  const last = asks.at(-1)
  if (last !== undefined && isGone(last) && now - last.at < RETRY_MS) return false
  const key = refinedKey(refined)
  const written = refinedAt(refined)
  const aboutThis = message => (message.before !== undefined ? message.before === key : refined === null || (written !== null && written <= message.at))
  return !asks.some(message => !isGone(message) && aboutThis(message) && now - message.at < again)
}

/**
 * What the board does by itself at one look (the board that delivers). `outbox` is everything it sent, also long ago,
 * with what waited too long marked `expired`; `kept` is `firstLook`'s. Answers:
 * - `release`: the held queue asks (say.mjs, `held`) whose step is refined now, or all of them when there is no
 *   Advisor to refine them; they go to the main chat;
 * - `drop`: the held asks whose step is no longer open for a queue (finished, queued, in progress, gone);
 * - `refine`: one ask to the Advisor, or null: only while no refine is open (the person's neither), the first step
 *   that needs one (`needsRefine`), by `why`: `queue` (the person asked to queue it), `queued` (the main chat queued
 *   it; not one of `queuedBefore`), then `answer` (B312: an open step, also an old one, the person answered on after
 *   its block was last written: the round folds the answer in), then `new` (a step above `since`); never the person's
 *   steps, finished ones or steps in progress;
 * - `notice`: one word to the main chat, or null: a step it queued while not refined is refined now;
 * - `kept`: what to keep for the next look.
 */
export function refineWhenDue(state, outbox, kept, now) {
  const steps = (state.backlog ?? []).flatMap(activity => activity.steps ?? []).filter(step => typeof step.id === 'string')
  const advisor = state.advisor?.name ?? null
  // Redesign Part 2 (2026-10-25): the person's queue ask is gone (the board hands out every task from its ready list):
  // an ask still held from before is dropped.
  const release = []
  const drop = outbox.filter(one => one.command === 'queue' && one.state === 'held').map(one => one.id)
  // Redesign Part 2: a refined task goes on the ready list by itself; the main chat is told of no refine any more.
  const notice = null

  let refine = null
  if (advisor !== null && !steps.some(step => step.refineAsk?.isOpen === true)) {
    const isOpen = step => step.status === 'open' || step.status === 'queued'
    const order = [
      // A step queued while not refined (from before the redesign) is refined first.
      ['queued', step => step.status === 'queued' && !kept.queuedBefore.includes(step.id)],
      // B664: a fix the board made open (a chain's third try: another way) holds its step in review: it goes next.
      ['fix', step => isOpen(step) && typeof step.item?.fixOf === 'string'],
      // B312: an answer since the block was last written waits for a round, also on an old step.
      ['answer', step => isOpen(step) && hasNewAnswer(step)],
      ['new', step => isOpen(step) && numberOf(step.id) > kept.since],
    ]
    for (const [why, wants] of order) {
      const step = steps.find(one => wants(one) && needsRefine(one, outbox, now, why === 'fix' ? FIX_RETRY_MS : Infinity))
      if (step !== undefined) {
        refine = { ...refineWords(advisor, step, (step.refined?.round ?? 0) + 1), why, board: true, before: refinedKey(step.refined) }
        break
      }
    }
  }
  return { release, drop, refine, notice, kept: { ...kept, waiting: [] } }
}
