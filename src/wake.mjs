// Signals change 4, B908 (the lead's brief of 2026-11-02, "waking a chat is code only and honest"; the code check's
// Addendum of 15 decisions binds): one wake procedure with one record. Seen live 2026-11-02 10:32-11:08: the board
// launched five sleeping workers (`claude.exe --desktop --resume`) nine times, logged "started" each time, and nothing
// started; the hand-over bounced B855 from sleeper to sleeper every ten minutes, one incident per envelope (X119-X121);
// at 11:06:50 one message from a running chat (the Advisor's) woke Worker 5 in six seconds. Three paths woke a chat
// then (a start word, the hands' asleep and resume jobs, the opener's launch), each with its own counters and none with
// a verdict. Now:
//
// - ONE record per chat and spell (`data/wakes.json`, persisted as data/reports.json is): every attempt, its path, when,
//   by whom, when it was sent and its verdict. A spell is the chat's sleep: its `asleepSince` (an off chat without one:
//   its report's since, else the report's time). The reserved key "*" holds the board-wide "nobody runs" spells.
// - Message first (a hand job through any running chat's Workers mod: code, no model turn), launch only when no sender
//   claims, or after the message failed; one attempt per path per spell (decision 8), never two pending at once.
// - A verdict only from the woken chat's own report: a report newer than the attempt with a new `run` (the mod's
//   process) is "woke"; nothing within 2 minutes of the send is "failed". A launch is never a verdict.
// - "could not wake X" once per spell, with what was tried and when (decision 6), in place of three older texts.
//
// PURE: every fact is passed in, `now` included; the server wires it (server.mjs `wakePass`, the hands route, the take).
// The functions that change the record (`claim`, `sent`, ...) change it in place, synchronously, so the server claims an
// attempt in the same tick it makes the job (the code check's "two carriers" risk).

import { ASLEEP_LINE, isAppId } from './hands.mjs'
import { boardLanes, isWakeWord, wakeWordOf, wakerOrder } from './say.mjs'
import { envelopesOf } from './work/handover.mjs'
import { isHolding } from './work/pause.mjs'
import { moveInPlace, readKept, stampOf, writeUnflushed } from './write.mjs'

/** A wake attempt sent this long ago without the woken chat's report is failed. */
export const WAKE_VERDICT_MS = 2 * 60_000
/**
 * An attempt not sent this long after it was claimed is failed too (principle 2: never wait for ever): a hand whose
 * process ended while it held the job (its give-back never came), or a launch the board's own restart cut off. The
 * hands give a job back themselves after two minutes without the app's answer (the Workers mod's HAND_CALL_MS), so
 * this is the same three minutes as B880's HAND_HOLD_MS.
 */
export const WAKE_SEND_MS = 3 * 60_000
/** At most this many spells are kept per chat: the older ones are the pattern the brief asks for ("record each occurrence"). */
export const WAKE_SPELLS_KEPT = 6
/** How long after a change the file is written (as reports.json). */
export const WAKES_SAVE_MS = 1000
/** The id of a wake job, `wake:<spell>:<chat>`. */
export const WAKE_JOB = /^wake:(\d{1,16}):(.{1,200})$/
export const wakeJobId = (spell, chat) => `wake:${spell}:${chat}`
/** The record's key for the board-wide spell ("nobody runs since HH:MM", decision 14). */
export const BOARD_KEY = '*'
/** The plain line of a wake message: the words come in with the chat's next take (decision 12: no take line then). */
export const WORDS_LINE = 'The worker board holds words for you: run work next'
/** The take line of a wake message for a given task (decision 4: board-only, the hands type `job.text` as it is). */
export const takeLine = step => `take ${step} in this turn: run work next`
/** The states of a wake still on its way: the hand-over's net does not run for them (decision 10). */
export const WAKE_PENDING = ['waiting-sender', 'on-its-way', 'sent', 'launched']

/** A chat's CLI session id as the app's list holds it: a UUID, and nothing else ever reaches the launch (opener.mjs re-exports it). */
export const isSessionId = session => typeof session === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session)

const isTime = value => Number.isFinite(value)

/** The record: `{ wakes: Map<chat, spellEntry[]> }`, newest spell last. */
export const emptyWakes = () => ({ wakes: new Map() })

/**
 * The spell of a lane that does not run: its `asleepSince`; an off chat without one, its report's since when its
 * session ended, else its report's time; one that never reported, 0 (the review of 2026-11-02: not its last activity,
 * which the wake message itself moves, so the cap of one try per path would reset). Null when the lane runs, or the board
 * does not know (principle 3: `isRunning` null is not guessed).
 */
export function spellOf(lane) {
  if (lane === null || lane === undefined || lane.isRunning !== false) return null
  if (isTime(lane.asleepSince)) return lane.asleepSince
  // A chat the board read Not running once a wake did not take (chatReport.mjs "woken") keeps its sleep's since.
  if (isTime(lane.sleepSince)) return lane.sleepSince
  const report = lane.report ?? null
  if (report?.state === 'ended' && isTime(report.since)) return report.since
  if (isTime(report?.at)) return report.at
  return 0
}

