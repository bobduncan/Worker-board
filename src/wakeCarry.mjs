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
// B1271 (X203, 2026-11-19): the app refuses the hands of a chat in auto mode, not every hand. A refused send marks its own hand
// (`refusedHands`, `noteHandRefused`), which gets no send job until its own send went; it is the board's refusal only when no hand's send
// went since the last lift. A refused send spends no message try of the spell (src/wake.mjs `nextPath`): another hand that may send takes
// it, else a carry word (when every hand that claims is refused), and the launch only when none can. The refusal is never worked around.
//
// F59 (2026-11-24): no hand at all (every board chat's process ended, or none claimed in the hands' window) is carried as the refusal is,
// while the courier calls (`carryingOf`, `courierSends`): one courier word per wake at once, the launch only after its try failed, and a
// failed launch's spell gets the courier's word at its next call (its message path is still untried). Its review (chat 1, 2026-11-24):
// "no hands" only after NO_HANDS_MS of quiet; a hand that may send and comes back takes back the courier's words not yet taken; a start or
// wake word in doubt is never carried; the courier waits as long as the board counts on it (COURIER_WAIT_MS).
//
// PURE: the server wires it (server.mjs `wakePass`, the take, the report, the hands route, the two bridge routes, Send again).

import { heardTimeOf } from './chatReport.mjs'
import { isAppId } from './hands.mjs'
import { isInDoubt } from './store.mjs'
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
/** The board counts on the courier while it asked for wakes this recently (two of its runs and some). */
export const COURIER_ALIVE_MS = 25 * 60_000
/**
 * F59 review 6 (chat 1, 2026-11-24): as long as the board counts on the courier: one run it missed (a gap of 15-25 minutes) no longer
 * spends the spell's message try untaken.
 */
export const COURIER_WAIT_MS = COURIER_ALIVE_MS
/**
 * F59 review 2: no hand is "no hands" for the courier only after this quiet: a live hand holds a call up to two minutes (the Workers
 * mod's HAND_CALL_MS) and claims every 20 seconds, so a hand pausing just over HANDS_GONE_MS is no hand gone (src/hands.mjs HAND_HOLD_MS).
 */
export const NO_HANDS_MS = 3 * 60_000
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
  // B1271 (X203): once a probe lifted the refusal, the record's own fact is the only truth: a later refusal is one hand's (`noteHandRefused`
  // decides whether it is the whole board's), never revived from an attempt or an outbox line.
  // B1279 (X205): and never the board's when a hand's own send went since the lift (`handWentAt`): a fact written before B1271 kept
  // no `handSentAt`, and one auto-mode hand's refusal at 20:29 stopped every hand's start and wake for a day.
  if (isTime(record?.sendsLiftedAt)) return isTime(record?.sendsRefusedSince) && record.sendsRefusedSince > record.sendsLiftedAt && !handWentSinceLift(record) ? { since: record.sendsRefusedSince } : null
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
  // B1271: the probe's send is a hand's send that went.
  if (!(isTime(record.handSentAt) && record.handSentAt >= at)) record.handSentAt = at
  return true
}

/**
 * B1271 (X203, 2026-11-19): the refusal is a hand's, not the board's. At 20:16 the probe lifted it and Main's hands sent at 20:17 and 20:20;
 * at 20:29 Worker 3's hands (a chat in auto mode) were refused, and that one refusal stopped every hand again until the next day's probe.
 * Now a refused send marks its hand (`refusedHands`): that hand gets no message, start or wake job until its own send went (its probe,
 * once a day). The board-wide refusal (F17's carry words) follows only when no hand's send went since the last lift (`handSentAt`): the
 * first refusal after the app's update of 2026-11-14 08:10 stays the whole board's. True when the record changed.
 */
export function noteHandRefused(record, hand, at) {
  if (!isTime(at)) return false
  let changed = false
  if (typeof hand === 'string' && hand !== '' && hand !== COURIER) {
    const marks = record.refusedHands ?? {}
    if (!(isTime(marks[hand]) && marks[hand] >= at)) {
      record.refusedHands = { ...marks, [hand]: at }
      changed = true
    }
  }
  return (!handWentSinceLift(record) && noteSendRefused(record, at)) || changed
}

