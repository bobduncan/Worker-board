// F10 (2026-11-14): the boards survive a Claude app update. The watcher: run every 5 minutes and at logon by a Windows scheduled task
// (src/watcherSetup.mjs, `npm run setup`), hidden (wscript), for every board of this PC (~/.worker-board/boards.json, G8). For each
// board: the HTTP answer first (G6: a board that answers costs one request and no process query); then one WMI listing of the node
// processes (with the last boot time) for every board that did not answer; the landing lock, data/stop.json and data/started.json;
// the decision (src/boardWatcher.mjs); a start through the WMI route (src/keeperStart.mjs `startKeeper`, never as this process's
// child: the Task Scheduler ends a task's process tree at its time limit); one board.log line per start, none when nothing is done.
// The watcher's own record: ~/.worker-board/watcher.json (the starts per hour per board, the silent looks). Chat 1's review
// (2026-11-14): a listing that fails or cannot be read starts nothing (one log line per silent board: never a second keeper on a
// guess); one pass at a time on the PC (~/.worker-board/watcher.lock, taken with `wx`, stale after LOCK_STALE_MS); a start passes
// `--started-by watcher`, so the board's page says "started by the watcher"; the cut-off for stop signs is the person's logon.
//
//   node tools/watch-boards.mjs            looks at every board and acts
//   node tools/watch-boards.mjs --dry      says what it would do, does nothing (no log line either)

import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { lockHolder } from '../src/landing.mjs'
import { parseStop } from '../src/boardSelf.mjs'
import { boardsFile, readBoards } from '../src/ports.mjs'
import { LIST_SCRIPT, keepersOf, parseProcessList, powershell, startKeeper, logLine } from '../src/keeperStart.mjs'
import { watchDecision, watcherRecordOf } from '../src/boardWatcher.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WAIT_MS = 25_000
/** A watcher lock older than this belongs to a pass that died (the task's own limit is 4 minutes): it is broken. */
export const LOCK_STALE_MS = 4 * 60_000
/** What the watcher's start hands the board, so its page and gap line say who started it (src/history.mjs START_HOWS). */
export const START_ARGS = ['--started-by', 'watcher']

/**
 * One pass at a time: takes `file` with `wx` (the pid and time inside); a lock younger than LOCK_STALE_MS is another pass's: `{ taken:
 * false, why }`; an older one is broken and taken. Answers `{ taken: true, release }`.
 */
export function takeWatcherLock(file, now = Date.now(), fs = { openSync, closeSync, readFileSync, unlinkSync, writeFileSync }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx')
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: now }))
      } finally {
        fs.closeSync(fd)
      }
      return { taken: true, release: () => { try { fs.unlinkSync(file) } catch { /* gone already */ } } }
    } catch (error) {
      if (error?.code !== 'EEXIST') return { taken: false, why: `the lock ${file} could not be taken: ${error?.message ?? error}` }
      let held = null
      try {
        held = JSON.parse(fs.readFileSync(file, 'utf8'))
      } catch {
        // unreadable: age unknown
      }
      const age = Number.isFinite(held?.at) ? now - held.at : null
      if (age !== null && age < LOCK_STALE_MS) return { taken: false, why: `another pass runs (process ${held.pid}, ${Math.round(age / 1000)} s ago)` }
      try {
        fs.unlinkSync(file)
      } catch {
        return { taken: false, why: `a stale lock ${file} could not be broken` }
      }
    }
  }
  return { taken: false, why: `the lock ${file} could not be taken` }
}

/** Whether a worker board answers on the port: its page names itself. */
export async function boardAnswers(port) {
  try {
    const answer = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) })
    return answer.ok && (await answer.text()).includes('<title>Worker board</title>')
  } catch {
    return false
  }
}