const entriesOf = (record, chat) => record?.wakes?.get(chat) ?? []
const newestOf = (record, chat) => entriesOf(record, chat).at(-1) ?? null
const entryOf = (record, chat, spell) => (spell === null || spell === undefined ? newestOf(record, chat) : entriesOf(record, chat).findLast(one => one.spell === spell) ?? null)
const isPending = attempt => attempt.verdict === null

/**
 * A new spell entry for `chat` when its newest is of another spell (life came, or a new sleep began); the server calls it
 * from its pass with each lane's `spellOf`, and `claim` does before the first attempt. True when one was added.
 */
export function newSpell(record, chat, spell) {
  if (!isTime(spell) || typeof chat !== 'string' || chat === '') return false
  // The review of 2026-11-02: a spell value a kept entry already has (A, B, then A again) is that entry, never a new one:
  // the cap of one try per path holds for it.
  if (entriesOf(record, chat).some(one => one.spell === spell)) return false
  const entries = [...entriesOf(record, chat), { spell, attempts: [], turnEndedAt: null, told: { failed: false, nobody: false } }]
  record.wakes.set(chat, entries.slice(-WAKE_SPELLS_KEPT))
  return true
}

/**
 * Decision 8, as the next path for this chat's spell: 'message' when no message was tried in it and a sender claims;
 * 'launch' when no launch was tried in it and (no sender claims, or the message failed); after both failed, 'message'
 * once more only for a new sender (`senderSince`, when the claiming chat began to claim, after the message's verdict);
 * null otherwise (one is on its way, the chat woke, or every path is spent). `paths` the ones its ids allow ('message'
 * with an app id, 'launch' with a CLI session id on a board that can launch).
 */
export function nextPath(record, { chat, spell, senderClaims, senderSince = -Infinity, paths = ['message', 'launch'] }) {
  const attempts = entryOf(record, chat, spell)?.attempts ?? []
  if (attempts.some(one => isPending(one) || one.verdict === 'woke')) return null
  const messages = attempts.filter(one => one.path === 'message')
  const launches = attempts.filter(one => one.path === 'launch')
  const mayMessage = senderClaims === true && paths.includes('message')
  if (mayMessage && messages.length === 0) return 'message'
  if (paths.includes('launch') && launches.length === 0 && (senderClaims !== true || messages.some(one => one.verdict === 'failed'))) return 'launch'
  // "then stop until life, the person, or a new sender": a chat that began to claim after the last message failed.
  const lastMessage = messages.at(-1)
  if (mayMessage && messages.length === 1 && lastMessage.verdict === 'failed' && isTime(lastMessage.verdictAt) && senderSince > lastMessage.verdictAt) return 'message'
  return null
}

/**
 * Claims an attempt for `chat`'s spell, synchronously, before the job is made (or the launch awaited): the attempt, or
 * false when `nextPath` does not give this path now (one attempt per path per spell, never two pending at once).
 * `runBefore` the chat's report's `run` at the attempt; `by` the hand's chat for a message, 'board' for a launch.
 */
export function claim(record, { chat, spell, path, by, jobId, now, runBefore = null, senderSince = -Infinity, paths = ['message', 'launch'], step = null }) {
  if (!['message', 'launch'].includes(path) || !isTime(spell) || !isTime(now)) return false
  if (nextPath(record, { chat, spell, senderClaims: path === 'message', senderSince, paths: path === 'message' ? ['message'] : ['launch'] }) !== path) return false
  newSpell(record, chat, spell)
  const entry = entryOf(record, chat, spell)
  if (entry === null) return false
  // `step`: the step whose take line the message carries (wakeNeeds case 1 or 5), so the envelope's own line is not typed
  // a second time (`wakeCarriedTake`); null for any other text.
  const attempt = { path, at: now, by: String(by ?? (path === 'launch' ? 'board' : '')), jobId: String(jobId ?? ''), sentAt: null, runBefore: runBefore ?? null, verdict: null, verdictAt: null, why: null, step: typeof step === 'string' && /^[A-Z]\d{1,6}$/.test(step) ? step : null }
  entry.attempts.push(attempt)
  return attempt
}

/**
 * X107 and X3 again (2026-11-02 14:45-15:13, Workers 5 and 2): the wake message carried the take line ("take B916 in this
 * turn: run work next") and the chat took B916 in that turn; its envelope's own line ("work: B916 is yours; run work next"),
 * handed at its first take, waited behind the running turn and was submitted after the step was reported, starting a stale
 * turn in which the owed clear failed twice. Whether `chat`'s newest spell woke by a message that carried the take line of
 * `step`: then the envelope's line is waived at the hand-out (handoverBoard.mjs `handOut`); the chat was told once.
 */
