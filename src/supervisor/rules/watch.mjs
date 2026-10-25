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

import { sinceMs, valueOf } from '../../work/item.mjs'
import { overlapIn } from '../../work/guards.mjs'
import { stuckTakeBacks } from '../../work/handOut.mjs'
import { checkpointOf, heldMs, isHolding } from '../../work/pause.mjs'
import { isFailedForGood, stoppedChats, whyClosed } from '../../work/outboxSweep.mjs'
import { FIRST_SAYING, chatsByRole, oldModFinding } from '../../oldMods.mjs'
import { EFFORTS, chatEffort, effortOf, effortSaid, familyOf, modelOf } from '../../work/effort.mjs'
import { chainTries, hasTriedBefore, reviewWaitOf } from '../../work/resultCheck.mjs'
import { CLEAR_MOD, takenSince } from '../../clearOwed.mjs'
import { readingAgeMinutes } from '../../limits.mjs'
import { COUNTS_BY_KEY } from './repair.mjs'

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
const pauseEndOf = view => (view.pause?.state === 'running' && Number.isFinite(view.pause?.since) ? view.pause.since : -Infinity)
/** A time something began, counted from the end of the last pause at the earliest: the pause's time does not count. */
const afterPause = (view, since) => (Number.isFinite(since) ? Math.max(since, pauseEndOf(view)) : since)

/**
 * How long a thing has lasted: since `since` (what the board's data says), or since the supervisor first saw it (`key`
 * in its watch), whichever is earlier. The key is watched from now on, so a lasting thing is timed across runs. The
 * review: never from before the end of the person's last pause (the chats stood still at the person's word then).
 */
function lasted(view, ctx, key, since = null) {
  return spanOf(view, watchOf(ctx), key, since)
}

/** B664: since when the rules' watch first saw a key, with every key asked kept watched (the rules' `ctx`). */
const watchOf = ctx => key => {
  if (!ctx.observed.includes(key)) ctx.observed.push(key)
  return ctx.seen.get(key)
}

/** `lasted`'s span, with `seenOf(key)` the time the key was first seen (undefined: now). */
function spanOf(view, seenOf, key, since = null) {
  const first = Math.min(Number.isFinite(since) ? since : Infinity, seenOf(key) ?? view.now)
  return view.now - Math.max(first, pauseEndOf(view))
}

