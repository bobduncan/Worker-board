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

import { SUPERVISOR_DEFAULTS } from '../../config.mjs'
import { askFiledMs, sinceMs, valueOf } from '../../work/item.mjs'
import { overlapIn } from '../../work/guards.mjs'
import { idleWorkers, stuckTakeBacks } from '../../work/handOut.mjs'
import { afterPause as afterPauseOf, checkpointOf, heldMs, holdEndOf, isHolding, pauseEndOf as pauseEnd } from '../../work/pause.mjs'
import { isFailedForGood, stoppedChats, whyClosed } from '../../work/outboxSweep.mjs'
import { FIRST_SAYING, chatsByRole, oldModFinding } from '../../oldMods.mjs'
import { EFFORTS, chatEffort, effortOf, effortSaid, familyOf, modelOf } from '../../work/effort.mjs'
import { chainTries, hasTriedBefore, reviewWaitOf } from '../../work/resultCheck.mjs'
import { madeAtMs, openQaTaskOf, qaStandOf } from '../../work/qaTask.mjs'
import { isWordingOnly } from '../../work/recapWords.mjs'
import { CLEAR_MOD, takenSince } from '../../clearOwed.mjs'
import { readingAgeMinutes } from '../../limits.mjs'
import { BOUNDED_RULES, COUNTS_BY_KEY } from './repair.mjs'
import { BOARD_TRIES } from '../../refineGate.mjs'
import { DEAF_KEEP_MS } from '../../hearing.mjs'

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
function spanOf(view, seenOf, key, since = null, { heard = false } = {}) {
  const first = Math.min(Number.isFinite(since) ? since : Infinity, seenOf(key) ?? view.now)
  const from = Math.max(first, pauseEndOf(view))
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
 * (holder-not-running, working-not-running, not-cleared) leave it out, as they leave out `boardOffMs`.
 */
export function deafMs(view, from) {
  if (!Number.isFinite(from)) return 0
  const spans = (view.deaf ?? []).map(span => (view.deafNow !== null && view.deafNow !== undefined && span.from === view.deafNow.from ? { ...span, to: view.now } : span))
  return spans.reduce((sum, span) => sum + Math.max(0, Math.min(span.to, view.now) - Math.max(span.from, from)), 0)
}

/**
 * X65 (the person: "this should have been 0"): how the board's own wake-up of a chat failed, or null while it is not
 * known to have. Since 2026-10-25 (T9.4) the board wakes a chat that words wait for, at most three tries, and says so when
 * that fails: `wakeFailed` names the chats it asked in vain, `nobodyRuns` those it could ask nobody for. `{ words, evidence }`.
 */
function wakeFailureOf(view, name) {
  const same = chat => plain(chat, view.prefix) === plain(name, view.prefix)
  const failed = (view.wakeFailed ?? []).find(one => same(one.chat))
  if (failed !== undefined) {
    const tries = Number.isFinite(failed.tries) ? failed.tries : 0
    const since = Number.isFinite(failed.since) ? ` since ${clockOf(failed.since)}` : ''
    return { words: `nobody could wake it (${tries} ${tries === 1 ? 'try' : 'tries'}${since})`, evidence: `the board sent the start word ${tries} ${tries === 1 ? 'time' : 'times'}${since} and the chat still does not run` }
  }
  if ((view.nobodyRuns?.chats ?? []).some(same)) {
    return { words: 'no chat runs to ask it to start', evidence: `no wake word could be sent: no chat that could carry it runs${Number.isFinite(view.nobodyRuns.since) ? ` (words wait since ${clockOf(view.nobodyRuns.since)})` : ''}` }
  }
  return null
}

/**
 * 1. A worker unknown or off for longer than `unknownMinutes` that holds a step (taken or in progress) and that the board
 * could not wake (`wakeFailureOf`). X46, X65 and the rest were false alarms: a chat that is off with no step is closed,
 * which is normal, and a chat the board is still waking (it has its tries) is the board's work, not a case. The text
 * names the step and the failed wake-up. A chat with a step that is off for good is also the rule holder-not-running's.
 */
function unknownLane(view, ctx) {
  const found = []
  for (const lane of workersOf(view).filter(one => one.state === 'unknown' || one.state === 'off')) {
    const held = stepsOf(view).filter(item => HOLDS.includes(stateOf(item)) && plain(valueOf(item, 'Owner'), view.prefix) === plain(lane.name, view.prefix)).map(idOf).sort(byId)
    if (held.length === 0) continue
    const failure = wakeFailureOf(view, lane.name)
    if (failure === null) continue
    const key = `unknown-lane ${lane.name}`
    const ms = lasted(view, ctx, key, view.since.get(lane.name))
    if (ms <= view.settings.unknownMinutes * MIN) continue
    found.push({
      rule: 'unknown-lane', key, subject: lane.name,
      text: `${lane.name} ${lane.state} for ${minutes(ms)} min, holds ${held.join(', ')}; ${failure.words}`,
      evidence: `state ${lane.state} since ${clockOf(view.now - ms)}; running: ${lane.isRunning === true ? 'yes' : lane.isRunning === false ? 'no' : 'not known'}; holds: ${held.join(', ')}; ${failure.evidence}`,
    })
  }
  return found
}

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
 * `ready`, the board's own list) waits while a worker whose own report says free stands idle (B834: free as the hand-out's
 * `idleWorkers` counts it, one test for both), both for longer than
 * `idleMinutes`: the board hands a ready task to such a worker at once, so it failed to. Gap 3: only what the board
 * hands out counts: the list's `ready` (a fix, the focus goal's, a pinned one), never its `held` (a task outside the
 * focus goal waits for the person by design); a kept task (its pin, its follow-up) only while its own worker is free.
 * A task whose Touches overlap one given or under way waits by design; a worker the board found stuck (not taking) is
 * that rule's; a QA task waits by design while only the chats in its `notBy` (the builders) are free. One finding per task. Not while the person pauses or a limit is full.
 */