export function wakeCarriedTake(record, chat, step) {
  if (typeof step !== 'string') return false
  const entry = newestOf(record, chat)
  return entry !== null && entry.attempts.some(one => one.path === 'message' && one.verdict === 'woke' && one.step === step)
}

/**
 * T22 (the goal chat's wait line, 2026-11-02: the person's "Send again" click on a chat the board could not wake): ONE
 * new attempt on the person's word, outside the per-path cap of decision 8, only while no attempt of that spell is
 * pending (a click during a wake changes nothing). It is counted in the record as any attempt (`again: 'person'`) and
 * gets its verdict by the same rules (`sent`, `heard`, `pass`). The attempt, or false.
 */
export function personAgain(record, { chat, spell, path, by, jobId, now, runBefore = null }) {
  if (!['message', 'launch'].includes(path) || !isTime(spell) || !isTime(now) || typeof chat !== 'string' || chat === '') return false
  newSpell(record, chat, spell)
  // Only the chat's newest spell (the goal chat's wait-line test, 2026-11-02: spells A, B, then A again put the attempt in
  // the older entry A, which the hands route never reads, so the message was never handed out and failed after 3 min).
  const entry = newestOf(record, chat)
  if (entry === null || entry.spell !== spell || entry.attempts.some(isPending)) return false
  const attempt = { path, at: now, by: String(by ?? (path === 'launch' ? 'board' : '')), jobId: String(jobId ?? ''), sentAt: null, runBefore: runBefore ?? null, verdict: null, verdictAt: null, why: null, again: 'person' }
  entry.attempts.push(attempt)
  return attempt
}

/** The pending attempt of `chat` with this job id, newest spell first, or null. */
function pendingOf(record, chat, jobId) {
  for (const entry of [...entriesOf(record, chat)].reverse()) {
    const found = entry.attempts.findLast(one => isPending(one) && one.jobId === jobId)
    if (found !== undefined) return found
  }
  return null
}

/** The hand said ok (a message), or PowerShell ended well (a launch): the 2 minutes count from now. The attempt, or null. */
export function sent(record, chat, jobId, now) {
  const attempt = pendingOf(record, chat, jobId)
  if (attempt !== null && attempt.sentAt === null) attempt.sentAt = now
  return attempt
}

/** The hand could not send it, or the launch failed: failed now, with why. The attempt, or null. */
export function failedToSend(record, chat, jobId, why, now) {
  const attempt = pendingOf(record, chat, jobId)
  if (attempt === null) return null
  attempt.verdict = 'failed'
  attempt.verdictAt = now
  attempt.why = String(why ?? 'not sent').replace(/\s+/g, ' ').trim().slice(0, 200) || 'not sent'
  return attempt
}

/** The hand gave the job back unsent (B880: no try spent): the attempt is erased. True when one was. */
export function givenBack(record, chat, jobId) {
  for (const entry of entriesOf(record, chat)) {
    const index = entry.attempts.findIndex(one => isPending(one) && one.jobId === jobId && one.sentAt === null)
    if (index >= 0) {
      entry.attempts.splice(index, 1)
      return true
    }
  }
  return false
}

/**
 * The chat's own report (`{ state, run, at }`, as the board keeps it): the verdict 'woke' for its pending attempt when the
 * report came after the attempt and from a new process (`run` other than at the attempt; or, with no `run` at all, any
 * report but "ended"). A launch alone is never a verdict. The attempt, or null.
 */
export function heard(record, chat, report, now) {
  if (report === null || report === undefined || !isTime(report.at)) return null
  const attempt = newestOf(record, chat)?.attempts.findLast(isPending) ?? null
  if (attempt === null || !(report.at > attempt.at)) return null
  const run = report.run ?? null
  const before = attempt.runBefore ?? null
  // A new process says a new `run`; a mod that says none at all counts by any report but "ended".
  const isNew = run !== null || before !== null ? run !== before : report.state !== 'ended'
  if (!isNew) return null
  attempt.verdict = 'woke'
  attempt.verdictAt = now
  return attempt
}

/**
 * The board-wide spell's verdict (C.3): a hand that may send claimed after its launch (`claimAt`, the newest such claim):
 * woke. The attempt, or null.
 */
export function heardClaim(record, claimAt, now) {
  const attempt = newestOf(record, BOARD_KEY)?.attempts.findLast(isPending) ?? null
  if (attempt === null || !isTime(claimAt) || !(claimAt > attempt.at)) return null
  attempt.verdict = 'woke'
  attempt.verdictAt = now
  return attempt
}

/** The why of a failed attempt, by path. */
const FAILED_WHY = { launch: 'the app did not start it', message: 'no report within 2 minutes of the message' }

/**
 * The verdicts by the clock: every pending attempt sent `verdictMs` ago or more without the chat's report is failed
 * (`FAILED_WHY`); one not sent `sendMs` after its claim too. Returns `[{ chat, spell, attempt }]`, the attempts failed now.
 */
