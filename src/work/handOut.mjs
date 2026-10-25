// Redesign Part 2 (2026-10-24 spec, "The board hands out all work"; plan 2026-10-25): one ordered list of the tasks
// that are ready, and the board gives the first suitable one to a worker the moment it reports idle (principle 1: code
// before chat). This is the pure part: the list (`readyList`), who gets what (`match`), what goes back on the list
// (`takeBacks`), who shows stuck (`stuckWorkers`) and when the board asks for a worker (`workerStart`). The reconciler
// names them (reconcile.mjs), the server carries them out through the work API (deliver.mjs). The code says "step"; the
// person reads "task".

import { familyOf, modelOf } from './effort.mjs'
import { UNDER_WAY, overlapIn, readyHold } from './guards.mjs'
import { isFix, sinceMs, valueOf } from './item.mjs'

/** The settings' defaults (config.mjs): minutes to take a given task, minutes a follow-up is kept, no number of workers. */
export const HAND_OUT_DEFAULTS = Object.freeze({ takeWithinMinutes: 2, followUpMinutes: 10, maxWorkers: null })

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
 * Who a step is a follow-up of, and until when: `{ worker, until }`, or null. A step named in its `Blocked by` or
 * `Waits for` (or one the board's sync check took off them since) that is in review or done now, with an Owner, whose
 * last move to review or done is less than `followUpMs` ago: the newest such. Or the step its `Fix of` names (its
 * Owner, the builder), counted from the fix's first History line. `followUpMs` 0: none.
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
    if (Number.isFinite(at) && now - at < followUpMs) found.push({ worker: bare(valueOf(other, 'Owner'), prefix), until: at + followUpMs })
  }
  const origin = valueOf(item, 'Fix of') === null ? undefined : items.get(valueOf(item, 'Fix of'))
  if (origin !== undefined && valueOf(origin, 'Owner') !== null) {
    const made = sinceMs(historyOf(item).map(line => line.match(HISTORY_AT)?.[1]).find(Boolean) ?? valueOf(item, 'Since'))
    if (Number.isFinite(made) && now - made < followUpMs) found.push({ worker: bare(valueOf(origin, 'Owner'), prefix), until: made + followUpMs })
  }
  return found.sort((a, b) => b.until - a.until)[0] ?? null
}

/**
 * The ready list: `{ ready, held }`. Every step in state refined; ready when nothing holds it (guards.mjs `readyHold`),
 * its kind's standard does not hold it (`standardHold(item)`, a why or null) and its routing record does not
 * (`routingHeld`, ids); else held, `{ id, why }` in one line. `ready` in the board's order: a fix first (rank 0), then a
 * task of the focus goal (1), then the rest (2), each by id; with the worker it is kept for (`keptFor`: its pin, else the
 * worker it is a follow-up of, until `keptUntil`) and its pin (`pinned`).
 */
