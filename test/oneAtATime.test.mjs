// One heavy run at a time on this PC (2026-10-25): tools/one-at-a-time.mjs. Every test uses a lock file of its own in a
// temporary folder (HEAVY_RUN_LOCK) and a short poll, and none holds a lock for long. The same cases are in the game's
// tests (tests/tools/oneAtATime.test.mjs).
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SLOTS, pidRuns, runOneAtATime, slotPath, slotsOf, whyStale } from '../tools/one-at-a-time.mjs'

const HELPER = fileURLToPath(new URL('../tools/one-at-a-time.mjs', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'heavy-run-test-'))
const running = new Set()
let counter = 0

after(() => {
  for (const child of running) child.kill()
  rmSync(scratch, { recursive: true, force: true })
})

/** A lock path in a folder of its own, which exists (the first test makes one that does not). */
function newLock() {
  const folder = join(scratch, `lock-${++counter}`)
  mkdirSync(folder)
  return join(folder, 'heavy.lock')
}

/** The environment of a run: this test's lock, a short poll and say, and no HEAVY_RUN_HELD (npm test itself sets it). */
function envFor(lock, extra = {}) {
  const { HEAVY_RUN_HELD: _held, ...plain } = process.env
  // One slot unless a test asks for more: the older cases are about one run at a time.
  return { ...plain, HEAVY_RUN_LOCK: lock, HEAVY_RUN_POLL_MS: '50', HEAVY_RUN_SAY_MS: '200', HEAVY_RUN_SLOTS: '1', ...extra }
}

/** Starts the helper as the package scripts do; `done` resolves to its exit code and what it wrote. */
function start(lock, label, command, extra = {}) {
  const child = spawn(process.execPath, [HELPER, label, '--', ...command], { env: envFor(lock, extra), stdio: ['ignore', 'pipe', 'pipe'] })
  running.add(child)
  const run = { child, out: '', err: '' }
  child.stdout.on('data', (data) => (run.out += data))
  child.stderr.on('data', (data) => (run.err += data))
  run.done = new Promise((resolve) =>
    child.on('close', (code) => {
      running.delete(child)
      resolve({ code, out: run.out, err: run.err })
    }),
  )
  return run
}

async function until(check, what, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const found = await check()
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(`timed out waiting for ${what}`)
}

const lockText = (over = {}) => JSON.stringify({ pid: process.pid, label: 'someone', cwd: 'C:/elsewhere', startedAt: new Date().toISOString(), ...over })
const node = (code) => ['node', '-e', code]
const quick = node("console.log('ran')")

function fixture(name, text) {
  const file = join(scratch, name)
  writeFileSync(file, text)
  return file
}

test('a run takes the lock while its command runs, and gives it back', async () => {
  const lock = join(scratch, 'not-there-yet', 'deeper', 'heavy.lock')
  const result = await start(lock, 'gate', node("console.log(JSON.stringify({ lock: JSON.parse(require('fs').readFileSync(process.env.HEAVY_RUN_LOCK, 'utf8')), held: process.env.HEAVY_RUN_HELD }))")).done
  assert.equal(result.code, 0)
  const seen = JSON.parse(result.out)
  assert.equal(seen.held, '1')
  assert.equal(seen.lock.label, 'gate')
  assert.equal(seen.lock.cwd, process.cwd())
  assert.ok(Number.isInteger(seen.lock.pid) && seen.lock.pid > 0)
  assert.ok(Math.abs(Date.now() - Date.parse(seen.lock.startedAt)) < 60000)
  assert.equal(existsSync(lock), false)
})

test('a second run waits until the first has ended, and says who it waits for', async () => {
  const lock = newLock()
  const first = start(lock, 'first', node('setTimeout(() => console.log(Date.now()), 700)'))
  await until(() => existsSync(lock), 'the first run to take the lock')
  const second = start(lock, 'second', node('console.log(Date.now())'))
  const [one, two] = await Promise.all([first.done, second.done])
  assert.equal(one.code, 0)
  assert.equal(two.code, 0)
  assert.ok(Number(two.out) >= Number(one.out), 'the second command ran only after the first one was done')
  assert.match(two.err, /waiting for first in .+ \(since \d\d:\d\d\)/)
  assert.equal(existsSync(lock), false)
})

