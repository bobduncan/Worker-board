// Redesign Part 2 (2026-10-24 spec, "The board hands out all work"; plan 2026-10-25): one ordered list of the tasks
// that are ready, and the board gives the first suitable one to a worker the moment it reports idle (principle 1: code
// before chat). This is the pure part: the list (`readyList`), who gets what (`match`) and when the board asks for a
// worker (`workerStart`). Since T8.5 step 6 the give itself is the hand-over's one decision at the worker's turn end
// (handover.mjs `decide`, which calls `match` for that one worker); the take-back and stuck clocks are gone. The code
// says "step"; the person reads "task".

import { familyOf, modelOf } from './effort.mjs'
import { UNDER_WAY, overlapIn, readyHold } from './guards.mjs'
import { isFix, sinceMs, valueOf } from './item.mjs'
import { barredFrom, isQaTask, notDueWhy } from './qaTask.mjs'

/**
 * The settings' defaults (config.mjs): minutes a follow-up is kept for its worker (0: a preference only, the review of
 * 2026-10-25: the builder is mostly busy again by then); 5 workers at most (B-max, the person, 2026-10-28: "default is 5").
 */
export const HAND_OUT_DEFAULTS = Object.freeze({ followUpMinutes: 0, maxWorkers: 5, handOutBeyondFocus: false })
/** How long a worker the board asked the main chat to start counts as on its way (it has not reported yet). */
export const START_WAIT_MS = 10 * 60_000

const kindOf = item => valueOf(item, 'Kind') ?? 'step'
const stateOf = item => valueOf(item, 'State')
const idOf = item => valueOf(item, 'Id')
const byId = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true })
/** A chat's name as written, without the list's prefix. */
const bare = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim()
}
/** A chat's name for comparing: without the prefix, in lower case. */
const plain = (name, prefix = '') => bare(name, prefix).toLowerCase()

const HISTORY_AT = /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)\s/
const FINISHED_MOVE = /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)\s+[^:]+: \S.* → (?:review|done)\b/
/** The board's sync check took a Blocked by off (api.mjs `blockOn`): the ids it named still count for the follow-up. */
const UNBLOCKED = /: no longer (?:blocked by|waits for:) ([^(]*)/
const historyOf = item => item.sections?.get('History') ?? []
const idsIn = words => String(words ?? '').match(/\bB\d+\b/g) ?? []

/** When the step was last finished by its worker: its newest History move to review or to done; NaN when none says. */
function finishedAt(item) {
  const found = historyOf(item).map(line => line.match(FINISHED_MOVE)).filter(Boolean).at(-1)
  return found === undefined ? Number.NaN : sinceMs(found[1])
}

/**
 * Who a step is a follow-up of, and until when: `{ worker, until, at }`, or null. A step named in its `Blocked by` or
 * `Waits for` (or one the board's sync check took off them since) that is in review or done now, with an Owner, whose
 * last move to review or done is less than `followUpMs` ago: the newest such. Or the step its `Fix of` names (its
 * Owner, the builder), counted from the fix's first History line. `followUpMs` 0: none (Infinity: any time ago).
 */
export function followUpOf(item, items, { now, followUpMs, prefix = '' }) {
  if (!(followUpMs > 0)) return null
  const named = new Set([...idsIn(valueOf(item, 'Blocked by')), ...idsIn(valueOf(item, 'Waits for'))])
  for (const line of historyOf(item)) for (const id of idsIn(line.match(UNBLOCKED)?.[1])) named.add(id)
  const found = []
  for (const id of named) {
    const other = items.get(id)
    if (other === undefined || !['review', 'done'].includes(stateOf(other)) || valueOf(other, 'Owner') === null) continue
    const at = finishedAt(other)
    if (Number.isFinite(at) && now - at < followUpMs) found.push({ worker: bare(valueOf(other, 'Owner'), prefix), until: at + followUpMs, at })
  }
  const origin = valueOf(item, 'Fix of') === null ? undefined : items.get(valueOf(item, 'Fix of'))
  if (origin !== undefined && valueOf(origin, 'Owner') !== null) {
    const made = sinceMs(historyOf(item).map(line => line.match(HISTORY_AT)?.[1]).find(Boolean) ?? valueOf(item, 'Since'))
    if (Number.isFinite(made) && now - made < followUpMs) found.push({ worker: bare(valueOf(origin, 'Owner'), prefix), until: made + followUpMs, at: made })
  }
  return found.sort((a, b) => b.at - a.at)[0] ?? null
}

/** The Backlog tab's blocks (2026-10-25): why a refined task outside the focus goal waits, until the person adds it. */
export const CHOICE_WHY = 'outside the focus goal: waits until you add it to the queue or switch the focus'

/**
 * When the person added a step to the queue (its `Queued by: person, <stamp>`, the work API's `add-to-queue`), in ms;
 * NaN when it was not added (or the stamp cannot be read).
 */
export function addedAt(item) {
  const found = String(valueOf(item, 'Queued by') ?? '').match(/^person,\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)$/)
  return found === null ? Number.NaN : sinceMs(found[1])
}
/** The stamp of the person's add to the queue, as written (its whole value when it has none), or null when not added. */
function addedStamp(item) {
  const value = valueOf(item, 'Queued by')
  return value === null ? null : value.replace(/^person,?\s*/, '').trim() || value
}