export function pass(record, now, { verdictMs = WAKE_VERDICT_MS, sendMs = WAKE_SEND_MS } = {}) {
  const failed = []
  for (const [chat, entries] of record.wakes) {
    for (const entry of entries) {
      for (const attempt of entry.attempts.filter(isPending)) {
        if (isTime(attempt.sentAt) && now - attempt.sentAt >= verdictMs) {
          attempt.why = FAILED_WHY[attempt.path]
        } else if (attempt.sentAt === null && now - attempt.at >= sendMs) {
          attempt.why = attempt.path === 'launch' ? 'the launch did not end' : `the message was not sent within 3 minutes (held by ${attempt.by})`
        } else continue
        attempt.verdict = 'failed'
        attempt.verdictAt = now
        failed.push({ chat, spell: entry.spell, attempt })
      }
    }
  }
  return failed
}

/** B.2 (decision 5): the woken chat's first turn end after its woke verdict was seen; the server sets it right after that decision. */
export function turnEnded(record, chat, now) {
  const entry = newestOf(record, chat)
  if (entry === null || entry.turnEndedAt !== null || !entry.attempts.some(one => one.verdict === 'woke')) return false
  entry.turnEndedAt = now
  return true
}

/**
 * Decision 12: whether `chat` was woken by a message and the turn that message began has not ended (an envelope's clear
 * waits for that turn end; its first turn end takes nothing back). The review of 2026-11-02: only a message starts a turn;
 * a chat a launch woke, or the person opened, has none, and neither has one whose own report (`report`, the board's kept
 * `{ state, at }`) says idle or ended after the verdict: else its clear would wait for ever and the net fire after "woke".
 */
export function inFirstTurn(record, chat, report = null) {
  const entry = newestOf(record, chat)
  if (entry === null || entry.turnEndedAt !== null) return false
  const woke = entry.attempts.find(one => one.verdict === 'woke')
  if (woke === undefined || woke.path !== 'message') return false
  return !(['idle', 'ended'].includes(report?.state) && isTime(report?.at) && report.at > woke.verdictAt)
}

/** The ways a lane's ids allow: 'message' (an app id), 'launch' (a CLI session id, and `canLaunch`). */
export const pathsOf = (lane, canLaunch) => [...(isAppId(lane?.appSession) ? ['message'] : []), ...(canLaunch === true && isSessionId(lane?.session) ? ['launch'] : [])]

/** The review of 2026-11-02 (5): whether a wake of `chat` is on its way or done in this spell: a start or wake word is not sent beside it. */
export function isWakeOnItsWay(record, chat, spell) {
  return (entryOf(record, chat, spell)?.attempts ?? []).some(one => isPending(one) || one.verdict === 'woke')
}

/**
 * How the wake of `chat` stands in a spell (the newest when `spell` is null): `{ state, path, at, by, why, wokeAt,
 * turnEndedAt, attempts }`; `state` 'none' (no attempt), 'on-its-way' (a message a hand holds), 'sent', 'launched',
 * 'woke' or 'failed' (the newest attempt failed).
 */
export function statusOf(record, chat, spell = null) {
  const entry = entryOf(record, chat, spell)
  const attempts = entry?.attempts ?? []
  const base = { spell: entry?.spell ?? null, path: null, at: null, by: null, why: null, wokeAt: null, turnEndedAt: entry?.turnEndedAt ?? null, attempts: attempts.map(one => ({ ...one })) }
  const woke = attempts.find(one => one.verdict === 'woke')
  if (woke !== undefined) return { ...base, state: 'woke', path: woke.path, at: woke.at, by: woke.by, wokeAt: woke.verdictAt }
  const newest = attempts.at(-1)
  if (newest === undefined) return { ...base, state: 'none' }
  const more = { path: newest.path, at: newest.sentAt ?? newest.at, by: newest.by, why: newest.why }
  if (newest.verdict === 'failed') return { ...base, ...more, state: 'failed' }
  if (newest.path === 'launch') return { ...base, ...more, state: 'launched' }
  return { ...base, ...more, state: newest.sentAt === null ? 'on-its-way' : 'sent' }
}

/**
 * The wake of a need (`{ chat, spell, paths }`, `wakeNeeds`) with what comes next: `statusOf` plus `next` (`nextPath`)
 * and `final` (every path it could take failed: "could not wake"); 'waiting-sender' when nothing was tried and no path
 * can be (no sender claims and it cannot be launched). A need without ids failed at once: why "no id" (decision 12).
 */
export function wakeOf(record, need, { senderClaims = false, senderSince = -Infinity } = {}) {
  const paths = need?.paths ?? []
  const status = statusOf(record, need.chat, need.spell ?? null)
  if (paths.length === 0) return { ...status, state: 'failed', why: 'no id', next: null, final: true }
  const next = nextPath(record, { chat: need.chat, spell: need.spell, senderClaims, senderSince, paths })
  if (status.state === 'none' && next === null) return { ...status, state: 'waiting-sender', next, final: false }
  return { ...status, next, final: status.state === 'failed' && next === null }
}

