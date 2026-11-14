// B532: the outbox holds only words that still matter. At every refresh (and before a chat takes its words) each word
// that waits is judged: still needed, or closed with its reason in outbox.jsonl (`dropped` for a word that no longer
// matters, `expired` for one that waited longer than it is kept), so nothing waits for ever in silence and the page
// says what became of it. A person's answer (an ask set) is never closed here: it waits for its chat however old (B548),
// also one that is off on purpose. A word the chat took and could not type is retried (store.mjs retryFailed) before the judging.
// B571: a word that failed and is not tried again (it failed before B532 kept its time, its tries ran out, the mod
// refused it) is judged too: once its purpose is gone it is closed `dropped` with its why, so the health summary and
// rule 8 stop naming it; one that still matters stays failed, for the person to see.

import { shownChats } from '../bridge.mjs'
import { heldTooLong, isHandTaken, isMootSpawn, isTaskStopWord, mootWhy, stopSettleWhy } from '../hands.mjs'
import { RESUME_STEP, isLimitStopWord, waitsLong } from '../say.mjs'
import { DOUBT_MS, isLate, keepMs } from '../store.mjs'
import { stoppedOf } from '../stopped.mjs'
import { familyOf, isSetRefused, sameModel } from './effort.mjs'
import { TRIES } from './passing.mjs'
import { HANDS_FIRST_MS } from '../hands.mjs'
import { stamp } from './migrate.mjs'
import { OLD_CHECK_WHY } from './qaTask.mjs'
import { gitCheckAtMs, gitCheckPassed } from './resultCheck.mjs'
import { readStore } from './store.mjs'
import { RESUME_KIND, TIMED_STATES, markerStep } from './holderTimers.mjs'
import { WITH_WORKER } from './rethink.mjs'
import { workLineWhy } from './workLines.mjs'
import { isUntaken, untakenWhy } from './judgeWord.mjs'

/** P2: why a waiting "back to you" word is closed when its step's check passed since. */
export const BACK_PASSED_WHY = 'its check passed since (board re-run)'
const firstLine = text => String(text ?? '').split('\n')[0]
const span = ms => (ms >= 2 * 3_600_000 ? `${Math.round(ms / 3_600_000)} hours` : `${Math.round(ms / 60_000)} min`)

/** The words that stand for the same thing: same chat, command, step, plan item or round. A newer one replaces the older. */
const kindOf = message => [message.to, message.command ?? '', message.kind ?? '', message.about ?? '', message.command === 'round' ? firstLine(message.text) : ''].join('\u0001')

const value = (item, key) => {
  const found = item?.head.get(key)
  return found === undefined || found === '' || found === '-' ? null : found
}

/** What became of an alive newer word to count as a replacement: it reached the chat or still waits for it. */
const isStanding = message => ['waiting', 'taken', 'delivered', 'copied'].includes(message.state)

/**
 * The reason a waiting word no longer matters, or null. `ctx`: `all` (every word of the outbox), `items` (the work store's
 * items by id, null when the board has no store), `runs` (chat name to whether it runs), `goals` (the goal map's nodes),
 * `now`, `keep`, `closing` (what this sweep closes already), `lanes` (the board's chats, with the effort and model each runs at),
 * `onBoard` (B880: the names of the chats on the board now, the partner, helper, supervisor and Product owner among them),
 * `supervisor` (B1174: the Supervisor's lane, with its wake, for why a judge word went untaken; null for none).
 */
