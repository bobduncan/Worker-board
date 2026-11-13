// The supervisor's watch rules (spec 2026-10-24, "What it checks"): report only. The person, 2026-10-24: "its goal is to
// periodically check if, e.g. the board is out of sync, if workers are correctly suspended or not, if the system is
// working like intended". That morning the workers stood still for hours (a cleared worker counted as "unknown" and got
// no next step; three workers stayed "suspended" on a limit stop of days before) and the self-check, which only knows
// its own patterns, did not see it. Each rule here is one such pattern, with its threshold in the settings
// (config.mjs SUPERVISOR_DEFAULTS); what it finds becomes an incident (incidents.mjs), never a repair. A new incident no
// rule caught gets a fix step that adds its rule here, so it is caught for free next time.
//
// A rule is `{ id, kind: 'watch', says, check(view, ctx) }`; `check` reads the view (view.mjs) and answers its findings,
// `{ rule, key, subject, text, evidence }`: `key` names the finding for counting (the same key while it lasts, so one
// incident counts up), `subject` the chat or step it is about, `text` one plain line, `evidence` what it saw. `ctx`
// holds the supervisor's own watch: `seen` (since when it first saw what only counts once it lasts) and `observed`
// (what it sees now; the loop keeps those and forgets the rest). PURE.

import { RETIRED_WATCH_RULES, givenBackFrom } from '../../work/holderTimers.mjs'
import { SUPERVISOR_DEFAULTS } from '../../config.mjs'
import { askFiledMs, sinceMs, valueOf } from '../../work/item.mjs'
import { overlapIn } from '../../work/guards.mjs'
import { afterPause as afterPauseOf, checkpointOf, heldMs, holdEndOf, isHolding, pauseEndOf as pauseEnd } from '../../work/pause.mjs'
import { isFailedForGood, stoppedChats, whyClosed } from '../../work/outboxSweep.mjs'
import { FIRST_SAYING, chatsByRole, oldModFinding } from '../../oldMods.mjs'
import { EFFORTS, chatEffort, effortOf, effortSaid, familyOf, modelOf } from '../../work/effort.mjs'
import { chainTries, chainWaitOf, hasTriedBefore, reviewWaitOf, waitsForPerson } from '../../work/resultCheck.mjs'
import { madeAtMs, openQaTaskOf, qaStandOf } from '../../work/qaTask.mjs'
import { isWordingOnly } from '../../work/recapWords.mjs'
import { BAN_WHY_MARK, CLEAR_ONLY_CLOSED_WHY, CLEAR_ONLY_TAKEN_WHY, NET_MS, STATES, UNANSWERED_WHY, clearOutcomesOf, envelopesOf } from '../../work/handover.mjs'
import { readingAgeMinutes } from '../../limits.mjs'
import { OTHER_ACCOUNT_TAIL, RESTART_WHY } from '../../ownChat.mjs'
import { BOUNDED_RULES, COUNTS_BY_KEY } from './repair.mjs'
import { BOARD_TRIES } from '../../refineGate.mjs'
import { rebuildHoldOf } from '../../goalGuard.mjs'
import { DEAF_KEEP_MS } from '../../hearing.mjs'
import { isSleep, stallWords } from '../../stallWords.mjs'
import { STOP_HANDS_MS, isHandTaken, isTaskStopWord } from '../../hands.mjs'
import { triedWords } from '../../wake.mjs'
import { isRethinkHold, rethinkWords } from '../../work/rethink.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
/** How far back a word that expired or failed still counts as undelivered. */
const UNDELIVERED_LOOK_MS = 2 * HOUR
/** The window of each limit: a pause older than its limit's window has outlived any stop of it. */
const WINDOW_MS = { fiveHour: 5 * HOUR, week: 7 * DAY }
const LIMIT_WORDS = { fiveHour: 'the 5-hour limit', week: 'the weekly limit' }
/**
 * Reasons a compaction is skipped by design, not by a fault: a small chat, compaction switched off, or more of the same
 * work following (the Workers mod keeps the history for it on purpose).
 */
const BY_DESIGN = ['it is small enough', 'switched off in the list of chats', 'more of the same work follows']
/** The states in which a step is its Owner's work now, and those of a worker with nothing running. */
const HOLDS = ['taken', 'in progress']

const stateOf = item => valueOf(item, 'State')
const idOf = item => valueOf(item, 'Id')
const byId = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true })
const pad = n => String(n).padStart(2, '0')
const clockOf = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`
const minutes = ms => Math.max(0, Math.floor(ms / MIN))
const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
const workersOf = view => view.lanes.filter(lane => !lane.isLeftover && lane.isMain !== true)
/** Signals change 4: every board chat with its `wake` (state.mjs `withWakes`): the lanes, the partner, its helper, the supervisor, the owner. */
const wakeLanesOf = view => [...(view.lanes ?? []).filter(lane => !lane.isLeftover), view.partner, view.helper, view.supervisor, view.owner]
  .filter(lane => typeof lane?.name === 'string')
const stepsOf = view => [...view.items.values()].filter(item => (valueOf(item, 'Kind') ?? 'step') === 'step' && typeof idOf(item) === 'string')
const isFull = view => ['fiveHour', 'week'].some(limit => view.limits?.[limit]?.level === 'full')
/**
 * The person's Pause all, and the resume after it: the chats stop at the person's word and the board hands out nothing
 * (the resume wakes them itself), so the rules about chats that do not run or words that wait say nothing meanwhile.
 */
const isPaused = view => isHolding(view.pause) || view.pause?.state === 'resuming'
/** When the last pause ended (the store's pause record, running again since then); -Infinity for none. */
const pauseEndOf = view => pauseEnd(view.pause)
/** A time something began, counted from the end of the last pause at the earliest: the pause's time does not count. */
const afterPause = (view, since) => afterPauseOf(view.pause, since)
/**
 * B1021 (X148): when the last full limit ended, as the limits' reading names it (`resetAt`: its reset has passed and nothing was
 * read since); -Infinity for none. The board hands out nothing while a limit is full, so that time is no one's wait.
 */
const limitEndOf = view => Math.max(-Infinity, ...['fiveHour', 'week'].map(limit => view.limits?.[limit]?.resetAt).filter(Number.isFinite))

/**
 * How long a thing has lasted: since `since` (what the board's data says), or since the supervisor first saw it (`key`
 * in its watch), whichever is earlier. The key is watched from now on, so a lasting thing is timed across runs. The
 * review: never from before the end of the person's last pause (the chats stood still at the person's word then).
 */
function lasted(view, ctx, key, since = null, { heard = false } = {}) {
  return spanOf(view, watchOf(ctx), key, since, { heard })
}

/** B664: since when the rules' watch first saw a key, with every key asked kept watched (the rules' `ctx`). */
const watchOf = ctx => key => {
  if (!ctx.observed.includes(key)) ctx.observed.push(key)
  return ctx.seen.get(key)
}

/**
 * `lasted`'s span, with `seenOf(key)` the time the key was first seen (undefined: now). B736: `heard` (the rules about a
 * chat that does not run) leaves out the stretches the board heard no chat too (`deafMs`).
 */
function spanOf(view, seenOf, key, since = null, { heard = false, floor = -Infinity } = {}) {
  const first = Math.min(Number.isFinite(since) ? since : Infinity, seenOf(key) ?? view.now)
  const from = Math.max(first, pauseEndOf(view), floor)
  return view.now - from - boardOffMs(view, from) - (heard ? deafMs(view, from) : 0)
}

/**
 * X80 (the PC slept 17:06 to 21:08, and a step with ten minutes of work read four hours quiet): how long the board itself
 * did not run between `from` and now, a PC sleep or a board stop. B710: read from the history's gap lines over all of it
 * (`view.gaps`, state.mjs), not guessed from holes in today's window, which a gap that began before it escaped. Without
 * gap lines it is 0, and the wall time counts.
 */
export function boardOffMs(view, from) {
  if (!Number.isFinite(from)) return 0
  return (view.gaps ?? []).reduce((sum, gap) => sum + Math.max(0, Math.min(gap.to, view.now) - Math.max(gap.from, from)), 0)
}

/**
 * B736 (X73, X87: from 21:12 to 21:21 the board heard no chat while every chat worked, and three chats were "not running"
 * for 8 minutes): how long between `from` and now the board heard no chat though chats ran (view.mjs `deaf`, the one that
 * lasts now up to now). A stall or a restart of the board is no chat's fault: the rules about a chat that does not run
 * (working-not-running, handover-held) leave it out, as they leave out `boardOffMs`.
 */
export function deafMs(view, from) {
  if (!Number.isFinite(from)) return 0
  const spans = (view.deaf ?? []).map(span => (view.deafNow !== null && view.deafNow !== undefined && span.from === view.deafNow.from ? { ...span, to: view.now } : span))
  return spans.reduce((sum, span) => sum + Math.max(0, Math.min(span.to, view.now) - Math.max(span.from, from)), 0)
}

/**
 * Signals change 3 (the build brief of 2026-11-01, B): the rules unknown-lane (1) and holder-not-running (4) are retired:
 * the hand-over's two timers act on a stopped holder themselves (one "go on" line, then the give-back, src/work/
 * holderTimers.mjs) and leave History lines instead of incidents. Their open incidents are closed by the board's pass
 * over the incidents (src/work/api.mjs `incidentsFixed`), each with one line.
 */
export { RETIRED_WATCH_RULES }

/**
 * 2. A worker "suspended" after its limit came back: its reset time passed (`isBack`), the app stopped it at the limit
 * and a reading since shows room, or its pause is older than its limit's window. Counted from when it came back.
 */
function staleSuspended(view, ctx) {
  const found = []
  if (isPaused(view)) return found
  for (const lane of workersOf(view).filter(one => one.state === 'suspended' && one.suspended !== null && typeof one.suspended === 'object')) {
    const held = lane.suspended
    const limit = view.limits?.[held.limit] ?? null
    const window = WINDOW_MS[held.limit] ?? null
    const isFull = limit?.level === 'full'
    let why = null
    let since = null
    if (held.isBack === true) {
      why = Number.isFinite(held.until) ? `its reset at ${clockOf(held.until)} has passed` : 'its limit is back'
      since = Number.isFinite(held.until) ? held.until : null
    } else if (Number.isFinite(held.since) && window !== null && view.now - held.since > window) {
      why = `its pause began ${Math.floor((view.now - held.since) / HOUR)} h ago, longer than ${LIMIT_WORDS[held.limit]} lasts`
      since = held.since + window
    } else if (held.by === 'app' && limit !== null && !isFull && Number.isFinite(limit.used) && limit.used < 100 && Number.isFinite(limit.at) && limit.at > (held.since ?? Infinity)) {
      why = `${LIMIT_WORDS[held.limit] ?? held.limit} shows ${Math.round(limit.used)}% used`
    }
    if (why === null || isFull) continue
    const key = `stale-suspended ${lane.name}`
    const ms = lasted(view, ctx, key, afterPause(view, since))
    if (ms <= view.settings.suspendedMinutes * MIN) continue
    found.push({
      rule: 'stale-suspended', key, subject: lane.name,
      text: `${lane.name} suspended for the limit, but ${why}`,
      evidence: `suspended by ${held.by ?? 'not known'} for ${held.limit ?? 'a limit'} since ${Number.isFinite(held.since) ? clockOf(held.since) : 'not known'}; until ${Number.isFinite(held.until) ? clockOf(held.until) : 'not known'}; ${held.limit} ${Number.isFinite(limit?.used) ? `${Math.round(limit.used)}%` : 'not read'}`,
    })
  }
  return found
}

/** The states whose Touches hold a ready task back from the hand-out: given or under way (work/handOut.mjs `match`). */
const GIVEN_OR_UNDER_WAY = ['queued', 'taken', 'in progress', 'waiting on you']

/**
 * 3. Redesign Part 2 (2026-10-25, its Done when: "a task waits while a worker is free"): a ready task (the view's
 * `ready`, the board's own list) waits while a worker is free in its hand-over (T8.5: its lane's `handover` state FREE,
 * the one decision's own reading), both for longer than `idleMinutes`: the board hands a ready task to such a worker at
 * once, so it failed to. Gap 3: only what the board hands out counts: the list's `ready` (a fix, the focus goal's, a
 * pinned one), never its `held` (a task outside the focus goal waits for the person by design); a kept task (its pin, its
 * follow-up) only while its own worker is free. A task whose Touches overlap one given or under way waits by design; a QA
 * task waits by design while only the chats in its `notBy` (the builders) are free. One finding per free worker (key `ready-while-free <worker>`), its waiting tasks in the text and evidence, never one per task. Not while the
 * person pauses or a limit is full.
 */
function readyWhileFree(view, ctx) {
  if (isPaused(view) || isFull(view)) return []
  // T8.5 step 6 (R7 for good, X111, X112): free is the hand-over's own FREE, the one place: nothing in flight, not held, not
  // checking, idle by its mod's report and running. A worker not on the sequence is handed nothing, so it is never free here.
  const free = workersOf(view).filter(lane => lane.onSequence === true && lane.handover?.state === STATES.FREE)
  if (free.length === 0) return []
  const found = []
  for (const lane of free) {
    const mine = plain(lane.name, view.prefix)
    // The tasks this worker could have been given: not one it is named off (notBy), a kept task only for its own worker, no Touches overlap.
    const waiting = view.ready.filter(one => {
      if ((one.notBy ?? []).some(name => plain(name, view.prefix) === mine)) return false
      if ((one.keptFor ?? null) !== null && plain(one.keptFor, view.prefix) !== mine) return false
      const item = view.items.get(one.id)
      return item !== undefined && overlapIn(view.items, item, GIVEN_OR_UNDER_WAY) === null
    })
    if (waiting.length === 0) continue
    const freeSince = Number.isFinite(lane.report?.since) ? lane.report.since : view.since.get(lane.name) ?? view.now
    const key = `ready-while-free ${lane.name}`
    const ms = Math.min(lasted(view, ctx, key), view.now - afterPause(view, freeSince))
    if (ms <= view.settings.idleMinutes * MIN) continue
    const ids = waiting.map(task => task.id)
    found.push({
      rule: 'ready-while-free', key, subject: lane.name,
      text: `${lane.name} free for ${minutes(ms)} min while ${ids.length} ready task${ids.length === 1 ? '' : 's'} wait${ids.length === 1 ? 's' : ''}: ${ids.slice(0, 8).join(', ')}${ids.length > 8 ? ', ...' : ''}`,
      evidence: `waiting tasks: ${ids.slice(0, 8).join(', ')}${ids.length > 8 ? ` (and ${ids.length - 8} more)` : ''}; free by its report: ${lane.name} since ${Number.isFinite(lane.report?.since) ? clockOf(lane.report.since) : 'a time not known'} (its hand-over: ${typeof lane.handover?.why === 'string' && lane.handover.why.includes(BAN_WHY_MARK) ? lane.handover.why : 'free'})`,
    })
  }
  return found
}

/**
 * B566 (X22, X21: chats shown not running while they ran, the board's only sign their takes): a worker whose card says
 * it works (or that the board shows off for a card left working) while its chat made no call to the board, took
 * nothing and wrote nothing to its conversation (the board's `isRunning` false) for longer than 5 minutes: one
 * incident per worker. A worker on a step in progress is the hand-over's timers' (signals change 3), never this rule's.
 * B1168 (X72 came back 3 times after its close; Worker 1 stopped mid-turn at 21:20, the timers gave B423 back at 21:23): a stop is
 * answered for, and never counts, once the board gave the worker a step back since the stop began (the timers acted and wrote their
 * line), or once the incident's last close (`fixedAtOf`) came after the stop began; a stop that begins after a close counts anew. The
 * stop began at the card's `offSince`, else when the rules' watch first saw it. B736's lone silent chat (nothing given back) still opens.
 */
const WORKING_NOT_RUNNING_MS = 5 * MIN
function workingNotRunning(view, ctx) {
  const found = []
  if (isPaused(view) || isFull(view)) return found
  const holding = new Set(stepsOf(view).filter(one => HOLDS.includes(stateOf(one))).map(one => plain(valueOf(one, 'Owner'), view.prefix)))
  for (const lane of workersOf(view)) {
    const isWorkingCard = lane.state === 'working' || (lane.state === 'off' && Number.isFinite(lane.offSince))
    // The asset wait: a worker whose lane works for the provider's pictures makes no call of its own while Codex draws: no fault.
    if (!isWorkingCard || lane.isRunning !== false || holding.has(plain(lane.name, view.prefix)) || lane.heldBy === 'asset') continue
    const key = `working-not-running ${lane.name}`
    const stopFrom = Number.isFinite(lane.offSince) ? lane.offSince : ctx.seen.get(key) ?? view.now
    if (givenBackFrom(view.items, lane.name, view.prefix).some(back => back.at >= stopFrom)) continue
    if (stopFrom <= fixedAtOf(view, key)) continue
    const ms = lasted(view, ctx, key, afterPause(view, Number.isFinite(lane.offSince) ? lane.offSince : null), { heard: true })
    if (ms <= WORKING_NOT_RUNNING_MS) continue
    found.push({
      rule: 'working-not-running', key, subject: lane.name,
      text: `${lane.name}'s card says it works, but its chat made no call, took nothing and wrote nothing for ${minutes(ms)} min`,
      evidence: `${lane.name}: state ${lane.state}, running no, since ${clockOf(view.now - ms)}`,
    })
  }
  return found
}

