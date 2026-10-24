// B301: the work store as the board reads it (spec 2026-10-17, section 3). The store is the one source of the work: the
// board draws the backlog, the queues and the asks from it, and from nothing else. A store that is not there or cannot
// be read is said in one line on top of the board, naming the folder and what to run; nothing is drawn from the
// backlog file instead (the person, 2026-10-17: "I want to prevent confusing behavior. I rather have it fail.").

import { storeAsBacklog, storeProblems } from './adapter.mjs'
import { DEFAULT_FLOW, nextMoves, statesOf } from './flow.mjs'
import { isFix, valueOf } from './item.mjs'
import { migrateBacklog } from './migrate.mjs'
import { stepWaitsForPartner } from './partnerAnswers.mjs'
import { effortOf, modelOf } from './effort.mjs'
import { checkedOf, reviewWaitOf } from './resultCheck.mjs'
import { refineAsksOf } from './stepAsks.mjs'
import { readStore } from './store.mjs'

/** How long a read of the store is kept when nothing changed it through the board: a hand edit shows within this time. */
const REREAD_MS = 30_000

/**
 * The server's reader, one per board: `() → work`, called at every refresh. `work` is `readStore`'s answer with `ok:
 * true` and `dir` (also for a folder that is not there: `exists: false`), or `{ ok: false, dir, code }` when the folder
 * cannot be read. A good read is kept for `rereadMs`; `reset()` (after a change through the work API) drops it. A
 * failed read is never kept: the next refresh tries again.
 */
export function storeKeeper({ dir, clock = Date.now, fs, rereadMs = REREAD_MS }) {
  let kept = null
  let readAt = 0
  const keeper = async () => {
    const now = clock()
    if (kept !== null && now - readAt < rereadMs) return kept
    try {
      kept = { ok: true, dir, ...(await readStore(dir, fs)) }
      readAt = now
      return kept
    } catch (error) {
      kept = null
      return { ok: false, dir, code: error?.code ?? error?.message ?? 'unknown' }
    }
  }
  keeper.reset = () => {
    kept = null
  }
  return keeper
}

/** A path in a command line: quoted when it holds a space. */
const quoted = path => (/\s/.test(path) ? `"${path}"` : path)

/**
 * B301: what is wrong with the store as a whole, in one line that names its folder and what to run, or null when it can
 * be read. `work` is the keeper's answer (undefined: this board has no store, as one without a project). `backlog` is
 * the backlog file a store can be made from. A broken item file is not this: it is one of `work.problems`, shown as
 * the reconciler's line on top (`workFlags`), and the store is read all the same.
 */
export function storeFault(work, { backlog = null } = {}) {
  if (work === undefined || work === null) return null
  const dir = work.dir ?? 'the work folder'
  if (work.ok !== true) return `The work store ${dir} cannot be read (${work.code}): the board shows no work until it can. Check that it is a folder this board may read, and the setting "work" in the board's config.json.`
  if (work.exists !== true) {
    const make = backlog === null ? '' : `make it from the backlog with "node tools/migrate-backlog.mjs --backlog ${quoted(backlog)} --work ${quoted(dir)} --make-store", or `
    return `No work store in ${dir}: the board shows no work. In the board's folder, ${make}make an empty one with "node tools/migrate-backlog.mjs --work ${quoted(dir)} --init".`
  }
  return null
}

/**
 * B301: the store as the board shows it: the backlog in `parseBacklog`'s shape (the store written as the backlog's text
 * and read by the same reader, see adapter.mjs) and the line about the store under the Backlog tab's head (`store`:
 * `{ ok, dir, items, problems, why, kept }`). A store with a fault gives an empty backlog and its fault as `why`; null
 * for a board without a store.
 */
export function storeBacklog(work, rules, { backlog = null } = {}) {
  const empty = { activities: [] }
  if (work === undefined || work === null) return { backlog: empty, store: null }
  const fault = storeFault(work, { backlog })
  if (fault !== null) return { backlog: empty, store: { ok: false, dir: work.dir ?? null, items: 0, problems: [], why: fault } }
  const problems = [...new Set([...work.problems.map(one => one.line), ...storeProblems(work.items, work.activities)])]
  const kept = work.viewKept ?? null
  return { backlog: withStepAsks(storeAsBacklog(work.items, work.activities, rules), work.items), store: { ok: true, dir: work.dir ?? null, items: work.items.size, problems, why: null, ...(kept === null ? {} : { kept }) } }
}

/**
 * B309: each step with an id carries `stepAsks`, the asks under it that count as its refine questions now
 * (stepAsks.mjs); backlog.mjs folds them into the step's `refined`.
 */
function withStepAsks(backlog, items) {
  for (const step of backlog.activities.flatMap(activity => activity.steps)) {
    const item = step.id === null ? undefined : items.get(step.id)
    step.stepAsks = item === undefined ? [] : refineAsksOf(items, item)
    // Fix first: a step marked as a board fix goes first in its queue and on the Backlog tab, with a chip.
    step.isFix = item !== undefined && isFix(item)
  }
  return backlog
}

