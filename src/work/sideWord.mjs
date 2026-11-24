// B1307 (F40; the person's "Yes, build F40", 2026-11-21, in chat 1): a late wait on a side chat goes to that chat first. The live
// case: Worker 1 blocked B1300 at 10:49 on "chat 1" (its review and go to land); at 90 min of the board's running time the person got
// a "Waits late" card and carried it to chat 1 by hand, as on 20 Nov: the person was the messenger. Now, at the limit
// (waitsOn.mjs `lateWaitOf`), the board says ONE word to the side chat, a hand's send by its app id (hands.mjs `handJobs`, kind
// SIDE_WORD), and the person's card waits: it comes only when the wait still stands SIDE_ANSWER_MS of running time after the word
// went (answered = the wait cleared, renewed by a new block, or the step moved: then the wait, and its key, are gone).
//
// One word per wait: its key is the step and the wait's own minute (`Waits on`'s stamp), so a block with a new why is a new wait with a
// new clock, and the word is a record in the outbox: a board restart finds it and says none again. The side chats' app ids are this
// PC's (never in git): the local runtime file `side-chats.json` (projectPaths.mjs `localFile`), `{ "chat 1": ["local_..."] }`, a list,
// one id per account; the one the app's chat list has under the board's account is used (appChats.mjs `listedWhere`). No id there, or
// no hand sends the word within SIDE_HAND_MS of running time (the app refuses code sends): the record says why and the card comes
// with it. Waits on Main, a worker or an asset are as before. Pure: it reads what it is given.
//
// Chat 1's core review (2026-11-23): no word while a limit is full (a word starts a model turn past the person's stop line: the card
// comes as before F40, saying so); a word given back in doubt is never sent again (the first call may have landed); a refusal that is
// tried again holds the card; a wait that was late before its word keeps its card (`keepCard`), so nothing shows and vanishes.
//
// F53 (chat 1's core review of B1394): a full limit leaves no wait without its word, and no card that shows and vanishes. A word closed
// because a limit was full is no word: once the limit is back the wait is due again (`sideWordOf` skips it). A card shown because a
// limit is full stays until the one word went: the delivering board's look writes it down per wait, in the outbox so a restart keeps
// it (`sideKeepOf`: `keepCard` on the word still to go, or a record of its own with no word yet, `sideKeptFor`), and the next word of
// that wait keeps the card (`sideKeptOf`, overdue).

import { plainWhy } from '../wakeCarry.mjs'
import { TRIES, passesBySelf } from './passing.mjs'
import { hourMinute } from './waitsOn.mjs'

/** The outbox word's command: one word to a side chat about a late wait on it. */
export const SIDE_WORD = 'side-word'
/** The side chats the board may ask (the person's numbering; chat 0 only reads). */
export const SIDE_ASKED = /^chat [1-4]$/i
/** How long (the board's running time) a side word waits for a hand before the board gives up on it and the person gets the card. */
export const SIDE_HAND_MS = 10 * 60_000
/** How long (the board's running time) the side chat has to answer once the word went, before the person gets the card. */
export const SIDE_ANSWER_MS = 30 * 60_000
/** The local file of the side chats' app ids (never in git). */
export const SIDE_CHATS_FILE = 'side-chats.json'
/** Why a word no hand sent in time was given up. */
export const STALE_SIDE_WHY = `no hand sent it within ${SIDE_HAND_MS / 60_000} min`

const APP_ID = /^local_[\w-]{1,80}$/
const FULL_WHY = 'a limit is full'

/** Whether a wait's who is a side chat the board asks first. */
export const isAskedSide = who => SIDE_ASKED.test(String(who ?? '').trim())

/** The key of a wait's one word: the step and the wait's own minute ("B1300:2026-11-21 10:49"). */
export const sideKeyOf = (stepId, wait) => `${stepId}:${wait?.at ?? ''}`

/** Whether the 5-hour or the week's limit is full (limits.mjs `level`: at the person's stop line, or held by a reset ahead). */
export const isLimitFull = limits => ['fiveHour', 'week'].some(one => limits?.[one]?.level === 'full')

/** A failed word the store tries again by itself (store.mjs `retryFailed`), its copy not made yet. */
const isRetryDue = word => word?.state === 'failed' && word.final !== true && word.retriedAs === undefined && passesBySelf(word.why) && (word.tries ?? 1) < TRIES

/** F53 (a): a record closed because a limit was full (a word given up then, or the mark of a card shown then): no word of its wait. */
const isFullMark = word => word?.state === 'dropped' && word.why === FULL_WHY