/** 5. An opus step whose line waits for its worker to run on Opus, for longer than `opusWaitMinutes`. */
function opusWait(view, ctx) {
  const found = []
  if (isPaused(view) || isFull(view)) return found
  for (const lane of workersOf(view)) {
    const waits = lane.effortRun?.waitsFor
    if (waits?.model !== 'opus' || typeof lane.effortRun?.step !== 'string') continue
    const step = lane.effortRun.step
    const key = `opus-wait ${step}`
    const ms = lasted(view, ctx, key, afterPause(view, waits.since))
    if (ms <= view.settings.opusWaitMinutes * MIN) continue
    found.push({ rule: 'opus-wait', key, subject: step, text: `${step} waits for Opus for ${minutes(ms)} min (${lane.name})`, evidence: String(waits.text ?? '') })
  }
  return found
}

/**
 * 6. A compaction skipped for the same reason twice in a row (the chat's card keeps only the last one: the supervisor
 * keeps the one before in its watch). A compaction skipped by design (a small chat) is no case. T8.5 step 6: a clear is
 * the hand-over's envelope's: a clear that did not run holds its worker, the rule handover-held's.
 */
function skipRepeats(view, ctx) {
  const found = []
  for (const lane of view.lanes.filter(one => !one.isLeftover)) {
    const compaction = lane.compaction ?? null
    const skips = [
      ...(compaction?.kind === 'skipped' && !BY_DESIGN.includes(compaction.why) ? [{ kind: 'compact', at: compaction.at, why: compaction.why }] : []),
    ].filter(one => Number.isFinite(one.at) && typeof one.why === 'string' && one.why !== '')
    for (const skip of skips) {
      const head = `skip|${lane.name}|${skip.kind}|`
      const key = `${head}${skip.at}|${skip.why}`
      ctx.observed.push(key)
      const before = [...ctx.seen.keys()].filter(one => one.startsWith(head) && one !== key)
        .map(one => ({ key: one, at: Number(one.slice(head.length).split('|')[0]), why: one.slice(head.length).split('|').slice(1).join('|') }))
        .filter(one => Number.isFinite(one.at) && one.at < skip.at)
        .sort((a, b) => b.at - a.at)[0]
      if (before === undefined || before.why !== skip.why) continue
      // Both stay watched while it stands, so the next run finds it again.
      ctx.observed.push(before.key)
      const what = 'compaction'
      found.push({
        rule: 'skip-repeats', key: `skip-repeats ${lane.name} ${skip.kind} ${skip.why}`, subject: lane.name,
        text: `${lane.name}: its ${what} was skipped twice in a row: ${skip.why}`,
        evidence: `skipped at ${clockOf(before.at)} and at ${clockOf(skip.at)}, both: ${skip.why}`,
      })
    }
  }
  return found
}

const DONE_LINE = /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)\s+[^:]+: \S+ → done\b/
const FIX_LINE = /^-\s+\S+ \S+ [^:]+: fix (B\d+)\s*$/
const CLOSE_LINE = /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)\s+[^:]+: closed: /

/**
 * B551 (X11): when the incident a finding's key files was last fixed: the latest time one of the steps named as its fix
 * (its Fix, and every "fix B<n>" of its History) went done, or (B687) the time the partner closed it (a "closed:" line of
 * its History, also once it came back), at the end of that minute; -Infinity for none. A repair before it is one that
 * fix or close answered for: it never counts again.
 */
function fixedAtOf(view, key) {
  const incident = [...view.items.values()].find(item => valueOf(item, 'Kind') === 'incident' && valueOf(item, 'Key') === key)
  if (incident === undefined) return -Infinity
  const named = (incident.sections?.get('History') ?? []).map(line => FIX_LINE.exec(line)?.[1]).filter(Boolean)
  let at = -Infinity
  for (const closed of (incident.sections?.get('History') ?? []).map(line => CLOSE_LINE.exec(line)?.[1]).filter(Boolean)) {
    const ms = sinceMs(closed)
    if (Number.isFinite(ms)) at = Math.max(at, ms + (/:\d\d:\d\d$/.test(closed) ? 1000 : MIN) - 1)
  }
  for (const id of new Set([valueOf(incident, 'Fix'), ...named].filter(Boolean))) {
    const fix = view.items.get(id)
    if (fix === undefined || stateOf(fix) !== 'done') continue
    const done = (fix.sections?.get('History') ?? []).map(line => DONE_LINE.exec(line)?.[1]).filter(Boolean).at(-1) ?? valueOf(fix, 'Since')
    const ms = sinceMs(done)
    if (Number.isFinite(ms)) at = Math.max(at, ms + (/:\d\d:\d\d$/.test(done) ? 1000 : MIN) - 1)
  }
  return at
}

/**
 * 7. The same repair (a repair rule, on the same chat or step) `repairsPerDay` times or more in a day. B546: a repair
 * the app's restart caused (`cause: 'restart'`, a chat stopped because the app started anew) does not count. B551: nor
 * does one from before its incident's fix was done (`fixedAtOf`): X11 came back on the very wakes B546 was made for,
 * recorded before it and so without their cause. B574 (X25: B531 unblocked three times in a day, each time from another
 * finished blocker): an unblock counts by its own key, the step and its blocker, so only the same blocker removed again
 * and again is a repeat. B590 (X37: B531 waited behind three checks in turn): every rule whose table entry counts by key
 * (`COUNTS_BY_KEY`) counts so, review-wait too. T9.4: nor do the Advisor's asks again (`BOUNDED_RULES`): three wakes at most
 * for one wait, and the person is told after them, so their end is no repeat to report.
 */
function repairRepeats(view) {
  const counts = new Map()
  for (const one of view.repairs.filter(repair => view.now - repair.at < DAY && repair.cause !== 'restart' && !BOUNDED_RULES.has(repair.rule))) {
    const id = COUNTS_BY_KEY.has(one.rule) && typeof one.key === 'string' ? one.key : `${one.rule} ${one.subject}`
    counts.set(id, [...(counts.get(id) ?? []), one])
  }
  for (const [id, all] of counts) {
    const after = fixedAtOf(view, `repair-repeats ${id}`)
    counts.set(id, all.filter(one => one.at > after))
  }
  const found = []
  for (const [id, all] of [...counts].sort(([a], [b]) => byId(a, b))) {
    if (all.length < view.settings.repairsPerDay) continue
    const { rule, subject } = all[0]
    found.push({
      rule: 'repair-repeats', key: `repair-repeats ${id}`, subject,
      text: `The board repaired the same ${all.length} times in a day: ${rule} for ${subject}`,
      evidence: `at ${all.map(one => clockOf(one.at)).join(', ')}: ${all.at(-1).key}`,
    })
  }
  return found
}

/**
 * 8. A word to a chat not delivered for longer than `undeliveredMinutes`: still waiting, or expired or failed in the
 * last two hours. One finding per chat. A word the person's pause held counts from its release. B532: the repair of a
 * waiting word is the outbox's own: at every refresh its sweep (src/work/outboxSweep.mjs) closes what no longer matters,
 * with the reason, and a chat's next take hands it the rest however old, with its age (the main chat's start word, kept
 * as long, opens a chat that is not running). So the rule names only what still waits after that: a word the sweep would
 * drop is not named, nor a person's answer past its keep, which waits for its chat on purpose (a step that comes back).
 * B577: a word that went again (`retriedAs`: tried anew, its chat stopped or replaced) is named by the word that stands
 * for it, not twice; a chat whose session was stopped is named once per stop, with whether the main chat was asked to
 * wake it, not word by word.
 */
function undelivered(view) {
  const all = undeliveredWords(view)
  // B1071 (X2): a task stop by code is one finding per stop, keyed by its word, never one per chat that the next stop reopens.
  const stops = all.filter(isTaskStopWord).map(message => stopFinding(view, message))
  const late = all.filter(message => !isTaskStopWord(message))
  const stopped = stoppedOfView(view)
  const byChat = new Map()
  for (const message of late) byChat.set(message.to, [...(byChat.get(message.to) ?? []), message])
  return [...stops, ...[...byChat].sort(([a], [b]) => byId(a, b)).map(([chat, words]) => {
    const oldest = words.reduce((a, b) => (b.at < a.at ? b : a))
    const stop = stopped.get(chat) ?? null
    if (stop !== null) {
      const woken = view.outbox.findLast(one => one.command === 'wake' && one.about === chat && one.stoppedAt === stop.since)
      return {
        // Signals change 6 (Addendum 2): the key is the rule and the chat only, as for a chat not stopped: a stop's time in the
        // key opened the same undelivered words again at every new stop, which made "gone" read a cure that was none.
        rule: 'undelivered', key: `undelivered ${chat}`, subject: chat, since: oldest.at,
        text: `${chat} was stopped at ${clockOf(stop.since)}: ${words.length} ${words.length === 1 ? 'word waits' : 'words wait'} for it, the oldest for ${minutes(view.now - oldest.at)} min`,
        evidence: woken === undefined ? 'the main chat is not asked to wake it yet' : `the main chat was asked to wake it at ${clockOf(woken.at)} (${woken.state})`,
      }
    }
    return {
      rule: 'undelivered', key: `undelivered ${chat}`, subject: chat, since: oldest.at,
      text: `${words.length} ${words.length === 1 ? 'word' : 'words'} to ${chat} not delivered, the oldest for ${minutes(view.now - oldest.at)} min`,
      // B813: a failed word with its last why. B880: and the hand that holds a taken word, or failed it.
      evidence: words.map(one => `${clockOf(one.at)} ${one.command ?? 'answer'}${one.about ? ` ${one.about}` : ''} (${one.state}${handOf(one)}${one.state === 'failed' && typeof one.why === 'string' && one.why.trim() !== '' ? `: ${shortWhy(one.why)}` : ''})`).join('; '),
    }
  })]
}

