// The wait line (T22, the wait rule's spec and mock, the person's yes "Yes, both" of 2026-11-02). The person,
// 2026-11-02: "either the board responds immediately, e.g. via code. or we expect an ai chat todo something in which case i
// always need clear visual indications, maybe a loader. and the status if its being picked up or not. I want to know whats
// going on." Before it, an answered ask vanished at once, the recap's Send feedback said "Your partner makes the next tries"
// and nothing after, Find obsolete items said "checking" from the moment its record was written (not delivered), and a
// Check now sweep said "checking…" whether the supervisor's chat took its word or not (audit.md).
//
// ONE line per word an action of the person typed, on the card itself, through four states (mock.png), the first that holds:
// 1. Done: the action's own result (`done`, from its source: the recap's next tries filed, the obsolete check answered, the
//    sweep's end), else, for an action without such a source, the fallback "<Chat> answered HH:MM" once the turn that began on
//    the word has ended (the board-dev chat's answer 3: never "Done" without a result). An action WITH its own source whose
//    turn ended without the result says so, quietly: "<Chat>'s turn ended at HH:MM without it" (the review of 2026-11-02).
//    Once seen, both are kept on the word (`doneAt`, `answeredAt`, written once by the server) and read first: a later turn
//    never turns a word back into "is on it";
// 2. Late: a word that could not be delivered for good, rule 8's own lateness for this word (watch.mjs `isUndelivered`, the
//    alarm's one function: no second clock, the board-dev chat's condition 2), or the wake failed on every path (wake.mjs
//    `wakeOf(...).final`), with the cause from the record; "Send again" only while no wake is pending and nobody pauses;
// 3. Picked up: the word arrived and the turn that began on it runs: the lane's status Working (the board-dev chat's answer 2);
// 4. Sent: anything else, with what the board knows of why not yet: the queue place while the chat runs, the wake record
//    while it does not (condition 1). A chat whose session ended (closed or crashed mid-turn) did not answer: its wake words.
//
// WHICH TURN is the word's (the signals lead's decision of 2026-11-02, .claude/plans/2026-11-02-wait-line-turn-code-check.md, after
// Q587's card read "is on it" for a word answered in an earlier turn): the board does not guess it from busy and idle reports. The
// mod queues a word, one word is one turn, and a busy report's since moves on every state change (a question that opens and closes
// mid-turn), so the Workers mod KNOWS and says it: `report.word`, the outbox id the current (busy) or last (idle) turn ran on, null
// for a turn that was no word's, and `report.turn`, that turn's own start. This word: busy on it is "is on it", idle on it is
// "answered HH:MM"; the chat on a later turn (`turn` after the word was delivered) on another word is "answered by HH:MM" (bound,
// never exact); a turn that began before the word was delivered says nothing. A report without `word` (an older mod) keeps the
// older rule, narrowed: an idle answers only when the turn it ended began at or after the word arrived.
// The chat's status pill stays beside the line as it is (condition 3): the page draws it from the lane, never from here.
//
// PURE: every fact is passed in, `now` included, and rule 8's judgement as `judge` (the supervisor's `wordJudge`: nothing
// outside the supervisor imports its parts). The server puts the lines in the state as `waits`, by word id (`waitsOf`: only
// the words an action of the person typed, the last 24 h); the page draws a line where it finds a word id.

import { isHandTaken } from './hands.mjs'
import { isLate } from './store.mjs'
import { WAKE_PENDING, triedWords } from './wake.mjs'
import { sinceMs, valueOf } from './work/item.mjs'
import { TRIES, passesBySelf } from './work/passing.mjs'
import { isHolding } from './work/pause.mjs'
import { fixesOf } from './work/resultCheck.mjs'
import { madeAtMs } from './work/qaTask.mjs'

const MIN = 60_000
/** The words a wait is drawn for: those an action of the person typed in the last 24 hours (the spec, "Where it shows"). */
export const WAITS_KEPT_MS = 24 * 60 * MIN
/** How often the server keeps what the lines saw (a turn ended, an action's result) while no page asks for the state. */
export const WAITS_KEEP_MS = 30_000
/** The four states, in the order the first that holds wins. */
export const WAIT_STATES = ['done', 'late', 'picked-up', 'sent']
/** The person's actions of wave 1 that type a word to a chat, by the word's command (an answer is any word with `ask`). */
export const WAIT_COMMANDS = ['recap-feedback', 'obsolete-check', 'sweep']
/** The commands of the actions with a Done source of their own (an all-approved recap Send names no step: it has none). */
const OWN_DONE = ['obsolete-check', 'sweep', 'recap-feedback']
/**
 * Who holds the person's Send again on the message way until a hand that may send takes it (server.mjs `wakeAgainNow`, the
 * attempt's `by`): the line then reads "waking X (message on its way, held by the board)".
 */
