// B1579 (X93, the rest after B1535): the marks of each state rebuild's parts on the loop (src/rebuildMarks.mjs), so a loop stall left
// over reads which part of the rebuild held the loop, or that none did and another job held it. The measure on a copy of the board on
// the live data (logs/b1579-parts-before.jsonl, before the thread read the sources itself): reading the sources kept the loop busy
// 6.3 to 7.9 s every second rebuild, the copy into the thread 62-166 ms, the state's copy back 33-66 ms; after it, the copy in
// 2-3 ms, and the git reads of the working folders 2.3-9.7 s every minute, which then moved into the thread too.

import assert from 'node:assert/strict'
import test from 'node:test'

import { HOLD_MIN_MS, heldBy, rebuildMarks, withHolds } from '../src/rebuildMarks.mjs'
import { stallOf, stallWords } from '../src/stallWords.mjs'
import { workReader } from '../src/stateWorker.mjs'

test('a rebuild\'s parts: a block timed by its clock and kept with its time, an awaited part by the loop\'s busy time (never a block)', async () => {
  let wall = 1000
  let clock = 0
  let busy = 0
  const logged = []
  const marks = rebuildMarks({ now: () => wall, clock: () => clock, busy: was => (was === undefined ? { active: busy } : { active: busy - was.active }), logFile: 'parts.jsonl', append: async (file, line) => logged.push([file, line]) })
  const one = marks.begin()
  wall = 1180
  assert.equal(one.sync('json', () => { clock += 180; return 'sent' }), 'sent')
  assert.equal(await one.part('sources', async () => { busy += 6300; return 'read' }), 'read')
  wall = 8000
  one.block('copyBack', 120.4)
  one.busy('build', 900)
  wall = 9000
  one.end()
  one.end()
  marks.after('light', 140, 9100)
  assert.deepEqual(marks.recent(), [{ from: 1000, to: 9000, parts: { json: 180, sources: 6300, copyBack: 120, build: 900 } }])
  // Only the blocks are kept as blocks, each with when it began.
  assert.deepEqual(marks.blocks(), [{ part: 'json', at: 1000, ms: 180 }, { part: 'copyBack', at: 7880, ms: 120 }, { part: 'light', at: 8960, ms: 140 }])
  // A part that throws is marked all the same.
  const two = marks.begin()
  assert.throws(() => two.sync('json', () => { clock += 300; throw new Error('no') }))
  two.end()
  assert.equal(marks.recent()[1].parts.json, 300)
  // The measure's log: one line per rebuild, one per page part.
  assert.deepEqual(logged.map(([file, line]) => [file, Object.keys(JSON.parse(line))]), [['parts.jsonl', ['from', 'to', 'parts']], ['parts.jsonl', ['at', 'light']], ['parts.jsonl', ['from', 'to', 'parts']]])
  // Blocks older than 10 minutes go.
  wall = 9000 + 11 * 60_000
  marks.after('json', 120)
  assert.deepEqual(marks.blocks().map(block => block.part), ['json'])
})

test('the block that held the loop in a stall: the longest of 100 ms or more that ran within it; else none (another job held it)', () => {
  const blocks = [{ part: 'copyIn', at: 12_000, ms: 150 }, { part: 'json', at: 16_000, ms: 4100 }, { part: 'copyBack', at: 41_000, ms: 99 }]
  // A stall of 4.3 s that ended at 20 s began after the timer's run at 15.2 s: the JSON's block of 4.1 s held it, not the copy in.
  assert.deepEqual(heldBy({ at: 20_000, ms: 4300 }, blocks), { part: 'json', ms: 4100 })
  // Review lens 2: a block that ran before the stall holds nothing, however close (the copy in of the same rebuild).
  assert.equal(heldBy({ at: 15_000, ms: 2000 }, blocks), null)
  // A stall after every block: none held it; a block under HOLD_MIN_MS holds nothing.
  assert.equal(heldBy({ at: 30_000, ms: 2500 }, blocks), null)
  assert.equal(heldBy({ at: 43_000, ms: 2000 }, blocks), null)
  assert.equal(HOLD_MIN_MS, 100)
  // Only loop stalls are given a holder; the stall's own words name it.
  const [loop, call] = withHolds([{ at: 20_000, ms: 4300, kind: 'loop', requests: [], jobs: ['state rebuild', 'sync'] }, { at: 20_000, ms: 3000, kind: 'call', call: 'work next by Main', requests: [], jobs: [] }], blocks)
  assert.deepEqual(loop.held, { part: 'json', ms: 4100 })
  assert.equal('held' in call, false)
  assert.deepEqual(stallOf(loop).held, { part: 'json', ms: 4100 })
  assert.match(stallWords(stallOf(loop), () => '11:40:31'), /^11:40:31 4\.3 s the loop blocked \(jobs: state rebuild, sync; held by the state rebuild's JSON 4\.1 s\)$/)
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

test('B1579: the git reads of the working folders and branches are made where the state is built, kept a minute, by the same readers', async () => {
  const { gitFacts } = await import('../src/stateBuild.mjs')
  const calls = []
  const run = async args => {
    calls.push(args.join(' '))
    if (args.includes('worktree')) return 'worktree C:/game\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/game-b7\nHEAD def\nbranch refs/heads/b7\n\n'
    if (args.includes('branch')) return '  b7\n* main\n'
    if (args.includes('rev-list')) return '2\n'
    if (args.includes('log')) return '1795632600 abc1234 A commit\n'
    return ''
  }
  const facts = { git: { gameRepo: 'C:/game', base: 'main', repos: ['C:/game', 'C:/board'], ms: 60_000 } }
  const first = await gitFacts(facts, run)
  assert.deepEqual(first.folders.map(folder => [folder.path, folder.branch, folder.ahead]), [['C:/game', 'main', 0], ['C:/game-b7', 'b7', 2]])
  assert.ok(Array.isArray(first.branches) || first.branches === null)
  const made = calls.length
  // Kept a minute: a second build reads no git.
  assert.deepEqual(await gitFacts(facts, run), first)
  assert.equal(calls.length, made)
  // A board without a game reads no folders; facts without `git` (the tests', an older loop's) are taken as they are.
  assert.equal((await gitFacts({ git: { gameRepo: null, base: 'main', repos: ['C:/board2'], ms: 60_000 } }, run)).folders, null)
  assert.deepEqual(await gitFacts({ folders: [{ path: 'x' }], branches: ['main'] }, run), { folders: [{ path: 'x' }], branches: ['main'] })
})
