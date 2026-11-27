// S9 (the PC plan, the person's choice of 2026-11-25 21:2x): the big suite runs every test file of main when the PC is idle, at least
// every 4 hours and once each night; the light check (src/lightCheck.mjs) leaves the slowest files out of each go-live. A red big run
// names the go-lives since the last green one, the board files a fix step for it (server.mjs), and its failing files run in the light
// check until two green big runs in a row (probation). Its state lies beside the PC's test lock (tools/one-at-a-time.mjs lockPath), so
// every worktree's light check reads the same probation. The runner (tools/big-suite.mjs) keeps the game slow tier's two runner
// rules (S3): it is alive past its age while its run waits in the idle room or holds a slot, and it renews its file before each phase.
// B1573 (X264): a run tests main's newest commit at the moment it takes its slot, not the one it queued at (an idle run may wait
// hours), and every result here names that tested commit.

import { readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { PROBATION_GREENS } from './lightCheck.mjs'

/** How often the big suite must run at the least, and from when its night run is due and when it stops waiting for an idle PC. */
export const EVERY_MS = 4 * 60 * 60 * 1000
export const NIGHT_FROM_HOUR = 1
export const NIGHT_ORDINARY_HOUR = 5
/** A runner whose file is older than this is dead, unless its run is in the queue (S3's rule, as the game's slow tier). */
export const RUNNER_MAX_MS = 3 * 60 * 60 * 1000
/** The queue labels of a big run: idle (waits for an idle PC) or ordinary (an overdue one). */
export const IDLE_LABEL = 'idle:big-suite'
export const ORDINARY_LABEL = 'big-suite'
/** The label of the rerun alone of a file that failed in a big run (short: an ordinary run). */
export const RERUN_LABEL = 'big-suite-rerun'
/** Core review: after main moved, a big run waits at least this long after the last start (no run after every landing). */
export const SETTLE_MS = 60 * 60 * 1000
/** The folder name of a big run's worktree in the temporary folder. */
export const RUN_FOLDER = 'board-big-suite-'

/** The big suite's files beside the PC's test lock: its results, its runner and its log. */
export function stateFiles(lock) {
  return { results: `${lock}.board-big-suite.json`, runner: `${lock}.board-big-suite.runner`, log: `${lock}.board-big-suite.log` }
}

export function readJson(file, fallback = {}) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(temp, file)
}

const ms = iso => (iso ? Date.parse(iso) : NaN)

/** 01:00 of the local day of `now`. PURE. */
export function nightStart(now, hour = NIGHT_FROM_HOUR) {
  const at = new Date(now)
  at.setHours(hour, 0, 0, 0)
  return at.getTime()
}

/**
 * Verifier: a run that started from midnight on is that night's run (one that took its slot at 00:55 made a second night run due right
 * after it). PURE.
 */
export const nightDone = now => nightStart(now, 0)

/**
 * Whether a big run is due now, and why (the person's words: when the PC is idle, at least every 4 hours and once each night): no run
 * yet; the night run (from 01:00, none started since); or main moved past the last run (or that run was not green) and an hour has
 * gone since the last start (core review: a run after every landing cost more than the gates it saved). Such a run waits for an idle
 * PC until 4 hours after the last start (labelFor). null when none is. PURE.
 */
export function dueNow({ results, mainHead, now }) {
  const lastStart = ms(results.lastStart)
  if (!Number.isFinite(lastStart)) return 'no run yet'
  const night = nightStart(now)
  if (now >= night && !(lastStart >= nightDone(now))) return 'the night run'
  const changed = (mainHead && results.last?.commit !== mainHead) || results.last?.outcome !== 'passed'
  if (changed && now - lastStart >= SETTLE_MS) return now - lastStart >= EVERY_MS ? 'every 4 hours' : 'main moved'
  return null
}

/**
 * The run's queue label and how long it may wait for an idle PC (`idleUntil`, ms): idle (it goes when nobody waits, S3) until 4 hours
 * after the last start, and the night run until 05:00; ordinary at once past that, and with no run yet. PURE.
 */
export function labelFor({ results, now }) {
  const lastStart = ms(results.lastStart)
  if (!Number.isFinite(lastStart)) return { label: ORDINARY_LABEL, idleUntil: now }
  const until = [lastStart + EVERY_MS]
  const night = nightStart(now)
  if (now >= night && !(lastStart >= nightDone(now))) until.push(nightStart(now, NIGHT_ORDINARY_HOUR))
  const idleUntil = Math.min(...until)
  return now >= idleUntil ? { label: ORDINARY_LABEL, idleUntil } : { label: IDLE_LABEL, idleUntil }
}