test('it says who it waits for once in a while, not at every look', async () => {
  const lock = newLock()
  writeFileSync(lock, lockText())
  const waiting = start(lock, 'second', quick)
  await until(() => /waiting for someone in C:\/elsewhere \(since \d\d:\d\d\)/.test(waiting.err), 'the waiting line')
  await new Promise((resolve) => setTimeout(resolve, 450))
  rmSync(lock)
  const result = await waiting.done
  assert.equal(result.code, 0)
  assert.match(result.out, /ran/)
  const lines = result.err.split('\n').filter((line) => line.startsWith('waiting for'))
  assert.ok(lines.length >= 1 && lines.length <= 5, `${lines.length} lines in 450 ms with a look every 50 ms`)
})

test('a lock whose process is gone, that is too old or that cannot be read is taken over', async (t) => {
  const gone = spawnSync(process.execPath, ['-e', '0']).pid
  const cases = {
    'its process is gone': lockText({ pid: gone }),
    'it is older than 45 minutes': lockText({ startedAt: new Date(Date.now() - 46 * 60 * 1000).toISOString() }),
    'an empty file': '',
    'a file of zeros': '\0'.repeat(120),
    'text that is not JSON': 'half a lock {"pid": ',
    'JSON that is no lock': JSON.stringify({ hello: 'world' }),
  }
  for (const [name, text] of Object.entries(cases)) {
    await t.test(name, async () => {
      const lock = newLock()
      writeFileSync(lock, text)
      const result = await start(lock, 'taker', quick).done
      assert.equal(result.code, 0)
      assert.match(result.out, /ran/)
      assert.doesNotMatch(result.err, /waiting for/)
      assert.equal(existsSync(lock), false)
    })
  }
})

test('a nested run (HEAVY_RUN_HELD=1) does not wait and leaves the lock alone', async () => {
  const lock = newLock()
  const text = lockText()
  writeFileSync(lock, text)
  const result = await start(lock, 'nested', quick, { HEAVY_RUN_HELD: '1' }).done
  assert.equal(result.code, 0)
  assert.match(result.out, /ran/)
  assert.doesNotMatch(result.err, /waiting for/)
  assert.equal(readFileSync(lock, 'utf8'), text)
})

test('the exit code of the command is the exit code of the run', async () => {
  const lock = newLock()
  assert.equal((await start(lock, 'code', node('process.exit(7)')).done).code, 7)
  assert.equal((await start(lock, 'code', quick).done).code, 0)
  // one argument is a whole command line for the shell, as the package scripts give it
  assert.equal((await start(lock, 'code', ['node -e "process.exit(3)" || node -e "process.exit(4)"']).done).code, 4)
})

test('a command that fails, or cannot start, still gives the lock back', async () => {
  const lock = newLock()
  const failing = await start(lock, 'fails', node("console.error('boom'); process.exit(9)")).done
  assert.equal(failing.code, 9)
  assert.equal(existsSync(lock), false)
  const missing = await start(lock, 'missing', ['no-such-program-for-the-heavy-run-test']).done
  assert.notEqual(missing.code, 0)
  assert.equal(existsSync(lock), false)
})

test('the arguments reach the command as they are', async () => {
  const lock = newLock()
  const result = await start(lock, 'args', ['node', '-e', "process.stdout.write(process.argv.slice(1).join('|'))", 'x y (z) & q', 'plain']).done
  assert.equal(result.code, 0)
  assert.equal(result.out, 'x y (z) & q|plain')
})

test('a lock that another run has taken over is not removed by the run that lost it', async () => {
  const lock = newLock()
  const steal = fixture(
    'steal.mjs',
    "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.env.HEAVY_RUN_LOCK, JSON.stringify({ pid: Number(process.argv[2]), label: 'other', cwd: 'C:/other', startedAt: new Date().toISOString() }))\n",
  )
  const result = await start(lock, 'loser', ['node', steal, String(process.pid)]).done
  assert.equal(result.code, 0)
  assert.equal(JSON.parse(readFileSync(lock, 'utf8')).label, 'other')
})

