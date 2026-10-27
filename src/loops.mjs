// B404: the board's background loops (the look, the reconciler, approve-recaps, the check after a report, ...) used to
// swallow their errors: one that kept failing stopped delivery while the page looked healthy. Each loop now runs
// through `loops.run(name, fn)`, which keeps its last success, its last error and how many runs failed in a row, and
// writes each new error to a log file; `loops.failing()` is what the page shows in its head ("delivery failing since
// 23:10"). A loop that throws is never stopped: its next run goes on as before.

import { appendFile, mkdir, stat, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

/** The words the page uses for each loop. A loop without one is shown by its name. */
export const LOOP_WORDS = {
  look: 'the board\'s look',
  reconcile: 'delivery',
  'approve-recaps': 'approving recaps',
  check: 'the check after a report',
  'stuck-checks': 'running a stuck check again',
  measure: 'measuring the tasks',
  cpu: 'CPU for Claude',
  request: 'answering the page',
  // B446: after a chat's checked, and the pictures of an idea.
  guard: 'the goal guard',
  // B528: an evaluation that has not ended, asked of the partner again.
  'evaluate-again': 'asking an evaluation again',
  'goal-demo': 'asking the partner for the goal demo',
  picture: 'making a picture',
  // B467: reads that were taken for "nothing there" when they failed. `evaluations` runs on a move on the Focus page
  // and shows until the next move reads them; the last three are read once, at the start, and show until the board
  // starts again.
  evaluations: 'reading the evaluations that run',
  'chat-list': 'reading the list of chats for the CPU',
  // B465: the board's list of stuck states (the supervisor's repair rules, src/supervisor).
  sync: 'the board\'s sync check',
  // The supervisor (spec 2026-10-24): its findings filed as incidents, and the incidents whose fix is done.
  incidents: 'filing the supervisor\'s incidents',
  'incidents-fixed': 'marking the fixed incidents',
  // Part 2: the sweep of the supervisor's chat, its schedule and Check now.
  sweep: 'the supervisor\'s sweep',
  'app-folder': 'following the app\'s folder',
  'design-kinds': 'reading the kinds of idea',
  history: 'reading the other board\'s task times',
  'bridge-note': 'telling the chats where the board is',
  // B640: the newest limit readings of the chats, kept with the project.
  'limit-readings': 'keeping the limit readings',
  // T9.3 part 1: whether each kind of asset's provider can work.
  providers: 'checking the asset providers',
  // B454: the board's look at its own new version.
  'self-update': 'starting the new version by itself',
}

/** The page's words for a loop; `check:<id>` is the check after the report of that step. */
export const wordsOf = name => LOOP_WORDS[name] ?? (String(name).startsWith('check:') ? `the check of ${String(name).slice(6)}` : name)

/** At most this many bytes in the log file; a larger one is moved to `<file>.1` (one older file is kept). */
export const LOG_MAX_BYTES = 1_000_000

const messageOf = error => (error instanceof Error ? error.message : String(error))
const firstLine = error => messageOf(error).split('\n')[0].trim()

/** One line of the log file: the time (UTC), the loop, the error's first line. */
export function logLine(at, name, error) {
  return `${new Date(at).toISOString()} ${name}: ${firstLine(error).slice(0, 500)}\n`
}

/**
 * B446: an error's words without their random part, to tell a new error from the same one again: the name of a file
 * written beside its place (`<file>.<pid>.<random>.tmp`, write.mjs `besideOf`) differs on every run.
 */
export const errorKey = message => String(message).replace(/\.\d+\.[0-9a-f]{8}\.tmp\b/g, '.tmp')

/** B446: one error for a failure and the failure of what was done after it (`what`), in both their words. */
export const afterError = (error, later, what) => new Error(`${firstLine(error)}; ${what}: ${firstLine(later)}`, { cause: error })

/** B446: an error with what it was about first (a step's id), for a loop that runs for many. */
export const aboutError = (about, error) => new Error(`${about}: ${firstLine(error)}`, { cause: error })

/** Writes a line to the log file, moving a full one aside first; never throws. */
export function fileLog(file, { maxBytes = LOG_MAX_BYTES } = {}) {
  let queue = Promise.resolve()
  return line => {
    queue = queue.then(async () => {
      await mkdir(dirname(file), { recursive: true })
      const size = await stat(file).then(one => one.size, () => 0)
      if (size + line.length > maxBytes) await rename(file, `${file}.1`).catch(() => {})
      await appendFile(file, line)
    }).catch(() => {})
    return queue
  }
}

/**
 * The record of the loops. `now` is the clock; `write(line)` takes a log line (fileLog, or a test's list). A failing
 * loop's line is written when its error is new (another message than the last, its random part aside: `errorKey`), so
 * a loop failing every refresh writes once, not every few seconds; after a success, its next failure is new again.
 */
export function loopRecord({ now = Date.now, write = () => {} } = {}) {
  const loops = new Map()
  // B446: the words (without their random part) of each loop's last line in the log, until it succeeds again.
  const logged = new Map()
  const of = name => {
    if (!loops.has(name)) loops.set(name, { name, lastOk: null, lastError: null, errorAt: null, failingSince: null, failures: 0, runs: 0 })
    return loops.get(name)
  }

  /** Notes a failure of `name` (also for a loop that does not run through run()). */
  function failed(name, error) {
    const one = of(name)
    const message = firstLine(error).slice(0, 300) || 'unknown error'
    const at = now()
    if (one.failures === 0) one.failingSince = at
    one.failures += 1
    if (logged.get(name) !== errorKey(message)) write(logLine(at, name, message))
    logged.set(name, errorKey(message))
    one.lastError = message
    one.errorAt = at
  }

  /** Notes a success of `name`: the loop is healthy again. */
  function succeeded(name) {
    const one = of(name)
    one.lastOk = now()
    one.failures = 0
    one.failingSince = null
    // B446: the same error after a success is a new failure, and logged again.
    logged.delete(name)
  }

  /** Runs `fn` as loop `name`: its outcome is recorded; it never throws. Answers fn's value, or undefined on an error. */
  async function run(name, fn) {
    of(name).runs += 1
    try {
      const value = await fn()
      succeeded(name)
      return value
    } catch (error) {
      failed(name, error)
      return undefined
    }
  }

  /** Every loop, as kept. */
  const all = () => [...loops.values()].map(one => ({ ...one }))

  /** The loops whose last run failed, for the page: `{ name, words, since, error, failures }` each, oldest first. */
  const failing = () => all().filter(one => one.failures > 0)
    .map(one => ({ name: one.name, words: wordsOf(one.name), since: one.failingSince, error: one.lastError, failures: one.failures }))
    .sort((a, b) => a.since - b.since)

  return { run, failed, succeeded, all, failing }
}

/** The head's one line for the failing loops, or null when none fails: "Delivery failing since 23:10 (…)". */
export function failingLine(failing, timeOf) {
  if (!Array.isArray(failing) || failing.length === 0) return null
  const [first, ...more] = failing
  const words = String(first.words ?? first.name)
  const lead = `${words.charAt(0).toUpperCase()}${words.slice(1)} failing since ${timeOf(first.since)}`
  return `${lead}${first.error ? ` (${first.error})` : ''}${more.length === 0 ? '' : `; also ${more.map(one => one.words ?? one.name).join(', ')}`}`
}

/**
 * B404: waits for `pending` (the reconciler's pass, the running checks) to settle, at most `ms`; answers whether they
 * all did in time. A restart waits on it before the board ends. `sleep` is the clock's wait (a test's own).
 */
export async function settleWithin(pending, ms, sleep = wait => new Promise(done => setTimeout(done, wait))) {
  const all = Promise.allSettled(pending.filter(Boolean)).then(() => true)
  return Promise.race([all, sleep(ms).then(() => false)])
}
