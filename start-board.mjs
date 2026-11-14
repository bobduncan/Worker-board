// B211: starts the worker board in the background, when it does not run yet, without the Workers mod. For a person
// at a command line, or as a SessionStart hook of the project's chats (examples/settings.json), so the board runs
// as soon as a chat of the project opens:
//
//   node start-board.mjs                  starts this folder's board, or says where it runs already
//   node start-board.mjs --quiet          the same, and says nothing unless something went wrong (for the hook)
//   node start-board.mjs --open           the same, and opens the board's page in the browser (B320: a project's icon)
//   node start-board.mjs --port 4321 ...  anything else is handed to server.mjs as it is
//
// The board's own output goes to data/board.log. A board that cannot start (a broken settings file, the first start
// that makes config.json) has its words printed here, and this ends with 1.
//
// F24a (2026-11-14): a slow board is a running board. The runs-already check waits ANSWER_MS for the page (the main board
// answered in 8-11 s on 2026-11-14 and failed a 1.5 s check; every chat's mod then ran this script once a minute and each
// run made a new keeper whose child died on "Port 4310 is in use"); a board that still does not answer counts as running
// when a keeper of this folder runs or a process of this folder holds the port (slow or starting: the keeper brings it
// back), and nothing is started. Another program on the port: said, nothing started, 1. A listing that fails or takes
// longer than 10 s: said, nothing started, 1 (never a start on a guess). Only a free port with no keeper of this folder
// starts one (src/keeperStart.mjs `runsAlready`). PowerShell and netstat run hidden (windowsHide: this script runs detached
// from a chat's mod; a console program started without it pops a terminal up, 758178e5).

import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs'
import { constants as osConstants, setPriority } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfig } from './src/config.mjs'
import { startEnv } from './src/keeper.mjs'
import { gitRunner } from './src/folders.mjs'
import { LIST_MS, LIST_SCRIPT, netstat, parseProcessList, portHolderOf, powershell, runsAlready } from './src/keeperStart.mjs'
import { boardsFile, resolvePort } from './src/ports.mjs'

// F24 (chat 1's review): this script's first act is Normal priority. A chat under CPU Low runs it at Idle on two crowded cores, and
// everything it starts (PowerShell, netstat, the keeper and so the board) would inherit that and starve. ESM evaluates the imports
// above first; this script's own graph is small (config, keeper, folders, ports, keeperStart), the board's is server.mjs's.
try {
  setPriority(osConstants.priority.PRIORITY_NORMAL)
} catch {
  // not allowed here: the board raises itself too (server.mjs)
}

const HERE = dirname(fileURLToPath(import.meta.url))
const HOST = '127.0.0.1'
const WAIT_MS = 20_000
/** F24a: how long the runs-already check waits for the page of a board that is slow. */
export const ANSWER_MS = 15_000

/** Whether a worker board answers on the port within `timeoutMs`: its page names itself. */
export async function boardAt(port, timeoutMs = 1500) {
  try {
    const answer = await fetch(`http://${HOST}:${port}/`, { signal: AbortSignal.timeout(timeoutMs) })
    return answer.ok && (await answer.text()).includes('<title>Worker board</title>')
  } catch {
    return false
  }
}

/**
 * F24a: whether this folder's board runs: its page within ANSWER_MS (a slow board is a running board), else (Windows) one listing of
 * the node processes (tried twice) and the holder of the port, judged by `runsAlready`. A listing that fails or times out both
 * times: unknown, no start (never a start on a guess: a keeper may run).
 */
export async function boardRuns(port, { answers = boardAt, list = () => powershell(LIST_SCRIPT, LIST_MS), ports = () => netstat(LIST_MS), platform = process.platform, dir = HERE } = {}) {
  const answerSeconds = ANSWER_MS / 1000
  if (await answers(port, ANSWER_MS)) return runsAlready({ dir, answers: true, answerSeconds })
  if (platform !== 'win32') return { runs: false }
  let listingError = null
  const once = () => list().then(text => { const read = parseProcessList(text); if (read === null) throw new Error('the listing was not JSON'); return read })
  const twice = () => once().catch(first => once().catch(second => { listingError = `${first?.message ?? first}; again: ${second?.message ?? second}`; return null }))
  const [listed, holder] = await Promise.all([twice(), ports().then(text => portHolderOf(text, port), () => null)])
  return runsAlready({ dir, port, answers: false, processes: listed?.processes ?? null, holder, answerSeconds, listingError })
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

/** What this start wrote into the board's log (from `from` on), its last lines, for a start that failed. */
const lastWords = (file, from) => {
  try {
    return readFileSync(file).subarray(from).toString('utf8').trim().split('\n').slice(-3).join('\n')
  } catch {
    return ''
  }
}

async function main(args) {
  const isQuiet = args.includes('--quiet')
  const isOpen = args.includes('--open')
  const passed = args.filter(arg => arg !== '--quiet' && arg !== '--open')
  const given = passed.includes('--port') ? passed[passed.indexOf('--port') + 1] : undefined
  // The port the board takes, as the server works it out; a broken settings file is the server's to name.
  const config = await loadConfig(join(HERE, 'config.json')).catch(() => ({ port: 4310, gamePort: 5300, project: '' }))
  // B319: with the PC's list of boards, as the server reads it: another project's board may hold the configured port.
  const isDemo = passed.includes('--demo')
  const boards = isDemo || !config.project ? null : boardsFile()
  const { port } = await resolvePort({ here: HERE, given, configured: config.port, run: gitRunner(), project: config.project ? resolve(HERE, config.project) : null, gamePort: config.gamePort, boards })
  const url = `http://${HOST}:${port}/`
  const runs = await boardRuns(port)
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

  mkdirSync(join(HERE, 'data'), { recursive: true })
  const logFile = join(HERE, 'data', 'board.log')
  let from = 0
  try {
    from = statSync(logFile).size
  } catch {
    // A first log.
  }
  const log = openSync(logFile, 'a')
  const child = spawn(process.execPath, [join(HERE, 'server.mjs'), ...passed], { cwd: HERE, env: startEnv(process.env), detached: true, stdio: ['ignore', log, log], windowsHide: true })
  // The child has its own copy of the log's descriptor: this one is closed, so nothing of it is left open at the end.
  closeSync(log)
  let ended = null
  child.on('exit', code => { ended = code ?? 1 })
  const until = Date.now() + WAIT_MS
  while (Date.now() < until) {
    if (ended !== null) {
      console.error(lastWords(logFile, from) || `The worker board did not start (it ended with ${ended}).`)
      return 1
    }
    if (await boardAt(port)) {
      child.unref()
      if (!isQuiet) console.log(`The worker board runs: ${url} (process ${child.pid}; its words go to data/board.log)`)
      if (isOpen) openPage(url)
      return 0
    }
    await new Promise(done => setTimeout(done, 300))
  }
  child.unref()
  console.error(`The worker board did not answer on ${url} within ${WAIT_MS / 1000} seconds; see data/board.log.`)
  return 1
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  // 2026-11-02 (the gate's flake since change 5: "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c",
  // exit 0xC0000409, once in a few runs of start-board's tests): `process.exit` right after `child.unref()` ended the
  // process while libuv still closed the detached child's handle on Windows. The code is set and the loop drains by itself
  // (the child is unref'd, the log fd closed); a hard exit comes only when something keeps the loop alive a second longer.
  const code = await main(process.argv.slice(2))
  process.exitCode = code
  setTimeout(() => process.exit(code), 1000).unref()
}
