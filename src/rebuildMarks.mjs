// B1579 (X93, the rest after B1535): the marks of each state rebuild's parts on the event loop, so a loop stall left over reads which
// part of the rebuild held the loop (or that none did, and another job did). A part that runs in one synchronous block (the copy into
// the thread, the state's copy back, the light rows, the /api/state JSON) is timed by its own clock and kept as a BLOCK: when it ran and
// how long. Only a block can hold a stall (review lens 2): a part that awaits (reading the facts, the assets, the work after the build,
// a build in the loop) is timed by the loop's busy time while it ran (`performance.eventLoopUtilization`), which counts whatever else
// blocked the loop then, so it is kept for the measure only and never named as a holder. The blocks of the last KEEP_MS are kept
// (`blocks()`), each rebuild's sums of the newest MOST_REBUILDS (`recent()`); with a log file (the measure: WORKER_BOARD_PARTS_LOG) each
// rebuild and each page part is written as one JSON line too. PURE but for the clocks and the file, which are handed in.

import { appendFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

/** How many rebuilds' sums are kept. */
export const MOST_REBUILDS = 30
/** How long the blocks are kept: the rule board-slow looks back 10 minutes. */
export const KEEP_MS = 10 * 60_000
/** At most this many blocks are kept (a rebuild makes about four, a poll two). */
export const MOST_BLOCKS = 5000
/** A block shorter than this holds no stall. */
export const HOLD_MIN_MS = 100
/** The stall log's timer runs every 500 ms (stalls.mjs TICK_MS): a stall began up to this long before `at - ms`. */
export const TICK_SLACK_MS = 500

/** The parts, as the rule board-slow names them after "the state rebuild's". */
export const PART_WORDS = {
  app: 'app folder and account',
  sources: 'fact reading',
  assets: 'asset reading',
  store: 'store read in the loop',
  copyIn: 'copy into the thread',
  build: 'build in the loop',
  copyBack: 'copy back',
  after: 'work after the build',
  light: 'light rows',
  json: 'JSON',
}

/**
 * The marks: `begin()` answers one rebuild's `{ sync(part, fn), async part(part, fn), block(part, ms), busy(part, ms), end() }`;
 * `after(part, ms)` is a block of /api/state (its light rows, its JSON). `recent()`: `[{ from, to, parts: { part: loopMs } }]`, oldest
 * first; `blocks()`: `[{ part, at, ms }]` (`at` when the block began), oldest first.
 */
export function rebuildMarks({ now = Date.now, clock = () => performance.now(), busy = prev => performance.eventLoopUtilization(prev), most = MOST_REBUILDS, keepMs = KEEP_MS, logFile = null, append = appendFile } = {}) {
  const kept = []
  let spans = []
  const add = (one, part, ms) => {
    if (!Number.isFinite(ms) || ms < 0) return
    one.parts[part] = Math.round((one.parts[part] ?? 0) + ms)
  }
  const keepBlock = (part, ms, end = now()) => {
    if (!Number.isFinite(ms) || ms < 0) return
    spans.push({ part, at: Math.round(end - ms), ms: Math.round(ms) })
    if (spans.length > MOST_BLOCKS || end - spans[0].at > keepMs) spans = spans.filter(one => end - one.at <= keepMs).slice(-MOST_BLOCKS)
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
            const ms = clock() - at
            add(one, part, ms)
            keepBlock(part, ms)
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
        /** A block of `ms` that just ended (the copy into the thread, the state's copy back). */
        block(part, ms) {
          add(one, part, ms)
          keepBlock(part, ms)
        },
        /** The loop's busy time of a part that awaited (a build in the loop): measured, never a holder. */
        busy: (part, ms) => add(one, part, ms),
        end() {
          if (one.to !== null) return
          one.to = now()
          kept.push(one)
          while (kept.length > most) kept.shift()
          if (logFile !== null) void append(logFile, `${JSON.stringify(one)}\n`).catch(() => {})
        },
      }
    },
    /** A block of /api/state (the light rows, its JSON), kept as one block of its own; written to the log as a line of its own. */
    after(part, ms, at = now()) {
      if (!Number.isFinite(ms)) return
      keepBlock(part, ms, at)
      if (logFile !== null && ms >= 1) void append(logFile, `${JSON.stringify({ at, [part]: Math.round(ms) })}\n`).catch(() => {})
    },
    recent: () => kept.map(one => ({ ...one, parts: { ...one.parts } })),
    blocks: () => spans.map(one => ({ ...one })),
  }
}

/**
 * Which block held the loop during a loop stall `{ at, ms }` (`blocks`: `blocks()`): the longest block of at least HOLD_MIN_MS that
 * ran within the stall (it began after the timer's last run, `at - ms - TICK_SLACK_MS`, and before `at`); null when none did: another
 * job held the loop. PURE.
 */
export function heldBy(stall, blocks, slackMs = TICK_SLACK_MS) {
  if (!Number.isFinite(stall?.at) || !Number.isFinite(stall?.ms)) return null
  const from = stall.at - stall.ms - slackMs
  let best = null
  for (const one of Array.isArray(blocks) ? blocks : []) {
    if (!Number.isFinite(one?.at) || !Number.isFinite(one?.ms) || one.ms < HOLD_MIN_MS) continue
    if (one.at + one.ms < from || one.at > stall.at) continue
    if (best === null || one.ms > best.ms) best = { part: one.part, ms: one.ms }
  }
  return best
}

/** Each loop stall of `stalls` with `held` (`heldBy`: the block that held the loop then, or null); the others as they are. PURE. */
export function withHolds(stalls, blocks) {
  return (Array.isArray(stalls) ? stalls : []).map(one => (one?.kind === 'loop' ? { ...one, held: heldBy(one, blocks) } : one))
}
