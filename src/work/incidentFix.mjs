// Incident fixes the board queues itself (2026-10-24, the person's choice B: "B, but ensure that the main knows the board
// can do this so it doesnt try to double assign work to a singler worker if it expect it could be free"). That night the
// supervisor's loop (an incident, the Advisor's refined fix step marked priority fix, a worker builds it, the incident
// closes) stalled 9 times at one link: only the main chat queued, and the Advisor's "yours to queue" note did not make
// it act, so every fix sat refined until someone messaged the main chat; twice it put a fix behind a busy worker while
// another was free. Now the board queues such a step itself, once, as the flow's server move "an incident fix is ready".
//
// This is the pure part: which steps the board may queue (`isIncidentFix`), for whom (`autoQueuePlan`, by the board's
// lanes), what the main chat is told (`boardLines`, one information line per placement, never an instruction) and what
// its own queue answer adds (`freshBoardFix`). The reconciler (reconcile.mjs) names the plan, the server carries it out
// (deliver.mjs, the work API's `advance` with `for`).

import { sinceMs, isFix, valueOf } from './item.mjs'

const MIN = 60_000

/** The flow's guard of the board's own queue of an incident fix (flow.mjs DEFAULT_FLOW, guards.mjs). */
export const AUTO_QUEUE_GUARD = 'an incident fix is ready'
/** The main chat's queue answer names a board fix its worker got this recently (the API's `queue` and `requeue`). */
export const BOARD_FIX_FRESH_MS = 10 * MIN
/** A placement of the board's this recent still gets its line to the main chat (a line that could not go is tried again). */
export const BOARD_LINE_MS = 30 * MIN

/** The flow's line that lets the board queue a ready incident fix (DEFAULT_FLOW has it; a project's flow.json may not). */
export const AUTO_QUEUE_MOVE = Object.freeze({ from: 'refined', to: 'queued', by: 'server', when: AUTO_QUEUE_GUARD })

/** Whether the flow lets the board queue a ready incident fix itself: it names the server's move with that guard. */
export const flowQueuesFixes = flow => (flow?.step?.moves ?? []).some(move => move.from === 'refined' && move.to === 'queued'
  && (Array.isArray(move.by) ? move.by : [move.by]).includes('server') && move.when === AUTO_QUEUE_GUARD)

