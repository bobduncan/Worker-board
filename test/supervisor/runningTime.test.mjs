// B727 (X84, X56 again): after a PC sleep of 20 h the health lines and the limit watch count the board's running time
// (boardOffMs, the stale-checkpoint rule's own count), not the wall time. Made-up items; no word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildView } from '../../src/supervisor/view.mjs'
import { healthSummary } from '../../src/supervisor/health.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { checkpointLine } from '../../src/work/pause.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 27, 20, 25).getTime()
const ago = minutes => NOW - minutes * MIN
/** The PC slept from 20 h 50 min ago to 3 min ago; the history's gap line reaches back before any window. */
const SLEPT = [{ from: ago(20 * 60 + 50), to: ago(3) }]

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'working', isRunning: true, queue: [], compaction: null, task: null, model: 'claude-sonnet-5-5', effort: 'medium', ...more })
const view = (store, more = {}) => buildView({
  state: { chats: [lane('Lead', { isMain: true }), lane('Picker')], advisor: { name: 'Partner' }, chatPrefix: '', today: [], gaps: more.gaps ?? [], limits: more.limits ?? {}, pause: null, readyList: { ready: [], held: [] } },
  items: store, outbox: [], settings: {}, seen: null, now: NOW,
})
const run = (id, board) => WATCH_RULES.find(one => one.id === id).check(board, { seen: new Map(), observed: [] })

const stepTaken = (minutesAgo, sections = {}) => item(
  { Id: 'B726', Kind: 'step', Title: 'Step B726', State: 'in progress', Owner: 'Picker', Since: stamp(ago(minutesAgo)) },
  { History: [`- ${stamp(ago(minutesAgo))} Picker: taken → in progress`], ...sections },
)

test('health: a step taken 20 h 52 min ago across a sleep reads its running minutes and names the off time', () => {
  const text = healthSummary(view(items(stepTaken(20 * 60 + 52)), { gaps: SLEPT }), NOW)
  const line = text.split('\n').find(one => one.includes('B726 in progress')) ?? ''
  assert.match(line, /B726 in progress for 5 min \(PC off 20 h 47 min\), Picker \[no checkpoint\]/)
  assert.doesNotMatch(line, /20 h 52 min/)
  // without gap lines the wall time counts, as before
  const wall = healthSummary(view(items(stepTaken(20 * 60 + 52))), NOW).split('\n').find(one => one.includes('B726 in progress')) ?? ''
  assert.match(wall, /B726 in progress for 20 h 52 min, Picker/)
  assert.doesNotMatch(wall, /PC off/)
})

test('health: a checkpoint written before the sleep reads its running minutes ago', () => {
  const written = ago(20 * 60 + 51)
  const withCheckpoint = item(
    { Id: 'B726', Kind: 'step', Title: 'Step B726', State: 'in progress', Owner: 'Picker', Since: stamp(ago(20 * 60 + 52)), Checkpoint: checkpointLine({ commit: 'abc123', next: 'go on', now: written }) },
    { History: [`- ${stamp(ago(20 * 60 + 52))} Picker: taken -> in progress`] },
  )
  const line = healthSummary(view(items(withCheckpoint), { gaps: SLEPT }), NOW).split('\n').find(one => one.includes('B726 in progress')) ?? ''
  assert.match(line, /last checkpoint 4 min ago \(abc123\)/)
})

test('old-limit-reading: a reading 20 h old across a sleep opens nothing 3 min after the wake, and opens after 60 min of running time', () => {
  const limits = minutes => ({ fiveHour: { used: 85, level: 'warn', at: ago(minutes), resetsAt: null }, week: null })
  const works = (minutes, gaps) => view(items(), { limits: limits(minutes), gaps })
  assert.deepEqual(run('old-limit-reading', works(20 * 60 + 50, SLEPT)), [])
  assert.equal(run('old-limit-reading', works(20 * 60 + 50, [])).length, 1, 'wall time alone: a case')
  // the sleep ended 70 min ago and the reading is from before it: 70 min of running time, no fresh reading
  const late = [{ from: ago(20 * 60 + 50 + 70), to: ago(70) }]
  const board = view(items(), { limits: { fiveHour: { used: 85, level: 'warn', at: ago(20 * 60 + 50 + 70 + 5), resetsAt: null }, week: null }, gaps: late })
  assert.equal(run('old-limit-reading', board).length, 1)
})
