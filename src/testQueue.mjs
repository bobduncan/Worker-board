// B1302 (the fix of X211): a read-only look at the PC's one-heavy-run-at-a-time queue (tools/one-at-a-time.mjs), so a rule can
// tell a worker that waits its turn for a test run from one that is stuck. The tool's lock file, its slot files and its
// `.queue` folder of tickets are read as they are (its own lockPath, slotPath, slotCountOf, whyStale and aheadOf: never a
// copy of them), and nothing is written or removed here: the runs themselves clean up what is stale.

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { aheadOf, lockPath, pidRuns, slotCountOf, slotPath, slotsOf, whyStale } from '../tools/one-at-a-time.mjs'

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
 * there is no queue or it cannot be read. `env`, `now`, `runs` (pidRuns), `read` and `list` are the tests' seams.
 */
export function readTestQueue({ env = process.env, now = Date.now(), runs = pidRuns, read = readFileSync, list = readdirSync } = {}) {
  const file = lockPath(env)
  const found = []
  const running = []
  for (let n = 1, count = slotCountOf(file, slotsOf(env)); n <= count; n += 1) {
    const info = readRun(slotPath(file, n), read)
    if (info !== null && whyStale(info, now, runs) === null) running.push(info)
  }
  for (const info of running) found.push({ cwd: info.cwd ?? '', label: info.label ?? '', state: 'running', since: Date.parse(info.startedAt), ahead: 0 })
  let names = []
  try {
    names = list(`${file}.queue`).filter(name => name.endsWith('.json')).sort()
  } catch {
    return found
  }
  const tickets = names.map(name => ({ name, info: readRun(path.join(`${file}.queue`, name), read) }))
    .filter(one => one.info !== null && runs(one.info.pid))
  const order = tickets.map(one => ({ name: one.name, first: one.info.first === true }))
  for (const { name, info } of tickets) {
    // A run that already holds a slot has left the queue (its ticket goes when it takes its turn): not counted twice.
    if (running.some(one => one.pid === info.pid)) continue
    found.push({ cwd: info.cwd ?? '', label: info.label ?? '', state: 'waiting', since: Date.parse(info.startedAt), ahead: running.length + aheadOf(order, name, info.first === true) })
  }
  return found
}

/** A folder's key for the memory of when it was last seen in the queue: its path, lower case, with "/" (Windows paths match whatever their case or slash). */
export const folderKey = cwd => String(cwd ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** The last part of a folder's path, lower case: `check-b1279`, `worker-board-b1297`. */
const baseOf = cwd => folderKey(cwd).split('/').at(-1) ?? ''

/**
 * Whether a folder is a step's own: its name ends in `-b<id>` or has `-b<id>-` in it (`worker-board-b1302`, `check-b1279`,
 * `check-b1279-before`), for each of `ids` (the step's own and the one a Quality Assurance task checks); the id by whole
 * number, so b12 is not b123's. PURE.
 */
export function isFolderOf(cwd, ids) {
  const base = baseOf(cwd)
  return ids.some(id => typeof id === 'string' && /^b\d+$/i.test(id) && new RegExp(`(?:^|-)${id.toLowerCase()}(?:-|$)`).test(base))
}