export function whyClosed(message, ctx) {
  // A person's answer waits for its chat, also one that is off on purpose.
  if ((message.ask ?? null) !== null) return null
  const { all, items, now, keep } = ctx
  // A work line is the work store's: judged by its step (workLines.mjs), waiting or failed; withdrawStale (deliver.mjs)
  // closes it, with the start it asked. B589: this answer is the health summary's and rule 8's, which until then named
  // a failed one whose step was done (X3). Without a store the board cannot judge it: it matters.
  if (message.command === 'work') {
    const why = items instanceof Map ? workLineWhy(message, items, { prefix: ctx.prefix ?? '', now, assets: ctx.assets }) : null
    return why === null ? null : { state: 'dropped', why }
  }
  // B812 (X109): a stop word waits for its worker's next idle moment however long its turn runs, while it holds a step.
  if (isLimitStopWord(message.command)) return stopWordWhy(message, ctx)
  // B1071 (X2): the person's stop or remove by code is settled as done once its worker stopped.
  if (isTaskStopWord(message)) return taskStopWhy(message, ctx)
  // T8.5: an envelope with a task matters while that task is still given to its worker (the decision takes it back and
  // closes the envelope itself; this catches a task the person moved meanwhile). One without a task waits until late.
  if (message.command === 'handover') {
    // Signals change 3: the "go on" line to a stopped holder (step null, its step in its `resume` marker) matters while its
    // worker still holds that step, taken or in progress; the decision closes it with the give-back.
    if (message.kind === RESUME_KIND) {
      const id = markerStep(message.resume)
      const held = id === null || !(items instanceof Map) ? undefined : items.get(id)
      if (id !== null && items instanceof Map && !(held !== undefined && TIMED_STATES.includes(value(held, 'State')) && plainName(value(held, 'Owner'), ctx.prefix ?? '') === plainName(message.to, ctx.prefix ?? ''))) {
        return { state: 'dropped', why: `${message.to} no longer holds ${id}` }
      }
      return isLate(message, now, keep) ? expired(message, keep) : null
    }
    // P2 (T2.11): a "back to you" word still waiting (kind back, `back` = "<step> <failed check>") is stale once its step's board check
    // passed after the word was made (the repair faults-gone re-ran it): closed here, not handed over later.
    if (message.kind === 'back' && message.state === 'waiting' && typeof message.back === 'string' && items instanceof Map) {
      const held = items.get(message.back.split(' ')[0])
      if (held !== undefined && gitCheckPassed(held) && gitCheckAtMs(held) > message.at) return { state: 'dropped', why: BACK_PASSED_WHY }
    }
    // X107/X3 (2026-11-02 15:12-15:14, Worker 2): a clear that failed ("a new prompt came in before the clear") and that a
    // later envelope's clear to the same chat finished is no undelivered word: its purpose is done.
    if (message.state === 'failed' && message.clear !== null && message.clear !== undefined) {
      const later = (all ?? []).find(one => one?.command === 'handover' && one.to === message.to && one.at > message.at && one.state === 'delivered' && one.outcome?.cleared === true)
      if (later !== undefined) return { state: 'dropped', why: `its clear ran with a later envelope (${stamp(later.settledAt ?? later.at)})` }
    }
    const item = typeof message.step === 'string' && items instanceof Map ? items.get(message.step) : undefined
    if (item !== undefined && !(value(item, 'State') === 'queued' && plainName(value(item, 'Owner'), ctx.prefix ?? '') === plainName(message.to, ctx.prefix ?? ''))) {
      return { state: 'dropped', why: `${message.step} is no longer given to ${message.to}` }
    }
    return isLate(message, now, keep) ? expired(message, keep) : null
  }
  // B813 (X2): the word that sets a worker's model and effort no longer matters once a newer one for that worker stands,
  // or the worker runs at its setting already; waiting or failed.
  // B1160 (verifier 4, 5, 7): a partner's set word the app refused, with no try left (or tried again already), is closed quietly in plain
  // words, marked refused: never an undelivered word with the app's raw text for rule 8. While a copy is on its way it stays as it is.
  if (message.command === 'partner-effort' && message.state === 'failed' && isSetRefused(message) && (message.retriedAs !== undefined || (message.tries ?? 1) >= TRIES)) {
    return { state: 'dropped', refused: true, why: "the app refuses the board's set calls; your partner runs on its current setting" }
  }
  // B1160 round 3, item 6: the probe is a hand's alone: one that no hand carried within HANDS_FIRST_MS, or that failed for another reason
  // than the refusal, is closed in plain words (the next probe comes a day later); a refused one is closed below as refused.
  // F5 review 10: a probe a hand gave back in doubt stays open until DOUBT_MS passed, so the hand's late answer still settles it.
  const isProbeInDoubt = message.probe === true && message.state === 'waiting' && Number.isFinite(message.doubtAt) && now - message.doubtAt < DOUBT_MS
  if (message.command === 'worker-effort' && message.probe === true && !isSetRefused(message) && !isProbeInDoubt
    && ((message.state === 'waiting' && now - message.at >= HANDS_FIRST_MS) || message.state === 'failed')) {
    return { state: 'dropped', why: 'the check whether the app lets the board set again could not run; the next comes later' }
  }
  // F5 review 4, 13: a set word for Main's model that Main has not taken yet is moot once its hand-over went on without it (its envelope
  // no longer waits for it): never typed later, mid-step or twice.
  if (message.command === 'worker-effort' && message.forModel === true && message.state === 'waiting' && typeof message.envelope === 'string') {
    const envelope = all.find(one => one.id === message.envelope)
    if (envelope === undefined || envelope.state !== 'waiting' || envelope.waitsFor !== message.id) return { state: 'dropped', why: 'its hand-over went on without it' }
  }
  if (message.command === 'worker-effort') {
    // B1160 review 6: a set word the app refused (in auto mode it does not run a plugin's own set call) is closed at once, in plain words,
    // kept marked `refused` so the board knows the refusal stands (effort.mjs `setsRefusedOf`): never an undelivered word for rule 8.
    if (message.state === 'failed' && isSetRefused(message)) return { state: 'dropped', refused: true, why: "the app refuses the board's set calls; it runs on its current model" }
    const newer = all.find(one => one.id !== message.id && one.at > message.at && isStanding(one) && kindOf(one) === kindOf(message))
    if (newer !== undefined) return { state: 'dropped', why: `superseded by a newer word for ${message.about}'s setting (${stamp(newer.at)})` }
    const lane = (ctx.lanes ?? []).find(one => one.name === message.about && !one.isLeftover)
    // B1160: the probe asks the chat's own setting on purpose (its hand's answer is the point): never met before a hand took it.
    // F5 verifier 1, 5: an effort the app's file does not show is not judged: the model alone counts then (as the hand-over pass's runsIt).
    const effortMet = lane !== undefined && (lane.effort === message.effort || ((lane.effort ?? null) === null && (message.model ?? null) !== null))
    if (message.probe !== true && lane !== undefined && effortMet && ((message.model ?? null) === null || sameModel(lane.model, message.model))) {
      // B1051 (X153): the setting was met: a success, not a failure. `met` tells the hand-over pass so (it waits for this word).
      return { state: 'dropped', met: true, why: `${message.about} runs at ${(message.model ?? null) === null ? '' : `${familyOf(message.model)} · `}${message.effort} already` }
    }
  }
  // B880 (X2): a start word for a chat that is on the board now (the Product owner's routine) is moot, waiting or failed.
  if (isMootSpawn(message, ctx.onBoard)) return { state: 'dropped', why: mootWhy(message) }
  // A word that is stale in minutes (a pause's resume, a line typed in a talk) is only closed once it is late.
  if (!waitsLong(message.command)) return isLate(message, now, keep) ? expired(message, keep) : null
  // B571: the goal guard's word: not needed once the goal is done or was evaluated after the word was sent (B359),
  // named by the first evaluation after it ("G15 was evaluated (2026-10-24 16:06)"), before any newer word of its kind.
  if (message.command === 'evaluate') {
    const goal = (ctx.goals ?? []).find(one => one.id === message.about)
    const after = [...(goal?.evaluatedAt ?? [])].sort().find(at => at >= stamp(message.at)) ?? null
    if (goal?.state === 'done') return { state: 'dropped', why: `${message.about} is done` }
    if (after !== null) return { state: 'dropped', why: `${message.about} was evaluated (${after})` }
  }
  const newer = all.find(one => one.id !== message.id && one.at > message.at && isStanding(one) && kindOf(one) === kindOf(message))
  if (newer !== undefined) return { state: 'dropped', why: `superseded by a newer word of the same kind (${stamp(newer.at)})` }
  const item = items?.get(message.about)
  const state = value(item, 'State')
  if (items !== null && message.command === 'refine') {
    // A step is refined while it is new; a later round (B387: three in a row) also while it waits refined.
    const holds = state === 'new' || (state === 'refined' && (message.round ?? 1) > 1)
    if (!holds) return { state: 'dropped', why: item === undefined ? 'the step is gone' : `the step is ${state} now, not new` }
  } else if (message.command === 'result-check') {
    // T9.1.1: the result check is a Quality Assurance task now, and the Advisor can no longer file a step check: an old word of the
    // board's is closed whatever the state of its step (also without a store to judge it by).
    return { state: 'dropped', why: OLD_CHECK_WHY }
  } else if (message.command === 'start') {
    // The main chat's word to open a closed chat: not needed once that chat runs, nor when nothing waits for it any more.
    if (ctx.runs.get(message.about) === true) return { state: 'dropped', why: `${message.about} runs now` }
    // T9.4 (review of 2026-10-25): a start word waits for the chat that carries it. One that is known not to run can never carry it, so
    // it is closed and the board asks another chat that runs (say.mjs wakesDue). The main chat's waits for it however: it is the board's order to it.
    if (message.to !== ctx.main && ctx.off?.has(message.to) === true) return { state: 'dropped', why: `${message.to} does not run, so it cannot carry the start of ${message.about}` }
    // B590: a ready task waits for it too: one pinned to it, or, for a start the hand-out made, one kept for nobody.
    // T9.4: a start word to the main chat (the hand-out's, a worker to start) waits for it too, so the word that has a chat that runs
    // start the main chat is not dropped for want of anything waiting for it; a start to any other chat still holds nothing.
    const waits = all.some(one => one.to === message.about && one.id !== message.id && one.state === 'waiting' && (one.command !== 'start' || one.to === ctx.main) && !ctx.closing.has(one.id))
      || readyFor(message, ctx)
    if (!waits) return { state: 'dropped', why: `nothing waits for ${message.about} any more` }
  } else if (message.command === RESUME_STEP) {
    // 2026-10-26: the board's word that has a worker go on with its step after a crash (say.mjs `resumesDue`). Its purpose is
    // to have the chat started: done once the chat runs again, and gone when the chat no longer holds the step in the store.
    if (ctx.runs.get(message.to) === true) return { state: 'dropped', why: `${message.to} runs again` }
    if (items !== null) {
      if (item === undefined) return { state: 'dropped', why: 'the step is gone' }
      if (!['taken', 'in progress'].includes(state)) return { state: 'dropped', why: `the step is ${state} now` }
      if (plainName(value(item, 'Owner'), ctx.prefix ?? '') !== plainName(message.to, ctx.prefix ?? '')) return { state: 'dropped', why: `${message.to} no longer holds ${message.about}` }
    }
  } else if (message.command === 'judge' && items !== null && Array.isArray(message.incidents)) {
    // Signals change 6 (B915): the Supervisor's judge word: moot once none of its incidents waits any more (each closed, fixed,
    // gone by itself or being fixed), so a chat that did not run for hours is not typed a judgment of nothing.
    const waits = message.incidents.some(id => ['open', 'came back', 'with the supervisor'].includes(value(items.get(id), 'State')))
    if (!waits) return { state: 'dropped', why: `none of ${message.incidents.join(', ')} waits for a judgment any more` }
    // B1174 (X43): one its chat did not take within 30 min holds no later judgment: closed with why (judgeWord.mjs), its incidents wait again.
    if (isUntaken(message, now, keep)) return { state: 'expired', untaken: true, why: untakenWhy(message.to, ctx.supervisor?.name === message.to ? ctx.supervisor : null) }
  } else if (message.command === 'wake' && ctx.stopped instanceof Map) {
    // B577: the main chat's word to wake a stopped chat: not needed once that chat began a turn, or another session
    // stands under its name (a chat replaced), or nothing waits for it any more.
    if ((ctx.stopped.get(message.about) ?? null) === null) return { state: 'dropped', why: `${message.about} is no longer stopped` }
  }
  return isLate(message, now, keep) ? expired(message, keep) : null
}

