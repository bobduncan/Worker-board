// B1302 (the fix of X211): a read-only look at the PC's one-heavy-run-at-a-time queue (tools/one-at-a-time.mjs), so a rule can
// tell a worker that waits its turn for a test run from one that is stuck. The tool's lock file, its slot files and its
// `.queue` folder of tickets are read as they are (its own lockPath, slotPath, slotCountOf, whyStale and aheadOf: never a
// copy of them), and nothing is written or removed here: the runs themselves clean up what is stale. The tool is handed in
// (`tool`, the module of tools/one-at-a-time.mjs): the server imports it when it reads the queue, so a board folder made
// without tools/ (the tests' copies) simply has no queue to read.

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { namesStep } from './work/stepNames.mjs'

/** What a lock or a ticket file says, `{ pid, label, cwd, startedAt, first }` with a live pid, or null (unreadable, not a run, gone). */
function readRun(file, read) {
  try {
    const info = JSON.parse(read(file, 'utf8'))
    if (Number.isInteger(info?.pid) && info.pid > 0 && Number.isFinite(Date.parse(info.startedAt))) return info
  } catch {
    // gone or not a run's file
  }
  return null
}

/**
 * The runs of the queue now, in the order they go: first the ones that hold a slot (`state: 'running'`), then the tickets
 * (`state: 'waiting'`) in the order the tool serves them. `{ cwd, label, state, since, ahead }` each: `since` the time it
 * began (ms; a ticket's is when it came), `ahead` how many runs go before it (the ones running and the tickets served
 * first; 0 for a run that runs). Only runs whose process lives (a lock the tool calls stale is none); an empty list when
 * there is no queue or it cannot be read. `tool` the tool's module; `env`, `now`, `runs` (pidRuns), `read` and `list` are the tests' seams.
 */
export function readTestQueue({ tool, env = process.env, now = Date.now(), runs = tool.pidRuns, read = readFileSync, list = readdirSync }) {
  const { BEAT_STALE_MS, ORDER_MARK, TICKET_MAX_AGE_MS, lockPath, queueOrder, slotCountOf, slotPath, slotsOf, whyStale } = tool
  const file = lockPath(env)
  const found = []
  const running = []
  for (let n = 1, count = slotCountOf(file, slotsOf(env)); n <= count; n += 1) {
    const info = readRun(slotPath(file, n), read)
    if (info !== null && whyStale(info, now, runs) === null) running.push(info)
  }
  // F39: a holder's `startedAt` moves with every beat; `since` keeps when it took the slot.
  for (const info of running) found.push({ cwd: info.cwd ?? '', label: info.label ?? '', state: 'running', since: Date.parse(info.since ?? info.startedAt), ahead: 0 })
  let names = []
  try {
    names = list(`${file}.queue`).filter(name => name.endsWith('.json')).sort()
  } catch {
    return found
  }
  // F39: a ticket whose process is gone, whose beat is older than 5 minutes, or an old copy's (no beat) older than 3 hours is dropped by the
  // runs themselves; here it is only left out, never removed.
  const live = info => {
    const beat = Date.parse(info.beat)
    return runs(info.pid) && (Number.isFinite(beat) ? now - beat <= BEAT_STALE_MS : now - Date.parse(info.startedAt) <= TICKET_MAX_AGE_MS)
  }
  const tickets = names.map(name => ({ name, info: readRun(path.join(`${file}.queue`, name), read) }))
    .filter(one => one.info !== null && live(one.info))
  const order = queueOrder(tickets.map(one => ({ name: one.name, first: one.info.first === true, fair: one.info.order === ORDER_MARK })))
  // In the order they go (F39's queueOrder), not the order of the file names.
  for (const { name, info } of order.map(one => tickets.find(ticket => ticket.name === one.name))) {
    // A run that already holds a slot has left the queue (its ticket goes when it takes its turn): not counted twice.
    if (running.some(one => one.pid === info.pid)) continue
    found.push({ cwd: info.cwd ?? '', label: info.label ?? '', state: 'waiting', since: Date.parse(info.startedAt), ahead: running.length + order.findIndex(one => one.name === name) })
  }
  return found
}

/** A folder's key for the memory of when it was last seen in the queue: its path, lower case, with "/" (Windows paths match whatever their case or slash). */
export const folderKey = cwd => String(cwd ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** The last part of a folder's path, lower case: `check-b1279`, `worker-board-b1297`. */
const baseOf = cwd => folderKey(cwd).split('/').at(-1) ?? ''

/**
 * Whether a folder is a step's own, by the board's one rule (`namesStep`, src/work/stepNames.mjs: `worker-board-b1302`, `check-b1279`,
 * `check-b1279-before`, `wt-b917b`; b12 is not b123's), for each of `ids` (the step's own and the one a Quality Assurance task checks). PURE.
 */
export function isFolderOf(cwd, ids) {
  const base = baseOf(cwd)
  return ids.some(id => namesStep(base, id))
}