const readJson = async file => {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * One pass over the boards. `tools` for the tests: `boards` (the list), `answers(port)`, `listProcesses()` (-> `{ bootAt, processes }`
 * or null), `start({ dir })`, `now`, `record`/`keepRecord`, `log(dir, text)`, `isDry`. Answers `[{ folder, port, do, why }]`.
 */
export async function watchOnce({
  boards, answers = boardAnswers, listProcesses = async () => parseProcessList(await powershell(LIST_SCRIPT, 30_000)), start = ({ dir }) => startKeeper({ dir, args: START_ARGS }),
  now = Date.now(), record = { boards: {} }, keepRecord = async () => {}, log = logLine, isDry = false, wait = waitForAnswer, readStarted = dir => readJson(join(dir, 'data', 'started.json')),
} = {}) {
  const outcomes = []
  const silent = []
  for (const board of boards) {
    const dir = resolve(board.folder)
    if (await answers(board.port)) {
      const kept = record.boards[dir]
      if (kept !== undefined && (kept.silentLooks !== 0)) record.boards[dir] = { ...kept, silentLooks: 0 }
      outcomes.push({ folder: dir, port: board.port, do: 'nothing', why: 'the board answers' })
    } else silent.push({ ...board, dir })
  }
  if (silent.length > 0) {
    let listingError = null
    const listed = await listProcesses().catch(error => { listingError = error?.message ?? String(error); return null })
    if (listed === null && listingError === null) listingError = 'the listing could not be read'
    for (const board of silent) {
      const dir = board.dir
      if (listed === null) {
        // Never a start on a guess: a keeper may run. One line per silent board; the next pass looks again.
        const why = `the PC's processes could not be listed (${listingError}) while the board does not answer: nothing started`
        outcomes.push({ folder: dir, port: board.port, do: 'nothing', why })
        if (!isDry) log(dir, `watcher: ${why}`, now)
        continue
      }
      const lock = lockHolder(join(dir, 'data', 'landing.lock'), now)
      const stop = parseStop(await readFile(join(dir, 'data', 'stop.json'), 'utf8').catch(() => ''))
      const started = await readStarted(dir)
      const decided = watchDecision({
        answers: false, keepers: keepersOf(listed.processes, dir), lockAgeMs: lock === null ? null : lock.ageMs, stop,
        startedAt: Number.isFinite(started?.at) ? started.at : null, bootAt: listed.logonAt ?? listed.bootAt ?? null, now, record: record.boards[dir],
      })
      record.boards[dir] = decided.record
      outcomes.push({ folder: dir, port: board.port, do: decided.do, why: decided.why })
      if (isDry) continue
      if (decided.do === 'say' || decided.do === 'leave') log(dir, `watcher: ${decided.why}`, now)
      if (decided.do === 'start') {
        const made = await start({ dir })
        const answered = await wait(board.port, answers)
        log(dir, `watcher: started the board (${decided.why}): keeper process ${made.pid} by ${made.how === 'wmi' ? 'WMI' : 'a plain spawn'}${answered ? '' : `; it did not answer within ${WAIT_MS / 1000} s`}`, now)
      }
    }
  }
  if (!isDry) await keepRecord(record)
  return outcomes
}

async function waitForAnswer(port, answers) {
  const until = Date.now() + WAIT_MS
  while (Date.now() < until) {
    if (await answers(port)) return true
    await new Promise(done => setTimeout(done, 500))
  }
  return false
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const isDry = process.argv.includes('--dry')
  const file = boardsFile()
  const boards = await readBoards(file)
  const recordFile = join(dirname(file), 'watcher.json')
  const lock = isDry ? { taken: true, release: () => {} } : takeWatcherLock(join(dirname(file), 'watcher.lock'))
  if (!lock.taken) {
    console.log(`watcher: ${lock.why}; this pass does nothing`)
    process.exit(0)
  }
  try {
    const record = watcherRecordOf(await readFile(recordFile, 'utf8').catch(() => ''))
    const outcomes = await watchOnce({
      boards, record, isDry,
      start: ({ dir }) => startKeeper({ dir, args: START_ARGS }),
      keepRecord: async kept => writeFile(recordFile, JSON.stringify(kept)),
    })
    for (const one of outcomes) if (isDry || one.do !== 'nothing') console.log(`${one.port} (${one.folder}): ${one.do}: ${one.why}`)
  } finally {
    lock.release()
  }
  // The WMI children are no children of ours; nothing keeps this process alive.
  process.exit(0)
}
