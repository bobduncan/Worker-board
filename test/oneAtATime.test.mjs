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
import { BEAT_STALE_MS, DEFAULT_SLOTS, FIRST_LEAD_MS, HOLD_MAX_MS, MAX_AGE_MS, ORDER_MARK, TICKET_MAX_AGE_MS, aheadOf, gateWaits, giveWayLookOf, givesWay, idleRoomOf, isIdleRun, markOf, orderEntry, pidRuns, queueOrder, runOneAtATime, slotPath, slotsOf, whyStale } from '../tools/one-at-a-time.mjs'

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
  // Hotfix (2026-11-27): no fence of the run around this test (a gate inside the live fence gives HEAVY_RUN_PRIORITY, _MASK, _CORES).
  const { HEAVY_RUN_HELD: _held, HEAVY_RUN_FIRST: _first, HEAVY_RUN_PRIORITY: _priority, HEAVY_RUN_MASK: _mask, HEAVY_RUN_CORES: _cores, ...plain } = process.env
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
  // S9: npm test with --gate, the light check, still through the helper.
  assert.match(land, /\$gateBoardCommand = 'npm test -- --gate'/)
  assert.match(land, /Get-Setting 'gateBoard' 'npm test -- --gate'/)
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

test('S3, P4: a gate that comes right after an ordinary run took the slot waits for that run to end, and no longer (measured)', async (t) => {
  const lock = newLock()
  const check = start(lock, 'check', node('setTimeout(() => console.log(Date.now()), 1500)'))
  await until(() => existsSync(lock) && readFileSync(lock, 'utf8').includes('"check"'), 'the ordinary run holding the slot')
  const came = Date.now()
  const gate = start(lock, 'gate', node('console.log(Date.now())'), { HEAVY_RUN_FIRST: '1' })
  const [one, two] = await Promise.all([check.done, gate.done])
  assert.deepEqual([one.code, two.code], [0, 0])
  assert.doesNotMatch(one.err, /gives way/, 'an ordinary run never gives way')
  const left = Number(one.out) - came
  const waited = Number(two.out) - came
  t.diagnostic(`the run had ${left} ms left when the gate came; the gate's command began after ${waited} ms`)
  assert.ok(waited >= left, 'the gate never runs beside the run')
  // A poll, a shell and a node start, under whatever load the PC has: the bound is wide, the diagnostic says the real number.
  assert.ok(waited - left < 10000, `the gate waited ${waited - left} ms beyond the run's time left (a poll and a node start)`)
})

/** P4: a short settle time after a give-way (GATE_SETTLE_MS is a minute), for the cases that are not about it. */
const settle = { HEAVY_RUN_SETTLE_MS: '200' }
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('P4: the runs that give way to a gate: those safe to kill and rerun (yield:, HEAVY_RUN_YIELD=1, an idle run that sets it), never a plain idle run, a first-class one or one under another', () => {
  assert.deepEqual(['yield:p4-mutants', 'idle:x', 'slow-tier', 'b1517-measure2', 'check', 'gate', 'test'].map((label) => givesWay(label, {})), [true, false, false, false, false, false, false])
  assert.equal(givesWay('check', { HEAVY_RUN_YIELD: '1' }), true)
  assert.equal(givesWay('idle:big-suite', { HEAVY_RUN_YIELD: '1' }), true, 'an idle run that says it is safe to kill and rerun')
  assert.equal(givesWay('yield:x', { HEAVY_RUN_FIRST: '1' }), false, 'a gate never gives way')
  assert.equal(givesWay('idle:x', { HEAVY_RUN_FIRST: '1', HEAVY_RUN_YIELD: '1' }), false, 'nor a first-class run')
  assert.equal(givesWay('yield:x', { HEAVY_RUN_HELD: '1' }), false, 'a run under another holds no slot of its own')
  assert.equal(giveWayLookOf(5000), 1250, 'a quarter poll')
  assert.equal(giveWayLookOf(50), 250, 'never more often than every 250 ms')
  assert.equal(markOf({ HEAVY_RUN_MARK: 'ab12cd34ef' }), ' [ab12cd34ef]')
  assert.equal(markOf({ HEAVY_RUN_MARK: 'not hex at all' }), '')
})

