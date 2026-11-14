// F17 (chat 1's brief of 2026-11-14, .claude/plans/2026-11-14-f17-wakes-brief.md; the person's "Both (A + B)"): since the app's
// update of 08:10 (5.11492.5.0) auto mode refuses the Workers mod's own code calls of send_message too ("PreToolUse:mcp__ccd_session_mgmt__
// send_message hook error: Not run: in auto mode Claude Desktop doesn't run this tool when a plugin's own code calls it. Have Claude make
// the call."), so no hand can wake a sleeping chat by code. Only a model turn may send to another chat now. The refusal itself is never
// worked around (no mode or permission change, no other code path into send_message):
//
// A. While the refusal stands, a wake's message goes as ONE word for a model (`forModel`, as F5's set words for Main: no hand takes it)
//    to an awake board chat that is free and idle right now (chat 1's review of 2026-11-14, 1, 2, 14: a busy or asking chat would queue
//    it behind its turn and send a stale wake later); never the target, never a chat whose board link is gone or whose words a stop
//    holds. Its own mod types the word, only while its report is idle; its model makes the one send_message call. One word per wake
//    spell (the record's cap of one message attempt per spell); the attempt counts as sent once the carrier's turn on the word began,
//    and the target's own report is the verdict, as for any wake.
// B. Nobody free, or no carrier took the word in CARRY_DUE_MS: a scheduled courier (tools/wake-courier.md) asks the board for the wakes
//    due (POST /api/bridge/wakes-due), sends each and says so (POST /api/bridge/wakes-sent): each word is handed to it once. The board
//    counts on the courier only while it called lately (COURIER_ALIVE_MS); else the launch goes as before.
//
// The refusal is a fact the wake record keeps (`sendsRefusedSince`), lifted only by the daily probe's success: one hand send to a free
// chat, never a real wake.
//
// PURE: the server wires it (server.mjs `wakePass`, the take, the report, the hands route, the two bridge routes, Send again).

import { isAppId } from './hands.mjs'
import { stoppedOf } from './stopped.mjs'
import { PROBE_MS } from './work/effort.mjs'
import { isHolding } from './work/pause.mjs'

/** The app's refusal of a plugin's own send_message call, as the hands' results and the outbox hold it. */
export const SEND_REFUSED = /send_message hook error[\s\S]*(doesn't run this tool when a plugin's own code calls it|Have Claude make the call)/i
/** The refusal in plain words, for the record and the page (never the raw hook text). */
export const SEND_REFUSED_WHY = "the app no longer lets the board's code send to a chat"
/** The word's command. */
export const CARRY_COMMAND = 'wake-carry'
/** The addressee of a word no awake chat can carry: the scheduled courier's (no chat is named so; no take hands it out). */
export const COURIER = 'the courier'
/** A carrier's word not taken this long after it was written is the courier's too (its carrier went busy). */
export const CARRY_DUE_MS = 3 * 60_000
/**
 * A carried attempt's windows: not sent within CARRY_SEND_MS (a carrier's word from when it was made; the courier's from when the
 * courier took it, `heldAt`), or no report CARRY_VERDICT_MS after it was sent: failed. A word for the courier that it has not taken yet
 * waits COURIER_WAIT_MS: its run comes every 10 minutes.
 */
export const CARRY_SEND_MS = 10 * 60_000
export const CARRY_VERDICT_MS = 5 * 60_000
export const COURIER_WAIT_MS = 15 * 60_000
/** The board counts on the courier while it asked for wakes this recently (two of its runs and some). */
export const COURIER_ALIVE_MS = 25 * 60_000
/** The probe's line: one send from a hand to a free chat, once a day while the refusal stands. */
export const PROBE_LINE = 'The worker board checks whether its code may send messages again. Nothing to do: end this turn.'
/** The probe's job id. */
export const PROBE_JOB = /^send-probe:(\d{1,16})$/

const isTime = value => Number.isFinite(value)
/** Whether a why (an attempt's, a word's, an outcome's) is the app's refusal of a code send. */
export const isSendRefusal = why => SEND_REFUSED.test(String(why ?? ''))
/** The why as the record keeps it: the refusal in plain words, anything else as it came. */
export const plainWhy = why => (isSendRefusal(why) ? SEND_REFUSED_WHY : why)

