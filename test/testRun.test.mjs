// B351: npm test runs the tests on at most half the PC's cores, so the PC stays usable while a chat tests.
// 2026-11-11, the person: "too often claude slows down my pc very often ... the test suite", then "lets do A": the tests
// run at low priority (below normal), on half of all the PC's cores, one run at a time (test/oneAtATime.test.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { failingFiles } from '../src/landing.mjs'
import { LOW, STALL_MS, TEST_TIMEOUT_MS, halfTheCores, openFiles, runTests, stallLines } from '../tools/test.mjs'

test('B351: npm test runs the tests through tools/test.mjs, on half the cores, at least one', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  // 2026-10-25: through the helper that lets one heavy run happen at a time on the PC (test/oneAtATime.test.mjs).
  assert.equal(pkg.scripts.test, 'node tools/one-at-a-time.mjs test -- node tools/test.mjs')
  assert.equal(halfTheCores(24), 12)
  assert.equal(halfTheCores(5), 2)
  assert.equal(halfTheCores(1), 1)
})

/** A stand-in for spawn: records what it was asked and ends with `code` on the next tick. */
function standIn(code = 0) {
  const calls = []
  const start = (program, args, options) => {
    const child = new EventEmitter()
    child.pid = 4242
    calls.push({ program, args, options })
    setImmediate(() => child.emit('exit', code))
    return child
  }
  return { calls, start }
}

test('2026-11-11: the run lowers itself to below normal before node --test starts, then node --test by its id', async () => {
  const { calls, start } = standIn(0)
  const lowered = []
  const setPriority = (...args) => {
    // what was started by then: this process must be low before node --test exists, so it inherits it
    lowered.push({ args, started: calls.length })
  }
  const code = await runTests({ files: ['test/a.test.mjs'], cores: 24, start, setPriority, node: 'node.exe' })
  assert.equal(code, 0)
  assert.equal(LOW, os.constants.priority.PRIORITY_BELOW_NORMAL)
  assert.deepEqual(lowered, [{ args: [LOW], started: 0 }, { args: [4242, LOW], started: 1 }])
  assert.deepEqual([calls[0].args.slice(0, 2), calls[0].args.at(-1)], [['--test', '--test-concurrency=12'], 'test/a.test.mjs'])
  assert.equal(calls[0].program, 'node.exe')
  assert.equal(calls[0].options.windowsHide, true)
})

test('2026-11-11: a priority that cannot be set does not stop the run; its exit code is the run\'s', async () => {
  const { start } = standIn(3)
  const code = await runTests({ files: ['x'], cores: 4, start, setPriority: () => { throw new Error('EACCES') } })
  assert.equal(code, 3)
})

test('2026-11-11: the cores are all the PC\'s (os.cpus), not what this process may use under CPU Low', async (t) => {
  const { calls, start } = standIn(0)
  const cpus = os.cpus
  const available = os.availableParallelism
  t.after(() => {
    os.cpus = cpus
    os.availableParallelism = available
  })
  os.cpus = () => Array.from({ length: 24 }, () => ({}))
  // the board's "CPU for Claude: Low" gives a chat's process tree two cores
  os.availableParallelism = () => 2
  await runTests({ files: ['x'], start, setPriority: () => {} })
  assert.equal(calls[0].args[1], '--test-concurrency=12')
})

test('2026-11-11, the real case: a test file of the run reports below-normal priority', async (t) => {
  // This process back to normal first, so the check does not pass only because npm test already runs low.
  try {
    os.setPriority(os.constants.priority.PRIORITY_NORMAL)
  } catch {
    t.skip('this process may not raise its priority back to normal here')
    return
  }
  const folder = mkdtempSync(join(os.tmpdir(), 'test-run-priority-'))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  const seen = join(folder, 'seen.txt')
  const file = join(folder, 'priority.test.mjs')
  writeFileSync(file, `import os from 'node:os'\nimport { writeFileSync } from 'node:fs'\nimport { test } from 'node:test'\ntest('priority', () => writeFileSync(${JSON.stringify(seen)}, String(os.getPriority())))\n`)
  // The real spawn and the real setPriority, quiet, and without this run's NODE_TEST_CONTEXT (a nested node --test that
  // has it reports to us instead of running the file).
  const { NODE_TEST_CONTEXT: _context, ...env } = process.env
  const start = (program, args, options) => spawn(program, args, { ...options, stdio: 'ignore', env })
  // node --test reads its arguments as patterns, where a backslash escapes: forward slashes.
  const code = await runTests({ files: [file.replace(/\\/g, '/')], cores: 2, start })
  assert.equal(code, 0)
  assert.equal(Number(readFileSync(seen, 'utf8')), os.constants.priority.PRIORITY_BELOW_NORMAL)
})

// F39 (2026-11-21): a hung test file costs minutes, not the gate's hour.
const sink = () => { const seen = { text: '' }; return { seen, stream: { write: chunk => { seen.text += String(chunk) } } } }
const realStart = () => {
  const { NODE_TEST_CONTEXT: _context, ...env } = process.env
  return (program, args, options) => spawn(program, args, { ...options, env })
}
const hangFolder = (t, name, body) => {
  const folder = mkdtempSync(join(os.tmpdir(), 'test-run-hang-'))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  const file = join(folder, name)
  writeFileSync(file, body)
  return { folder, file: file.replace(/\\/g, '/') }
}