/**
 * B1071 (X2): the finding of one task stop by code not settled within STOP_HANDS_MS (rule 8 waits that long for it: `isUndelivered`):
 * its own key (`undelivered stop <worker> <word>`), the step it stops and who holds it now: the main chat it waits for, or the hand
 * that took it, and what the worker's chat shows.
 */
function stopFinding(view, message) {
  const lane = view.lanes.find(one => !one.isLeftover && one.name === message.about)
  const step = typeof message.taskStep === 'string' ? ` on ${message.taskStep}` : ''
  const holder = isHandTaken(message) ? `held by ${message.takenBy}'s mod` : message.state === 'waiting' ? `waits for ${message.to}` : `${message.state}${handOf(message)}`
  const worker = lane === undefined ? `${message.about} is not on the board` : `${message.about} ${lane.isRunning === false ? 'does not run' : `is ${lane.report?.state ?? 'not reported'}${Number.isFinite(lane.report?.since) ? ` since ${clockOf(lane.report.since)}` : ''}`}`
  return {
    rule: 'undelivered', key: `undelivered stop ${message.about} ${message.id}`, subject: message.about, since: message.at,
    text: `the person's ${message.command} of ${message.about}${step} (${clockOf(message.at)}) is not settled after ${minutes(view.now - message.at)} min`,
    evidence: `the word ${message.id} ${holder}; ${worker}`,
  }
}

/**
 * B880: whose mod holds a word a hand took (", held by Worker 2's mod"), or failed it; '' for a chat's own take. B891: a word
 * waiting in doubt names the hand whose call gave no answer.
 */
const handOf = word => (word.state === 'waiting' && Number.isFinite(word.doubtAt) ? `, in doubt: ${word.backFrom}'s mod gave no answer` : !isHandTaken(word) ? '' : word.state === 'taken' ? `, held by ${word.takenBy}'s mod` : word.state === 'failed' ? ` by ${word.takenBy}'s mod` : '')

/** B813: a failure's why on one line, cut to fit the evidence. */
const shortWhy = why => {
  const line = why.replace(/\s+/g, ' ').trim()
  return line.length > 120 ? `${line.slice(0, 119)}…` : line
}

const stoppedOfView = view => stoppedChats(view.outbox, { chats: view.lanes, advisor: view.partner, advisorHelper: view.helper, supervisorChat: view.supervisor })

/**
 * B571: whether a word still matters (the outbox sweep would not drop it), one judgement for rule 8 and the health
 * summary's "Words not delivered" (health.mjs): a word the sweep drops is in neither.
 */
export function wordMatters(view) {
  const ctx = closeCtxOf(view)
  // B1071: a task stop the sweep settles as done (`delivered`) matters to no rule either.
  return message => !['dropped', 'delivered'].includes(whyClosed(message, ctx)?.state)
}

/**
 * P3 (the wait line, no silent end): why the outbox sweep closes (or would close) a word, in its words, or null: the same judgement
 * as `wordMatters`, so a card says "closed: <why>" with the sweep's own reason.
 */
export function wordWhyClosed(view) {
  const ctx = closeCtxOf(view)
  return message => whyClosed(message, ctx)?.why ?? null
}

/** What the outbox sweep judges a word by (`whyClosed`'s ctx), from a view. */
function closeCtxOf(view) {
  const runs = new Map(view.lanes.filter(chat => !chat.isLeftover).map(chat => [chat.name, chat.isRunning === true]))
  // T9.4: the chats known not to run (outboxSweep.mjs): a start word one of them holds is closed, so it matters to no rule.
  const off = new Set([...view.lanes.filter(chat => !chat.isLeftover), view.partner, view.helper, view.supervisor].filter(chat => chat?.isRunning === false).map(chat => chat.name))
  const ctx = { all: view.outbox, items: view.items, assets: view.assets ?? undefined, runs, goals: view.goals ?? [], now: view.now, keep: view.keep, closing: new Map(), stopped: stoppedOfView(view), prefix: view.prefix ?? '', main: view.lanes.find(chat => chat.isMain === true)?.name ?? null, off, handedBack: view.handedBack ?? [], lanes: view.lanes, onBoard: new Set([...view.lanes.filter(chat => !chat.isLeftover), view.partner, view.helper, view.supervisor, view.owner].filter(chat => typeof chat?.name === 'string').map(chat => chat.name)) }
  return ctx
}

/**
 * B571: the words rule 8 names, which the health summary marks "!" (and only those): waiting longer than
 * `undeliveredMinutes`, or expired or failed for good in the last two hours (UNDELIVERED_LOOK_MS), and still mattering.
 * None while the person pauses. The wait line (T22, 2026-11-02): each word is judged by `isUndelivered`, the one judgement
 * the card's "Not picked up" reads too.
 */
export function undeliveredWords(view) {
  const judged = undeliveredJudged(view)
  if (judged === null) return []
  return view.outbox.filter(message => isUndelivered(view, message, judged))
}

/**
 * The wait line (T22, the board-dev chat's answer 4 of 2026-11-02: "Export a per-word isUndelivered(view, message) from
 * watch.mjs, same body as undeliveredWords' filter"): whether rule 8 names this ONE word, so a card's "Not picked up after
 * N min" and the alarm read one function and never two clocks. `judged` what every word of the view shares
 * (`undeliveredJudged`), made once by a caller that asks for many words; false for every word while the person pauses.
 */
export function isUndelivered(view, message, judged = undeliveredJudged(view)) {
  // The person pauses: the bridge holds every word until Resume all.
  if (judged === null) return false
  const { stillWaits, waking } = judged
  if (!(typeof message?.to === 'string' && Number.isFinite(message.at) && message.command !== 'sweep' && !waking.has(message.to))) return false
  // The time the person's pause held it does not count (as for the outbox's own expiry, store.mjs isLate), nor a
  // hold before its release (B285).
  const held = message.at + heldMs(message, view.now, view.pause)
  const since = afterPause(view, Number.isFinite(message.releasedAt) ? Math.max(held, message.releasedAt) : held)
  // B1071 (X2): a task stop by code waits STOP_HANDS_MS for the board to carry it out, then the main chat may take it: late after both.
  const limit = isTaskStopWord(message) ? STOP_HANDS_MS + judged.limit : judged.limit
  if (message.state === 'waiting') return view.now - since > limit && stillWaits(message)
  // B880: a word a hand took and still holds (its call gave no answer): named as one that waits, with the hand.
  if (message.state === 'taken' && isHandTaken(message)) return view.now - since > limit && stillWaits(message)
  return (message.state === 'expired' || isFailedForGood(message)) && view.now - message.at < UNDELIVERED_LOOK_MS && view.now - since > limit && stillWaits(message)
}

/**
 * What rule 8 judges every word of a view by (`isUndelivered`): its limit, whether a word still waits, the chats in a wake;
 * null while the person pauses. Exported for a caller that judges many words of one view (src/waitLine.mjs `waitsOf`).
 */
export function undeliveredJudged(view) {
  if (isPaused(view)) return null
  const limit = view.settings.undeliveredMinutes * MIN
  // A word that waited too long still counts (the sweep marks it expired, and so does this rule); one that no longer
  // matters (dropped: superseded, its step moved on, its goal evaluated since) does not, waiting or failed (B571).
  // B548: an answer waits for its chat however old (store.mjs isLate); past answerMs it is not named here.
  const matters = wordMatters(view)
  const stillWaits = message => matters(message)
    && !((message.ask ?? null) !== null && view.now - message.at - heldMs(message, view.now, view.pause) > view.keep.answerMs)
  // X43: not the supervisor's own sweep word: it goes stale in ten minutes by design (the next sweep replaces it), so one that
  // expired while the supervisor's chat was off is no lost word (the health summary leaves it out too).
  // Signals change 4 (decision 7): a word whose chat is in a pending or failed wake is not undelivered: it waits for the wake
  // (the rules wake-failed and nobody-answers-wakes name a wake that failed).
  const waking = new Set(wakeLanesOf(view).filter(lane => ['waiting-sender', 'on-its-way', 'sent', 'launched', 'failed'].includes(lane.wake?.state)).map(lane => lane.name))
  return { limit, stillWaits, waking }
}

/** A History line's stamp. */
const STAMP = /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)\s/

/**
 * 9. A step whose board check failed twice or more in a row since its last pass, and is not done; its case began at the
 * second. B663 (X67): not before that second failure is older than `reportCheckMinutes`: the worker is correcting its
 * report then, and a pass in that time ends the case. 2026-10-25: only a failure for a fact counts; the board no longer
 * refuses a report for its wording (a pass with warnings is a pass), and the lines of the refusals it made before
 * that, for wording only (recapWords.mjs `isWordingOnly`), are left out.
 * B710: the board's off time (boardOffMs) does not count in the wait.
 * B710: left on wall time on purpose, being ages of a word already written and not a quiet stretch: old-mod (the age of the board's
 * restart word), the check words' and refine words' ages in review-stuck and open-fix (a word waits as long while the PC sleeps), and
 * undelivered; a sleep sets them off only as a late word, which is true.
 */
function reportCheckTwice(view) {
  const found = []
  for (const item of stepsOf(view).filter(one => !['done', 'dropped'].includes(stateOf(one)))) {
    const checks = (item.sections?.get('History') ?? []).filter(line => /\bserver: check (?:passed|failed)\b/.test(line))
    const lastPass = checks.findLastIndex(line => /\bserver: check passed\b/.test(line))
    const failed = checks.slice(lastPass + 1).filter(line => !isWordingOnly(line.match(/server: check failed(?::\s*(.*))?$/)?.[1]))
    if (failed.length < 2) continue
    const since = sinceMs(failed[1].match(STAMP)?.[1])
    // B710: the worker corrects its report in running time; a sleep of the board is not time it had.
    if (!(view.now - since - boardOffMs(view, since) > view.settings.reportCheckMinutes * MIN)) continue
    const id = idOf(item)
    const detail = failed.at(-1).match(/server: check failed(?::\s*(.*))?$/)?.[1]?.trim() || 'no reason given'
    found.push({
      rule: 'report-check-twice', key: `report-check-twice ${id}`, subject: id, since,
      text: `${id}: the board's check failed ${failed.length} times in a row (${valueOf(item, 'Owner') ?? 'nobody'}): ${detail}`,
      evidence: failed.map(line => line.replace(/^-\s+/, '')).join(' | '),
    })
  }
  return found
}

export { FIRST_SAYING }

/**
 * 10. Chats on an older Workers mod than the one installed: they get the new one only when their chats start anew. B570:
 * the board has each idle one restarted between its steps, so only one idle on the older mod over 30 minutes trips (its
 * restart did not reach it); for those the way is the same for all (pause all, restart the app, resume all). B541: so one finding for all of
 * them, keyed by the installed version and naming each with what it misses: the main chat, the workers, the partner,
 * its helper and the supervisor's chat (oldMods.mjs). A chat whose version the board does not know (its mod did not ask
 * lately) is no case; one whose mod asked without saying its version (null) runs one older than FIRST_SAYING, a case
 * once that one or a newer one is installed (the review).
 */
function oldMod(view) {
  const found = oldModFinding(view.mods, chatsByRole({ chats: view.lanes, advisor: view.partner, advisorHelper: view.helper, supervisorChat: view.supervisor }), view.now, view.outbox ?? [])
  return found === null ? [] : [found]
}

/**
 * 11. B544 (the rule X9's sweep wanted): a chat whose card says an effort that is not a level (low ... max), as
 * "[object Object]" stood in the health summary. One finding per chat and what it says, so it is an incident once. A
 * chat whose card says no effort is no case.
 */
function oddEffort(view) {
  const chats = [...view.lanes.filter(lane => !lane.isLeftover), view.partner, view.helper, view.supervisor].filter(chat => typeof chat?.name === 'string')
  const found = []
  for (const chat of chats) {
    const said = effortSaid(chat)
    if (said === null || chatEffort(chat) !== null) continue
    const words = typeof said === 'string' ? said : JSON.stringify(said) ?? String(said)
    found.push({
      rule: 'odd-effort', key: `odd-effort ${chat.name} ${words.slice(0, 60)}`, subject: chat.name,
      text: `${chat.name}'s effort reads "${words.slice(0, 60)}", not a level`,
      evidence: `its card says ${words.slice(0, 200)}; a level is one of ${EFFORTS.join(', ')}`,
    })
  }
  return found
}

/**
 * 12. B543 (the fix of X8: a step sat in review for 3 days behind a dropped fix, four more for hours behind a chain of
 * fixes): a step in review says what it waits for (resultCheck.mjs `reviewWaitOf`). Waiting for an open fix, or for the
 * person's answer, is no case. Stuck: no result check filed for longer than `reviewMinutes` (its first, or again after
 * its fix was done or its ask point answered). T9.1.1: counted from its Quality Assurance task (made at once by the check or
 * the repair `unchecked`), which a worker at work on (in progress) clears: that is no case for the Advisor; nor is a task that
 * is ready or given and not taken (go-live gives them one by one; the rules ready-while-free and handover-unanswered watch
 * them). A task taken and not begun, or none, is a case. T8.5 step 6: a report whose check failed and was not reported
 * again is no case here: the hand-over's decision tells its worker at its first turn's end (its rule 3). A dropped fix is
 * the rule `dropped-fix` (B630; its id apart from the repair `fix-dropped`, the supervisor keys rules by id). Counted from the end of the person's last pause.
 */