/**
 * Whether the app refuses the hands' sends now, and since when: `{ since }` or null. The record's own fact (`sendsRefusedSince`, set by
 * every refused send, kept apart from the spells the record prunes: review 10), or the newest refusal the record's attempts or the
 * outbox's start and wake words show; it stands until the probe's send went (`sendsLiftedAt` after it). No clock lifts it (review 16).
 */
export function sendsRefusedOf(record, outbox = []) {
  const attempts = [...(record?.wakes?.values?.() ?? [])].flatMap(entries => entries.flatMap(entry => entry.attempts ?? [])).filter(one => one.path === 'message')
  const refusedAt = [
    record?.sendsRefusedSince,
    ...attempts.filter(one => one.verdict === 'failed' && (one.refused === true || isSendRefusal(one.why))).map(one => (isTime(one.verdictAt) ? one.verdictAt : one.at)),
    ...(outbox ?? []).filter(one => ['start', 'wake'].includes(one?.command) && one.state === 'failed' && isSendRefusal(one.why)).map(one => (isTime(one.failedAt) ? one.failedAt : one.at)),
  ].filter(isTime)
  if (refusedAt.length === 0) return null
  const since = Math.max(...refusedAt)
  if (isTime(record?.sendsLiftedAt) && record.sendsLiftedAt >= since) return null
  return { since }
}

/** A refused send seen (`at`): the record keeps it as its fact. True when it changed. */
export function noteSendRefused(record, at) {
  if (!isTime(at) || (isTime(record.sendsRefusedSince) && record.sendsRefusedSince >= at)) return false
  record.sendsRefusedSince = at
  return true
}

/** The probe's send went (the app ran a hand's call again): the refusal is lifted. */
export function noteSendLifted(record, at) {
  if (!isTime(at)) return false
  record.sendsLiftedAt = at
  record.sendsRefusedSince = null
  return true
}

/** Whether the daily probe is due: the refusal stands and PROBE_MS passed since it, and since the last probe. */
export function probeDue(record, outbox, now) {
  const refused = sendsRefusedOf(record, outbox)
  if (refused === null || !isTime(now)) return false
  return now - Math.max(refused.since, isTime(record?.probeAt) ? record.probeAt : -Infinity) >= PROBE_MS
}

/**
 * Chat 1's verifier of 2026-11-14: F17 lands in two. Landing 1 is B (the courier) with the refusal's parts; A (a free chat's model carries the
 * wake) stays off until its fixes land (landing 2): no carry word goes to a chat. On only for a board copy that tests A
 * (WORKER_BOARD_CARRY_BY_MODEL=1) and for the tests that pass `byModel`.
 */
export const CARRY_BY_MODEL = process.env.WORKER_BOARD_CARRY_BY_MODEL === '1'

/** Chat 1's point 1 (2026-11-14): a carrier's mod reported this recently: a running chat whose mod the CLI unloaded keeps its process but stops
 * reporting, and a word to it never reaches its model. */
export const CARRIER_REPORT_MS = 60_000
/**
 * A chat that can carry now: on the board, running, joined (the board follows its session), not being removed or suspended, with its app
 * id; its mod reported within CARRIER_REPORT_MS, and that report is idle (review 1, 2: the take types a word into a busy chat's queue);
 * free (review 14: never interrupted, waiting on an ask, or working); no stop holds its words (review 9: its take hands out nothing).
 */
export const canCarry = (lane, target, now, outbox = []) => lane !== null && lane !== undefined && lane.name !== target && lane.isLeftover !== true && lane.isRunning === true
  && isTime(now) && isTime(lane.report?.at) && now - lane.report.at <= CARRIER_REPORT_MS && lane.report.state === 'idle' && lane.report.background !== true
  && lane.state === 'free' && (lane.unjoined ?? null) === null && !isTime(lane.removedAt) && lane.removal?.isOpen !== true && (lane.suspended ?? null) === null
  && isAppId(lane.appSession) && stoppedOf(outbox, lane) === null

