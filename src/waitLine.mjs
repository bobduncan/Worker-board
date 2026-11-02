// The wait line (T22, spec art-inbox/focus-mocks/wait-rule/spec.md, the person's yes "Yes, both" of 2026-11-02). The person,
// 2026-11-02: "either the board responds immediately, e.g. via code. or we expect an ai chat todo something in which case i
// always need clear visual indications, maybe a loader. and the status if its being picked up or not. I want to know whats
// going on." Before it, an answered ask vanished at once, the recap's Send feedback said "Your partner makes the next tries"
// and nothing after, Find obsolete items said "checking" from the moment its record was written (not delivered), and a
// Check now sweep said "checking…" whether the supervisor's chat took its word or not (audit.md).
//
// ONE line per word an action of the person typed, on the card itself, through four states (mock.png), the first that holds:
// 1. Done: the action's own result (`done`, from its source: the recap's next tries filed, the obsolete check answered, the
//    sweep's end), else the fallback "<Chat> answered HH:MM" once the turn that began on the word has ended (the board-dev
//    chat's answer 3: never "Done" without a result);
// 2. Late: rule 8's own lateness for this word (watch.mjs `isUndelivered`, the alarm's one function: no second clock, the
//    board-dev chat's condition 2), or the wake failed on every path (wake.mjs `wakeOf(...).final`), with the cause from the
//    record; "Send again" only while no wake is pending;
// 3. Picked up: the word arrived and the addressee's turn that began on it runs (the board-dev chat's answer 2);
// 4. Sent: anything else, with what the board knows of why not yet: the queue place while the chat runs, the wake record
//    while it does not (condition 1).
// The chat's status pill stays beside the line as it is (condition 3): the page draws it from the lane, never from here.
//
// PURE: every fact is passed in, `view.now` included. The server puts the lines in the state as `waits`, by word id
// (`waitsOf`: only the words an action of the person typed, the last 24 h); the page draws a line where it finds a word id.

import { isHandTaken } from './hands.mjs'
import { isLate } from './store.mjs'
import { isUndelivered, undeliveredJudged, wordMatters } from './supervisor/rules/watch.mjs'
import { WAKE_PENDING, triedWords } from './wake.mjs'
import { sinceMs, valueOf } from './work/item.mjs'
import { fixesOf } from './work/resultCheck.mjs'
import { madeAtMs } from './work/qaTask.mjs'

const MIN = 60_000
/** The words a wait is drawn for: those an action of the person typed in the last 24 hours (the spec, "Where it shows"). */
export const WAITS_KEPT_MS = 24 * 60 * MIN
/** The four states, in the order the first that holds wins. */
export const WAIT_STATES = ['done', 'late', 'picked-up', 'sent']
/** The person's actions of wave 1 that type a word to a chat, by the word's command (an answer is any word with `ask`). */
export const WAIT_COMMANDS = ['recap-feedback', 'obsolete-check', 'sweep']
/** A report state in which the turn that began on a word still runs: at work, or asking the person in its chat. */
const TURN_RUNS = ['busy', 'asking']
/** A report state in which that turn has ended. */
const TURN_ENDED = ['idle', 'ended']
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

/**
 * The line of one word: `{ state, lead, rest, at, chat, canSendAgain, link }`, or null when the word is no wait: closed,
 * dropped or superseded (watch.mjs `wordMatters` false), copied for the person to paste, or expired and not late by rule 8.
 * - `word`: the outbox record (`id`, `to`, `state`, `at`, `takenAt`, `deliveredAt`, ...), the copy that stands for it when retried;
 * - `lane`: the addressee as the state draws it (`name`, `isRunning`, `status`), or null when it is not on the board;
 * - `report`: its chat's last turn report (`{ state, since }`, chatReport.mjs), or null;
 * - `wake`: its wake as the state carries it (state.mjs `withWakes`: `{ state, final, at, by, why, attempts }`), or null;
 * - `done`: the action's own result when its source says so (`{ at, words, link }`), else null;
 * - `view`: the supervisor's view (supervisor/view.mjs `buildView`): `now`, `keep`, `settings` and what rule 8 reads;
 * - `queue`: how many of the addressee's waiting words came before it.
 * `facts` (optional) what `waitsOf` shares between words: `{ judged, matters }`.
 */
