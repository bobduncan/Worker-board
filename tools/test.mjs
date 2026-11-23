// B351: the board's tests on at most half the PC's cores (node --test starts one test file per core otherwise, which
// took the whole PC while a chat tested). `npm test` runs this; arguments after it go to node --test.
//
// 2026-11-11, the person: "too often claude slows down my pc very often ... the test suite", then "lets do A": the tests
// run at low priority, so Windows gives games and programs the CPU first, and one run at a time across all chats
// (tools/one-at-a-time.mjs). This process lowers itself to below normal before it starts node --test, which inherits it
// at its start (a below-normal parent's child is below normal on Windows, a nice value is inherited elsewhere), and so do
// its test files; node --test is lowered once more by its id, in case it was not. The cores are the PC's (os.cpus), not
// what this process may use (availableParallelism): under the board's "CPU for Claude: Low" a chat sees two of them,
// which gave one test file at a time and an hour-long gate; the affinity still holds the run to those two then.
//
// F39 (2026-11-21): a hung test file costs minutes, not the hour. node --test gets a per-test timeout (10 minutes,
// TEST_TIMEOUT_MS), which fails a test that hangs inside itself (taskWindowPage.test.mjs hung that way for an hour on 2026-11-21).
// And a stall watchdog: no output of the run for 15 minutes (TEST_STALL_MS) while it is open, a file that hangs at its top
// level, ends the run with its whole tree and a line naming the test files still open (tools/openFilesReporter.mjs writes them
// to a file of their own). A stalled run is a refusal (src/landing.mjs gatePassed), never rerun file by file: node --test held
// back the results of the files after the open one. The watchdog also ends what the run started outside its tree that names its
// folder (on a path boundary; never in a folder that is or holds a board's, nor when the list of boards cannot be read).
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Half the cores, at least one. */
export function halfTheCores(cores) {
  return Math.max(1, Math.floor(cores / 2))
}

export const LOW = os.constants.priority.PRIORITY_BELOW_NORMAL
/** F39: a test that runs longer than this fails (node --test's own timeout). */
export const TEST_TIMEOUT_MS = 10 * 60 * 1000
/** F39: no output of the run for this long ends it. */
export const STALL_MS = 15 * 60 * 1000
const WATCH_MS = 30 * 1000
const REPORTER = pathToFileURL(fileURLToPath(new URL('./openFilesReporter.mjs', import.meta.url))).href