/** 1. A worker "unknown" for longer than `unknownMinutes`. */
function unknownLane(view, ctx) {
  const found = []
  for (const lane of workersOf(view).filter(one => one.state === 'unknown')) {
    const key = `unknown-lane ${lane.name}`
    const ms = lasted(view, ctx, key, view.since.get(lane.name))
    if (ms <= view.settings.unknownMinutes * MIN) continue
    // What waits on it: its queue as the board shows it, and the steps the store holds or queues for it.
    const owned = stepsOf(view).filter(item => [...HOLDS, 'queued'].includes(stateOf(item)) && plain(valueOf(item, 'Owner'), view.prefix) === plain(lane.name, view.prefix))
    const waits = [...new Set([...(lane.queue ?? []).map(one => one?.id), ...owned.map(idOf)].filter(id => typeof id === 'string'))].sort(byId)
    const first = waits[0]
    found.push({
      rule: 'unknown-lane', key, subject: lane.name,
      text: `${lane.name} unknown for ${minutes(ms)} min${first === undefined ? '' : `, ${first} waits`}`,
      evidence: `state unknown since ${clockOf(view.now - ms)}; running: ${lane.isRunning === true ? 'yes' : lane.isRunning === false ? 'no' : 'not known'}; its steps: ${waits.length === 0 ? 'none' : waits.join(', ')}`,
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
 * `ready`, the board's own list) waits while a worker whose own report says free stands idle, both for longer than
 * `idleMinutes`: the board hands a ready task to such a worker at once, so it failed to. Gap 3: only what the board
 * hands out counts: the list's `ready` (a fix, the focus goal's, a pinned one), never its `held` (a task outside the
 * focus goal waits for the person by design); a kept task (its pin, its follow-up) only while its own worker is free.
 * A task whose Touches overlap one given or under way waits by design; a worker the board found stuck (not taking) is
 * that rule's. One finding per task. Not while the person pauses or a limit is full.
 */
function readyWhileFree(view, ctx) {
  if (isPaused(view) || isFull(view)) return []
  // The review of 2026-10-25: a worker that holds a task given to it (its line may wait) is no free worker.
  const holds = lane => stepsOf(view).some(item => ['queued', 'taken', 'in progress'].includes(stateOf(item)) && plain(valueOf(item, 'Owner'), view.prefix) === plain(lane.name, view.prefix))
  const free = workersOf(view).filter(lane => lane.report != null && lane.state === 'free' && lane.isRunning === true
    && !(lane.flags ?? []).some(flag => flag.kind === 'not taking') && !holds(lane))
  if (free.length === 0) return []
  const found = []
  for (const one of view.ready) {
    const kept = one.keptFor ?? null
    const waiting = kept === null ? free : free.filter(lane => plain(lane.name, view.prefix) === plain(kept, view.prefix))
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
  for (const lane of workersOf(view)) {
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
    const ms = lasted(view, ctx, key, afterPause(view, Number.isFinite(lane.offSince) ? lane.offSince : lane.state === 'off' ? view.since.get(lane.name) : null))
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
    const ms = lasted(view, ctx, key, afterPause(view, Number.isFinite(lane.offSince) ? lane.offSince : null))
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
      ...(compaction?.notCleared ? [{ kind: 'clear', at: compaction.notCleared.at, why: compaction.notCleared.why }] : []),
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

/**
 * B551 (X11): when the incident a finding's key files was last fixed: the latest time one of the steps named as its fix
 * (its Fix, and every "fix B<n>" of its History) went done, at the end of that minute; -Infinity for none. A repair
 * before it is one that fix was made for: it never counts again.
 */
function fixedAtOf(view, key) {
  const incident = [...view.items.values()].find(item => valueOf(item, 'Kind') === 'incident' && valueOf(item, 'Key') === key)
  if (incident === undefined) return -Infinity
  const named = (incident.sections?.get('History') ?? []).map(line => FIX_LINE.exec(line)?.[1]).filter(Boolean)
  let at = -Infinity
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
 * (`COUNTS_BY_KEY`) counts so, review-wait too.
 */
function repairRepeats(view) {
  const counts = new Map()
  for (const one of view.repairs.filter(repair => view.now - repair.at < DAY && repair.cause !== 'restart')) {
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
      evidence: words.map(one => `${clockOf(one.at)} ${one.command ?? 'answer'}${one.about ? ` ${one.about}` : ''} (${one.state})`).join('; '),
    }
  })
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
  const ctx = { all: view.outbox, items: view.items, runs, goals: view.goals ?? [], now: view.now, keep: view.keep, closing: new Map(), stopped: stoppedOfView(view), prefix: view.prefix ?? '', main: view.lanes.find(chat => chat.isMain === true)?.name ?? null, off }
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
  return view.outbox.filter(message => typeof message?.to === 'string' && Number.isFinite(message.at)).filter(message => {
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
 * report then, and a pass in that time ends the case.
 */
function reportCheckTwice(view) {
  const found = []
  for (const item of stepsOf(view).filter(one => !['done', 'dropped'].includes(stateOf(one)))) {
    const checks = (item.sections?.get('History') ?? []).filter(line => /\bserver: check (?:passed|failed)\b/.test(line))
    const lastPass = checks.findLastIndex(line => /\bserver: check passed\b/.test(line))
    const failed = checks.slice(lastPass + 1)
    if (failed.length < 2) continue
    const since = sinceMs(failed[1].match(STAMP)?.[1])
    if (!(view.now - since > view.settings.reportCheckMinutes * MIN)) continue
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
 * its fix was done or its ask point answered; the repair `unchecked` types the check word meanwhile), and its newest check word unanswered for over `checkWordMinutes` (B662). A dropped fix is
 * the rule `dropped-fix` (B630; its id apart from the repair `fix-dropped`, the supervisor keys rules by id). Counted from the end of the person's last pause.
 */
function reviewStuck(view, ctx) {
  const found = []
  if (isPaused(view)) return found
  const partner = view.partner?.name ?? 'the partner'
  for (const item of stepsOf(view).filter(one => stateOf(one) === 'review').sort((a, b) => byId(idOf(a), idOf(b)))) {
    const wait = reviewWaitOf(item, view.items)
    if (wait?.kind !== 'check') continue
    const id = idOf(item)
    // B662 (X60): a check word typed again restarts the wait; one still waiting, or younger than `checkWordMinutes`, is
    // no case yet. B664: judged by reviewLateOf, as the health summary judges it.
    const { late, key, ms, words } = reviewLateOf(view, item, wait, watchOf(ctx))
    if (!late) continue
    const last = words.at(-1) ?? null
    found.push({
      rule: 'review-stuck', key, subject: id,
      text: `${id} in review ${minutes(ms)} min with no result check filed (${wait.text})`,
      evidence: `since ${clockOf(view.now - ms)}; ${words.length === 0 ? `no check word to ${partner}` : `${words.length} check ${words.length === 1 ? 'word' : 'words'} to ${words[0].to ?? partner}, the last at ${clockOf(last.at)} (${last.state ?? 'not known'})`}`,
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
    const wait = reviewWaitOf(item, view.items)
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
    const wait = reviewWaitOf(item, view.items, view.held)
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
 * late: the person's answer, a hold that is their open ask, a check word younger than `checkWordMinutes`, anything while
 * the person pauses. Any other hold counts from when the watch first saw it, a check from when it was asked, a dropped fix
 * from the drop, each from the end of the last pause at the earliest. `{ late, key, ms, words }` (`words` the check words,
 * for a check), or null for a wait the rules judge another way (an open fix at work, a block).
 */
export function reviewLateOf(view, item, wait, seenOf = () => undefined) {
  const id = idOf(item)
  const not = { late: false, key: null, ms: 0, words: [] }
  if (wait === null || wait === undefined) return null
  if (wait.kind === 'answer') return not
  if (wait.kind === 'check') {
    if (isPaused(view)) return not
    const key = `review-stuck ${id} check`
    const ms = spanOf(view, seenOf, key, afterPause(view, wait.since))
    if (ms <= view.settings.reviewMinutes * MIN) return { ...not, key, ms }
    const words = checkWordsOf(view, id, wait.since)
    const last = words.at(-1) ?? null
    return { late: last === null || view.now - last.at > view.settings.checkWordMinutes * MIN, key, ms, words }
  }
  if (wait.kind === 'dropped') {
    if (isPaused(view)) return not
    const key = `fix-dropped ${id}`
    const ms = spanOf(view, seenOf, key, afterPause(view, wait.since))
    return { ...not, late: ms > FIX_DROPPED_MS, key, ms }
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
 * The check words the partner was sent about the step `id` from `since` on (the board's ask for its check, the repair
 * `unchecked`'s wakes), oldest first: for the rule review-stuck and the health summary's review line (B585).
 */
export function checkWordsOf(view, id, since) {
  return (view.outbox ?? []).filter(message => message?.about === id && Number.isFinite(message.at) && message.at >= since
    && (message.command === 'result-check' || String(message.syncKey ?? '').startsWith('unchecked ')))
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
  const counted = from => view.now - afterPause(view, from) - (owner === undefined ? 0 : suspendedMs(view, owner.name, afterPause(view, from)))
  const quiet = counted(written ?? began)
  const late = { step: view.now - began, checkpoint, quiet }
  if (written !== null && REPORT_NEXT.test(checkpoint.next) && quiet > view.settings.reportMinutes * MIN) return { kind: 'report', ...late }
  return counted(began) > view.settings.checkpointMinutes * MIN && quiet > view.settings.checkpointMinutes * MIN ? { kind: 'old', ...late } : null
}

/** B572: how long the chat stood suspended for the limit between `from` and now, by its timeline's spans. */
function suspendedMs(view, name, from) {
  const spans = view.timeline.find(one => plain(one.chat, view.prefix) === plain(name, view.prefix))?.spans ?? []
  return spans.filter(span => span.state === 'suspended')
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
  const since = view.now - afterPause(view, takenAt)
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
  for (const lane of workersOf(view)) {
    const owed = lane.clearOwed ?? null
    if (owed === null || !Number.isFinite(owed.reportedAt)) continue
    const key = `not-cleared ${lane.name} ${owed.step}`
    const ms = lasted(view, ctx, key, afterPause(view, owed.reportedAt))
    const took = takenSince(view.items, lane.name, owed.reportedAt, view.prefix)[0] ?? null
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
 * 17. B601 (the fix of X47: at 15:32 both limits showed "read at 14:35" while the pause ran): a limit whose newest
 * reading is older than `oldReadingIncidentMinutes` (60) while a worker works (B645: not while the person pauses; B649: the age counts from the pause's end), when the app's file or a chat
 * should have given a newer one (B632, the fix of X55 and X56: past `oldReadingMinutes` (30) the supervisor chat looks the limits
 * up once with get_usage, which the board reads as a chat reading; under 60 only the health line shows the age). One finding per limit; it clears when a newer reading comes. A limit nothing is
 * known of is the health summary's "not known", not this rule's.
 */
function oldLimitReading(view) {
  const found = []
  const works = workersOf(view).some(lane => lane.state === 'working')
  // B645: quiet while the person pauses: nothing spends then, a reset is known by its time, and no sweep word is delivered until the resume.
  if (isPaused(view) || !works) return found
  for (const [key, name] of [['fiveHour', '5-hour limit'], ['week', 'weekly limit']]) {
    // B649: counted from the end of the last pause at the earliest, as the other rules: the figure was not stale while nothing spent, and the supervisor's lookup after the resume has its time to land.
    const limit = view.limits?.[key]
    const counted = Number.isFinite(limit?.at) ? readingAgeMinutes({ ...limit, at: afterPause(view, limit.at) }, view.now) : null
    if (counted === null || counted <= view.settings.oldReadingIncidentMinutes) continue
    const age = readingAgeMinutes(limit, view.now)
    found.push({
      rule: 'old-limit-reading', key: `old-limit-reading ${key}`, subject: 'board',
      text: `the ${name} was last read ${age} min ago (${clockOf(view.limits[key].at)}), the board steers by an old figure`,
      evidence: `${key} ${Math.round(view.limits[key].used)}% at ${clockOf(view.limits[key].at)}; now ${clockOf(view.now)}; a worker works; threshold ${view.settings.oldReadingIncidentMinutes} min (the supervisor looks the limits up with get_usage past ${view.settings.oldReadingMinutes} min); the app's usage file is written only while the app is in use`,
    })
  }
  return found
}

/** Every watch rule, in the order the section shows them. */
export const WATCH_RULES = [
  { id: 'unknown-lane', kind: 'watch', says: 'a worker "unknown" for too long', check: unknownLane },
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
  { id: 'stale-checkpoint', kind: 'watch', says: 'a step in progress with no checkpoint for hours, or whose checkpoint said to report long ago', check: staleCheckpoint },
  { id: 'effort-mismatch', kind: 'watch', says: 'a worker that still runs another model or effort than its step wants 10 min after the take', check: effortMismatch },
  { id: 'not-cleared', kind: 'watch', says: 'a worker not cleared after its reported step', check: notCleared },
  { id: 'not-taking', kind: 'watch', says: 'a worker that did not take the task it was given', check: notTaking },
  { id: 'old-limit-reading', kind: 'watch', says: 'a limit still last read over 60 min ago, not counting a pause, while a worker works and the supervisor has looked it up', check: oldLimitReading },
]