export const AGAIN_BY = 'the board'
/** How far a retried word is followed to the copy that stands for it (store.mjs `retriedAs`). */
const RETRY_HOPS = 6

const pad = value => String(value).padStart(2, '0')
const clockOf = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const isTime = value => Number.isFinite(value)
const minutes = ms => Math.max(0, Math.floor(ms / MIN))
const ordinal = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`

/**
 * When the word reached its chat, as the board knows it: null while it is on its way. Delivered, or taken by the addressee's
 * own Workers mod (not a hand's, `isHandTaken`). The time is the take that began its delivery (`takenAt`), else its
 * `deliveredAt`: the mod takes the word, types it and says "typed" a moment after the turn it began reported its since, so a
 * turn's since can be a second before `deliveredAt` while it is never before the take (the board-dev chat's answer 2, "the
 * report's since at or after deliveredAt", read so that this race never shows a running turn as not picked up).
 */
export function arrivedAt(word) {
  if (word?.state === 'delivered') return [word.takenAt, word.deliveredAt, word.at].find(isTime) ?? null
  if (word?.state === 'taken' && !isHandTaken(word)) return [word.takenAt, word.at].find(isTime) ?? null
  return null
}

/** Whether the action of a word has a Done source of its own (`recapDone`, `obsoleteDone`, `sweepDone`): then the fallback "answered" is never used. */
export function hasOwnDone(word) {
  if (!OWN_DONE.includes(word?.command)) return false
  return word.command !== 'recap-feedback' || (Array.isArray(word.backSteps) && word.backSteps.length > 0)
}

/**
 * A word that failed and will not go again (as store.mjs `retryFailed` decides: refused for good, a why that never passes by
 * itself, its tries spent, a work line or envelope, or late): it can never reach its chat (the review of 2026-11-02, 4).
 */
export function isLostForGood(word, now, keep = {}) {
  if (word?.state !== 'failed' || word.retriedAs !== undefined) return false
  return word.final === true || !passesBySelf(word.why) || ['work', 'handover'].includes(word.command) || (word.tries ?? 1) >= TRIES || isLate(word, now, keep)
}

const oneLine = (words, max = 120) => String(words ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * The line of one word: `{ state, lead, rest, at, chat, canSendAgain, link, seen }`, or null when the word is no wait: closed,
 * dropped or superseded (`judge.matters` false), copied for the person to paste, or expired and not late by rule 8. `seen`
 * what the server keeps on the word once (`{ answeredAt }` with `answeredBound` when only the later turn's start is known,
 * `{ doneAt, doneWords, doneStep }`), null when nothing new was seen.
 * - `word`: the outbox record (`id`, `to`, `state`, `at`, `takenAt`, `deliveredAt`, ...), the copy that stands for it when retried;
 * - `lane`: the addressee as the state draws it (`name`, `isRunning`, `status`), or null when it is not on the board;
 * - `report`: its chat's last turn report (`{ state, since, busyAt, word, turn }`, chatReport.mjs: `word` and `turn` only from a mod
 *   that says them, `busyAt` the board's receipt of the last turn start), or null;
 * - `ahead`: the word the report's turn ran on is one of this chat that stood ahead of this word in its queue (`waitsOf`): the
 *   chat has not moved past this word then, whatever the turn's time;
 * - `wake`: its wake as the state carries it (state.mjs `withWakes`: `{ state, final, at, by, why, attempts }`), or null;
 * - `done`: the action's own result when its source says so (`{ at, words, link }`), else null;
 * - `now`, `keep`: the board's clock and the outbox's keep (store.mjs `isLate`);
 * - `queue`: how many of the addressee's waiting words came before it;
 * - `judge`: rule 8's judgement of one word (supervisor/index.mjs `wordJudge`): `isUndelivered(word)`, watch.mjs's function that
 *   `undeliveredWords` uses (the alarm's own: no second clock), and `matters(word)`, the outbox sweep's (`wordMatters`);
 * - `paused`: the person pauses the chats (no Send again then: the board wakes nobody).
 */
export function waitLineOf({ word, lane = null, report = null, ahead = false, wake = null, done = null, now, keep = {}, queue = 0, judge, paused = false }) {
  if (word === null || word === undefined || typeof word.to !== 'string' || !isTime(word.at)) return null
  if (['dropped', 'stopped', 'copied'].includes(word.state) || !judge.matters(word)) return null
  const chat = lane?.name ?? word.to
  const line = (state, lead, rest, at, more = {}) => ({ state, lead, rest, at, chat, canSendAgain: false, link: null, seen: null, ...more })
  const own = hasOwnDone(word)
  // 1. Done, as kept on the word first (the review of 2026-11-02, 2a: once seen, it stays), then as seen now.
  if (isTime(word.doneAt)) {
    const link = done?.link ?? (typeof word.doneStep === 'string' ? { step: word.doneStep, text: `See ${word.doneStep} →` } : null)
    return line('done', `Done ${clockOf(word.doneAt)}`, done?.words ?? word.doneWords ?? '', word.doneAt, { link })
  }
  if (done !== null && done !== undefined) {
    const at = isTime(done.at) ? done.at : now
    return line('done', `Done ${clockOf(at)}`, done.words ?? '', at, { link: done.link ?? null, seen: { doneAt: at, doneWords: oneLine(done.words, 160), ...(typeof done.link?.step === 'string' ? { doneStep: done.link.step } : {}) } })
  }
  // A turn seen ended at `at` (exact), or moved past by `at` (bound: the chat's later turn began then, so the word's turn ended
  // before: "by", never an exact time).
  const ended = (at, isBound = false) => (own ? line('sent', `${chat}'s turn ended ${isBound ? 'by' : 'at'} ${clockOf(at)} without it`, '', at, { isTurnEnded: true, ...(isBound ? { isBound } : {}) })
    : line('done', `${chat} answered ${isBound ? 'by ' : ''}${clockOf(at)}`, '', at, { isFallback: true, ...(isBound ? { isBound } : {}) }))
  if (isTime(word.answeredAt)) return ended(word.answeredAt, word.answeredBound === true)
  const arrived = arrivedAt(word)
  const hasReport = report !== null && report !== undefined && isTime(report.since) && arrived !== null
  // The mod names the word its turn ran on (`report.word`, a string, or null for a turn that was no word's): then the board knows
  // the turn of this word, it does not guess it from busy and idle. A report without it is from an older mod (the older rule).
  const isNamed = hasReport && report.word !== undefined
  const isOurs = isNamed && report.word === word.id
  // The turn that ran on the word has ended, seen now; kept from now on (`seen`). An `ended` report (the session closed or crashed
  // mid-turn) is no answer.
  const answer = hasReport ? turnAnswer({ word, report, arrived, isNamed, isOurs, ahead }) : null
  if (answer !== null) return { ...ended(answer.at, answer.isBound), seen: { answeredAt: answer.at, ...(answer.isBound ? { answeredBound: true } : {}) } }
  // 2. Late: a word that can never reach its chat; rule 8's own judgement; or every way to wake the chat failed while the word
  // was not in it. Send again only for a chat that does not run, while no wake is pending, nobody pauses, and the board has
  // an id to reach it (one without could only be refused: open its chat).
  if (isLostForGood(word, now, keep)) {
    return line('late', `Not picked up after ${minutes(now - word.at)} min`, `could not be delivered: ${oneLine(word.why) || 'the chat did not take it'}`, word.at)
  }
  const isPending = WAKE_PENDING.includes(wake?.state)
  const late = judge.isUndelivered(word) === true
  const wakeFailed = arrived === null && wake?.final === true
  if (late || wakeFailed) {
    const noId = wake?.why === 'no id' && (wake.attempts ?? []).length === 0
    const tried = triedWords(wake?.attempts ?? [], clockOf)
    const cause = noId ? `the board has no id to wake ${chat}: open its chat`
      : wakeFailed || tried.length > 0 ? `${chat} did not wake: ${tried.join('; ') || wake?.why || 'no way left to wake it'}`
        : word.state === 'failed' && oneLine(word.why) !== '' ? `it could not be typed: ${oneLine(word.why)}`
          : `it waits in ${chat}'s queue`
    return line('late', `Not picked up after ${minutes(now - word.at)} min`, cause, word.at, { canSendAgain: lane?.isRunning === false && !isPending && !noId && paused !== true })
  }
  // An expired word that rule 8 no longer names (older than its look back, or the sweep's own word): no wait any more.
  if (word.state === 'expired' || (word.state === 'waiting' && isLate(word, now, keep))) return null
  // 3. Picked up: it arrived and the turn that began on it runs, the lane Working. With the mod's `word`: the report is busy (or
  // asking, the chat's own question inside that turn, the lane Waiting for you) on this very word, since that turn's own start.
  // Without it (an older mod; a word its chat took inside a turn that runs, taken and never typed: on in that turn, from the take).
  if (isNamed) {
    const isRunning = isOurs && (report.state === 'busy' ? lane?.status === 'Working' : report.state === 'asking' && lane?.status === 'Waiting for you')
    if (isRunning) return line('picked-up', `${chat} is on it`, `since ${clockOf(turnOf(report))}`, turnOf(report))
  } else if (hasReport && lane?.status === 'Working' && (report.since >= arrived || word.state === 'taken')) {
    return line('picked-up', `${chat} is on it`, `since ${clockOf(Math.max(report.since, arrived))}`, Math.max(report.since, arrived))
  }
  // 4. Sent: why it is not picked up yet, as far as the board knows. A chat that does not run first: its wake words.
  const sent = `Sent ${clockOf(word.at)}`
  if (word.isHeld === true) return line('sent', sent, 'held while you pause the chats', word.at)
  if (lane?.isRunning === false) return line('sent', sent, wakingWords(chat, lane, wake), word.at)
  if (arrived !== null) return line('sent', sent, `in ${chat}'s chat since ${clockOf(arrived)}, waits for its turn`, word.at)
  if (word.state === 'failed') return line('sent', sent, `${chat} could not take it; the board tries again`, word.at)
  const place = queue > 0 ? [`${ordinal(queue + 1)} in its queue`] : lane?.isRunning === true ? ['next in its queue'] : []
  return line('sent', sent, [`waits for ${chat} to pick it up`, ...place].join(' · '), word.at)
}