function reviewStuck(view, ctx) {
  const found = []
  if (isPaused(view)) return found
  for (const item of stepsOf(view).filter(one => stateOf(one) === 'review').sort((a, b) => byId(idOf(a), idOf(b)))) {
    const wait = reviewWaitOf(item, view.items, null, view.now, view.recaps)
    if (wait?.kind !== 'check') continue
    const id = idOf(item)
    // B664: judged by reviewLateOf, as the health summary judges it. T9.1.1: counted from the step's QA task.
    const { late, key, ms } = reviewLateOf(view, item, wait, watchOf(ctx))
    if (!late) continue
    const qa = openQaTaskOf(view.items, id)
    const stand = qa === null ? null : qaStandOf(qa)
    found.push({
      rule: 'review-stuck', key, subject: id,
      text: `${id} in review ${minutes(ms)} min with no result check filed (${wait.text})`,
      evidence: `since ${clockOf(view.now - ms)}; ${stand === null ? 'no QA task (the repair unchecked makes one)' : `its QA task ${stand.qa} is queued since ${clockOf(stand.since)}${stand.who === null ? ', given to nobody' : `, given to ${stand.who}`}`}`,
    })
  }
  return found
}

/** How long a dropped fix may stand with nothing planned for its step before the partner hears of it (B630). */
const FIX_DROPPED_MS = 30 * MIN

/**
 * 12b. B630 (X54: B602, B608 and B609 sat in review for 2 h with their fixes dropped, found only by the sweep): a step
 * in review whose fix was dropped, with no new fix, no new check and no open step blocking it (resultCheck.mjs
 * `reviewWaitOf` kind 'dropped'; a block makes it 'blocked', a plan), for over 30 minutes is an incident for the
 * partner. Counted from the drop, or (B665) from when the last step that blocked it left, and from the end of the person's last pause.
 */
function fixDropped(view, ctx) {
  const found = []
  if (isPaused(view)) return found
  for (const item of stepsOf(view).filter(one => stateOf(one) === 'review').sort((a, b) => byId(idOf(a), idOf(b)))) {
    const wait = reviewWaitOf(item, view.items, null, view.now, view.recaps)
    if (wait?.kind !== 'dropped') continue
    const id = idOf(item)
    const { late, key, ms } = reviewLateOf(view, item, wait, watchOf(ctx))
    if (!late) continue
    found.push({
      rule: 'dropped-fix', key, subject: id,
      text: `${id} in review, but ${wait.text}: nothing will close it`,
      evidence: `${id} owned by ${valueOf(item, 'Owner') ?? 'nobody'}; ${wait.text} ${minutes(ms)} min ago${wait.blockEnded === undefined ? '' : ` (the block by ${wait.blockEnded.id} ended at ${clockOf(wait.blockEnded.at)})`}; no other fix of it is open, no check filed again, no open step blocks it`,
    })
  }
  return found
}

/** B660: a held why that is the person's open ask (guards.mjs `readyHold`). */
export const PERSON_ASK_HOLD = /^waits for the answer to Q\d/
/** B916: a held why that names the steps it is blocked by (guards.mjs `readyHold`: "blocked by B871 (review), B5 (in progress)"). */
const BLOCKED_HOLD = /^blocked by B\d/

/**
 * B916 (X123): whether a held why is the person's wait: their open ask (B660), or a block by steps that ALL wait for them
 * (resultCheck.mjs `waitsForPerson`: their answer, verdict in a recap or Accept, also at the end of the blocker's chain of
 * fixes). One blocker that waits for a check, a worker or anything else leaves the hold the board's own.
 */
function personHold(view, held) {
  // Stop and rethink: the person asked for the hold ("waits for: the rethink of G60 ..."); it lasts until their pick.
  if (PERSON_ASK_HOLD.test(held) || isRethinkHold(held)) return true
  if (!BLOCKED_HOLD.test(held)) return false
  const ids = [...new Set(held.match(/B[0-9]+/g) ?? [])]
  return ids.length > 0 && ids.every(id => waitsForPerson(view.items.get(id), view.items, view.held, view.now, view.recaps))
}

/** B1021: the states in which a step is with a worker that was given it or took it. */
const MOVING = ['queued', 'taken', 'in progress']

/**
 * B1021 (X148: B1018 blocked by B1014, which waited for its own ready fix B1020 while the limit held every hand-out): whether a
 * step that blocks a held fix moves: it is with a worker (queued, taken, in progress), or in review behind a chain of open fixes
 * at work (`chainWaitOf` atWork) or ending in a refined fix the ready list does not hold, or whose last fix is held only by a block
 * of steps that move or wait for the person themselves. A step in review for its check, a chain ending in a fix not refined yet
 * or held for another reason, or any other state stands still. `visited` keeps a loop of blocks from running on.
 */
function stepMoves(view, id, visited) {
  const step = view.items.get(id)
  if (step === undefined || visited.has(id)) return false
  visited.add(id)
  const state = stateOf(step)
  if (MOVING.includes(state)) return true
  if (state !== 'review') return false
  const chain = chainWaitOf(id, view.items, view.held, view.now, view.recaps)
  if (chain === null) return false
  if (chain.atWork) return true
  const why = (view.held ?? []).find(one => one.id === chain.end)?.why ?? null
  if (why === null) return stateOf(view.items.get(chain.end)) === 'refined'
  return holdMoves(view, why, visited)
}

/** B1021: whether a held why is a block by steps that all move or wait for the person (`stepMoves`, B916's `personHold`). */
function holdMoves(view, held, visited = new Set()) {
  if (!BLOCKED_HOLD.test(held)) return false
  const ids = [...new Set(held.match(/B[0-9]+/g) ?? [])]
  return ids.length > 0 && ids.every(id => waitsForPerson(view.items.get(id), view.items, view.held, view.now, view.recaps) || stepMoves(view, id, visited))
}

/**
 * 12c. B656 (X8 again: B603 sat in review behind its fix B614, which the ready list held for the answer to an ask, while
 * its line said only "waits for its fix B614"): a step in review whose chain of open fixes ends in a fix the ready list
 * holds (handOut.mjs `readyList`'s held why: outside the focus goal, a blocker, an ask, a standard) for over
 * `reviewMinutes` is one case per chain, named by its first step, with the fix and why. A chain whose last fix is at work
 * (queued, in progress, in review) is no case, however deep. B660 (X59: B603 behind B614, held for the person's answer to
 * Q408): a hold that is the person's open ask ("waits for the answer to Q<n>") is no case, as in B543; B916 (X123): nor is a
 * block by steps that all wait for the person alone (`personHold`); the time counts from
 * when the board first saw this hold (its key holds the why, so a changed why starts again), not from the fix's Since, and
 * from the end of the person's last pause. No ready list in the view: nothing.
 * B1021 (X148: B923 → B953 → B972 → B991 → B1018, held "blocked by B1014 (review)", B1014 behind its own ready fix B1020, while the
 * 5-hour limit held every hand-out): a block by steps that all move (`holdMoves`: with a worker, or behind a chain at work or
 * ending in a refined fix not held) is a wait, no case; nothing is said while a limit is full (the rule does not run, so the
 * watch forgets the key and the hold counts again from the first run after it, and from the limit's reset at the earliest,
 * `limitEndOf`). A chain that stands still after the reset fires as before.
 */
function reviewHeld(view, ctx) {
  const found = []
  if (isPaused(view) || isFull(view) || !Array.isArray(view.held)) return found
  const seen = new Set()
  // By id: a chain's first step comes before its fixes, so it names the case.
  for (const item of stepsOf(view).filter(one => stateOf(one) === 'review').sort((a, b) => byId(idOf(a), idOf(b)))) {
    const wait = reviewWaitOf(item, view.items, view.held, view.now, view.recaps)
    if (wait?.kind !== 'fix' || wait.held === null || seen.has(wait.end)) continue
    seen.add(wait.end)
    const id = idOf(item)
    // B660: the person's open ask is already with them (B543): no case, and nothing watched meanwhile. B664: judged by
    // reviewLateOf, as the health summary judges it.
    const { late, key, ms } = reviewLateOf(view, item, wait, watchOf(ctx))
    if (!late) continue
    // Signals change 6 (Addendum 2): the incident's key is the rule and the chain's first step only; the hold's why stays in
    // the watch's own key (`key`, which times each why apart) and in the text, so a changed why counts the same incident.
    found.push({
      rule: 'review-held', key: `review-held ${id}`, subject: id,
      text: `${id} in review behind its fix ${wait.end}, held ${minutes(ms)} min: ${wait.held}`,
      evidence: `the chain ${[id, ...wait.chain].join(' → ')}; the ready list has held ${wait.end} since ${clockOf(view.now - ms)}: ${wait.held}`,
    })
  }
  return found
}

/**
 * B664 (X8 a third time: the health summary marked review odd where the rules stayed quiet, the gap of B660 and B662): how
 * late a step in review is by what it waits for (`wait`, resultCheck.mjs `reviewWaitOf`), one judgement for the rules
 * review-stuck, dropped-fix and review-held and the health summary (health.mjs). `seenOf(key)`: since when the watch
 * first saw the key (the rules' own watch; the health summary reads the supervisor's memory), undefined for not yet. Not
 * late: the person's answer, a hold that is their open ask or a block by steps that all wait for them alone (B916), a check whose QA task a worker is at work on or that is ready or
 * given and not taken yet (the hand-over's to move, and the rules ready-while-free and handover-unanswered watch it), a
 * report whose check failed (the hand-over tells its worker), anything while the person pauses. Any other hold counts from when the watch first saw it, a check from when its QA task was made (T9.1.1;
 * from when it was asked, with none), a dropped fix from the drop, each from the end of the last pause at the earliest.
 * `{ late, key, ms, words }` (`words` the refine words, for an open fix), or null for a wait the rules judge another way
 * (an open fix at work, a block).
 */
export function reviewLateOf(view, item, wait, seenOf = () => undefined) {
  const id = idOf(item)
  const not = { late: false, key: null, ms: 0, words: [] }
  if (wait === null || wait === undefined) return null
  // B878: a step whose part waits for the person's verdict in a recap waits for them, as for their answer. B883: and one whose
  // card (Accept or Send back) is open under Needs your attention.
  if (wait.kind === 'answer' || wait.kind === 'recap' || wait.kind === 'accept') return not
  if (wait.kind === 'check') {
    if (isPaused(view)) return not
    const key = `review-stuck ${id} check`
    // T9.1.1: the check is a task of the store: counted from when it was made, and a worker at work on it (in progress) is no case.
    const qa = openQaTaskOf(view.items, id)
    // The task knows when it was made, so the first time the watch saw the wait (the days before it existed) counts for nothing.
    const ms = qa === null ? spanOf(view, seenOf, key, afterPause(view, wait.since)) : spanOf(view, () => undefined, key, afterPause(view, madeAtMs(qa)))
    if (qa !== null && valueOf(qa, 'State') === 'in progress') return { ...not, key, ms }
    // At go-live every waiting step gets its task at once and the hand-out gives them one by one: a task that is ready or given
    // (not taken) is the hand-over's to move, and a task nobody takes is the rules `ready-while-free` and `handover-unanswered`'s.
    if (qa !== null && ['refined', 'queued'].includes(valueOf(qa, 'State'))) return { ...not, key, ms }
    return { ...not, late: ms > view.settings.reviewMinutes * MIN, key, ms }
  }
  // T8.5 step 6: the board's check of the report failed and the worker has not reported again: the hand-over's decision
  // tells it at its first turn's end (its rule 3), so the step waits for its worker by design, never late here.
  if (wait.kind === 'report') return not
  // B1103: a check whose checkers twice filed no ask point waits for the partner's word (the repair `unchecked`), late as a dropped fix.
  if (wait.kind === 'dropped' || wait.kind === 'unasked') {
    if (isPaused(view)) return not
    const key = wait.kind === 'unasked' ? `unasked ${id}` : `fix-dropped ${id}`
    const ms = spanOf(view, seenOf, key, afterPause(view, wait.since))
    return { ...not, late: ms > FIX_DROPPED_MS, key, ms }
  }
  if (wait.kind === 'fix' && (wait.unrefined ?? null) !== null) {
    if (isPaused(view)) return not
    // B667 (B664's check: an open fix the partner never refines had no follow-up): counted from when the fix was made; late
    // past `openFixMinutes` once the newest refine word about it is older than `checkWordMinutes` (the board's retry,
    // refineGate.mjs FIX_RETRY_MS, had its chance), as review-stuck reads the check words.
    const key = `open-fix ${wait.end}`
    // B985 (X139): while the person's pick on a rebuild of the fix's goal is open, the fix waits for it by design (the refine
    // gate types no word, goalGuard.mjs `rebuildHoldOf`); once it closed, the hour counts from the close.
    const hold = rebuildHoldOf(view.items.get(wait.end), view.goals, view.items)
    if (hold?.ask !== null && hold?.ask !== undefined) return not
    const from = afterPause(view, Math.max(wait.unrefined.since, hold?.closedAt ?? 0))
    const ms = view.now - from - boardOffMs(view, from)
    const words = refineWordsOf(view, wait.end, wait.unrefined.since)
    const last = words.at(-1) ?? null
    const late = ms > view.settings.openFixMinutes * MIN && (last === null || view.now - last.at > view.settings.checkWordMinutes * MIN)
    return { late, key, ms, words }
  }
  if (wait.kind === 'fix' && wait.held !== null) {
    // B1021 (X148): nothing is handed out while a limit is full, and a block by steps that move is a wait the board planned.
    if (isPaused(view) || isFull(view) || personHold(view, wait.held) || holdMoves(view, wait.held)) return not
    // Counted per why, from when the board first saw this hold (the fix's Since is its move to refined, long before a
    // blocker or an ask may have cleared: B614 refined at 16:39, blocked by B623 until 19:56), and from the end of a full limit.
    const key = `review-held ${wait.end} ${wait.held.slice(0, 80)}`
    const ms = spanOf(view, seenOf, key, null, { floor: limitEndOf(view) })
    return { ...not, late: ms > view.settings.reviewMinutes * MIN, key, ms }
  }
  return null
}