/**
 * Who carries a wake of `target`: the first chat that can carry now (`canCarry`), the main chat first when it can. `lanes` the chats that
 * may carry (server.mjs leaves out the helper and the Product owner, as `wakerOrder` does). The lane, or null (then the courier, if alive).
 */
export function carrierOf(lanes, { target, main = null, now, outbox = [], byModel = CARRY_BY_MODEL } = {}) {
  if (byModel !== true) return null
  return freeChatOf(lanes, { target, main, now, outbox })
}

/** A chat that is free and idle now (`canCarry`), the main chat first, or null: the probe's addressee, and A's carrier. */
export function freeChatOf(lanes, { target, main = null, now, outbox = [] } = {}) {
  const able = (lanes ?? []).filter(lane => canCarry(lane, target, now, outbox))
  return able.find(lane => lane.name === main) ?? able[0] ?? null
}

/** Whether the courier asked for wakes lately (`lastAt`, when it last called wakes-due). */
export const courierAlive = (lastAt, now) => isTime(lastAt) && isTime(now) && now - lastAt <= COURIER_ALIVE_MS

/** The words the carrier's model reads: the one tool call, with the target's app session id and the wake's own text; then the turn ends. */
export const carryText = (target, session, text) => `Wake ${target} for the worker board: the app no longer lets the board's code send to a chat, so make this one call yourself: send_message with session_id "${session}" and message "${text}". Then end this turn; do nothing else.`

/**
 * The word for one wake (`need`: wakeNeeds's `{ chat, spell, appSession, text }`): to the carrier's chat, or the courier's (no carrier).
 * `forModel`: no hand takes it (src/hands.mjs `isHandWord`); its id is the record's job id of the attempt. `of`: the start or wake word it
 * carries (review 8), for a chat that runs (no spell, no attempt).
 */
export function carryWord({ id, at, need, carrier, of = null }) {
  return {
    id, at, to: carrier ?? COURIER, command: CARRY_COMMAND, about: need.chat, forModel: true, spell: need.spell ?? null, session: need.appSession,
    wakeText: need.text, text: carryText(need.chat, need.appSession, need.text), state: 'waiting', ...(of === null ? {} : { of }),
  }
}

/** Whether a word is a carry word. */
export const isCarryWord = message => message?.command === CARRY_COMMAND

/**
 * The chats a carry word is open for (waiting or taken): never a second word beside it. F17 check 1: a word that carries a start or wake word
 * (`of`) holds off only another such word (`ofWords`), never a wake need's word, Send again or the launch.
 */
export const carriedChats = (outbox, { ofWords = false } = {}) => new Set((outbox ?? []).filter(one => isCarryWord(one) && ['waiting', 'taken'].includes(one.state) && (typeof one.of === 'string') === ofWords).map(one => one.about))

/**
 * The courier's candidates (B): the waiting carry words it may take now: those addressed to it, those a carrier did not take within
 * CARRY_DUE_MS, or any when no chat runs (`anyRuns` false). Never a taken word: each goes to the courier once (review 17); the server
 * checks the record and the target too, and takes each in the same step (review 6, 12).
 */
export function dueOf(outbox, now, { anyRuns = true } = {}) {
  return (outbox ?? []).filter(message => isCarryWord(message) && message.state === 'waiting'
    && (message.to === COURIER || !anyRuns || (isTime(message.at) && now - message.at >= CARRY_DUE_MS)))
}

/** The courier's entry of a word. */
export const dueEntry = message => ({ id: message.id, chat: message.about, session: message.session, text: message.wakeText })

/**
 * What becomes of the carry words still open (`waiting` or `taken`), `[{ id, state, why, giveBack }]`:
 * - the target woke: delivered when its attempt was sent, else dropped "woke by itself" (review 5);
 * - the target runs again, or is gone: dropped; the attempt failed: dropped;
 * - a word that carries a start or wake word of a running chat (`of`, no attempt): dropped once that word is closed;
 * - a carrier that can no longer carry before it took the word: dropped, and its attempt given back (no try spent; the next pass picks
 *   another), which the server does only when the close applied (review 21).
 * `lanes` the board's lanes; `attemptOf(word)` the record's attempt of the word (its job id), or null.
 */