/**
 * B812 (X109: the week's stop word to Worker 4, which held B494, expired after the 10 min keep while its turn ran on): the
 * reason a stop word no longer matters, or null while it does. It matters until its limit resets, and while its worker holds
 * a step not yet reported (taken or in progress as its Owner, or handed back by a failed check: say.mjs `holdsOpenStep`).
 * Without a store the board cannot tell what the worker holds: the word waits until the reset (its window, when no reset is known).
 */
function stopWordWhy(message, ctx) {
  const resets = message.command === 'week-stop' ? message.weekResets : message.fiveHourResets
  const limit = message.command === 'week-stop' ? 'the weekly limit' : 'the 5-hour limit'
  if (Number.isFinite(resets) && ctx.now >= resets) return { state: 'dropped', why: `${limit} reset at ${stamp(resets)}` }
  // A reset the board did not know: the word lasts the limit's window at most, so it never waits for ever.
  if (!Number.isFinite(resets) && ctx.now - message.at >= (message.command === 'week-stop' ? 7 * 24 : 5) * 3_600_000) return { state: 'dropped', why: `${limit} has reset since the word was sent` }
  if (!(ctx.items instanceof Map) || (ctx.handedBack ?? []).includes(message.to)) return null
  const name = plainName(message.to, ctx.prefix ?? '')
  const holds = [...ctx.items.values()].some(item => ['taken', 'in progress'].includes(value(item, 'State')) && plainName(value(item, 'Owner'), ctx.prefix ?? '') === name)
  return holds ? null : { state: 'dropped', why: `${message.to} holds no step not yet reported, so there is no work to stop` }
}

