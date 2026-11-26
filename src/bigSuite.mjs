// S9 (the PC plan, the person's choice of 2026-11-25 21:2x): the big suite runs every test file of main when the PC is idle, at least
// every 4 hours and once each night; the light check (src/lightCheck.mjs) leaves the slowest files out of each go-live. A red big run
// names the go-lives since the last green one, the board files a fix step for it (server.mjs), and its failing files run in the light
// check until two green big runs in a row (probation). Its state lies beside the PC's test lock (tools/one-at-a-time.mjs lockPath), so
// every worktree's light check reads the same probation. The runner (tools/big-suite.mjs) keeps the game slow tier's two runner
// rules (S3): it is alive past its age while its run waits in the idle room or holds a slot, and it renews its file before each phase.

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
 * Whether a big run is due now, and why: main moved past the last run's commit (the PC runs it when idle), 4 hours since the last
 * start, or the night run (from 01:00, none started since). null when none is. PURE.
 */
export function dueNow({ results, mainHead, now }) {
  const lastStart = ms(results.lastStart)
  if (!Number.isFinite(lastStart)) return 'no run yet'
  const night = nightStart(now)
  if (now >= night && !(lastStart >= night)) return 'the night run'
  if (now - lastStart >= EVERY_MS) return 'every 4 hours'
  if (mainHead && results.last?.commit !== mainHead && results.lastTry?.commit !== mainHead) return 'main moved'
  return null
}

/**
 * The run's queue label and how long it may wait for an idle PC (`idleUntil`, ms): ordinary at once when the last finished run is 4
 * hours old or more, or from 05:00 while the night run has not run; else idle until whichever of those comes first. PURE.
 */
export function labelFor({ results, now }) {
  const lastAt = ms(results.last?.at)
  const lastStart = ms(results.lastStart)
  const until = []
  if (Number.isFinite(lastAt)) until.push(lastAt + EVERY_MS)
  else until.push(now)
  const night = nightStart(now)
  if (now >= night && !(lastStart >= night)) until.push(nightStart(now, NIGHT_ORDINARY_HOUR))
  const idleUntil = Math.min(...until)
  return now >= idleUntil ? { label: ORDINARY_LABEL, idleUntil } : { label: IDLE_LABEL, idleUntil }
}

/**
 * The results after a run (`outcome` passed, failed or could not run; `failed` the failing test files). A red run puts its files on
 * probation; each green run counts one for every file there, and a file leaves after PROBATION_GREENS green runs in a row. A run that
 * could not run keeps the last result and says so (`couldNotRun`), and is not tried again for the same commit. PURE.
 */
export function recordRun(results, run) {
  const entry = { commit: run.commit, outcome: run.outcome, at: run.at, seconds: run.seconds, failed: run.failed ?? [], why: run.why ?? null, label: run.label ?? null }
  const lastStart = run.at
  if (run.outcome === 'could not run') return { ...results, lastStart, lastTry: entry, couldNotRun: entry }
  const probation = { ...(results.probation ?? {}) }
  if (run.outcome === 'failed') for (const file of entry.failed) probation[file] = { since: run.at, commit: run.commit, greens: 0 }
  else {
    for (const [file, held] of Object.entries(probation)) {
      const greens = (held.greens ?? 0) + 1
      if (greens >= PROBATION_GREENS) delete probation[file]
      else probation[file] = { ...held, greens }
    }
  }
  return {
    ...results, lastStart, lastTry: entry, last: entry, couldNotRun: null, probation,
    lastGreen: run.outcome === 'passed' ? run.commit : results.lastGreen ?? null,
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

/** The fix step a red big run files: its title and lines (the failing files, the go-lives since the last green run, the log). PURE. */
export function fixStepOf({ run, lastGreen, goLives, log }) {
  const short = sha => String(sha ?? '').slice(0, 7)
  const names = goLives.map(one => `${one.branch} (${one.by}, ${short(one.after)})`)
  return {
    title: `Big suite red on main at ${short(run.commit)}: ${run.failed.length} test file(s) fail`,
    text: [
      `Description: the big suite (every test file, S9) failed on main at ${short(run.commit)}; the light check of each go-live left these files out.`,
      `Failing files: ${run.failed.length > 0 ? run.failed.join(', ') : 'none named (see the log)'}.`,
      `Go-lives since the last green run${lastGreen ? ` (${short(lastGreen)})` : ''}: ${names.length > 0 ? names.join('; ') : 'none found'}.`,
      `Each failing file runs in every light check until two green big runs in a row (probation).`,
      `Log: ${log}`,
    ],
  }
}

/** The big suite's lines for a gate's start and npm run big-suite -- --status: a red run with its files and probation. PURE. */
export function statusLines(results) {
  const lines = []
  const last = results.last
  if (last?.outcome === 'failed') {
    lines.push(`big suite: RED on main at ${String(last.commit).slice(0, 7)}${results.lastGreen ? ` (last green: ${String(results.lastGreen).slice(0, 7)})` : ''}: ${last.failed.join(', ') || 'see its log'}`)
  }
  const held = Object.keys(results.probation ?? {})
  if (held.length > 0) lines.push(`big suite: on probation in the light check: ${held.join(', ')}`)
  if (results.couldNotRun && results.couldNotRun === results.lastTry) lines.push(`big suite: could not run main at ${String(results.couldNotRun.commit).slice(0, 7)} (${results.couldNotRun.why})`)
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
export function bigRunQueued(lock, tool, alive = pidRuns) {
  const isBig = (file) => {
    const run = readJson(file, null)
    const folder = path.basename(String(run?.cwd ?? '').replace(/\\/g, '/'))
    return (run?.label === IDLE_LABEL || run?.label === ORDINARY_LABEL) && folder.startsWith(RUN_FOLDER) && alive(run.pid)
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