test('F39: node --test gets a per-test timeout and a second reporter that writes the files it takes up and ends', async () => {
  const { calls, start } = standIn(0)
  await runTests({ files: ['test/a.test.mjs'], cores: 8, start, setPriority: () => {} })
  const args = calls[0].args
  assert.deepEqual(args.slice(0, 4), ['--test', '--test-concurrency=4', `--test-timeout=${TEST_TIMEOUT_MS}`, '--test-force-exit'])
  assert.equal(TEST_TIMEOUT_MS, 10 * 60 * 1000)
  assert.equal(STALL_MS, 15 * 60 * 1000)
  assert.ok(args.includes('--test-reporter=spec') && args.includes('--test-reporter-destination=stdout'), 'the usual output still on stdout')
  assert.ok(args.some(arg => /^--test-reporter=file:.*openFilesReporter\.mjs$/.test(arg)))
  assert.equal(args.at(-1), 'test/a.test.mjs')
})

test('F39: the files still open, from the reporter\'s lines, and the lines a stalled run ends with', () => {
  const lines = [
    { at: 'start', file: 'C:/b/test/a.test.mjs', test: null }, { at: 'start', file: 'C:/b/test/a.test.mjs', test: 'one' }, { at: 'end', file: 'C:/b/test/a.test.mjs', test: 'one' },
    { at: 'start', file: 'C:/b/test/a.test.mjs', test: 'two' }, { at: 'start', file: 'C:/b/test/b.test.mjs', test: null }, { at: 'start', file: 'C:/b/test/c.test.mjs', test: null },
    { at: 'end', file: 'C:/b/test/c.test.mjs', test: null },
  ].map(one => JSON.stringify(one)).join('\n') + '\n{ torn'
  const open = openFiles(lines)
  assert.deepEqual(open, [{ file: 'C:/b/test/a.test.mjs', tests: ['two'] }, { file: 'C:/b/test/b.test.mjs', tests: [] }])
  assert.deepEqual(stallLines(open, 15 * 60 * 1000, 'C:/b'), [
    'stalled: no test output for 15 minutes; files still open: test/a.test.mjs (two), test/b.test.mjs (at its top level)',
    'test at test/a.test.mjs:1:1', 'test at test/b.test.mjs:1:1',
  ])
  assert.deepEqual(failingFiles(stallLines(open, 15 * 60 * 1000, 'C:/b').join('\n')), ['test/a.test.mjs', 'test/b.test.mjs'], 'land.ps1 reruns them alone')
})

test('F39, the real case: a test that hangs inside itself (taskWindowPage, 2026-11-21) fails at the per-test timeout, naming its file', { timeout: 120_000 }, async t => {
  const { folder, file } = hangFolder(t, 'hangs-inside.test.mjs', "import { test } from 'node:test'\ntest('waits for a page that never draws', () => new Promise(() => setInterval(() => {}, 1000)))\n")
  const { seen, stream } = sink()
  const began = Date.now()
  const code = await runTests({ files: [file], cores: 2, start: realStart(), setPriority: () => {}, timeoutMs: 3000, stallMs: 60_000, watchMs: 500, out: stream, err: stream, cwd: folder })
  assert.equal(code, 1)
  assert.ok(Date.now() - began < 60_000, 'ended at the timeout, not later')
  assert.match(seen.text, /waits for a page that never draws/)
  assert.ok(failingFiles(seen.text).some(one => one.endsWith('hangs-inside.test.mjs')), seen.text)
})

test('F39: a file that hangs at its top level ends the run at the stall watchdog with its whole tree, naming the file', { timeout: 120_000 }, async t => {
  // F39 (part 6): the file also starts a process outside the run's tree that names the run's folder (a WMI-started board's way).
  const sleeperCode = [
    "import { spawn } from 'node:child_process'",
    "import { writeFileSync } from 'node:fs'",
    // A launcher that starts the sleeper and ends at once: the sleeper's parent is gone, so it is in no tree (a WMI start's way).
    "const launcher = \"const { spawn } = require('node:child_process'); const one = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)', process.cwd()], { detached: true, stdio: 'ignore', windowsHide: true }); one.unref(); require('node:fs').writeFileSync('sleeper.pid', String(one.pid))\"",
    "spawn(process.execPath, ['-e', launcher], { stdio: 'ignore', windowsHide: true })",
    'setInterval(() => {}, 1000)',
    'await new Promise(() => {})',
    '',
  ].join('\n')
  const { folder, file } = hangFolder(t, 'hangs-on-top.test.mjs', sleeperCode)
  const { seen, stream } = sink()
  const began = Date.now()
  const code = await runTests({ files: [file], cores: 2, start: realStart(), setPriority: () => {}, timeoutMs: 600_000, stallMs: 3000, watchMs: 250, out: stream, err: stream, cwd: folder })
  assert.equal(code, 1)
  assert.ok(Date.now() - began < 60_000, 'ended at the watchdog')
  assert.match(seen.text, /stalled: no test output for 3 seconds; files still open: .*hangs-on-top\.test\.mjs \(at its top level\)/)
  assert.ok(failingFiles(seen.text).some(one => one.endsWith('hangs-on-top.test.mjs')), seen.text)
  if (process.platform === 'win32') {
    const sleeper = Number(readFileSync(join(folder, 'sleeper.pid'), 'utf8'))
    let alive = true
    try {
      process.kill(sleeper, 0)
    } catch {
      alive = false
    }
    assert.equal(alive, false, 'the process it left outside its tree is ended too')
  }
})
