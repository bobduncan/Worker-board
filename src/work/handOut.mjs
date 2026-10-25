// Redesign Part 2 (2026-10-24 spec, "The board hands out all work"; plan 2026-10-25): one ordered list of the tasks
// that are ready, and the board gives the first suitable one to a worker the moment it reports idle (principle 1: code
// before chat). This is the pure part: the list (`readyList`), who gets what (`match`), what goes back on the list
// (`takeBacks`), who shows stuck (`stuckWorkers`) and when the board asks for a worker (`workerStart`). The reconciler
// names them (reconcile.mjs), the server carries them out through the work API (deliver.mjs). The code says "step"; the
// person reads "task".

import { readyHold } from './guards.mjs'
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