/**
 * B1071 (X2, 2026-11-08 22:28: the person's Stop of Worker 1 on B1070 reached it in a minute, its stop checkpoint gave the step back
 * at 22:28:47 and its turn ended; the word to the main chat stayed waiting, expired at 10 min and rule 8 named it, the 4th time X2
 * came back). Until then only a hand's call settled such a word, through a settle that touches taken words only: a waiting one was
 * never settled. Now every refresh settles it as done (`delivered`, with its why) at the event that already gives the step back:
 * - a stop: its worker's turn ended after it, or its chat does not run or left the board (hands.mjs `stopStep`, `stopSettleWhy`);
 *   or the step it names is no longer held by its worker (its stop checkpoint gave it back, or the person moved it);
 * - a remove: only once its worker left the board; a hand takes it out otherwise.
 * Never by a timer: an unsettled word is kept STOP_HANDS_MS and a plain word's keep (store.mjs `keepMs`), then expires.
 */
function taskStopWhy(message, ctx) {
  if (message.state !== 'waiting') return null
  const lane = (ctx.lanes ?? []).find(one => !one.isLeftover && one.name === message.about)
  const settled = stopSettleWhy(message, lane, at => stamp(at).slice(11, 16))
  if (settled !== null) return { state: 'delivered', why: settled }
  if (message.command === 'stop' && ctx.items instanceof Map && typeof message.taskStep === 'string') {
    const item = ctx.items.get(message.taskStep)
    const prefix = ctx.prefix ?? ''
    // A step the store does not show: the board cannot tell, so the word waits (as a limit stop does).
    const holds = item === undefined || (WITH_WORKER.includes(value(item, 'State')) && plainName(value(item, 'Owner'), prefix) === plainName(message.about, prefix))
    // Told and given back (its stop checkpoint): done; never told, the step moved on by the person: moot.
    if (!holds) return Number.isFinite(message.toldAt)
      ? { state: 'delivered', why: `carried out by code: ${message.about} was told and no longer holds ${message.taskStep} (${value(item, 'State')})` }
      : { state: 'dropped', why: `${message.about} no longer holds ${message.taskStep} (${value(item, 'State')}): nothing to stop` }
  }
  return isLate(message, ctx.now, ctx.keep) ? expired(message, ctx.keep) : null
}