function readyWhileFree(view, ctx) {
  if (isPaused(view) || isFull(view)) return []
  // B834 (X111, X112): the hand-out's own test of free (handOut.mjs `idleWorkers`), so the watch and the hand-out never disagree: the
  // mod's report says idle (or asleep after it said idle), running, the board reads it free, it holds no task given to it, and it is
  // not stuck (not taking, or handed a failed check back). A worker the board reads free but whose mod reports busy is no free worker.
  const stuck = new Set([...workersOf(view).filter(lane => (lane.flags ?? []).some(flag => flag.kind === 'not taking')).map(lane => lane.name), ...(view.handedBack ?? [])])
  const free = idleWorkers(workersOf(view), { items: view.items, prefix: view.prefix, stuck })
  if (free.length === 0) return []
  const found = []
  for (const one of view.ready) {
    const kept = one.keptFor ?? null
    // T9.1.1: a free worker the entry is never given to (a QA task's `notBy`: it built the step or a fix of it) is no free worker for it.
    const may = free.filter(lane => !(one.notBy ?? []).some(name => plain(name, view.prefix) === plain(lane.name, view.prefix)))
    const waiting = kept === null ? may : may.filter(lane => plain(lane.name, view.prefix) === plain(kept, view.prefix))
    if (waiting.length === 0) continue
    const item = view.items.get(one.id)
    if (item === undefined || overlapIn(view.items, item, GIVEN_OR_UNDER_WAY) !== null) continue
    const freeSince = Math.min(...waiting.map(lane => (Number.isFinite(lane.report.since) ? lane.report.since : view.since.get(lane.name) ?? view.now)))
    const key = `ready-while-free ${one.id}`
    const ms = Math.min(lasted(view, ctx, key), view.now - afterPause(view, freeSince))
    if (ms <= view.settings.idleMinutes * MIN) continue
    const names = waiting.map(lane => lane.name)
    found.push({
      rule: 'ready-while-free', key, subject: one.id,
      text: `${one.id} ready for ${minutes(ms)} min while ${names.length === 1 ? `${names[0]} is` : `${names.join(', ')} are`} free`,
      evidence: `ready list: ${view.ready.map(task => task.id).slice(0, 8).join(', ')}; free by their reports: ${waiting.map(lane => `${lane.name} since ${clockOf(lane.report.since)}`).join(', ')}`,
    })
  }
  return found
}

/**
 * Redesign Part 2 (its Done when: "a worker holds a task it does not take"): a worker the board took a given task back
 * from while it sat idle (its lane's `not taking` flag, state.mjs): one finding per take-back, about the worker.
 */
function notTaking(view) {
  const stuck = stuckTakeBacks({ items: view.items, lanes: workersOf(view), prefix: view.prefix })
  const found = []
  // T8.5: a worker on the sequence has no take clock: its hand-over's net is the new rule's (step 4).
  for (const lane of workersOf(view).filter(one => one.onSequence !== true)) {
    const flag = (lane.flags ?? []).find(one => one.kind === 'not taking')
    if (flag === undefined) continue
    const back = stuck.get(lane.name) ?? null
    found.push({
      rule: 'not-taking', key: `not-taking ${lane.name} ${back?.stamp ?? flag.id}`, subject: lane.name,
      text: `${lane.name} did not take ${flag.id}; it went back on the list`,
      evidence: `${flag.text}; taken back at ${back?.stamp ?? 'a time not known'}; its report: ${lane.report?.state ?? 'none'}${Number.isFinite(lane.report?.since) ? ` since ${clockOf(lane.report.since)}` : ''}`,
    })
  }
  return found
}

