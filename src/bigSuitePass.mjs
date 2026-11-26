// S9: the board's pass for the big suite (server.mjs, every 10 minutes, only on the PC's first board, the one that runs the loops). It
// files the fix step of a red big run once per red streak (the go-lives since the last green run in it), files one when the big suite
// could not run three times in a row, and starts the runner (tools/big-suite.mjs) when a run is due and no big run lives. The runner and
// its results lie beside the PC's test lock (src/bigSuite.mjs stateFiles); what the board filed lies in its own data folder (`filed`),
// so the two never write the same file. Filing and starting are apart: a failing store read never keeps the big suite from running.

import { bugPlace } from './bugs.mjs'
import {
  bigRunQueued, dueNow, fixStepOf, goLivesIn, readJson, readLandings, runnerAlive, stateFiles, writeJson,
} from './bigSuite.mjs'

/** How often the board looks. */
export const BIG_SUITE_LOOK_MS = 10 * 60 * 1000
/** A big suite that could not run this many times in a row gets a fix step (core review: one that never finishes never turns red). */
export const NOT_RUN_STEP_AFTER = 3
/** A filing that was begun and never finished (the board stopped in between) is tried again after this long. */
const PENDING_MS = 60 * 60 * 1000

/** The key a filing is kept under: one per red streak and its failing files, one per streak of could-not-runs. PURE. */
export function filingKey(results) {
  const last = results.last
  if (last?.outcome === 'failed') return `red ${results.redSince ?? last.commit} ${[...last.failed].sort().join(',')}`
  if ((results.notRunInRow ?? 0) >= NOT_RUN_STEP_AFTER) return `not run since ${results.notRunSince}`
  return null
}

/** The step a streak of could-not-runs files. PURE. */
export function notRunStepOf(results, log) {
  const why = results.couldNotRun?.why ?? 'see the log'
  return {
    title: `Big suite could not run ${results.notRunInRow} times in a row`,
    text: [
      `Description: the big suite (every test file, S9) could not run ${results.notRunInRow} times in a row since ${results.notRunSince}; the last time: ${why}.`,
      'While it does not run, the light check of every go-live leaves the slow test files untested.',
      `Log: ${log}.`,
    ],
  }
}

/**
 * Files what is owed: a red streak's fix step, or a could-not-run streak's. A pending mark is written before the step is made, so two
 * passes, or a pass after a stop in between, never file it twice; a filing that failed takes its mark away and is tried again.
 */
async function fileOwed({ results, files, landings, filed, commitsBetween, make, read, now }) {
  const key = filingKey(results)
  if (key === null) return null
  const record = readJson(filed)
  const kept = record[key]
  if (kept !== undefined && !(kept.pending === true && now - Date.parse(kept.at) > PENDING_MS)) return null
  let step
  if (results.last?.outcome === 'failed') {
    const goLives = goLivesIn(readLandings(landings), await commitsBetween(results.lastGreen ?? null, results.last.commit))
    step = fixStepOf({ run: results.last, lastGreen: results.lastGreen ?? null, goLives, log: files.log })
  } else step = notRunStepOf(results, files.log)
  const stored = await read()
  const place = bugPlace('board', stored?.items, stored?.activities)
  if (place.activity === null) return null
  writeJson(filed, { ...record, [key]: { pending: true, at: new Date(now).toISOString() } })
  let made = null
  try {
    made = await make({
      action: 'new', title: step.title, activity: place.activity, ...(place.goal === null ? {} : { goal: place.goal }), priority: 'fix',
      text: [...step.text, 'Filed by the board itself (the big suite, S9), not by the person.'],
    })
  } finally {
    const after = readJson(filed)
    if (made?.ok) writeJson(filed, { ...after, [key]: { id: made.result?.id ?? null, at: new Date(now).toISOString() } })
    else {
      const { [key]: _gone, ...rest } = after
      writeJson(filed, rest)
    }
  }
  return made?.ok ? made.result?.id ?? null : null
}

/**
 * One pass. `lock` the PC's test lock; `tool` the one-at-a-time module; `landings` data/landings.jsonl; `filed` the board's own record
 * of what it filed; `mainHead()` main's head (null when git cannot tell); `commitsBetween(from, to)` the commits of `to` that are not in
 * `from` (a Set; all of `to`'s recent ones when `from` is null); `start()` starts the runner (detached); `make(call)` one work-API action
 * as the person; `read()` the work store; `say(line)` where a filing that failed is told. Resolves to what it did (for the tests).
 */
export async function bigSuitePass({ lock, tool, landings, filed, mainHead, commitsBetween, start, make, read, now = Date.now(), alive, say = () => {} }) {
  const files = stateFiles(lock)
  const results = readJson(files.results)
  const did = { filed: null, started: null }
  try {
    did.filed = await fileOwed({ results, files, landings, filed, commitsBetween, make, read, now })
  } catch (error) {
    say(`big suite: its fix step could not be filed now: ${error.message}`)
  }
  const queued = () => bigRunQueued(lock, tool, alive)
  if (queued() || runnerAlive(readJson(files.runner, null), now, alive, queued)) return did
  const head = await mainHead()
  if (head === null) return did
  const why = dueNow({ results, mainHead: head, now })
  if (why !== null) {
    start()
    did.started = why
  }
  return did
}