/** A chat's name for comparing: without the list's prefix, in lower case. */
const plainName = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}

/**
 * B590: whether a start word's reason holds on the ready list (`ctx.ready`, state.readyList.ready): a ready task pinned
 * to its chat, or, for a start the hand-out made (handOut.mjs `workerStart`; its word carries `reported`), one kept for
 * nobody.
 */
const readyFor = (message, ctx) => {
  const name = plainName(message.about, ctx.prefix ?? '')
  return (ctx.ready ?? []).some(one => (typeof one.pinned === 'string' && plainName(one.pinned, ctx.prefix ?? '') === name)
    || (Number.isFinite(message.reported) && (one.keptFor ?? null) === null))
}

/** B571: a word that failed and is not tried again: no newer word stands for it. */
export const isFailedForGood = message => message?.state === 'failed' && message.retriedAs === undefined

const expired = (message, keep) => ({ state: 'expired', why: `waited longer than ${span(keepMs(message, keep))}` })

/**
 * 0.31.0, Task 6 (the Advisor's case of 2026-11-04: 09:31:48, 10:06:48, 11:19:40): the app dequeues the words the mod typed while
 * its chat was busy all at once, MERGED into one prompt, and only the last submit resolves: a mod before 0.31.0 never says the
 * earlier ones typed, and they stayed `taken` for ever. The mod of 0.31.0 confirms them itself (a turn whose prompt holds a word
 * has entered it); this is the board's net for the rest: how long a word its own chat took is still `taken` after the chat went
 * idle from a turn that came after the take, before it is closed `delivered`, unconfirmed. The whole-branch review: counted from
 * the idle, never from the turn's start: a turn that came after the take may not carry the word at all (the person's line or a
 * task notification that started while the word was still queued), and while it runs the word is not in it yet.
 */