/** 4. A step in progress whose worker has not run for longer than `notRunningMinutes`. */
function holderNotRunning(view, ctx) {
  const found = []
  // The person pauses, or a limit is full: the chats are meant to stand still.
  if (isPaused(view) || isFull(view)) return found
  for (const item of stepsOf(view).filter(one => HOLDS.includes(stateOf(one)))) {
    const owner = valueOf(item, 'Owner')
    const lane = workersOf(view).find(one => plain(one.name, view.prefix) === plain(owner, view.prefix))
    // A worker paused for the limit stands still on purpose (stale-suspended says when that is wrong).
    if (lane === undefined || lane.state === 'suspended' || !(lane.isRunning === false || lane.state === 'off')) continue
    const id = idOf(item)
    const key = `holder-not-running ${id}`
    const ms = lasted(view, ctx, key, afterPause(view, Number.isFinite(lane.offSince) ? lane.offSince : lane.state === 'off' ? view.since.get(lane.name) : null), { heard: true })
    if (ms <= view.settings.notRunningMinutes * MIN) continue
    found.push({
      rule: 'holder-not-running', key, subject: id,
      text: `${id} is ${stateOf(item)} for ${lane.name}, whose chat has not run for ${minutes(ms)} min`,
      evidence: `${lane.name}: state ${lane.state}, running ${lane.isRunning === false ? 'no' : 'not known'}, since ${clockOf(view.now - ms)}`,
    })
  }
  return found
}

/**
 * B566 (X22, X21: chats shown not running while they ran, the board's only sign their takes): a worker whose card says
 * it works (or that the board shows off for a card left working) while its chat made no call to the board, took
 * nothing and wrote nothing to its conversation (the board's `isRunning` false) for longer than 5 minutes: one
 * incident per worker. A worker on a step in progress is holder-not-running's.
 */