/** What was tried, with times, for the notice and the incident: "the app did not start it (launched 10:32)", ... */
export function triedWords(attempts, timeOf) {
  return (attempts ?? []).filter(one => one.verdict === 'failed').map(one => {
    if (one.path === 'launch') return `${one.why === FAILED_WHY.launch ? 'the app did not start it' : one.why} (launched ${timeOf(one.at)})`
    if (one.why === FAILED_WHY.message) return `no report after the message (sent ${timeOf(one.sentAt ?? one.at)} by ${one.by})`
    return `the message did not go (${timeOf(one.at)} by ${one.by}: ${one.why})`
  })
}

/**
 * The ONE attention text of the board's wake-ups (decision 6), `{ tone: 'attention', text }` or null, from `targets`: every
 * chat that does not run, `{ chat, spell, paths, need }` (`need` true when `wakeNeeds` names it). Per chat whose wake
 * failed on every path it could take in its spell (`wakeOf` final; the review of 2026-11-02: for the whole spell, need or
 * not, so the line does not go when the take-back ends the need): "could not wake Worker 2: the app did not start it
 * (launched 10:32); no report after the message (sent 10:35 by Advisor); open its chat". "nobody answers the board's
 * wake-ups: open any chat" first when the board-wide spell's launch failed, or no sender claims and every need (at least
 * one) failed or waits for a chat that can send. Replaces nobodyRunsText, wakeFailedText and openerNote.
 */
export function noticeOf(record, targets, now, timeOf, { senderClaims = false, senderSince = -Infinity, nobody = null } = {}) {
  const wakes = (targets ?? []).map(need => ({ need, wake: wakeOf(record, need, { senderClaims, senderSince }) }))
  const failed = wakes.filter(one => one.wake.final)
  const lines = failed.map(({ need, wake }) => {
    const tried = wake.why === 'no id' && wake.attempts.length === 0 ? ['the board has no id to reach it'] : triedWords(wake.attempts, timeOf)
    return `could not wake ${need.chat}: ${tried.join('; ') || wake.why}; open its chat`
  })
  const board = nobody === null ? null : statusOf(record, BOARD_KEY, nobody.since ?? null)
  const isBoardFailed = board !== null && board.state === 'failed'
  const needs = wakes.filter(one => one.need.need !== false)
  const isEveryone = senderClaims !== true && needs.length > 0 && needs.every(one => one.wake.final || one.wake.state === 'waiting-sender')
  if (isBoardFailed || isEveryone) lines.unshift('nobody answers the board\'s wake-ups: open any chat')
  return lines.length === 0 ? null : { tone: 'attention', text: lines.join(' · ') }
}

/**
 * The ⚙ panel's row among what the board does by itself, in place of opener.mjs `openerRow`: by itself, or why not: the
 * board cannot launch a chat here (`blocked`; the message path still runs), or its newest launch failed.
 */
export function rowOf(record, { blocked = null, timeOf = String } = {}) {
  // Key 'launch': the setup check's own 'wake' row (src/codeJobs.mjs, the hands' send-message tool) has the key 'wake'.
  const row = { key: 'launch', title: 'Wake a chat that has work' }
  if (blocked !== null) return { ...row, byCode: false, why: `${blocked}; a running chat's message still wakes one` }
  let newest = null
  for (const [chat, entries] of record?.wakes ?? []) {
    for (const entry of entries) for (const one of entry.attempts) if (one.path === 'launch' && (newest === null || one.at > newest.attempt.at)) newest = { chat, attempt: one }
  }
  if (newest !== null && newest.attempt.verdict === 'failed') {
    const who = newest.chat === BOARD_KEY ? 'a chat' : newest.chat
    return { ...row, byCode: false, why: `the last launch failed: the app did not start ${who} (launched ${timeOf(newest.attempt.at)})` }
  }
  return { ...row, byCode: true, why: null }
}

/**
 * C.2 and C.3: what one minute's check launches, `{ key, chat, session, spell }` or null (one launch per check). The
 * board-wide spell first (`nobody`, nobodyRunsSpell's, while no sender claims): its `target` (opener.mjs `chatToOpen`)
 * once per spell, and while that launch is pending nothing else (one chat at a time); after it failed, or without it,
 * the first need (`wakeNeeds`, in order) whose next path is the launch (decision 8: never first while a sender claims).
 * `key` the record's chat: BOARD_KEY for the board-wide spell.
 */
export function launchPlan(record, { needs = [], nobody = null, senderClaims = false, target = null } = {}) {
  if (senderClaims !== true && nobody !== null && isTime(nobody.since)) {
    const board = statusOf(record, BOARD_KEY, nobody.since)
    if (board.spell === nobody.since && board.state === 'launched') return null
    if (target !== null && nextPath(record, { chat: BOARD_KEY, spell: nobody.since, senderClaims: false, paths: ['launch'] }) === 'launch') {
      return { key: BOARD_KEY, chat: target.chat, session: target.session, spell: nobody.since }
    }
  }
  for (const need of needs ?? []) {
    if (!(need.paths ?? []).includes('launch') || !isTime(need.spell)) continue
    if (nextPath(record, { chat: need.chat, spell: need.spell, senderClaims, paths: need.paths }) === 'launch') return { key: need.chat, chat: need.chat, session: need.session, spell: need.spell }
  }
  return null
}