/** The start of the turn a report is of: the mod's `turn` (unchanged by a question that opens and closes inside it), else its since. */
const turnOf = report => (isTime(report.turn) ? report.turn : report.since)

/**
 * Whether the turn that ran on the word has ended, and when: `{ at, isBound }` or null (the signals lead's decision of
 * 2026-11-02, .claude/plans/2026-11-02-wait-line-turn-code-check.md). Words are queued by the mod, never injected, one word is one
 * turn, in order, so a busy report's start says nothing of the word (an ask that opens and closes gives a later one inside one
 * turn): the board reads which turn it was only from the mod's `word`.
 * - the mod names the word (`isNamed`): the report is idle on this very word: exact, at its since (the turn's end). Else, bound:
 *   the report is of a later turn of the chat (`turn` after the word was delivered, on another word or none, and not on a word
 *   that stood ahead of this one in the queue) with the chat running or at rest: the word's turn ended before it began, "by"
 *   that time, never an exact one. A turn that began before the word was delivered (the one running while it waited, a wake
 *   message's first turn) says nothing;
 * - an older mod: an idle report answers only when the turn it ended began at or after the word arrived (`busyAt`, the board's
 *   receipt of that turn's start, kept with the report): the idle that ends the turn running while the word waited does not.
 */
function turnAnswer({ word, report, arrived, isNamed, isOurs, ahead }) {
  if (!isNamed) {
    return report.state === 'idle' && report.since >= arrived && isTime(report.busyAt) && report.busyAt >= arrived ? { at: report.since, isBound: false } : null
  }
  if (isOurs) return report.state === 'idle' ? { at: report.since, isBound: false } : null
  const isLater = isTime(report.turn) && word.state === 'delivered' && isTime(word.deliveredAt) && report.turn > word.deliveredAt
  return isLater && ahead !== true && ['busy', 'idle', 'asking'].includes(report.state) ? { at: report.turn, isBound: true } : null
}

