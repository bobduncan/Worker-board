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
import { LOW, halfTheCores, runTests } from '../tools/test.mjs'

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
  assert.deepEqual(calls[0].args, ['--test', '--test-concurrency=12', 'test/a.test.mjs'])
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
