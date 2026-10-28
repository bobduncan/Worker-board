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
 * The mod's `report` object as the board keeps it: `{ state, since, background, run, seq }`; `since` a finite time not
 * after `now` (else `now`), `background` true only when the mod says so (background work runs after the turn). The
 * review of chat-reports: `seq` the count that rises with every report of the mod's process, `run` that process (each
 * null when not given): the order of two reports is told by them, never by a clock. Null for anything that is not a
 * report.
 */
export function parseReport(value, now) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (!REPORT_STATES.includes(value.state)) return null
  const since = Number.isFinite(value.since) && value.since <= now ? value.since : now
  const seq = Number.isSafeInteger(value.seq) && value.seq >= 0 ? value.seq : null
  const run = Number.isFinite(value.run) || (typeof value.run === 'string' && value.run.length <= 64) ? value.run : null
  return { state: value.state, since, background: value.background === true, run, seq }
}

/**
 * A lane's state from the chat's last report (`entry`, with `at`: when the board got it), or null without one (the
 * caller keeps the older inference). `why` says what holds a working idle chat (`background`, `partner`) or why it is
 * off (`ended`, `silent`, `app`).
 *
 * - Ended: off at once. Stale (older than `unknownAfterMs`): T13 part 3, asleep when the app started after it (`appRuns`
 *   false, from `appStartedAt`) or it is silent past `offAfterMs` (`asleepLane`), else unknown.
 * - Fresh: busy is working, asking waiting. Idle: waiting while a blocking ask on the person is open; working while
 *   background work runs (not once its task is reported, `isTaskReported`: B148) or a blocking ask waits for the
 *   partner's answer; interrupted while it holds a task (a worker stopped mid-task: never free, so no new work goes to
 *   it); else free. A chat that reports runs.
 */
export function laneFromReport(entry, { now, unknownAfterMs, offAfterMs = Infinity, holdsTask, hasBlockingAsk, waitsForPartner = false, isTaskReported = false, appRuns, appStartedAt = null, wokenAt = null }) {
  if (entry === null || entry === undefined) return null
  if (entry.state === 'ended') return { state: 'off', isRunning: false, why: 'ended' }
  if (!Number.isFinite(entry.at) || now - entry.at > unknownAfterMs) {
    const since = asleepSince(entry, { now, offAfterMs, appRuns, appStartedAt, holdsTask })
    if (since !== null) return asleepLane(entry, { since, now, offAfterMs, holdsTask, hasBlockingAsk, waitsForPartner, isTaskReported, wokenAt })
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

/**
 * T13 part 3 (the person, 2026-10-28: after a restart "suspended keeps suspended, free = free, working is working,
 * interrupted is interrupted. the goal is to not have 'Unknown' or unintentionally 'Not running'"): since when a chat whose
 * last report stands sleeps, or null. Its process ended while nothing changed for it: the app started after the report
 * (`appRuns` false, B315's fact: since the app's start), or (the coordinator, seen live 2026-10-28: Workers 2 and 3 run
 * as routine chats, whose process ends with their turn) the board has heard nothing from it for longer than `offAfterMs`
 * since a report of idle, or of busy on a task it holds (since the report). A chat busy on nothing, or asking, that falls
 * silent is off as before (B736: a chat silent alone). Nothing but a message wakes it again.
 */
function asleepSince(entry, { now, offAfterMs, appRuns, appStartedAt, holdsTask }) {
  if (!Number.isFinite(entry.at)) return null
  if (appRuns === false) return Number.isFinite(appStartedAt) ? appStartedAt : entry.at
  const canSleep = entry.state === 'idle' || (entry.state === 'busy' && holdsTask)
  return canSleep && now - entry.at > offAfterMs ? entry.at : null
}

/**
 * T13 part 3: the lane of an asleep chat (`since`): it keeps what its last report said, not running (`isRunning` false, so
 * a word to it brings the board's start word), with `asleep` and `asleepSince`. Idle is free (the hand-out gives it a task,
 * whose line wakes it); asking, or a blocking ask on the person, waits for the person; waiting for the partner's answer
 * stays so; a turn that ran (busy, or background work, which ended with the process) or a task it holds is interrupted,
 * and the board sends it one resume word (hands.mjs). Not running only once a wake did not take: a start or resume word
 * reached it (`wokenAt`, since it fell asleep) and it stayed silent for longer than `offAfterMs` after it.
 */
function asleepLane(entry, { since, now, offAfterMs, holdsTask, hasBlockingAsk, waitsForPartner, isTaskReported, wokenAt }) {
  if (Number.isFinite(wokenAt) && wokenAt >= since && now - wokenAt > offAfterMs) return { state: 'off', isRunning: false, why: 'woken', wokenAt }
  const asleep = { isRunning: false, asleep: true, asleepSince: since }
  if (entry.state === 'busy') return { state: 'interrupted', ...asleep }
  if (entry.state === 'asking' || hasBlockingAsk) return { state: 'waiting', ...asleep }
  if (entry.background === true && !isTaskReported) return { state: 'interrupted', ...asleep }
  if (waitsForPartner) return { state: 'working', why: 'partner', ...asleep }
  if (holdsTask) return { state: 'interrupted', ...asleep }
  return { state: 'free', ...asleep }
}

/**
 * Gap 1 (principle 3: know, don't guess): the lane of a chat whose card says a Workers mod that reports (`cardMod`) and
 * that sent the board no report, or null (the caller keeps the older inference: an older mod, no card, or a board that
 * has run less than `unknownAfterMs`). Off (`why` `unreported`) once `offAfterMs` has passed since the later of the
 * board's start and the card's last write (`cardAt`), else unknown.
 */
export function laneWithoutReport({ cardMod, cardAt = null, boardStartedAt, now, unknownAfterMs, offAfterMs = Infinity }) {
  if (!modReports(cardMod) || !Number.isFinite(boardStartedAt) || now - boardStartedAt < unknownAfterMs) return null
  const from = Math.max(boardStartedAt, Number.isFinite(cardAt) ? cardAt : -Infinity)
  return now - from >= offAfterMs ? { state: 'off', isRunning: false, why: 'unreported' } : { state: 'unknown', isRunning: null }
}

/** Whether a Workers mod of this version reports its turn state: at least REPORT_MOD. */
export function modReports(version) {
  const mine = versionOf(version)
  return mine !== null && !isOlder(mine, versionOf(REPORT_MOD))
}