/** Condition 1: the Sent line of a chat that does not run reads its wake record. */
function wakingWords(chat, lane, wake) {
  switch (wake?.state) {
    case 'on-its-way': return `waking ${chat} (message on its way${wake.by ? `, held by ${wake.by}` : ''})`
    case 'sent': return `waking ${chat} (message sent ${clockOf(wake.at)}${wake.by ? ` by ${wake.by}` : ''})`
    case 'launched': return `waking ${chat} (launched ${clockOf(wake.at)})`
    case 'waiting-sender': return `waking ${chat} (waits for a chat that can send)`
    case 'failed': return `waking ${chat} (${wake.why ?? 'the first way failed'}; trying the other way)`
    default: return lane?.status === 'Not running' ? `${chat} does not run; the board wakes it` : `${chat} is asleep; the board wakes it`
  }
}

/** Whether a word is one an action of the person typed (wave 1): an answer, the recap's feedback, the obsolete check, an asked sweep. */
export function isPersonWord(word, { sweepWord = null } = {}) {
  if (typeof word?.to !== 'string' || word.to === '' || !isTime(word.at)) return false
  if ((word.ask ?? null) !== null) return true
  if (word.command === 'sweep') return typeof sweepWord === 'string' && word.id === sweepWord
  return ['recap-feedback', 'obsolete-check'].includes(word.command)
}