/**
 * 12d. B664 (X8 a third time: B618 → B636 → B654 → B659 and B617 → B631 → B641 → B655 → B661, maps patched four and five
 * times the same way at 46 to 71 of 75, until the person dropped them all): a chain of fixes with three tries or more
 * (resultCheck.mjs `chainTries`) whose newest fix is at work (refined, queued, taken, in progress, waiting on you or in
 * review) with no "Tried before:" line in its what is a third patch of the same way: an incident for the partner, one per
 * chain and newest fix. Its fix the board made open (new: the partner refines it another way) is no case yet.
 */
function chainLong(view) {
  const found = []
  const roots = new Set()
  const atWork = ['refined', 'queued', 'taken', 'in progress', 'waiting on you', 'review']
  for (const item of stepsOf(view).filter(one => valueOf(one, 'Fix of') !== null && atWork.includes(stateOf(one))).sort((a, b) => byId(idOf(b), idOf(a)))) {
    const tries = chainTries(idOf(item), view.items)
    const root = tries[0]
    if (roots.has(root) || ['done', 'dropped'].includes(stateOf(view.items.get(root)))) continue
    roots.add(root)
    const newest = tries.at(-1)
    if (tries.length < 3 || newest !== idOf(item) || hasTriedBefore(item)) continue
    found.push({
      rule: 'chain-long', key: `chain-long ${root} ${newest}`, subject: root,
      text: `${root}: ${tries.length} tries in one chain of fixes, and its newest fix ${newest} names no "Tried before:": a patch of the same way again`,
      evidence: `the chain ${tries.join(' → ')}; ${newest} ${stateOf(item)}, ${valueOf(item, 'Owner') ?? 'no owner'}; roles/partner.md "Two rounds, then another way"`,
    })
  }
  return found
}

/**
 * 12e. B667 (B664's result check, principle 2: an open fix the partner never refines had no follow-up; its refine word
 * went once, probed at +3 h and +2 d): a step in review behind a fix that waits for the partner's refine
 * (resultCheck.mjs `unrefinedFixOf`), late as reviewLateOf judges it for the health summary too: an incident, one per
 * fix, naming the refine words typed and whether the board stopped asking (refineGate.mjs BOARD_TRIES).
 */
function openFix(view, ctx) {
  const found = []
  if (isPaused(view)) return found
  const seen = new Set()
  for (const item of stepsOf(view).filter(one => stateOf(one) === 'review').sort((a, b) => byId(idOf(a), idOf(b)))) {
    const wait = reviewWaitOf(item, view.items, view.held, view.now, view.recaps)
    if (wait?.kind !== 'fix' || (wait.unrefined ?? null) === null || seen.has(wait.end)) continue
    seen.add(wait.end)
    const { late, key, ms, words } = reviewLateOf(view, item, wait, watchOf(ctx))
    if (!late) continue
    const id = idOf(item)
    const arrived = words.filter(one => one.state === 'delivered').length
    const stopped = arrived >= BOARD_TRIES || words.filter(one => one.state === 'failed' || one.state === 'expired').length >= BOARD_TRIES
    found.push({
      rule: 'open-fix', key, subject: wait.end,
      text: `${wait.end} waits ${lasting(ms)} for the partner's refine, and ${id} in review behind it${stopped ? `: the board stopped asking after ${words.length} refine words` : ''}`,
      evidence: `the chain ${[id, ...wait.chain].join(' → ')}; ${wait.end} made ${clockOf(wait.unrefined.since)}, no refine round since; refine words ${words.length === 0 ? 'none' : words.map(one => `${clockOf(one.at)} ${one.state}`).join(', ')}; ${gateOf(view)}`,
    })
  }
  return found
}

/** B868 (X115): what holds the board's refine gate now, for the evidence: the refine asks that are open (step, round, state, since), or that none is. */
const gateOf = view => (view.refineHeld.length === 0 ? 'refine gate free'
  : `refine gate held by ${view.refineHeld.map(one => `${one.id} round ${one.round} (${one.state} since ${clockOf(one.at)})`).join(', ')}`)

/** B667: the refine words about the step `id` from `since` on (the board's and the person's), oldest first. */
function refineWordsOf(view, id, since) {
  return (view.outbox ?? []).filter(message => message?.command === 'refine' && message.about === id && Number.isFinite(message.at) && message.at >= since)
    .sort((a, b) => a.at - b.at)
}

/** A span in words: "45 min", "2 h 10 min". */
const lasting = ms => (ms < HOUR ? `${minutes(ms)} min` : `${Math.floor(ms / HOUR)} h${minutes(ms % HOUR) > 0 ? ` ${minutes(ms % HOUR)} min` : ''}`)
/**
 * B572 (the fix of X24: B522 sat in progress 2 h 36 min, its last checkpoint "report B522" of 19:07 never followed by a
 * report): whether a step in progress has a stale checkpoint, as the rule stale-checkpoint and the health summary read it.
 * 'old': in progress over `checkpointMinutes` with no checkpoint within them (`checkpoint` null: none at all), while its
 * worker's lane says it works (state working: busy, background work, a wait for the partner): a chat that may loop, which
 * only a reader can judge. Signals change 3: the 'report' kind (a checkpoint that said to report, `reportMinutes` ago) is
 * gone, and a holder that stopped is the hand-over's timers' (one "go on" line, then the give-back). Times count from the
 * person's last pause at the earliest, less the time its worker stood suspended for the limit (the review: it cannot
 * write a checkpoint meanwhile). A checkpoint from before the step's current stretch in progress (it waited on you
 * since) counts as none: the stretch counts from its start. Null when it is not late, not in progress, the person
 * pauses, a limit is full, or its worker does not work now (paused for the limit, stopped, asleep). `{ kind, step,
 * checkpoint, quiet }`: `step` how long it has been in progress, `quiet` how long since its last checkpoint (or since
 * the stretch began, without one).
 */
export function checkpointLate(item, view) {
  // Stop and rethink: the person stopped the topic; its worker saves and hands the step back, a quiet checkpoint is no fault.
  if (stateOf(item) !== 'in progress' || isPaused(view) || isFull(view) || rethinkWords(item) !== null) return null
  const owner = workersOf(view).find(lane => plain(lane.name, view.prefix) === plain(valueOf(item, 'Owner'), view.prefix))
  // The asset wait: while the provider draws, the holder runs no turn and writes no checkpoint: a quiet checkpoint is no fault then.
  if (owner?.state !== 'working' || owner.heldBy === 'asset') return null
  const began = sinceMs(valueOf(item, 'Since'))
  if (!Number.isFinite(began)) return null
  const checkpoint = checkpointOf(item)
  const written = Number.isFinite(checkpoint?.at) && checkpoint.at >= began ? checkpoint.at : null
  const counted = from => view.now - afterPause(view, from) - boardOffMs(view, afterPause(view, from)) - (owner === undefined ? 0 : standingStillMs(view, owner.name, afterPause(view, from)))
  const quiet = counted(written ?? began)
  const late = { step: view.now - began, checkpoint, quiet }
  return counted(began) > view.settings.checkpointMinutes * MIN && quiet > view.settings.checkpointMinutes * MIN ? { kind: 'old', ...late } : null
}

/**
 * B572, X80: how long the chat stood suspended for the limit, or was off (not running), between `from` and now, by its
 * timeline's spans: it can write no checkpoint meanwhile. The board's own stops are boardOffMs's.
 */
function standingStillMs(view, name, from) {
  const spans = view.timeline.find(one => plain(one.chat, view.prefix) === plain(name, view.prefix))?.spans ?? []
  return spans.filter(span => span.state === 'suspended' || span.state === 'off')
    .reduce((sum, span) => sum + Math.max(0, Math.min(span.to ?? view.now, view.now) - Math.max(span.from, from)), 0)
}

/**
 * 13. B572: a step in progress with a stale checkpoint (checkpointLate): one finding per step, so a lasting one counts up as
 * one incident (signals change 6: a newer stale checkpoint of the same step counts the same one).
 */
function staleCheckpoint(view) {
  const found = []
  for (const item of stepsOf(view).sort((a, b) => byId(idOf(a), idOf(b)))) {
    const late = checkpointLate(item, view)
    if (late === null) continue
    const id = idOf(item)
    const { checkpoint } = late
    const who = `${id} in progress for ${lasting(late.step)} (${valueOf(item, 'Owner') ?? 'nobody'})`
    const text = checkpoint === null ? `${who} with no checkpoint` : `${who} with no checkpoint for ${lasting(late.quiet)}`
    found.push({
      // Signals change 6 (Addendum 2; X75 'stale-checkpoint B670 none', X84): the key is the rule and the step only: a newer
      // stale checkpoint of the same step is the same case, which must not read as gone and open again.
      rule: 'stale-checkpoint', key: `stale-checkpoint ${id}`, subject: id, text,
      evidence: `in progress since ${clockOf(sinceMs(valueOf(item, 'Since')))}; ${checkpoint === null ? 'no checkpoint in its record'
        : `checkpoint ${checkpoint.commit ?? 'none'} · ${checkpoint.next} at ${Number.isFinite(checkpoint.at) ? clockOf(checkpoint.at) : 'a time not known'}`}`,
    })
  }
  return found
}

// Redesign Part 2: `familyOf` lives in effort.mjs (the hand-out reads it too); kept here for those who import it from here.
export { familyOf }
/** A step's take: its newest History line that took it ("queued → taken", or straight to in progress). */
const TAKE_LINE = /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)\s+[^:]+: \S+ → taken\b|^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)\s+[^:]+: queued → in progress\b/
function takenAtOf(item) {
  const found = (item.sections?.get('History') ?? []).map(line => TAKE_LINE.exec(line)).filter(Boolean).at(-1)
  const at = found === undefined ? Number.NaN : sinceMs(found[1] ?? found[2])
  return Number.isFinite(at) ? at : sinceMs(valueOf(item, 'Since'))
}

/**
 * B576 (the fix of X26: Worker 5 ran medium while B568 wanted low, 0 min after it took B568, before the main chat could
 * switch it): how the switch of a chat to its step's setting stands, as the rule effort-mismatch and the health summary
 * read it. `runs` and `wants` ("sonnet · medium"), `mismatch` (the effort differs, or the model where the board sets
 * models: `effortRun.model`; a chat whose effort the board does not know is none), `state` from the board's switch
 * (`effortRun` of this step): 'switched' (read back), 'asked' (`askedAt`, `askState`) or 'none'; `takenAt`, and `late`:
 * a mismatch not switched over `switchMinutes` after the take, counted from the end of the person's last pause, while
 * nothing holds the switch (the pause, a full limit). Null for a lane or step it cannot judge.
 */
export function switchOf(lane, item, view) {
  if (lane === undefined || lane === null || item === undefined || item === null) return null
  const id = idOf(item)
  const own = lane.effortRun?.step === id ? lane.effortRun : null
  const effort = chatEffort(lane)
  const family = familyOf(lane.model)
  const want = { family: modelOf(item).family, level: effortOf(item).level }
  const isModelSet = typeof own?.model === 'string'
  const mismatch = effort !== null && (effort !== want.level || (isModelSet && family !== null && family !== want.family))
  const state = own?.isSet === true ? 'switched' : own?.asked != null ? 'asked' : 'none'
  const takenAt = takenAtOf(item)
  const taken = afterPause(view, takenAt)
  const since = view.now - taken - boardOffMs(view, taken)
  const late = mismatch && state !== 'switched' && !isPaused(view) && !isFull(view) && Number.isFinite(since) && since > view.settings.switchMinutes * MIN
  return {
    runs: `${family ?? 'a model not known'} · ${effort ?? 'effort not known'}`, wants: `${want.family} · ${want.level}`, mismatch, state,
    askedAt: own?.asked?.at ?? null, askState: own?.asked?.state ?? null, takenAt, since, late,
  }
}

/**
 * 14. B576: a worker whose model or effort differs from its step's over `switchMinutes` after it took the step, with no
 * switch read back (switchOf): one finding per chat (signals change 6: its step in the text, not the key), which counts up while it lasts.
 */
function effortMismatch(view) {
  const found = []
  for (const lane of workersOf(view)) {
    const item = stepsOf(view).filter(one => ['taken', 'in progress', 'waiting on you'].includes(stateOf(one)) && plain(valueOf(one, 'Owner'), view.prefix) === plain(lane.name, view.prefix))
      .sort((a, b) => byId(idOf(a), idOf(b)))[0]
    const at = switchOf(lane, item, view)
    if (at === null || !at.late) continue
    const id = idOf(item)
    found.push({
      // Signals change 6 (Addendum 2; X110 'effort-mismatch Worker 4 B810'): the key is the rule and the chat only; the step is in the text.
      rule: 'effort-mismatch', key: `effort-mismatch ${lane.name}`, subject: lane.name,
      text: `${lane.name} runs ${at.runs} ${minutes(at.since)} min after it took ${id}, which wants ${at.wants}`,
      evidence: `took ${id} at ${clockOf(at.takenAt)}; ${at.state === 'asked' ? `switch asked ${clockOf(at.askedAt)} (${at.askState ?? 'not known'}), not read back` : 'no switch asked'}; the app's file says ${at.runs}`,
    })
  }
  return found
}

