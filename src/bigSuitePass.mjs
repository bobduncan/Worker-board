// S9: the board's pass for the big suite (server.mjs, every 10 minutes, only on the PC's first board, the one that runs the loops). It
// files the fix step of a red big run once (the go-lives since the last green run in it), and starts the runner (tools/big-suite.mjs)
// when a run is due and none is alive. The runner and its results lie beside the PC's test lock (src/bigSuite.mjs stateFiles); what
// the board filed lies in its own data folder (`filed`), so the two never write the same file.

import { bugPlace } from './bugs.mjs'
import {
  bigRunQueued, dueNow, fixStepOf, goLivesIn, readJson, readLandings, runnerAlive, stateFiles, writeJson,
} from './bigSuite.mjs'

/** How often the board looks. */
export const BIG_SUITE_LOOK_MS = 10 * 60 * 1000

/**
 * One pass. `lock` the PC's test lock; `tool` the one-at-a-time module; `landings` data/landings.jsonl; `filed` the board's own record
 * of the red runs it filed; `mainHead()` main's head (null when git cannot tell); `commitsBetween(from, to)` the commits of `to` that are
 * not in `from` (a Set; all of `to`'s recent ones when `from` is null); `start()` starts the runner (detached); `make(call)` one work-API
 * action as the person; `read()` the work store. Resolves to what it did (for the tests).
 */
export async function bigSuitePass({ lock, tool, landings, filed, mainHead, commitsBetween, start, make, read, now = Date.now(), alive }) {
  const files = stateFiles(lock)
  const results = readJson(files.results)
  const did = { filed: null, started: null }
  const last = results.last
  const record = readJson(filed)
  if (last?.outcome === 'failed' && record[last.commit] === undefined) {
    const goLives = goLivesIn(readLandings(landings), await commitsBetween(results.lastGreen ?? null, last.commit))
    const step = fixStepOf({ run: last, lastGreen: results.lastGreen ?? null, goLives, log: files.log })
    const stored = await read()
    const place = bugPlace('board', stored?.items, stored?.activities)
    if (place.activity !== null) {
      const made = await make({
        action: 'new', title: step.title, activity: place.activity, ...(place.goal === null ? {} : { goal: place.goal }), priority: 'fix',
        text: [...step.text, 'Filed by the board itself (the big suite, S9), not by the person.'],
      })
      if (made.ok) {
        writeJson(filed, { ...record, [last.commit]: { id: made.result?.id ?? null, at: new Date(now).toISOString() } })
        did.filed = made.result?.id ?? null
      }
    }
  }
  const queued = () => bigRunQueued(lock, tool, alive)
  if (runnerAlive(readJson(files.runner, null), now, alive, queued)) return did
  const why = dueNow({ results, mainHead: await mainHead(), now })
  if (why !== null) {
    start()
    did.started = why
  }
  return did
}