test('P4 (chat 1, 2026-11-27, in place of core review 2): gateWaits: a first-class ticket waits, also behind an older ordinary one, and no slot is free', () => {
  const lock = newLock()
  const queue = `${lock}.queue`
  mkdirSync(queue, { recursive: true })
  const put = (ago, more) => writeFileSync(join(queue, `${String(Date.now() - ago).padStart(15, '0')}-${String(process.pid).padStart(8, '0')}.json`), JSON.stringify({ pid: process.pid, label: 'x', cwd: 'C:/x', startedAt: new Date(Date.now() - ago).toISOString(), order: ORDER_MARK, beat: new Date().toISOString(), ...more }))
  writeFileSync(lock, lockText())
  assert.equal(gateWaits(lock, 1), false, 'nobody waits')
  put(2000, {})
  assert.equal(gateWaits(lock, 1), false, 'only an ordinary ticket waits')
  put(1000, { first: true })
  assert.equal(gateWaits(lock, 1), true, 'a gate waits and the one slot is held')
  assert.equal(gateWaits(lock, 2), false, 'a second slot is free')
  writeFileSync(slotPath(lock, 2), lockText())
  assert.equal(gateWaits(lock, 2), true, 'both slots held')
  put(35 * 60_000, {})
  assert.equal(gateWaits(lock, 2), true, 'an ordinary ticket 35 minutes older goes first, and the gate waits all the same')
})

/** P4: a command that notes each start (its pid) in `marks`, and runs `ms` the first `long` times, else ends at once with 0. */
const startsOver = (marks, long = 1, ms = 60000) => node(`const fs = require('fs'); fs.appendFileSync(${JSON.stringify(marks)}, process.pid + '\\n'); const n = fs.readFileSync(${JSON.stringify(marks)}, 'utf8').trim().split('\\n').length; setTimeout(() => process.exit(0), n <= ${long} ? ${ms} : 100)`)
const startsOf = (marks) => (existsSync(marks) ? readFileSync(marks, 'utf8').trim().split('\n').filter(Boolean).map(Number) : [])
const pidRunsNow = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}
const holding = (lock, label) => existsSync(lock) && readFileSync(lock, 'utf8').includes(`"${label}"`)

test('P4, the real case: a gate that comes while a yield: run holds the slot gets it within one poll; the run\'s whole tree stops, it waits at the back and starts over later', async (t) => {
  const lock = newLock()
  const marks = join(scratch, `marks-${++counter}.txt`)
  // A poll of two seconds, so "within one poll" stands out from a process start and a taskkill on a loaded PC.
  const slow = { HEAVY_RUN_POLL_MS: '2000', ...settle }
  const run = start(lock, 'yield:p4-mutants', startsOver(marks), slow)
  await until(() => startsOf(marks).length === 1, 'the yield run\'s command running')
  const [first] = startsOf(marks)
  const gate = start(lock, 'gate', node('setTimeout(() => console.log(Date.now()), 800)'), { ...slow, HEAVY_RUN_FIRST: '1' })
  // The gate came when its ticket is in the queue (its own process start is no part of the wait).
  await until(() => existsSync(`${lock}.queue`) && readdirSync(`${lock}.queue`).length > 0, 'the gate\'s ticket in the queue')
  const came = Date.now()
  await until(() => /gate runs now/.test(gate.err), 'the gate taking the slot')
  const took = Date.now() - came
  t.diagnostic(`the gate took the slot ${took} ms after its ticket came (poll 2000 ms)`)
  assert.ok(took < 4000, `the gate takes the slot at its first look after the one it came with (${took} ms)`)
  assert.match(run.err, /one-at-a-time: yield:p4-mutants gives way to a gate \(its command starts over at its next turn\)/)
  assert.equal(pidRunsNow(first), false, 'the command that gave way no longer runs (its whole tree was stopped)')
  // While the gate runs, the run waits in the queue (not the idle room), its ticket saying it gave way once.
  const tickets = () => (existsSync(`${lock}.queue`) ? readdirSync(`${lock}.queue`).map((name) => JSON.parse(readFileSync(join(`${lock}.queue`, name), 'utf8'))) : [])
  const mine = await until(() => tickets().find((one) => one.label === 'yield:p4-mutants'), 'the run\'s ticket in the queue')
  assert.equal(mine.gaveWay, 1)
  const [gateEnd, end] = await Promise.all([gate.done, run.done])
  assert.deepEqual([gateEnd.code, end.code], [0, 0], end.err)
  assert.equal(startsOf(marks).length, 2, 'the command started over once, after the gate')
  assert.doesNotMatch(end.err, /times in a row/, 'once is no news')
  // Core review 4: the log has a record of the give-way itself, and one of the run's end.
  const logged = readFileSync(`${lock}.runs.jsonl`, 'utf8').trim().split('\n').map((line) => JSON.parse(line)).filter((one) => one.label === 'yield:p4-mutants')
  assert.deepEqual(logged.map((one) => [one.stopped ?? null, one.exit, one.gaveWay]), [['gave way to a gate', null, 1], [null, 0, 1]])
})