/**
 * B1307 (chat 1, 2026-11-21): a hand's send the app refused that is no wake (a side word): it marks that hand alone, never the board's
 * refusal (X205), and no wake attempt counts it. True when the mark changed.
 */
export function noteHandRefusedAlone(record, hand, at) {
  if (!isTime(at) || typeof hand !== 'string' || hand === '' || hand === COURIER) return false
  const marks = record.refusedHands ?? {}
  if (isTime(marks[hand]) && marks[hand] >= at) return false
  record.refusedHands = { ...marks, [hand]: at }
  return true
}

/**
 * B1279 (X205): when a hand's own code send last went, or null: the record's `handSentAt`, or else the newest message attempt a hand sent
 * (`sentAt` set: its hand said ok; never a carried one, whose `sentAt` is its carrier's turn, nor a refused one). The live record of
 * 2026-11-19 had Main's sends of 20:17 and 20:20 as attempts only: B1271, which writes `handSentAt`, landed at 22:41.
 */
export function handWentAt(record) {
  let newest = isTime(record?.handSentAt) ? record.handSentAt : null
  for (const entries of record?.wakes?.values?.() ?? []) {
    for (const entry of entries ?? []) {
      for (const one of entry.attempts ?? []) {
        if (one.path !== 'message' || one.carry != null || one.refused === true || !isTime(one.sentAt)) continue
        if (newest === null || one.sentAt > newest) newest = one.sentAt
      }
    }
  }
  return newest
}

/**
 * B1279 (chat 1's review, minor): the proof `handWentAt` reads from the attempts is kept as the record's own fact (`handSentAt`), as the
 * record prunes the attempts (6 spells a chat), so the board-wide refusal never comes back once they are gone. True when it changed.
 */
export function keepHandWent(record) {
  const went = handWentAt(record)
  if (went === null || (isTime(record?.handSentAt) && record.handSentAt >= went)) return false
  record.handSentAt = went
  return true
}

/** B1279: whether a hand's own send went since the last lift: then a refusal after it is that hand's alone (B1271), never the board's. */
const handWentSinceLift = record => {
  const went = handWentAt(record)
  return isTime(record?.sendsLiftedAt) && went !== null && went >= record.sendsLiftedAt
}

/** B1271: a hand's send went (`hand`, at `at`): its own refusal is lifted, and the record knows a hand may send. True when it changed. */
export function noteHandSent(record, hand, at) {
  if (!isTime(at)) return false
  let changed = false
  if (!(isTime(record.handSentAt) && record.handSentAt >= at)) {
    record.handSentAt = at
    changed = true
  }
  if (typeof hand === 'string' && isTime(record.refusedHands?.[hand])) {
    const { [hand]: _gone, ...rest } = record.refusedHands
    record.refusedHands = rest
    changed = true
  }
  return changed
}

/** B1271: whether the app refused this hand's sends and none of its own went since. */
export const handRefused = (record, hand) => typeof hand === 'string' && isTime(record?.refusedHands?.[hand])

/**
 * Whether the daily probe is due: the refusal stands and PROBE_MS passed since it, and since the last probe. B1271: with `hand`, also for
 * that hand alone while only its own refusal stands (PROBE_MS since its mark, and since its last probe, `probeBy`).
 */
