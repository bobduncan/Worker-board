// F17 (chat 1's brief of 2026-11-14, .claude/plans/2026-11-14-f17-wakes-brief.md; the person's "Both (A + B)"): since the app's
// update of 08:10 (5.11492.5.0) auto mode refuses the Workers mod's own code calls of send_message too ("PreToolUse:mcp__ccd_session_mgmt__
// send_message hook error: Not run: in auto mode Claude Desktop doesn't run this tool when a plugin's own code calls it. Have Claude make
// the call."), so no hand can wake a sleeping chat by code. Only a model turn may send to another chat now. The refusal itself is never
// worked around (no mode or permission change, no other code path into send_message):
//
// A. While the refusal stands, a wake's message goes as ONE word for a model (`forModel`, as F5's set words for Main: no hand takes it)
//    to an awake board chat: an idle one first, then the main chat, then any running one; never the target, never a chat whose board link
//    is gone. Its own mod types the word; its model makes the one send_message call. One word per wake spell (the record's cap of one
//    message attempt per spell); the target's own report is the verdict, as for any wake.
// B. Nobody awake, or no carrier took the word in CARRY_DUE_MS: a scheduled courier (tools/wake-courier.md) asks the board for the wakes
//    due (POST /api/bridge/wakes-due), sends each and says so (POST /api/bridge/wakes-sent): each word is carried once.
//
// PURE: the server wires it (server.mjs `wakePass`, the take, the two bridge routes).

import { isAppId } from './hands.mjs'
import { PROBE_MS } from './work/effort.mjs'

/** The app's refusal of a plugin's own send_message call, as the hands' results and the outbox hold it. */
export const SEND_REFUSED = /send_message hook error[\s\S]*(doesn't run this tool when a plugin's own code calls it|Have Claude make the call)/i
/** The refusal in plain words, for the record and the page (never the raw hook text). */
export const SEND_REFUSED_WHY = "the app no longer lets the board's code send to a chat"
/** The word's command. */
export const CARRY_COMMAND = 'wake-carry'
/** The addressee of a word no awake chat can carry: the scheduled courier's (no chat is named so; no take hands it out). */
export const COURIER = 'the courier'
/** A carrier's word not taken this long after it was written is the courier's too (a busy carrier). */
export const CARRY_DUE_MS = 3 * 60_000
/** A carried attempt's windows: not sent (typed or carried) within CARRY_SEND_MS, or no report CARRY_VERDICT_MS after: failed. */
export const CARRY_SEND_MS = 10 * 60_000
export const CARRY_VERDICT_MS = 5 * 60_000

const isTime = value => Number.isFinite(value)
/** Whether a why (an attempt's, a word's, an outcome's) is the app's refusal of a code send. */
export const isSendRefusal = why => SEND_REFUSED.test(String(why ?? ''))
/** The why as the record keeps it: the refusal in plain words, anything else as it came. */
export const plainWhy = why => (isSendRefusal(why) ? SEND_REFUSED_WHY : why)

/**
 * Whether the app refuses the hands' sends now, and since when: `{ since }` or null. The newest refusal (a message attempt of the wake
 * record failed on it, marked `refused` or with its raw text, or a start or wake word of the outbox that failed on it) stands until a
 * hand's message attempt made after it was sent (the hand's ok: the app ran the call), or PROBE_MS has passed: then the next wake goes
 * to a hand again, and that one job is the probe (F2's daily idea; no separate no-op send).
 */
export function sendsRefusedOf(record, outbox = [], now = Date.now()) {
  const attempts = [...(record?.wakes?.values?.() ?? [])].flatMap(entries => entries.flatMap(entry => entry.attempts ?? [])).filter(one => one.path === 'message')
  const refusedAt = [
    ...attempts.filter(one => one.verdict === 'failed' && (one.refused === true || isSendRefusal(one.why))).map(one => (isTime(one.verdictAt) ? one.verdictAt : one.at)),
    ...(outbox ?? []).filter(one => ['start', 'wake'].includes(one?.command) && one.state === 'failed' && isSendRefusal(one.why)).map(one => (isTime(one.failedAt) ? one.failedAt : one.at)),
  ].filter(isTime)
  if (refusedAt.length === 0) return null
  const since = Math.max(...refusedAt)
  // A hand's send after it went: its call ran (a carried attempt is a model's, and says nothing of the hands).
  if (attempts.some(one => one.carry == null && isTime(one.sentAt) && one.at > since)) return null
  if (!isTime(now) || now - since >= PROBE_MS) return null
  return { since }
}

const IDLE = ['free', 'idle']
/** Chat 1's point 1 (2026-11-14): a carrier's mod reported this recently: a running chat whose mod the CLI unloaded keeps its process but stops
 * reporting, and a word to it never reaches its model. */
