// Redesign Part 2 (2026-10-24 spec, "The board hands out all work"; plan 2026-10-25): one ordered list of the tasks
// that are ready, and the board gives the first suitable one to a worker the moment it reports idle (principle 1: code
// before chat). This is the pure part: the list (`readyList`), who gets what (`match`), what goes back on the list
// (`takeBacks`), who shows stuck (`stuckWorkers`) and when the board asks for a worker (`workerStart`). The reconciler
// names them (reconcile.mjs), the server carries them out through the work API (deliver.mjs). The code says "step"; the
// person reads "task".

import { familyOf, modelOf } from './effort.mjs'
import { UNDER_WAY, overlapIn, readyHold } from './guards.mjs'
import { isFix, sinceMs, valueOf } from './item.mjs'

/**
 * The settings' defaults (config.mjs): minutes to take a given task; minutes a follow-up is kept for its worker (0: a
 * preference only, the review of 2026-10-25: the builder is mostly busy again by then); minutes a give may wait for its
 * line (a model switch, a clear, a mod restart, a chat off) before it goes back; no number of workers.
 */
export const HAND_OUT_DEFAULTS = Object.freeze({ takeWithinMinutes: 2, followUpMinutes: 0, heldGiveMinutes: 20, maxWorkers: null, handOutBeyondFocus: false })
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
 * The ready list: `{ ready, held }`. Every step in state refined; ready when nothing holds it (guards.mjs `readyHold`),
 * its kind's standard does not hold it (`standardHold(item)`, a why or null) and its routing record does not
 * (`routingHeld`, ids); else held, `{ id, why }` in one line. `ready` in the board's order: a fix first (rank 0), then a
 * task of the focus goal (1), then the rest (2): the tasks the person added to the queue (`added`, its stamp) in the
 * order they were added, then the others by id; ranks 0 and 1 each by id. With the worker it is kept for (`keptFor`: its
 * pin, else, with `followUpMs` above 0, the worker it is a follow-up of, until `keptUntil`), its pin (`pinned`), and
 * (`followUpMs` 0, the default: a preference only) the worker it goes to when that one is idle at the give (`prefers`).
 * A task of rank 2 neither pinned nor added is held for the person's choice (`choice: true`, CHOICE_WHY) unless
 * `beyondFocus`.
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
    const why = readyHold(item, ctx) ?? standardHold?.(item) ?? (routingHeld.has(id) ? 'held by its routing record' : null)
    if (why !== null) {
      held.push({ id, why })
      continue
    }
    const pinned = valueOf(item, 'Pinned') === null ? null : bare(valueOf(item, 'Pinned'), prefix)
    const isKept = followUpMs > 0
    const follow = pinned === null ? followUpOf(item, items, { now, followUpMs: isKept ? followUpMs : Infinity, prefix }) : null
    const chain = fixChain(item, items)
    const rank = isFix(item) ? 0 : chain.some(one => inFocus.has(valueOf(one, 'Goal'))) ? 1 : 2
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
    ready.push({ id, rank, keptFor: pinned ?? (isKept ? follow?.worker ?? null : null), keptUntil: isKept ? follow?.until ?? null : null, pinned, prefers: isKept ? null : follow?.worker ?? null, ...(added === null ? {} : { added }) })
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

/** The key of a task and a worker the board does not give it to for a while (`skip` of `match`). */
export const pairKey = (id, chat, prefix = '') => `${id} ${plain(chat, prefix)}`

/**
 * Who gets what now: `[{ id, chat, why }]`, each worker and each task at most once. First each kept task (its pin, its
 * follow-up) to its worker when that worker is idle; a kept task whose worker is not idle waits. Then the rest in the
 * list's order, each to the worker it prefers (a follow-up's builder) when that one is idle, else to an idle worker
 * already on its model family, else to the first idle one. A task whose Touches overlap a step given or under way, or
 * one given in this pass, is skipped; so is a task and worker of `skip` (`pairKey`: a give refused, or taken back after
 * its line was held).
 */
