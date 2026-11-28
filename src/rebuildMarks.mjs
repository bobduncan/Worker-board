// B1579 (X93, the rest after B1535): the marks of each state rebuild's parts on the event loop, so a loop stall left over reads which
// part of the rebuild held the loop (or that none did, and another job did). A part that runs in one synchronous block (the copy into
// the thread, the state's copy back, the light rows, the /api/state JSON) is timed by its own clock; a part that awaits (reading the
// sources, the assets) by the loop's busy time while it ran (`performance.eventLoopUtilization`), which counts whatever else ran on
// the loop then, so it is an upper bound. The newest MOST_REBUILDS are kept in memory (`recent()`); with a log file (the measure:
// WORKER_BOARD_PARTS_LOG) each rebuild is written as one JSON line too. PURE but for the clocks and the file, which are handed in.

import { appendFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

/** How many rebuilds' marks are kept. */
export const MOST_REBUILDS = 30
/** A part that held the loop less than this is not named as a stall's holder. */
export const HOLD_MIN_MS = 100

/** The parts, as the rule board-slow names them. */
export const PART_WORDS = {
  app: 'the app\'s folder and account',
  sources: 'reading the sources',
  assets: 'reading the asset requests',
  copyIn: 'the copy into the thread',
  build: 'the build in the loop',
  copyBack: 'the state\'s copy back',
  after: 'the work after the build',
  light: 'the light rows',
  json: 'the state\'s JSON',
}

/**
 * The marks: `begin()` answers one rebuild's `{ sync(part, fn), async part(part, fn), mark(part, ms), end() }`; `light(ms)` and
 * `json(ms)` add a part of /api/state to the newest rebuild. `recent()`: `[{ from, to, parts: { part: loopMs } }]`, oldest first.
 */
export function rebuildMarks({ now = Date.now, clock = () => performance.now(), busy = prev => performance.eventLoopUtilization(prev), most = MOST_REBUILDS, logFile = null, append = appendFile } = {}) {
  const kept = []
  const add = (one, part, ms) => {
    if (!Number.isFinite(ms) || ms < 0) return
    one.parts[part] = Math.round((one.parts[part] ?? 0) + ms)
  }
  return {
    begin() {
      const one = { from: now(), to: null, parts: {} }
      return {
        sync(part, fn) {
          const at = clock()
          try {
            return fn()
          } finally {
            add(one, part, clock() - at)
          }
        },
        async part(part, fn) {
          const was = busy()
          try {
            return await fn()
          } finally {
            add(one, part, busy(was).active)
          }
        },
        mark: (part, ms) => add(one, part, ms),
        end() {
          if (one.to !== null) return
          one.to = now()
          kept.push(one)
          while (kept.length > most) kept.shift()
          if (logFile !== null) void append(logFile, `${JSON.stringify(one)}\n`).catch(() => {})
        },
      }
    },
    /** A part of /api/state (the light rows, its JSON), added to the newest rebuild it read; written to the log as its own line. */
    after(part, ms, at = now()) {
      const one = kept.at(-1)
      if (one === undefined || !Number.isFinite(ms)) return
      add(one, part, ms)
      if (Number.isFinite(at) && at > one.to) one.to = at
      if (logFile !== null && ms >= 1) void append(logFile, `${JSON.stringify({ at, [part]: Math.round(ms) })}\n`).catch(() => {})
    },
    recent: () => kept.map(one => ({ ...one, parts: { ...one.parts } })),
  }
}

/**
 * Which rebuild part held the loop during a loop stall `{ at, ms }` (`marks`: `recent()`): the part with the most loop time of a
 * rebuild that ran during the stall, when it held the loop at least HOLD_MIN_MS; null when none did (another job held it). PURE.
 */
export function heldBy(stall, marks) {
  if (!Number.isFinite(stall?.at) || !Number.isFinite(stall?.ms)) return null
  const from = stall.at - stall.ms
  let best = null
  for (const one of Array.isArray(marks) ? marks : []) {
    const to = Number.isFinite(one?.to) ? one.to : Infinity
    if (!Number.isFinite(one?.from) || one.from > stall.at || to < from) continue
    for (const [part, ms] of Object.entries(one.parts ?? {})) {
      if (Number.isFinite(ms) && ms >= HOLD_MIN_MS && (best === null || ms > best.ms)) best = { part, ms }
    }
  }
  return best
}

/** Each loop stall of `stalls` with `held` (`heldBy`: the rebuild part that held the loop then, or null); the others as they are. PURE. */
export function withHolds(stalls, marks) {
  return (Array.isArray(stalls) ? stalls : []).map(one => (one?.kind === 'loop' ? { ...one, held: heldBy(one, marks) } : one))
}
