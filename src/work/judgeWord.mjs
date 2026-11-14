// Signals change 6 (B915, 2026-11-02, the lead's Addendum 7 and the Advisor's refine points 4b.1 and 4b.3): the Supervisor,
// not the Advisor, judges the incidents, so an alarm has one owner and the Advisor keeps goals and refining. The board's word
// that asks it to judge is a kind of its own (`command` and `kind` 'judge', never 'sweep': the sweep's bookkeeping, sweep.mjs
// `sweeping()` and `heard`, stays blind to it). One judge word at a time: it lists EVERY incident waiting for judgment
// (25 Oct 22:06 one run opened X60-X64: one word, not five; a judgment turn costs about a sweep, ~170k tokens), and the next
// goes only after that turn ended. The outbox record of the word is the one fact the board reads for "one in flight": its
// `to`, `kind`, `at`, `state`, `incidents` and, once the Supervisor's turn after it ended, `endedAt` (the goal chat's wait
// line reads the same record). Shared by the supervisor (src/supervisor/index.mjs, which sends it) and the board's state
// (src/state.mjs, which holds the Supervisor's chat at its judging effort meanwhile). PURE.

import { isLate } from '../store.mjs'
import { sinceMs, valueOf } from './item.mjs'
import { heldMs } from './pause.mjs'

const MIN = 60_000
/** The command and the kind of the judge word. */
export const JUDGE = 'judge'
/** A judge word that arrived counts as in flight at most this long when no turn's end comes (a word pasted by hand, a chat that stopped). */
export const JUDGE_LONGEST_MS = 30 * MIN
/** A judge word the Workers mod took counts as on its way this long, then as arrived (index.mjs TAKEN_MS, store.mjs TAKEN_SHOWN_MS). */
const TAKEN_MS = 10 * MIN
/** The outbox's keep when the caller gives none (supervisor/index.mjs KEEP). */
const KEEP = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }
/** The incident states that wait for a judgment: found and not judged yet. */
export const TO_JUDGE = ['open', 'came back']

/** The newest judge word to `to` in the outbox (oldest first, as the store keeps it), or null. */
export function judgeWordOf(outbox, to) {
  return (outbox ?? []).findLast(message => message?.command === JUDGE && message.to === to) ?? null
}

/**
 * Workers mod 0.32.0, point 5: the judge word to `to` the turn's end names (`id`, the outbox id the mod's turn ran on), or null when
 * the id names no judge word to that chat (a line the person typed, a sweep's word, an older mod that names none).
 */
export function judgeWordNamed(outbox, to, id) {
  if (typeof id !== 'string' || id === '') return null
  return (outbox ?? []).find(message => message?.command === JUDGE && message.to === to && message.id === id) ?? null
}

/**
 * When a judge word arrived in the Supervisor's chat (typed, copied for the person to paste, or taken by its mod long ago), or
 * null while it is on its way or was lost (expired, failed, dropped, waiting past its keep).
 */
export function arrivedAt(word, now, keep = KEEP) {
  if (word === null || word === undefined) return null
  if (word.state === 'delivered' || word.state === 'copied') return word.deliveredAt ?? word.takenAt ?? word.at
  if (word.state === 'taken') return now - (word.takenAt ?? word.at) >= TAKEN_MS ? word.takenAt ?? word.at : null
  return null
}

/**
 * B1174 (X43, 2026-11-14: the judge word of 00:14:40 waited 12 h 28 min, taken only at 12:43:01 when the Supervisor's chat ran again,
 * and held every later judgment all night): a judge word its chat did not take within this long after it was sent (the person's pause
 * not counted) is no longer on its way. The outbox sweep closes it expired with its reason (`untakenWhy`), its incidents wait again,
 * and the next judge word goes only once the chat took a word after it (`judgeHeldBack`).
 */
export const JUDGE_UNTAKEN_MS = 30 * MIN

/** B1174: whether a judge word was not taken within JUDGE_UNTAKEN_MS: still waiting past it, or closed expired for it. */
export function isUntaken(word, now, keep = KEEP) {
  if (word === null || word === undefined) return false
  if (word.state === 'expired' && word.untaken === true) return true
  return word.state === 'waiting' && now - word.at - heldMs(word, now, keep.pause ?? null) > JUDGE_UNTAKEN_MS
}

/** Whether a judge word is on its way: waiting within its keep and not untaken, held by a pause, or taken lately. */
const onItsWay = (word, now, keep) => (word.state === 'waiting' && !isLate(word, now, keep) && !isUntaken(word, now, keep)) || word.state === 'held'
  || (word.state === 'taken' && now - (word.takenAt ?? word.at) < TAKEN_MS)

/** When a word's chat (or a hand) took it or it was typed, or null. */
const tookAt = message => (['taken', 'delivered', 'copied'].includes(message?.state) ? Math.max(...[message.takenAt, message.deliveredAt].filter(Number.isFinite), -Infinity) : -Infinity)

