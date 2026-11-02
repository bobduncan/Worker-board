// B934 (X93 on 2026-11-02): the board's stall log. A delay of its event loop over 2 s, and a work call answered after 2 s,
// is written with the requests and the board's own jobs that ran then (the real case: 16:40:15 Worker 5's save-log
// answered after 12.6 s at its hand-over, nothing named what the board did); a delay of 1.5 s is none; the file keeps
// the newest 50. The rule board-slow cites the newest stalls: boardDeaf.test.mjs.

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { loopRecord } from '../src/loops.mjs'
import { MOST_STALLS, STALL_MS, stallLog, watchLoop } from '../src/stalls.mjs'
import { stallOf, stallWords } from '../src/stallWords.mjs'

const at = (h, m, s = 0) => new Date(2026, 10, 2, h, m, s).getTime()

/** A clock the test moves by hand. */
function fakeClock(start) {
  let now = start
  return { now: () => now, move: ms => { now += ms } }
}

test('a stall of the loop over 2 s is logged with the request and the job that ran then; one of 1.5 s is not', async () => {
  const clock = fakeClock(at(16, 40, 0))
  const log = stallLog({ now: clock.now })
  // Worker 5's save-log at its hand-over, and the chat log the board writes beside it.
  const call = log.begin('request', 'work save-log by Worker 5')
  const job = log.begin('job', 'chat log of Worker 5 (copy)')
  const from = clock.now()
  clock.move(1500 + 500)
  assert.equal(log.tick(from, clock.now(), 500), null, 'a delay of 1.5 s is no stall')
  const again = clock.now()
  clock.move(12_600 + 500)
  call()
  job()
  const stall = log.tick(again, clock.now(), 500)
  assert.deepEqual(stall, { at: clock.now(), ms: 12_600, kind: 'loop', requests: ['work save-log by Worker 5'], jobs: ['chat log of Worker 5 (copy)'] })
  assert.deepEqual(log.recent(), [stall])
})

test('a stall names what ended during it and what still runs, but not what ended before it', () => {
  const clock = fakeClock(at(16, 48, 0))
  const log = stallLog({ now: clock.now })
  log.begin('job', 'the supervisor\'s sweep')()
  clock.move(5000)
  const from = clock.now()
  const rebuild = log.begin('job', 'state rebuild')
  const take = log.begin('request', 'POST /api/bridge/take')
  clock.move(3000)
  rebuild()
  clock.move(4000)
  const stall = log.tick(from, clock.now(), 500)
  assert.deepEqual([stall.requests, stall.jobs], [['POST /api/bridge/take'], ['state rebuild']])
  take()
})

test('a work call answered after 2 s is a stall of its own, with the jobs beside it; one in 2 s is not; its chat is named once known', () => {
  const clock = fakeClock(at(16, 49, 51))
  const log = stallLog({ now: clock.now })
  const end = log.begin('request', 'work take by session 82d5e5c6')
  end.as('work take by Worker 2')
  const other = log.begin('request', 'work next by Worker 3')
  const handover = log.begin('job', 'hand-over Worker 2 (turn-ended)')
  const begun = clock.now()
  clock.move(STALL_MS)
  assert.equal(log.slowCall('work take by Worker 2', begun, clock.now()), null)
  clock.move(8700)
  handover()
  end()
  const stall = log.slowCall('work take by Worker 2', begun, clock.now())
  assert.deepEqual(stall, { at: clock.now(), ms: 10_700, kind: 'call', call: 'work take by Worker 2', requests: ['work next by Worker 3'], jobs: ['hand-over Worker 2 (turn-ended)'] })
  other()
})

test('the file stays small: the newest 50 stalls, read again at the next start', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'stalls-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'data', 'stalls.json')
  const clock = fakeClock(at(17, 0))
  const log = stallLog({ now: clock.now, file })
  for (let n = 0; n < MOST_STALLS + 10; n += 1) {
    const from = clock.now()
    clock.move(3000 + n)
    log.tick(from, clock.now())
  }
  await log.saved()
  const kept = JSON.parse(await readFile(file, 'utf8')).stalls
  assert.equal(kept.length, MOST_STALLS)
  assert.equal(kept.at(-1).ms, 3000 + MOST_STALLS + 9)
  assert.equal(kept[0].ms, 3010)
  const again = stallLog({ now: clock.now, file })
  await again.load()
  assert.deepEqual(again.recent(), kept)
})

test('the loop\'s watch: a timer run 2.6 s late is a stall, one 1 s late is not', () => {
  const clock = fakeClock(at(16, 37, 20))
  const log = stallLog({ now: clock.now })
  let tick = null
  const stop = watchLoop(log, { every: 500, now: clock.now, setTimer: fn => { tick = fn; return 1 }, clearTimer: () => { tick = null } })
  clock.move(500)
  tick()
  clock.move(1500)
  tick()
  assert.deepEqual(log.recent(), [])
  const job = log.begin('job', 'measure')
  clock.move(3100)
  tick()
  job()
  assert.deepEqual(log.recent().map(one => [one.ms, one.jobs]), [[2600, ['measure']]])
  stop()
  assert.equal(tick, null)
})

test('the loops run through the log: a loop that ran during a stall is named', async () => {
  const clock = fakeClock(at(16, 40, 0))
  const log = stallLog({ now: clock.now })
  const loops = loopRecord({ now: clock.now, track: (name, fn) => log.track('job', name, fn) })
  const from = clock.now()
  await loops.run('sweep', async () => { clock.move(6000) })
  assert.deepEqual(log.tick(from, clock.now()).jobs, ['sweep'])
  assert.equal(loops.all()[0].lastOk, clock.now())
})

test('a stall that is not whole is not kept', () => {
  assert.equal(stallOf({ at: 1, ms: 2, kind: 'other' }), null)
  assert.equal(stallOf({ at: 1, kind: 'loop' }), null)
  assert.deepEqual(stallOf({ at: 1, ms: 2500, kind: 'loop', requests: ['a', 3, ''], jobs: 'b' }), { at: 1, ms: 2500, kind: 'loop', requests: ['a'], jobs: [] })
  assert.equal(stallWords({ at: at(9, 5, 7), ms: 2049, kind: 'loop', requests: [], jobs: [] }, ms => new Date(ms).toTimeString().slice(0, 8)), '09:05:07 2.0 s the loop blocked, nothing named')
})