export const UNCONFIRMED_MS = 15 * 60_000
export const UNCONFIRMED_WHY = 'delivered-unconfirmed: its chat ran a turn after it and never said'

/**
 * Fix 0.31.0 (the Advisor's own case: it is no lane, so the net never judged it): the report the board holds of the chat
 * called `name`, as `unconfirmedOf` reads a lane's (`{ state, since, turn }`), or null. The lane's own (state.chats: its
 * report is the one of the session the board shows); for a side chat (the partner, its helper, the Supervisor, the Product
 * owner: `shownChats`) the report kept under its name (`state.reported`, state.mjs) when it is of the session the board shows
 * for it; for a chat of neither list the report kept under its name. A name the list's prefix may or may not carry.
 */
export function reportOf(state, name) {
  const prefix = state?.chatPrefix ?? ''
  const same = chat => typeof chat?.name === 'string' && plainName(chat.name, prefix) === plainName(name, prefix)
  const lane = (state?.chats ?? []).find(chat => chat?.isLeftover !== true && same(chat))
  if (lane !== undefined) return lane.report ?? null
  const key = Object.keys(state?.reported ?? {}).find(one => plainName(one, prefix) === plainName(name, prefix))
  const kept = key === undefined ? null : state.reported[key] ?? null
  const side = shownChats(state ?? {}).find(same)
  return side === undefined ? kept : kept !== null && kept.session === side.session ? kept : null
}

/**
 * B1033 (X141: Worker 3's clear after B981, taken at 12:24 and never settled): a clear-only hand-over (a clear, no task, no line,
 * no restart) that an older board wrote. No clear goes alone since Workers mod 0.31.0, so no outcome of its own is coming for
 * one still taken: the net judges it as a plain word. A task envelope keeps its own outcome.
 */
const isClearOnly = message => (message.clear ?? null) !== null && typeof message.step !== 'string' && typeof message.line !== 'string' && message.restart !== true

/**
 * The reason, and the time, a taken word counts as delivered, or null: a word its own chat took (never a hand's take, B880's
 * own net; never a task hand-over envelope, whose outcome is its own; a clear-only one is judged, B1033), the chat's report (the lane's `report.turn`: the start of its
 * last turn, from a mod that says it) names a turn that began after the take, the chat is IDLE since that turn (`report.state`
 * idle, its `since` not before the turn's start: a busy, asking or ended chat is not judged), and the idle is UNCONFIRMED_MS
 * old. `deliveredAt` is that turn's start. A chat with no report, or one that does not name its turn, is not judged: the board
 * does not guess it.
 */
export function unconfirmedOf(message, lane, now) {
  if (message?.state !== 'taken' || isHandTaken(message) || (message.command === 'handover' && !isClearOnly(message))) return null
  const { turn, state, since } = lane?.report ?? {}
  if (!Number.isFinite(turn) || !Number.isFinite(message.takenAt) || turn <= message.takenAt) return null
  if (state !== 'idle' || !Number.isFinite(since) || since < turn || now - since < UNCONFIRMED_MS) return null
  return { state: 'delivered', why: UNCONFIRMED_WHY, deliveredAt: turn }
}

/**
 * The words `unconfirmedOf` closes, as `{ id, state, why, deliveredAt }`; `to`, when given, only those to that chat. Fix 0.31.0: every chat
 * whose report the board holds is judged (`reportOf`), not the lanes of `state.chats` alone.
 */