/**
 * B301: a store made in memory from a backlog's text, in the shape the keeper answers: for the demo, which has no
 * project folder, and for the tests, whose made-up backlogs are easiest written as text.
 */
export function storeFromText(text, { now = Date.now(), dir = '(in memory)' } = {}) {
  const migrated = migrateBacklog(text, { now })
  return { ok: true, dir, exists: true, items: migrated.items, activities: migrated.activities, preamble: migrated.preamble ?? [], lastIds: {}, flow: DEFAULT_FLOW, problems: [], viewKept: null }
}

/** The store's items when it could be read; else none. */
export const itemsOf = work => (work?.ok === true && work.items instanceof Map ? [...work.items.values()] : [])

/** B299: a step's lines that start "Touches:" (under Context, or a Touches section), each path once. */
export function touchesLines(item) {
  const own = (item.sections.get('Touches') ?? []).map(one => one.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean)
  const said = (item.sections.get('Context') ?? []).flatMap(one => one.trim().match(/^Touches:\s*(.+)$/)?.[1] ?? [])
  return [...new Set([...own, ...said])]
}

/** The item a step of the Backlog tab stands for: `key` is its id, or "<activity's place>:<step's place>". */
function itemAt(work, key) {
  if (work === undefined || work === null || work.ok !== true || !(work.items instanceof Map)) return null
  const place = String(key).match(/^(\d+):(\d+)$/)
  const id = place === null ? key : work.activities[Number(place[1])]?.steps?.[Number(place[2])]
  const item = id === undefined ? undefined : work.items.get(id)
  return item === undefined ? null : { id, item }
}

/**
 * B299: a step of the store as its window shows it: `{ id, title, summary, picture, goal, what, requirements, touches,
 * history }` (lines as written), or null (no store, no such item). `key` as for `flowOfStep`.
 */
export function itemOfStep(work, key) {
  const found = itemAt(work, key)
  if (found === null) return null
  const { id, item } = found
  const section = name => (item.sections.get(name) ?? []).map(one => one.trim()).filter(Boolean)
  return {
    id, title: valueOf(item, 'Title'), summary: section('Summary'), picture: section('Picture')[0] ?? null, goal: valueOf(item, 'Goal'),
    what: section('What we build').map(one => one.replace(/^[-*]\s+/, '')), requirements: section('Requirements').map(one => one.replace(/^[-*]\s+/, '')),
    touches: touchesLines(item), history: section('History').map(one => one.replace(/^[-*]\s+/, '')),
    // B303: the queue the main chat asked before the step's refine, or null.
    queueWhenRefined: valueOf(item, 'Queue when refined'),
    // B356: its last result check (the evidence, the ticks, the score), and the step it fixes.
    checked: checkedOf(item), fixOf: valueOf(item, 'Fix of'), attempts: Number(valueOf(item, 'Attempts') ?? 0),
    // B468: the effort its worker runs at (medium when its refine gave none), and who holds it in which state. Model per
    // step: and the model (sonnet when its refine gave none).
    effort: effortOf(item), model: modelOf(item), owner: valueOf(item, 'Owner'), state: valueOf(item, 'State'),
  }
}

/**
 * B543: what a step in review waits for, in words for its line on the Backlog tab ("waits for its fix B<n>", "waits for
 * its first check", ...), or null (not in review, or nothing to say). `key` as for `flowOfStep`.
 */
export function reviewWaitOfStep(work, key) {
  const found = itemAt(work, key)
  return found === null ? null : reviewWaitOf(found.item, work.items)?.text ?? null
}

/**
 * B425: a step's Context lines as written, for the window of the worker on it: without the line that says where its
 * refine block stands. Empty without the store or the step.
 */
export function contextOfStep(work, key) {
  const found = itemAt(work, key)
  if (found === null) return []
  return (found.item.sections.get('Context') ?? []).map(one => one.trim()).filter(one => one !== '' && !/^\(the refine block stands\b/i.test(one))
}

/**
 * Where a step of the Backlog tab stands in the flow: `{ states, state, next }` for the strip in its window, or null.
 * `key` is the step's key on the tab: its id, or "<activity's place>:<step's place>" for a step without one.
 */
export function flowOfStep(work, key) {
  const found = itemAt(work, key)
  if (found === null) return null
  const { id, item } = found
  const kind = valueOf(item, 'Kind') ?? 'step'
  // B392: a step whose open blocking asks all wait for the partner says so (`waitsForPartner`, their ids).
  const waitsForPartner = kind === 'step' ? stepWaitsForPartner(item, work.items.values()) : null
  return { id, states: statesOf(work.flow, kind), state: valueOf(item, 'State'), next: nextMoves(work.flow, item), waitsForPartner }
}