export function waitLineOf({ word, lane = null, report = null, wake = null, done = null, view, queue = 0 }, facts = {}) {
  if (word === null || word === undefined || typeof word.to !== 'string' || !isTime(word.at)) return null
  const now = view.now
  const matters = facts.matters ?? wordMatters(view)
  if (['dropped', 'stopped', 'copied'].includes(word.state) || !matters(word)) return null
  const chat = lane?.name ?? word.to
  const line = (state, lead, rest, at, more = {}) => ({ state, lead, rest, at, chat, canSendAgain: false, link: null, ...more })
  const arrived = arrivedAt(word)
  const hasReport = report !== null && report !== undefined && isTime(report.since) && arrived !== null
  // The turn that began on the word: its report's since at or after the word arrived. A word its chat took inside a turn that
  // runs (taken, never typed: the addressee's model has it) is on in that turn, from the take.
  const turn = !hasReport ? null : report.since >= arrived ? report
    : word.state === 'taken' && TURN_RUNS.includes(report.state) ? { state: report.state, since: arrived } : null
  // 1. Done: the action's own result; else the fallback once the turn that began on the word has ended.
  if (done !== null && done !== undefined) return line('done', isTime(done.at) ? `Done ${clockOf(done.at)}` : 'Done', done.words ?? '', done.at ?? null, { link: done.link ?? null })
  if (turn !== null && TURN_ENDED.includes(turn.state)) return line('done', `${chat} answered ${clockOf(turn.since)}`, '', turn.since, { isFallback: true })
  // 2. Late: rule 8's own judgement, or every way to wake the chat failed while the word was not in it.
  const isPending = WAKE_PENDING.includes(wake?.state)
  const late = isUndelivered(view, word, facts.judged)
  const wakeFailed = arrived === null && wake?.final === true
  if (late || wakeFailed) {
    const tried = triedWords(wake?.attempts ?? [], clockOf)
    const cause = wakeFailed || tried.length > 0 ? `${chat} did not wake: ${tried.join('; ') || wake?.why || 'no way left to wake it'}`
      : word.state === 'failed' && typeof word.why === 'string' && word.why.trim() !== '' ? `it could not be typed: ${word.why.replace(/\s+/g, ' ').trim().slice(0, 120)}`
        : `it waits in ${chat}'s queue`
    return line('late', `Not picked up after ${minutes(now - word.at)} min`, cause, word.at, { canSendAgain: lane?.isRunning === false && !isPending })
  }
  // An expired word that rule 8 no longer names (older than its look back, or the sweep's own word): no wait any more.
  if (word.state === 'expired' || (word.state === 'waiting' && isLate(word, now, view.keep ?? {}))) return null
  // 3. Picked up: it arrived and the turn that began on it runs.
  if (turn !== null && TURN_RUNS.includes(turn.state)) return line('picked-up', `${chat} is on it`, `since ${clockOf(turn.since)}`, turn.since)
  // 4. Sent: why it is not picked up yet, as far as the board knows.
  const sent = `Sent ${clockOf(word.at)}`
  if (arrived !== null) return line('sent', sent, `in ${chat}'s chat since ${clockOf(arrived)}, waits for its turn`, word.at)
  if (word.isHeld === true) return line('sent', sent, 'held while you pause the chats', word.at)
  if (lane?.isRunning === false) return line('sent', sent, wakingWords(chat, lane, wake), word.at)
  const place = queue > 0 ? [`${ordinal(queue + 1)} in its queue`] : lane?.isRunning === true ? ['next in its queue'] : []
  return line('sent', sent, [`waits for ${chat} to pick it up`, ...place].join(' · '), word.at)
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
 * id; a retried word by the copy that stands for it. `outbox` the board's raw outbox (as rule 8 reads it), `view` the
 * supervisor's view of the same moment (`buildView`), `reports` the board's kept turn reports by chat (a Map), `items` the
 * work store's items, `obsolete` the obsolete check's record, `sweep` the supervisor's last sweep (`{ word, asked, ended, how,
 * found }`). Each line also carries what the page finds it by: `command` ('answer' for an answer), `about`, `ask`, `sentAt`, and
 * `title`, the word's first line.
 */
export function waitsOf({ state, outbox = [], view, reports = null, items = null, obsolete = null, sweep = null }) {
  const now = view.now
  const byId = new Map(outbox.filter(word => typeof word?.id === 'string').map(word => [word.id, word]))
  const lanes = lanesOf(state)
  const sweepWord = sweep?.asked === true && typeof sweep.word === 'string' ? sweep.word : null
  // Rule 8's judgement and the outbox sweep's, made once for every word.
  const facts = { matters: wordMatters(view), judged: undeliveredJudged(view) }
  const waits = {}
  for (const asked of outbox) {
    if (!isPersonWord(asked, { sweepWord }) || now - asked.at >= WAITS_KEPT_MS) continue
    const word = standingWord(asked, byId)
    const lane = lanes.get(word.to) ?? null
    const report = (reports instanceof Map ? reports.get(word.to) : null) ?? lane?.report ?? null
    const queue = outbox.filter(one => one.to === word.to && one.state === 'waiting' && one.isHeld !== true && one.id !== word.id && isTime(one.at) && one.at < word.at).length
    const done = word.command === 'recap-feedback' ? recapDone(word, items) : word.command === 'obsolete-check' ? obsoleteDone(word, obsolete) : word.command === 'sweep' ? sweepDone(word, sweep) : null
    const line = waitLineOf({ word, lane, report, wake: lane?.wake ?? null, done, view, queue }, facts)
    if (line === null) continue
    const title = String(asked.text ?? '').split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 160)
    waits[asked.id] = { ...line, word: word.id, command: (asked.ask ?? null) !== null ? 'answer' : asked.command, about: asked.about ?? null, ask: asked.ask ?? null, sentAt: asked.at, title }
  }
  return waits
}