/**
 * D.1: the wake as the hand-over's decision reads it (handoverBoard.mjs `factsOf`), out of the server's wake facts
 * (`{ record, senderClaims, canLaunch }`) and the worker's lane: `{ state, final, at, by, why, wokeAt, firstTurnEnd }`, or
 * null without a record. A lane that runs reads its newest spell (its `wokeAt` and first turn), never a pending one.
 * `firstTurnEnd` at a turn end of a chat woken whose first turn end was not seen yet (B.2, decision 5).
 */
export function wakeFact(facts, lane, event = null) {
  const record = facts?.record ?? null
  if (record === null || lane === null || lane === undefined || typeof lane.name !== 'string') return null
  const spell = spellOf(lane)
  const paths = pathsOf(lane, facts.canLaunch === true)
  const wake = spell === null ? { ...statusOf(record, lane.name, null), final: false } : wakeOf(record, { chat: lane.name, spell, paths }, { senderClaims: facts.senderClaims === true })
  return {
    state: wake.state, final: wake.final === true, path: wake.path, at: wake.at, by: wake.by, why: wake.why, wokeAt: wake.wokeAt ?? null,
    firstTurnEnd: event?.kind === 'turn-ended' && inFirstTurn(record, lane.name, lane.report ?? null),
  }
}

/** The lane's words for a wake (E): quiet "waking · ..." while on its way, attention "could not wake: why"; null for none. */
export function wakeWords(wake, timeOf) {
  if (wake === null || wake === undefined) return null
  switch (wake.state) {
    case 'waiting-sender': return { tone: 'quiet', text: 'waking · waits for a chat that can send' }
    case 'on-its-way': return { tone: 'quiet', text: `waking · message on its way (held by ${wake.by})` }
    case 'sent': return { tone: 'quiet', text: `waking · message sent ${timeOf(wake.at)} by ${wake.by}` }
    case 'launched': return { tone: 'quiet', text: `waking · launched ${timeOf(wake.at)}` }
    case 'failed': return wake.final === true ? { tone: 'attention', text: `could not wake: ${wake.why ?? 'no reason given'}` } : { tone: 'quiet', text: `waking · ${wake.why ?? 'the first way failed'}; trying the other way` }
    default: return null
  }
}

/**
 * The page's view of the record: the newest spell per chat (the whole record is the file's), with the spells kept
 * (`spells`, oldest first) for the supervisor's key of an envelope's spell.
 */
export function newestSpells(record) {
  return Object.fromEntries([...(record?.wakes ?? new Map())].map(([chat, entries]) => [chat, { ...statusOf(record, chat, null), spells: entries.map(one => one.spell) }]))
}

/** The roles' order of the needs: the Product owner first, then the main chat, the partner, its helper, the supervisor's chat, the workers. */
function orderOf(state) {
  const main = (state.chats ?? []).find(lane => lane.isMain === true && lane.isLeftover !== true)?.name ?? null
  const firsts = [state.productOwner?.name, main, state.advisor?.name, state.advisorHelper?.name, state.supervisorChat?.name].filter(name => typeof name === 'string')
  return name => {
    const index = firsts.indexOf(name)
    return index >= 0 ? index : firsts.length
  }
}

/** The step a lane holds that its resume names: its task's step first, else the oldest taken or in progress. */
const heldStepOf = lane => {
  const held = (lane.storeSteps ?? []).filter(one => one.state === 'taken' || one.state === 'in progress')
  return { held, step: held.find(one => one.id === lane.task?.stepId) ?? held[0] ?? null }
}

/**
 * B.1-B.5: the board chats that do not run (`isRunning` false: asleep or off; unknown is not guessed) and need a wake,
 * with the text their wake message carries, one need per chat, the first case that holds:
 * 1. its envelope waits (`take B855 in this turn: run work next` for a task without a clear; a resume envelope's line;
 *    the plain line for any envelope with a clear or a worker that owes one, decision 12, and for the rest);
 * 2. the pause's resume list names it and it has not started (`resumeList`, pause.mjs `pauseAnswer` while resuming);
 * 3. asleep and interrupted (T13 part 3), not a holder on the sequence: its step's resume line, else ASLEEP_LINE;
 * 4. a word waits for it that the board wakes a chat for (say.mjs `isWakeWord`, not held by the pause; the Product owner's
 *    talk word too): the plain line;
 * 5. a step is queued for it (a worker not on the sequence): the take line.
 * `[{ chat, appSession, session, spell, why, text, step, paths }]`, the Product owner first, then the main chat, the
 * partner, the supervisor's chat, then the workers in list order. Nothing while the person pauses. `paths` the ways its
 * ids allow: 'message' (an app id), 'launch' (a CLI session id, and `canLaunch`).
 */