/** A step and the steps it fixes, down its fix chain (`Fix of`), itself first; a chain that loops stops at the repeat. */
function fixChain(item, items) {
  const chain = []
  for (let one = item; one !== undefined && !chain.includes(one); one = valueOf(one, 'Fix of') === null ? undefined : items.get(valueOf(one, 'Fix of'))) chain.push(one)
  return chain
}

/**
 * T9.1.1: why a QA task has nothing to check now, in one line; null for any other task. The step it checks is not in review, or
 * it is but waits for something else than a result check (the person's answer to an ask point, an open fix): the check
 * the task would make is not due. (The repair `unchecked` drops such a task nobody took.)
 */
function staleQaWhy(item, items, now) {
  if (!isQaTask(item)) return null
  const checks = valueOf(item, 'Checks')
  const step = items.get(checks)
  if (step === undefined) return `${checks} is not in the store: nothing to check`
  if (stateOf(step) !== 'review') return `${checks} is ${stateOf(step)}, not in review: nothing to check`
  const notDue = notDueWhy(step, items, now)
  return notDue === null ? null : `${checks} ${notDue}: nothing to check`
}

/**
 * The ready list: `{ ready, held }`. Every step in state refined; ready when nothing holds it (guards.mjs `readyHold`),
 * its kind's standard does not hold it (`standardHold(item)`, a why or null) and its routing record does not
 * (`routingHeld`, ids); else held, `{ id, why }` in one line. `ready` in the board's order: a Quality Assurance task first
 * (rank -1, T9.1.1: the person, 2026-10-27, "checks go before new steps"), then a fix (rank 0), then a
 * task of the focus goal (1), then the rest (2): the tasks the person added to the queue (`added`, its stamp) in the
 * order they were added, then the others by id; ranks -1, 0 and 1 each by id. With the worker it is kept for (`keptFor`: its
 * pin, else, with `followUpMs` above 0, the worker it is a follow-up of, until `keptUntil`), its pin (`pinned`), and
 * (`followUpMs` 0, the default: a preference only) the worker it goes to when that one is idle at the give (`prefers`).
 * A task of rank 2 neither pinned nor added is held for the person's choice (`choice: true`, CHOICE_WHY) unless
 * `beyondFocus`.
 * A QA task (qaTask.mjs) is never held for the person's pick (the step it checks was started already), is a follow-up of
 * nobody, and carries `notBy`, the chats it is never given to (its stored `Not by` joined with the builders of the step it
 * checks and of its fix chain now: qaTask.mjs `barredFrom`). It is held, saying so, while the step it checks is not in review
 * (the person marked it done, dropped it: no worker checks a closed step) or waits for something else than a result check (the
 * person's answer to an ask point, an open fix); the supervisor's repair `unchecked` drops the task.
 * Which steps go out by themselves (B691, B694, B697; the one place that states it): the focus is the goal `focus` and the
 * goals under it (`focusGoals`): a step of one is the focus's, rank 1. A fix goes out as its root does (its chain,
 * `fixChain`): it is the focus's when any step down its chain belongs to the focus, and picked when any step down its chain
 * was added to the queue or pinned by the person and is not dropped. A dropped step's pick does not count: it has nothing
 * left to make pass, so its fix waits like an unpicked step. Only a step of an unrelated goal that nobody picked waits
 * for "Add to queue" (CHOICE_WHY).
 */
