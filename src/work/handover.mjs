// T8.5 (the person, 2026-10-31: "redesign the hand-over as one board-owned sequence"; the design is
// .claude/specs/2026-10-31-handover-design.md, part 2): the hand-over between two tasks of a worker as one decision of the
// board's. The worker's turn end is the one trigger: at that moment the board decides once what the worker gets next and
// answers with one envelope (clear yourself, set this model, then here is B12), which the worker's Workers mod carries out
// in order and settles once. Every other moment that can change what a worker gets (its envelope settled, a ready task
// for a free worker, a pause, its first call on a new mod, its background work ending, the report check ending) runs the
// same decision again or takes back the one task in flight; nothing waits on a clock but one safety net.
//
// PURE. The worker's state is derived, never stored anew (principle 4): from the store (a step's state and History), the
// outbox (its envelopes and their outcomes) and its lane (its report, its mod, the pause and the limits). The board side
// (src/work/handoverBoard.mjs) gathers the facts, carries out what `decide` answers and writes the envelope.

import { modAtLeast, handedBackOf } from '../clearOwed.mjs'
import { match } from './handOut.mjs'
import { GIVEN_BACK, GIVE_BACK_MINUTES, RESUME_KIND, RESUME_MINUTES, continuationLine, continuationOf, holderTimers } from './holderTimers.mjs'
import { sinceMs, valueOf } from './item.mjs'
import { reportCheckFailedOf } from './resultCheck.mjs'
import { holdEndOf } from './pause.mjs'
import { familyOf } from './effort.mjs'
import { stamp } from './migrate.mjs'

const MIN = 60_000
/** The Workers mod that carries out the board's envelope: a worker on an older one is handed nothing (T8.5 step 6). */
export const HANDOVER_MOD = '0.27.0'
/** The outbox's command of an envelope. */
export const HANDOVER_COMMAND = 'handover'
/** The settings' values of `handover`: the sequence (the default), or "timers", the escape hatch: since T8.5 step 6 it hands out nothing. */
export const HANDOVER_MODES = ['timers', 'sequence']
/**
 * The one safety net (principle 2): an envelope with a task that has no outcome that ended it, no take and no turn end
 * after it for this long of the board's running time (the time the board was off left out) loses its task, once. The
 * worker's next event is the retry, never the clock.
 */
export const NET_MS = 10 * MIN
/** A restart envelope whose worker has not called on the installed mod this long after it: unknown, "restart did not happen". */
export const RESTART_NET_MS = 15 * MIN

/** The worker's states (the spec's table). */
export const STATES = Object.freeze({
  WORKING: 'working', CHECKING: 'checking', HANDING: 'handing', OFFERED: 'offered', FREE: 'free', HELD: 'held',
  SUSPENDED: 'suspended', RESTARTING: 'restarting', UNKNOWN: 'unknown',
})

/** The History words of the take-backs (spec part 3: "the take-back with a new why"). */
export const NOT_TAKEN_WHY = 'did not take it in its turn'
export const UNANSWERED_WHY = 'did not answer its hand-over'
/**
 * The lazy clear (D8) and Fix 0.31.0 part 4: the whys the board's start sweep (handoverBoard.mjs `closeClearOnly`) closes a lone
 * clear with: one still waiting, and one taken and never answered. Here, beside UNANSWERED_WHY, so the rule handover-unanswered can
 * tell such a close from the net's own (its why is UNANSWERED_WHY).
 */
export const CLEAR_ONLY_CLOSED_WHY = 'no clear goes alone since Workers mod 0.31.0: the clear it owes rides its next task'
export const CLEAR_ONLY_TAKEN_WHY = 'a lone clear from before 0.31.0, never answered'
export const PAUSED_WHY = 'the person pauses the chats'
export const LIMIT_WHY = 'a usage limit is full'
export const RESTART_LATE_WHY = 'its restart did not happen'
/** Signals change 4 (D.2): the take-back's why when every way to wake the worker failed. */
export const WAKE_FAILED_WHY = 'could not wake it'
/** Signals change 4: the states of a wake still on its way (src/wake.mjs WAKE_PENDING; kept here so decide stays pure of the record). */
const WAKING = ['waiting-sender', 'on-its-way', 'sent', 'launched']

/** The states in which a step is its worker's work now. */
const HOLDS = ['taken', 'in progress', 'waiting on you']
/** A History line that reports a step: its move to review, or a report again (as clearOwed.mjs reads it). */
const REPORTED = / → review\b|: reported again\b/
const CHECKED = /\bserver: check (?:passed|failed)\b/
const LINE_WHO = /^-\s+(\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?) ([^:]{1,80}):/

const kindOf = item => valueOf(item, 'Kind') ?? 'step'
const stateOf = item => valueOf(item, 'State')
const historyOf = item => item?.sections?.get('History') ?? []
const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
const isMine = (item, name, prefix) => plain(valueOf(item, 'Owner'), prefix) === plain(name, prefix)
const escaped = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The one predicate (spec part 4, "Old and new must never run for the same worker"): a worker is on the sequence when the
 * settings say `handover: "sequence"` and its Workers mod (`lane.mod`, the version its last call said) is HANDOVER_MOD or
 * newer. The main chat, a leftover, the partner and the supervisor never are. T8.5 step 6: the old path is gone, so a worker
 * for which this does not hold is handed nothing (the setting "timers", or a Workers mod older than HANDOVER_MOD).
 */
export function onSequence(lane, config) {
  if (config?.handover !== 'sequence' || lane === null || lane === undefined) return false
  if (lane.isMain === true || lane.isLeftover === true || typeof lane.name !== 'string') return false
  return modAtLeast(lane.mod ?? null, HANDOVER_MOD)
}