const WORKING_NOT_RUNNING_MS = 5 * MIN
function workingNotRunning(view, ctx) {
  const found = []
  if (isPaused(view) || isFull(view)) return found
  const holding = new Set(stepsOf(view).filter(one => HOLDS.includes(stateOf(one))).map(one => plain(valueOf(one, 'Owner'), view.prefix)))
  for (const lane of workersOf(view)) {
    const isWorkingCard = lane.state === 'working' || (lane.state === 'off' && Number.isFinite(lane.offSince))
    if (!isWorkingCard || lane.isRunning !== false || holding.has(plain(lane.name, view.prefix))) continue
    const key = `working-not-running ${lane.name}`
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
 * 6. A clear or a compaction skipped for the same reason twice in a row (the chat's card keeps only the last one: the
 * supervisor keeps the one before in its watch). A compaction skipped by design (a small chat) is no case.
 */
function skipRepeats(view, ctx) {
  const found = []
  for (const lane of view.lanes.filter(one => !one.isLeftover)) {
    const compaction = lane.compaction ?? null
    const skips = [
      ...(compaction?.kind === 'skipped' && !BY_DESIGN.includes(compaction.why) ? [{ kind: 'compact', at: compaction.at, why: compaction.why }] : []),
      // T8.5: a worker on the sequence clears only by its envelope: a skipped clear of its is the held state's, not this.
      ...(compaction?.notCleared && lane.onSequence !== true ? [{ kind: 'clear', at: compaction.notCleared.at, why: compaction.notCleared.why }] : []),
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
      const what = skip.kind === 'clear' ? 'clear' : 'compaction'
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
  const late = undeliveredWords(view)
  const stopped = stoppedOfView(view)
  const byChat = new Map()
  for (const message of late) byChat.set(message.to, [...(byChat.get(message.to) ?? []), message])
  return [...byChat].sort(([a], [b]) => byId(a, b)).map(([chat, words]) => {
    const oldest = words.reduce((a, b) => (b.at < a.at ? b : a))
    const stop = stopped.get(chat) ?? null
    if (stop !== null) {
      const woken = view.outbox.findLast(one => one.command === 'wake' && one.about === chat && one.stoppedAt === stop.since)
      return {
        rule: 'undelivered', key: `undelivered ${chat} stopped ${stop.since}`, subject: chat, since: oldest.at,
        text: `${chat} was stopped at ${clockOf(stop.since)}: ${words.length} ${words.length === 1 ? 'word waits' : 'words wait'} for it, the oldest for ${minutes(view.now - oldest.at)} min`,
        evidence: woken === undefined ? 'the main chat is not asked to wake it yet' : `the main chat was asked to wake it at ${clockOf(woken.at)} (${woken.state})`,
      }
    }
    return {
      rule: 'undelivered', key: `undelivered ${chat}`, subject: chat, since: oldest.at,
      text: `${words.length} ${words.length === 1 ? 'word' : 'words'} to ${chat} not delivered, the oldest for ${minutes(view.now - oldest.at)} min`,
      // B813: a failed word with its last why.
      evidence: words.map(one => `${clockOf(one.at)} ${one.command ?? 'answer'}${one.about ? ` ${one.about}` : ''} (${one.state}${one.state === 'failed' && typeof one.why === 'string' && one.why.trim() !== '' ? `: ${shortWhy(one.why)}` : ''})`).join('; '),
    }
  })
}

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
  const runs = new Map(view.lanes.filter(chat => !chat.isLeftover).map(chat => [chat.name, chat.isRunning === true]))
  // T9.4: the chats known not to run (outboxSweep.mjs): a start word one of them holds is closed, so it matters to no rule.
  const off = new Set([...view.lanes.filter(chat => !chat.isLeftover), view.partner, view.helper, view.supervisor].filter(chat => chat?.isRunning === false).map(chat => chat.name))
  const ctx = { all: view.outbox, items: view.items, runs, goals: view.goals ?? [], now: view.now, keep: view.keep, closing: new Map(), stopped: stoppedOfView(view), prefix: view.prefix ?? '', main: view.lanes.find(chat => chat.isMain === true)?.name ?? null, off, handedBack: view.handedBack ?? [], lanes: view.lanes }
  return message => whyClosed(message, ctx)?.state !== 'dropped'
}

/**
 * B571: the words rule 8 names, which the health summary marks "!" (and only those): waiting longer than
 * `undeliveredMinutes`, or expired or failed for good in the last two hours (UNDELIVERED_LOOK_MS), and still mattering.
 * None while the person pauses.
 */
export function undeliveredWords(view) {
  // The person pauses: the bridge holds every word until Resume all.
  if (isPaused(view)) return []
  const limit = view.settings.undeliveredMinutes * MIN
  // A word that waited too long still counts (the sweep marks it expired, and so does this rule); one that no longer
  // matters (dropped: superseded, its step moved on, its goal evaluated since) does not, waiting or failed (B571).
  // B548: an answer waits for its chat however old (store.mjs isLate); past answerMs it is not named here.
  const matters = wordMatters(view)
  const stillWaits = message => matters(message)
    && !((message.ask ?? null) !== null && view.now - message.at - heldMs(message, view.now, view.pause) > view.keep.answerMs)
  // X43: not the supervisor's own sweep word: it goes stale in ten minutes by design (the next sweep replaces it), so one that
  // expired while the supervisor's chat was off is no lost word (the health summary leaves it out too).
  return view.outbox.filter(message => typeof message?.to === 'string' && Number.isFinite(message.at) && message.command !== 'sweep').filter(message => {
    // The time the person's pause held it does not count (as for the outbox's own expiry, store.mjs isLate), nor a
    // hold before its release (B285).
    const held = message.at + heldMs(message, view.now, view.pause)
    const since = afterPause(view, Number.isFinite(message.releasedAt) ? Math.max(held, message.releasedAt) : held)
    if (message.state === 'waiting') return view.now - since > limit && stillWaits(message)
    return (message.state === 'expired' || isFailedForGood(message)) && view.now - message.at < UNDELIVERED_LOOK_MS && view.now - since > limit && stillWaits(message)
  })
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
 * is ready or given and not taken (go-live gives them one by one; the rules ready-while-free and not-taking watch them). A
 * task taken and not begun, or none, is a case. A dropped fix is
 * the rule `dropped-fix` (B630; its id apart from the repair `fix-dropped`, the supervisor keys rules by id). Counted from the end of the person's last pause.
 */
function reviewStuck(view, ctx) {
  const found = []
  if (isPaused(view)) return found
  for (const item of stepsOf(view).filter(one => stateOf(one) === 'review').sort((a, b) => byId(idOf(a), idOf(b)))) {
    const wait = reviewWaitOf(item, view.items, null, view.now)
    if (wait?.kind !== 'check' && wait?.kind !== 'report') continue
    const id = idOf(item)
    // B740 (X92): a report whose check failed and was not reported again, an hour on: the worker's word, not the partner's.
    if (wait.kind === 'report') {
      const { late, key, ms, words } = reviewLateOf(view, item, wait, watchOf(ctx))
      if (!late) continue
      found.push({
        rule: 'review-stuck', key, subject: id,
        text: `${id} in review ${minutes(ms)} min: ${wait.text}`,
        evidence: `since ${clockOf(view.now - ms)}; ${words.length === 0 ? `no word to ${valueOf(item, 'Owner') ?? 'its worker'}` : `${words.length} ${words.length === 1 ? 'word' : 'words'} to ${words[0].to ?? valueOf(item, 'Owner')}, the last at ${clockOf(words.at(-1).at)} (${words.at(-1).state ?? 'not known'})`}`,
      })
      continue
    }
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
    const wait = reviewWaitOf(item, view.items, null, view.now)
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

/**
 * 12c. B656 (X8 again: B603 sat in review behind its fix B614, which the ready list held for the answer to an ask, while
 * its line said only "waits for its fix B614"): a step in review whose chain of open fixes ends in a fix the ready list
 * holds (handOut.mjs `readyList`'s held why: outside the focus goal, a blocker, an ask, a standard) for over
 * `reviewMinutes` is one case per chain, named by its first step, with the fix and why. A chain whose last fix is at work
 * (queued, in progress, in review) is no case, however deep. B660 (X59: B603 behind B614, held for the person's answer to
 * Q408): a hold that is the person's open ask ("waits for the answer to Q<n>") is no case, as in B543; the time counts from
 * when the board first saw this hold (its key holds the why, so a changed why starts again), not from the fix's Since, and
 * from the end of the person's last pause. No ready list in the view: nothing.
 */
function reviewHeld(view, ctx) {
  const found = []
  if (isPaused(view) || !Array.isArray(view.held)) return found
  const seen = new Set()
  // By id: a chain's first step comes before its fixes, so it names the case.
  for (const item of stepsOf(view).filter(one => stateOf(one) === 'review').sort((a, b) => byId(idOf(a), idOf(b)))) {
    const wait = reviewWaitOf(item, view.items, view.held, view.now)
    if (wait?.kind !== 'fix' || wait.held === null || seen.has(wait.end)) continue
    seen.add(wait.end)
    const id = idOf(item)
    // B660: the person's open ask is already with them (B543): no case, and nothing watched meanwhile. B664: judged by
    // reviewLateOf, as the health summary judges it.
    const { late, key, ms } = reviewLateOf(view, item, wait, watchOf(ctx))
    if (!late) continue
    found.push({
      rule: 'review-held', key, subject: id,
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
 * late: the person's answer, a hold that is their open ask, a check whose QA task a worker is at work on or that is ready or
 * given and not taken yet (the hand-out's to move, and the rules ready-while-free and not-taking watch it), anything while
 * the person pauses. Any other hold counts from when the watch first saw it, a check from when its QA task was made (T9.1.1;
 * from when it was asked, with none), a dropped fix from the drop, each from the end of the last pause at the earliest.
 * `{ late, key, ms, words }` (`words` the refine words, for an open fix), or null for a wait the rules judge another way
 * (an open fix at work, a block).
 */
export function reviewLateOf(view, item, wait, seenOf = () => undefined) {
  const id = idOf(item)
  const not = { late: false, key: null, ms: 0, words: [] }
  if (wait === null || wait === undefined) return null
  if (wait.kind === 'answer') return not
  if (wait.kind === 'check') {
    if (isPaused(view)) return not
    const key = `review-stuck ${id} check`
    // T9.1.1: the check is a task of the store: counted from when it was made, and a worker at work on it (in progress) is no case.
    const qa = openQaTaskOf(view.items, id)
    // The task knows when it was made, so the first time the watch saw the wait (the days before it existed) counts for nothing.
    const ms = qa === null ? spanOf(view, seenOf, key, afterPause(view, wait.since)) : spanOf(view, () => undefined, key, afterPause(view, madeAtMs(qa)))
    if (qa !== null && valueOf(qa, 'State') === 'in progress') return { ...not, key, ms }
    // At go-live every waiting step gets its task at once and the hand-out gives them one by one: a task that is ready or given
    // (not taken) is the hand-out's to move, and a task nobody takes is the rules `ready-while-free` and `not-taking`'s.
    if (qa !== null && ['refined', 'queued'].includes(valueOf(qa, 'State'))) return { ...not, key, ms }
    return { ...not, late: ms > view.settings.reviewMinutes * MIN, key, ms }
  }
  if (wait.kind === 'report') {
    // B740 (X92): the board's check of the report failed and the worker has not reported again. Counted in running time
    // from the failed check; late past `reviewMinutes`, the word to the worker (reconcile.mjs) having had its chance.
    if (isPaused(view)) return not
    const key = `review-stuck ${id} report`
    const ms = spanOf(view, seenOf, key, afterPause(view, wait.since))
    return { ...not, late: ms > view.settings.reviewMinutes * MIN, key, ms, words: reportWordsOf(view, id, wait.since) }
  }
  if (wait.kind === 'dropped') {
    if (isPaused(view)) return not
    const key = `fix-dropped ${id}`
    const ms = spanOf(view, seenOf, key, afterPause(view, wait.since))
    return { ...not, late: ms > FIX_DROPPED_MS, key, ms }
  }
  if (wait.kind === 'fix' && (wait.unrefined ?? null) !== null) {
    if (isPaused(view)) return not
    // B667 (B664's check: an open fix the partner never refines had no follow-up): counted from when the fix was made; late
    // past `openFixMinutes` once the newest refine word about it is older than `checkWordMinutes` (the board's retry,
    // refineGate.mjs FIX_RETRY_MS, had its chance), as review-stuck reads the check words.
    const key = `open-fix ${wait.end}`
    const from = afterPause(view, wait.unrefined.since)
    const ms = view.now - from - boardOffMs(view, from)
    const words = refineWordsOf(view, wait.end, wait.unrefined.since)
    const last = words.at(-1) ?? null
    const late = ms > view.settings.openFixMinutes * MIN && (last === null || view.now - last.at > view.settings.checkWordMinutes * MIN)
    return { late, key, ms, words }
  }
  if (wait.kind === 'fix' && wait.held !== null) {
    if (isPaused(view) || PERSON_ASK_HOLD.test(wait.held)) return not
    // Counted per why, from when the board first saw this hold (the fix's Since is its move to refined, long before a
    // blocker or an ask may have cleared: B614 refined at 16:39, blocked by B623 until 19:56).
    const key = `review-held ${wait.end} ${wait.held.slice(0, 80)}`
    const ms = spanOf(view, seenOf, key)
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
    const wait = reviewWaitOf(item, view.items, view.held, view.now)
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

/** B740: the words typed to a step's worker about its failed report check from `since` on (the board's, the check line's or the later one), oldest first. */
export function reportWordsOf(view, id, since) {
  return (view.outbox ?? []).filter(message => message?.about === id && message.command === 'work' && message.kind === 'check' && Number.isFinite(message.at) && message.at >= since)
    .sort((a, b) => a.at - b.at)
}

/** A span in words: "45 min", "2 h 10 min". */
const lasting = ms => (ms < HOUR ? `${minutes(ms)} min` : `${Math.floor(ms / HOUR)} h${minutes(ms % HOUR) > 0 ? ` ${minutes(ms % HOUR)} min` : ''}`)
/** A checkpoint's next action that is the report itself ("report B522", "work report B7 ..."). */
const REPORT_NEXT = /^\s*(?:work\s+)?report\b/i

/**
 * B572 (the fix of X24: B522 sat in progress 2 h 36 min, its last checkpoint "report B522" of 19:07 never followed by a
 * report): whether a step in progress has a stale checkpoint, as the rule stale-checkpoint and the health summary read it.
 * 'report': its last checkpoint's next action is to report, written over `reportMinutes` ago; 'old': in progress over
 * `checkpointMinutes` with no checkpoint within them (`checkpoint` null: none at all). Times count from the end of the
 * person's last pause at the earliest, less the time its worker stood suspended for the limit (the review: it cannot
 * write a checkpoint meanwhile). A checkpoint from before the step's current stretch in progress (it waited on you
 * since) counts as none: the stretch counts from its start. Null when it is not late, not in progress, the person
 * pauses, a limit is full, or its worker is paused for the limit now (it stands still on purpose). `{ kind, step,
 * checkpoint, quiet }`: `step` how long it has been in progress, `quiet` how long since its last checkpoint (or since
 * the stretch began, without one).
 */
export function checkpointLate(item, view) {
  if (stateOf(item) !== 'in progress' || isPaused(view) || isFull(view)) return null
  const owner = workersOf(view).find(lane => plain(lane.name, view.prefix) === plain(valueOf(item, 'Owner'), view.prefix))
  if (owner?.state === 'suspended') return null
  const began = sinceMs(valueOf(item, 'Since'))
  if (!Number.isFinite(began)) return null
  const checkpoint = checkpointOf(item)
  const written = Number.isFinite(checkpoint?.at) && checkpoint.at >= began ? checkpoint.at : null
  const counted = from => view.now - afterPause(view, from) - boardOffMs(view, afterPause(view, from)) - (owner === undefined ? 0 : standingStillMs(view, owner.name, afterPause(view, from)))
  const quiet = counted(written ?? began)
  const late = { step: view.now - began, checkpoint, quiet }
  if (written !== null && REPORT_NEXT.test(checkpoint.next) && quiet > view.settings.reportMinutes * MIN) return { kind: 'report', ...late }
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
 * 13. B572: a step in progress with a stale checkpoint (checkpointLate): one finding for the main chat per step and
 * checkpoint, so a lasting one counts up as one incident and a newer stale checkpoint is a case of its own.
 */
function staleCheckpoint(view) {
  const found = []
  for (const item of stepsOf(view).sort((a, b) => byId(idOf(a), idOf(b)))) {
    const late = checkpointLate(item, view)
    if (late === null) continue
    const id = idOf(item)
    const { checkpoint } = late
    const who = `${id} in progress for ${lasting(late.step)} (${valueOf(item, 'Owner') ?? 'nobody'})`
    const text = late.kind === 'report' ? `${who}; its last checkpoint, "${checkpoint.next}" at ${clockOf(checkpoint.at)}, was never followed by a report`
      : checkpoint === null ? `${who} with no checkpoint` : `${who} with no checkpoint for ${lasting(late.quiet)}`
    found.push({
      rule: 'stale-checkpoint', key: `stale-checkpoint ${id} ${checkpoint?.line ?? 'none'}`, subject: id, text,
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
 * switch read back (switchOf): one finding for the main chat per chat and step, which counts up while it lasts.
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
      rule: 'effort-mismatch', key: `effort-mismatch ${lane.name} ${id}`, subject: lane.name,
      text: `${lane.name} runs ${at.runs} ${minutes(at.since)} min after it took ${id}, which wants ${at.wants}`,
      evidence: `took ${id} at ${clockOf(at.takenAt)}; ${at.state === 'asked' ? `switch asked ${clockOf(at.askedAt)} (${at.askState ?? 'not known'}), not read back` : 'no switch asked'}; the app's file says ${at.runs}`,
    })
  }
  return found
}

/**
 * 15. B547 (the rules X13 and X14 wanted): a worker whose last report is newer than its last clear (state.mjs `clearOwed`,
 * src/clearOwed.mjs) and that took a new step since, on the old conversation; or that stays so for longer than
 * `notClearedMinutes` (a log refused while its background work runs, a mod that left no word). One finding per worker
 * per report, with the Workers mod's why when it logged one, and the repair: the board holds its next step and names the
 * clear to its mod once it is idle; an older mod cannot run it, and the chat needs the restart that brings the new one.
 */
function notCleared(view, ctx) {
  const found = []
  if (isPaused(view)) return found
  // T8.5: a worker on the sequence is cleared by its envelope; a clear that did not run holds it (the rule handover-held, step 4).
  for (const lane of workersOf(view).filter(one => one.onSequence !== true)) {
    const owed = lane.clearOwed ?? null
    if (owed === null || !Number.isFinite(owed.reportedAt)) continue
    const key = `not-cleared ${lane.name} ${owed.step}`
    const ms = lasted(view, ctx, key, afterPause(view, owed.reportedAt), { heard: true })
    const took = takenSince(view.items, lane.name, owed.reportedAt, view.prefix, owed.step)[0] ?? null
    if (took === null && ms <= view.settings.notClearedMinutes * MIN) continue
    const why = owed.why ?? 'no reason logged'
    const repair = owed.canClear === true
      ? 'the board holds its next step and names the clear to its Workers mod once the chat is idle'
      : `its Workers mod is older than ${CLEAR_MOD} and cannot run a clear the board names: its chat needs a restart (Pause all, restart the app, Resume all)`
    found.push({
      rule: 'not-cleared', key, subject: lane.name, since: took === null ? owed.reportedAt : took.at,
      text: took === null
        ? `${lane.name} not cleared ${minutes(ms)} min after it reported ${owed.step}: ${why}`
        : `${lane.name} took ${took.id} on the conversation of ${owed.step}: not cleared after that report (${why})`,
      evidence: `last report ${owed.step} at ${clockOf(owed.reportedAt)}; last clear ${Number.isFinite(owed.clearedAt) ? `at ${clockOf(owed.clearedAt)}` : 'none known'}${took === null ? '' : `; took ${took.id} at ${clockOf(took.at)}`}; repair: ${repair}`,
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
  const works = workersOf(view).some(lane => lane.state === 'working')
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

/**
 * 19. B736 (X89, the rule the sweep wanted: work health timed out twice in a row): two work calls within 2 minutes that the
 * board answered after the chat's Workers mod had given up on them (view.mjs `lateCalls`, from each call's request id):
 * one finding, naming the longest wait.
 */
function boardSlow(view) {
  const recent = (view.lateCalls ?? []).filter(one => view.now - one.at <= SLOW_LOOK_MS).sort((a, b) => a.at - b.at)
  if (!recent.some((one, index) => index > 0 && one.at - recent[index - 1].at <= SLOW_PAIR_MS)) return []
  const worst = Math.max(...recent.map(one => one.ms))
  return [{
    rule: 'board-slow', key: 'board-slow board', subject: 'board',
    text: `the board did not answer for ${Math.round(worst / 1000)} s: ${recent.length} work calls in ${minutes(SLOW_LOOK_MS)} min answered after the chat gave up`,
    evidence: recent.slice(-6).map(one => `answered ${clockOf(one.at)} after ${Math.round(one.ms / 1000)} s`).join('; '),
  }]
}

/** B742: how long a worker may keep working after the board's word at the week's stop line before the rule opens. */
const WEEK_STOP_WAIT_MS = 15 * MIN

/**
 * 20. B742 (X95, X96, the rule the sweep wanted: at 98% of the week Workers 2, 3 and 5 worked on from 22:20 to 22:32 with no
 * lane suspended): the week stands at the person's stop line (view.limits.week: `level` full, `used` from `stopAt`), the board
 * told a working worker to stop (the word `week-stop` in the outbox), it still works 15 min of running time after that word
 * (the pause and the board's off time do not count), and no lane is suspended for the limit. One finding, naming the workers.
 * It clears when a lane is suspended, the week falls back under the line, or nobody works.
 */
function weekStopIgnored(view, ctx) {
  const week = view.limits?.week ?? null
  if (isPaused(view) || week === null || week.level !== 'full' || !Number.isFinite(week.used) || !Number.isFinite(week.stopAt) || week.used < week.stopAt) return []
  if (view.lanes.some(lane => lane.state === 'suspended')) return []
  const late = []
  for (const lane of workersOf(view).filter(one => one.state === 'working')) {
    const word = (view.outbox ?? []).filter(sent => sent.command === 'week-stop' && sent.to === lane.name && Number.isFinite(sent.at)).reduce((a, b) => (a === null || b.at > a.at ? b : a), null)
    if (word === null) continue
    const ms = lasted(view, ctx, `week-stop-ignored ${lane.name}`, afterPause(view, word.at))
    if (ms > WEEK_STOP_WAIT_MS) late.push({ name: lane.name, since: word.at, ms })
  }
  if (late.length === 0) return []
  return [{
    rule: 'week-stop-ignored', key: 'week-stop-ignored board', subject: 'board',
    text: `the week is at ${Math.round(week.used)}%, its stop line is ${week.stopAt}%, and ${late.map(one => one.name).join(', ')} still work${late.length === 1 ? 's' : ''} with no lane suspended`,
    evidence: `week ${Math.round(week.used)}% (stop line ${week.stopAt}%); the board's word to stop: ${late.map(one => `${one.name} at ${clockOf(one.since)}, ${minutes(one.ms)} min ago`).join('; ')}; no lane is suspended; threshold ${minutes(WEEK_STOP_WAIT_MS)} min`,
  }]
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

/** Every watch rule, in the order the section shows them. */
export const WATCH_RULES = [
  { id: 'unknown-lane', kind: 'watch', says: 'a worker unknown or off for too long that holds a step and that the board could not wake', check: unknownLane },
  { id: 'stale-suspended', kind: 'watch', says: 'a worker "suspended" after its limit came back', check: staleSuspended },
  { id: 'ready-while-free', kind: 'watch', says: 'a ready task waits while a worker is free', check: readyWhileFree },
  { id: 'holder-not-running', kind: 'watch', says: 'a step in progress whose worker does not run', check: holderNotRunning },
  { id: 'working-not-running', kind: 'watch', says: 'a worker whose card says it works while its chat makes no call and writes nothing', check: workingNotRunning },
  { id: 'opus-wait', kind: 'watch', says: 'an Opus step waiting for Opus too long', check: opusWait },
  { id: 'skip-repeats', kind: 'watch', says: 'a clear or a compaction skipped for the same reason twice in a row', check: skipRepeats },
  { id: 'repair-repeats', kind: 'watch', says: 'the same repair three times or more in a day', check: repairRepeats },
  { id: 'undelivered', kind: 'watch', says: 'a word to a chat not delivered', check: undelivered },
  { id: 'report-check-twice', kind: 'watch', says: 'a step whose board check failed twice', check: reportCheckTwice },
  { id: 'old-mod', kind: 'watch', says: 'a chat idle on an older Workers mod than the one installed for over 30 min', check: oldMod },
  { id: 'odd-effort', kind: 'watch', says: 'a chat whose effort is not a level', check: oddEffort },
  { id: 'review-stuck', kind: 'watch', says: 'a step in review with no result check for too long', check: reviewStuck },
  { id: 'dropped-fix', kind: 'watch', says: 'a step in review whose fix was dropped, with no new fix, no new check and no block for over 30 min', check: fixDropped },
  { id: 'review-held', kind: 'watch', says: 'a step in review whose chain of fixes ends in a fix the ready list holds, for too long', check: reviewHeld },
  { id: 'chain-long', kind: 'watch', says: 'a chain of three tries or more whose newest fix names no "Tried before:" (a patch of the same way again)', check: chainLong },
  { id: 'open-fix', kind: 'watch', says: 'a step in review behind a fix the partner has not refined for over 60 min, its last refine word unanswered for 30', check: openFix },
  { id: 'stale-checkpoint', kind: 'watch', says: 'a step in progress with no checkpoint for hours, or whose checkpoint said to report long ago', check: staleCheckpoint },
  { id: 'effort-mismatch', kind: 'watch', says: 'a worker that still runs another model or effort than its step wants 10 min after the take', check: effortMismatch },
  { id: 'not-cleared', kind: 'watch', says: 'a worker not cleared after its reported step', check: notCleared },
  { id: 'not-taking', kind: 'watch', says: 'a worker that did not take the task it was given', check: notTaking },
  { id: 'old-limit-reading', kind: 'watch', says: 'a limit near a stop (5-hour 80%, weekly 90%) still last read over 60 min ago, not counting a pause, while a worker works and the supervisor has looked it up', check: oldLimitReading },
  { id: 'board-deaf', kind: 'watch', says: 'the board heard no chat for over 10 min while chats wrote their conversations', check: boardDeaf },
  { id: 'board-slow', kind: 'watch', says: 'two work calls within 2 min answered after the chat gave up on them', check: boardSlow },
  { id: 'week-stop-ignored', kind: 'watch', says: 'the week at the stop line (98%), a worker told to stop still works 15 min later and no lane is suspended', check: weekStopIgnored },
  { id: 'five-hour-stop-ignored', kind: 'watch', says: 'a step given or a worker started while the 5-hour limit is at its stop line (95%) with its reset over 10 min off', check: fiveHourStopIgnored },
  { id: 'pause-stale', kind: 'watch', says: 'a chat\'s clear skipped for the person\'s pause over a minute after the pause ended', check: pauseStale },
  { id: 'obsolete-wrong', kind: 'watch', says: 'something the person closed from "Find obsolete items" that its chat asked again, or an incident closed that way that came back', check: obsoleteWrong },
]