export function unconfirmedWords({ outbox, state, now, to = null }) {
  const closing = []
  for (const message of outbox) {
    if (message?.state !== 'taken' || (to !== null && message.to !== to)) continue
    const closed = unconfirmedOf(message, { report: reportOf(state, message.to) }, now)
    if (closed !== null) closing.push({ id: message.id, ...closed })
  }
  return closing
}

/**
 * Fix 0.31.0: how long a word its chat took may stand `taken` when the board knows that chat no more (no lane, no side chat, no
 * report kept under its name) before it is closed `expired`; and its why (`goneWhy`).
 */
export const GONE_AFTER_MS = 24 * 3_600_000
export const goneWhy = to => `expired: its chat ${to} is no longer on the board`

/**
 * The words taken by a chat the board no longer knows (no lane, no side chat, no report held under its name, the list's prefix
 * ignored) over GONE_AFTER_MS ago, as `{ id, state: 'expired', why }`. Never a hand's take (B880's own net), never a hand-over
 * envelope (its outcome is its own), never a person's answer (it waits for its chat however old). A board that knows no chat
 * (its list could not be read) or holds no reports (`state.reported` null) says nothing of any chat: nothing is closed.
 */
export function vanishedChatWords({ outbox, state, now }) {
  const prefix = state?.chatPrefix ?? ''
  const lanes = (state?.chats ?? []).filter(chat => chat?.isLeftover !== true)
  if (lanes.length === 0 || state?.reported === null || typeof state?.reported !== 'object') return []
  const known = new Set([...shownChats(state), ...Object.keys(state.reported).map(name => ({ name }))].map(chat => plainName(chat.name, prefix)))
  const closing = []
  for (const message of outbox) {
    if (message?.state !== 'taken' || isHandTaken(message) || message.command === 'handover' || (message.ask ?? null) !== null) continue
    if (!Number.isFinite(message.takenAt) || now - message.takenAt <= GONE_AFTER_MS || known.has(plainName(message.to, prefix))) continue
    closing.push({ id: message.id, state: 'expired', why: goneWhy(message.to) })
  }
  return closing
}

/**
 * One sweep: retries the words that failed, then closes what no longer matters. The words closed, as
 * `{ id, state, why }` (a replay on a copy of the outbox passes `dry: true`: nothing is written then). `to`, when given,
 * judges only the words to that chat (a chat's take: the store is read only when something waits for it).
 */