/** The copy that stands for a retried word (`retriedAs`, a few hops at most), else the word itself. */
export function standingWord(word, byId) {
  let found = word
  for (let hop = 0; hop < RETRY_HOPS && typeof found?.retriedAs === 'string' && byId.has(found.retriedAs); hop += 1) found = byId.get(found.retriedAs)
  return found
}

/** The minute a time falls in: a step's Since and History are stamped to the minute. */
const minuteOf = at => Math.floor(at / MIN) * MIN

/**
 * The recap's own result (the supervisor's dropped-fix rule, resultCheck.mjs `reviewWaitOf`: a step whose part was sent back
 * waits for the partner's next try until a new fix, a block on its next try or a new check stands): Done once every step of a
 * part sent back (`word.backSteps`, the steps in review at the Send) has its next try filed after the Send, or left review.
 * `{ at, words, link }` with the new tasks, or null while one still waits (or the word names no steps: the fallback).
 */
export function recapDone(word, items) {
  const steps = Array.isArray(word?.backSteps) ? word.backSteps.filter(id => typeof id === 'string') : []
  if (steps.length === 0 || !(items instanceof Map)) return null
  const from = minuteOf(word.at)
  const after = item => (isTime(madeAtMs(item)) && madeAtMs(item) >= from ? madeAtMs(item) : null)
  const tries = []
  for (const id of steps) {
    const item = items.get(id)
    if (item === undefined) continue
    if (valueOf(item, 'State') !== 'review') {
      const at = sinceMs(valueOf(item, 'Since'))
      tries.push({ id: null, at: isTime(at) ? at : null })
      continue
    }
    const blockers = [...new Set(`${valueOf(item, 'Blocked by') ?? ''} ${valueOf(item, 'Waits for') ?? ''}`.match(/\bB\d+\b/g) ?? [])].filter(one => one !== id)
    const next = [...fixesOf(id, items), ...blockers.map(one => items.get(one)).filter(Boolean)]
      .map(one => ({ id: valueOf(one, 'Id'), at: after(one) })).filter(one => one.at !== null).sort((a, b) => a.at - b.at)
    if (next.length === 0) return null
    tries.push(...next)
  }
  if (tries.length === 0) return null
  const made = [...new Set(tries.map(one => one.id).filter(Boolean))]
  const times = tries.map(one => one.at).filter(isTime)
  return {
    at: times.length === 0 ? null : Math.max(...times),
    words: made.length === 0 ? 'what you sent back moved on' : `${made.length} new task${made.length === 1 ? '' : 's'} for what you sent back`,
    link: made.length === 0 ? null : { step: made[0], text: `See ${made[0]} →` },
  }
}

/**
 * The obsolete check's own result: its record (obsolete.mjs `parseObsolete`) answered, for the check this word asked (the
 * record is written just before its word, and a newer check replaces it). `{ at, words }` or null.
 */
export function obsoleteDone(word, record) {
  if (record?.state !== 'done' || !isTime(record.answeredAt) || !isTime(record.at) || record.at > word.at || word.at - record.at > 5 * MIN) return null
  const verdicts = Object.values(record.verdicts ?? {})
  const closed = verdicts.filter(one => one.verdict === 'obsolete').length
  const stay = record.items.length - closed
  return { at: record.answeredAt, words: `${closed} closed as obsolete · ${stay} ${stay === 1 ? 'stays' : 'stay'}`, link: null }
}

/**
 * The asked sweep's own result: its end by its chat's turn (sweep.mjs `heard`, how "told"), for the sweep this word asked
 * (`sweep.word`). One the board ended because nothing took its word (how "quiet") is no result: the line follows the word.
 */
