// B1579 (X93, the rest after B1535): the marks of each state rebuild's parts on the loop (src/rebuildMarks.mjs), so a loop stall left
// over reads which part of the rebuild held the loop, or that none did and another job held it. The measure on a copy of the board on
// the live data (logs/b1579-parts-before.jsonl, before the thread read the sources itself): reading the sources kept the loop busy
// 6.3 to 7.9 s every second rebuild, the copy into the thread 62-166 ms, the state's copy back 33-66 ms.

import assert from 'node:assert/strict'
import test from 'node:test'

import { HOLD_MIN_MS, heldBy, rebuildMarks, withHolds } from '../src/rebuildMarks.mjs'
import { stallOf, stallWords } from '../src/stallWords.mjs'
import { workReader } from '../src/stateWorker.mjs'

test('a rebuild\'s parts: a block timed by its clock, an awaited part by the loop\'s busy time, the page\'s parts added to the newest', async () => {
  let wall = 1000
  let clock = 0
  let busy = 0
  const logged = []
  const marks = rebuildMarks({ now: () => wall, clock: () => clock, busy: was => (was === undefined ? { active: busy } : { active: busy - was.active }), logFile: 'parts.jsonl', append: async (file, line) => logged.push([file, line]) })
  const one = marks.begin()
  assert.equal(one.sync('copyIn', () => { clock += 180; return 'sent' }), 'sent')
  assert.equal(await one.part('sources', async () => { busy += 6300; return 'read' }), 'read')
  one.mark('copyBack', 120.4)
  wall = 9000
  one.end()
  one.end()
  marks.after('light', 40, 9100)
  assert.deepEqual(marks.recent(), [{ from: 1000, to: 9100, parts: { copyIn: 180, sources: 6300, copyBack: 120, light: 40 } }])
  // A part that throws is marked all the same.
  const two = marks.begin()
  assert.throws(() => two.sync('json', () => { clock += 300; throw new Error('no') }))
  two.end()
  assert.equal(marks.recent()[1].parts.json, 300)
  // The measure's log: one line per rebuild, one per page part.
  assert.deepEqual(logged.map(([file, line]) => [file, Object.keys(JSON.parse(line))]), [['parts.jsonl', ['from', 'to', 'parts']], ['parts.jsonl', ['at', 'light']], ['parts.jsonl', ['from', 'to', 'parts']]])
})

test('the part that held the loop in a stall: the largest of a rebuild that ran then, over 100 ms; else none (another job held it)', () => {
  const marks = [
    { from: 10_000, to: 18_000, parts: { app: 1, sources: 6300, copyIn: 180, copyBack: 120 } },
    { from: 40_000, to: 41_500, parts: { sources: 280, copyIn: 62, copyBack: 59 } },
  ]
  assert.deepEqual(heldBy({ at: 17_000, ms: 4300 }, marks), { part: 'sources', ms: 6300 })
  // A stall after every rebuild ended: none held it.
  assert.equal(heldBy({ at: 30_000, ms: 2500 }, marks), null)
  // Parts under HOLD_MIN_MS hold nothing.
  assert.equal(heldBy({ at: 41_000, ms: 2000 }, [{ from: 40_000, to: 41_500, parts: { copyIn: HOLD_MIN_MS - 1 } }]), null)
  // Only loop stalls are given a holder; the stall's own words name it.
  const [loop, call] = withHolds([{ at: 17_000, ms: 4300, kind: 'loop', requests: [], jobs: ['state rebuild', 'sync'] }, { at: 17_000, ms: 3000, kind: 'call', call: 'work next by Main', requests: [], jobs: [] }], marks)
  assert.deepEqual(loop.held, { part: 'sources', ms: 6300 })
  assert.equal('held' in call, false)
  assert.deepEqual(stallOf(loop).held, { part: 'sources', ms: 6300 })
  assert.match(stallWords(stallOf(loop), () => '11:40:31'), /^11:40:31 4\.3 s the loop blocked \(jobs: state rebuild, sync; held by the state rebuild's reading the sources 6\.3 s\)$/)
})

test('the thread\'s read of the store: kept between builds, read anew (its shared listing dropped too) once the loop\'s store read was reset', async () => {
  const made = []
  const forgot = []
  const keeperOf = dir => {
    let reads = 0
    const keeper = async () => ({ dir, read: ++reads })
    keeper.reset = () => made.push(`reset ${dir}`)
    made.push(`made ${dir}`)
    return keeper
  }
  const reader = workReader({ keeperOf, forget: dir => forgot.push(dir) })
  assert.equal(await reader({ workDir: null })(), undefined)
  await reader({ workDir: 'w', gen: 0 })()
  await reader({ workDir: 'w', gen: 0 })()
  assert.deepEqual([made, forgot], [['made w'], []])
  // A write in the loop (gen 1): the kept read and the shared listing go.
  await reader({ workDir: 'w', gen: 1 })()
  assert.deepEqual([made, forgot], [['made w', 'reset w'], ['w']])
  // Another folder: a keeper of its own.
  await reader({ workDir: 'v', gen: 1 })()
  assert.deepEqual(made.at(-1), 'made v')
})
