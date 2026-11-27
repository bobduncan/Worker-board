// B351: npm test runs the tests on at most half the PC's cores, so the PC stays usable while a chat tests.
// 2026-11-11, the person: "too often claude slows down my pc very often ... the test suite", then "lets do A": the tests
// run at low priority (below normal), on half of all the PC's cores, one run at a time (test/oneAtATime.test.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { failingFiles, gateVerdict } from '../src/landing.mjs'
import { LOW, NORMAL, STALL_MS, TEST_TIMEOUT_MS, boardFolders, cliOf, halfTheCores, holdsBoard, insidePattern, openFiles, priorityWord, runTests, stallLines, stopInside } from '../tools/test.mjs'

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
  assert.deepEqual(args.slice(0, 3), ['--test', '--test-concurrency=4', `--test-timeout=${TEST_TIMEOUT_MS}`])
  assert.equal(args.includes('--test-force-exit'), false, 'it ended files while their tests still waited (the first F39 gate)')
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
  ])
  // Review, blocker 2: a stalled run is a refusal and names no file to run again alone (the held-back files' failures are lost).
  const verdict = gateVerdict(['✔ one (1ms)', 'test at test/c.test.mjs:3:1', ...stallLines(open, 15 * 60 * 1000, 'C:/b')].join('\n'), 'board', 1)
  assert.equal(verdict.ok, false)
  assert.match(verdict.why, /^the test run stalled \(stalled: no test output for 15 minutes; files still open: test\/a\.test\.mjs/)
  assert.equal(verdict.files, undefined)
})

test('F39, the real case: a test that hangs inside itself and leaves a timer (taskWindowPage, 2026-11-21) ends the run at the watchdog, naming its file', { timeout: 200_000 }, async t => {
  const { folder, file } = hangFolder(t, 'hangs-inside.test.mjs', "import { test } from 'node:test'\ntest('waits for a page that never draws', () => new Promise(() => setInterval(() => {}, 1000)))\n")
  const { seen, stream } = sink()
  const began = Date.now()
  const code = await runTests({ files: [file], cores: 2, start: realStart(), setPriority: () => {}, timeoutMs: 2000, stallMs: 6000, watchMs: 250, out: stream, err: stream, cwd: folder })
  assert.equal(code, 1)
  assert.ok(Date.now() - began < 150_000, 'ended within the bound, also on a busy PC')
  assert.match(seen.text, /stalled: no test output for 6 seconds; files still open: .*hangs-inside\.test\.mjs/)
  assert.equal(gateVerdict(seen.text, 'board', code).ok, false, 'refused')
})