test('P4, today\'s real case (chat 1, 2026-11-27): a yield run keeps the slot while only an ordinary run waits; a gate comes behind that run (it came 35 min before), the yield run gives way, the ordinary run goes, then the gate, then the yield run starts over', async () => {
  const lock = newLock()
  const marks = join(scratch, `marks-${++counter}.txt`)
  const order = join(scratch, `order-${++counter}.txt`)
  const note = (name) => node(`require('fs').appendFileSync(${JSON.stringify(order)}, '${name}\\n'); setTimeout(() => process.exit(0), 1000)`)
  const yieldCommand = node(`const fs = require('fs'); fs.appendFileSync(${JSON.stringify(marks)}, process.pid + '\\n'); fs.appendFileSync(${JSON.stringify(order)}, 'yield\\n'); const n = fs.readFileSync(${JSON.stringify(marks)}, 'utf8').trim().split('\\n').length; setTimeout(() => process.exit(0), n <= 1 ? 60000 : 100)`)
  const run = start(lock, 'yield:p4-mutants', yieldCommand, settle)
  await until(() => startsOf(marks).length === 1, 'the yield run\'s command running')
  // b1568-m2 of today: an ordinary run whose ticket came 35 minutes before the gate, so the queue's order serves it first.
  const check = start(lock, 'b1568-m2', note('check'), { HEAVY_RUN_CAME_AT: String(Date.now() - 35 * 60_000) })
  await until(() => /waiting for yield:p4-mutants/.test(check.err), 'the ordinary run waiting')
  await pause(1500)
  assert.doesNotMatch(run.err, /gives way/, 'no give-way while only an ordinary run waits')
  const gate = start(lock, 'test', note('gate'), { HEAVY_RUN_FIRST: '1' })
  await until(() => /gives way to a gate/.test(run.err), 'the give-way, with an ordinary run ahead of the gate')
  const [gateEnd, checkEnd, end] = await Promise.all([gate.done, check.done, run.done])
  assert.deepEqual([gateEnd.code, checkEnd.code, end.code], [0, 0, 0], end.err)
  assert.deepEqual(readFileSync(order, 'utf8').trim().split('\n'), ['yield', 'check', 'gate', 'yield'], 'the ordinary run first, the gate right after it, the yield run last')
  assert.match(gate.err, /waiting for b1568-m2/, 'the gate waited for the ordinary run only')
})

test('P4 (chat 1\'s re-check, 2026-11-27): queueOrder puts a settling ticket (a run that gave way) after every gate in the line, and after what goes before one; with no gate it keeps its place', () => {
  const at = Date.now()
  const name = (ago, pid) => `${String(at - ago).padStart(15, '0')}-${String(pid).padStart(8, '0')}.json`
  const settling = { name: name(35 * 60_000, 1), first: false, fair: true, settles: true }
  const ordinary = { name: name(33 * 60_000, 2), first: false, fair: true, settles: false }
  const gate = { name: name(0, 3), first: true, fair: true, settles: false }
  const order = (tickets) => queueOrder(tickets).map((one) => one.name)
  assert.deepEqual(order([settling, ordinary, gate]), [ordinary.name, gate.name, settling.name], 'a gate 35 minutes younger goes before it; the run that goes before the gate too')
  assert.equal(aheadOf([settling, ordinary, gate], gate.name, true), 1, 'the gate waits for the ordinary run only')
  assert.deepEqual(order([settling, ordinary]), [settling.name, ordinary.name], 'no gate in the line: its own place')
  const later = { ...settling, name: name(-1000, 4) }
  assert.deepEqual(order([gate, later]), [gate.name, later.name], 'one that came after the gate stays after it')
  assert.deepEqual(orderEntry('x.json', { first: true, order: ORDER_MARK, gaveWay: 2 }), { name: 'x.json', first: true, fair: true, settles: true }, 'a ticket as every reader reads it')
  assert.equal(orderEntry('x.json', { order: ORDER_MARK }).settles, false)
})