export async function sweepOutbox({ dir, outbox, state, now, keep, fs, dry = false, to = null }) {
  // Without the outbox's keep (a caller that delivers work lines only) nothing is judged.
  if ((keep ?? null) === null) return []
  if (!dry) await giveBackHeld(outbox, now)
  if (!dry) await outbox.retryFailed(now, keep)
  // B577: at a refresh, the words that failed for a chat's old session go to the session the board shows under its name now.
  if (!dry && to === null && typeof outbox.revive === 'function') await outbox.revive(sessionsOf(state), now, keep)
  // 0.31.0, Task 6: a taken word whose chat ran a turn after it and never said is closed delivered, unconfirmed (the merged words).
  const confirmed = unconfirmedWords({ outbox: outbox.outbox(), state, now, to })
  if (!dry && confirmed.length > 0 && typeof outbox.deliverUnconfirmed === 'function') await outbox.deliverUnconfirmed(confirmed)
  // Fix 0.31.0: a word taken over 24 h ago by a chat the board no longer knows is closed expired (a refresh's, not a chat's take).
  const gone = to === null ? vanishedChatWords({ outbox: outbox.outbox(), state, now }) : []
  if (!dry && gone.length > 0 && typeof outbox.closeTaken === 'function') await outbox.closeTaken(gone, now)
  const settled = [...confirmed, ...gone]
  // B571: with the failed words that are not tried again, judged as the waiting ones; only a word whose purpose is gone
  // is closed among those (an old failed word is not "expired": it never waited).
  // B589: not the work lines: withdrawStale (deliver.mjs) closes them by the same judge, with the start they asked.
  const waiting = outbox.outbox().filter(message => (message.state === 'waiting' || isFailedForGood(message)) && message.command !== 'work' && (to === null || message.to === to))
  if (waiting.length === 0) return settled
  const items = (dir ?? null) === null ? null : (await readStore(dir, fs)).items
  const runs = new Map((state?.chats ?? []).filter(chat => !chat.isLeftover).map(chat => [chat.name, chat.isRunning === true]))
  // T9.4: the chats known not to run (not those the board cannot tell about), the partner, its helper and the supervisor's among them.
  const off = new Set(shownChats(state ?? {}).filter(chat => chat.isRunning === false).map(chat => chat.name))
  const all = outbox.outbox()
  const closing = new Map()
  const ctx = { all, items, runs, goals: state?.goals?.nodes ?? [], now, keep, closing, stopped: stoppedChats(all, state), prefix: state?.chatPrefix ?? '', ready: state?.readyList?.ready ?? [], main: state?.restart?.main ?? null, off, handedBack: state?.reconciled?.handedBack ?? [], lanes: state?.chats ?? [], onBoard: new Set(shownChats(state ?? {}).map(chat => chat.name)), supervisor: state?.supervisorChat ?? null }
  // The starts last: they depend on what the other words become.
  const ordered = [...waiting.filter(message => message.command !== 'start'), ...waiting.filter(message => message.command === 'start')]
  for (const message of ordered) {
    const closed = whyClosed(message, ctx)
    if (closed !== null && (message.state === 'waiting' || closed.state === 'dropped')) closing.set(message.id, { id: message.id, ...closed })
  }
  // B1071: a stop settled as done is closed delivered, at this sweep.
  if (!dry) for (const one of closing.values()) await outbox.close(one.id, one.state, one.why, now, one.met === true ? { met: true } : one.refused === true ? { refused: true } : one.untaken === true ? { untaken: true } : one.state === 'delivered' ? { deliveredAt: now } : {})
  return [...settled, ...closing.values()]
}

/**
 * B880 (X2): the words a hand has held for HAND_HOLD_MS without a word of them go back to waiting, each in its hand's name (its
 * late answer still counts: store.mjs `deliveredLate`), with a line in the board's log. How many went back.
 */
export async function giveBackHeld(outbox, now, log = line => console.log(line)) {
  let given = 0
  for (const id of heldTooLong(outbox.outbox(), now)) {
    // Judged again right before it goes back, with no wait between: a word another sweep gave back meanwhile, and a hand
    // took anew, is that hand's now.
    const message = outbox.outbox().find(one => one.id === id)
    if (message === undefined || heldTooLong([message], now).length === 0) continue
    const { takenBy, takenAt } = message
    // B891: in doubt: its call may have acted.
    if ((await outbox.back([id], takenBy, now, [id])) === 0) continue
    given += 1
    const since = new Date(takenAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    log(`B880: gave back the word ${id} (${message.command ?? 'answer'}${message.about ? ` ${message.about}` : ''}) that ${takenBy}'s hand held since ${since} without a word of it.`)
  }
  return given
}

/** B577: the session the board shows under each chat's name. */
const sessionsOf = state => new Map(shownChats(state ?? {}).filter(chat => typeof chat.session === 'string' && chat.session !== '').map(chat => [chat.name, chat.session]))

/** B577: per chat the board shows, its stop (src/stopped.mjs `stoppedOf`): `{ since, words }`, or null. */
export const stoppedChats = (outbox, state) => new Map(shownChats(state ?? {}).map(chat => [chat.name, stoppedOf(outbox, chat)]))

/**
 * B548: a chat's take: the sweep of that chat's words first (a failed sweep is said and the take goes on), so a chat is
 * never handed a word whose purpose is gone, then what still waits for it (store.mjs `take`).
 */
export async function takeFor({ dir, outbox, state, now, keep, chat, only, fs }) {
  await sweepOutbox({ dir, outbox, state, now, keep, fs, to: chat }).catch(error => console.error(`The outbox sweep failed: ${error.message}`))
  // B577: a chat whose session was stopped takes nothing until it gets input (the app would drop every word): its words
  // wait, and the main chat is asked to wake it (say.mjs `wakesStopped`).
  const lane = shownChats(state ?? {}).find(one => one.name === chat)
  if (stoppedOf(outbox.outbox(), lane) !== null) return []
  return outbox.take(chat, now, keep, only)
}