export function match({ ready = [], idle = [], items, prefix = '', skip = new Set() }) {
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
  // The recheck: a pinned task is never barred from its own worker (a refusal or a held take-back bars others only).
  const may = (one, worker) => (one.pinned != null && plain(one.pinned, prefix) === plain(worker.name, prefix)) || !skip.has(pairKey(one.id, worker.name, prefix))
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

/** A work line of the board's to a chat about a step (not the sync check's): the line the take is counted from. */
const isWorkLine = (message, id, owner, prefix) => message.command === 'work' && message.about === id && (message.syncKey ?? null) === null
  && plain(message.to, prefix) === plain(owner, prefix) && Number.isFinite(message.at)

/** The why of a take-back of a give whose line never went (`takeBacks`): no stuck mark, and that worker is skipped a while. */
export const HELD_WHY = 'its line was held'

/**
 * The given tasks that go back on the list (principle 2): `[{ id, chat, stuck, why }]`. The clock of a give runs from
 * its newest work line to its Owner (a line of an earlier give is older than its Since and does not count), and never
 * from before `notBefore` (the end of a pause or of a full limit: the board held its lines then).
 * - Not taken `takeWithinMs` after its line: back. `stuck` only when the worker's report is fresh and has said idle
 *   since before that line: it never reacted. A worker that reacted (its report went busy after the line) is waited
 *   for: once it reports idle again without having taken it, the task goes back, not stuck.
 * - No line yet (held for its model, a clear, a mod restart, or its chat went off or unknown before it): a give of the
 *   board's goes back `heldGiveMs` after it, not stuck ("its line was held"), so no give waits for ever.
 * - Its Owner no worker lane of the list (dropped from the app's list for a while, or gone): the same clocks as any:
 *   from the line, else (no line yet) the held limit from the give; never at once.
 */
export function takeBacks({ items, outbox = [], lanes = [], now, takeWithinMs, heldGiveMs = HAND_OUT_DEFAULTS.heldGiveMinutes * 60_000, prefix = '', notBefore = null }) {
  const backs = []
  const workers = lanes.filter(isWorkerLane)
  // A board that reads no worker at all (the app's list of chats could not be read) takes nothing back.
  if (workers.length === 0) return backs
  const floor = Number.isFinite(notBefore) ? notBefore : -Infinity
  const minutesOf = ms => Math.round(ms / 60_000)
  const queued = [...items.values()].filter(item => kindOf(item) === 'step' && stateOf(item) === 'queued' && valueOf(item, 'Owner') !== null)
  for (const item of queued.sort((a, b) => byId(idOf(a), idOf(b)))) {
    const id = idOf(item)
    const owner = bare(valueOf(item, 'Owner'), prefix)
    const givenAt = sinceMs(valueOf(item, 'Since'))
    const line = outbox.filter(message => isWorkLine(message, id, owner, prefix) && !(message.at < givenAt)).sort((a, b) => a.at - b.at).at(-1)
    const lineAt = line === undefined ? null : Math.max(line.at, floor)
    const startAt = Math.max(Number.isFinite(givenAt) ? givenAt : now, floor)
    const lane = workers.find(one => plain(one.name, prefix) === plain(owner, prefix))
    if (lane === undefined) {
      if (lineAt === null ? now - startAt >= heldGiveMs : now - lineAt >= takeWithinMs) backs.push({ id, chat: owner, stuck: false, why: `${owner} is no worker of the list` })
      continue
    }
    if (lineAt === null) {
      // Only a give of the board's (its newest move to queued is the give): a step queued otherwise (the backlog's
      // migration) goes by its line alone.
      const isGive = GIVE_LINE.test(historyOf(item).findLast(one => QUEUED_LINE.test(one)) ?? '')
      if (isGive && now - startAt >= heldGiveMs) backs.push({ id, chat: lane.name, stuck: false, why: `${HELD_WHY} ${minutesOf(heldGiveMs)} min` })
      continue
    }
    if (now - lineAt < takeWithinMs) continue
    const report = lane.report ?? null
    const isFresh = report !== null && lane.isRunning === true && !['unknown', 'off', 'suspended'].includes(lane.state)
    // The recheck: it reacted only when its line itself was taken (or typed) and its turn began after the line; a busy
    // turn of something else while the line still waits (the person typed to it) is no reaction.
    const isTaken = ['taken', 'delivered'].includes(line.state)
    const reacted = isFresh && isTaken && Number.isFinite(report.since) && report.since >= lineAt
    if (reacted && report.state !== 'idle') continue
    const stuck = isFresh && report.state === 'idle' && Number.isFinite(report.since) && report.since < lineAt
    backs.push({ id, chat: lane.name, stuck, why: reacted ? 'not taken in the turn after its line' : `not taken within ${minutesOf(takeWithinMs)} min` })
  }
  return backs
}

/** The recheck: how many times a step was taken back because its line was held (its History). */
export const heldBacksOf = item => historyOf(item).filter(line => HELD_BACK_LINE.test(line)).length

/**
 * The recheck: the words for a task taken back twice because its line was held (an Opus task no worker runs on, the
 * switch never made): said once to the main chat and on the ready list.
 */
export function heldTwiceWords(item) {
  return modelOf(item).family === 'opus'
    ? `${idOf(item)} waits for a worker on Opus: the switch did not happen`
    : `${idOf(item)} was taken back twice: its line was held (a model or effort switch, a clear or a restart did not happen)`
}

/**
 * The tasks and workers the board does not give together for now (`pairKey`): a give the work API refused lately
 * (`refused`, `{ id, chat }`, kept a while by the server), and a give taken back because its line was held, for
 * `heldGiveMs` after the take-back (its History line), so a task held for a worker's model goes to another one.
 */
export function skipPairs({ items, refused = [], now, heldGiveMs = HAND_OUT_DEFAULTS.heldGiveMinutes * 60_000, prefix = '' }) {
  const skip = new Set(refused.map(one => pairKey(one.id, one.chat, prefix)))
  for (const item of items.values()) {
    if (kindOf(item) !== 'step' || stateOf(item) !== 'refined') continue
    for (const line of historyOf(item)) {
      const hit = line.match(HELD_BACK_LINE)
      if (hit !== null && now - sinceMs(hit[1]) < heldGiveMs) skip.add(pairKey(idOf(item), hit[2], prefix))
    }
  }
  return skip
}
const HELD_BACK_LINE = new RegExp(`^-\\s+(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2})\\s+server: queued → refined \\(taken back from (.+?): ${HELD_WHY}\\b`)

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
      if (lane !== undefined && !(lane.report?.at > word.at)) pending += 1
    }
  }
  return pending
}