/**
 * X47, X55, X56: the percent from which a limit's last reading counts as near a stop (the 5-hour limit at
 * `oldReadingFiveHourPercent`, the weekly at `oldReadingWeekPercent`); `settings` may hold only some of the supervisor's
 * settings, the defaults fill the rest. An old reading below it changes no decision: neither the rule old-limit-reading nor
 * the sweep's lookup (index.mjs `limitsOld`) is worth it then.
 */
export const stopLevelOf = (key, settings = {}) => ({ ...SUPERVISOR_DEFAULTS, ...settings })[key === 'fiveHour' ? 'oldReadingFiveHourPercent' : 'oldReadingWeekPercent']
/** Whether a limit's last reading (`limit.used`) is at or over its stop level (`stopLevelOf`). */
export const isNearStop = (limit, key, settings = {}) => Number.isFinite(limit?.used) && limit.used >= stopLevelOf(key, settings)

/**
 * 17. B601 (the fix of X47: at 15:32 both limits showed "read at 14:35" while the pause ran): a limit whose newest
 * reading is older than `oldReadingIncidentMinutes` (60) while a worker works (B645: not while the person pauses; B649: the age counts from the pause's end), when the app's file or a chat
 * should have given a newer one (B632, the fix of X55 and X56: past `oldReadingMinutes` (30) the supervisor chat looks the limits
 * up once with get_usage, which the board reads as a chat reading; under 60 only the health line shows the age). One finding per limit; it clears when a newer reading comes. A limit nothing is
 * known of is the health summary's "not known", not this rule's. X47, X55, X56 (false alarms: readings of 2% and 64%): an old
 * reading changes no decision unless it stands near a stop, so only a last reading of the 5-hour limit at
 * `oldReadingFiveHourPercent` (80) or more, or of the weekly limit at `oldReadingWeekPercent` (90) or more, raises it.
 */
function oldLimitReading(view) {
  const found = []
  // The asset wait: a lane working for the provider's pictures spends nothing of the limits.
  const works = workersOf(view).some(lane => lane.state === 'working' && lane.heldBy !== 'asset')
  // B645: quiet while the person pauses: nothing spends then, a reset is known by its time, and no sweep word is delivered until the resume.
  if (isPaused(view) || !works) return found
  for (const [key, name] of [['fiveHour', '5-hour limit'], ['week', 'weekly limit']]) {
    // B649: counted from the end of the last pause at the earliest, as the other rules: the figure was not stale while nothing spent, and the supervisor's lookup after the resume has its time to land.
    const limit = view.limits?.[key]
    // B727 (X56 reopened 3 min after a 20 h sleep): the board's off time does not count either, as in the other rules; after a wake the supervisor's next lookup comes first.
    const from = Number.isFinite(limit?.at) ? afterPause(view, limit.at) : null
    const counted = from === null ? null : readingAgeMinutes({ at: from + boardOffMs(view, from) }, view.now)
    if (counted === null || counted <= view.settings.oldReadingIncidentMinutes) continue
    // X47, X55, X56: an old low reading changes no decision; only one near a stop matters.
    if (!isNearStop(limit, key, view.settings)) continue
    const stopAt = stopLevelOf(key, view.settings)
    const age = readingAgeMinutes(limit, view.now)
    found.push({
      rule: 'old-limit-reading', key: `old-limit-reading ${key}`, subject: 'board',
      text: `the ${name} was last read ${age} min ago (${clockOf(view.limits[key].at)}), the board steers by an old figure`,
      evidence: `${key} ${Math.round(view.limits[key].used)}% at ${clockOf(view.limits[key].at)}, near a stop (${stopAt}% or more); now ${clockOf(view.now)}; a worker works; threshold ${view.settings.oldReadingIncidentMinutes} min (the supervisor looks the limits up with get_usage past ${view.settings.oldReadingMinutes} min); the app's usage file is written only while the app is in use`,
    })
  }
  return found
}

/**
 * 18. B736 (the limit of X73's fix): the board heard no chat for longer than DEAF_KEEP_MS while chats wrote their
 * conversations (view.mjs `deafNow`): from then on its lanes are read as before (unknown, then off), and this one finding
 * says the board is what is stuck, so a hung board is never hidden behind lanes that keep their last state.
 */
function boardDeaf(view) {
  const open = view.deafNow ?? null
  if (open === null || isPaused(view)) return []
  const ms = view.now - open.from
  if (ms <= DEAF_KEEP_MS) return []
  return [{
    rule: 'board-deaf', key: 'board-deaf board', subject: 'board',
    text: `the board heard no chat for ${minutes(ms)} min (since ${clockOf(open.from)}) while chats wrote their conversations`,
    evidence: `no take or report reached the board since ${clockOf(open.from)}; chats wrote their conversations since; the lanes kept their last state for ${minutes(DEAF_KEEP_MS)} min, then read as before`,
  }]
}

/** B736: two late answers this close together are a board that does not answer, not one slow call. */
const SLOW_PAIR_MS = 2 * MIN
/** B736: how far back a late answer still counts. */
const SLOW_LOOK_MS = 10 * MIN
/** A call sent this close after a sleep began (or before) still counts as sent before it. */
const SLEEP_SLACK_MS = 5000
/** Round 3: a stall of the loop can be a hang with the PC awake only under this long, and only for a call sent this long before its end. */
const HANG_MAX_MS = 60 * MIN
const HANG_END_MS = MIN

/** B934: how many of the board's newest stalls the finding cites. */
const SLOW_CITES = 3
const secondsOf = ms => `${clockOf(ms)}:${pad(new Date(ms).getSeconds())}`

/**
 * 19. B736 (X89, the rule the sweep wanted: work health timed out twice in a row): two work calls within 2 minutes that the
 * board answered after the chat's Workers mod had given up on them (view.mjs `lateCalls`, from each call's request id):
 * one finding, naming the longest wait. B934 (X93): its evidence cites the board's newest stalls in that time (the stall
 * log, stalls.mjs: what the board ran while it did not answer), or says the log names none. B1049: a sleep of the PC is no
 * slow board: a call its chat sent before a sleep began and that was answered after it began is not counted (a call sent inside the window proves the PC was awake), and
 * the evidence names the sleep in its own words ("slept: ..."). Round 2: a "sleep" that a counted call was sent inside was a hang with the PC awake: cited under stalls as such, never as slept.
 */
function boardSlow(view) {
  const sleeps = (view.stalls ?? []).filter(isSleep)
  // A call counts unless its chat sent it before a sleep began: the chats sleep with the PC, so a call sent inside the window
  // proves the PC was awake (a hang of the board), however long it waited.
  const duringSleep = call => sleeps.some(sleep => call.at - call.ms <= sleep.at - sleep.ms + SLEEP_SLACK_MS && call.at > sleep.at - sleep.ms)
  const recent = (view.lateCalls ?? []).filter(one => view.now - one.at <= SLOW_LOOK_MS && !duringSleep(one)).sort((a, b) => a.at - b.at)
  if (!recent.some((one, index) => index > 0 && one.at - recent[index - 1].at <= SLOW_PAIR_MS)) return []
  const worst = Math.max(...recent.map(one => one.ms))
  const inLook = (view.stalls ?? []).filter(one => view.now - one.at <= SLOW_LOOK_MS).sort((a, b) => a.at - b.at)
  // Round 2: a "sleep" that a counted call was sent inside was a hang with the PC awake: cited as a hang, never as slept.
  // Round 3: only a window under an hour can be a hang, and a call proves it only when sent over a minute before its end (a call sent
  // at the wake tick of a real night proves nothing).
  const awake = sleep => sleep.ms < HANG_MAX_MS && recent.some(call => call.at - call.ms > sleep.at - sleep.ms + SLEEP_SLACK_MS && call.at - call.ms < sleep.at - HANG_END_MS)
  const hangs = inLook.filter(one => isSleep(one) && awake(one))
  const stalls = inLook.filter(one => !isSleep(one) || awake(one)).slice(-SLOW_CITES)
  const slept = inLook.filter(one => isSleep(one) && !awake(one)).slice(-SLOW_CITES)
  const stallLine = one => (hangs.includes(one) ? `the loop blocked ${minutes(one.ms)} min to ${secondsOf(one.at)}; calls were sent inside it: not a sleep` : stallWords(one, secondsOf))
  return [{
    rule: 'board-slow', key: 'board-slow board', subject: 'board',
    text: `the board did not answer for ${Math.round(worst / 1000)} s: ${recent.length} work calls in ${minutes(SLOW_LOOK_MS)} min answered after the chat gave up`,
    evidence: [
      recent.slice(-6).map(one => `answered ${clockOf(one.at)} after ${Math.round(one.ms / 1000)} s`).join('; '),
      stalls.length === 0 ? `the stall log names no stall in ${minutes(SLOW_LOOK_MS)} min` : `stalls: ${stalls.map(stallLine).join('; ')}`,
      slept.length === 0 ? null : `slept: ${slept.map(one => stallWords(one, secondsOf)).join('; ')}`,
    ].filter(Boolean).join('. '),
  }]
}

/** B742, B984: how long a worker may keep working after the board's week-stop word reached it before the rule opens. */
const WEEK_STOP_WAIT_MS = 20 * MIN

/**
 * 20. B742 (X95, X96, the rule the sweep wanted: at 98% of the week Workers 2, 3 and 5 worked on from 22:20 to 22:32 with no
 * lane suspended): the week stands at the person's stop line (view.limits.week: `level` full, `used` from `stopAt`), the board
 * told a working worker to stop (the word `week-stop` in the outbox), and it still works 20 min of running time after that
 * word reached it (the pause and the board's off time do not count). B984 (X138: Worker 4 paused at once when its word
 * arrived, but an expired word of the week before timed it from 09:56): the word that counts is the worker's newest word of
 * this week's reset that was delivered (`deliveredAt`); an older week's word or one not delivered is no case (rule
 * `undelivered` watches those). Timed from the delivery alone, a key for each word. A lane that works is no pause, so another
 * lane being suspended silences nobody. One finding for each late worker; the word is never typed twice (a safe point takes minutes).
 */
function weekStopIgnored(view, ctx) {
  const week = view.limits?.week ?? null
  if (isPaused(view) || week === null || week.level !== 'full' || !Number.isFinite(week.used) || !Number.isFinite(week.stopAt) || week.used < week.stopAt) return []
  const resets = Number.isFinite(week.resetsAt) ? week.resetsAt : null
  const found = []
  for (const lane of workersOf(view).filter(one => one.state === 'working' && one.heldBy !== 'asset')) {
    const word = (view.outbox ?? [])
      .filter(sent => sent.command === 'week-stop' && sent.to === lane.name && (sent.weekResets ?? null) === resets && sent.state === 'delivered' && Number.isFinite(sent.deliveredAt))
      .reduce((a, b) => (a === null || b.deliveredAt > a.deliveredAt ? b : a), null)
    if (word === null) continue
    const ms = lasted(view, ctx, `week-stop-ignored ${lane.name} ${word.id}`, afterPause(view, word.deliveredAt))
    if (ms <= WEEK_STOP_WAIT_MS) continue
    found.push({
      rule: 'week-stop-ignored', key: `week-stop-ignored ${lane.name} ${word.id}`, subject: lane.name,
      text: `the week is at ${Math.round(week.used)}%, its stop line is ${week.stopAt}%, and ${lane.name} still works ${minutes(ms)} min after the board's word to stop`,
      evidence: `week ${Math.round(week.used)}% (stop line ${week.stopAt}%); the board's word to stop reached ${lane.name} at ${clockOf(word.deliveredAt)}, ${minutes(ms)} min ago; no pause note since; threshold ${minutes(WEEK_STOP_WAIT_MS)} min`,
    })
  }
  return found
}

/**
 * B758: how long the board may take to read a figure the app wrote: a give or a start sent this soon after the figure's own
 * time may have gone before the board saw it, which is no fault of the stop line.
 */
const FIVE_HOUR_READ_MS = 2 * MIN