/**
 * The results after a run (`outcome` passed, failed or could not run; `failed` the files that failed again alone, `flaky` the ones that
 * passed alone). A red run puts its failing files on probation and starts every probation count anew (two green runs IN A ROW); each
 * green run counts one for every file there, and a file leaves after PROBATION_GREENS of them. A run that could not run keeps the last
 * result and says so (`couldNotRun`). PURE.
 */
export function recordRun(results, run) {
  const entry = { commit: run.commit, outcome: run.outcome, at: run.at, seconds: run.seconds, failed: run.failed ?? [], flaky: run.flaky ?? [], why: run.why ?? null, label: run.label ?? null }
  const lastStart = run.at
  // Core review: the could-not-runs in a row (a suite that never finishes never turns red: the board files a step after 3).
  if (run.outcome === 'could not run') return { ...results, lastStart, lastTry: entry, couldNotRun: entry, notRunInRow: (results.notRunInRow ?? 0) + 1, notRunSince: results.notRunSince ?? run.at }
  const probation = { ...(results.probation ?? {}) }
  if (run.outcome === 'failed') {
    for (const [file, held] of Object.entries(probation)) probation[file] = { ...held, greens: 0 }
    for (const file of entry.failed) probation[file] = { since: run.at, commit: run.commit, greens: 0 }
  } else {
    for (const [file, held] of Object.entries(probation)) {
      const greens = (held.greens ?? 0) + 1
      if (greens >= PROBATION_GREENS) delete probation[file]
      else probation[file] = { ...held, greens }
    }
  }
  return {
    ...results, lastStart, lastTry: entry, last: entry, couldNotRun: null, notRunInRow: 0, notRunSince: null, probation,
    lastGreen: run.outcome === 'passed' ? run.commit : results.lastGreen ?? null,
    lastGreenAt: run.outcome === 'passed' ? run.at : results.lastGreenAt ?? null,
    redSince: run.outcome === 'failed' ? results.redSince ?? run.commit : null,
  }
}

/**
 * The go-lives a red run names: the landed records (data/landings.jsonl) whose new main is one of `commits`, the commits in the red
 * run's history and not in the last green one's (`git rev-list <last green>..<red>`). PURE.
 */
export function goLivesIn(landings, commits) {
  return landings.filter(one => one?.result === 'landed' && typeof one.after === 'string' && commits.has(one.after))
}

/** The board's landed records, oldest first (data/landings.jsonl), [] when there is none. */
export function readLandings(file) {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    }).filter(Boolean)
  } catch {
    return []
  }
}

/** At most this many go-lives are named in a fix step (a first red with no green run before it would name them all). */
export const GO_LIVES_NAMED = 20

/** The fix step a red big run files: its title and lines (the files that failed again alone, the go-lives since the last green run). PURE. */
export function fixStepOf({ run, lastGreen, goLives, log }) {
  const short = sha => String(sha ?? '').slice(0, 7)
  const names = goLives.slice(-GO_LIVES_NAMED).map(one => `${one.branch} (${one.by}, ${short(one.after)})`)
  const more = goLives.length > GO_LIVES_NAMED ? ` (and ${goLives.length - GO_LIVES_NAMED} older)` : ''
  const since = lastGreen ? `since the last green run (${short(lastGreen)})` : 'with no green run before it'
  return {
    title: `Big suite red on main at ${short(run.commit)}: ${run.failed.length} test file(s) fail`,
    text: [
      `Description: the big suite (every test file, S9) failed on main at ${short(run.commit)}, and each failing file failed again when run alone. A go-live's light check may have left a slow one of them out.`,
      `Failing files: ${run.failed.length > 0 ? run.failed.join(', ') : 'none named (see the log)'}.`,
      ...(run.flaky?.length > 0 ? [`Passed alone (not counted): ${run.flaky.join(', ')}.`] : []),
      `Go-lives ${since}: ${names.length > 0 ? names.join('; ') + more : 'none found'}.`,
      'Each failing file runs in every light check until two green big runs in a row (probation).',
      `Log: ${log}, the run of ${run.at}.`,
    ],
  }
}

/** A big suite with no green run for this long is stale: the gates say so. */
export const STALE_MS = 8 * 60 * 60 * 1000

