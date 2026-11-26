// One heavy run at a time on this PC (2026-10-25): tools/one-at-a-time.mjs. Every test uses a lock file of its own in a
// temporary folder (HEAVY_RUN_LOCK) and a short poll, and none holds a lock for long. The same cases are in the game's
// tests (tests/tools/oneAtATime.test.mjs).
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { BEAT_STALE_MS, DEFAULT_SLOTS, FIRST_LEAD_MS, HOLD_MAX_MS, MAX_AGE_MS, ORDER_MARK, TICKET_MAX_AGE_MS, aheadOf, idleRoomOf, isIdleRun, pidRuns, queueOrder, runOneAtATime, slotPath, slotsOf, whyStale } from '../tools/one-at-a-time.mjs'

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

/**
 * The environment of a run: this test's lock, a short poll and say, and no HEAVY_RUN_HELD (npm test itself sets it) and no
 * HEAVY_RUN_FIRST (a landing's gate sets it, F14: the runs of this test are ordinary unless a case says otherwise).
 */
function envFor(lock, extra = {}) {
  const { HEAVY_RUN_HELD: _held, HEAVY_RUN_FIRST: _first, ...plain } = process.env
  // One slot unless a test asks for more: the older cases are about one run at a time.
  return { ...plain, HEAVY_RUN_LOCK: lock, HEAVY_RUN_POLL_MS: '50', HEAVY_RUN_SAY_MS: '200', HEAVY_RUN_SLOTS: '1', ...extra }
}

