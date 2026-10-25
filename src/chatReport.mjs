// Redesign Part 1 (2026-10-24, spec .claude/specs/2026-10-24-board-redesign-design.md): every chat's Workers mod tells
// the board its turn state at once on every change and in its 5-second ping (its take): `busy` (a turn runs), `idle`
// (the turn ended), `asking` (AskUserQuestion is open), and `ended` once when its session ends (the review of
// 2026-10-25). The board shows that report instead of guessing (principle 3). A report older than the setting
// `unknownAfterSeconds` is unknown; off when the app started after it, or when it stays silent past `offAfterMinutes`
// (principle 2: never wait for ever). A chat on a mod older than REPORT_MOD sends none and keeps the board's older
// inference. PURE.

import { isOlder, versionOf } from './oldMods.mjs'

/** What a mod reports, and nothing else. */
export const REPORT_STATES = ['busy', 'idle', 'asking', 'ended']

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
 * caller keeps the older inference). `why` says what holds a working idle chat (`background`, `partner`) or why it is
 * off (`ended`, `silent`, `app`).
 *
 * - Ended: off at once. Stale (older than `unknownAfterMs`): off when the app started after it (`appRuns` false) or it
 *   is silent past `offAfterMs`, else unknown.
 * - Fresh: busy is working, asking waiting. Idle: waiting while a blocking ask on the person is open; working while
 *   background work runs (not once its task is reported, `isTaskReported`: B148) or a blocking ask waits for the
 *   partner's answer; interrupted while it holds a task (a worker stopped mid-task: never free, so no new work goes to
 *   it); else free. A chat that reports runs.
 */
export function laneFromReport(entry, { now, unknownAfterMs, offAfterMs = Infinity, holdsTask, hasBlockingAsk, waitsForPartner = false, isTaskReported = false, appRuns }) {
  if (entry === null || entry === undefined) return null
  if (entry.state === 'ended') return { state: 'off', isRunning: false, why: 'ended' }
  if (!Number.isFinite(entry.at) || now - entry.at > unknownAfterMs) {
    if (appRuns === false) return { state: 'off', isRunning: false, why: 'app' }
    if (!Number.isFinite(entry.at) || now - entry.at > offAfterMs) return { state: 'off', isRunning: false, why: 'silent' }
    return { state: 'unknown', isRunning: null }
  }
  if (entry.state === 'busy') return { state: 'working', isRunning: true }
  if (entry.state === 'asking') return { state: 'waiting', isRunning: true }
  if (hasBlockingAsk) return { state: 'waiting', isRunning: true }
  if (entry.background === true && !isTaskReported) return { state: 'working', isRunning: true, why: 'background' }
  if (waitsForPartner) return { state: 'working', isRunning: true, why: 'partner' }
  if (holdsTask) return { state: 'interrupted', isRunning: true }
  return { state: 'free', isRunning: true }
}

/** Whether a Workers mod of this version reports its turn state: at least REPORT_MOD. */
export function modReports(version) {
  const mine = versionOf(version)
  return mine !== null && !isOlder(mine, versionOf(REPORT_MOD))
}