test('P4, the real case of chat 1\'s re-check: a yield run that came 35 min before a gate gives way to a first gate; a second gate, 35 min younger than its ticket, goes before it while it settles (no deadlock)', async () => {
  const lock = newLock()
  const marks = join(scratch, `marks-${++counter}.txt`)
  const order = join(scratch, `order-${++counter}.txt`)
  const said = () => (existsSync(order) ? readFileSync(order, 'utf8').trim().split('\n') : [])
  const note = (name) => node(`require('fs').appendFileSync(${JSON.stringify(order)}, '${name}\\n'); setTimeout(() => process.exit(0), 1000)`)
  const yieldCommand = node(`const fs = require('fs'); fs.appendFileSync(${JSON.stringify(marks)}, process.pid + '\\n'); fs.appendFileSync(${JSON.stringify(order)}, 'yield\\n'); const n = fs.readFileSync(${JSON.stringify(marks)}, 'utf8').trim().split('\\n').length; setTimeout(() => process.exit(0), n <= 1 ? 60000 : 100)`)
  // Its ticket says it came 35 minutes ago, at every turn: so after its give-way it queues again ahead of any gate younger than 30 min.
  const run = start(lock, 'yield:big-suite', yieldCommand, { ...settle, HEAVY_RUN_CAME_AT: String(Date.now() - 35 * 60_000) })
  await until(() => startsOf(marks).length === 1, 'the yield run\'s command running')
  const first = start(lock, 'gate', note('gate1'), { HEAVY_RUN_FIRST: '1' })
  await until(() => said().includes('gate1'), 'the first gate running')
  const second = start(lock, 'test', note('gate2'), { HEAVY_RUN_FIRST: '1' })
  // Without the fix each waits for the other here (until land.ps1's queue bound): the bound of this look fails the case instead.
  await until(() => said().includes('gate2'), 'the second gate running before the settling run', 20000)
  const [one, two, end] = await Promise.all([first.done, second.done, run.done])
  assert.deepEqual([one.code, two.code, end.code], [0, 0, 0], end.err)
  assert.deepEqual(said(), ['yield', 'gate1', 'gate2', 'yield'], 'both gates first, then the yield run starts over')
})