/** Starts the helper as the package scripts do; `done` resolves to its exit code and what it wrote. */
function start(lock, label, command, extra = {}, cwd = undefined) {
  const child = spawn(process.execPath, [HELPER, label, '--', ...command], { env: envFor(lock, extra), cwd, stdio: ['ignore', 'pipe', 'pipe'] })
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

test('F14: a first-class run (HEAVY_RUN_FIRST=1, a landing\'s gate) goes ahead of the ordinary runs waiting, and every run says when it runs', async () => {
  const lock = newLock()
  writeFileSync(lock, lockText())
  const first = start(lock, 'first', node('console.log(Date.now())'))
  await until(() => /waiting for/.test(first.err), 'the first ordinary run waiting')
  const second = start(lock, 'second', node('console.log(Date.now())'))
  await until(() => /waiting for/.test(second.err), 'the second ordinary run waiting')
  const gate = start(lock, 'gate', node('console.log(Date.now())'), { HEAVY_RUN_FIRST: '1' })
  await until(() => /waiting for/.test(gate.err), 'the gate waiting')
  rmSync(lock)
  const [one, two, three] = await Promise.all([first.done, second.done, gate.done])
  assert.deepEqual([one.code, two.code, three.code], [0, 0, 0])
  assert.ok(Number(three.out) <= Number(one.out) && Number(three.out) <= Number(two.out), 'the gate ran before both ordinary runs that came earlier')
  assert.ok(Number(one.out) <= Number(two.out), 'the ordinary runs keep their order')
  assert.match(three.err, /one-at-a-time: gate runs now \(waited \d+ s\)/)
  assert.match(one.err, /one-at-a-time: first runs now \(waited \d+ s\)/)
  // The pure order (F39): tickets a few seconds apart, the two first-class ones go before the ordinary ones that came just before.
  const name = (seconds) => `${String(Date.parse('2026-11-21T10:00:00Z') + seconds * 1000).padStart(15, '0')}-00000001.json`
  const order = [{ name: name(0), first: false }, { name: name(1), first: false }, { name: name(2), first: true }, { name: name(3), first: true }]
  assert.deepEqual([aheadOf(order, name(2), true), aheadOf(order, name(3), true), aheadOf(order, name(0), false), aheadOf(order, name(1), false)], [0, 1, 2, 3])
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
    'it is older than 75 minutes and does not beat': lockText({ startedAt: new Date(Date.now() - 76 * 60 * 1000).toISOString() }),
    'its beat is older than 5 minutes': lockText({ startedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(), beat: new Date(Date.now() - 6 * 60 * 1000).toISOString() }),
    'an empty file': '',
    'a file of zeros': '\0'.repeat(120),
    'text that is not JSON': 'half a lock {"pid": ',
    'JSON that is no lock': JSON.stringify({ hello: 'world' }),
  }
  for (const [name, text] of Object.entries(cases)) {
    await t.test(name, async () => {
      const lock = newLock()
      writeFileSync(lock, text)
      // F39, review: a live holder with an old beat is freed after two beats of the waiter's clock (100 ms beats here).
      const result = await start(lock, 'taker', quick, { HEAVY_RUN_BEAT_MS: '100' }).done
      assert.equal(result.code, 0)
      assert.match(result.out, /ran/)
      // F39, review: an old beat of a live holder waits two beats first; the others are taken at once.
      if (name !== 'its beat is older than 5 minutes') assert.doesNotMatch(result.err, /waiting for/)
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

test('whyStale: a lock is stale when it cannot be read, its process is gone, its beat is older than 5 minutes, or (no beat) older than 75 minutes', () => {
  const now = Date.parse('2026-10-25T12:00:00Z')
  const info = (minutesAgo, beatAgo = null) => ({ pid: 4242, label: 'x', cwd: 'y', startedAt: new Date(now - minutesAgo * 60000).toISOString(), ...(beatAgo === null ? {} : { beat: new Date(now - beatAgo * 60000).toISOString() }) })
  assert.equal(whyStale(info(10), now, () => true), null)
  assert.equal(whyStale(info(74), now, () => true), null)
  assert.match(whyStale(info(76), now, () => true), /older than 75 minutes and does not beat/)
  assert.match(whyStale(info(1), now, () => false), /process is gone/)
  assert.match(whyStale(null, now, () => true), /cannot be read/)
  // F39, the real case (2026-11-21 12:05): a gate past 45 and past 60 minutes, alive and beating, keeps its slot.
  assert.equal(whyStale(info(46, 1), now, () => true), null)
  assert.equal(whyStale(info(61, 0.5), now, () => true), null)
  assert.equal(whyStale(info(125, 4), now, () => true), null, 'beating: past the gate clock, up to the cap (review 5)')
  assert.match(whyStale(info(20, 6), now, () => true), /beat is older than 5 minutes/)
  assert.match(whyStale(info(61, 1), now, () => false), /process is gone/, 'a dead holder frees it at once')
  assert.equal(BEAT_STALE_MS, 5 * 60 * 1000)
})

test('F39: the age rule for a lock without a beat is longer than land.ps1\'s gate clock', () => {
  const land = readFileSync(new URL('../tools/land.ps1', import.meta.url), 'utf8')
  const gate = Number(land.match(/\$gateMinutes = \[double\](\d+)/)[1])
  assert.ok(MAX_AGE_MS > gate * 60 * 1000, `${MAX_AGE_MS / 60000} min > ${gate} min`)
})

test('F39: the real case of 2026-11-21 replayed: a first-class ticket counts 30 minutes earlier, so a worker waiting 30+ minutes goes before a later landing', () => {
  const at = (hhmm) => Date.parse(`2026-11-21T${hhmm}:00Z`)
  const ticket = (hhmm, label, first = false) => ({ name: `${String(at(hhmm)).padStart(15, '0')}-${String(label.length).padStart(8, '0')}.json`, first, label })
  const tickets = [
    ticket('10:30', 'Worker 3 B1294'), ticket('10:48', 'Worker 1 B1300'), ticket('10:58', 'Worker 5 B1279'), ticket('11:20', 'Worker 4 B1295'),
    ticket('10:33', 'land B1283', true), ticket('10:54', 'land A2', true), ticket('11:10', 'land A1/A3/A4', true), ticket('11:11', 'land A7', true),
  ]
  assert.deepEqual(queueOrder(tickets).map((one) => one.label), [
    'land B1283', 'land A2', 'Worker 3 B1294', 'land A1/A3/A4', 'land A7', 'Worker 1 B1300', 'Worker 5 B1279', 'Worker 4 B1295',
  ])
  // Today's rule put all four landings first: Worker 3, there since 10:30, would have waited for the landing of 11:11 too.
  assert.ok(aheadOf(tickets, tickets[0].name, false) < aheadOf(tickets, tickets[6].name, true), 'Worker 3 (40 min) before the landing of 11:10')
  assert.equal(FIRST_LEAD_MS, 30 * 60 * 1000)
  // The same order for every run: each one's place is its index in the one order.
  for (const [n, one] of queueOrder(tickets).entries()) assert.equal(aheadOf(tickets, one.name, one.first), n)
})

test('F39: the holder beats while its command runs, and gives the lock back after', async () => {
  const lock = newLock()
  const run = start(lock, 'beating', node('setTimeout(() => {}, 1500)'), { HEAVY_RUN_BEAT_MS: '200' })
  const seen = await until(() => existsSync(lock) && JSON.parse(readFileSync(lock, 'utf8')), 'the lock')
  const firstBeat = seen.beat
  await until(() => { try { const now = JSON.parse(readFileSync(lock, 'utf8')); return now.beat !== firstBeat && now } catch { return false } }, 'a newer beat', 5000)
  assert.equal((await run.done).code, 0)
  assert.equal(existsSync(lock), false)
})

test('npm test runs through the helper, and the README says that the tests wait their turn', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts.test, 'node tools/one-at-a-time.mjs test -- node tools/test.mjs')
  assert.match(readFileSync(new URL('../README.md', import.meta.url), 'utf8'), /one heavy run at a time/i)
})

// The person, 2026-10-31: "yes do 2 at a time", and a run that waited longest goes first. Two slots stay possible with
// HEAVY_RUN_SLOTS=2; the default is one again since 2026-11-11 (below).
test('with two slots two runs go at once; a third waits for one of them', async () => {
  assert.equal(slotsOf({ HEAVY_RUN_SLOTS: '1' }), 1)
  assert.equal(slotsOf({ HEAVY_RUN_SLOTS: '2' }), 2)
  assert.equal(slotPath('C:/t/heavy.lock', 1), 'C:/t/heavy.lock')
  assert.equal(slotPath('C:/t/heavy.lock', 2), 'C:/t/heavy.2.lock')
  const lock = newLock()
  const two = { HEAVY_RUN_SLOTS: '2' }
  // 2026-11-02 (a gate flake under load: the second's node took longer to start than the first's 900 ms wait): the first
  // ends only once the second has run, by a flag file the second writes; no clock is raced.
  const flag = join(scratch, `flag-${counter}`)
  const slow = [...node(`const f = process.argv[1]; (function look() { if (require('fs').existsSync(f)) return console.log(Date.now()); setTimeout(look, 20) })()`), flag]
  const first = start(lock, 'first', slow, two)
  const second = start(lock, 'second', [...node(`console.log(Date.now()); require('fs').writeFileSync(process.argv[1], '')`), flag], two)
  await until(() => existsSync(lock), 'a slot taken')
  const two1 = await second.done
  assert.equal(two1.code, 0)
  assert.doesNotMatch(two1.err, /waiting for/, 'the second ran beside the first')
  const one = await first.done
  assert.ok(Number(two1.out) <= Number(one.out), 'the second finished while the first still ran')
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

// The person, 2026-11-11: "too often claude slows down my pc very often ... the test suite", then "lets do A": one run at
// a time across all chats. The lock lies in the PC's temporary folder, so every worktree and chat shares it.
test('one at a time by default, across two folders: a run from another worktree waits for the first', async () => {
  assert.equal(DEFAULT_SLOTS, 1)
  assert.equal(slotsOf({}), 1)
  assert.equal(slotsOf({ HEAVY_RUN_SLOTS: 'x' }), 1)
  const lock = newLock()
  const here = join(scratch, `worktree-a-${counter}`)
  const there = join(scratch, `worktree-b-${counter}`)
  mkdirSync(here)
  mkdirSync(there)
  const plain = { HEAVY_RUN_SLOTS: '' }
  const first = start(lock, 'first', node('setTimeout(() => console.log(Date.now()), 700)'), plain, here)
  await until(() => existsSync(lock), 'the first run to take the lock')
  const second = start(lock, 'second', node('console.log(Date.now())'), plain, there)
  const [one, two] = await Promise.all([first.done, second.done])
  assert.equal(one.code, 0)
  assert.equal(two.code, 0)
  assert.ok(Number(two.out) >= Number(one.out), 'the second ran only after the first was done')
  assert.match(two.err, /waiting for first in .*worktree-a/)
})

test('a slot beyond this run\'s own counts: a run allowed one waits while another copy holds its second slot', async () => {
  const lock = newLock()
  writeFileSync(slotPath(lock, 2), lockText({ label: 'the game check' }))
  const waiting = start(lock, 'board tests', quick)
  await until(() => /waiting for the game check/.test(waiting.err), 'the run waiting for slot 2')
  rmSync(slotPath(lock, 2))
  const result = await waiting.done
  assert.equal(result.code, 0)
  assert.match(result.out, /ran/)
})

// A time limit, so a stale lock that holds the run up fails here instead of hanging the gate.
test('a stale lock in a slot beyond this run\'s own (its process gone) does not hold it up and is removed', { timeout: 20000 }, async () => {
  const lock = newLock()
  const gone = spawnSync(process.execPath, ['-e', '0']).pid
  writeFileSync(slotPath(lock, 2), lockText({ pid: gone }))
  const result = await start(lock, 'after a crash', quick).done
  assert.equal(result.code, 0)
  assert.match(result.out, /ran/)
  assert.doesNotMatch(result.err, /waiting for/)
  assert.equal(existsSync(slotPath(lock, 2)), false)
})

test('a landing\'s gate waits in the same queue: land.ps1 gates with npm test, which runs through the helper', () => {
  const land = readFileSync(new URL('../tools/land.ps1', import.meta.url), 'utf8')
  assert.match(land, /\$gateBoardCommand = 'npm test'/)
  assert.match(land, /Get-Setting 'gateBoard' 'npm test'/)
  assert.doesNotMatch(land, /HEAVY_RUN_(HELD|LOCK|SLOTS)/, 'the landing never skips or moves the queue')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(pkg.scripts.test, /^node tools\/one-at-a-time\.mjs /)
})

test('logs every run beside the lock: its label, folder, wait, run time, exit code and first-class word, but not a run held by another (2026-11-23)', async () => {
  const lock = newLock()
  const first = start(lock, 'gate', node('setTimeout(() => process.exit(3), 700)'))
  await until(() => existsSync(lock), 'the first run to take the lock')
  assert.equal((await start(lock, 'landing', quick, { HEAVY_RUN_FIRST: '1' }).done).code, 0)
  assert.equal((await first.done).code, 3)
  assert.equal((await start(lock, 'inner', quick, { HEAVY_RUN_HELD: '1' }).done).code, 0)
  const lines = readFileSync(`${lock}.runs.jsonl`, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(lines.map((one) => [one.label, one.exit, one.first, one.stopped]), [['gate', 3, false, null], ['landing', 0, true, null]])
  assert.equal(lines[1].cwd, process.cwd())
  assert.equal(typeof lines[1].waitedS, 'number')
  assert.equal(typeof lines[1].ranS, 'number')
})

// F39, chat 1's review (2026-11-21).
const ticketName = (ms, pid = process.pid) => `${String(ms).padStart(15, '0')}-${String(pid).padStart(8, '0')}.json`

test('F39 review, blocker 1: an old copy\'s ordinary ticket goes after every first-class one, so old and new copies never wait for each other', async () => {
  const now = Date.parse('2026-11-21T11:00:00Z')
  const old = { name: ticketName(now - 40 * 60000), first: false, fair: false }
  const landing = { name: ticketName(now), first: true, fair: true }
  const worker = { name: ticketName(now - 40 * 60000 + 1), first: false, fair: true }
  assert.deepEqual(queueOrder([old, landing, worker]).map((one) => one.name), [worker.name, landing.name, old.name])
  // The live case: an unmarked ticket of a living process, 40 minutes older than a new landing: the landing runs at once.
  const lock = newLock()
  mkdirSync(`${lock}.queue`)
  writeFileSync(join(`${lock}.queue`, ticketName(Date.now() - 40 * 60000)), lockText({ startedAt: new Date(Date.now() - 40 * 60000).toISOString() }))
  const gate = await start(lock, 'gate', quick, { HEAVY_RUN_FIRST: '1' }).done
  assert.equal(gate.code, 0)
  assert.doesNotMatch(gate.err, /waiting for/)
  assert.equal(ORDER_MARK, 2)
})

test('F39 review 3: each beat moves startedAt too (old copies judge by it), and since keeps when the slot was taken', async () => {
  const lock = newLock()
  const run = start(lock, 'beating', node('setTimeout(() => {}, 1500)'), { HEAVY_RUN_BEAT_MS: '200' })
  const first = await until(() => existsSync(lock) && JSON.parse(readFileSync(lock, 'utf8')), 'the lock')
  const later = await until(() => { try { const now = JSON.parse(readFileSync(lock, 'utf8')); return now.beat !== first.beat && now } catch { return false } }, 'a newer beat', 5000)
  assert.equal(later.since, first.since)
  assert.equal(later.startedAt, later.beat)
  assert.notEqual(later.startedAt, first.startedAt)
  assert.equal(later.order, ORDER_MARK)
  assert.equal((await run.done).code, 0)
})

test('F39 review 4: a live holder with an old beat (the PC slept) is not freed before two beats of the waiter\'s clock, nor while its lock changes', async () => {
  const lock = newLock()
  const stale = () => lockText({ since: new Date(Date.now() - 20 * 60000).toISOString(), beat: new Date(Date.now() - 6 * 60000).toISOString() })
  writeFileSync(lock, stale())
  const began = Date.now()
  const waiter = start(lock, 'after the sleep', quick, { HEAVY_RUN_BEAT_MS: '600' })
  // The holder beats again (its text changes) twice within the waiter's two beats: the waiter keeps waiting.
  await new Promise((done) => setTimeout(done, 500))
  writeFileSync(lock, stale())
  await new Promise((done) => setTimeout(done, 500))
  writeFileSync(lock, stale())
  const result = await waiter.done
  assert.equal(result.code, 0)
  assert.ok(Date.now() - began >= 2000, `freed only after its lock stayed the same for two beats (${Date.now() - began} ms)`)
})

test('F39 review 5: a run is stopped at the cap (HEAVY_RUN_MAX_MS) with code 124 and gives the slot back; a lock past the cap is stale', async () => {
  const lock = newLock()
  // S3, chat 1's review: the watch at every beat is the cap (no timer), so the beat is short here.
  const result = await start(lock, 'hangs', node('setTimeout(() => {}, 60000)'), { HEAVY_RUN_MAX_MS: '800', HEAVY_RUN_BEAT_MS: '100' }).done
  assert.equal(result.code, 124)
  assert.match(result.err, /one-at-a-time: hangs ran longer than 0 minutes and was stopped/)
  assert.equal(existsSync(lock), false)
  const now = Date.parse('2026-11-21T12:00:00Z')
  const held = (minutes) => ({ pid: 1, label: 'x', cwd: 'y', since: new Date(now - minutes * 60000).toISOString(), startedAt: new Date(now).toISOString(), beat: new Date(now).toISOString() })
  assert.equal(whyStale(held(125), now, () => true), null)
  assert.match(whyStale(held(131), now, () => true), /held the slot for over 130 minutes/)
  assert.equal(HOLD_MAX_MS, 120 * 60000)
})

test('F39 review 6: a ticket with an old beat (a reused pid), or an old copy\'s older than 3 hours, does not hold up the queue', async () => {
  for (const over of [{ order: 2, beat: new Date(Date.now() - 6 * 60000).toISOString() }, { startedAt: new Date(Date.now() - 4 * 60 * 60000).toISOString() }]) {
    const lock = newLock()
    mkdirSync(`${lock}.queue`)
    writeFileSync(join(`${lock}.queue`, ticketName(1)), lockText(over))
    const result = await start(lock, 'after it', quick).done
    assert.equal(result.code, 0)
    assert.doesNotMatch(result.err, /waiting for/)
  }
  assert.equal(TICKET_MAX_AGE_MS, 3 * 60 * 60000)
})

test('F39, the re-check: a waiter whose queue folder is removed makes it again and still runs', async () => {
  const lock = newLock()
  writeFileSync(lock, lockText())
  const waiter = start(lock, 'patient', quick)
  await until(() => /waiting for/.test(waiter.err), 'the waiter waiting')
  rmSync(`${lock}.queue`, { recursive: true, force: true })
  await until(() => existsSync(`${lock}.queue`), 'the queue folder made again', 5000)
  rmSync(lock)
  const result = await waiter.done
  assert.equal(result.code, 0)
  assert.match(result.out, /ran/)
})

// S3 (chat 1, 2026-11-25, the PC plan's queue hygiene): work on no step's critical path waits for an idle PC, and the hold cap holds
// across a PC sleep.
test('S3: the runs that wait for an idle PC: the slow tier, a step\'s measure, draw and trial jobs, perf- and idle: runs, or HEAVY_RUN_IDLE=1; a builder\'s proof is no such run', () => {
  for (const label of ['slow-tier', 'idle:big-suite', 'perf-gate', 'b1517-measure2', 'B12-draw', 'b3-trial']) assert.equal(isIdleRun(label, {}), true, label)
  for (const label of ['test', 'check', 'check:quick', 'test:screens', 'rerun', 'f68-mutants', 'b1297-mut', 'f68-carryGit-normal', 'b1517-test', 'slow-tier-x', 'my-idle:x', 'b-measure', 'b1544-drawbridge', 'b1600-draw-order', 'b12-trials']) assert.equal(isIdleRun(label, {}), false, label)
  assert.equal(isIdleRun('check', { HEAVY_RUN_IDLE: '1' }), true)
  assert.equal(isIdleRun('check', { HEAVY_RUN_IDLE: '0' }), false)
  assert.equal(idleRoomOf('C:/t/one-heavy-run.lock'), 'C:/t/one-heavy-run.lock.idle')
})

test('S3: an idle run that came first waits in the idle room while a check waits in the queue, and goes once the queue is empty', async () => {
  const lock = newLock()
  writeFileSync(lock, lockText())
  const idle = start(lock, 'slow-tier', node('console.log(Date.now())'))
  await until(() => /waiting for an idle PC \(someone in C:\/elsewhere/.test(idle.err), 'the idle run waiting')
  // Tickets only: a beat's file beside one comes and goes.
  const tickets = (folder) => readdirSync(folder).filter((name) => name.endsWith('.json')).length
  assert.equal(tickets(idleRoomOf(lock)), 1, 'its ticket in the room')
  assert.equal(tickets(`${lock}.queue`), 0, 'none in the queue')
  const check = start(lock, 'check', node('setTimeout(() => console.log(Date.now()), 300)'))
  await until(() => /waiting for someone/.test(check.err), 'the check waiting')
  rmSync(lock)
  const [one, two] = await Promise.all([idle.done, check.done])
  assert.deepEqual([one.code, two.code], [0, 0])
  assert.ok(Number(one.out) >= Number(two.out), 'the idle run went only after the check that came later had run')
  assert.match(one.err, /one-at-a-time: slow-tier runs now \(waited \d+ s\)/)
  assert.equal(tickets(idleRoomOf(lock)), 0, 'the room is empty after')
  const logged = readFileSync(`${lock}.runs.jsonl`, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(logged.map((line) => [line.label, line.idle === true]), [['check', false], ['slow-tier', true]])
})

test('S3: an old copy\'s ticket or lock holds an idle run back too: the two never run at once, and never wait for each other', async () => {
  const lock = newLock()
  mkdirSync(`${lock}.queue`)
  // An old copy's ticket (unmarked, no beat) that came after the idle run.
  const old = join(`${lock}.queue`, ticketName(Date.now() + 60000))
  writeFileSync(old, lockText())
  const idle = start(lock, 'idle:job', quick)
  await until(() => /waiting for an idle PC \(no run, 1 in the queue\)/.test(idle.err), 'the idle run waiting behind the old ticket')
  // The old copy takes the slot (its lock has no beat): the idle run still waits.
  writeFileSync(lock, lockText())
  rmSync(old)
  await new Promise((done) => setTimeout(done, 400))
  assert.equal(idle.child.exitCode, null, 'still waiting while the old copy holds the slot')
  rmSync(lock)
  const result = await idle.done
  assert.equal(result.code, 0)
  assert.match(result.out, /ran/)
})

test('S3: two idle runs go oldest first, also when the younger one looks far more often', async () => {
  const lock = newLock()
  writeFileSync(lock, lockText())
  const older = start(lock, 'slow-tier', node('setTimeout(() => console.log(Date.now()), 200)'), { HEAVY_RUN_POLL_MS: '300' })
  await until(() => /waiting for an idle PC/.test(older.err), 'the older idle run waiting')
  const younger = start(lock, 'idle:younger', node('console.log(Date.now())'), { HEAVY_RUN_POLL_MS: '10' })
  await until(() => /waiting for an idle PC/.test(younger.err), 'the younger idle run waiting')
  rmSync(lock)
  const [one, two] = await Promise.all([older.done, younger.done])
  assert.deepEqual([one.code, two.code], [0, 0])
  assert.ok(Number(two.out) >= Number(one.out), 'the younger idle run went after the older one')
})

test('S3: a gate that comes right after an idle run took the slot waits for that run to end, and no longer (measured)', async (t) => {
  const lock = newLock()
  const idle = start(lock, 'slow-tier', node('setTimeout(() => console.log(Date.now()), 1500)'))
  await until(() => existsSync(lock) && readFileSync(lock, 'utf8').includes('slow-tier'), 'the idle run holding the slot')
  const came = Date.now()
  const gate = start(lock, 'gate', node('console.log(Date.now())'), { HEAVY_RUN_FIRST: '1' })
  const [one, two] = await Promise.all([idle.done, gate.done])
  assert.deepEqual([one.code, two.code], [0, 0])
  const left = Number(one.out) - came
  const waited = Number(two.out) - came
  t.diagnostic(`the idle run had ${left} ms left when the gate came; the gate's command began after ${waited} ms`)
  assert.ok(waited >= left, 'the gate never runs beside the idle run')
  // A poll, a shell and a node start, under whatever load the PC has: the bound is wide, the diagnostic says the real number.
  assert.ok(waited - left < 10000, `the gate waited ${waited - left} ms beyond the idle run's time left (a poll and a node start)`)
})

test('S3, chat 1\'s review: a sleep is no hang: a run that spans a sleep is not stopped, and its lock\'s since moves on by the time slept, so no waiter (old copies too) calls it stale', async () => {
  const lock = newLock()
  let jump = 0
  const run = runOneAtATime({
    label: 'slow-tier', command: node('setTimeout(() => {}, 2500)'), env: envFor(lock, { HEAVY_RUN_BEAT_MS: '100', HEAVY_RUN_MAX_MS: String(60 * 60000) }),
    signals: new EventEmitter(), say: () => {}, now: () => Date.now() + jump,
  })
  const before = await until(() => existsSync(lock) && JSON.parse(readFileSync(lock, 'utf8')), 'the run holding the slot')
  // The PC slept three hours, well past the cap.
  jump = 3 * 60 * 60000
  const held = await until(() => { try { const info = JSON.parse(readFileSync(lock, 'utf8')); return Date.parse(info.since) > Date.parse(before.since) + 60 * 60000 && info } catch { return false } }, 'a beat that moved since on', 5000)
  // since says the time awake: an F39 copy (since alone) and this one both see a run of a few seconds, not one of three hours
  assert.ok(Date.now() + jump - Date.parse(held.since) < 60000, `awake ${Date.now() + jump - Date.parse(held.since)} ms by since`)
  assert.equal(whyStale(held, Date.now() + jump, () => true), null)
  assert.equal(await run, 0, 'the command ran to its end')
})

test('S3, chat 1\'s review: no timer is the cap: a run past the cap in real time but not awake (a clock that slept) runs to its end', async () => {
  const lock = newLock()
  const began = Date.now()
  // The wall clock moves at a twentieth of real time: 1.5 s real are 75 ms awake, the cap is 400 ms. A timer of 400 ms would stop it.
  const run = runOneAtATime({
    label: 'long', command: node('setTimeout(() => {}, 1500)'), env: envFor(lock, { HEAVY_RUN_BEAT_MS: '50', HEAVY_RUN_MAX_MS: '400' }),
    signals: new EventEmitter(), say: () => {}, now: () => began + (Date.now() - began) / 20,
  })
  assert.equal(await run, 0)
  assert.ok(Date.now() - began >= 1400)
})

test('S3, chat 1\'s review: the hold cap counts the time awake: a run past it by the wall clock, with no gap of a sleep, is stopped with 124', async () => {
  const lock = newLock()
  const said = []
  const began = Date.now()
  // Time runs 600 times faster: each 100 ms beat is a minute, never a gap of a sleep; the 60-minute cap comes after about 6 s.
  const run = runOneAtATime({
    label: 'hangs', command: node('setTimeout(() => {}, 30000)'), env: envFor(lock, { HEAVY_RUN_BEAT_MS: '100', HEAVY_RUN_MAX_MS: String(60 * 60000) }),
    signals: new EventEmitter(), say: (line) => said.push(line), now: () => began + (Date.now() - began) * 600,
  })
  assert.equal(await run, 124)
  assert.ok(Date.now() - began < 20000, 'stopped at a beat, not when the command ended')
  assert.ok(said.some((line) => /hangs ran longer than 60 minutes and was stopped/.test(line)), said.join('\n'))
  assert.equal(existsSync(lock), false)
})

// S3, core review (2026-11-25): after a PC sleep an idle run still counts a live ticket whose beat is only old, and a waiter gives a
// holder past the cap by the wall clock two beats to stop itself; a first-class run is never idle.
test('S3 review: after a sleep an idle run still counts a live gate ticket whose beat is old, until it stayed the same for two of its beats', async () => {
  const lock = newLock()
  mkdirSync(`${lock}.queue`)
  const gate = join(`${lock}.queue`, ticketName(Date.now() - 20 * 60000))
  const slept = () => lockText({ first: true, order: ORDER_MARK, beat: new Date(Date.now() - 6 * 60000).toISOString() })
  writeFileSync(gate, slept())
  const idle = start(lock, 'slow-tier', quick, { HEAVY_RUN_BEAT_MS: '600' })
  await until(() => /waiting for an idle PC \(no run, 1 in the queue\)/.test(idle.err), 'the idle run waiting behind the gate')
  // The gate wakes and beats again (its text changes) within the idle run's two beats: still counted.
  await new Promise((done) => setTimeout(done, 700))
  assert.equal(existsSync(gate), true, 'the sleeping gate\'s ticket is not removed at once')
  writeFileSync(gate, slept())
  const changed = Date.now()
  await new Promise((done) => setTimeout(done, 700))
  assert.equal(idle.child.exitCode, null, 'the idle run still waits')
  // It stays the same from now on (its owner never woke): removed after two beats, and the idle run goes.
  const result = await idle.done
  assert.equal(result.code, 0)
  assert.ok(Date.now() - changed >= 1200, `went only after the gate's ticket stayed the same for two beats (${Date.now() - changed} ms)`)
  assert.equal(existsSync(gate), false)
})

test('S3 review: a live holder past the cap by the wall clock (the PC slept) gets two beats of the waiter\'s clock to stop itself before its slot is freed', async () => {
  const lock = newLock()
  const since = new Date(Date.now() - 131 * 60000).toISOString()
  writeFileSync(lock, lockText({ since, beat: new Date().toISOString(), order: ORDER_MARK }))
  const began = Date.now()
  const waiter = start(lock, 'after the sleep', quick, { HEAVY_RUN_BEAT_MS: '400' })
  const planted = readFileSync(lock, 'utf8')
  await new Promise((done) => setTimeout(done, 500))
  assert.equal(readFileSync(lock, 'utf8'), planted, 'the planted lock is not freed at the first look')
  const result = await waiter.done
  assert.equal(result.code, 0)
  assert.ok(Date.now() - began >= 800, `freed only after two beats (${Date.now() - began} ms)`)
})

test('S3 review: after a sleep a younger idle run waits for an older idle run whose beat is old, until it stayed the same for two beats', async () => {
  const lock = newLock()
  mkdirSync(idleRoomOf(lock))
  const older = join(idleRoomOf(lock), ticketName(Date.now() - 20 * 60000))
  writeFileSync(older, lockText({ label: 'idle:older', idle: true, order: ORDER_MARK, beat: new Date(Date.now() - 6 * 60000).toISOString() }))
  const began = Date.now()
  const younger = start(lock, 'idle:younger', quick, { HEAVY_RUN_BEAT_MS: '600' })
  await until(() => /waiting for an idle PC/.test(younger.err), 'the younger idle run waiting')
  await new Promise((done) => setTimeout(done, 700))
  assert.equal(existsSync(older), true, 'the older run\'s ticket is not removed at once')
  assert.equal(younger.child.exitCode, null, 'the younger run still waits')
  const result = await younger.done
  assert.equal(result.code, 0)
  assert.ok(Date.now() - began >= 1200, `went only after the older ticket stayed the same for two beats (${Date.now() - began} ms)`)
  assert.equal(existsSync(older), false)
})

test('S3 review: the command of an idle run does not see HEAVY_RUN_IDLE, so the runs it starts in turn are ordinary ones', async () => {
  const result = await start(newLock(), 'some job', node('console.log(String(process.env.HEAVY_RUN_IDLE))'), { HEAVY_RUN_IDLE: '1' }).done
  assert.equal(result.code, 0)
  assert.equal(result.out.trim(), 'undefined')
  assert.match(result.err, /one-at-a-time: some job runs now/)
})

test('S3 review: a first-class run with an idle label waits in the queue as first-class, never in the idle room', async () => {
  const lock = newLock()
  writeFileSync(lock, lockText())
  const check = start(lock, 'check', node('console.log(Date.now())'))
  await until(() => /waiting for someone/.test(check.err), 'the check waiting')
  const gate = start(lock, 'slow-tier', node('console.log(Date.now())'), { HEAVY_RUN_FIRST: '1' })
  await until(() => /waiting for someone/.test(gate.err), 'the first-class run waiting in the queue')
  assert.equal(existsSync(idleRoomOf(lock)), false, 'no idle room was made')
  rmSync(lock)
  const [one, two] = await Promise.all([check.done, gate.done])
  assert.deepEqual([one.code, two.code], [0, 0])
  assert.ok(Number(two.out) <= Number(one.out), 'the first-class run went before the check that came earlier')
})