export function readyList(items, { now, focus = null, focusGoals = [], followUpMs = HAND_OUT_DEFAULTS.followUpMinutes * 60_000, standardHold = null, routingHeld = new Set(), prefix = '', beyondFocus = true }) {
  const ready = []
  const held = []
  const ctx = { store: { items } }
  const inFocus = new Set([...(focus === null ? [] : [focus]), ...focusGoals])
  const steps = [...items.values()].filter(item => kindOf(item) === 'step' && stateOf(item) === 'refined' && typeof idOf(item) === 'string')
  for (const item of steps.sort((a, b) => byId(idOf(a), idOf(b)))) {
    const id = idOf(item)
    const why = staleQaWhy(item, items, now) ?? readyHold(item, ctx) ?? standardHold?.(item) ?? (routingHeld.has(id) ? 'held by its routing record' : null)
    if (why !== null) {
      held.push({ id, why })
      continue
    }
    const pinned = valueOf(item, 'Pinned') === null ? null : bare(valueOf(item, 'Pinned'), prefix)
    const isKept = followUpMs > 0
    const isQa = isQaTask(item)
    const follow = pinned === null && !isQa ? followUpOf(item, items, { now, followUpMs: isKept ? followUpMs : Infinity, prefix }) : null
    const chain = fixChain(item, items)
    const rank = isQa ? -1 : isFix(item) ? 0 : chain.some(one => inFocus.has(valueOf(one, 'Goal'))) ? 1 : 2
    const added = addedStamp(item)
    // B691: a fix goes out as its root does: the person's pick (added or pinned) of any step down its chain is its own.
    // A dropped root has nothing left to make pass: its pick does not carry the fix.
    const picked = chain.some(one => stateOf(one) !== 'dropped' && (addedStamp(one) !== null || valueOf(one, 'Pinned') !== null))
    // 2026-10-25, the controller in the person's place (principle 8): a task that is no fix, not of the focus goal and
    // not pinned waits for the person's pick, unless the settings' `handOutBeyondFocus` is true. The whole backlog is
    // not the board's to start. The Backlog tab's blocks: the person picks it with "Add to queue" (`Queued by`).
    if (rank === 2 && pinned === null && !picked && !beyondFocus) {
      held.push({ id, why: CHOICE_WHY, choice: true })
      continue
    }
    ready.push({ id, rank, keptFor: pinned ?? (isKept ? follow?.worker ?? null : null), keptUntil: isKept ? follow?.until ?? null : null, pinned, prefers: isKept ? null : follow?.worker ?? null, ...(added === null ? {} : { added }), ...(isQa ? { notBy: barredFrom(item, items) } : {}) })
  }
  // Within rank 2 the person's additions come first, in the order they were added (one without a readable stamp last of them).
  const addedOrder = one => (one.rank !== 2 || one.added === undefined ? Infinity : Number.isFinite(addedAt(items.get(one.id))) ? addedAt(items.get(one.id)) : Number.MAX_SAFE_INTEGER)
  return { ready: ready.sort((a, b) => a.rank - b.rank || addedOrder(a) - addedOrder(b) || byId(a.id, b.id)), held }
}