test('P4, core review 1: a slot file a reader holds open at the give-way is not lost: the run tries again until it is gone, and never waits for itself', { skip: process.platform !== 'win32' && 'Windows file sharing' }, async () => {
  const lock = newLock()
  const marks = join(scratch, `marks-${++counter}.txt`)
  const run = start(lock, 'yield:x', startsOver(marks), settle)
  await until(() => startsOf(marks).length === 1 && holding(lock, 'yield:x'), 'the yield run holding the slot')
  // A reader without delete sharing (as PowerShell's Get-Content or a scanner), for 2 s around the give-way.
  const reader = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', `$f = [System.IO.File]::Open('${lock.replace(/'/g, "''")}', 'Open', 'Read', 'Read'); [Console]::Out.WriteLine('open'); Start-Sleep -Milliseconds 2000; $f.Close()`], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
  let opened = ''
  reader.stdout.on('data', (data) => (opened += data))
  await until(() => opened.includes('open'), 'the reader holding the slot file')
  const gate = start(lock, 'gate', quick, { HEAVY_RUN_FIRST: '1' })
  const [gateEnd, end] = await Promise.all([gate.done, run.done])
  assert.deepEqual([gateEnd.code, end.code], [0, 0], end.err)
  assert.equal(startsOf(marks).length, 2, 'it started over after the gate')
  assert.equal(existsSync(lock), false)
})

test('P4, core review 1: a slot file that names this very run while it waits is its own of before: free, never a holder to wait for', { timeout: 20000 }, async () => {
  const lock = newLock()
  writeFileSync(lock, lockText({ pid: process.pid, label: 'me', cwd: process.cwd() }))
  const said = []
  const code = await runOneAtATime({ label: 'me', command: quick, env: envFor(lock), say: (line) => said.push(line) })
  assert.equal(code, 0)
  assert.match(said.join('\n'), /one-at-a-time: me runs now/)
})

test('P4, core review 3: a run never waits behind its own ticket of before, in the queue or the idle room', { timeout: 20000 }, async () => {
  const lock = newLock()
  const leftover = (folder) => {
    mkdirSync(folder, { recursive: true })
    const ago = Date.now() - 60_000
    writeFileSync(join(folder, `${String(ago).padStart(15, '0')}-${String(process.pid).padStart(8, '0')}.json`), JSON.stringify({ pid: process.pid, label: 'me before', cwd: 'C:/elsewhere', startedAt: new Date(ago).toISOString(), order: ORDER_MARK, beat: new Date().toISOString() }))
  }
  leftover(`${lock}.queue`)
  assert.equal(await runOneAtATime({ label: 'me', command: quick, env: envFor(lock), say: () => {} }), 0)
  assert.deepEqual(readdirSync(`${lock}.queue`), [], 'its leftover went')
  leftover(idleRoomOf(lock))
  assert.equal(await runOneAtATime({ label: 'idle:me', command: quick, env: envFor(lock), say: () => {} }), 0)
  assert.deepEqual(readdirSync(idleRoomOf(lock)), [])
})

test('P4, core review 4: a run that gave way three times in a row says so with since when, and keeps its next turn with no gate in the line: a gate that comes then waits for it', async () => {
  const lock = newLock()
  const marks = join(scratch, `marks-${++counter}.txt`)
  const run = start(lock, 'yield:big', startsOver(marks, 4, 2500), settle)
  for (let time = 1; time <= 3; time += 1) {
    await until(() => startsOf(marks).length === time && holding(lock, 'yield:big'), `the run holding the slot, start ${time}`, 40000)
    const gate = start(lock, 'gate', node('setTimeout(() => {}, 500)'), { HEAVY_RUN_FIRST: '1' })
    assert.equal((await gate.done).code, 0)
  }
  await until(() => startsOf(marks).length === 4 && holding(lock, 'yield:big'), 'its fourth start', 40000)
  const gate = start(lock, 'gate', node('console.log(Date.now())'), { HEAVY_RUN_FIRST: '1' })
  const [gateEnd, end] = await Promise.all([gate.done, run.done])
  assert.deepEqual([gateEnd.code, end.code], [0, 0], end.err)
  assert.equal(startsOf(marks).length, 4, 'not stopped in its kept turn')
  assert.match(end.err, /one-at-a-time: yield:big keeps this turn: it gave way to a gate 3 times in a row, so a gate that comes now waits for it/)
  assert.doesNotMatch(end.err.split('\n').filter((line) => /gives way/.test(line)).slice(0, 2).join('\n'), /in a row/, 'once or twice is no news')
  assert.match(end.err, /yield:big gives way to a gate \(its command starts over at its next turn; gave way to a gate 3 times in a row, not finished since \d\d:\d\d\)/)
  assert.match(end.err, /waiting for (?:the gates to settle \()?gate in .*; gave way to a gate 3 times in a row, not finished since \d\d:\d\d/, 'its waiting lines say it too')
})

test('P4 (nit of the core review): after a give-way a run takes no slot in the gap between a gate and its rerun (the settle time)', async () => {
  const lock = newLock()
  const marks = join(scratch, `marks-${++counter}.txt`)
  // Ten seconds, so the rerun's own start on a loaded PC stays inside it.
  const run = start(lock, 'yield:x', startsOver(marks), { HEAVY_RUN_SETTLE_MS: '10000' })
  await until(() => startsOf(marks).length === 1, 'the yield run\'s command running')
  const gate = start(lock, 'gate', node('setTimeout(() => {}, 300)'), { HEAVY_RUN_FIRST: '1' })
  assert.equal((await gate.done).code, 0)
  await pause(500)
  assert.equal(startsOf(marks).length, 1, 'not started in the gap')
  const rerun = start(lock, 'rerun', node('setTimeout(() => {}, 300)'), { HEAVY_RUN_FIRST: '1' })
  assert.equal((await rerun.done).code, 0)
  const end = await run.done
  assert.equal(end.code, 0, end.err)
  assert.equal(startsOf(marks).length, 2)
  assert.equal((end.err.match(/gives way to a gate/g) ?? []).length, 1, 'it gave way once, not again at the rerun')
})

test('P4, core review 7: a plain idle run keeps the slot when a gate comes; one that says it is safe to kill and rerun (HEAVY_RUN_YIELD=1) gives way and goes back to the idle room', async () => {
  const lock = newLock()
  const plainMarks = join(scratch, `marks-${++counter}.txt`)
  const plainIdle = start(lock, 'slow-tier', startsOver(plainMarks, 1, 1500))
  await until(() => startsOf(plainMarks).length === 1 && holding(lock, 'slow-tier'), 'the plain idle run holding the slot')
  const gate = start(lock, 'gate', quick, { HEAVY_RUN_FIRST: '1' })
  const [gateEnd, plainEnd] = await Promise.all([gate.done, plainIdle.done])
  assert.deepEqual([gateEnd.code, plainEnd.code], [0, 0])
  assert.doesNotMatch(plainEnd.err, /gives way/)
  assert.equal(startsOf(plainMarks).length, 1)
  const marks = join(scratch, `marks-${++counter}.txt`)
  const idle = start(lock, 'slow-tier', startsOver(marks), { HEAVY_RUN_YIELD: '1', ...settle })
  await until(() => startsOf(marks).length === 1 && holding(lock, 'slow-tier'), 'the idle run holding the slot')
  const second = start(lock, 'gate', node('setTimeout(() => {}, 600)'), { HEAVY_RUN_FIRST: '1' })
  await until(() => /gate runs now/.test(second.err), 'the gate taking the slot')
  await until(() => existsSync(idleRoomOf(lock)) && readdirSync(idleRoomOf(lock)).length === 1, 'the idle run back in the idle room')
  const [secondEnd, end] = await Promise.all([second.done, idle.done])
  assert.deepEqual([secondEnd.code, end.code], [0, 0], end.err)
  assert.match(end.err, /slow-tier gives way to a gate/)
  assert.equal(startsOf(marks).length, 2)
})

test('P4: a run that gives way never stops for a gate after a stop signal, and a signal while it waits again ends it', async () => {
  const lock = newLock()
  const marks = join(scratch, `marks-${++counter}.txt`)
  const run = start(lock, 'yield:x', startsOver(marks, 5), settle)
  await until(() => startsOf(marks).length === 1, 'the run\'s command running')
  const gate = start(lock, 'gate', node('setTimeout(() => {}, 3000)'), { HEAVY_RUN_FIRST: '1' })
  await until(() => /gives way/.test(run.err), 'the run giving way')
  run.child.kill('SIGTERM')
  const end = await run.done
  assert.notEqual(end.code, 0, 'stopped while it waited again: it ends, and its command never started over')
  assert.equal(startsOf(marks).length, 1)
  assert.equal((await gate.done).code, 0)
})

test('P4 (nit of the core review): the command does not see HEAVY_RUN_YIELD or the caller\'s mark, and the mark ends the "runs now" line', async () => {
  const result = await start(newLock(), 'yield:x', node('console.log(String(process.env.HEAVY_RUN_YIELD) + " " + String(process.env.HEAVY_RUN_MARK))'), { HEAVY_RUN_YIELD: '1', HEAVY_RUN_MARK: 'abcdef12' }).done
  assert.equal(result.code, 0)
  assert.equal(result.out.trim(), 'undefined undefined')
  assert.match(result.err, /^one-at-a-time: yield:x runs now \(waited \d+ s\) \[abcdef12\]$/m)
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
