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
 * F56: `landing`, the landing lock as `lockHolder` reads it (or null): a run of a landing gate's folder (`<temp>/land-gate-xxxxxxxx`,
 * tools/land.ps1) is read as the lock's branch (`asLandingRun`), so a worker that waits for its own landing gate is no stale checkpoint.
 */
export function readTestQueue({ tool, env = process.env, now = Date.now(), runs = tool.pidRuns, read = readFileSync, list = readdirSync, landing = null }) {
  return collectTestQueue({ tool, env, now, runs, read, list }).map(run => asLandingRun(run, landing))
}

function collectTestQueue({ tool, env, now, runs, read, list }) {
  const { BEAT_STALE_MS, TICKET_MAX_AGE_MS, lockPath, orderEntry, queueOrder, slotCountOf, slotPath, slotsOf, whyStale } = tool
  const file = lockPath(env)
  const found = []
  const running = []
  for (let n = 1, count = slotCountOf(file, slotsOf(env)); n <= count; n += 1) {
    const info = readRun(slotPath(file, n), read)
    if (info !== null && whyStale(info, now, runs) === null) running.push(info)
  }
  // F39: a holder's `startedAt` moves with every beat; `since` keeps when it took the slot.
  for (const info of running) found.push({ cwd: info.cwd ?? '', label: info.label ?? '', state: 'running', since: Date.parse(info.since ?? info.startedAt), ahead: 0 })
  // F39: a ticket whose process is gone, whose beat is older than 5 minutes, or an old copy's (no beat) older than 3 hours is dropped by the
  // runs themselves; here it is only left out, never removed.
  const live = info => {
    const beat = Date.parse(info.beat)
    return runs(info.pid) && (Number.isFinite(beat) ? now - beat <= BEAT_STALE_MS : now - Date.parse(info.startedAt) <= TICKET_MAX_AGE_MS)
  }
  const ticketsOf = folder => {
    try {
      return list(folder).filter(name => name.endsWith('.json')).sort()
        .map(name => ({ name, info: readRun(path.join(folder, name), read) }))
        .filter(one => one.info !== null && live(one.info))
    } catch {
      return []
    }
  }
  const tickets = ticketsOf(`${file}.queue`)
  // P4: each ticket as the helper itself reads it (its orderEntry: a settling run goes after every gate), so the view shows the order runs go in.
  const order = queueOrder(tickets.map(one => orderEntry(one.name, one.info)))
  // In the order they go (F39's queueOrder), not the order of the file names.
  for (const { name, info } of order.map(one => tickets.find(ticket => ticket.name === one.name))) {
    // A run that already holds a slot has left the queue (its ticket goes when it takes its turn): not counted twice.
    if (running.some(one => one.pid === info.pid)) continue
    // P4, core review 4: a run that gave way to a gate waits since it first came, and says how often it gave way.
    found.push({ cwd: info.cwd ?? '', label: info.label ?? '', state: 'waiting', since: Date.parse(info.gaveWaySince ?? info.startedAt), ahead: running.length + order.findIndex(one => one.name === name), ...gaveWayOf(info) })
  }
  // S3: the runs that wait for an idle PC (the tool's idle room), after every ticket, oldest first: `idle` marks them, and `since` is
  // when they came, so the board can say "waiting for an idle PC since 14:02". One that holds a slot or stands in the queue for its
  // one look is counted there.
  if (typeof tool.idleRoomOf === 'function') {
    const idle = ticketsOf(tool.idleRoomOf(file)).filter(one => !running.some(run => run.pid === one.info.pid) && !tickets.some(ticket => ticket.info.pid === one.info.pid))
    idle.forEach(({ info }, index) => {
      found.push({ cwd: info.cwd ?? '', label: info.label ?? '', state: 'waiting', idle: true, since: Date.parse(info.gaveWaySince ?? info.startedAt), ahead: running.length + order.length + index, ...gaveWayOf(info) })
    })
  }
  return found
}

/** P4: how often a waiting run gave way to a gate in a row (its ticket's `gaveWay`), as `{ gaveWay }`, or nothing. */
const gaveWayOf = info => (Number.isInteger(info?.gaveWay) && info.gaveWay > 0 ? { gaveWay: info.gaveWay } : {})

/** F56: the folder of a landing's gate, as tools/land.ps1 names it in the temp folder: `land-gate-` and 8 hex characters. */
export const LAND_GATE = /^land-gate-[0-9a-f]{8}$/

/**
 * F56: a run whose folder is a landing gate's (no step's folder matches it) is read as the landing lock's `branch` (`landing`, as
 * src/landing.mjs `lockHolder` gives it): its `cwd` becomes the branch, so `isFolderOf` finds the step id in it (b1442-sandbox is
 * B1442's), and `gate` keeps the folder. Without a lock, or a lock whose branch is not known, the run is as it was; a branch without a
 * step id stays unmatched. Any other run is as it was. PURE.
 */
export function asLandingRun(run, landing) {
  if (!LAND_GATE.test(baseOf(run?.cwd))) return run
  const branch = typeof landing?.branch === 'string' ? landing.branch.trim() : ''
  if (branch === '' || branch === 'unknown') return run
  return { ...run, cwd: branch, gate: run.cwd }
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