test('F39: a file that hangs at its top level ends the run at the stall watchdog with its whole tree, naming the file', { timeout: 200_000 }, async t => {
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
  // A list of boards of its own: without a readable list the sweep does nothing.
  const home = mkdtempSync(join(os.tmpdir(), 'boards-home-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  writeFileSync(join(home, 'boards.json'), JSON.stringify({ boards: [] }))
  const code = await runTests({ files: [file], cores: 2, start: realStart(), setPriority: () => {}, timeoutMs: 600_000, stallMs: 3000, watchMs: 250, out: stream, err: stream, cwd: folder, env: { ...process.env, WORKER_BOARD_HOME: home } })
  assert.equal(code, 1)
  assert.ok(Date.now() - began < 150_000, 'ended at the watchdog, also on a busy PC')
  assert.match(seen.text, /stalled: no test output for 3 seconds; files still open: .*hangs-on-top\.test\.mjs \(at its top level\)/)
  assert.equal(gateVerdict(seen.text, 'board', code).ok, false, 'refused')
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

test('F39 review 9: the sweep names a folder only on a path boundary, and never sweeps a board\'s own folder', () => {
  const re = new RegExp(insidePattern('D:/boards/x/worker-board'))
  assert.equal(re.test('node d:\\boards\\x\\worker-board\\server.mjs'), true)
  assert.equal(re.test('node "d:\\boards\\x\\worker-board" --demo'), true)
  assert.equal(re.test('node d:\\boards\\x\\worker-board-t5-a6\\server.mjs'), false, 'another worktree beside it is not inside')
  const calls = []
  const run = (...args) => calls.push(args)
  stopInside('D:/boards/x/worker-board', Date.now(), run, ['D:\\boards\\x\\worker-board'])
  assert.equal(calls.length, 0, 'a board folder is never swept')
  // The re-check: a folder that holds a board (the project folder around it) is never swept either, and nothing is swept when
  // the list of boards cannot be read.
  stopInside('D:/boards/x', Date.now(), run, ['D:\\boards\\x\\worker-board'])
  stopInside('D:/temp/run-2', Date.now(), run, null)
  assert.equal(calls.length, 0, 'a folder holding a board, or no readable list: no sweep')
  assert.equal(holdsBoard('D:/boards', ['D:\\boards\\x\\worker-board']), true)
  assert.equal(holdsBoard('D:/boards/x/worker-board-t5', ['D:\\boards\\x\\worker-board']), false)
  if (process.platform === 'win32') {
    stopInside('D:/temp/run-1', Date.now(), run, ['D:\\boards\\x\\worker-board'])
    assert.equal(calls.length, 1)
    assert.match(calls[0][1].at(-1), /\$_\.ProcessId -ne \$PID/, 'never the sweep\'s own powershell')
  }
})

test('F39 review 10: with piped output the run counts on close, after the tail of its output', async () => {
  const { seen, stream } = sink()
  const start = () => {
    const child = new EventEmitter()
    child.pid = 4243
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    setImmediate(() => {
      child.emit('exit', 0)
      // The pipe's tail comes a moment after the process ended.
      setTimeout(() => {
        child.stdout.emit('data', 'ℹ fail 0\n')
        child.emit('close', 0)
      }, 30)
    })
    return child
  }
  const code = await runTests({ files: ['x'], cores: 2, start, setPriority: () => {}, out: stream, err: stream })
  assert.equal(code, 0)
  assert.match(seen.text, /ℹ fail 0/)
})

test('F39, the re-check: the list of boards fails closed: a broken boards.json gives null, a missing one no boards', t => {
  const home = mkdtempSync(join(os.tmpdir(), 'boards-home-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  assert.equal(boardFolders({ WORKER_BOARD_HOME: home }), null, 'no list: no sweep')
  writeFileSync(join(home, 'boards.json'), '{ torn')
  assert.equal(boardFolders({ WORKER_BOARD_HOME: home }), null)
  writeFileSync(join(home, 'boards.json'), '{}')
  assert.equal(boardFolders({ WORKER_BOARD_HOME: home }), null, 'no list of boards in it: unreadable too')
  writeFileSync(join(home, 'boards.json'), JSON.stringify({ boards: [{ folder: 'D:\\boards\\x\\worker-board' }] }))
  assert.deepEqual(boardFolders({ WORKER_BOARD_HOME: home }), ['D:\\boards\\x\\worker-board'])
})

// F68 (chat 1, 2026-11-25): land.ps1's rerun alone of a failed file goes through the one-at-a-time queue and asks its priority by
// name (below normal until the PC plan's core fence, S5, may raise it to normal); every run's first line says its priority.
test('F68: a run asked for normal priority sets itself and node --test to normal, and its first line says the priority node --test has', async () => {
  const { start } = standIn(0)
  const set = []
  const { seen, stream } = sink()
  const code = await runTests({ files: ['test/a.test.mjs'], priority: NORMAL, cores: 4, start, setPriority: (...args) => set.push(args), getPriority: pid => (pid === 4242 ? NORMAL : LOW), out: stream, err: stream })
  assert.equal(code, 0)
  assert.equal(NORMAL, os.constants.priority.PRIORITY_NORMAL)
  assert.deepEqual(set, [[NORMAL], [4242, NORMAL]])
  assert.equal(seen.text, 'test run: priority normal\n')
})

test('S5: inside a heavy run\'s fence the run never goes above the fence\'s priority: idle stays idle, F68\'s normal is below normal', async () => {
  for (const [fence, asked, want] of [['Idle', LOW, os.constants.priority.PRIORITY_LOW], ['Idle', NORMAL, os.constants.priority.PRIORITY_LOW], ['BelowNormal', NORMAL, LOW], [undefined, NORMAL, NORMAL]]) {
    const set = []
    const { stream } = sink()
    await runTests({ files: ['x'], priority: asked, cores: 4, start: standIn(0).start, setPriority: (...args) => set.push(args), getPriority: () => want, out: stream, err: stream, env: fence ? { HEAVY_RUN_PRIORITY: fence } : {} })
    assert.deepEqual(set, [[want], [4242, want]], `${fence} fence, asked ${asked}`)
  }
})

test('F68: the full run says below normal; a priority that cannot be read says the asked one', async () => {
  const low = sink()
  await runTests({ files: ['x'], cores: 4, start: standIn(0).start, setPriority: () => {}, getPriority: () => LOW, out: low.stream, err: low.stream })
  assert.equal(low.seen.text, 'test run: priority below normal\n')
  const unread = sink()
  await runTests({ files: ['x'], priority: NORMAL, cores: 4, start: standIn(0).start, setPriority: () => {}, getPriority: () => { throw new Error('ESRCH') }, out: unread.stream, err: unread.stream })
  assert.equal(unread.seen.text, 'test run: priority normal\n')
  assert.deepEqual([LOW, NORMAL, os.constants.priority.PRIORITY_LOW, 3].map(priorityWord), ['below normal', 'normal', 'idle', 'nice 3'])
})

test('F68: the command line takes --priority=normal or below-normal beside the files; below normal and all files when not named', () => {
  assert.deepEqual(cliOf(['--priority=normal', 'test\\carryGit.test.mjs']), { priority: NORMAL, gate: false, files: ['test\\carryGit.test.mjs'] })
  assert.deepEqual(cliOf(['test/a.test.mjs', '--priority=below-normal']), { priority: LOW, gate: false, files: ['test/a.test.mjs'] })
  assert.deepEqual(cliOf([]), { priority: LOW, gate: false, files: ['test/**/*.test.mjs'] })
  // S9: --gate asks for the light check (land.ps1's gate: npm test -- --gate)
  assert.deepEqual(cliOf(['--gate']), { priority: LOW, gate: true, files: ['test/**/*.test.mjs'] })
  assert.throws(() => cliOf(['--priority=high', 'x']), /unknown priority "high"/)
})

test('F68: land.ps1 reruns a failed file through the one-at-a-time queue, asking below normal by name; the full run stays npm test, low', () => {
  const script = readFileSync(new URL('../tools/land.ps1', import.meta.url), 'utf8')
  const rerun = 'node tools/one-at-a-time.mjs rerun -- node tools/test.mjs --priority=below-normal {file}'
  assert.equal(script.match(/^\$gateFileCommand = '(.*)'\s*$/m)?.[1], rerun)
  assert.equal(script.match(/Get-Setting 'gateFile' '(.*)'\)\s*$/m)?.[1], rerun)
  assert.equal(script.match(/Get-Setting 'gateBoard' '(.*)'\)\s*$/m)?.[1], 'npm test -- --gate')
  assert.doesNotMatch(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts.test, /--priority/)
})

test('F68, the real case: land.ps1\'s own rerun command, started from a normal parent (a chat in Full), waits its turn in the queue and runs its test file at below normal priority',{ timeout: 180_000, skip: process.platform !== 'win32' && 'priority classes are Windows\' (land.ps1 runs there only)' }, t => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const folder = mkdtempSync(join(os.tmpdir(), 'test-run-rerun-'))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  const seen = join(folder, 'seen.txt')
  const file = join(folder, 'priority.test.mjs')
  writeFileSync(file, `import os from 'node:os'\nimport { writeFileSync } from 'node:fs'\nimport { test } from 'node:test'\ntest('priority', () => writeFileSync(${JSON.stringify(seen)}, String(os.getPriority())))\n`)
  // The command exactly as land.ps1 has it (its default), the file in its place.
  const command = readFileSync(join(root, 'tools', 'land.ps1'), 'utf8').match(/^\$gateFileCommand = '(.*)'\s*$/m)[1].replace('{file}', `"${file.replace(/\\/g, '/')}"`)
  // A parent at normal (a landing started from a chat in Full): its children inherit normal unless the rerun lowers itself.
  const parent = join(folder, 'normal-parent.mjs')
  writeFileSync(parent, [
    "import os from 'node:os'",
    "import { spawnSync } from 'node:child_process'",
    'os.setPriority(os.constants.priority.PRIORITY_NORMAL)',
    "const run = spawnSync(process.argv[2], { shell: true, cwd: process.argv[3], encoding: 'utf8', windowsHide: true })",
    "process.stdout.write(`parent priority ${os.getPriority()}\\n${run.stdout ?? ''}`)",
    "process.stderr.write(run.stderr ?? '')",
    'process.exitCode = run.status ?? 1',
  ].join('\n'))
  // This test's own lock (never the PC's), no held slot and no first-class word from the run around it, and no NODE_TEST_CONTEXT.
  const { NODE_TEST_CONTEXT: _context, HEAVY_RUN_HELD: _held, HEAVY_RUN_PID: _pid, HEAVY_RUN_FIRST: _first, ...plain } = process.env
  const env = { ...plain, HEAVY_RUN_LOCK: join(folder, 'heavy.lock'), HEAVY_RUN_FIRST: '1', HEAVY_RUN_POLL_MS: '50', HEAVY_RUN_SAY_MS: '200' }
  const run = spawnSync(process.execPath, [parent, command, root], { env, encoding: 'utf8', windowsHide: true, timeout: 150_000 })
  const said = `${run.stdout}\n${run.stderr}`
  assert.equal(run.status, 0, said)
  assert.match(said, new RegExp(`^parent priority ${os.constants.priority.PRIORITY_NORMAL}$`, 'm'), 'the parent really is normal')
  assert.match(said, /one-at-a-time: rerun runs now/, 'through the queue')
  assert.match(said, /^test run: priority below normal$/m)
  assert.equal(Number(readFileSync(seen, 'utf8')), os.constants.priority.PRIORITY_BELOW_NORMAL, 'the test file ran at below normal')
})