export function wakeNeeds(state, outbox = [], { resumeList = [], canLaunch = true } = {}) {
  if (state === null || state === undefined || isHolding(state.pause)) return []
  const prefix = state.chatPrefix ?? ''
  const waiting = (outbox ?? []).filter(message => message?.state === 'waiting' && message.isHeld !== true)
  const ownerName = state.productOwner?.name ?? null
  const needs = []
  for (const lane of boardLanes(state)) {
    if (lane?.isRunning !== false || lane.isLeftover === true || (lane.removedAt ?? null) !== null || typeof lane.name !== 'string') continue
    const need = needOf(lane, { state, waiting, prefix, resumeList, ownerName })
    if (need === null) continue
    const paths = pathsOf(lane, canLaunch === true)
    needs.push({ chat: lane.name, appSession: lane.appSession ?? null, session: lane.session ?? null, spell: spellOf(lane), ...need, paths })
  }
  const rank = orderOf(state)
  return needs.map((need, index) => ({ need, index })).sort((a, b) => rank(a.need.chat) - rank(b.need.chat) || a.index - b.index).map(one => one.need)
}

function needOf(lane, { state, waiting, prefix, resumeList, ownerName }) {
  const envelopes = envelopesOf(waiting, lane.name, prefix)
  if (envelopes.length > 0) {
    const task = envelopes.find(one => (one.kind ?? 'task') === 'task' && typeof one.step === 'string')
    const resume = envelopes.find(one => one.kind === 'resume' && typeof one.line === 'string' && one.line !== '')
    // The lazy clear (Task 4, D7): an owed clear counts only for a worker that holds no step (one on its next step owes the
    // clear of its last one, which goes with its next task's envelope).
    const isClear = envelopes.some(one => one.clear !== null && one.clear !== undefined) || ((lane.clearOwed ?? null) !== null && heldStepOf(lane).held.length === 0)
    if (isClear) return { why: 'envelope', text: WORDS_LINE, step: task?.step ?? null }
    if (task !== undefined) return { why: 'envelope', text: takeLine(task.step), step: task.step }
    if (resume !== undefined) return { why: 'envelope', text: resume.line, step: resume.step ?? null }
    return { why: 'envelope', text: WORDS_LINE, step: null }
  }
  // The lead's live check (2026-11-02, order B): a worker HELD on a failed clear whose chat does not run is woken like any
  // sleeper, with the plain line: its next idle report releases the hold (handover.mjs HELD_RETRY_MS) and the new clear
  // envelope comes with its take. Without this, a held sleeper waited for a turn end that never came.
  if (lane.handover?.state === 'held') return { why: 'held', text: WORDS_LINE, step: typeof lane.handover.step === 'string' ? lane.handover.step : null }
  const resuming = (resumeList ?? []).find(one => one.chat === lane.name && one.hasStarted !== true)
  if (resuming !== undefined) return { why: 'resume', text: `resume your step ${resuming.step} from your checkpoint`, step: resuming.step }
  if (lane.asleep === true && lane.state === 'interrupted' && isTime(lane.asleepSince)) {
    const { held, step } = heldStepOf(lane)
    // Signals change 3: a holder on the hand-over's sequence gets its "go on" line from the hand-over (its envelope, case 1).
    if (!(lane.onSequence === true && held.length > 0)) return { why: 'asleep', text: step === null ? ASLEEP_LINE : `resume your step ${step.id} from your checkpoint`, step: step?.id ?? null }
  }
  // The Product owner (2026-10-31): any word waiting for it is a talk the person waits for.
  if (waiting.some(message => message.to === lane.name && message.command !== 'handover' && (lane.name === ownerName || isWakeWord(wakeWordOf(message), state)))) return { why: 'words', text: WORDS_LINE, step: null }
  const queued = (lane.queue ?? [])[0] ?? null
  if (queued !== null && lane.onSequence !== true && typeof queued.id === 'string') return { why: 'queue', text: takeLine(queued.id), step: queued.id }
  return null
}

/**
 * C.3, decision 14 (nobodyRunsOf's predicate, moved here from say.mjs): the board-wide spell, `{ since, chats }`, or
 * null: a word the board wakes a chat for (`isWakeWord`; any hand-over envelope now) waits for a chat that is off, and no
 * chat that could carry a message may run (`wakerOrder`). Not guessed: one that may run (`isRunning` unknown) says
 * nothing, except on a board no mod has called since it started (`bridge.isMissing`). `since` the oldest of those
 * words' times, `chats` the chats they wait for, as they first appear in `outbox`; a word the pause holds does not count.
 */
