// Redesign Part 1 (2026-10-24, spec .claude/specs/2026-10-24-board-redesign-design.md): every chat's Workers mod tells
// the board its turn state at once on every change and in its 5-second ping (its take): `busy` (a turn runs), `idle`
// (the turn ended), `asking` (AskUserQuestion is open). The board shows that report instead of guessing (principle 3).
// A report older than the setting `unknownAfterSeconds` is unknown, or off when the app's record says the chat does
// not run. A chat on a mod older than REPORT_MOD sends none and keeps the board's older inference. PURE.

import { isOlder, versionOf } from './oldMods.mjs'

/** What a mod reports, and nothing else. */
export const REPORT_STATES = ['busy', 'idle', 'asking']

/** The first Workers mod that reports its turn state. */
export const REPORT_MOD = '0.19.0'

/**
 * The mod's `report` object as the board keeps it: `{ state, since, background }`; `since` a finite time not after
 * `now` (else `now`), `background` true only when the mod says so (background work runs after the turn). Null for
 * anything that is not a report.
 */
export function parseReport(value, now) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (!REPORT_STATES.includes(value.state)) return null
  const since = Number.isFinite(value.since) && value.since <= now ? value.since : now
  return { state: value.state, since, background: value.background === true }
}

/**
 * A lane's state from the chat's last report (`entry`, with `at`: when the board got it), or null without one (the
 * caller keeps the older inference). Fresh: busy is working, asking waiting, idle free; idle with background work is
 * working; idle while the chat holds a task in progress is interrupted (a worker stopped mid-task: never free, so no
 * new work goes to it), or waiting when a blocking ask of its is open. A chat that reports runs. Stale (older than
 * `unknownAfterMs`): off when the app's record says the chat does not run (`appRuns` false), else unknown.
 */
export function laneFromReport(entry, { now, unknownAfterMs, holdsTask, hasBlockingAsk, appRuns }) {
  if (entry === null || entry === undefined) return null
  if (!Number.isFinite(entry.at) || now - entry.at > unknownAfterMs) {
    return appRuns === false ? { state: 'off', isRunning: false } : { state: 'unknown', isRunning: null }
  }
  if (entry.state === 'busy') return { state: 'working', isRunning: true }
  if (entry.state === 'asking') return { state: 'waiting', isRunning: true }
  if (entry.background === true) return { state: 'working', isRunning: true }
  if (holdsTask) return { state: hasBlockingAsk ? 'waiting' : 'interrupted', isRunning: true }
  return { state: 'free', isRunning: true }
}

/** Whether a Workers mod of this version reports its turn state: at least REPORT_MOD. */
export function modReports(version) {
  const mine = versionOf(version)
  return mine !== null && !isOlder(mine, versionOf(REPORT_MOD))
}
