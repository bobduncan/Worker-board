// B296: the work store as a shadow of the backlog (spec 2026-10-17, section 3, increment 1). At every refresh the
// server migrates the backlog's text into the store when the text changed (`shadowKeeper`), and the state takes its
// backlog from the store through the adapter (`shadowBacklog`) while the store reads back as the same backlog. The
// backlog file stays the truth: the chats go on editing it, and the board falls back to it whenever the store cannot
// be read or says something else.

import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import { storeAsBacklog, storeProblems } from './adapter.mjs'
import { nextMoves, statesOf } from './flow.mjs'
import { valueOf } from './item.mjs'
import { migrateBacklog } from './migrate.mjs'
import { readStore, readTruth, writeStore } from './store.mjs'

/** How long the store read at a refresh is kept when nothing was written: a hand edit shows within this time. */
const REREAD_MS = 30_000
const NOT_WRITTEN = /no longer on the backlog$/

const hashOf = text => createHash('sha1').update(text).digest('hex')

/**
 * The server's part, one per board: `(backlogText) → work`, called at every refresh. When `canWrite` and the
 * backlog's text changed since the last write, it is migrated and written (only the files whose text changed; an
 * item whose step left the backlog stays, named in `problems`). Then the store is read. A store that says it is the
 * truth is never written over by a shadow. `work` is `readStore`'s answer with `ok: true` and `lastWrite`, or
 * `{ ok: false, why }` when the store cannot be read.
 */
export function shadowKeeper({ dir, canWrite, clock = Date.now, fs, rereadMs = REREAD_MS, readBacklog = null }) {
  let hash = null
  let kept = null
  let readAt = 0
  let lastWrite = null
  // B296 review: one write at a time. `wanted` is the newest text given and not written yet; `writing` the write
  // that runs. A refresh that comes while one runs leaves its text and waits for that write.
  let wanted = null
  let writing = null
  const writeOne = async text => {
    const now = clock()
    const truth = await readTruth(dir, fs)
    // B297: after the cutover the store is the truth and backlog.md its view: the shadow writes nothing.
    if (truth.truth === 'store') {
      lastWrite = { at: now, files: 0, problems: [] }
      hash = hashOf(text)
      return
    }
    const done = await writeStore(dir, migrateBacklog(text, { now }), fs, { now })
    lastWrite = { at: now, files: done.written.length, problems: done.problems }
    // Only what was written counts as written: a write that failed is tried again at the next refresh.
    if (done.problems.every(line => NOT_WRITTEN.test(line))) hash = hashOf(text)
  }
  const flush = async () => {
    while (wanted !== null) {
      const given = wanted
      wanted = null
      // The backlog read anew right before the write, when the board gives a way to: an older text that arrived late
      // never wins over the file as it is.
      const text = readBacklog === null ? given : await readBacklog().then(read => (typeof read === 'string' ? read : given), () => given)
      if (hashOf(text) === hash) continue
      await writeOne(text)
      kept = null
    }
  }
  const keeper = async backlogText => {
    try {
      if (canWrite && typeof backlogText === 'string' && hashOf(backlogText) !== hash) wanted = backlogText
      if (wanted !== null) writing ??= flush().finally(() => {
        writing = null
      })
      if (writing !== null) await writing
      const now = clock()
      if (kept === null || now - readAt >= rereadMs) {
        kept = await readStore(dir, fs)
        readAt = now
      }
      return { ok: true, dir, ...kept, lastWrite }
    } catch (error) {
      kept = null
      return { ok: false, why: `The work store in ${dir} could not be read (${error.code ?? error.message}).` }
    }
  }
  // B297: after a change through the work API the store is read anew at the next refresh, not after the reread time.
  keeper.reset = () => {
    kept = null
  }
  return keeper
}

/** How many steps and activities read differently in two backlogs (an activity more or less counts its steps too). */
export function differences(a, b) {
  const steps = backlog => backlog.activities.flatMap(activity => activity.steps.map(step => ({ activity: activity.name, isFocus: activity.isFocus, ...step })))
  const [left, right] = [steps(a), steps(b)]
  let count = Math.abs(left.length - right.length)
  for (let at = 0; at < Math.min(left.length, right.length); at += 1) if (!isDeepStrictEqual(left[at], right[at])) count += 1
  // B296 review: and each activity whose name or focus reads differently, also one without steps.
  const heads = backlog => backlog.activities.map(one => [one.name, one.isFocus])
  const [up, down] = [heads(a), heads(b)]
  for (let at = 0; at < Math.max(up.length, down.length); at += 1) if (!isDeepStrictEqual(up[at], down[at])) count += 1
  return count
}

/**
 * The state's part: the backlog the board shows and the line about the store. `work` is the keeper's answer
 * (undefined: no store for this board, as the demo); `fromText` the backlog parsed from its file. The store's backlog
 * is shown while it reads back as the same; otherwise the file's, and `store` says why. B297: a store that is the truth
 * is always shown; `differences` then counts the steps of backlog.md (its view) that a hand edit changed.
 */
export function shadowBacklog(work, fromText, rules) {
  if (work === undefined || work === null) return { backlog: fromText, store: null }
  if (work.ok !== true) return { backlog: fromText, store: { mode: 'shadow', ok: false, items: 0, differences: null, problems: [], why: `${work.why} The board shows the backlog.`, failed: true } }
  const problems = [...work.problems.map(one => one.line), ...storeProblems(work.items, work.activities), ...(work.lastWrite?.problems ?? []).filter(line => !NOT_WRITTEN.test(line))]
  const unique = [...new Set(problems)]
  if (!work.exists || work.items.size === 0) return { backlog: fromText, store: { mode: work.truth, ok: false, items: 0, differences: null, problems: unique, why: 'The store has not been written yet: the board shows the backlog.', failed: false } }
  let fromStore
  try {
    fromStore = storeAsBacklog(work.items, work.activities, rules)
  } catch (error) {
    return { backlog: fromText, store: { mode: work.truth, ok: false, items: work.items.size, differences: null, problems: unique, why: `The store could not be read as a backlog (${error.message}): the board shows the backlog.`, failed: true } }
  }
  const count = differences(fromStore, fromText)
  return { backlog: count === 0 || work.truth === 'store' ? fromStore : fromText, store: { mode: work.truth, ok: true, items: work.items.size, differences: count, problems: unique, why: null, failed: false } }
}

/**
 * Where a step of the Backlog tab stands in the flow: `{ states, state, next }` for the strip in its window, or null.
 * `key` is the step's key on the tab: its id, or "<activity's place>:<step's place>" for a step without one.
 */
export function flowOfStep(work, key) {
  if (work === undefined || work === null || work.ok !== true) return null
  const place = String(key).match(/^(\d+):(\d+)$/)
  const id = place === null ? key : work.activities[Number(place[1])]?.steps?.[Number(place[2])]
  const item = id === undefined ? undefined : work.items.get(id)
  if (item === undefined) return null
  const kind = valueOf(item, 'Kind') ?? 'step'
  return { id, states: statesOf(work.flow, kind), state: valueOf(item, 'State'), next: nextMoves(work.flow, item) }
}