/** The line that gives a worker its task (the one the board has always typed). */
export const lineFor = id => `work: ${id} is yours; run work next`

/** The worker's envelopes in the outbox (`sent`), oldest first. */
export const envelopesOf = (sent, name, prefix = '') => (sent ?? [])
  .filter(message => message?.command === HANDOVER_COMMAND && plain(message.to, prefix) === plain(name, prefix) && Number.isFinite(message.at))
  .sort((a, b) => a.at - b.at)

/**
 * The lazy clear (Workers mod 0.31.0, the brief's D4): a clear that did not run is no failure when the rest of the envelope
 * went: `cleared` false, the set not failed, and its line typed (`typed` true) or no line to type because the wake message
 * carried it (a task's envelope whose line the hand-out waived, `handOut`). The worker is not held and its task not taken
 * back; the clear stays owed and rides its next task. An old-style settle (a 0.30.0 worker: the clear failed, its line not
 * typed) is still a failure, released as B930 and HELD_RETRY_MS say, until every worker runs 0.31.0.
 */
export function isClearOwedOnly(envelope, outcome = envelope?.outcome ?? null) {
  if (envelope === null || envelope === undefined || outcome === null || outcome === undefined) return false
  if (envelope.restart === true || outcome.cleared !== false || outcome.set === false || outcome.restarted === false) return false
  const isWaived = typeof envelope.line !== 'string' && typeof envelope.step === 'string'
  return outcome.typed === true || isWaived
}

/** Whether an envelope's outcome failed: the clear, the set or the line did not happen (or the message failed as a whole). */
export function failedOf(envelope) {
  if (envelope === null || envelope === undefined) return false
  const outcome = envelope.outcome ?? null
  if (outcome === null) return envelope.state === 'failed'
  if (envelope.restart === true) return outcome.restarted === false
  // The lazy clear (D4): a clear owed while the line went in is no failure.
  if (isClearOwedOnly(envelope, outcome)) return false
  return outcome.cleared === false || outcome.set === false || (outcome.typed === false && typeof envelope.line === 'string')
}

/** The why of a failed envelope, in the board's words, for the lane and the History. */
export function failedWhy(envelope) {
  const outcome = envelope?.outcome ?? null
  const said = (...whys) => {
    const own = whys.find(one => typeof one === 'string' && one.trim() !== '')
    return own !== undefined ? own.replace(/\s+/g, ' ').trim().slice(0, 160) : typeof envelope?.why === 'string' ? envelope.why.slice(0, 160) : 'no reason given'
  }
  // The lazy clear: a 0.31.0 mod says the clear's why in `clearWhy`, and `why` is then the set's or the line's: a set or a
  // line that failed is what holds, so its words come first, in that order. A 0.30.0 failed clear (no clearWhy) is the
  // clear's: its `why` is the clear's. The real 0.30.0 mod settles it typed null (the line branch never takes it then);
  // the guard keeps the same words for the typed:false shape older fixtures and tests carry.
  const clearWhy = outcome?.clearWhy ?? null
  const isOldClear = outcome?.cleared === false && clearWhy === null
  if (outcome?.set === false) return `its model and effort could not be set: ${said(outcome.why)}`
  if (!isOldClear && outcome?.typed === false && typeof envelope?.line === 'string') return `its line could not be typed: ${said(outcome.why)}`
  if (outcome?.cleared === false) return `its clear did not run: ${said(clearWhy, outcome.why)}`
  if (envelope?.restart === true) return `its restart did not run: ${said(outcome?.why)}`
  return `its line could not be typed: ${said(outcome?.why)}`
}

/**
 * B930: the lane's count of the background work its chat started (state.mjs, chatReport.mjs `backgroundOf`: the source the
 * clear's refusal reads); a lane without one (none built by the state) by its report's flag.
 */
const backgroundCount = worker => (Number.isFinite(worker?.background) ? worker.background : worker?.report?.background === true ? 1 : 0)