/** The states in which a step is its Owner's work now. */
const HOLDS = ['taken', 'in progress', 'waiting on you']
const byId = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true })
const stateOf = item => valueOf(item, 'State')
const idOf = item => valueOf(item, 'Id')
/** A chat's name without the list's prefix, for comparing. */
const plain = (name, prefix = '') => {
  const words = String(name ?? '').trim()
  return (prefix !== '' && words.toLowerCase().startsWith(prefix.toLowerCase()) ? words.slice(prefix.length) : words).trim().toLowerCase()
}
const pad = n => String(n).padStart(2, '0')
const clockOf = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`

/** "Fix of X4: ...", "Fix of X4, X5", "Fix of X4-X6": the incidents a fix step's title names. */
const FIX_OF = /^Fix of\s+((?:X\d+(?:\s*[-–—]\s*X?\d+)?(?:\s*(?:,|&|\+|\band\b)\s*)?)+)/
/** A range in a title reaches at most this far, so a stray "X1-X99999" names one. */
const RANGE_MOST = 50

/**
 * The incidents a step's title names as the ones it fixes: "Fix of X4: ..." gives X4; a list ("X4, X5") or a range
 * ("X4-X6") gives each. Empty for a title that says nothing of the kind. (The supervisor's cards group by it too.)
 */
export function incidentsNamedBy(title) {
  const found = String(title ?? '').match(FIX_OF)
  if (found === null) return []
  const ids = []
  for (const part of found[1].matchAll(/X(\d+)(?:\s*[-–—]\s*X?(\d+))?/g)) {
    const from = Number(part[1])
    const to = part[2] === undefined ? from : Number(part[2])
    if (to > from && to - from < RANGE_MOST) for (let n = from; n <= to; n += 1) ids.push(`X${n}`)
    else ids.push(`X${from}`)
  }
  return ids
}

/**
 * The incidents the step fixes, not fixed yet: those whose `Fix` names it, then those its title names ("Fix of X<n>")
 * that the store holds. Empty for a step no incident waits on.
 */
export function incidentsFixedBy(items, step) {
  const id = idOf(step)
  const isOpen = item => item !== undefined && valueOf(item, 'Kind') === 'incident' && stateOf(item) !== 'fixed'
  const byFix = [...(items?.values() ?? [])].filter(item => isOpen(item) && valueOf(item, 'Fix') === id).map(idOf)
  const byTitle = incidentsNamedBy(valueOf(step, 'Title')).filter(one => isOpen(items?.get(one)))
  return [...new Set([...byFix.sort(byId), ...byTitle])]
}

/** Whether the step was ever queued: a History line of a move to queued (the main chat's, a kept wish's, the board's). */
export const wasQueued = item => (item.sections?.get('History') ?? []).some(line => / → queued(?:\s|$)/.test(line))

/**
 * A step the board may queue itself, but for what holds it (guards.mjs adds its blockers): a refined step whose refine
 * is ready, marked a board fix, that an incident waits on, with no queue asked before its refine (B303 carries that one
 * out) and never queued before: once only, so a step the main chat took out of a queue stays out.
 */
export function isIncidentFix(item, items) {
  return (valueOf(item, 'Kind') ?? 'step') === 'step' && stateOf(item) === 'refined' && valueOf(item, 'Refined') === 'ready' && isFix(item)
    && valueOf(item, 'Queue when refined') === null && !wasQueued(item) && incidentsFixedBy(items, item).length > 0
}

/** "X4", "X4 and X5", "X4, X5 and X6". */
const named = ids => (ids.length <= 1 ? ids.join('') : `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`)

/** The History words of the board's queue of an incident fix (the work API's `advance` with `for`). */
export const boardQueuedWhat = (chat, incidents) => `queued by the board for ${chat} (incident fix of ${named(incidents)})`

const QUEUED_LINE = /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+server: queued by the board for (.+) \(incident fix of ([^()]*)\)$/
const REQUEUED_LINE = /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+server: requeued for (.+?) \(was [^()]*\)/
/** A History line that gives the step its worker: a queue or a requeue by anyone. */
const PLACED_LINE = /^-\s+\S+ \S+ [^:]+: (?:queued for |requeued for |queued by the board for )/

/**
 * Where the board itself put the step last: `{ chat, at, moved, incidents }` from its newest History line that gave the
 * step a worker, when that line is the board's own: its queue of the incident fix, or (once it queued it) its requeue of
 * it to a free worker (`moved`), with when (`at`, and `stamp` as History wrote it). Null when the step's worker was given by the main chat or the person, or never.
 */
export function boardPlacementOf(item) {
  const history = item.sections?.get('History') ?? []
  const queued = history.map(line => line.match(QUEUED_LINE)).filter(Boolean)
  if (queued.length === 0) return null
  const last = history.findLast(line => PLACED_LINE.test(line))
  const asQueued = last?.match(QUEUED_LINE) ?? null
  const asMoved = asQueued === null ? last?.match(REQUEUED_LINE) ?? null : null
  if (asQueued === null && asMoved === null) return null
  const incidents = (queued.at(-1)[3].match(/X\d+/g) ?? [])
  const found = asQueued ?? asMoved
  return { chat: found[2].trim(), at: sinceMs(found[1]), stamp: found[1], moved: asMoved !== null, incidents }
}

/**
 * Where the board puts the incident fixes that are ready (`fixes`, in id order), one by one: a worker that is free with
 * nothing queued, the one free longest first (running before not running); none such: the worker with the shortest
 * queue that waits for nobody (not the person: its lane does not wait, it holds no step waiting on you; not the limit),
 * running first. The main chat, a leftover and a chat paused for the limit get none. `queueOf(name)` how many steps are
 * queued for a chat; each step placed here counts in its worker's queue for the next. Answers `[{ id, chat, tier }]`
 * (tier 1 free and empty, 2 the shortest queue); a step for which there is no worker is left out.
 */
export function placeFixes(fixes, { lanes = [], steps = [], prefix = '', now = Date.now() }) {
  const workers = lanes.filter(lane => lane.isLeftover !== true && lane.isMain !== true)
  const mine = (lane, states) => steps.filter(item => states.includes(stateOf(item)) && plain(valueOf(item, 'Owner'), prefix) === plain(lane.name, prefix))
  const given = new Map()
  const queueOf = lane => mine(lane, ['queued']).length + (given.get(lane.name) ?? 0)
  const running = lane => Number(lane.isRunning !== false)
  const freeSince = lane => (Number.isFinite(lane.idle?.since) ? lane.idle.since : now)
  const placed = []
  for (const fix of fixes) {
    const free = workers.filter(lane => lane.state === 'free' && mine(lane, HOLDS).length === 0 && queueOf(lane) === 0)
      .sort((a, b) => running(b) - running(a) || freeSince(a) - freeSince(b) || byId(a.name, b.name))
    const waitsForNobody = lane => lane.state !== 'waiting' && lane.state !== 'suspended' && mine(lane, ['waiting on you']).length === 0
    const shortest = workers.filter(waitsForNobody)
      .sort((a, b) => queueOf(a) - queueOf(b) || running(b) - running(a) || byId(a.name, b.name))
    const lane = free[0] ?? shortest[0]
    if (lane === undefined) continue
    given.set(lane.name, (given.get(lane.name) ?? 0) + 1)
    placed.push({ id: idOf(fix), chat: lane.name, tier: free[0] === undefined ? 2 : 1 })
  }
  return placed
}

/** The board fixes queued for `chat` before the step (fixFirst: fixes first, each in id order): what it goes after. */
export function fixesAhead(steps, id, chat, prefix = '') {
  return steps.filter(item => stateOf(item) === 'queued' && isFix(item) && idOf(item) !== id && byId(idOf(item), id) < 0
    && plain(valueOf(item, 'Owner'), prefix) === plain(chat, prefix)).map(idOf).sort(byId)
}

/**
 * The main chat's one information line about a placement of the board's: "The board queued B541 (incident fix of X4)
 * for Worker 2, first in its queue." (`moved`: the board moved it to a free worker). It asks nothing of the main chat.
 */
export function boardQueuedWords({ id, chat, incidents, ahead = [], moved = false }) {
  const where = ahead.length === 0 ? 'first in its queue' : `in its queue after the board fix${ahead.length === 1 ? '' : 'es'} ${named(ahead)}`
  const what = `${id} (incident fix of ${named(incidents)})`
  return `${moved ? `The board moved ${what} to ${chat}` : `The board queued ${what} for ${chat}`}, ${where}. Information only: nothing to do.`
}

/** The key under which the main chat's line about a placement goes once: the step, its worker, when it got it (History's stamp). */
export const boardLineKey = (id, chat, since) => `board-queued ${id} ${chat} ${since ?? ''}`.trim()

/**
 * The lines the main chat is owed (the reconciler; deliver.mjs sends each once by its `key`): one per placement of the
 * board's of the last BOARD_LINE_MS whose step is still that worker's (queued, taken or under way). `main` the main
 * chat's lane name, or null (no lines). `[{ id, chat, worker, key, text }]`.
 */
export function boardLines({ steps = [], main = null, prefix = '', now = Date.now() }) {
  if (main === null) return []
  const lines = []
  for (const item of steps) {
    if (!['queued', ...HOLDS].includes(stateOf(item))) continue
    const placed = boardPlacementOf(item)
    if (placed === null || !(now - placed.at < BOARD_LINE_MS) || plain(valueOf(item, 'Owner'), prefix) !== plain(placed.chat, prefix)) continue
    const id = idOf(item)
    const text = boardQueuedWords({ id, chat: placed.chat, incidents: placed.incidents, ahead: fixesAhead(steps, id, placed.chat, prefix), moved: placed.moved })
    lines.push({ id, chat: main, worker: placed.chat, key: boardLineKey(id, placed.chat, placed.stamp), text })
  }
  return lines
}

/**
 * What the main chat's queue (or requeue) for `chat` is told when the board gave that worker an incident fix in the last
 * BOARD_FIX_FRESH_MS (still queued or under way for it): "Worker 2 got B541, a board fix, at 21:40; your step goes
 * after it". Null when it did not. The queue is not refused.
 */
export function freshBoardFix(items, chat, { prefix = '', now = Date.now(), except = null } = {}) {
  const got = [...(items?.values() ?? [])]
    .filter(item => (valueOf(item, 'Kind') ?? 'step') === 'step' && idOf(item) !== except && ['queued', ...HOLDS].includes(stateOf(item))
      && plain(valueOf(item, 'Owner'), prefix) === plain(chat, prefix))
    .map(item => ({ id: idOf(item), placed: boardPlacementOf(item) }))
    .filter(one => one.placed !== null && plain(one.placed.chat, prefix) === plain(chat, prefix) && now - one.placed.at < BOARD_FIX_FRESH_MS)
    .sort((a, b) => b.placed.at - a.placed.at || byId(a.id, b.id))[0]
  return got === undefined ? null : `${chat} got ${got.id}, a board fix, at ${clockOf(got.placed.at)}; your step goes after it.`
}
