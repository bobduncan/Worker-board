// B211: starts the worker board in the background, when it does not run yet, without the Workers mod. For a person
// at a command line, or as a SessionStart hook of the project's chats (examples/settings.json), so the board runs
// as soon as a chat of the project opens:
//
//   node start-board.mjs                  starts this folder's board, or says where it runs already
//   node start-board.mjs --quiet          the same, and says nothing unless something went wrong (for the hook)
//   node start-board.mjs --open           the same, and opens the board's page in the browser (B320: a project's icon)
//   node start-board.mjs --anew          starts a new keeper although a board answers (land.ps1's cold restart: the new
//                                         keeper takes the port once the old board is stopped)
//   node start-board.mjs --stop          stops this folder's board on purpose: the stop sign first (data/stop.json, so the
//                                         watcher leaves it down), then its keeper and child
//   node start-board.mjs --port 4321 ...  anything else is handed to server.mjs as it is
//
// The board's own output goes to data/board.log. A board that cannot start (a broken settings file, the first start
// that makes config.json) has its words printed here, and this ends with 1.
//
// F10 (2026-11-14): the keeper is started OUTSIDE any job, through WMI (src/keeperStart.mjs `startKeeper`): a keeper started as a
// child of a chat's shell sat in the Claude app's job and died with the app's update (2026-11-11). The line names the keeper's
// real pid. When WMI refuses, the old detached spawn runs, with a board.log line saying so.
//
// F24a (2026-11-14): a slow board is a running board. The runs-already check waits ANSWER_MS for the page (the main board
// answered in 8-11 s on 2026-11-14 and failed a 1.5 s check; every chat's mod then ran this script once a minute and each
// run made a new keeper whose child died on "Port 4310 is in use"); a board that still does not answer counts as running
// when a keeper of this folder runs or a process of this folder holds the port (slow or starting: the keeper brings it
// back), and nothing is started. Another program on the port: said, nothing started, 1. A listing that fails twice (20 s
// each): unknown, said, nothing started, 1, unless nothing listens (the connection refused) and netstat saw no holder: then
// the start goes with a note (a duplicate keeper dies on EADDRINUSE; a board left down heals nothing). Only a free port with
// no keeper of this folder starts one (src/keeperStart.mjs `runsAlready`). PowerShell and netstat run hidden (windowsHide: this script runs detached
// from a chat's mod; a console program started without it pops a terminal up, 758178e5).

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { constants as osConstants, setPriority } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfig } from './src/config.mjs'
import { gitRunner } from './src/folders.mjs'
import { LIST_MS, LIST_SCRIPT, endKeeper, keepersOf, netstat, parseProcessList, portHolderOf, powershell, runsAlready, startKeeper } from './src/keeperStart.mjs'
import { boardsFile, resolvePort } from './src/ports.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOST = '127.0.0.1'
const WAIT_MS = 20_000
/** F24a: how long the runs-already check waits for the page of a board that is slow. */
export const ANSWER_MS = 15_000

/** Whether a worker board answers on the port within `timeoutMs`: its page names itself. */
export async function boardAt(port, timeoutMs = 1500) {
  return (await probeBoard(port, timeoutMs)) === 'answers'
}

/**
 * F24: what the port says within `timeoutMs`: 'answers' (the board's page), 'refused' (nothing listens: the connection was refused at
 * once) or 'silent' (anything else: a timeout, another program's page, a reset).
 */
export async function probeBoard(port, timeoutMs = 1500) {
  try {
    const answer = await fetch(`http://${HOST}:${port}/`, { signal: AbortSignal.timeout(timeoutMs) })
    return answer.ok && (await answer.text()).includes('<title>Worker board</title>') ? 'answers' : 'silent'
  } catch (error) {
    const codes = [error?.cause?.code, error?.code, ...(Array.isArray(error?.cause?.errors) ? error.cause.errors.map(one => one?.code) : [])]
    return codes.includes('ECONNREFUSED') ? 'refused' : 'silent'
  }
}

/**
 * F24a: whether this folder's board runs: its page within ANSWER_MS (a slow board is a running board), else (Windows) one listing of
 * the node processes (tried twice) and the holder of the port, judged by `runsAlready`. A listing that fails or times out both
 * times: unknown, no start (a keeper may run), unless the port refused the connection and netstat saw no holder: a start with a note.
 */
export async function boardRuns(port, { answers = probeBoard, list = () => powershell(LIST_SCRIPT, LIST_MS), ports = () => netstat(LIST_MS), platform = process.platform, dir = HERE, isDemo = false } = {}) {
  const answerSeconds = ANSWER_MS / 1000
  const probed = await answers(port, ANSWER_MS)
  if (probed === true || probed === 'answers') return runsAlready({ dir, answers: true, answerSeconds })
  if (platform !== 'win32') return { runs: false }
  let listingError = null
  const once = () => list().then(text => { const read = parseProcessList(text, { ownPid: process.pid }); if (read === null) throw new Error('the listing was not JSON, or lacks this process'); return read })
  const twice = () => once().catch(first => once().catch(second => { listingError = `${first?.message ?? first}; again: ${second?.message ?? second}`; return null }))
  // netstat's answer is told from no answer: a failed netstat is unknown, a free port is known free.
  const [listed, held] = await Promise.all([twice(), ports().then(text => ({ known: true, holder: portHolderOf(text, port) }), () => ({ known: false, holder: null }))])
  return runsAlready({ dir, port, isDemo, answers: false, isRefused: probed === 'refused', holderKnown: held.known, processes: listed?.processes ?? null, holder: held.holder, answerSeconds, listingError })
}

