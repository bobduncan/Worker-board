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
// TEST_TIMEOUT_MS), which ends a test that hangs inside itself (taskWindowPage.test.mjs hung that way for an hour on 2026-11-21).
// And a stall watchdog: no output of the run for 15 minutes (TEST_STALL_MS) while it is open, a file that hangs at its top
// level, ends the run with its whole tree and a line naming the test files still open (tools/openFilesReporter.mjs writes them
// to a file of their own), so land.ps1's "run the failing files again alone" can take them.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import { join, relative } from 'node:path'
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
 * F39: the lines a stalled run ends with: what happened and the files still open, then one `test at <file>:1:1` line per file (the
 * form src/landing.mjs failingFiles reads, so land.ps1 runs each of them again alone). Paths from `cwd`, with /.
 */
export function stallLines(open, stallMs, cwd = process.cwd()) {
  const span = stallMs >= 60000 ? `${Math.round(stallMs / 60000)} minutes` : `${Math.round(stallMs / 1000)} seconds`
  const shown = file => relative(cwd, file).replace(/\\/g, '/')
  const named = open.map(one => `${shown(one.file)}${one.tests.length === 0 ? ' (at its top level)' : ` (${one.tests.join('; ')})`}`)
  return [`stalled: no test output for ${span}; files still open: ${named.length === 0 ? 'none named' : named.join(', ')}`, ...open.map(one => `test at ${shown(one.file)}:1:1`)]
}

/**
 * F39 (part 6): ends what the run started outside its tree inside `folder` (a board a test started through WMI): every process whose
 * command line names the folder and that was made after `since` (never the chat's own programs there, which are older). Windows only.
 */
export function stopInside(folder, since, run = spawnSync) {
  if (process.platform !== 'win32') return
  const needle = String(folder).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase().replace(/'/g, "''")
  const script = [
    `$since = [DateTime]::FromFileTimeUtc(${Math.floor(since * 10000 + 116444736000000000)})`,
    `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CreationDate -and $_.CreationDate.ToUniversalTime() -ge $since -and ([string]$_.CommandLine).Replace('/', '\\').ToLowerInvariant().Contains('${needle}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
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
  watchMs = positive(process.env.TEST_WATCH_MS, WATCH_MS), out = process.stdout, err = process.stderr, cwd = process.cwd(),
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
    // --test-force-exit: a file whose tests are done (one ended at the timeout among them) exits even with a timer it left running.
    '--test', `--test-concurrency=${halfTheCores(cores)}`, `--test-timeout=${timeoutMs}`, '--test-force-exit',
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
      stopInside(cwd, began)
    }, watchMs)
    const done = (code) => {
      clearInterval(watch)
      rmSync(folder, { recursive: true, force: true })
      resolve(stalled ? 1 : code)
    }
    child.on('error', () => done(1))
    child.on('exit', (code) => done(code ?? 1))
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.length > 2 ? process.argv.slice(2) : ['test/**/*.test.mjs']
  runTests({ files }).then((code) => process.exit(code))
}
