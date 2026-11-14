// F10 (2026-11-14): what the watcher does for one board, as a pure decision (tools/watch-boards.mjs runs it every 5 minutes from a
// Windows scheduled task). The table of the design note (.claude/plans/2026-11-11-boards-survive-app-updates-design.md, part 2,
// with chat 1's guards): the board answers: nothing. A keeper of the folder runs with no answer yet: nothing (it is starting, or its
// child retries the port); the third such look in a row gets one log line, never a second keeper (G7). A fresh landing lock: nothing
// (land.ps1 restarts the boards itself). A stop sign `why: 'stopped'` that is current: nothing (stopped on purpose). The sign is
// current only when it is newer than the last boot and was written by the board started last (G4: a Windows restart ends node with
// code 0 and leaves a 'stopped' sign; land.ps1's cold restart has the old board write its sign after the new keeper started: both
// are stale). A sign `why: 'crash'` (the keeper gave up): a start, at most STARTS_PER_HOUR per board per hour, then "left alone until".
// No sign, no keeper, no answer (killed: the app's update): a start. A board that never ran here (no data/started.json: a listed
// board nobody started this season) is left alone: the watcher brings back what ran, it starts nothing new.

/** How many starts after crashes the watcher makes per board within STARTS_WITHIN_MS before it leaves the board alone. */
export const STARTS_PER_HOUR = 3
export const STARTS_WITHIN_MS = 60 * 60_000
/** A keeper that runs while the board does not answer: after this many looks in a row the watcher says so, once. */
export const SILENT_LOOKS = 3
/** A landing lock younger than this is a landing's; land.ps1 breaks an older one. */
export const LOCK_FRESH_MS = 15 * 60_000

/**
 * Whether a stop sign `{ at, why, started }` is current (G4): newer than the last boot (`bootAt`, ms, null when unknown), and written by
 * the board started last (`startedAt`: data/started.json's time, null when unknown; a sign without `started` counts when it is newer
 * than that start).
 */
export function isSignCurrent(stop, { bootAt = null, startedAt = null }) {
  if (stop === null || stop === undefined || !Number.isFinite(stop.at)) return false
  if (Number.isFinite(bootAt) && stop.at < bootAt) return false
  if (Number.isFinite(startedAt)) {
    if (Number.isFinite(stop.started)) return stop.started >= startedAt
    return stop.at >= startedAt
  }
  return true
}

/** The starts of the last hour, with `now` added when `add` is true. */
export function startsWithin(starts, now, add = false, withinMs = STARTS_WITHIN_MS) {
  const kept = (Array.isArray(starts) ? starts : []).filter(at => Number.isFinite(at) && now - at < withinMs)
  return add ? [...kept, now] : kept
}

/**
 * The decision for one board: `{ do: 'nothing' | 'start' | 'leave' | 'say', why, record }`. `facts`: `answers` (the board answered
 * its page), `keepers` (the keepers of its folder among the processes, `{ pid }` each), `lockAgeMs` (the landing lock's age, null for
 * none), `stop` (data/stop.json read, or null), `startedAt` (data/started.json's `at`, or null), `bootAt`, `now`, and `record`, the
 * watcher's own record of the board `{ starts: [ms], silentLooks }`. The answer's `record` is the record to keep.
 */
export function watchDecision({ answers, keepers = [], lockAgeMs = null, stop = null, startedAt = null, bootAt = null, now, record = { starts: [], silentLooks: 0 } }) {
  const kept = { starts: startsWithin(record?.starts, now), silentLooks: Number.isInteger(record?.silentLooks) ? record.silentLooks : 0 }
  if (answers) return { do: 'nothing', why: 'the board answers', record: { ...kept, silentLooks: 0 } }
  if (keepers.length > 0) {
    const looks = kept.silentLooks + 1
    const say = looks === SILENT_LOOKS
    return { do: say ? 'say' : 'nothing', why: say ? `a keeper (process ${keepers[0].pid}) runs, but the board has not answered for ${looks} looks in a row` : 'a keeper runs; the board is starting', record: { ...kept, silentLooks: looks } }
  }
  const fresh = { ...kept, silentLooks: 0 }
  if (Number.isFinite(lockAgeMs) && lockAgeMs < LOCK_FRESH_MS) return { do: 'nothing', why: 'a landing runs: land.ps1 restarts the boards itself', record: fresh }
  if (!Number.isFinite(startedAt)) return { do: 'nothing', why: 'the board never ran here (no data/started.json): start it once by hand', record: fresh }
  const current = isSignCurrent(stop, { bootAt, startedAt })
  if (current && stop.why === 'stopped') return { do: 'nothing', why: `stopped on purpose at ${clockOf(stop.at)}`, record: fresh }
  if (current && stop.why === 'crash') {
    if (fresh.starts.length >= STARTS_PER_HOUR) {
      const until = Math.min(...fresh.starts) + STARTS_WITHIN_MS
      return { do: 'leave', why: `the board crashed and was started ${fresh.starts.length} times this hour: left alone until ${clockOf(until)}`, record: fresh }
    }
    return { do: 'start', why: `the board crashed (its keeper gave up at ${clockOf(stop.at)}): start ${fresh.starts.length + 1} of ${STARTS_PER_HOUR} this hour`, record: { ...fresh, starts: startsWithin(fresh.starts, now, true) } }
  }
  const stale = stop !== null && stop !== undefined && !current ? ` (a stop sign of ${clockOf(stop.at)} is stale)` : ''
  return { do: 'start', why: `no keeper, no answer, no stop sign${stale}: the board was killed (an app update) or never started after logon`, record: { ...fresh, starts: startsWithin(fresh.starts, now, true) } }
}

const pad = n => String(n).padStart(2, '0')
export const clockOf = ms => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`

/** The watcher's record file read: `{ boards: { [folder]: { starts, silentLooks } } }`, empty for anything else. */
export function watcherRecordOf(text) {
  try {
    const parsed = JSON.parse(String(text ?? ''))
    const boards = parsed?.boards !== null && typeof parsed?.boards === 'object' ? parsed.boards : {}
    return { boards: Object.fromEntries(Object.entries(boards).map(([folder, one]) => [folder, { starts: Array.isArray(one?.starts) ? one.starts.filter(Number.isFinite) : [], silentLooks: Number.isInteger(one?.silentLooks) ? one.silentLooks : 0 }])) }
  } catch {
    return { boards: {} }
  }
}
