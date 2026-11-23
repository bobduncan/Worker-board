// F42, the real case (X213, 2026-11-23): the PC slept from 21 Nov 15:06 to 23 Nov 14:26 with the board's process alive and a state
// rebuild under way. The first callers after the wake got that answer: "now" after the wake, the off time of before it. The Supervisor
// filed B1304 as "in progress for 49 h 43 min with no checkpoint for 47 h 55 min", though it had worked some 40 minutes since.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { readAfterSleep } from '../src/afterSleep.mjs'
import { cached } from '../src/folders.mjs'
import { GAP_MS, gapsOf } from '../src/history.mjs'
import { checkpointLate } from '../src/supervisor/rules/watch.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'

const at = (day, hour, minute, second = 0) => new Date(2026, 10, day, hour, minute, second).getTime()
const LAST_LOOK = at(21, 15, 6, 17)
const BUILT = at(21, 15, 6, 40)
const WOKE = at(23, 14, 26, 31)
const LINES = [{ at: at(21, 14, 50), chat: 'Worker 5', state: 'working', task: 'B1304', step: 1 }, { at: LAST_LOOK, chat: 'Main', state: 'unknown', task: '', step: null }]
const B1304 = parseItem(`Id: B1304\nKind: step\nTitle: A fix\nState: in progress\nOwner: Worker 5\nSince: ${stamp(at(21, 12, 43))}\nCheckpoint: 778a8ada · gate 3 running · ${stamp(at(21, 14, 28))}\n`)
const viewOf = (gaps, now) => buildView({ state: { chats: [{ name: 'Worker 5', state: 'working' }], gaps }, items: new Map([['B1304', B1304]]), now })

test('the real case: an answer built before the sleep is read again, and B1304 is no incident', async () => {
  let clock = BUILT
  let wake
  const slept = new Promise(done => { wake = done })
  let reads = 0
  const read = cached(() => readAfterSleep(async built => {
    reads += 1
    const mine = reads
    const now = built(clock)
    const answer = { now, gaps: gapsOf(LINES, now, LAST_LOOK) }
    if (mine === 1) await slept
    return answer
  }, { now: () => clock }), 5_000, () => clock)
  const underWay = read()
  clock = WOKE + 20_000
  const afterWake = read()
  wake()
  const state = await afterWake
  assert.equal(reads, 2)
  assert.equal(state.now, clock)
  assert.deepEqual(state.gaps, [{ from: LAST_LOOK, to: clock }])
  assert.equal(await underWay, state, 'the caller from before the sleep gets the new answer too')
  const view = viewOf(state.gaps, clock)
  assert.equal(checkpointLate(view.items.get('B1304'), view), null)
  // The answer it replaces is what filed X213: 47 h without a checkpoint.
  const before = gapsOf(LINES, BUILT, LAST_LOOK)
  assert.deepEqual(before, [])
  const stale = viewOf(before, clock)
  const late = checkpointLate(stale.items.get('B1304'), stale)
  assert.equal(late.kind, 'old')
  assert.ok(late.quiet > 47 * 3_600_000)
})

test('a read without a jump is read once; a jump of the gap time is none, just past it is; never a third read', async () => {
  const run = async jump => {
    let clock = 1_000_000
    let reads = 0
    const answer = await readAfterSleep(async built => {
      reads += 1
      built(clock)
      clock += jump
      return reads
    }, { now: () => clock })
    return { answer, reads }
  }
  assert.deepEqual(await run(2_000), { answer: 1, reads: 1 })
  assert.deepEqual(await run(GAP_MS), { answer: 1, reads: 1 })
  assert.deepEqual(await run(GAP_MS + 1), { answer: 2, reads: 2 }, 'the second answer stands, though the clock jumped again')
})

test('a read that names no build time is read once', async () => {
  let reads = 0
  assert.equal(await readAfterSleep(async () => { reads += 1; return 'answer' }, { now: () => Number.MAX_SAFE_INTEGER }), 'answer')
  assert.equal(reads, 1)
})

test('the board reads its state through it, with the time the state counts from', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /const readState = cached\(\(\) => readAfterSleep\(built => trackJob\('state rebuild'/)
  assert.match(server, /noWorkSeen,\n\s+now: built\(clock\(\)\),/)
})