test('a signal ends the command and gives the lock back', async () => {
  const lock = newLock()
  const pidFile = join(scratch, `sleeper-${counter}.pid`)
  const sleeper = fixture('sleeper.mjs', "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.argv[2], String(process.pid))\nsetTimeout(() => {}, 30000)\n")
  const signals = new EventEmitter()
  const run = runOneAtATime({ label: 'long', command: ['node', sleeper, pidFile], env: envFor(lock), signals, say: () => {} })
  const pid = Number(await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8'), 'the command to start'))
  assert.equal(existsSync(lock), true)
  signals.emit('SIGINT')
  assert.equal(await run, 130)
  assert.equal(existsSync(lock), false)
  await until(() => !pidRuns(pid), 'the command to be gone', 5000)
  assert.equal(signals.listenerCount('SIGINT'), 0, 'its listeners are removed')
})

test('a signal while waiting ends the wait and leaves the other run its lock', async () => {
  const lock = newLock()
  const text = lockText()
  writeFileSync(lock, text)
  const said = []
  const signals = new EventEmitter()
  const run = runOneAtATime({ label: 'patient', command: quick, env: envFor(lock), signals, say: (line) => said.push(line) })
  await until(() => said.length > 0, 'the waiting line')
  signals.emit('SIGTERM')
  assert.equal(await run, 143)
  assert.equal(readFileSync(lock, 'utf8'), text)
})

test('whyStale: a lock is stale when it cannot be read, its process is gone, or it is older than 45 minutes', () => {
  const now = Date.parse('2026-10-25T12:00:00Z')
  const info = (minutesAgo) => ({ pid: 4242, label: 'x', cwd: 'y', startedAt: new Date(now - minutesAgo * 60000).toISOString() })
  assert.equal(whyStale(info(10), now, () => true), null)
  assert.equal(whyStale(info(44), now, () => true), null)
  assert.match(whyStale(info(46), now, () => true), /older than 45 minutes/)
  assert.match(whyStale(info(1), now, () => false), /process is gone/)
  assert.match(whyStale(null, now, () => true), /cannot be read/)
})

test('npm test runs through the helper, and the README says that the tests wait their turn', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts.test, 'node tools/one-at-a-time.mjs test -- node tools/test.mjs')
  assert.match(readFileSync(new URL('../README.md', import.meta.url), 'utf8'), /two heavy runs at a time/)
})

// The person, 2026-10-31: "yes do 2 at a time", and a run that waited longest goes first.
test('two runs go at once by default; a third waits for one of them', async () => {
  assert.equal(DEFAULT_SLOTS, 2)
  assert.equal(slotsOf({}), 2)
  assert.equal(slotsOf({ HEAVY_RUN_SLOTS: '1' }), 1)
  assert.equal(slotsOf({ HEAVY_RUN_SLOTS: 'x' }), 2)
  assert.equal(slotPath('C:/t/heavy.lock', 1), 'C:/t/heavy.lock')
  assert.equal(slotPath('C:/t/heavy.lock', 2), 'C:/t/heavy.2.lock')
  const lock = newLock()
  const two = { HEAVY_RUN_SLOTS: '2' }
  const slow = node('setTimeout(() => console.log(Date.now()), 900)')
  const first = start(lock, 'first', slow, two)
  const second = start(lock, 'second', node('console.log(Date.now())'), two)
  await until(() => existsSync(lock), 'a slot taken')
  const two1 = await second.done
  assert.equal(two1.code, 0)
  assert.doesNotMatch(two1.err, /waiting for/, 'the second ran beside the first')
  const one = await first.done
  assert.ok(Number(two1.out) < Number(one.out), 'the second finished while the first still ran')
  assert.equal(existsSync(lock), false)
  assert.equal(existsSync(slotPath(lock, 2)), false)
})

test('first come, first served: the run that waited longest takes the next free slot', async () => {
  const lock = newLock()
  writeFileSync(lock, lockText())
  const early = start(lock, 'early', node('console.log(Date.now())'))
  await until(() => /waiting for/.test(early.err), 'the early run waiting')
  const late = start(lock, 'late', node('console.log(Date.now())'))
  await until(() => /waiting for .*1 ahead of this run/.test(late.err), 'the late run knowing one is ahead')
  rmSync(lock)
  const [one, two] = await Promise.all([early.done, late.done])
  assert.equal(one.code, 0)
  assert.equal(two.code, 0)
  assert.ok(Number(one.out) <= Number(two.out), 'the early run went first')
  assert.equal(existsSync(lock), false)
})

test('a ticket whose process is gone does not hold up the queue', async () => {
  const lock = newLock()
  mkdirSync(lock + '.queue')
  writeFileSync(join(lock + '.queue', '000000000000001-00000001.json'), lockText({ pid: 999999 }))
  const result = await start(lock, 'after a crash', quick).done
  assert.equal(result.code, 0)
  assert.match(result.out, /ran/)
})