/**
 * The newest side word of `key` in the outbox (any state; a retry's copy keeps its first time and comes later), or null. F53 (a): a
 * record closed because a limit was full is none, so the wait is due again once the limit is back.
 */
export function sideWordOf(outbox, key) {
  let found = null
  for (const word of Array.isArray(outbox) ? outbox : []) {
    if (word?.command !== SIDE_WORD || word.key !== key || isFullMark(word)) continue
    if (found === null || (word.at ?? 0) >= (found.at ?? 0)) found = word
  }
  return found
}

/** F53: whether the person's card of `key` showed because a limit was full, as the outbox keeps it (a record closed for it). */
export const sideKeptOf = (outbox, key) => (Array.isArray(outbox) ? outbox : []).some(word => word?.command === SIDE_WORD && word.key === key && isFullMark(word))

/**
 * The side chats' ids out of the local file's text: `{ "chat 1": ["local_..."] }` (a single id stands for a list of one), names
 * lower case, only app ids; {} for anything else.
 */
export function sideChatsOf(text) {
  let parsed
  try {
    parsed = JSON.parse(String(text ?? ''))
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const chats = {}
  for (const [name, ids] of Object.entries(parsed)) {
    const list = (Array.isArray(ids) ? ids : [ids]).filter(one => typeof one === 'string' && APP_ID.test(one))
    if (isAskedSide(name) && list.length > 0) chats[name.trim().toLowerCase()] = list
  }
  return chats
}

/**
 * The app id to ask `who` at: `{ session }`, or `{ why }` when there is none. `chats` the file's (`sideChatsOf`); `whereOf(id)` where
 * the app lists that chat (`listedWhere`: 'here' the board's account, 'elsewhere', 'unknown', 'nowhere'); null when the list cannot be
 * read, then the first id goes.
 */
export function sideSessionOf(who, chats, whereOf = null) {
  const name = String(who ?? '').trim()
  const ids = chats?.[name.toLowerCase()] ?? []
  if (ids.length === 0) return { why: `${name} is not known to the board (no app id in ${SIDE_CHATS_FILE})` }
  if (typeof whereOf !== 'function') return { session: ids[0] }
  const where = ids.map(id => [id, whereOf(id)])
  const here = where.find(([, place]) => place === 'here') ?? where.find(([, place]) => place === 'unknown')
  if (here !== undefined) return { session: here[0] }
  return where.some(([, place]) => place === 'elsewhere')
    ? { why: `${name}'s app id is of another account than the board's` }
    : { why: `${name} is not in the app's chat list` }
}

/** The word's text: it names the board, who waits, on what, since when, and that the person is asked next. */
export const sideWordText = ({ worker, step, wait }) =>
  `The worker board: ${worker} waits for you on ${step} since ${hourMinute(wait.since)} (${wait.what}). Give it your answer, or tell it to go on without you; the person is asked in ${SIDE_ANSWER_MS / 60_000} minutes if it still waits.`

/**
 * The outbox word for a late side wait, `{ ... }` without id: with `session` it waits for a hand; with `why` it is the record of why
 * none went (state 'dropped', text '': the outbox log keeps only words with a text), so no word is tried again for this wait.
 * `overdue` (its card was showing already): the word goes, and the card stays.
 */
export function sideWordFor({ late, worker, wait, found, now, overdue = false }) {
  const head = { at: now, to: late.who, about: late.who, command: SIDE_WORD, key: sideKeyOf(late.id, wait), step: late.id, worker, ask: null, title: null, version: null, verdict: null, ...(overdue ? { keepCard: true } : {}) }
  if (typeof found?.session !== 'string') return { ...head, text: '', state: 'dropped', why: found?.why ?? `${late.who} is not known to the board`, closedAt: now }
  return { ...head, session: found.session, text: sideWordText({ worker, step: late.id, wait }), state: 'waiting' }
}

/**
 * F53 (b): the record that the person's card of a late wait with no word yet showed because a limit is full (`sideKeepOf`), `{ ... }`
 * without id: closed at once with that why and no text (no word of its wait: `sideWordOf` skips it), so the next word keeps the card.
 */
export const sideKeptFor = ({ late, worker, wait, now }) => sideWordFor({ late, worker, wait, found: { why: FULL_WHY }, now, overdue: true })

/**
 * F53 (b): what the delivering board writes down for a late wait whose card shows because a limit is full (`side.full`), so the card
 * stays until the one word went, a restart included: `{ word: id }` keepCard on the word still to go, `{ word: null }` a record of its
 * own (`sideKeptFor`); null when there is nothing to write (no such card, or the outbox has it: the word keeps its card, or `kept`).
 */
export function sideKeepOf({ side, word, kept = false }) {
  if (side?.full !== true) return null
  if (word === null || word === undefined) return kept === true ? null : { word: null }
  return word.keepCard === true ? null : { word: word.id }
}

/**
 * What a late wait (`late`, waitsOn.mjs `lateWaitOf`) is now, given its side word: `{ hold, due, overdue, note, full }`. `hold` true keeps
 * the person's card back; `due` true: no word for it yet, the board says one (`overdue`: its card shows already and stays); `note` what
 * the card adds (when the board asked, or why it did not); `full` the card shows because a limit is full (F53: the board writes that
 * down, `sideKeepOf`). `runningMs(from)` the board's running time since `from`, as the late wait counts it; `isFull` a limit is full;
 * `kept` the card showed before because a limit was full (`sideKeptOf`): the word goes overdue, so the card stays.
 */
export function sideStateOf({ late, word, runningMs, isFull = false, kept = false }) {
  const plain = { hold: false, due: false, overdue: false, note: null, full: false }
  if (!isAskedSide(late?.who)) return plain
  const who = late.who
  const notAsked = { ...plain, note: `the board did not ask ${who}: ${FULL_WHY}`, full: true }
  if (word === null || word === undefined) {
    if (isFull) return notAsked
    // No word yet: the board's next look says one. A wait late for longer (a board that only shows, or one just landed) keeps its card,
    // and so does one whose card showed while a limit was full (F53).
    const overdue = kept === true || runningMs(late.since) - late.limitMs >= SIDE_HAND_MS
    return { ...plain, hold: !overdue, due: true, overdue }
  }
  if (word.state === 'delivered' && Number.isFinite(word.deliveredAt)) {
    const asked = `the board asked ${who} at ${hourMinute(word.deliveredAt)}`
    if (runningMs(word.deliveredAt) >= SIDE_ANSWER_MS) return { ...plain, note: `${asked}; no answer in ${SIDE_ANSWER_MS / 60_000} min` }
    return word.keepCard === true ? { ...plain, note: asked } : { ...plain, hold: true }
  }
  // Chat 1's re-check c: a word that waited too long reads `expired` (store.mjs `outboxKnown`): the end of its hand window.
  if (word.state === 'expired' && !Number.isFinite(word.closedAt)) return isFull ? notAsked : { ...plain, note: `no hand sent the board's word to ${who} within ${SIDE_HAND_MS / 60_000} min` }
  if (['waiting', 'taken'].includes(word.state) || isRetryDue(word)) {
    if (isFull && word.state !== 'taken') return notAsked
    if (!(runningMs(word.at) < SIDE_HAND_MS)) return { ...plain, note: `no hand sent the board's word to ${who} within ${SIDE_HAND_MS / 60_000} min` }
    return word.keepCard === true ? { ...plain, note: `the board is asking ${who}` } : { ...plain, hold: true }
  }
  // B1394 (principle 16): the person's card names no file; the outbox record keeps the whole why.
  return { ...plain, note: `the board could not ask ${who}: ${plainWhy(word.why)?.replace(/ \(no app id in [^)]*\)$/, '') ?? word.state}` }
}

/**
 * The side words the board closes now, `[{ id, why }]`: one still to go (waiting, or failed and due for a retry) whose wait ended
 * (`liveKeys`, the keys of the waits that stand), or that had SIDE_HAND_MS of running time.
 */
export function sideClosesOf({ words, liveKeys, runningMs, isFull = false }) {
  const closes = []
  for (const word of Array.isArray(words) ? words : []) {
    // `expired` with no close yet: the store still holds it waiting (store.mjs `outboxKnown` only reads it so).
    const isLateWord = word?.state === 'expired' && !Number.isFinite(word.closedAt)
    if (word?.command !== SIDE_WORD || !(word.state === 'waiting' || isLateWord || isRetryDue(word))) continue
    if (!liveKeys.has(word.key)) closes.push({ id: word.id, why: 'its wait ended' })
    else if (isLateWord || runningMs(word.at) >= SIDE_HAND_MS) closes.push({ id: word.id, why: isFull ? FULL_WHY : word.state === 'failed' ? String(plainWhy(word.why) ?? STALE_SIDE_WHY) : STALE_SIDE_WHY })
  }
  return closes
}