/**
 * Whether the board asks for one more worker now: `{ start: name }` (a worker of the list whose chat is off, the one off
 * longest first), `{ spawn: 1 }` (a new one), or null. Null when `maxWorkers` is no number (the board starts none),
 * while held (the person pauses, a limit is full), while an idle worker is left after this pass's gives, or when the
 * workers not off are `maxWorkers` already. Only tasks a new worker could take count: ready, kept for nobody (a pinned
 * task waits for its worker only: Review Focus 5), not given in this pass, their Touches overlapping no step given or
 * under way (as `match`); less the workers on their way (`startsPending`).
 * Gap 2 (principle 2: never wait for ever): a ready task pinned to a worker whose chat is off, or unknown for longer than
 * `offAfterMs` by its last report, has that worker started first (`{ start: name, pinned: id }`: a start word, never a
 * spawn; also while another worker is idle), once per START_WAIT_MS, and counted toward `maxWorkers` as any start.
 */
export function workerStart({ ready = [], gives = [], idle = [], lanes = [], maxWorkers = null, isHeld = false, items = new Map(), sent = [], now = Date.now(), prefix = '', refused = [], offAfterMs = Infinity }) {
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
  const isOff = lane => lane.state === 'off' || lane.isRunning === false
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
  if (idle.some(lane => !given.has(lane.name))) return null
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