export function probeDue(record, outbox, now, hand = null) {
  if (!isTime(now)) return false
  const refused = sendsRefusedOf(record, outbox)
  if (refused !== null) return now - Math.max(refused.since, isTime(record?.probeAt) ? record.probeAt : -Infinity) >= PROBE_MS
  if (!handRefused(record, hand)) return false
  const probed = record.probeBy?.[hand]
  return now - Math.max(record.refusedHands[hand], isTime(probed) ? probed : -Infinity) >= PROBE_MS
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
 * F38 (B1300): "reported" by the report's own time (`heardTimeOf`): a kept report moved to the board's start is no proof its mod lives.
 */
export const canCarry = (lane, target, now, outbox = []) => lane !== null && lane !== undefined && lane.name !== target && lane.isLeftover !== true && lane.isRunning === true
  && isTime(now) && isTime(heardTimeOf(lane.report)) && now - heardTimeOf(lane.report) <= CARRIER_REPORT_MS && lane.report.state === 'idle' && lane.report.background !== true
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

/**
 * F59 (2026-11-24, chat 1's spec): at 10:23 the app relaunched itself and every board chat's process ended; no hand ran, the board
 * launched five chats (10:24-10:44, all "the app did not start it") and the courier, calling at 10:28, 10:34, 10:48 and 10:58, got an
 * empty list: it got carry words only while the hands' sends were refused. Now no hand at all (`gone`, opener.mjs `handsGone`: none
 * claimed in the hands' window) is carried as a refusal is, while the courier calls (`courierSends`): every wake due goes to it as ONE
 * carry word at once, and the courier is the wakes' sender, so the launch (the board-wide one too) waits until its try failed.
 * Review 2: the server passes `gone` as the quiet of NO_HANDS_MS for the words, and as HANDS_GONE_MS's for the launch's wait (between the
 * two the launch waits for a hand that may be back, or the courier's words).
 */
export const courierSends = ({ gone = false, courierAt = null, now }) => gone === true && courierAlive(courierAt, now)

/**
 * F59 re-check a (chat 1, 2026-11-24): whether no hand at all answers the board's wake-ups now, for "nobody answers the board's wake-ups"
 * and the rule nobody-answers-wakes: no hand that may send claims (`senders`), and none is only in a long round (gone from the hands'
 * window, HANDS_GONE_MS, but not NO_HANDS_MS quiet yet: one slow send). Hands that claim, all refused (not gone), are none, as before.
 */
export const noHandsOf = ({ senders = false, gone = false, quiet = false } = {}) => senders !== true && (quiet === true || gone !== true)

/**
 * What the wake pass carries words for, `{ since }` or null: the app's refusal of the hands' sends (`refused`, `sendsRefusedOf`), every
 * hand that claims refused (`allRefused`, B1271), or F59's no hand while the courier calls (`{ since, noHands: true }`).
 */
export function carryingOf({ refused = null, allRefused = false, gone = false, courierAt = null, now }) {
  if (refused !== null && refused !== undefined) return refused
  if (allRefused === true) return { since: now }
  return courierSends({ gone, courierAt, now }) ? { since: now, noHands: true } : null
}

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
    // What the wake is for (wakeNeeds's why: an envelope, the resume list, words, ...), for the log and the checks.
    ...(typeof need.why === 'string' ? { for: need.why } : {}),
  }
}

/** Whether a word is a carry word. */
export const isCarryWord = message => message?.command === CARRY_COMMAND

/**
 * Review 8: a waiting start or wake word of a chat that a carry word may carry (the carry pass's `of` words). F59 review 3: never one in
 * doubt (B891, `isInDoubt`): a hand's call that gave no answer may have sent it, and it is not tried again until its doubt ended.
 */
export const isCarriedWord = (message, now) => message?.state === 'waiting' && ['start', 'wake'].includes(message.command) && typeof message.about === 'string' && !isInDoubt(message, now)

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

/** F59 re-check b: the why of a courier word given back because the courier no longer calls (COURIER_ALIVE_MS). */
export const COURIER_GONE_WHY = 'the courier no longer calls: the launch may go'
/** F59 review 1: the why of a courier word a hand that came back takes over. */
export const HAND_BACK_WHY = 'a hand that may send is back: it sends the wake'

