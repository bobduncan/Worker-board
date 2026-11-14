// Signals change 1 (2026-10-31): the board tells the page the truth about itself. When the board ends it writes
// data/stop.json ({ at, why }); the next start reads it into the gap line it writes (src/history.mjs `startGap`), and the
// state carries `board`: the board's own clock, when its work loop last ran, whether it is about to leave, and why it was
// off (for 15 minutes after a start). The page's banner (public/board.js `bannerOf`) reads only this.

import { readFileSync, rmSync, writeFileSync } from 'node:fs'

import { START_HOWS } from './history.mjs'
import { START_ANEW } from './keeper.mjs'

/** The reasons a board ends, as the stop record and the gap line say them. */
export const STOP_WHYS = ['restart', 'stopped', 'crash']
/** How long after a start that found a gap the state says why the board was off. */
export const LAST_STOP_SHOWN_MS = 15 * 60_000

/**
 * Why the board ends, from the code it ends with: START_ANEW is a restart for a new version; 0 is a stop (the signals
 * SIGINT, SIGTERM and SIGHUP and the keeper's disconnect all end the board with `process.exit(0)`); any other code, also
 * the one an uncaught error ends with, is a crash.
 */
export function stopWhy({ code }) {
  if (code === START_ANEW) return 'restart'
  if (code === 0) return 'stopped'
  return 'crash'
}

/**
 * Gap 2 of the live proof: a restart with nothing running would end the board within milliseconds, and the page, asking every
 * `refreshSeconds`, almost never got an answer saying `leaving`. So the board keeps answering for this long after it
 * decided to leave (one refresh and a second over), then ends.
 */
export const leavingNoticeMs = refreshSeconds => (Number.isFinite(refreshSeconds) ? refreshSeconds : 30) * 1000 + 1000

/**
 * The moment the board ends for a restart: not before its running work settled (`workSettledAt`) and not before the notice
 * has lasted (`leavingAt` plus the notice), whichever is later, but never later than the work's wait (`waitMs`) plus the notice.
 */
export function exitAt({ leavingAt, workSettledAt, refreshSeconds, waitMs }) {
  const notice = leavingNoticeMs(refreshSeconds)
  return Math.min(Math.max(workSettledAt, leavingAt + notice), leavingAt + waitMs + notice)
}

/** The shape of the page's token and the chats' key: 32 random bytes as hex. */
export const KEPT_SHAPE = /^[0-9a-f]{64}$/

/**
 * Signals change 5 (2026-11-02): what a board's keeper handed it from the board before (`token`: WORKER_BOARD_TOKEN, `key`:
 * WORKER_BOARD_KEY, '' when not set): the page's token to go on with (null: a new one is made), and how this board was
 * started: `keeper` (started again by its keeper, after a restart or a crash: it hands on at least one of them) or `hand`
 * (a cold start: the Run pane, start-board.mjs, a command, a chat's Workers mod). Anything not of the shape is not kept.
 */
export function keptStart({ token = '', key = '' } = {}) {
  const kept = typeof token === 'string' && KEPT_SHAPE.test(token) ? token : null
  return { token: kept, start: kept !== null || (typeof key === 'string' && KEPT_SHAPE.test(key)) ? 'keeper' : 'hand' }
}

/** A stop record as the file holds it, or null when it is not one. */
export function parseStop(text) {
  try {
    const record = JSON.parse(text)
    if (!Number.isFinite(record?.at) || !STOP_WHYS.includes(record?.why)) return null
    // F10: `started` (the start the sign belongs to) and `by` ('command' for start-board.mjs --stop) ride along when there.
    return { at: record.at, why: record.why, ...(Number.isFinite(record.started) ? { started: record.started } : {}), ...(typeof record.by === 'string' ? { by: record.by } : {}) }
  } catch {
    return null
  }
}

/** Writes the stop record. Synchronous: it runs in an exit handler. A failed write is no reason to fail the exit. */
export function writeStop(file, record) {
  try {
    writeFileSync(file, JSON.stringify(record))
  } catch {
    // The next start then calls the gap "unknown".
  }
}

/** Reads the stop record at a start and removes the file at once, so a later start never blames an old stop. */
export function takeStop(file) {
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  try {
    rmSync(file, { force: true })
  } catch {
    // Kept: the gap check on its `at` still keeps an old record from being blamed.
  }
  return parseStop(text)
}

/**
 * What a start that found a gap tells: `{ from, to, why, start }`, or null for a start without one. `start` (signals change
 * 5): how this board was started, `hand` or `keeper`, null for a gap line that does not say.
 */
export function lastStopOf(gap, startedAt) {
  if (gap === null || gap === undefined || !Number.isFinite(gap.at)) return null
  return { from: gap.at, to: startedAt, why: STOP_WHYS.includes(gap.why) ? gap.why : 'unknown', start: START_HOWS.includes(gap.start) ? gap.start : null }
}

/**
 * `board` in /api/state: `now` (the board's clock, ms), `loop.lastTickAt` (when the work loop last ran: alive.json's time,
 * never before the start; null where nothing ticks: the demo, a board that only shows), `restart` (`none`, `waiting` for a
 * safe moment to start the new version, `leaving` once it decided to end for it) and `lastStop` for 15 minutes after a start
 * that found a gap.
 */
export function boardView({ now, startedAt, aliveAt = null, leaving = null, waiting = null, lastStop = null }) {
  const restart = leaving !== null ? { state: 'leaving', at: leaving.at, why: leaving.why }
    : waiting !== null ? { state: 'waiting', at: Number.isFinite(waiting.since) ? waiting.since : null, why: 'new-version' }
      : { state: 'none', at: null, why: null }
  return {
    now,
    loop: { lastTickAt: Number.isFinite(aliveAt) ? Math.max(aliveAt, startedAt) : null },
    restart,
    lastStop: lastStop !== null && now - startedAt < LAST_STOP_SHOWN_MS ? lastStop : null,
  }
}