/**
 * B1174: whether the newest judge word to `to` went untaken and its chat has taken no word since it did (it does not run, or its mod
 * takes nothing): then no new judge word goes, so a chat that does not run gets one word, not one each 30 min (its sweep's word, which
 * wakes it too, says when it runs again). From when it went untaken: its close, else JUDGE_UNTAKEN_MS after it was sent.
 */
export function judgeHeldBack(outbox, to, now, keep = KEEP) {
  const word = judgeWordOf(outbox, to)
  if (!isUntaken(word, now, keep)) return false
  const since = Number.isFinite(word.closedAt) ? Math.min(word.closedAt, word.at + JUDGE_UNTAKEN_MS) : word.at + JUDGE_UNTAKEN_MS
  return !(outbox ?? []).some(message => message?.to === to && message.id !== word.id && tookAt(message) > since)
}

/**
 * B1174: why a judge word to `to` was not taken, from the Supervisor's lane as the board's state gives it (`lane`: `isRunning`,
 * `wake`), for the outbox's record and rule 8's evidence: who did not take it, and how its chat stands.
 */
export function untakenWhy(to, lane) {
  const head = `${to} did not take it within ${JUDGE_UNTAKEN_MS / MIN} min`
  if (lane === null || lane === undefined) return `${head}: its chat is not on the board`
  if (lane.isRunning === true) return `${head}: its chat runs, but its Workers mod did not take it`
  if (lane.isRunning !== false) return `${head}: the board cannot tell whether its chat runs`
  const wake = lane.wake ?? null
  if (wake?.state === 'failed') return `${head}: its chat does not run and the board could not wake it${typeof wake.why === 'string' && wake.why !== '' ? ` (${wake.why})` : ''}`
  if (wake === null || wake.state === 'none' || wake.state === undefined) return `${head}: its chat does not run (no wake tried yet)`
  return `${head}: its chat does not run (its wake: ${wake.state})`
}

/**
 * Whether a judge word to `to` is in flight at `now`: the newest one is on its way, or it arrived and the Supervisor's turn
 * after it has not ended (`endedAt` on its record), for at most JUDGE_LONGEST_MS after it arrived (principle 2: never a wait
 * for ever). A lost word is not in flight: its incidents wait again.
 */
export function judgeInFlight(outbox, to, now, keep = KEEP) {
  const word = judgeWordOf(outbox, to)
  if (word === null || Number.isFinite(word.endedAt)) return false
  if (onItsWay(word, now, keep)) return true
  const arrived = arrivedAt(word, now, keep)
  return arrived !== null && now - arrived < JUDGE_LONGEST_MS
}

/** Whether a judge word to `to` (not lost) ever listed the incident `id`. */
const isListed = (outbox, to, id) => (outbox ?? []).some(message => message?.command === JUDGE && message.to === to && Array.isArray(message.incidents)
  && message.incidents.includes(id) && !['expired', 'failed', 'dropped'].includes(message.state))

/**
 * The incidents that wait for a judgment (ids, by number): open or came back; and one with the Supervisor that no judge word
 * ever listed (the migration's: those that were with the Advisor at the landing, B915 Addendum 9). `items` the store's.
 */
export function awaitingJudgment(items, outbox, to) {
  return [...(items?.values() ?? [])].filter(item => valueOf(item, 'Kind') === 'incident')
    .filter(item => TO_JUDGE.includes(valueOf(item, 'State')) || (valueOf(item, 'State') === 'with the supervisor' && !isListed(outbox, to, valueOf(item, 'Id'))))
    .map(item => valueOf(item, 'Id')).filter(id => typeof id === 'string')
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

/**
 * Whether the Supervisor `to` judges now, or is about to: a judge word in flight, or an incident open or came back. The board
 * holds its chat at the judging effort meanwhile (state.mjs, config `supervisorJudgeEffort`). The review of 2026-11-02 (1):
 * never from "with the supervisor, no judge word listed it" (`awaitingJudgment`'s migration clause): the state's outbox
 * (store.mjs outboxNow) keeps a delivered command word only COMMAND_KNOWN_MS (2 h), after which every incident still with
 * the Supervisor would read as unlisted and hold the chat at medium for good. The sweep's own check (supervisor/index.mjs)
 * reads the raw outbox and uses `awaitingJudgment`.
 */
export function isJudging({ items, outbox, to, now, keep = KEEP }) {
  if (typeof to !== 'string' || to === '') return false
  return judgeInFlight(outbox, to, now, keep) || [...(items?.values() ?? [])].some(item => valueOf(item, 'Kind') === 'incident' && TO_JUDGE.includes(valueOf(item, 'State')))
}

/** When an incident began to wait (its Since), for how long the board waits for the judging effort before the word goes. */
export const waitingSince = item => sinceMs(valueOf(item, 'Since'))
