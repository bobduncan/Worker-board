// B211: starts the worker board in the background, when it does not run yet, without the Workers mod. For a person
// at a command line, or as a SessionStart hook of the project's chats (examples/settings.json), so the board runs
// as soon as a chat of the project opens:
//
//   node start-board.mjs                  starts this folder's board, or says where it runs already
//   node start-board.mjs --quiet          the same, and says nothing unless something went wrong (for the hook)
//   node start-board.mjs --port 4321 ...  anything else is handed to server.mjs as it is
//
// The board's own output goes to data/board.log. A board that cannot start (a broken settings file, the first start
// that makes config.json) has its words printed here, and this ends with 1.

import { spawn } from 'node:child_process'
import { mkdirSync, openSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfig } from './src/config.mjs'
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
  const passed = args.filter(arg => arg !== '--quiet')
  const given = passed.includes('--port') ? passed[passed.indexOf('--port') + 1] : undefined
  // The port the board takes, as the server works it out; a broken settings file is the server's to name.
  const config = await loadConfig(join(HERE, 'config.json')).catch(() => ({ port: 4310, gamePort: 5300, project: '' }))
  // B319: with the PC's list of boards, as the server reads it: another project's board may hold the configured port.
  const isDemo = passed.includes('--demo')
  const boards = isDemo || !config.project ? null : boardsFile()
  const { port } = await resolvePort({ here: HERE, given, configured: config.port, run: gitRunner(), project: config.project || null, gamePort: config.gamePort, boards })
  const url = `http://${HOST}:${port}/`
  if (await boardAt(port)) {
    if (!isQuiet) console.log(`The worker board runs already: ${url}`)
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
  const log = openSync(logFile, 'a')
  const child = spawn(process.execPath, [join(HERE, 'server.mjs'), ...passed], { cwd: HERE, detached: true, stdio: ['ignore', log, log], windowsHide: true })
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
      return 0
    }
    await new Promise(done => setTimeout(done, 300))
  }
  child.unref()
  console.error(`The worker board did not answer on ${url} within ${WAIT_MS / 1000} seconds; see data/board.log.`)
  return 1
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exit(await main(process.argv.slice(2)))