export function nobodyRunsSpell(state, outbox = []) {
  const lanes = boardLanes(state ?? {})
  if (lanes.length === 0) return null
  const isOff = chat => chat.isRunning === false || (state.bridge?.isMissing === true && chat.isRunning !== true)
  if (wakerOrder(state, null, outbox ?? []).some(chat => !isOff(chat))) return null
  const since = new Map()
  for (const message of outbox ?? []) {
    const target = lanes.find(chat => chat.name === message?.to)
    if (message?.state !== 'waiting' || message.isHeld === true || target === undefined || !isOff(target) || !isWakeWord(wakeWordOf(message), state)) continue
    since.set(message.to, Math.min(since.get(message.to) ?? Infinity, isTime(message.at) ? message.at : Infinity))
  }
  if (since.size === 0) return null
  const times = [...since.values()].filter(isTime)
  return { since: times.length === 0 ? null : Math.min(...times), chats: [...since.keys()] }
}

// ---- The file: data/wakes.json, kept as data/reports.json (src/reportsKept.mjs) ----

const WHYS = /^.{1,200}$/s

/** One saved attempt, or null when it is none. */
function savedAttempt(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (!['message', 'launch'].includes(value.path) || !isTime(value.at) || typeof value.by !== 'string' || typeof value.jobId !== 'string') return null
  if (!(value.sentAt === null || isTime(value.sentAt)) || !(value.verdict === null || ['woke', 'failed'].includes(value.verdict))) return null
  if (!(value.verdictAt === null || isTime(value.verdictAt)) || !(value.why === null || (typeof value.why === 'string' && WHYS.test(value.why)))) return null
  if (!(value.runBefore === null || isTime(value.runBefore) || (typeof value.runBefore === 'string' && value.runBefore.length <= 64))) return null
  const { path, at, by, jobId, sentAt, runBefore, verdict, verdictAt, why } = value
  // T22: an attempt the person asked for ("Send again") keeps that mark; the step whose take line it carried too.
  return { path, at, by, jobId, sentAt, runBefore, verdict, verdictAt, why, ...(value.again === 'person' ? { again: 'person' } : {}), step: typeof value.step === 'string' && /^[A-Z]\d{1,6}$/.test(value.step) ? value.step : null }
}

/** One saved spell entry, or null when it is none (an attempt that is no attempt is left out). */
export function savedSpell(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !isTime(value.spell) || !Array.isArray(value.attempts)) return null
  if (!(value.turnEndedAt === null || isTime(value.turnEndedAt))) return null
  const told = value.told !== null && typeof value.told === 'object' ? value.told : {}
  return {
    spell: value.spell, attempts: value.attempts.map(savedAttempt).filter(one => one !== null), turnEndedAt: value.turnEndedAt,
    told: { failed: told.failed === true, nobody: told.nobody === true },
  }
}

/** The record as the file holds it: `{ "wakes": { "<chat>": [spellEntry, ...] } }`. */
export const textOfWakes = record => `${JSON.stringify({ wakes: Object.fromEntries(record.wakes) })}\n`

/** The record a parsed file holds, left out the entries that are no spell; null when the file is not that shape. */
export function wakesOfFile(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value.wakes === null || typeof value.wakes !== 'object' || Array.isArray(value.wakes)) return null
  const record = emptyWakes()
  for (const [chat, entries] of Object.entries(value.wakes)) {
    if (chat === '' || !Array.isArray(entries)) continue
    const kept = entries.map(savedSpell).filter(one => one !== null).slice(-WAKE_SPELLS_KEPT)
    if (kept.length > 0) record.wakes.set(chat, kept)
  }
  return record
}

/**
 * The record at the board's start: `{ record, setAside, unread }`, as `readReports`: no file is an empty record; a torn
 * file or one of another shape is moved aside as `<file>.broken-<time>`; one that could not be read or moved is `unread`.
 */
export async function readWakes(file, now, fs = undefined) {
  const read = await readKept(file, now, fs)
  if (read.value === null) return { record: emptyWakes(), setAside: read.setAside, unread: read.unread }
  const record = wakesOfFile(read.value)
  if (record !== null) return { record, setAside: null, unread: null }
  const aside = `${file}.broken-${stampOf(now)}`
  try {
    await moveInPlace(file, aside, fs)
    return { record: emptyWakes(), setAside: aside, unread: null }
  } catch (error) {
    return { record: emptyWakes(), setAside: null, unread: `not wakes, and not kept aside: ${error?.code ?? error?.message}` }
  }
}

/** The file's writer, as `reportsSaver`: `changed()` after every change of the record, `flush()` before the board stops. */
export function wakesSaver({ file, record, waitMs = WAKES_SAVE_MS, write = writeUnflushed, onError = () => {}, onSaved = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null
  let isDirty = false
  let writing = Promise.resolve()
  const save = () => {
    timer = null
    isDirty = false
    const text = textOfWakes(record)
    writing = writing.then(() => write(file, text)).then(onSaved, onError).catch(() => {})
  }
  return {
    changed() {
      isDirty = true
      if (timer !== null) return
      timer = setTimer(save, waitMs)
      timer?.unref?.()
    },
    async flush() {
      if (timer !== null) clearTimer(timer)
      if (isDirty) save()
      await writing
    },
  }
}