export function readyList(items, { now, focus = null, followUpMs = HAND_OUT_DEFAULTS.followUpMinutes * 60_000, standardHold = null, routingHeld = new Set(), prefix = '' }) {
  const ready = []
  const held = []
  const ctx = { store: { items } }
  const steps = [...items.values()].filter(item => kindOf(item) === 'step' && stateOf(item) === 'refined' && typeof idOf(item) === 'string')
  for (const item of steps.sort((a, b) => byId(idOf(a), idOf(b)))) {
    const id = idOf(item)
    const why = readyHold(item, ctx) ?? standardHold?.(item) ?? (routingHeld.has(id) ? 'held by its routing record' : null)
    if (why !== null) {
      held.push({ id, why })
      continue
    }
    const pinned = valueOf(item, 'Pinned') === null ? null : bare(valueOf(item, 'Pinned'), prefix)
    const follow = pinned === null ? followUpOf(item, items, { now, followUpMs, prefix }) : null
    const rank = isFix(item) ? 0 : focus !== null && valueOf(item, 'Goal') === focus ? 1 : 2
    ready.push({ id, rank, keptFor: pinned ?? follow?.worker ?? null, keptUntil: follow?.until ?? null, pinned })
  }
  return { ready: ready.sort((a, b) => a.rank - b.rank || byId(a.id, b.id)), held }
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
 * it finds none after. A queued step with neither line (one the backlog's migration made queued) is left to the
 * take-back, as any given task.
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
 * The workers that get a task now (principle 3: only what a chat told the board): a worker lane (not the main chat, not
 * a leftover) whose chat reports (`lane.report`, the Workers mod's own word), idle and free (or, B567, named in
 * `restFree`: it rests while its task waits on the person), running, holding no step given or under way, not stuck.
 * Free by the board's older reading of a chat, unknown, off, suspended or busy: none. The one idle longest first, then
 * by name.
 */
export function idleWorkers(lanes, { items, prefix = '', restFree = [], stuck = new Set() }) {
  return lanes.filter(lane => isWorkerLane(lane) && lane.report !== null && lane.report !== undefined && lane.report.state === 'idle'
    && (lane.state === 'free' || restFree.includes(lane.name)) && lane.isRunning === true
    && !stuck.has(lane.name) && !holdsOf(items, lane.name, prefix))
    .sort((a, b) => (a.report.since ?? 0) - (b.report.since ?? 0) || byId(a.name, b.name))
}

/**
 * Who gets what now: `[{ id, chat, why }]`, each worker and each task at most once. First each kept task (its pin, its
 * follow-up) to its worker when that worker is idle; a kept task whose worker is not idle waits. Then the rest in the
 * list's order, each to an idle worker already on its model family, else to the first idle one. A task whose Touches
 * overlap a step given or under way, or one given in this pass, is skipped.
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
  for (const one of ready.filter(task => task.keptFor !== null && items.has(task.id))) {
    const lane = free.find(worker => plain(worker.name, prefix) === plain(one.keptFor, prefix))
    if (lane === undefined || overlaps(one)) continue
    give(one, lane, one.pinned !== null ? `${one.id} is pinned to ${lane.name}` : `${one.id} follows up what ${lane.name} just finished`)
  }
  for (const one of ready.filter(task => task.keptFor === null && items.has(task.id))) {
    if (free.length === 0) break
    if (overlaps(one)) continue
    const family = modelOf(items.get(one.id)).family
    const onIt = free.find(worker => familyOf(worker.model) === family)
    const lane = onIt ?? free[0]
    give(one, lane, `${one.id} is the first ready task${onIt === undefined ? '' : ` for a worker on ${family}`}; ${lane.name} is free`)
  }
  return given
}

/** A work line of the board's to a chat about a step (not the sync check's): the line the take is counted from. */
const isWorkLine = (message, id, owner, prefix) => message.command === 'work' && message.about === id && (message.syncKey ?? null) === null
  && plain(message.to, prefix) === plain(owner, prefix) && Number.isFinite(message.at)

/**
 * The given tasks that go back on the list (principle 2): `[{ id, chat, stuck, why }]`. A queued step whose Owner is no
 * worker of the list goes back at once. Else, once its newest work line to its Owner is `takeWithinMs` old and the step
 * is still queued: not taken in time. A step whose line has not gone yet (held for its model, a clear, a mod restart:
 * Review Focus 1) is never taken back. `stuck` only when the worker's report is fresh and has said idle since before
 * that line: it never reacted (a worker the person typed to just after the give went busy: not stuck).
 */
export function takeBacks({ items, outbox = [], lanes = [], now, takeWithinMs, prefix = '' }) {
  const backs = []
  const workers = lanes.filter(isWorkerLane)
  const queued = [...items.values()].filter(item => kindOf(item) === 'step' && stateOf(item) === 'queued' && valueOf(item, 'Owner') !== null)
  for (const item of queued.sort((a, b) => byId(idOf(a), idOf(b)))) {
    const id = idOf(item)
    const owner = bare(valueOf(item, 'Owner'), prefix)
    const lane = workers.find(one => plain(one.name, prefix) === plain(owner, prefix))
    if (lane === undefined) {
      backs.push({ id, chat: owner, stuck: false, why: `${owner} is no worker of the list` })
      continue
    }
    const line = outbox.filter(message => isWorkLine(message, id, owner, prefix)).sort((a, b) => a.at - b.at).at(-1)
    if (line === undefined || now - line.at < takeWithinMs) continue
    const report = lane.report ?? null
    const isFresh = report !== null && lane.isRunning === true && !['unknown', 'off', 'suspended'].includes(lane.state)
    const stuck = isFresh && report.state === 'idle' && Number.isFinite(report.since) && report.since < line.at
    backs.push({ id, chat: lane.name, stuck, why: `not taken within ${Math.round(takeWithinMs / 60_000)} min` })
  }
  return backs
}

/** The History line of a take-back that left its worker stuck (api.mjs `advance` with `takeBack`). */
const STUCK_LINE = /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+server: queued → refined \(taken back from (.+?): .*; stuck\)$/

/**
 * The stuck take-backs per worker lane: `Map<lane name, { id, at, stamp }>`, the newest whose stamp is at or after the
 * lane's report's since (the stamp is to the minute; a take-back comes at least `takeWithinMinutes` ≥ 1 after the line
 * the worker sat idle through, so a report since before it is older than that minute). A worker that reported anew is
 * no longer stuck.
 */
export function stuckTakeBacks({ items, lanes = [], prefix = '' }) {
  const found = new Map()
  const workers = lanes.filter(lane => isWorkerLane(lane) && Number.isFinite(lane.report?.since))
  if (workers.length === 0) return found
  for (const item of items.values()) {
    if (kindOf(item) !== 'step') continue
    for (const line of historyOf(item)) {
      const hit = line.match(STUCK_LINE)
      if (hit === null) continue
      const lane = workers.find(one => plain(one.name, prefix) === plain(hit[2], prefix))
      const at = sinceMs(hit[1])
      if (lane === undefined || !(at >= lane.report.since)) continue
      if (!found.has(lane.name) || found.get(lane.name).at <= at) found.set(lane.name, { id: idOf(item), at, stamp: hit[1] })
    }
  }
  return found
}

/** The worker lanes that are stuck now (`stuckTakeBacks`), by name. */
export const stuckWorkers = facts => new Set(stuckTakeBacks(facts).keys())

/**
 * Whether the board asks for one more worker now: `{ start: name }` (a worker of the list whose chat is off, the one off
 * longest first), `{ spawn: 1 }` (a new one), or null. Null when `maxWorkers` is no number (the board starts none),
 * while held (the person pauses, a limit is full), while an idle worker is left after this pass's gives, when every
 * ready task is given or kept for a worker (a pinned task waits for its worker only: Review Focus 5), or when the
 * workers not off are `maxWorkers` already.
 */
export function workerStart({ ready = [], gives = [], idle = [], lanes = [], maxWorkers = null, isHeld = false }) {
  if (!Number.isFinite(maxWorkers) || isHeld) return null
  const given = new Set(gives.map(one => one.chat))
  if (idle.some(lane => !given.has(lane.name))) return null
  const handed = new Set(gives.map(one => one.id))
  if (!ready.some(one => one.keptFor === null && !handed.has(one.id))) return null
  const workers = lanes.filter(isWorkerLane)
  const isOff = lane => lane.state === 'off' || lane.isRunning === false
  if (workers.filter(lane => !isOff(lane)).length >= maxWorkers) return null
  const off = workers.filter(isOff).sort((a, b) => (a.offSince ?? 0) - (b.offSince ?? 0) || byId(a.name, b.name))[0]
  return off === undefined ? { spawn: 1 } : { start: off.name }
}