/** B320: the program that opens a page in the person's browser, with its words. */
export function openCommand(url, platform = process.platform) {
  if (platform === 'win32') return ['explorer.exe', [url]]
  return platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
}

/** Opens the board's page; the browser stays when this ends. */
function openPage(url) {
  const [program, words] = openCommand(url)
  try {
    spawn(program, words, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch {
    console.log(`Open ${url} in your browser.`)
  }
}

/** What this start wrote into the board's log (from `from` on), whole. */
const logSince = (file, from) => {
  try {
    return readFileSync(file).subarray(from).toString('utf8').trim()
  } catch {
    return ''
  }
}
/** What this start wrote into the board's log (from `from` on), its last lines, for a start that failed. */
const lastWords = (file, from) => logSince(file, from).split('\n').slice(-3).join('\n')

/**
 * F10's round 4: how an early end of the keeper (or of the child, on the fallback route) is read: a 'race' when the log since the start
 * says the port was in use (another keeper's board won it: the board answers seconds later, so the wait goes on), else a 'fail' (said
 * at once). Under --anew a lost race is a failure too: the "winner" is the old board land.ps1's cold restart kills next.
 */
export function earlyEndVerdict({ words, isAnew = false }) {
  return !isAnew && /is in use|EADDRINUSE/.test(String(words ?? '')) ? 'race' : 'fail'
}

/** Whether a process is there (a signal 0). */
const isAlive = pid => { try { process.kill(pid, 0); return true } catch { return false } }

/** F10: `--stop`: the stop sign first (the watcher then leaves the board down), then the keeper and its child, found by their command lines; the sign again once they are gone. */
async function stopBoard(isQuiet, passed) {
  mkdirSync(join(HERE, 'data'), { recursive: true })
  // This board's keepers only (its port, the demo's when --stop --demo): a demo keeper of the folder is left alone (chat 1's round-3 check).
  const port = await portOf(passed)
  const isDemo = passed.includes('--demo')
  // The stop sign is the REAL board's alone (no --demo, the folder's own port): a sign written for a demo or another port would hold
  // the watcher off the real board across an app update, the case F10 exists for (chat 1's round-4 check).
  const isRealBoard = !isDemo && port === await portOf(passed.filter((word, at, all) => word !== '--port' && all[at - 1] !== '--port'))
  const sign = () => { if (isRealBoard) writeFileSync(join(HERE, 'data', 'stop.json'), JSON.stringify({ at: Date.now(), why: 'stopped', by: 'command', ...(Number.isFinite(started) ? { started } : {}) })) }
  let started = null
  try {
    started = JSON.parse(readFileSync(join(HERE, 'data', 'started.json'), 'utf8')).at
  } catch {
    // never started here, or not recorded
  }
  sign()
  let keepers = []
  try {
    const listed = parseProcessList(await powershell(LIST_SCRIPT, 30_000), { ownPid: process.pid })
    if (listed === null) throw new Error('the listing was not JSON, or lacks this process')
    keepers = keepersOf(listed.processes, HERE, port, { isDemo })
  } catch (error) {
    console.error(`The board's processes could not be listed: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  for (const keeper of keepers) endKeeper(keeper)
  // The board's own exit writes a sign without `by` over ours: wait for the processes to be gone, then write the sign again (chat 1's review).
  const pids = keepers.flatMap(one => [one.pid, ...one.children])
  const until = Date.now() + 10_000
  while (Date.now() < until && pids.some(isAlive)) await new Promise(done => setTimeout(done, 200))
  sign()
  const kept = isRealBoard ? 'the stop sign is written; the watcher leaves it down until the next start' : `no stop sign (${isDemo ? 'a demo' : `port ${port}`} is not this folder's board)`
  if (!isQuiet) console.log(keepers.length === 0 ? `No board of this folder was running on port ${port}; ${kept}.` : `The worker board on port ${port} is stopped (keeper ${keepers.map(one => one.pid).join(', ')}); ${kept}.`)
  return 0
}

/** The port the board takes for these words, as the server works it out (a broken settings file is the server's to name). */
async function portOf(passed) {
  const given = passed.includes('--port') ? passed[passed.indexOf('--port') + 1] : undefined
  const config = await loadConfig(join(HERE, 'config.json')).catch(() => ({ port: 4310, gamePort: 5300, project: '' }))
  // B319: with the PC's list of boards, as the server reads it: another project's board may hold the configured port.
  const isDemo = passed.includes('--demo')
  const boards = isDemo || !config.project ? null : boardsFile()
  const { port } = await resolvePort({ here: HERE, given, configured: config.port, run: gitRunner(), project: config.project ? resolve(HERE, config.project) : null, gamePort: config.gamePort, boards })
  return port
}

async function main(args) {
  const isQuiet = args.includes('--quiet')
  const isOpen = args.includes('--open')
  const isAnew = args.includes('--anew')
  const passed = args.filter(arg => arg !== '--quiet' && arg !== '--open' && arg !== '--anew' && arg !== '--stop')
  if (args.includes('--stop')) return stopBoard(isQuiet, passed)
  const isDemo = passed.includes('--demo')
  const port = await portOf(passed)
  const url = `http://${HOST}:${port}/`
  // F10's --anew (land.ps1's cold restart) starts a keeper although the board answers; every other start asks first (F24).
  // WORKER_BOARD_SKIP_CHECK: the test's way to a start that crosses another's (test/startBoard.test.mjs, the port race); nothing else sets it.
  const runs = isAnew || process.env.WORKER_BOARD_SKIP_CHECK === '1' ? { runs: false } : await boardRuns(port, { isDemo })
  if (runs.runs) {
    if (!isQuiet) console.log(`The worker board runs already: ${url}${runs.why === 'it answers' ? '' : ` (${runs.why})`}`)
    if (isOpen) openPage(url)
    return 0
  }
  if (runs.foreign) {
    console.error(`Port ${port} is held by process ${runs.foreign.pid}${runs.foreign.commandLine ? ` (${runs.foreign.commandLine})` : ''}, not by this folder's board: nothing started.`)
    return 1
  }
  if (runs.unknown) {
    console.error(`The worker board on ${url} did not answer within ${ANSWER_MS / 1000} seconds and ${runs.unknown}.`)
    return 1
  }
  if (runs.note && !isQuiet) console.log(`Note: ${runs.note}.`)

  mkdirSync(join(HERE, 'data'), { recursive: true })
  const logFile = join(HERE, 'data', 'board.log')
  let from = 0
  try {
    from = statSync(logFile).size
  } catch {
    // A first log.
  }
  // F10: the keeper outside any job (WMI), else the old detached child with a log line saying so.
  const made = await startKeeper({ dir: HERE, args: passed })
  let ended = null
  let raceLost = false
  made.child?.on('exit', code => { ended = code ?? 1 })
  const until = Date.now() + WAIT_MS
  while (Date.now() < until) {
    // An early end of the keeper (a WMI keeper is no child of ours: its end shows only by its pid) or of the child on the fallback route.
    // The keeper ends when its board dies before it is up. One that ended on the port race ("Port N is in use": another keeper's board
    // won it) is no failure yet: the board answers seconds later, so the wait goes on to WAIT_MS (chat 1's re-check: land.ps1 rolled
    // back on that early 1); under --anew it is one (the winner is the old board the cold restart kills next). Any other end: 1 at once.
    const endedEarly = ended !== null || (made.how === 'wmi' && !isAlive(made.pid))
    if (endedEarly && !raceLost) {
      if (earlyEndVerdict({ words: logSince(logFile, from), isAnew }) === 'race') raceLost = true
      else {
        console.error(lastWords(logFile, from) || (ended !== null ? `The worker board did not start (it ended with ${ended}).` : `The worker board did not start (its keeper, process ${made.pid}, ended before the board answered).`))
        return 1
      }
    }
    if (await boardAt(port)) {
      if (!isQuiet) console.log(raceLost ? `The worker board runs already: ${url} (another keeper won the port; this one, process ${made.pid}, ended)` : `The worker board runs: ${url} (process ${made.pid}; its words go to data/board.log${made.how === 'wmi' ? '' : '; started as a child, not through WMI'})`)
      if (isOpen) openPage(url)
      return 0
    }
    await new Promise(done => setTimeout(done, 300))
  }
  console.error(`The worker board did not answer on ${url} within ${WAIT_MS / 1000} seconds; see data/board.log.`)
  return 1
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  // F24 (chat 1's review and re-check): this script's first act, when it RUNS (not when a test imports it), is Normal priority. A chat
  // under CPU Low runs it at Idle on two crowded cores, and everything it starts (PowerShell, netstat, the keeper and so the board)
  // would inherit that and starve. ESM evaluates the imports first; this script's own graph is small, the board's is server.mjs's.
  try {
    setPriority(osConstants.priority.PRIORITY_NORMAL)
  } catch {
    // not allowed here: the board raises itself too (server.mjs)
  }
  // 2026-11-02 (the gate's flake since change 5: "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c",
  // exit 0xC0000409, once in a few runs of start-board's tests): `process.exit` right after `child.unref()` ended the
  // process while libuv still closed the detached child's handle on Windows. The code is set and the loop drains by itself
  // (the child is unref'd, the log fd closed); a hard exit comes only when something keeps the loop alive a second longer.
  const code = await main(process.argv.slice(2))
  process.exitCode = code
  setTimeout(() => process.exit(code), 1000).unref()
}