/** The History line of the board's give (api.mjs `give`). */
const GIVE_LINE = / → queued \(given by the board to /
const QUEUED_LINE = / → queued(?:\s|$)/

/**
 * A History line that placed a step with a worker before the redesign: Main's or the person's queue and requeue, a
 * queue kept until the refine, the board's queue of an incident fix, a result check's fix, the sync check's requeue.
 */
const PLACED_LINE = /^-\s+\S+ \S+ [^:]+: (?:queued for |requeued for |queued by the board for )/

/** A queued step whose newest placement is one of before the redesign, not the board's give. */
export function isPlacedBefore(item) {
  if (stateOf(item) !== 'queued') return false
  const last = historyOf(item).findLast(line => PLACED_LINE.test(line) || (QUEUED_LINE.test(line) && GIVE_LINE.test(line)))
  return last !== undefined && !GIVE_LINE.test(last)
}

/**
 * Redesign Part 2, at rollout (plan Question 2): the tasks queued before the board handed out all work: every step
 * queued whose newest placement is such a line, not the board's give, and every step that keeps a queue asked before its
 * refine (`Queue when refined`). `[{ id }]` by id; the board puts them back on the list once (api.mjs `retire-queue`), so
 * it finds none after. A queued step with neither line (one the backlog's migration made queued) is left as it is.
 */
export function oldQueued(items) {
  return [...items.values()].filter(item => kindOf(item) === 'step' && typeof idOf(item) === 'string' && (
    isPlacedBefore(item)
    || (valueOf(item, 'Queue when refined') !== null && !['done', 'dropped'].includes(stateOf(item)))))
    .map(item => ({ id: idOf(item) }))
    .sort((a, b) => byId(a.id, b.id))
}

/** The states in which a step holds its worker for the hand-out: given (queued) or under way. */
const HOLDS_WORKER = ['queued', 'taken', 'in progress']
/** A step given (queued) or under way: its Touches count against a task to give. */
const COUNTS_FOR_TOUCHES = ['queued', ...UNDER_WAY]
const holdsOf = (items, name, prefix) => [...items.values()].some(item => kindOf(item) === 'step' && HOLDS_WORKER.includes(stateOf(item))
  && plain(valueOf(item, 'Owner'), prefix) === plain(name, prefix))
const isWorkerLane = lane => lane.isMain !== true && lane.isLeftover !== true

/**
 * T8.5 step 6: the tasks the board gave that no hand-over will ever carry on (principle 2: nothing waits for ever), back
 * on the list: `[{ id, chat, why }]`. A step queued by the board's give (its newest move to queued is the give) whose Owner
 * is a worker of the list not on the sequence (the setting turned to "timers", its mod older than the sequence's) goes
 * back at once; one whose Owner is no worker of the list (dropped from the app's list, gone) goes back `waitMs` after the
 * give (the list may lose a chat for a while). A worker on the sequence is its hand-over's (its net). A board that reads
 * no worker at all (the app's list of chats could not be read) takes nothing back.
 */
export function strandedGives({ items, lanes = [], now, waitMs, prefix = '' }) {
  const backs = []
  const workers = lanes.filter(isWorkerLane)
  if (workers.length === 0) return backs
  const queued = [...items.values()].filter(item => kindOf(item) === 'step' && stateOf(item) === 'queued' && valueOf(item, 'Owner') !== null
    && GIVE_LINE.test(historyOf(item).findLast(line => QUEUED_LINE.test(line)) ?? ''))
  for (const item of queued.sort((a, b) => byId(idOf(a), idOf(b)))) {
    const owner = bare(valueOf(item, 'Owner'), prefix)
    const lane = workers.find(one => plain(one.name, prefix) === plain(owner, prefix))
    if (lane?.onSequence === true) continue
    if (lane !== undefined) {
      backs.push({ id: idOf(item), chat: lane.name, why: `${lane.name} is not on the hand-over` })
      continue
    }
    const givenAt = sinceMs(valueOf(item, 'Since'))
    if (Number.isFinite(givenAt) && now - givenAt >= waitMs) backs.push({ id: idOf(item), chat: owner, why: `${owner} is no worker of the list` })
  }
  return backs
}

/**
 * The workers that get a task now (principle 3: only what a chat told the board): a worker lane (not the main chat, not
 * a leftover) whose chat reports (`lane.report`, the Workers mod's own word), idle and free (or, B567, named in
 * `restFree`: it rests while its task waits on the person), running, holding no step given or under way, not in `stuck`
 * (the reconciler's: a worker its failed report check was handed back to).
 * Free by the board's older reading of a chat, unknown, off, suspended or busy: none. The one idle longest first, then
 * by name. T13 part 3: an asleep one (its process ended after it said idle: state.mjs `asleep`) is free too: its task's
 * line wakes it (the board's start word beside it, deliver.mjs `sendOnce`).
 */
export function idleWorkers(lanes, { items, prefix = '', restFree = [], stuck = new Set() }) {
  // T13 part 3: or asleep after its session ended (a routine chat ends it after its idle turn).
  return lanes.filter(lane => isWorkerLane(lane) && lane.report !== null && lane.report !== undefined && (lane.report.state === 'idle' || (lane.asleep === true && lane.report.state === 'ended'))
    && (lane.state === 'free' || restFree.includes(lane.name)) && (lane.isRunning === true || lane.asleep === true)
    && !stuck.has(lane.name) && !holdsOf(items, lane.name, prefix))
    .sort((a, b) => (a.report.since ?? 0) - (b.report.since ?? 0) || byId(a.name, b.name))
}

/**
 * T9.1.1: whether a ready entry is never given to this worker: a Quality Assurance task (its `notBy`, joined with the builders of
 * the step it checks and of its fix chain as the store has them now: `barredFrom`) to a chat that built the step, whatever the
 * list's prefix and the letters of the name.
 */
const isBarred = (one, worker, prefix = '', items = null) => {
  const task = items?.get(one.id)
  const names = [...(one.notBy ?? []), ...(task !== undefined && isQaTask(task) ? barredFrom(task, items) : [])]
  return names.some(name => plain(name, prefix) === plain(worker.name, prefix))
}

/**
 * Who gets what now: `[{ id, chat, why }]`, each worker and each task at most once. First each kept task (its pin, its
 * follow-up) to its worker when that worker is idle; a kept task whose worker is not idle waits. Then the rest in the
 * list's order, each to the worker it prefers (a follow-up's builder) when that one is idle, else to an idle worker
 * already on its model family, else to the first idle one. A task whose Touches overlap a step given or under way, or
 * one given in this pass, is skipped. T9.1.1: a QA task is never given to a worker in its `notBy`; with only such workers
 * idle it waits for another, and the next task of the list goes on to them. (T8.5 step 6: the hand-over's `decide` calls
 * it for one worker at a time; what it may not offer that worker it leaves out of `ready` itself.)
 */
export function match({ ready = [], idle = [], items, prefix = '' }) {
  const scratch = new Map(items)
  const free = [...idle]
  const given = []
  const give = (one, lane, why) => {
    const item = items.get(one.id)
    scratch.set(one.id, { ...item, head: new Map(item.head).set('State', 'queued').set('Owner', lane.name) })
    free.splice(free.indexOf(lane), 1)
    given.push({ id: one.id, chat: lane.name, why })
  }
  const overlaps = one => overlapIn(scratch, items.get(one.id), COUNTS_FOR_TOUCHES) !== null
  // T9.1.1: a QA task is never given to a chat that built the step it checks, pinned or not.
  const may = (one, worker) => !isBarred(one, worker, prefix, items)
  for (const one of ready.filter(task => task.keptFor !== null && items.has(task.id))) {
    const lane = free.find(worker => plain(worker.name, prefix) === plain(one.keptFor, prefix) && may(one, worker))
    if (lane === undefined || overlaps(one)) continue
    give(one, lane, one.pinned !== null ? `${one.id} is pinned to ${lane.name}` : `${one.id} follows up what ${lane.name} just finished`)
  }
  for (const one of ready.filter(task => task.keptFor === null && items.has(task.id))) {
    if (free.length === 0) break
    if (overlaps(one)) continue
    const family = modelOf(items.get(one.id)).family
    const open = free.filter(worker => may(one, worker))
    const preferred = (one.prefers ?? null) === null ? undefined : open.find(worker => plain(worker.name, prefix) === plain(one.prefers, prefix))
    const onIt = open.find(worker => familyOf(worker.model) === family)
    const lane = preferred ?? onIt ?? open[0]
    if (lane === undefined) continue
    give(one, lane, preferred !== undefined ? `${one.id} follows up what ${lane.name} finished` : `${one.id} is the first ready task${onIt === undefined ? '' : ` for a worker on ${family}`}; ${lane.name} is free`)
  }
  return given
}

/**
 * The workers on their way (the review of 2026-10-25: one ready task made two spawns): a worker of the list the main
 * chat was asked to start in the last START_WAIT_MS that has not reported since, and the board's own asks for new
 * workers of that time, each less the workers that reported since it went (its `reported`, how many had then).
 */
function startsPending({ workers, sent = [], now, prefix = '' }) {
  const reported = workers.filter(lane => lane.report != null).length
  let pending = 0
  for (const word of sent) {
    if (!Number.isFinite(word.at) || now - word.at >= START_WAIT_MS || ['failed', 'expired', 'dropped'].includes(word.state)) continue
    if (word.command === 'spawn' && Number.isFinite(word.reported)) pending += Math.max(0, (Number(word.count) || 1) - Math.max(0, reported - word.reported))
    if (word.command === 'start') {
      const lane = workers.find(one => plain(one.name, prefix) === plain(word.about, prefix))
      // T13 part 3: an asleep worker's start (its task's line wakes it) is counted as the worker it is already, not twice.
      if (lane !== undefined && lane.asleep !== true && !(lane.report?.at > word.at)) pending += 1
    }
  }
  return pending
}

/**
 * Whether the board asks for one more worker now: `{ start: name }` (a worker of the list whose chat is off, the one off
 * longest first), `{ spawn: 1 }` (a new one), or null. `maxWorkers` left out is 5 (B-max); null when it is given as no
 * number (the board starts none),
 * while held (the person pauses, a limit is full), while an idle worker is left after this pass's gives, or when the
 * workers not off are `maxWorkers` already. Only tasks a new worker could take count: ready, kept for nobody (a pinned
 * task waits for its worker only: Review Focus 5), not given in this pass, their Touches overlapping no step given or
 * under way (as `match`); less the workers on their way (`startsPending`).
 * Gap 2 (principle 2: never wait for ever): a ready task pinned to a worker whose chat is off, or unknown for longer than
 * `offAfterMs` by its last report, has that worker started first (`{ start: name, pinned: id }`: a start word, never a
 * spawn; also while another worker is idle), once per START_WAIT_MS, and counted toward `maxWorkers` as any start.
 */
export function workerStart({ ready = [], gives = [], idle = [], lanes = [], maxWorkers = HAND_OUT_DEFAULTS.maxWorkers, isHeld = false, items = new Map(), sent = [], now = Date.now(), prefix = '', refused = [], offAfterMs = Infinity }) {
  if (!Number.isFinite(maxWorkers) || isHeld) return null
  const handed = new Set(gives.map(one => one.id))
  const scratch = new Map(items)
  for (const one of gives) {
    const item = items.get(one.id)
    if (item !== undefined) scratch.set(one.id, { ...item, head: new Map(item.head).set('State', 'queued') })
  }
  // The recheck: a task the work API refused lately waits for that refusal, not for a worker: it counts for none.
  const refusedIds = new Set(refused.map(one => one.id))
  const workers = lanes.filter(isWorkerLane)
  const pending = startsPending({ workers, sent, now, prefix })
  // T13 part 3: an asleep worker is no closed one: it counts toward `maxWorkers`, and its task's line or its resume word wakes it.
  const isOff = lane => (lane.state === 'off' || lane.isRunning === false) && lane.asleep !== true
  // The person, 2026-10-25: "ensure the board can't make more than the allowed limit": the workers on their way count
  // toward `maxWorkers` too, so a start word sent before the last one reported never makes one too many. A worker on
  // its way may already show as a lane with no report yet: those and the pending starts are the same chats, counted once.
  const isFull = (others = workers) => {
    const running = others.filter(lane => !isOff(lane))
    const reporting = running.filter(lane => lane.report != null).length
    return reporting + Math.max(running.length - reporting, pending) >= maxWorkers
  }
  const pinnedTo = pinnedStart({ ready, handed, refusedIds, workers, scratch, items, sent, now, prefix, offAfterMs, isOff })
  if (pinnedTo !== null) return isFull(workers.filter(lane => lane !== pinnedTo.lane)) ? null : { start: pinnedTo.lane.name, pinned: pinnedTo.id }
  const given = new Set(gives.map(one => one.chat))
  // T9.1.1: an idle worker that may take none of the tasks still waiting (it built the step of every QA task left) holds no
  // start back: the task waits for another worker, so one is asked for.
  const waiting = ready.filter(one => one.keptFor === null && !handed.has(one.id) && !refusedIds.has(one.id))
  if (idle.some(lane => !given.has(lane.name) && (waiting.length === 0 || waiting.some(one => !isBarred(one, lane, prefix, items))))) return null
  let givable = 0
  for (const one of ready) {
    if (one.keptFor !== null || handed.has(one.id) || refusedIds.has(one.id)) continue
    const item = items.get(one.id)
    if (item !== undefined && overlapIn(scratch, item, COUNTS_FOR_TOUCHES) !== null) continue
    givable += 1
    if (item !== undefined) scratch.set(one.id, { ...item, head: new Map(item.head).set('State', 'queued') })
  }
  if (givable - pending <= 0) return null
  if (isFull()) return null
  const off = workers.filter(isOff).sort((a, b) => (a.offSince ?? 0) - (b.offSince ?? 0) || byId(a.name, b.name))[0]
  return off === undefined ? { spawn: 1 } : { start: off.name }
}

/**
 * Gap 2: `{ lane, id }`, the worker lane a ready pinned task (`id`) waits for whose chat is off (or unknown past `offAfterMs` since its last
 * report) and that the main chat was not asked to start in the last START_WAIT_MS, the first by the list's order; or
 * null. A task given in this pass, refused lately, or whose Touches overlap a step given or under way does not count.
 */
function pinnedStart({ ready, handed, refusedIds, workers, scratch, items, sent, now, prefix, offAfterMs, isOff }) {
  const isLongUnknown = lane => lane.state === 'unknown' && Number.isFinite(lane.report?.at) && now - lane.report.at > offAfterMs
  const askedLately = lane => sent.some(word => word.command === 'start' && plain(word.about, prefix) === plain(lane.name, prefix) && Number.isFinite(word.at) && now - word.at < START_WAIT_MS)
  for (const one of ready) {
    if ((one.pinned ?? null) === null || handed.has(one.id) || refusedIds.has(one.id)) continue
    const lane = workers.find(worker => plain(worker.name, prefix) === plain(one.pinned, prefix))
    if (lane === undefined || !(isOff(lane) || isLongUnknown(lane)) || askedLately(lane)) continue
    const item = items.get(one.id)
    if (item !== undefined && overlapIn(scratch, item, COUNTS_FOR_TOUCHES) !== null) continue
    return { lane, id: one.id }
  }
  return null
}