/** B930: the Workers mod's words for a call the board did not answer (its register.tsx `workOnce`), inside a clear's why. */
const BOARD_DID_NOT_ANSWER = /\(The worker board (?:did not answer|is not running)\b/

/**
 * B930 (X131): whether an envelope's clear failed on the board's own time-out (its save-log went unanswered), not on a
 * refusal of the board, the chat or its mod.
 */
export function isBoardTimeout(envelope) {
  const outcome = envelope?.outcome ?? null
  return envelope?.clear != null && outcome?.cleared === false && outcome.background !== true && BOARD_DID_NOT_ANSWER.test(outcome.why ?? '')
}

/** The step a clear envelope clears after (or the task it carries), or null. */
const clearStepOf = envelope => envelope?.clear?.step ?? envelope?.step ?? null

/** B930: the held line of a worker whose clear failed on the board's own time-out a second time for the same step. */
export const timedOutTwiceWhy = step => `its clear${step === null ? '' : ` after ${step}`} failed twice on the board's own time-out`
/**
 * 2026-11-02 (the lead: Workers 3 and 4 held for an hour after "/clear did not run within two minutes" at 21:25 and 21:31):
 * a held worker is handed nothing, so an idle one never gets the turn end that released it: a deadlock. A hold on a failed
 * clear now lasts at most this long of the board's running time; then the next idle report releases it (one more clear),
 * and again every such span while the clear keeps failing. The lane says when the next try comes.
 */
export const HELD_RETRY_MS = 10 * MIN
/** 2026-11-02: a clear cut by the board's own restart (refused "not running", or sent in the minute before the restart) is no time-out. */
const RESTART_CUT_MS = MIN
const isRestartCut = (envelope, boardStartedAt) => isBoardTimeout(envelope) && (/is not running\b/.test(envelope.outcome?.why ?? '')
  || (Number.isFinite(boardStartedAt) && Number.isFinite(envelope.at) && envelope.at >= boardStartedAt - RESTART_CUT_MS && envelope.at <= boardStartedAt))
/**
 * The lazy clear (D3): a 0.31.0 refusal of the clear under the person's pause: the line not typed (`typed` null), the set not
 * failed, and the clear's why the board's own pause words (PAUSED_WHY: the Workers mod sends exactly these, its chats.ts
 * `clearWhy`). The mod knows no limit, so no refusal names LIMIT_WHY; one that did would hold as any.
 */
export const isPauseRefusal = envelope => envelope?.outcome?.cleared === false && envelope.outcome.typed == null && envelope.outcome.set !== false
  && envelope.outcome.clearWhy === PAUSED_WHY
/**
 * Whether the board's own pause record (pause.json: pausing since `since`; resuming or running, from `pausedSince` to the
 * resume) covered the moment `at`.
 */
function pauseCovered(pause, at, now) {
  if (pause === null || pause === undefined || !Number.isFinite(at)) return false
  const start = pause.state === 'pausing' ? pause.since : pause.pausedSince ?? null
  // pause.mjs's window: from the pause's start to its hold's end (holdEndOf), now while it still holds.
  const end = pause.state === 'pausing' ? now : holdEndOf(pause)
  return Number.isFinite(start) && Number.isFinite(end) && start <= at && at <= end
}
const two = n => String(n).padStart(2, '0')
const hourMinuteOf = ms => `${two(new Date(ms).getHours())}:${two(new Date(ms).getMinutes())}`

/** When an envelope was settled (its outcome), or failed. */
const settledAt = envelope => [envelope?.settledAt, envelope?.deliveredAt, envelope?.failedAt].find(Number.isFinite) ?? envelope?.at ?? -Infinity

/** The step the worker holds now (taken, in progress or waiting on you), or undefined. */
const holdingOf = (items, name, prefix) => [...items.values()].find(item => kindOf(item) === 'step' && HOLDS.includes(stateOf(item)) && isMine(item, name, prefix))

const isQueuedFor = (items, id, name, prefix) => {
  const item = items.get(id)
  return item !== undefined && stateOf(item) === 'queued' && isMine(item, name, prefix)
}

/** When the worker last took a step (a History line of its own moving one to taken or in progress), or -Infinity. */
function lastTakeAt(items, name, prefix) {
  let newest = -Infinity
  for (const item of items.values()) {
    if (kindOf(item) !== 'step') continue
    for (const line of historyOf(item)) {
      if (!/: queued → (?:taken|in progress)\b/.test(line)) continue
      const found = LINE_WHO.exec(line)
      if (found !== null && plain(found[2], prefix) === plain(name, prefix)) newest = Math.max(newest, sinceMs(found[1]))
    }
  }
  return newest
}

/**
 * The person's answer to the spec's open question 2 (2026-10-31: yes): a task the worker did not take in the turn its line
 * started is not offered to it again until it takes another task. The ids taken back from it so since its last take.
 * Signals change 3: so is a step the board gave back from it because it did not go on (holderTimers.mjs `GIVEN_BACK`, the
 * words the give-back's move writes), until it takes another task.
 */
export function notOfferedAgain(items, name, prefix = '') {
  const since = lastTakeAt(items, name, prefix)
  const back = new RegExp(`^-\\s+(\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d(?::\\d\\d)?)\\s+server: queued → refined \\(taken back from (.+?): ${escaped(NOT_TAKEN_WHY)}\\b`)
  const ids = new Set()
  for (const item of items.values()) {
    if (kindOf(item) !== 'step') continue
    for (const line of historyOf(item)) {
      const hit = back.exec(line) ?? GIVEN_BACK.exec(line)
      if (hit !== null && plain(hit[2], prefix) === plain(name, prefix) && sinceMs(hit[1]) >= since) ids.add(valueOf(item, 'Id'))
    }
  }
  return ids
}

/**
 * The worker's newest report whose board check has not ended: the step it moved to review (or reported again) last, still
 * in review, with no "server: check passed/failed" line after that report. `{ id }` or null.
 */
export function checkPendingOf(items, name, prefix = '') {
  let newest = null
  for (const item of items.values()) {
    if (kindOf(item) !== 'step') continue
    const lines = historyOf(item)
    lines.forEach((line, index) => {
      if (!REPORTED.test(line)) return
      const found = LINE_WHO.exec(line)
      if (found === null || plain(found[2], prefix) !== plain(name, prefix)) return
      const at = sinceMs(found[1])
      if (newest === null || at >= newest.at) newest = { item, index, at }
    })
  }
  if (newest === null || stateOf(newest.item) !== 'review') return null
  const after = historyOf(newest.item).slice(newest.index + 1)
  return after.some(line => CHECKED.test(line)) ? null : { id: valueOf(newest.item, 'Id') }
}

/** The board's "back to you" words for a report whose check failed (as the reconciler words them, reconcile.mjs). */
function backWords(id, failed) {
  if (failed === null) return `work: the board's check of ${id} failed: fix what it names and report ${id} again`
  if (failed.notMerged !== null) return `work: ${failed.notMerged}`
  if (failed.back !== null) return `work: the board's check sent ${id} back to you at ${failed.clock}: ${failed.back}; then report ${id} again`
  return `work: ${id}'s report check failed at ${failed.clock} (${failed.why}): fix what it names and report it again`
}

/** The words a lane's why carries while a ban stands (laneWords reads them; a test pins them). */
export const BAN_WHY_MARK = ' steps: its set failed at '

/**
 * The models a set failed for and that nothing lifted since, each with the envelope that failed (`Map model -> envelope`).
 * A ban lifts on a later envelope of this worker that set that model (`outcome.set` true), and on any later DELIVERED envelope
 * (B1051, 2026-11-05: the worker works, so its next step of that model is tried once more; a real failure bans it again, and a
 * failure with nothing delivered after it stays banned). Before, only `outcome.set === true` lifted, which no mod writes: a
 * set that was dropped as "runs at sonnet already" (a success) banned Sonnet for ever.
 */
/** A ban also lifts this long after its failure (principle 2: nothing waits for ever): one more try; a real failure bans again. */
export const BAN_MS = 2 * 60 * MIN
const failedAtOf = envelope => envelope.failedAt ?? envelope.settledAt ?? envelope.at

export function bansOf(envelopes, now = null) {
  const barred = new Map()
  for (const envelope of envelopes) {
    if (envelope.state === 'delivered') barred.clear()
    const model = envelope.set?.model ?? null
    if (model === null) continue
    if (envelope.outcome?.set === false) barred.set(model, envelope)
    else if (envelope.outcome?.set === true) barred.delete(model)
  }
  if (now !== null) for (const [model, envelope] of barred) if (now - failedAtOf(envelope) >= BAN_MS) barred.delete(model)
  return barred
}

const failedModels = (envelopes, now) => new Set(bansOf(envelopes, now).keys())

/** The lane's why for a worker with a ban standing: "free; gets no sonnet steps: its set failed at 11:30 (<why>)", or null. */
function banWhy(envelopes, now) {
  const bans = [...bansOf(envelopes, now)]
  if (bans.length === 0) return null
  const parts = bans.map(([model, envelope]) => {
    const when = failedAtOf(envelope)
    const why = `${envelope.outcome?.why ?? envelope.why ?? 'no reason given'}`.replace(/\s+/g, ' ').trim().slice(0, 80)
    return `${familyOf(model) ?? model}${BAN_WHY_MARK}${stamp(when).slice(11)} (${why}) until ${stamp(when + BAN_MS).slice(11)}`
  })
  return `free; gets no ${parts.join('; gets no ')}`
}

const result = (state, why = null, more = {}) => ({ state, why, step: null, takeBack: null, give: null, envelope: null, net: null, close: null, asked: null, goOn: null, giveBack: null, ...more })

/**
 * The one decision for one worker (spec part 2, "The decision"), at an event: `{ kind: 'turn-ended', since }` (T: the
 * worker's turn ended; `since` when it began) or `{ kind: 'pass' }` (every other event: its envelope settled, a take, the
 * report check ended, the ready list changed, a pause or a resume, a limit, its first call on a new mod, its background
 * work ended, the net). Facts:
 *
 * - `worker`: its lane, `{ name, mod, report: { state, since, background, at }, isRunning, asleep, state }`;
 * - `items`: the store's items by id; `ready`: the ready list's entries in order (`readyList`); `prefix`;
 * - `paused` (the person pauses), `limitFull` (a usage limit is full or past its stop line), `installed` (the Workers mod
 *   installed, or null);
 * - `owed`: the clear it owes (clearOwed.mjs `clearOwed`), or null;
 * - `envelopes`: its envelopes in the outbox, oldest first (`envelopesOf`);
 * - `setFor(id)`: the model and effort its chat must be set to for that step (`{ model, effort }`), or null when it runs it;
 * - `now`, `runningMs(from)`: the board's running time since `from` (its off time left out);
 * - signals change 3: `pause` (the store's pause record), `stops` (the person's stop and remove words about it), `timers`
 *   `{ resumeMs, giveBackMs }` (the settings `resumeAfterMinutes` and `giveBackAfterMinutes`), `localOnly` (the ids of the
 *   given-back ready steps whose checkpoint commit is on no remote branch: their continuation line says so);
 * - signals change 4, B908: `wake` (src/wake.mjs `wakeFact`: `{ state, final, wokeAt, firstTurnEnd }`, or null).
 *
 * In this order, the first that holds wins:
 * 1. the person pauses, or a limit is full: SUSPENDED, nothing sent; the task in flight goes back at once;
 * 2. it holds a step taken, in progress or waiting on you: WORKING; signals change 3: a holder that stopped runs its two
 *    timers (holderTimers.mjs): the "go on" line once per stopped spell after `resumeMs` (the envelope `resume`, with
 *    `goOn` `{ step, chat, since }` for the step's History), `asked` when that line was written (the lane's words), and
 *    `giveBackMs` after the line with no progress `giveBack` `{ step, chat, askedAt }` with `close` the line still waiting;
 *    its envelope in flight: a turn that ended after its line without a take gives the task back at once and decides
 *    on, that task not offered to it again; a failed outcome gives it back at once, HELD; the net gives it back once,
 *    UNKNOWN; else HANDING (no outcome yet) or OFFERED (the line typed). Signals change 4: while its chat is being woken
 *    (`wake` on its way) HANDING and no net; once every way to wake it failed, the task goes back once (WAKE_FAILED_WHY),
 *    UNKNOWN; the net counts from the "woke" verdict; a turn end counts only once the line is settled typed, and never
 *    the woken chat's first;
 * 3. its newest report's check failed and it did not report again: WORKING, with the "back to you" words once per failed check;
 * 4. its newest report's check is pending: CHECKING;
 * 5. its mod is older than the installed one: RESTARTING, the envelope `restart` once (UNKNOWN after RESTART_NET_MS);
 *    HELD (a failed envelope not yet released by a turn end or its report) and UNKNOWN (after the net) come here;
 * 6. otherwise the clear when one is owed, and the ready list's first task this worker may take with its `set` and `line`:
 *    HANDING; none: FREE, nothing sent (the lazy clear: the clear stays owed for the next task's envelope).
 *
 * At a pass the worker is handed nothing while its turn runs, nor while its chat does not run. The answer:
 * `{ state, why, step, takeBack: { id, why } | null, give: id | null, envelope: { kind, step, clear, restart, set, line,
 * back, version } | null, net: envelope id | null, close: envelope id | null }`: the task to take back first, the task to
 * give in the same call, the envelope to write, the envelope the net fired for (marked once), one that waits in the outbox
 * and is to be closed (its task went back).
 */
export function decide({ worker, items = new Map(), ready = [], prefix = '', paused = false, limitFull = false, installed = null, owed = null, envelopes: all = [], setFor = () => null, now, runningMs = from => now - from, event = { kind: 'pass' }, pause = null, stops = [], timers = {}, localOnly = new Set(), wake = null, boardStartedAt = null }) {
  const name = worker.name
  const isTurnEnd = event?.kind === 'turn-ended'
  const turnSince = isTurnEnd && Number.isFinite(event.since) ? event.since : -Infinity
  // Signals change 4 (D.2, decision 10, 2026-11-02 10:31-11:01: B855 bounced Workers 2 → 3 → 4 → 5 by the net while no wake
  // reached any of them): a wake still on its way holds the net; one that failed on every path gives the task back once.
  // Only for a chat that does not run: a running one woke (its newest spell's `wokeAt` still sets the net's start).
  // The review of 2026-11-02: a wake that waits for a chat that can send (no sender claims, no launch possible) holds the
  // net for the whole spell; acceptable only because nothing runs then that could take the task, and the page says
  // "nobody answers the board's wake-ups" (src/wake.mjs `noticeOf`).
  const isAsleepNow = worker.isRunning !== true
  const isWaking = isAsleepNow && wake !== null && (WAKING.includes(wake.state) || (wake.state === 'failed' && wake.final !== true))
  const isWakeFailed = isAsleepNow && wake !== null && wake.state === 'failed' && wake.final === true
  const wokeAt = Number.isFinite(wake?.wokeAt) ? wake.wokeAt : -Infinity
  // Signals change 3: the "go on" lines are the holder's timers', not the hand-over's: they never stand in for its last envelope.
  const envelopes = all.filter(one => one?.kind !== RESUME_KIND)
  const resumes = all.filter(one => one?.kind === RESUME_KIND)
  const last = envelopes.at(-1) ?? null
  const inFlight = last !== null && typeof last.step === 'string' && last.netAt === undefined && isQueuedFor(items, last.step, name, prefix) ? last : null
  const closeOf = envelope => (envelope?.state === 'waiting' ? envelope.id : null)

  // 1. The pause and the limits come first: nothing starts a turn; the clear waits for the resume (open question 3).
  if (paused || limitFull || worker.state === 'suspended') {
    const why = paused ? PAUSED_WHY : LIMIT_WHY
    return result(STATES.SUSPENDED, why, inFlight === null ? {} : { takeBack: { id: inFlight.step, why }, close: closeOf(inFlight), step: inFlight.step })
  }
  // 2. Its own step: the take ended the hand-over.
  const holding = holdingOf(items, name, prefix)
  if (holding !== undefined) {
    const id = valueOf(holding, 'Id')
    // Signals change 3: a holder that stopped gets one "go on" line, and its step goes back when it does not go on.
    const timed = holderTimers({
      worker, holding, items, prefix, envelopes: resumes, stops, pause, runningMs,
      resumeMs: timers.resumeMs ?? RESUME_MINUTES * MIN, giveBackMs: timers.giveBackMs ?? GIVE_BACK_MINUTES * MIN,
    })
    if (timed === null) return result(STATES.WORKING, null, { step: id })
    const resume = timed.resume === null ? null
      : { kind: RESUME_KIND, step: null, clear: null, restart: false, set: null, line: timed.resume.line, back: null, resume: timed.resume.marker }
    return result(STATES.WORKING, null, {
      step: id, asked: timed.asked, giveBack: timed.giveBack, close: timed.close, envelope: resume,
      goOn: resume === null ? null : { step: id, chat: name, since: timed.since },
    })
  }

  // The one task in flight (the spec's events table: T, D and the net).
  const report = worker.report ?? null
  let takenBack = null
  if (inFlight !== null) {
    const id = inFlight.step
    const isCarried = inFlight.state !== 'waiting'
    if (failedOf(inFlight)) {
      const why = failedWhy(inFlight)
      return result(STATES.HELD, why, { step: id, takeBack: { id, why }, close: closeOf(inFlight) })
    }
    if (isWakeFailed) return result(STATES.UNKNOWN, `${WAKE_FAILED_WHY} (${id})`, { step: id, takeBack: { id, why: WAKE_FAILED_WHY }, close: closeOf(inFlight) })
    if (isWaking) return result(STATES.HANDING, null, { step: id })
    // Decision 5 (board-only, the 11:07 case: Worker 5's first turn began 11:06:56 with the wake message, its line was typed
    // 11:07:22 after that turn ended): a turn end counts only once the line is settled typed, and never the woken chat's
    // first. 4c (done, Workers mod 0.30.0): the mod sends the line's exact times in the outcome, so the turn is compared with
    // the moment the line entered the chat (`enteredAt`, else `typedAt`), the envelope's hand-out only for an older mod.
    const isSettledTyped = inFlight.outcome?.typed === true || inFlight.state === 'delivered'
    const lineAt = inFlight.outcome?.enteredAt ?? inFlight.outcome?.typedAt ?? inFlight.at
    if (isTurnEnd && isCarried && isSettledTyped && turnSince >= lineAt && wake?.firstTurnEnd !== true) {
      takenBack = { id, why: NOT_TAKEN_WHY }
    } else if (runningMs(Math.max(inFlight.at, wokeAt)) >= NET_MS) {
      return result(STATES.UNKNOWN, `${UNANSWERED_WHY} (${id})`, { step: id, takeBack: { id, why: UNANSWERED_WHY }, net: inFlight.id, close: closeOf(inFlight) })
    } else {
      const isTyped = inFlight.outcome?.typed === true || inFlight.state === 'delivered'
      return result(isTyped ? STATES.OFFERED : STATES.HANDING, null, { step: id })
    }
  }
  // An envelope without a task (the back words, a restart, or a clear alone an older board wrote) still on its way: nothing new beside it.
  // A turn that ended after it was carried ends it; the net marks one that never answered, once.
  if (last !== null && takenBack === null && last.netAt === undefined && ['waiting', 'taken'].includes(last.state) && (last.outcome ?? null) === null && typeof last.step !== 'string'
    && !(isTurnEnd && last.state !== 'waiting' && turnSince >= last.at) && last.restart !== true) {
    // Signals change 4: no net while its chat is being woken either; it counts from the "woke" verdict.
    if (isWaking || runningMs(Math.max(last.at, wokeAt)) < NET_MS) return result(STATES.HANDING, null, { kind: last.kind ?? null })
    return result(STATES.UNKNOWN, UNANSWERED_WHY, { net: last.id, close: closeOf(last) })
  }

  // At a pass nothing goes to a worker whose turn runs or whose chat does not run (X111: busy by its report is not free).
  const isIdle = report !== null && (report.state === 'idle' || (worker.asleep === true && report.state === 'ended'))
  const isThere = worker.isRunning === true || worker.asleep === true
  const mayHand = isTurnEnd || (isIdle && isThere)
  const wait = () => (report === null ? result(STATES.UNKNOWN, 'its Workers mod has not reported') : !isThere ? result(STATES.UNKNOWN, 'its chat does not run')
    : result(STATES.WORKING, 'its turn runs'))

  // 3. The board's check of its report failed: the step is back with it, told once per failed check.
  const back = handedBackOf(items, name, prefix)
  if (back !== null) {
    const failed = reportCheckFailedOf(items.get(back.id))
    const key = `${back.id} ${failed?.stamp || back.at}`
    const isTold = envelopes.some(one => one.back === key)
    if (isTold || !mayHand) return result(STATES.WORKING, null, { step: back.id })
    return result(STATES.WORKING, null, { step: back.id, envelope: { kind: 'back', step: null, clear: null, restart: false, set: null, line: backWords(back.id, failed), back: key } })
  }
  // 4. The board's check of its report has not ended: its end (C) decides again.
  const pending = checkPendingOf(items, name, prefix)
  if (pending !== null) return result(STATES.CHECKING, null, { step: pending.id })

  // 5. An older mod than the installed one: one restart, which stands in for the clear; its line follows on the new mod (M).
  if (typeof installed === 'string' && typeof worker.mod === 'string' && !modAtLeast(worker.mod, installed)) {
    const asked = envelopes.findLast(one => one.restart === true && one.version === installed)
    if (asked !== undefined) return runningMs(asked.at) >= RESTART_NET_MS ? result(STATES.UNKNOWN, RESTART_LATE_WHY) : result(STATES.RESTARTING, null)
    if (!mayHand) return wait()
    return result(STATES.RESTARTING, null, { envelope: { kind: 'restart', step: null, clear: null, restart: true, set: null, line: null, back: null, version: installed } })
  }
  // HELD: its last envelope failed; released by a turn end after it, or by its report (B: idle, nothing in the background)
  // when the background work or the set was what failed. Told once per report (the lane shows it; nothing is sent).
  // B930 (X131): "nothing in the background" is the lane's count (`worker.background`, the source the clear's refusal reads:
  // chatReport.mjs `backgroundOf`), so a release is never refused again for the same reading. And a clear that failed on the
  // board's own time-out is released by the next report once per step; a second one for that step holds it.
  if (takenBack === null && last !== null && failedOf(last)) {
    const at = settledAt(last)
    const isReported = report?.state === 'idle' && Number.isFinite(report?.at) && report.at > at
    // X133: also an envelope the sweep closed since (its task taken back, state dropped): its outcome is the hold's cause.
    // 2026-11-02: a clear the board's own restart cut is no time-out at all: it never counts toward "twice".
    const isTimedOutAgain = isBoardTimeout(last) && !isRestartCut(last, boardStartedAt)
      && envelopes.some(one => one !== last && isBoardTimeout(one) && !isRestartCut(one, boardStartedAt) && clearStepOf(one) === clearStepOf(last))
    // 2026-11-02: no hold for ever: after HELD_RETRY_MS of running time the next idle report releases it (one more clear).
    const heldMs = runningMs(at)
    const isReleased = turnSince >= at || (Number.isFinite(report?.since) && report.since > at)
      || (isReported && backgroundCount(worker) === 0 && (last.outcome?.background === true || last.outcome?.set === false))
      || (isReported && isBoardTimeout(last) && !isTimedOutAgain)
      || (isReported && heldMs >= HELD_RETRY_MS)
      // The lazy clear (D3, the Task 3 review): a 0.31.0 refusal under the person's pause (the line not typed, `typed` null, the
      // clearWhy the board's own PAUSED_WHY) is released at once, but only when the board's own pause record covered the
      // settle: a refusal on a reading the board does not share holds as any (no loop through the ready list at pass rate).
      || (isPauseRefusal(last) && pauseCovered(pause, at, now))
    if (!isReleased) {
      const nextTry = hourMinuteOf(now + Math.max(0, HELD_RETRY_MS - heldMs))
      return result(STATES.HELD, `${isTimedOutAgain ? timedOutTwiceWhy(clearStepOf(last)) : failedWhy(last)}; next try ${nextTry}`, { step: typeof last.step === 'string' ? last.step : null })
    }
  }
  // UNKNOWN after the net: it gets nothing until its next event (a turn end or a report that changed).
  if (takenBack === null && last !== null && Number.isFinite(last.netAt)) {
    const isBack = turnSince >= last.netAt || (Number.isFinite(report?.since) && report.since > last.netAt)
    if (!isBack) return result(STATES.UNKNOWN, `${UNANSWERED_WHY}${typeof last.step === 'string' ? ` (${last.step})` : ''}`, { step: last.step ?? null })
  }
  // Signals change 4: a worker no way could wake gets nothing at a pass until it shows life (its own report starts a new
  // spell), the person opens it, or a new sender comes (src/wake.mjs `nextPath`): never the next task to bounce.
  if (isWakeFailed && !isTurnEnd) return result(STATES.UNKNOWN, WAKE_FAILED_WHY)
  if (!mayHand) return wait()

  // 6. The clear when one is owed, and the ready list's first task this worker may take, in the same call.
  const barred = notOfferedAgain(items, name, prefix)
  const scratch = new Map(items)
  if (takenBack !== null) {
    barred.add(takenBack.id)
    const item = items.get(takenBack.id)
    scratch.set(takenBack.id, { ...item, head: new Map(item.head).set('State', 'refined').set('Owner', '') })
  }
  const noModel = failedModels(envelopes, now)
  const open = ready.filter(one => !barred.has(one.id) && !noModel.has(setFor(one.id)?.model ?? null))
  const given = match({ ready: open, idle: [worker], items: scratch, prefix })[0] ?? null
  const clear = owed === null || owed === undefined ? null : { step: owed.step, reportedAt: owed.reportedAt }
  const said = takenBack === null ? null : `${NOT_TAKEN_WHY.replace('it', takenBack.id)}`
  // The lazy clear (R1, 2026-11-03): no clear is ever sent alone. A free worker that owes one stays FREE and uncleared (an
  // idle chat costs no tokens); the clear rides its next task's envelope. Its lane says nothing of it (D6).
  if (given === null) return result(STATES.FREE, [said, banWhy(envelopes, now)].filter(one => one !== null).join('; ') || null, { takeBack: takenBack })
  const set = setFor(given.id) ?? null
  // Signals change 3: a step the board gave back goes to its next worker as a continuation from its checkpoint.
  const item = items.get(given.id)
  const line = item !== undefined && continuationOf(item) !== null ? continuationLine(item, { localOnly: localOnly.has(given.id) }) : lineFor(given.id)
  return result(STATES.HANDING, said, {
    step: given.id, takeBack: takenBack, give: given.id,
    envelope: { kind: 'task', step: given.id, clear, restart: false, set, line, back: null },
  })
}

/**
 * The envelope as the Workers mod reads it (DESIGN.md, "The envelope's contract for the Workers mod"): `{ id, kind, step,
 * clear, restart, set, line, version }`, from its message in the outbox.
 */
export function contractOf(message) {
  return {
    id: message.id, kind: message.kind ?? 'task', step: message.step ?? null, clear: message.clear ?? null, restart: message.restart === true,
    set: message.set ?? null, line: message.line ?? null, ...(message.restart === true ? { version: message.version ?? null } : {}),
  }
}

/** One short line of a chat's words, or null. */
const lineOf = (value, most = 200) => (typeof value === 'string' && value.trim() !== '' ? value.replace(/\s+/g, ' ').trim().slice(0, most) : null)

/**
 * The outcome the Workers mod posts through `typed` (`body.outcome`), checked: `{ cleared, set, typed, restarted,
 * background, why, clearWhy, typedAt, enteredAt }`, each flag true, false or null (not asked), `why` one short line or null; null for no
 * object. 4c (Workers mod 0.30.0): `typedAt` the mod's clock just before the line's submit, `enteredAt` when the line entered
 * the chat, each a finite time or null (an older mod, no line typed). The lazy clear (0.31.0): `clearWhy`, why its clear did
 * not run (one short line), or null.
 */
export function outcomeOf(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const flag = one => (one === true || one === false ? one : null)
  const time = one => (Number.isFinite(one) ? one : null)
  return { cleared: flag(value.cleared), set: flag(value.set), typed: flag(value.typed), restarted: flag(value.restarted), background: value.background === true, why: lineOf(value.why), clearWhy: lineOf(value.clearWhy), typedAt: time(value.typedAt), enteredAt: time(value.enteredAt) }
}

/** The lazy clear (D1): the stages of a clear at a hand-over, in the order they happen. */
export const CLEAR_STAGES = Object.freeze(['log-saved', 'clear-queued', 'cleared', 'clear-refused'])
/** At most this many stages in one post (each name once). */
const MOST_STAGES = 8

/**
 * The lazy clear (D1): the stages the Workers mod posts through `typed` (`body.stages`, top-level beside `handover`), checked:
 * `[{ stage, at, why?, log?, ticket?, session? }]`, `stage` one of CLEAR_STAGES, `at` the mod's finite time, `ticket` a
 * string (D9: 'clear-<run>-<n>'), the rest short lines; an entry that is not one is left out. Null when none is left.
 * `now`: the board's clock; a stage dated more than a minute past it is left out (a `cleared` far in the future would
 * stand for every later report's clear: no clear owed ever again).
 */
export function stagesOf(value, now = null) {
  if (!Array.isArray(value)) return null
  const stages = []
  for (const one of value.slice(0, MOST_STAGES)) {
    if (one === null || typeof one !== 'object' || !CLEAR_STAGES.includes(one.stage) || !Number.isFinite(one.at)) continue
    if (Number.isFinite(now) && one.at > now + MIN) continue
    const ticket = typeof one.ticket === 'string' || Number.isFinite(one.ticket) ? lineOf(String(one.ticket), 80) : null
    const more = { why: lineOf(one.why), log: lineOf(one.log, 400), ticket, session: lineOf(one.session, 200) }
    stages.push({ stage: one.stage, at: one.at, ...Object.fromEntries(Object.entries(more).filter(([, given]) => given !== null)) })
  }
  return stages.length === 0 ? null : stages
}

/**
 * The lazy clear (D1): the envelope's stages with the new ones added, one entry per stage name (a repeat, as the mod's retry
 * sends, is ignored: the first stays), in the order they came; null when nothing is new.
 */
export function mergeStages(had, incoming) {
  const merged = Array.isArray(had) ? [...had] : []
  const before = merged.length
  for (const one of incoming ?? []) {
    if (!merged.some(stage => stage.stage === one.stage)) merged.push(one)
  }
  return merged.length === before ? null : merged
}

/**
 * The lazy clear (Task 4, D7): a worker's hand-over outcomes that asked a clear, oldest first (`envelopesOf`): every envelope
 * with a clear and an outcome, but a refusal under the person's pause (no clear owed for the worker's sake) and a 0.30.0
 * failed clear without clearWhy (its words are not the clear's alone): neither counts. `{ envelope, isCleared, clearWhy }`.
 */
export function clearOutcomesOf(envelopes) {
  // The Task 4 review: a settled task envelope that asked no clear (none was owed then: the clear had been met) counts as met.
  const isMet = one => (one?.clear ?? null) === null && typeof one?.step === 'string' && (one.outcome ?? null) !== null
  return (envelopes ?? []).filter(one => isMet(one) || ((one?.clear ?? null) !== null && (one.outcome ?? null) !== null && !isPauseRefusal(one)
    && (one.outcome.cleared === true || (one.outcome.cleared === false && typeof one.outcome.clearWhy === 'string' && one.outcome.clearWhy !== ''))))
    .map(envelope => (isMet(envelope) || envelope.outcome.cleared === true ? { envelope, isCleared: true, clearWhy: null } : { envelope, isCleared: false, clearWhy: envelope.outcome.clearWhy }))
}

/** The lazy clear (D6): the clearWhy of the worker's newest hand-over that asked a clear and did not clear, or null. */
export function lastClearWhyOf(envelopes) {
  const last = clearOutcomesOf(envelopes).at(-1) ?? null
  return last === null || last.isCleared ? null : last.clearWhy
}

/** The stages of a clear still on its way: the clear has neither run nor been refused. */
const PENDING_STAGES = ['log-saved', 'clear-queued']

/**
 * The lazy clear (R3, D6): the clear stage of the worker's envelope in flight (no outcome yet, waiting or taken) while its clear
 * is still on its way (its newest stage `log-saved` or `clear-queued`): `{ stage, at }`, else null.
 */
export function clearingOf(envelopes) {
  const last = (envelopes ?? []).filter(one => one?.kind !== RESUME_KIND).at(-1) ?? null
  if (last === null || (last.outcome ?? null) !== null || !['waiting', 'taken'].includes(last.state) || !Array.isArray(last.stages)) return null
  const newest = [...last.stages].filter(one => Number.isFinite(one?.at)).sort((a, b) => a.at - b.at).at(-1) ?? null
  return newest === null || !PENDING_STAGES.includes(newest.stage) ? null : { stage: newest.stage, at: newest.at }
}

/** The lane's words for a state of the sequence (quiet: information, never amber), or null where the lane says enough. */
export function laneWords(decision) {
  if (decision === null || decision === undefined) return null
  const step = decision.step ?? null
  switch (decision.state) {
    // An envelope without a task: the back words, or a clear alone an older board wrote (the lazy clear writes none).
    case STATES.HANDING: return step !== null ? `handing over ${step}` : decision.kind === 'back' ? 'handing over its words' : decision.kind === 'clear' ? 'handing over: its clear' : 'handing over'
    case STATES.OFFERED: return `offered ${step}, not taken yet`
    case STATES.HELD: return `held: ${decision.why ?? 'no reason given'}`
    case STATES.UNKNOWN: return decision.why === null ? 'unknown' : decision.why.startsWith(UNANSWERED_WHY) || decision.why === RESTART_LATE_WHY ? decision.why : null
    case STATES.FREE: return typeof decision.why === 'string' && decision.why.includes(BAN_WHY_MARK) ? decision.why : null
    case STATES.RESTARTING: return 'restarting for the new Workers mod'
    case STATES.CHECKING: return step === null ? null : `${step}: the board checks its report`
    default: return null
  }
}