/**
 * What becomes of the carry words still open (`waiting` or `taken`), `[{ id, state, why, giveBack }]`:
 * - the target woke: delivered when its attempt was sent, else dropped "woke by itself" (review 5);
 * - the target runs again, or is gone: dropped; the attempt failed: dropped;
 * - a word that carries a start or wake word of a running chat (`of`, no attempt): dropped once that word is closed;
 * - a carrier that can no longer carry before it took the word: dropped, and its attempt given back (no try spent; the next pass picks
 *   another), which the server does only when the close applied (review 21).
 * `lanes` the board's lanes; `attemptOf(word)` the record's attempt of the word (its job id), or null.
 * F59 review 1: `handSends`, a hand that may send by code claims now: a word for the courier that it has not taken yet goes back (its
 * attempt given back unspent, so that hand takes the message in its claim); a word the courier took (held, sent) stays its own, and so
 * does one whose message a hand would not take over (`handTakes(word)`, wake.mjs `handMayTakeOver`: B1279's word after a hand's send that
 * brought no report goes to a model or the courier, never to a hand again).
 * F59 re-check b: `courierGone`, the courier no longer calls (`courierAlive` false): a word for it that it has not taken yet goes back too
 * (no try spent), so the launch is no longer held off by a word nobody comes for.
 */
export function carryCloses({ outbox, lanes, attemptOf, now, paused = false, handSends = false, handTakes = () => true, courierGone = false }) {
  const out = []
  const laneOf = name => (lanes ?? []).find(lane => lane.name === name) ?? null
  for (const message of (outbox ?? []).filter(one => isCarryWord(one) && ['waiting', 'taken'].includes(one.state))) {
    const target = laneOf(message.about)
    const carrierGone = message.state === 'waiting' && message.to !== COURIER && !canCarry(laneOf(message.to), message.about, now, outbox)
    const isHandsAgain = handSends === true && message.state === 'waiting' && message.to === COURIER
    const isCourierGone = courierGone === true && message.state === 'waiting' && message.to === COURIER
    if (typeof message.of === 'string') {
      if (paused && message.state === 'waiting') {
        out.push({ id: message.id, state: 'dropped', why: 'held back while you pause the chats', giveBack: false })
        continue
      }
      // Review 1: the start or wake word it carries is that hand's job again (no attempt to give back).
      if (isHandsAgain || isCourierGone) {
        out.push({ id: message.id, state: 'dropped', why: isHandsAgain ? HAND_BACK_WHY : COURIER_GONE_WHY, giveBack: false })
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
    if (isHandsAgain && attempt !== null && attempt.verdict === null && attempt.sentAt === null && !isTime(attempt.heldAt) && handTakes(message)) {
      out.push({ id: message.id, state: 'dropped', why: HAND_BACK_WHY, giveBack: true })
      continue
    }
    if (isCourierGone && attempt !== null && attempt.verdict === null && attempt.sentAt === null && !isTime(attempt.heldAt)) {
      out.push({ id: message.id, state: 'dropped', why: COURIER_GONE_WHY, giveBack: true })
      continue
    }
    if (attempt?.verdict === 'woke') out.push(isTime(attempt.sentAt) && attempt.self !== true ? { id: message.id, state: 'delivered', why: `${message.about} woke`, giveBack: false } : { id: message.id, state: 'dropped', why: `${message.about} woke by itself`, giveBack: false })
    else if (target === null || target.isRunning === true) out.push({ id: message.id, state: 'dropped', why: target === null ? `${message.about} is no longer on the board` : `${message.about} runs again`, giveBack: false })
    else if (attempt === null || attempt.verdict === 'failed') out.push({ id: message.id, state: 'dropped', why: 'its wake attempt ended without it', giveBack: false })
    else if (carrierGone) out.push({ id: message.id, state: 'dropped', why: `${message.to} can no longer carry it`, giveBack: true })
  }
  return out
}

/**
 * Chat 1's re-check of 2026-11-14, 1: while Resume all runs, the main chat's model sends the resume line to every holder on its list
 * (sends the board does not see). So a resume-list need gets no courier word and no launch for RESUME_GRACE_MS from the resume's start
 * while the main chat runs or its own wake is on its way (`mainCovers`); after it, the courier or the launch takes the holders that still
 * have not started. Without the main chat, the courier takes them at once.
 */
export const RESUME_GRACE_MS = CARRY_DUE_MS
export const mainCoversResume = (need, { pause, now, mainCovers = false }) => pause?.state === 'resuming' && need?.why === 'resume' && mainCovers === true
  && isTime(pause.since) && isTime(now) && now - pause.since < RESUME_GRACE_MS

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