export function sweepDone(word, sweep) {
  if (sweep?.word !== word.id || !isTime(sweep.ended) || sweep.how !== 'told') return null
  const found = Number.isInteger(sweep.found) ? sweep.found : 0
  return { at: sweep.ended, words: found === 0 ? 'nothing new found' : `${found} incident${found === 1 ? '' : 's'} filed`, link: null }
}

/** Every board chat the state draws, by name: the lanes, the partner, its helper, the supervisor's chat, the Product owner. */
function lanesOf(state) {
  const lanes = [...(state?.chats ?? []).filter(lane => lane?.isLeftover !== true), state?.advisor, state?.advisorHelper, state?.supervisorChat, state?.productOwner]
  return new Map(lanes.filter(lane => typeof lane?.name === 'string').map(lane => [lane.name, lane]))
}

/**
 * The state's `waits`: the line of every word an action of the person typed in the last 24 hours (`isPersonWord`), by its
 * id; a retried word by the copy that stands for it. `outbox` the board's raw outbox (as rule 8 reads it), `now` and `keep`
 * the board's clock and the outbox's keep, `judge` rule 8's judgement of the same moment (the supervisor's `wordJudge`, made
 * once for every word), `reports` the board's kept turn reports by chat (a Map), `items` the
 * work store's items, `obsolete` the obsolete check's record, `sweep` the supervisor's last sweep (`{ word, asked, ended, how,
 * found }`). Each line also carries what the page finds it by: `command` ('answer' for an answer), `about`, `ask`, `sentAt`, and
 * `title`, the word's first line.
 */
export function waitsOf({ state, outbox = [], now, keep = {}, judge, reports = null, items = null, obsolete = null, sweep = null }) {
  const paused = isHolding(state?.pause) || state?.pause?.state === 'resuming'
  const byId = new Map(outbox.filter(word => typeof word?.id === 'string').map(word => [word.id, word]))
  // The place of each word in the outbox, which is the order its chat takes them in (store.mjs `take`) and types them.
  const placeOf = new Map(outbox.map((word, place) => [word?.id, place]))
  const lanes = lanesOf(state)
  const sweepWord = sweep?.asked === true && typeof sweep.word === 'string' ? sweep.word : null
  const waits = {}
  for (const asked of outbox) {
    if (!isPersonWord(asked, { sweepWord }) || now - asked.at >= WAITS_KEPT_MS) continue
    const word = standingWord(asked, byId)
    const lane = lanes.get(word.to) ?? null
    const report = (reports instanceof Map ? reports.get(word.to) : null) ?? lane?.report ?? null
    const queue = outbox.filter(one => one.to === word.to && one.state === 'waiting' && one.isHeld !== true && one.id !== word.id && isTime(one.at) && one.at < word.at).length
    const done = word.command === 'recap-feedback' ? recapDone(word, items) : word.command === 'obsolete-check' ? obsoleteDone(word, obsolete) : word.command === 'sweep' ? sweepDone(word, sweep) : null
    // The word the chat's turn ran on, when it is one of the chat's that came before this one: its turn is not this word's.
    const ranOn = typeof report?.word === 'string' ? byId.get(report.word) : undefined
    const ahead = ranOn !== undefined && ranOn.to === word.to && ranOn.id !== word.id && ['taken', 'delivered'].includes(ranOn.state) && placeOf.get(ranOn.id) < placeOf.get(word.id)
    const line = waitLineOf({ word, lane, report, ahead, wake: lane?.wake ?? null, done, now, keep, queue, judge, paused })
    if (line === null) continue
    const title = String(asked.text ?? '').split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 160)
    waits[asked.id] = { ...line, word: word.id, command: (asked.ask ?? null) !== null ? 'answer' : asked.command, about: asked.about ?? null, ask: asked.ask ?? null, sentAt: asked.at, title }
  }
  return waits
}

/**
 * The review of 2026-11-02 (2a): what the server keeps on the words once (`answeredAt`, `doneAt` with its words), out of the
 * lines of `waitsOf` (each line's `seen`), and the lines as the page gets them (without `seen`). `{ waits, seen: [{ id, fields }] }`,
 * `id` the word the line read (the copy that stands for a retried word), once per word.
 */
export function splitSeen(waits) {
  const seen = new Map()
  const shown = {}
  for (const [id, { seen: fields, ...line }] of Object.entries(waits ?? {})) {
    shown[id] = line
    if (fields !== null && fields !== undefined && typeof line.word === 'string' && !seen.has(line.word)) seen.set(line.word, fields)
  }
  return { waits: shown, seen: [...seen].map(([id, fields]) => ({ id, fields })) }
}
