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

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfig } from './src/config.mjs'
import { LIST_SCRIPT, endKeeper, keepersOf, parseProcessList, powershell, startKeeper } from './src/keeperStart.mjs'
import { gitRunner } from './src/folders.mjs'
import { boardsFile, resolvePort } from './src/ports.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOST = '127.0.0.1'
const WAIT_MS = 20_000

/** Whether a worker board answers on the port: its page names itself. */
export async function boardAt(port) {
  try {
    const answer = await fetch(`http://${HOST}:${port}/`, { signal: AbortSignal.timeout(1500) })
    return answer.ok && (await answer.text()).includes('<title>Worker board</title>')
  } catch {
    return false
  }
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

/** Whether a process is there (a signal 0). */
const isAlive = pid => { try { process.kill(pid, 0); return true } catch { return false } }

/** F10: `--stop`: the stop sign first (the watcher then leaves the board down), then the keeper and its child, found by their command lines; the sign again once they are gone. */
async function stopBoard(isQuiet) {
  mkdirSync(join(HERE, 'data'), { recursive: true })
  let started = null
  try {
    started = JSON.parse(readFileSync(join(HERE, 'data', 'started.json'), 'utf8')).at
  } catch {
    // never started here, or not recorded
  }
  writeFileSync(join(HERE, 'data', 'stop.json'), JSON.stringify({ at: Date.now(), why: 'stopped', by: 'command', ...(Number.isFinite(started) ? { started } : {}) }))
  let keepers = []
  try {
    keepers = keepersOf(parseProcessList(await powershell(LIST_SCRIPT, 30_000))?.processes ?? [], HERE)
  } catch (error) {
    console.error(`The board's processes could not be listed: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  for (const keeper of keepers) endKeeper(keeper)
  // The board's own exit writes a sign without `by` over ours: wait for the processes to be gone, then write the sign again (chat 1's review).
  const pids = keepers.flatMap(one => [one.pid, ...one.children])
  const until = Date.now() + 10_000
  while (Date.now() < until && pids.some(isAlive)) await new Promise(done => setTimeout(done, 200))
  writeFileSync(join(HERE, 'data', 'stop.json'), JSON.stringify({ at: Date.now(), why: 'stopped', by: 'command', ...(Number.isFinite(started) ? { started } : {}) }))
  if (!isQuiet) console.log(keepers.length === 0 ? 'No board of this folder was running; the stop sign is written.' : `The worker board is stopped (keeper ${keepers.map(one => one.pid).join(', ')}); the watcher leaves it down until the next start.`)
  return 0
}

async function main(args) {
  const isQuiet = args.includes('--quiet')
  const isOpen = args.includes('--open')
  const isAnew = args.includes('--anew')
  if (args.includes('--stop')) return stopBoard(isQuiet)
  const passed = args.filter(arg => arg !== '--quiet' && arg !== '--open' && arg !== '--anew')
  const given = passed.includes('--port') ? passed[passed.indexOf('--port') + 1] : undefined
  // The port the board takes, as the server works it out; a broken settings file is the server's to name.
  const config = await loadConfig(join(HERE, 'config.json')).catch(() => ({ port: 4310, gamePort: 5300, project: '' }))
  // B319: with the PC's list of boards, as the server reads it: another project's board may hold the configured port.
  const isDemo = passed.includes('--demo')
  const boards = isDemo || !config.project ? null : boardsFile()
  const { port } = await resolvePort({ here: HERE, given, configured: config.port, run: gitRunner(), project: config.project ? resolve(HERE, config.project) : null, gamePort: config.gamePort, boards })
  const url = `http://${HOST}:${port}/`
  if (!isAnew && await boardAt(port)) {
    if (!isQuiet) console.log(`The worker board runs already: ${url}`)
    if (isOpen) openPage(url)
    return 0
  }

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
  made.child?.on('exit', code => { ended = code ?? 1 })
  const until = Date.now() + WAIT_MS
  while (Date.now() < until) {
    if (ended !== null) {
      console.error(lastWords(logFile, from) || `The worker board did not start (it ended with ${ended}).`)
      return 1
    }
    // A WMI keeper is no child of ours: its end shows only by its pid (the keeper ends when its board dies before it is up).
    if (made.how === 'wmi' && !isAlive(made.pid)) {
      console.error(lastWords(logFile, from) || `The worker board did not start (its keeper, process ${made.pid}, ended before the board answered).`)
      return 1
    }
    if (await boardAt(port)) {
      if (!isQuiet) console.log(`The worker board runs: ${url} (process ${made.pid}; its words go to data/board.log${made.how === 'wmi' ? '' : '; started as a child, not through WMI'})`)
      if (isOpen) openPage(url)
      return 0
    }
    await new Promise(done => setTimeout(done, 300))
  }
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