/**
 * The big suite's lines for a gate's start and `node tools/big-suite.mjs --status`: a red run with its files, the files on probation, a
 * run that could not run, and (core review) a big suite with no run yet or no green run for 8 hours, while the light checks leave the
 * slow files to it. PURE.
 */
export function statusLines(results, now = Date.now()) {
  const lines = []
  const last = results.last
  if (last?.outcome === 'failed') {
    lines.push(`big suite: RED on main at ${String(last.commit).slice(0, 7)}${results.lastGreen ? ` (last green: ${String(results.lastGreen).slice(0, 7)})` : ''}: ${last.failed.join(', ') || 'see its log'}`)
  }
  const held = Object.keys(results.probation ?? {})
  if (held.length > 0) lines.push(`big suite: on probation in the light check: ${held.join(', ')}`)
  const tried = results.lastTry
  const notRun = results.couldNotRun
  if (notRun && tried && notRun.commit === tried.commit && notRun.at === tried.at) lines.push(`big suite: could not run main at ${String(notRun.commit).slice(0, 7)} (${notRun.why})`)
  const green = ms(results.lastGreenAt)
  if (!last) lines.push('big suite: no run yet; the light checks leave the slow test files to it')
  else if (!(now - green < STALE_MS)) lines.push(`big suite: no green run ${Number.isFinite(green) ? `for ${Math.floor((now - green) / 3600000)} hours` : 'yet'}; the light checks leave the slow test files to it`)
  return lines
}

const pidRuns = pid => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * Whether a big run is in the PC's queue now: a live ticket labelled as one waits in the idle room or the queue, or a big run holds a
 * slot; only a run in a big run's folder counts. `lock` is the PC's lock file; `tool` the one-at-a-time module (idleRoomOf, slotPath,
 * slotCountOf).
 */
export function bigRunQueued(lock, tool, alive = pidRuns, now = Date.now()) {
  const isBig = (file) => {
    const run = readJson(file, null)
    const folder = path.basename(String(run?.cwd ?? '').replace(/\\/g, '/'))
    // Verifier: a ticket whose beat is old (a killed run's, left by a reboot; its pid may be reused) is no queued run.
    const beat = Date.parse(run?.beat)
    if (Number.isFinite(beat) && now - beat > (tool.BEAT_STALE_MS ?? 5 * 60 * 1000)) return false
    return [IDLE_LABEL, ORDINARY_LABEL, RERUN_LABEL].includes(run?.label) && folder.startsWith(RUN_FOLDER) && alive(run.pid)
  }
  for (const folder of [...(typeof tool.idleRoomOf === 'function' ? [tool.idleRoomOf(lock)] : []), `${lock}.queue`]) {
    let names = []
    try {
      names = readdirSync(folder).filter(name => name.endsWith('.json'))
    } catch {
      // none
    }
    if (names.some(name => isBig(path.join(folder, name)))) return true
  }
  for (let n = 1, count = tool.slotCountOf(lock, 1); n <= count; n += 1) if (isBig(tool.slotPath(lock, n))) return true
  return false
}

/** Whether a runner file names a live runner: its process runs, and it is younger than RUNNER_MAX_MS or its run is queued. */
export function runnerAlive(runner, now = Date.now(), alive = pidRuns, queued = () => false) {
  if (!runner || !alive(runner.pid)) return false
  return now - ms(runner.startedAt) < RUNNER_MAX_MS || queued()
}

/** Takes the runner file for this process; false when a live runner holds it. */
export function takeRunner(file, now = Date.now(), alive = pidRuns, queued = () => false) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date(now).toISOString() }), { flag: 'wx' })
      return true
    } catch {
      if (runnerAlive(readJson(file, null), now, alive, queued)) return false
      try {
        unlinkSync(file)
      } catch {
        // gone already
      }
    }
  }
  return false
}

/** The runner file says it started now, while it is still this runner's: before each phase. False when another runner took it. */
export function touchRunner(file, now = Date.now()) {
  const runner = readJson(file, null)
  if (runner?.pid !== process.pid) return false
  writeJson(file, { ...runner, startedAt: new Date(now).toISOString() })
  return true
}

/** Gives the runner file back only while it is still this runner's. */
export function giveBackRunner(file) {
  if (readJson(file, null)?.pid !== process.pid) return false
  try {
    unlinkSync(file)
  } catch {
    // gone already
  }
  return true
}