const positive = (value, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

/**
 * F39: the files still open in the reporter's lines (`{ at: 'start'|'end', file, test }`, one JSON line each): a file taken up and
 * not ended, with the tests in it taken up and not ended. `[{ file, tests }]`, in the order they were taken up. PURE.
 */
export function openFiles(text) {
  const files = new Map()
  for (const line of String(text ?? '').split('\n')) {
    let read
    try {
      read = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof read?.file !== 'string') continue
    const one = files.get(read.file) ?? { file: read.file, open: false, tests: new Map() }
    files.set(read.file, one)
    if (read.test === null || read.test === undefined) one.open = read.at === 'start'
    else if (read.at === 'start') one.tests.set(read.test, (one.tests.get(read.test) ?? 0) + 1)
    else one.tests.set(read.test, (one.tests.get(read.test) ?? 1) - 1)
  }
  return [...files.values()].filter(one => one.open).map(one => ({ file: one.file, tests: [...one.tests].filter(([, n]) => n > 0).map(([name]) => name) }))
}

/**
 * F39: the line a stalled run ends with: what happened and the files still open (paths from `cwd`, with /). A stalled run is a
 * refusal (chat 1's review, blocker 2): node --test holds back the output of the files after the earliest unfinished one, so their
 * failures are lost and a rerun of the open files alone proves nothing; src/landing.mjs gatePassed reads this line as the verdict.
 */
export function stallLines(open, stallMs, cwd = process.cwd()) {
  const span = stallMs >= 60000 ? `${Math.round(stallMs / 60000)} minutes` : `${Math.round(stallMs / 1000)} seconds`
  const shown = file => relative(cwd, file).replace(/\\/g, '/')
  const named = open.map(one => `${shown(one.file)}${one.tests.length === 0 ? ' (at its top level)' : ` (${one.tests.join('; ')})`}`)
  return [`stalled: no test output for ${span}; files still open: ${named.length === 0 ? 'none named' : named.join(', ')}`]
}

/** F39, review 9: the folders of the boards on this PC (boards.json): a run there never sweeps them. */
export function boardFolders(env = process.env) {
  let text
  try {
    text = readFileSync(join(env.WORKER_BOARD_HOME || join(os.homedir(), '.worker-board'), 'boards.json'), 'utf8')
  } catch {
    // No list, or one that cannot be read: null, and the sweep fails closed (F39, the re-check). land.ps1's own clean-up of its gate
    // folder does not depend on this.
    return null
  }
  try {
    const read = JSON.parse(text.replace(/^\uFEFF/, ''))
    if (!Array.isArray(read?.boards)) return null
    return read.boards.map(one => one?.folder).filter(one => typeof one === 'string' && one !== '')
  } catch {
    return null
  }
}

/** F39, the re-check: whether `folder` is a board's folder or holds one (a run in the project folder holds the live board's). */
export function holdsBoard(folder, boards) {
  const top = resolve(folder).toLowerCase().replace(/[\\/]+$/, '')
  return boards.some(one => {
    const board = resolve(one).toLowerCase().replace(/[\\/]+$/, '')
    return board === top || board.startsWith(`${top}\\`) || board.startsWith(`${top}/`)
  })
}

/** F39, review 9: the pattern a command line must match to name `folder`: the folder, then a \\, a quote, a space or the end. */
export function insidePattern(folder) {
  const needle = String(folder).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  return `${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[\\\\"' ]|$)`
}

/**
 * F39 (part 6): ends what the run started outside its tree inside `folder` (a board a test started through WMI): every process whose
 * command line names the folder and that was made after `since` (never the chat's own programs there, which are older). Windows only.
 */
export function stopInside(folder, since, run = spawnSync, boards = boardFolders()) {
  if (process.platform !== 'win32') return
  // Never a board's own folder, nor one that holds a board (a run there would end the board itself, restarted after the run
  // began); and never when the list of boards cannot be read (fails closed).
  if (!Array.isArray(boards) || holdsBoard(folder, boards)) return
  const pattern = insidePattern(folder).replace(/'/g, "''")
  const script = [
    `$since = [DateTime]::FromFileTimeUtc(${Math.floor(since * 10000 + 116444736000000000)})`,
    `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.ProcessId -ne $PID -and $_.CreationDate -and $_.CreationDate.ToUniversalTime() -ge $since -and ([string]$_.CommandLine).Replace('/', '\\').ToLowerInvariant() -match '${pattern}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
  ].join('; ')
  try {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', windowsHide: true, timeout: 60_000 })
  } catch {
    // the sweep is a help, not a must
  }
}

function stopTree(child) {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    else child.kill('SIGKILL')
  } catch {
    // gone already
  }
}

/**
 * Runs node --test on `files` at below-normal priority, on half of `cores`; resolves to its exit code. `start` and
 * `setPriority` are child_process.spawn and os.setPriority (the tests give stand-ins). F39: `timeoutMs` is node --test's
 * per-test timeout, `stallMs` how long the run may write nothing before it is ended, `watchMs` how often that is looked at.
 */
export function runTests({
  files, cores = os.cpus().length, start = spawn, setPriority = os.setPriority, node = process.execPath,
  timeoutMs = positive(process.env.TEST_TIMEOUT_MS, TEST_TIMEOUT_MS), stallMs = positive(process.env.TEST_STALL_MS, STALL_MS),
  watchMs = positive(process.env.TEST_WATCH_MS, WATCH_MS), out = process.stdout, err = process.stderr, cwd = process.cwd(), env = process.env,
}) {
  const lower = (...args) => {
    try {
      setPriority(...args)
    } catch {
      // not allowed or gone: the run goes on at the priority it has
    }
  }
  lower(LOW)
  const began = Date.now()
  const folder = mkdtempSync(join(os.tmpdir(), 'test-run-'))
  const events = join(folder, 'open-files.jsonl')
  const args = [
    // Never --test-force-exit (the first F39 gate, 2026-11-23): it ends a file while its tests still wait, and 13 good tests failed.
    // A test past the timeout that leaves a timer running keeps its file open: the stall watchdog ends that run.
    '--test', `--test-concurrency=${halfTheCores(cores)}`, `--test-timeout=${timeoutMs}`,
    '--test-reporter=spec', '--test-reporter-destination=stdout', `--test-reporter=${REPORTER}`, `--test-reporter-destination=${events}`,
    ...files,
  ]
  const child = start(node, args, { cwd, stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true })
  if (child.pid) lower(child.pid, LOW)
  let lastOutput = Date.now()
  const pass = (to) => (chunk) => {
    lastOutput = Date.now()
    to.write(chunk)
  }
  child.stdout?.on('data', pass(out))
  child.stderr?.on('data', pass(err))
  return new Promise((resolve) => {
    let stalled = false
    const watch = setInterval(() => {
      if (Date.now() - lastOutput < stallMs) return
      stalled = true
      clearInterval(watch)
      let text = ''
      try {
        text = readFileSync(events, 'utf8')
      } catch {
        // nothing reported yet
      }
      out.write(`\n${stallLines(openFiles(text), stallMs, cwd).join('\n')}\n`)
      stopTree(child)
      stopInside(cwd, began, spawnSync, boardFolders(env))
    }, watchMs)
    let ended = false
    const done = (code) => {
      if (ended) return
      ended = true
      clearInterval(watch)
      try {
        rmSync(folder, { recursive: true, force: true })
      } catch {
        // a file still held: the temporary folder stays
      }
      resolve(stalled ? 1 : code)
    }
    child.on('error', () => done(1))
    // F39, review 10: on 'close' when the output is piped, so the tail of the run (its summary) is written before it counts.
    child.on(child.stdout ? 'close' : 'exit', (code) => done(code ?? 1))
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.length > 2 ? process.argv.slice(2) : ['test/**/*.test.mjs']
  runTests({ files }).then((code) => process.exit(code))
}
