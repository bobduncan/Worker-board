// S9: the board's pass for the big suite (server.mjs, every 10 minutes, only on the PC's first board, the one that runs the loops). It
// files the fix step of a red streak once (the go-lives since the last green run in it; a file that joins the streak later gets a step
// of its own, a file an open big-suite step names gets none), files one when the big suite could not run three times in a row, and
// starts the runner (tools/big-suite.mjs) when a run is due and no big run lives. The runner and its results lie beside the PC's test
// lock (src/bigSuite.mjs stateFiles); what the board filed lies in its own data folder (`filed`), so the two never write the same file.
// Filing and starting are apart: a failing store read never keeps the big suite from running.

import { bugPlace } from './bugs.mjs'
import {
  bigRunQueued, dueNow, fixStepOf, goLivesIn, readJson, readLandings, runnerAlive, stateFiles, writeJson,
} from './bigSuite.mjs'

/** How often the board looks. */
export const BIG_SUITE_LOOK_MS = 10 * 60 * 1000
/** A pass that runs longer than this is hung (loops.single): above the look, so two passes never run side by side (verifier). */
export const BIG_SUITE_STALE_MS = 30 * 60 * 1000
/** A big suite that could not run this many times in a row gets a fix step (core review: one that never finishes never turns red). */
export const NOT_RUN_STEP_AFTER = 3
/** A filing begun and never finished (a stop in between), or one the work API refused, is tried again after this long. */
export const RETRY_MS = 60 * 60 * 1000
/** The title of every step the big suite files, so an open one is found again. */
const TITLE = /^Big suite (?:red on main|could not run)/

/**
 * What is owed now, each with the key it is kept under (PURE): the red streak (`red <first red commit>`) with the files it failed that
 * no earlier step of the streak named, and a streak of could-not-runs (also after a red run: verifier).
 */
export function owedOf(results, record) {
  const owed = []
  const last = results.last
  if (last?.outcome === 'failed') {
    const key = `red ${results.redSince ?? last.commit}`
    // Only a step that was made names its files (a refused or cut-off filing is tried again under its own key).
    const named = new Set(Object.values(record).filter(one => one?.streak === key && one.id !== undefined).flatMap(one => one.files ?? []))
    const files = [...last.failed].sort().filter(file => !named.has(file))
    if (files.length > 0) owed.push({ key: `${key} ${files.join(',')}`, streak: key, files, kind: 'red' })
  }
  if ((results.notRunInRow ?? 0) >= NOT_RUN_STEP_AFTER) owed.push({ key: `not run since ${results.notRunSince}`, kind: 'not run', files: [] })
  return owed
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

/** The files an open (not done, not dropped) step of the big suite names: such a file gets no second step. */
function filesOfOpenSteps(stored) {
  const named = new Set()
  for (const item of stored?.items?.values?.() ?? []) {
    const head = item?.head
    if (!head || !TITLE.test(head.get('Title') ?? '') || ['done', 'dropped'].includes(head.get('State'))) continue
    const text = [...(item.sections?.values?.() ?? [])].flat().join('\n')
    for (const match of text.matchAll(/test\/[\w./-]+\.test\.mjs/g)) named.add(match[0])
  }
  return named
}

/**
 * Files what is owed. A mark is written before the step is made and the record is read again right before it (a slow pass never writes
 * over a newer one), so a filing goes once; one the work API refused is said and tried again after RETRY_MS; one cut off by a stop is
 * tried again after RETRY_MS too.
 */
async function fileOwed({ results, files, landings, filed, commitsBetween, make, read, now, say }) {
  const ids = []
  for (const owed of owedOf(results, readJson(filed))) {
    const kept = readJson(filed)[owed.key]
    if (kept !== undefined && kept.id !== undefined) continue
    if (kept !== undefined && now - Date.parse(kept.at) < RETRY_MS) continue
    const stored = await read()
    let step
    if (owed.kind === 'red') {
      const open = filesOfOpenSteps(stored)
      const fresh = owed.files.filter(file => !open.has(file))
      if (fresh.length === 0) continue
      const goLives = goLivesIn(readLandings(landings), await commitsBetween(results.lastGreen ?? null, results.last.commit))
      step = fixStepOf({ run: { ...results.last, failed: fresh }, lastGreen: results.lastGreen ?? null, goLives, log: files.log })
    } else step = notRunStepOf(results, files.log)
    const place = bugPlace('board', stored?.items, stored?.activities)
    if (place.activity === null) continue
    const mark = { ...(owed.streak ? { streak: owed.streak, files: owed.files } : {}), at: new Date(now).toISOString() }
    writeJson(filed, { ...readJson(filed), [owed.key]: { ...mark, pending: true } })
    let made = null
    try {
      made = await make({
        action: 'new', title: step.title, activity: place.activity, ...(place.goal === null ? {} : { goal: place.goal }), priority: 'fix',
        text: [...step.text, 'Filed by the board itself (the big suite, S9), not by the person.'],
      })
    } finally {
      const after = readJson(filed)
      if (made?.ok) {
        writeJson(filed, { ...after, [owed.key]: { ...mark, id: made.result?.id ?? null } })
        ids.push(made.result?.id ?? null)
      } else if (made !== null) {
        // Refused: said, and kept as tried, so it is tried again after RETRY_MS and not every 10 minutes.
        writeJson(filed, { ...after, [owed.key]: { ...mark, refused: made.why ?? `status ${made.status}` } })
        say(`big suite: the work API refused its fix step "${step.title}": ${made.why ?? made.status}`)
      } else {
        const { [owed.key]: _gone, ...rest } = after
        writeJson(filed, rest)
      }
    }
  }
  return ids.length === 0 ? null : ids.at(-1)
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
    did.filed = await fileOwed({ results, files, landings, filed, commitsBetween, make, read, now, say })
  } catch (error) {
    say(`big suite: its fix step could not be filed now: ${error.message}`)
  }
  const queued = () => bigRunQueued(lock, tool, alive, now)
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