export const CARRIER_REPORT_MS = 60_000
/** A chat that can carry: on the board, running, joined (the board follows its session), not being removed, with its app id. */
const canCarry = (lane, target, now) => lane !== null && lane !== undefined && lane.name !== target && lane.isLeftover !== true && lane.isRunning === true
  && isTime(now) && isTime(lane.report?.at) && now - lane.report.at <= CARRIER_REPORT_MS
  && (lane.unjoined ?? null) === null && !isTime(lane.removedAt) && lane.removal?.isOpen !== true && lane.state !== 'suspended' && (lane.suspended ?? null) === null
  && isAppId(lane.appSession)

/**
 * Who carries a wake of `target`: a running, idle board chat first (its own mod types the word at once), then the main chat, then any
 * running one (a busy one takes it at its next turn's end). Never the target itself, never a chat whose board link is gone, nor one whose mod has
 * not reported within CARRIER_REPORT_MS of `now`. The lane, or
 * null (then the courier).
 */
export function carrierOf(lanes, { target, main = null, now } = {}) {
  const able = (lanes ?? []).filter(lane => canCarry(lane, target, now))
  return able.find(lane => IDLE.includes(lane.state)) ?? able.find(lane => lane.name === main || lane.isMain === true) ?? able[0] ?? null
}

/** The words the carrier's model reads: the one tool call, with the target's app session id and the wake's own text. */
export const carryText = (target, session, text) => `Wake ${target} for the worker board: the app no longer lets the board's code send to a chat, so make this one call yourself, then go on with what you were doing: send_message with session_id "${session}" and message "${text}". Nothing else.`

/**
 * The word for one wake (`need`: wakeNeeds's `{ chat, spell, appSession, text }`): to the carrier's chat, or the courier's (no carrier).
 * `forModel`: no hand takes it (src/hands.mjs `isHandWord`); its id is the record's job id of the attempt.
 */
export function carryWord({ id, at, need, carrier }) {
  return {
    id, at, to: carrier ?? COURIER, command: CARRY_COMMAND, about: need.chat, forModel: true, spell: need.spell, session: need.appSession,
    wakeText: need.text, text: carryText(need.chat, need.appSession, need.text), state: 'waiting',
  }
}

/** Whether a word is a carry word. */
export const isCarryWord = message => message?.command === CARRY_COMMAND

/**
 * The courier's list (B): the carry words it may send now, `[{ id, chat, session, text }]`: those it holds already (taken by it, not yet
 * said sent: the call is idempotent), those addressed to it, and those a carrier did not take within CARRY_DUE_MS, or any waiting one when
 * no chat runs (`anyRuns` false). Never a word a carrier took (it carries it).
 */
export function dueOf(outbox, now, { anyRuns = true } = {}) {
  return (outbox ?? []).filter(message => isCarryWord(message) && (
    (message.state === 'taken' && message.takenBy === COURIER)
    || (message.state === 'waiting' && (message.to === COURIER || !anyRuns || (isTime(message.at) && now - message.at >= CARRY_DUE_MS)))
  )).map(message => ({ id: message.id, chat: message.about, session: message.session, text: message.wakeText }))
}

/**
 * What becomes of the carry words still open (`waiting` or `taken`), `[{ id, state, why, giveBack }]`: the target runs again (its spell
 * ended: woke by the word or by itself): closed; the attempt failed: closed; a carrier that can no longer carry (stopped, gone from the
 * board) before it took the word: closed and its attempt given back (no try spent; the next pass picks another carrier).
 * `lanes` the board's lanes; `attemptOf(word)` the record's attempt of the word (its job id), or null.
 */
export function carryCloses({ outbox, lanes, attemptOf, now }) {
  const out = []
  for (const message of (outbox ?? []).filter(one => isCarryWord(one) && ['waiting', 'taken'].includes(one.state))) {
    const target = (lanes ?? []).find(lane => lane.name === message.about) ?? null
    const attempt = attemptOf(message)
    if (attempt?.verdict === 'woke') out.push({ id: message.id, state: 'delivered', why: `${message.about} woke`, giveBack: false })
    else if (target === null || target.isRunning === true) out.push({ id: message.id, state: 'dropped', why: target === null ? `${message.about} is no longer on the board` : `${message.about} runs again`, giveBack: false })
    else if (attempt === null || attempt.verdict === 'failed') out.push({ id: message.id, state: 'dropped', why: 'its wake attempt ended without it', giveBack: false })
    else if (message.state === 'waiting' && message.to !== COURIER && !canCarry((lanes ?? []).find(lane => lane.name === message.to), message.about, now)) {
      out.push({ id: message.id, state: 'dropped', why: `${message.to} can no longer carry it`, giveBack: true })
    }
  }
  return out
}