export function carryCloses({ outbox, lanes, attemptOf, now, paused = false }) {
  const out = []
  const laneOf = name => (lanes ?? []).find(lane => lane.name === name) ?? null
  for (const message of (outbox ?? []).filter(one => isCarryWord(one) && ['waiting', 'taken'].includes(one.state))) {
    const target = laneOf(message.about)
    const carrierGone = message.state === 'waiting' && message.to !== COURIER && !canCarry(laneOf(message.to), message.about, now, outbox)
    if (typeof message.of === 'string') {
      if (paused && message.state === 'waiting') {
        out.push({ id: message.id, state: 'dropped', why: 'held back while you pause the chats', giveBack: false })
        continue
      }
      // F17 check 1: one its carrier (the courier) took and never said it sent has the verdict's window, then it is closed.
      if (message.state === 'taken' && isTime(message.takenAt) && isTime(now) && now - message.takenAt >= CARRY_VERDICT_MS) {
        out.push({ id: message.id, state: 'dropped', why: `${message.takenBy === COURIER ? 'the courier' : message.to} did not say it sent it`, giveBack: false })
        continue
      }
      const carried = (outbox ?? []).find(one => one.id === message.of)
      if (target === null || carried === undefined || carried.state !== 'waiting') out.push({ id: message.id, state: 'dropped', why: target === null ? `${message.about} is no longer on the board` : 'the word it carried is closed', giveBack: false })
      else if (carrierGone) out.push({ id: message.id, state: 'dropped', why: `${message.to} can no longer carry it`, giveBack: false })
      continue
    }
    const attempt = attemptOf(message)
    // Verifier 6, 10: the person pauses: a word still waiting goes back with its attempt (no try spent); the next pass after the resume plans it again.
    if (paused && message.state === 'waiting' && attempt !== null && attempt.verdict === null) {
      out.push({ id: message.id, state: 'dropped', why: 'held back while you pause the chats', giveBack: true })
      continue
    }
    if (attempt?.verdict === 'woke') out.push(isTime(attempt.sentAt) && attempt.self !== true ? { id: message.id, state: 'delivered', why: `${message.about} woke`, giveBack: false } : { id: message.id, state: 'dropped', why: `${message.about} woke by itself`, giveBack: false })
    else if (target === null || target.isRunning === true) out.push({ id: message.id, state: 'dropped', why: target === null ? `${message.about} is no longer on the board` : `${message.about} runs again`, giveBack: false })
    else if (attempt === null || attempt.verdict === 'failed') out.push({ id: message.id, state: 'dropped', why: 'its wake attempt ended without it', giveBack: false })
    else if (carrierGone) out.push({ id: message.id, state: 'dropped', why: `${message.to} can no longer carry it`, giveBack: true })
  }
  return out
}

/** Verifier 6, 10: the person pauses (or the resume runs): carry words wait no more, nothing goes to the courier. */
// F17 check 3: only while the person pauses; while Resume all runs the wakes go (the resume list is a need).
export const carryPaused = pause => isHolding(pause)

/**
 * Verifier 8 (review 21): how a close applies to a word whose state was `was` right before it: 'close' (a waiting word, the only way a
 * give-back goes), 'update' (a taken word delivered), 'closeTaken' (a taken word dropped), or null (nothing: a give-back for a word a
 * take made its carrier's meanwhile, or a word already closed).
 */
export const closeWay = (close, was) => (was === 'waiting' ? 'close' : close.giveBack || was !== 'taken' ? null : close.state === 'delivered' ? 'update' : 'closeTaken')

/**
 * Review 1, 2: whether a carrier's turn on its taken carry word began: its report is busy on that word, or on a turn that began after the
 * take (the mod types the word only into an idle chat, so the next turn is the word's).
 */
export const carryTurnBegan = (word, report) => report != null && report.state === 'busy' && isTime(word?.takenAt)
  && (report.word === word.id || (isTime(report.turn) && report.turn >= word.takenAt))