/** B758: the History line of the board's give (api.mjs `give`), with its time. */
const GIVEN_LINE = /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)\s+server: .*→ queued \(given by the board to /

/**
 * 21. B758 (X99, the rule the sweep wanted: at 99% of the 5-hour limit with its reset 25 min off, B744, B743 and B746 were given
 * at 12:25 to 12:28 and Workers 1 to 3 started): the 5-hour limit stands at its stop line (view.limits.fiveHour: `level` full,
 * `used` from `stopAt`; limits.mjs holds it only while the reset is over 10 min off, or at 100), and the board gave a step (the
 * step's History line "refined → queued (given by the board to <chat>)", not the later line that tells the chat) or started a
 * worker (a `start` or `spawn` word of the hand-out, which carries `reported`) after the figure was read. One finding naming
 * them; it clears when the limit leaves its stop line.
 */
function fiveHourStopIgnored(view) {
  const five = view.limits?.fiveHour ?? null
  if (isPaused(view) || five === null || five.level !== 'full' || !Number.isFinite(five.used) || !Number.isFinite(five.stopAt) || five.used < five.stopAt || !Number.isFinite(five.at)) return []
  const after = afterPause(view, five.at + FIVE_HOUR_READ_MS)
  const sent = (view.outbox ?? []).filter(word => Number.isFinite(word.at) && word.at > after && ['failed', 'expired', 'dropped'].includes(word.state) === false)
  const gives = stepsOf(view).flatMap(item => (item.sections?.get('History') ?? []).map(line => line.match(GIVEN_LINE)?.[1])
    .filter(stamp => stamp !== undefined && sinceMs(stamp) >= after).map(stamp => ({ about: idOf(item), at: sinceMs(stamp) })))
  const starts = sent.filter(word => (word.command === 'start' || word.command === 'spawn') && Number.isFinite(word.reported))
  if (gives.length === 0 && starts.length === 0) return []
  const names = [...gives.map(word => `${word.about} at ${clockOf(word.at)}`), ...starts.map(word => `${word.command === 'start' ? `start of ${word.about}` : 'a new worker'} at ${clockOf(word.at)}`)]
  return [{
    rule: 'five-hour-stop-ignored', key: 'five-hour-stop-ignored board', subject: 'board',
    text: `the 5-hour limit is at ${Math.round(five.used)}%, its stop line is ${five.stopAt}%, and the board still gave or started: ${names.join(', ')}`,
    evidence: `5-hour ${Math.round(five.used)}% read at ${clockOf(five.at)} (stop line ${five.stopAt}%${Number.isFinite(five.resetsAt) ? `, resets ${clockOf(five.resetsAt)}` : ', reset not known'}); sent after that: ${names.join('; ')}`,
  }]
}

/** T8.5 step 4: an envelope's outcome in a few words, for the evidence. */
const outcomeWords = outcome => (outcome === null || outcome === undefined ? 'no outcome'
  : ['cleared', 'set', 'typed', 'restarted'].filter(one => outcome[one] === true || outcome[one] === false).map(one => `${one} ${outcome[one] ? 'yes' : 'no'}`).join(', ') + (outcome.background === true ? ', background work ran' : ''))

/**
 * 29. T8.5 step 4 (the spec 2026-10-31-handover-design.md, "What the Supervisor rules become"; in place of not-cleared and
 * the clear part of skip-repeats for a worker on the sequence): a worker on the sequence HELD (its lane's `handover`: its
 * last envelope failed, its clear, its set or its restart did not run; its task went back at once) for longer than
 * `notClearedMinutes` of the board's running time (the pause, the board off and the stretches it heard no chat left out),
 * from the envelope's failure. One finding per worker and report, with the Workers mod's why. Only workers on the sequence.
 */
function handoverHeld(view, ctx) {
  const found = []
  if (isPaused(view)) return found
  for (const lane of workersOf(view).filter(one => one.onSequence === true)) {
    if (lane.handover?.state !== STATES.HELD) continue
    // The lazy clear (Task 4, D4; the Task 4 review): never on a clear outcome, by decide itself: it holds only on a failed
    // envelope (failedOf), and a clear owed while its line went in is none (isClearOwedOnly): the lane's HELD is the fact.
    const failed = envelopesOf(view.outbox, lane.name, view.prefix).filter(one => one.state === 'failed').at(-1) ?? null
    const since = [failed?.settledAt, failed?.failedAt, failed?.at].find(Number.isFinite) ?? null
    const report = lane.clearOwed?.step ?? failed?.clear?.step ?? failed?.step ?? failed?.id ?? 'its last report'
    // The lead's live check (2026-11-02, order C): the key is the rule and the chat, not the step: the same fault (a worker
    // that cannot clear) reopens its one alarm; keyed per step, X132 and X133 read fixed while Workers 3 and 4 were held
    // anew. The report stays in the evidence.
    const key = `handover-held ${lane.name}`
    const ms = lasted(view, ctx, key, since === null ? null : afterPause(view, since), { heard: true })
    if (ms <= view.settings.notClearedMinutes * MIN) continue
    const why = lane.handover.why ?? 'no reason given'
    const told = failed === null ? 'no failed envelope in the outbox'
      : `envelope ${failed.id} (${failed.kind ?? 'task'}${typeof failed.step === 'string' ? ` ${failed.step}` : ''}) out at ${clockOf(failed.at)}, failed at ${since === null ? 'a time not known' : clockOf(since)}: ${outcomeWords(failed.outcome)}; the Workers mod's why: ${failed.outcome?.why ?? failed.why ?? 'none'}`
    found.push({
      rule: 'handover-held', key, subject: lane.name, ...(since === null ? {} : { since }),
      text: `${lane.name} held ${minutes(ms)} min: ${why}`,
      evidence: `${told}; last report ${report}; its report now: ${lane.report?.state ?? 'none'}${lane.report?.background === true ? ' with background work' : ''}; released by its next turn's end, or its report going idle with nothing in the background`,
    })
  }
  return found
}

/**
 * The lazy clear (Task 4, R6 with D7): a worker on the sequence whose last three hand-overs that asked a clear all settled
 * cleared:false with the Workers mod's clearWhy (0.31.0's: its line went anyway, so nothing holds it). One finding per chat,
 * keyed `clear-owed-repeat <chat>`, judged by the Supervisor as any; a refusal under the person's pause and a 0.30.0 failed
 * clear (no clearWhy) are not counted (`clearOutcomesOf`); a clear that ran ends the run. Two in a row: none.
 */
function clearOwedRepeat(view) {
  const found = []
  for (const lane of workersOf(view).filter(one => one.onSequence === true)) {
    // The Task 4 review: only while the clear is still owed (the person's /clear or a late `cleared` stage met it: none).
    if ((lane.clearOwed ?? null) === null) continue
    const last = clearOutcomesOf(envelopesOf(view.outbox, lane.name, view.prefix)).slice(-CLEAR_OWED_RUN)
    if (last.length < CLEAR_OWED_RUN || last.some(one => one.isCleared)) continue
    const settled = one => [one.envelope.settledAt, one.envelope.deliveredAt, one.envelope.failedAt, one.envelope.at].find(Number.isFinite) ?? null
    const since = settled(last[0])
    found.push({
      rule: 'clear-owed-repeat', key: `clear-owed-repeat ${lane.name}`, subject: lane.name, ...(since === null ? {} : { since }),
      text: `${lane.name}'s clear did not run at its last ${CLEAR_OWED_RUN} hand-overs in a row: ${last.at(-1).clearWhy}`,
      evidence: last.map(one => `envelope ${one.envelope.id} (${one.envelope.step ?? 'no task'}, its clear after ${one.envelope.clear?.step ?? 'a step'}) settled ${settled(one) === null ? 'at a time not known' : clockOf(settled(one))}: ${one.clearWhy}`).join('; '),
    })
  }
  return found
}
/** The lazy clear: how many hand-overs in a row whose clear did not run open clear-owed-repeat. */
const CLEAR_OWED_RUN = 3

/** T8.5 step 4: how far back a fired net still counts as a finding (one per envelope, so its incident counts it once). */
const UNANSWERED_LOOK_MS = DAY

/** A History line's stamp and who wrote it: "- 2026-11-02 11:10 server: queued → taken (for Worker 1)". */
const HISTORY_WHO = /^-\s+(\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?) ([^:]{1,80}):\s*(.*)$/
/**
 * Change 4's follow-up: whether a step was handled after `since`: a History line after it that moves the step (" → "),
 * gives it to a worker ("given by the board to", "given to"), or is the person's. Null item: not handled.
 */
function handledSince(item, since) {
  if (item === null || item === undefined || !Number.isFinite(since)) return false
  return (item.sections?.get('History') ?? []).some(entry => {
    const found = HISTORY_WHO.exec(entry)
    if (found === null) return false
    const at = sinceMs(found[1])
    if (!Number.isFinite(at) || at <= since) return false
    return found[2].trim().toLowerCase() === 'person' || / → /.test(found[3]) || /\bgiven (?:by the board )?to\b/.test(found[3])
  })
}

/**
 * 30. T8.5 step 4 (in place of not-taking for a worker on the sequence): the hand-over's one net fired: an envelope that
 * had no outcome, no take and no turn's end for `NET_MS` (10 min) of the board's running time (`netAt` on the envelope,
 * handoverBoard.mjs); its task went back once and the worker shows "did not answer its hand-over". One finding per
 * envelope, for a day after the net. Only workers on the sequence.
 */
function handoverUnanswered(view) {
  const found = []
  for (const lane of workersOf(view).filter(one => one.onSequence === true)) {
    for (const envelope of envelopesOf(view.outbox, lane.name, view.prefix)) {
      if (!Number.isFinite(envelope.netAt) || view.now - envelope.netAt > UNANSWERED_LOOK_MS) continue
      // Fix 0.31.0 (part 4, X141 counted ba127291 104 times): a lone clear from before 0.31.0 that the board's start sweep has settled
      // (closeClearOnly: dropped, with its own why) is no miss any more. Not every dropped envelope: the net closes its own waiting
      // envelope dropped (why UNANSWERED_WHY, or none), and that one is the very miss this rule names.
      if (envelope.state === 'dropped' && [CLEAR_ONLY_CLOSED_WHY, CLEAR_ONLY_TAKEN_WHY].includes(envelope.why)) continue
      // B1033 (X141 counted 111 times on a take that never settled): an envelope settled delivered after the net (a late
      // answer, or the outbox sweep's net for a clear that went alone) was answered: it is no miss any more.
      if (envelope.state === 'delivered') continue
      // Change 4's follow-up (2026-11-02, X119 counted 71 times hours after its net): a miss whose task was handled since
      // (taken, given to another worker, moved or touched by the person) is not found again: its look ends at that move.
      if (typeof envelope.step === 'string' && handledSince(view.items?.get(envelope.step), envelope.netAt)) continue
      // The key (2026-11-02, the lead's defect note after change 4: a key with the wake record's spell took a lane or report
      // time, so the same misses opened again at every lane change, X124-X130 in 17 minutes): the rule, the chat and the
      // envelope's id, which never changes. One finding per envelope; a bounce through four workers is four misses.
      const key = `handover-unanswered ${lane.name} ${envelope.id}`
      const step = typeof envelope.step === 'string' ? envelope.step : null
      found.push({
        rule: 'handover-unanswered', key, subject: lane.name, since: envelope.at,
        text: `${lane.name} ${UNANSWERED_WHY}${step === null ? '' : ` (${step})`} within ${minutes(NET_MS)} min${step === null ? '' : `; ${step} went back on the list`}`,
        evidence: `envelope ${envelope.id} (${envelope.kind ?? 'task'}${step === null ? '' : ` ${step}`}) out at ${clockOf(envelope.at)}, ${envelope.state}${envelope.clear ? `, with the clear after ${envelope.clear.step ?? 'its report'}` : ''}; the net fired at ${clockOf(envelope.netAt)}; its lane now: ${lane.handover?.state ?? 'not known'}; its report: ${lane.report?.state ?? 'none'}${Number.isFinite(lane.report?.since) ? ` since ${clockOf(lane.report.since)}` : ''}`,
      })
    }
  }
  return found
}

/** The board's local date of a time, YYYY-MM-DD. */
const dayOfMs = ms => `${new Date(ms).getFullYear()}-${pad(new Date(ms).getMonth() + 1)}-${pad(new Date(ms).getDate())}`

/**
 * The start-up check (2026-11-05): whether the newest check (finished, its read not cut short) lists the chat under a cause it names in
 * its own incident (check-unreachable): the other account, a restart to do, or no chat. Then the per-chat wake rules say nothing of it.
 */
const CHECK_CAUSES = [
  { cause: 'account-switch', field: 'elsewhere', words: `your chats are in ${OTHER_ACCOUNT_TAIL}` },
  { cause: 'restart-needed', field: 'restartNeeded', words: RESTART_WHY },
  { cause: 'not-joined', field: 'notJoined', words: "chat runs but is not on the board's list: it must re-join" },
  { cause: 'no-chat', field: 'nowhere', words: 'no chat in the app: open one from the board' },
]
// Review 2 (4): while a check runs, the last finished result still stands (the runner's view keeps its lists), so the per-chat rules do not file in those seconds.
const isCheckFresh = view => view.check !== null && view.check?.tooSlow !== true
const listedByCheck = (view, chat) => isCheckFresh(view) && CHECK_CAUSES.some(one => (view.check[one.field] ?? []).includes(chat))

/**
 * The start-up check, plan task 6: ONE incident per CAUSE (key "check-unreachable <cause>", the same while the cause lasts, so the board
 * counts it and never files it again), naming every chat the last check could not reach for that cause. It stands while the check
 * lists the cause; the next check that lists nobody under it makes the finding absent, and the gone clock closes the incident.
 */
function checkUnreachable(view) {
  if (!isCheckFresh(view)) return []
  return CHECK_CAUSES.filter(one => (view.check[one.field] ?? []).length > 0).map(one => ({
    rule: 'check-unreachable', key: `check-unreachable ${one.cause}`, subject: 'board',
    text: `${one.words}: ${view.check[one.field].join(', ')}`,
    evidence: [`the check at ${clockOf(view.check.at)} (${view.check.trigger ?? 'start'}) listed them: ${view.check.line ?? ''}`],
  }))
}

/**
 * Signals change 4, B908 (decision 7; X119-X121: the launches of 10:32-11:08 that started nothing): a chat the board could
 * not wake: its wake failed on every path it could take (state.mjs lane `wake.final`: the app did not start it on a launch,
 * and no message reached it, or it has no id). One finding per chat and spell, with what was tried and when.
 */
function wakeFailed(view) {
  return wakeLanesOf(view).filter(lane => lane.wake?.state === 'failed' && lane.wake.final === true && !listedByCheck(view, lane.name)).map(lane => {
    const attempts = Array.isArray(lane.wake.attempts) ? lane.wake.attempts : []
    const tried = attempts.length === 0 ? [lane.wake.why === 'no id' ? 'the board has no id to reach it' : lane.wake.why ?? 'no reason given'] : triedWords(attempts, clockOf)
    return {
      rule: 'wake-failed', key: `wake-failed ${lane.name} ${lane.wake.spell ?? 'none'}`, subject: lane.name,
      ...(Number.isFinite(attempts[0]?.at) ? { since: attempts[0].at } : {}),
      text: `could not wake ${lane.name}: ${tried.join('; ')}`,
      evidence: attempts.length === 0 ? `no attempt: ${lane.wake.why ?? 'none'}` : attempts.map(one => `${one.path} at ${clockOf(one.at)} by ${one.by}${Number.isFinite(one.sentAt) ? `, sent ${clockOf(one.sentAt)}` : ''}: ${one.verdict ?? 'pending'}${one.why ? ` (${one.why})` : ''}`).join('; '),
    }
  })
}

/**
 * Signals change 4, B908 (decision 7): nobody answers the board's wake-ups: every chat that needs a wake failed on every
 * path, and the board-wide spell's launch failed too. One finding per day (the board's local date).
 */
function nobodyAnswersWakes(view) {
  // The start-up check names the chats it could not reach in one incident of their cause: they are not a second alarm here.
  const needs = wakeLanesOf(view).filter(lane => lane.wake?.need === true && !listedByCheck(view, lane.name))
  const board = view.wakes?.['*'] ?? null
  // The review of 2026-11-02 (7): only the board-wide spell of now, or one that failed within a day.
  const failedAt = Math.max(...(board?.attempts ?? []).map(one => one.verdictAt).filter(Number.isFinite))
  const isNow = board !== null && ((Number.isFinite(view.wakeBoardSince) && board.spell === view.wakeBoardSince) || view.now - failedAt <= DAY)
  if (needs.length === 0 || !needs.every(lane => lane.wake.state === 'failed' && lane.wake.final === true) || board?.state !== 'failed' || !isNow) return []
  return [{
    rule: 'nobody-answers-wakes', key: `nobody-answers-wakes ${dayOfMs(view.now)}`, subject: 'board',
    text: `nobody answers the board's wake-ups: ${needs.map(lane => lane.name).join(', ')} could not be woken, and the launch when nobody ran failed`,
    evidence: [`the board-wide launch: ${triedWords(board.attempts ?? [], clockOf).join('; ') || board.why || 'failed'}`, ...needs.map(lane => `${lane.name}: ${triedWords(lane.wake.attempts ?? [], clockOf).join('; ') || lane.wake.why}`)].join(' · '),
  }]
}

/** B763: the Workers mod's words for a clear it skipped because the person pauses (its chats.ts `clearWhy`). */
const PAUSE_WHY = 'the person pauses the chats'
/** B763: how long after the resume a chat's mod may still decide on a reading from before it (it reads anew per clear). */
const PAUSE_READ_MS = MIN

/**
 * 22. B763 (X86, X100, the rule the sweep wanted: Worker 3 reported B727 as the person paused at 12:28; after the resume at
 * 12:52 its Workers mod refused its own clear every minute "the person pauses the chats", from the reading its last turn's
 * end had left, and every step given to it waited 20 min and went back): a chat's clear skipped for the pause more than a
 * minute after the pause stopped holding (`holdEndOf`). One finding per chat, which counts up while it lasts; a skip inside
 * the pause, or while a new one holds, is none.
 */
function pauseStale(view) {
  const end = holdEndOf(view.pause)
  if (end === null) return []
  const found = []
  for (const lane of view.lanes.filter(one => !one.isLeftover)) {
    const skip = lane.compaction?.notCleared ?? null
    if (skip?.why !== PAUSE_WHY || !Number.isFinite(skip.at) || skip.at <= end + PAUSE_READ_MS) continue
    found.push({
      rule: 'pause-stale', key: `pause-stale ${lane.name}`, subject: lane.name,
      text: `${lane.name}: its clear was skipped at ${clockOf(skip.at)} for "${PAUSE_WHY}", ${minutes(skip.at - end)} min after the pause ended`,
      evidence: `pause ${Number.isFinite(view.pause?.pausedSince) ? `${clockOf(view.pause.pausedSince)} ` : ''}to ${clockOf(end)}; clear skipped at ${clockOf(skip.at)}: ${PAUSE_WHY}; its Workers mod decided on a pause reading from before the resume`,
    })
  }
  return found
}

/** A History line of the person's close from the obsolete check: "- 2026-10-28 16:01 person: withdrawn: obsolete: <why>" (an incident: "closed:"). */
const OBSOLETE_CLOSE = /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)\s+person:\s+(?:withdrawn|closed):\s+obsolete:\s*(.*)$/

