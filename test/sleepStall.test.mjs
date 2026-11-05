// B1049 part 2 (2026-11-05): the PC slept from 2026-11-04 23:45:04 to 2026-11-05 08:15:06, and data/stalls.json holds it as
// a stall of the loop, 30599714 ms, naming the job self-update. It was a sleep, not a slow board. A stall is a sleep when
// it lasts over 10 min, spans a clock jump (the wall clock and the monotonic one disagree by over 5 s) or spans the
// board's start; a sleep stays in the log, in plain words, and is never a slow board (rule board-slow, B1011's harm bar).

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { stallLog, watchLoop } from '../src/stalls.mjs'
import { SLEEP_MS, isSleep, stallOf, stallWords } from '../src/stallWords.mjs'
import { WATCH_RULES } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'

const MIN = 60_000
const rule = WATCH_RULES.find(one => one.id === 'board-slow')
// The live file's entry, as it stands.
const REAL = { at: 1793862906516, ms: 30599714, kind: 'loop', requests: [], jobs: ['self-update'] }
const clockOf = ms => new Date(ms).toISOString().slice(11, 19)

const check = (now, lateCalls, stalls) => rule.check(buildView({ state: { lateCalls, stalls }, items: new Map(), now }), { seen: new Map(), observed: [] })

test('the real entry of 11-05 08:15 is a sleep: kept, in plain words, and board-slow and the harm bar ignore it', () => {
  const sleep = stallOf(REAL)
  assert.equal(isSleep(sleep), true)
  assert.equal(sleep.kind, 'sleep')
  assert.equal(stallWords(sleep, clockOf), `${clockOf(REAL.at)} 8.5 h the PC slept (not a slow board)`)
  // Two calls the board answered as it woke: sent before the sleep, so the chat gave up on them long ago.
  const now = REAL.at + MIN
  const woke = [{ at: REAL.at + 1000, ms: 30_599_000 }, { at: REAL.at + 2000, ms: 30_599_500 }]
  assert.deepEqual(check(now, woke, [REAL]), [], 'two calls that waited through a sleep are no slow board')
  // A call short enough to look ordinary but sent before the sleep began still overlaps it.
  assert.deepEqual(check(now, [{ at: REAL.at + 1000, ms: 11_000 }, { at: REAL.at + 2000, ms: 12_000 }], [{ ...REAL, at: REAL.at + 1500, ms: 5000, kind: 'sleep' }]), [])
  // Two ordinary late calls just after waking still count, and the evidence says the PC slept, never that the board was slow then.
  const after = [{ at: now - 30_000, ms: 15_000 }, { at: now - 5000, ms: 16_000 }]
  const found = check(now, after, [REAL])
  assert.equal(found.length, 1)
  assert.match(found[0].evidence, /the stall log names no stall in 10 min/)
  assert.match(found[0].evidence, /slept: .*the PC slept/)
  assert.doesNotMatch(found[0].evidence, /the loop blocked/)
})

test('a stall of 9 min without a clock jump still counts as a stall of the loop and is cited by board-slow', () => {
  const now = Date.UTC(2026, 10, 5, 12, 0, 0)
  let wall = now - 20 * MIN
  const log = stallLog({ now: () => wall, startedAt: wall - MIN })
  const from = wall
  wall += 9 * MIN + 500
  const stall = log.tick(from, wall, 500, 9 * MIN + 500)
  assert.equal(stall.kind, 'loop')
  assert.equal(isSleep(stall), false)
  assert.equal(stallOf(stall).kind, 'loop')
  const found = check(wall + MIN, [{ at: wall, ms: 12_000 }, { at: wall + 20_000, ms: 12_000 }], [stall])
  assert.equal(found.length, 1)
  assert.match(found[0].evidence, /the loop blocked/)
})