/**
 * 28. B775 (the obsolete check showing that it failed): something the person closed from "Find obsolete items" that its chat
 * still needed. An ask withdrawn that way which the chat that asked filed again (an open ask of the same chat with the same
 * title, filed after the close) within a day; an incident closed that way that came back. One finding per closed item, so it is
 * an incident once; the partner's fix is a stricter judging (roles/partner.md, "Find obsolete items"), never a rule that stops
 * the person closing.
 */
function obsoleteWrong(view) {
  const found = []
  const all = [...(view.items?.values() ?? [])]
  for (const item of all) {
    const kind = valueOf(item, 'Kind')
    const state = valueOf(item, 'State')
    const history = (item.sections?.get('History') ?? []).map(line => line.trim())
    const at = history.findLastIndex(line => OBSOLETE_CLOSE.test(line))
    if (at < 0) continue
    const closed = history[at].match(OBSOLETE_CLOSE)
    const closedAt = sinceMs(closed[1])
    if (!Number.isFinite(closedAt) || view.now - closedAt > DAY) continue
    const id = idOf(item)
    if (kind === 'incident') {
      const back = history.slice(at + 1).find(line => /:\s+came back\b/.test(line))
      if (back === undefined) continue
      found.push({
        rule: 'obsolete-wrong', key: `obsolete-wrong ${id}`, subject: id,
        text: `${id} was closed from the obsolete check at ${closed[1].slice(11, 16)} and came back`,
        evidence: `closed as obsolete: ${closed[2].slice(0, 160)}; later: ${back.replace(/^-\s+/, '').slice(0, 120)}`,
      })
      continue
    }
    if (kind !== 'ask' || state !== 'withdrawn') continue
    const owner = valueOf(item, 'Owner')
    const title = String(valueOf(item, 'Title') ?? '').trim().toLowerCase()
    const again = all.find(other => other !== item && valueOf(other, 'Kind') === 'ask' && valueOf(other, 'State') === 'open' && valueOf(other, 'Owner') === owner
      && String(valueOf(other, 'Title') ?? '').trim().toLowerCase() === title && askFiledMs(other) > closedAt)
    if (again === undefined) continue
    found.push({
      rule: 'obsolete-wrong', key: `obsolete-wrong ${id}`, subject: owner ?? id,
      text: `${owner ?? 'A chat'} asked again what the obsolete check closed: ${id} became ${idOf(again)}`,
      evidence: `${id} "${title.slice(0, 80)}" was withdrawn at ${closed[1].slice(11, 16)} as obsolete (${closed[2].slice(0, 120)}); ${idOf(again)} asks it again, still open`,
    })
  }
  return found
}

/**
 * Signals change 6 (Addendum 2): why a rule did not look in this run, or null when it looked. A rule that says nothing while
 * the person pauses (or a limit is full) has not seen that its case went: such a run is `skipped` in the run's record and
 * never counts as "not seen" for an incident's gone clock (gone.mjs). `skips` mirrors the rule's own first guard.
 */
const SKIPS_ON_PAUSE = view => (isPaused(view) ? 'the person pauses' : null)
const SKIPS_ON_PAUSE_OR_LIMIT = view => (isPaused(view) ? 'the person pauses' : isFull(view) ? 'a limit is full' : null)
/** review-held without a ready list in the view cannot see a hold at all. */
const SKIPS_HELD = view => SKIPS_ON_PAUSE_OR_LIMIT(view) ?? (Array.isArray(view.held) ? null : 'no ready list in the view')

/** Every watch rule, in the order the section shows them. */
export const WATCH_RULES = [
  { id: 'stale-suspended', kind: 'watch', says: 'a worker "suspended" after its limit came back', check: staleSuspended, skips: SKIPS_ON_PAUSE },
  { id: 'ready-while-free', kind: 'watch', says: 'a ready task waits while a worker is free', check: readyWhileFree, skips: SKIPS_ON_PAUSE_OR_LIMIT },
  { id: 'working-not-running', kind: 'watch', says: 'a worker whose card says it works while its chat makes no call and writes nothing', check: workingNotRunning, skips: SKIPS_ON_PAUSE_OR_LIMIT },
  { id: 'opus-wait', kind: 'watch', says: 'an Opus step waiting for Opus too long', check: opusWait, skips: SKIPS_ON_PAUSE_OR_LIMIT },
  { id: 'skip-repeats', kind: 'watch', says: 'a compaction skipped for the same reason twice in a row', check: skipRepeats },
  { id: 'repair-repeats', kind: 'watch', says: 'the same repair three times or more in a day', check: repairRepeats },
  { id: 'undelivered', kind: 'watch', says: 'a word to a chat not delivered', check: undelivered, skips: SKIPS_ON_PAUSE },
  { id: 'report-check-twice', kind: 'watch', says: 'a step whose board check failed twice', check: reportCheckTwice },
  { id: 'old-mod', kind: 'watch', says: 'a chat idle on an older Workers mod than the one installed for over 30 min', check: oldMod },
  { id: 'odd-effort', kind: 'watch', says: 'a chat whose effort is not a level', check: oddEffort },
  { id: 'review-stuck', kind: 'watch', says: 'a step in review with no result check for too long', check: reviewStuck, skips: SKIPS_ON_PAUSE },
  { id: 'dropped-fix', kind: 'watch', says: 'a step in review whose fix was dropped, with no new fix, no new check and no block for over 30 min', check: fixDropped, skips: SKIPS_ON_PAUSE },
  { id: 'review-held', kind: 'watch', says: 'a step in review whose chain of fixes ends in a fix the ready list holds, for too long (not while a limit is full, nor behind a block by steps that move)', check: reviewHeld, skips: SKIPS_HELD },
  { id: 'chain-long', kind: 'watch', says: 'a chain of three tries or more whose newest fix names no "Tried before:" (a patch of the same way again)', check: chainLong },
  { id: 'open-fix', kind: 'watch', says: 'a step in review behind a fix the partner has not refined for over 60 min, its last refine word unanswered for 30 (not while the person\'s pick on a rebuild of its goal is open; then 60 min from the pick)', check: openFix, skips: SKIPS_ON_PAUSE },
  { id: 'stale-checkpoint', kind: 'watch', says: 'a step in progress whose worker works on it for hours with no checkpoint', check: staleCheckpoint, skips: SKIPS_ON_PAUSE_OR_LIMIT },
  { id: 'effort-mismatch', kind: 'watch', says: 'a worker that still runs another model or effort than its step wants 10 min after the take', check: effortMismatch, skips: SKIPS_ON_PAUSE_OR_LIMIT },
  { id: 'handover-held', kind: 'watch', says: 'a worker on the hand-over sequence held (its set, restart or line did not run; a 0.30.0 worker: its clear) for over 10 min of running time', check: handoverHeld, skips: SKIPS_ON_PAUSE },
  { id: 'handover-unanswered', kind: 'watch', says: 'a worker on the hand-over sequence that did not answer its hand-over within 10 min (the net fired)', check: handoverUnanswered },
  { id: 'clear-owed-repeat', kind: 'watch', says: 'a worker whose clear did not run at its last three hand-overs in a row (its line went each time; a refusal in the person\'s pause not counted)', check: clearOwedRepeat },
  { id: 'wake-failed', kind: 'watch', says: 'a chat the board could not wake: the app did not start it on a launch, and no message reached it; or (B986) the chat its reports name is not in the app list', check: wakeFailed },
  { id: 'nobody-answers-wakes', kind: 'watch', says: 'nobody answers the board\'s wake-ups: every chat with work could not be woken, and the launch when nobody ran failed', check: nobodyAnswersWakes },
  { id: 'check-unreachable', kind: 'watch', says: 'chats the start-up check could not reach, one incident per cause (the other Claude account, a restart of the app to do, no chat in the app) naming the chats; the per-chat wake rules stand down for them', check: checkUnreachable },
  { id: 'old-limit-reading', kind: 'watch', says: 'a limit near a stop (5-hour 80%, weekly 90%) still last read over 60 min ago, not counting a pause, while a worker works and the supervisor has looked it up', check: oldLimitReading, skips: SKIPS_ON_PAUSE },
  { id: 'board-deaf', kind: 'watch', says: 'the board heard no chat for over 10 min while chats wrote their conversations', check: boardDeaf, skips: SKIPS_ON_PAUSE },
  { id: 'board-slow', kind: 'watch', says: 'two work calls within 2 min answered after the chat gave up on them', check: boardSlow },
  { id: 'week-stop-ignored', kind: 'watch', says: 'the week at the stop line (98%), a worker told to stop still works 20 min after its word reached it', check: weekStopIgnored, skips: SKIPS_ON_PAUSE },
  { id: 'five-hour-stop-ignored', kind: 'watch', says: 'a step given or a worker started while the 5-hour limit is at its stop line (95%) with its reset over 10 min off', check: fiveHourStopIgnored, skips: SKIPS_ON_PAUSE },
  { id: 'pause-stale', kind: 'watch', says: 'a chat\'s clear skipped for the person\'s pause over a minute after the pause ended', check: pauseStale },
  { id: 'obsolete-wrong', kind: 'watch', says: 'something the person closed from "Find obsolete items" that its chat asked again, or an incident closed that way that came back', check: obsoleteWrong },
]