test('the log writes a sleep for a stall over 10 min, one across a clock jump, and one across the board\'s start', () => {
  const t0 = Date.UTC(2026, 10, 5, 8, 0, 0)
  const log = stallLog({ now: () => t0, startedAt: t0 - MIN })
  assert.equal(SLEEP_MS, 10 * MIN)
  assert.equal(log.tick(t0, t0 + 11 * MIN + 500, 500, 11 * MIN + 500).kind, 'sleep', 'over 10 min')
  assert.equal(log.tick(t0, t0 + 3500, 500, 3500).kind, 'loop', '3 s with both clocks agreeing')
  const jumped = log.tick(t0, t0 + 30_500, 500, 4500)
  assert.equal(jumped.kind, 'sleep', 'the wall clock ran 26 s more than the monotonic one')
  assert.deepEqual([jumped.requests, jumped.jobs], [[], []], 'a sleep names no request or job: none of them was slow')
  assert.equal(log.tick(t0 - 2 * MIN, t0 - 2 * MIN + 5000, 500, 5000).kind, 'sleep', 'it began before the board did')
  assert.equal(log.slowCall('work take by Worker 2', t0, t0 + 12 * MIN).kind, 'sleep', 'a call that waited 12 min')
  assert.equal(log.slowCall('work take by Worker 2', t0, t0 + 3000).kind, 'call')
  assert.deepEqual(log.recent().map(one => one.kind), ['sleep', 'loop', 'sleep', 'sleep', 'sleep', 'call'])
})

test('the loop\'s watch gives the log both clocks, so a sleep the monotonic clock did not count is told from a block', () => {
  let wall = Date.UTC(2026, 10, 5, 8, 0, 0)
  let mono = 1000
  const log = stallLog({ now: () => wall, startedAt: wall - MIN })
  let tick = null
  watchLoop(log, { every: 500, now: () => wall, mono: () => mono, setTimer: fn => { tick = fn; return 1 }, clearTimer: () => {} })
  wall += 500; mono += 500
  tick()
  wall += 3000; mono += 3000
  tick()
  wall += 40_000; mono += 500
  tick()
  assert.deepEqual(log.recent().map(one => one.kind), ['loop', 'sleep'])
})

test('a hang of 11 min with the PC awake is no sleep for board-slow: calls sent inside it count; the real sleep, with no sends inside, does not', () => {
  const end = Date.UTC(2026, 10, 5, 12, 0, 0)
  const block = { at: end, ms: 11 * MIN, kind: 'sleep', requests: [], jobs: [] }
  // Chats sent inside the block (5 and 3 min before it ended) and got their answers as it ended.
  const sentInside = [{ at: end, ms: 5 * MIN }, { at: end + 1000, ms: 3 * MIN }]
  assert.equal(check(end + 2000, sentInside, [block]).length, 1, 'sent while the PC was awake: the board hung')
  // The same stall with only calls sent before it began (the chats slept with the PC): no slow board.
  const sentBefore = [{ at: end, ms: 11 * MIN + 20_000 }, { at: end + 1000, ms: 12 * MIN }]
  assert.deepEqual(check(end + 2000, sentBefore, [block]), [])
  // A call that waited over 10 min but was sent inside the block still counts (no blanket ms exclusion).
  assert.equal(check(end + 2000, [{ at: end, ms: 10 * MIN + 1000 }, { at: end + 1000, ms: 9 * MIN }], [block]).length, 1)
  // The real 08:15 entry with calls sent before it began, and none inside: not counted.
  assert.deepEqual(check(REAL.at + MIN, [{ at: REAL.at, ms: 30_599_000 }, { at: REAL.at + 1000, ms: 30_599_900 }], [REAL]), [])
})

test('load() from a file turns the old real entry into a sleep, and the next save writes it as one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stalls-'))
  try {
    const file = join(dir, 'stalls.json')
    await writeFile(file, JSON.stringify({ stalls: [REAL] }))
    const log = stallLog({ file, now: () => REAL.at + MIN })
    await log.load()
    assert.deepEqual(log.recent(), [{ at: REAL.at, ms: REAL.ms, kind: 'sleep', requests: [], jobs: [] }])
    log.tick(REAL.at + 2 * MIN, REAL.at + 2 * MIN + 5000, 500, 5000)
    await log.saved()
    const written = JSON.parse(await readFile(file, 'utf8')).stalls
    assert.deepEqual(written.map(one => one.kind), ['sleep', 'loop'])
    assert.deepEqual([written[0].requests, written[0].jobs], [[], []], 'the job self-update is no longer named')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
