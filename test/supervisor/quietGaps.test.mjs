// B710 (the result check of B707: X80 came back on the live history). The time the board did not run (its gap lines in the
// history, all of them, however long ago they began) does not count in any watch rule that times a quiet stretch with the
// board's own clock: stale-checkpoint is in staleCheckpoint.test.mjs; here the other three that share the count
// (open-fix, effort-mismatch, and review-stuck / fix-dropped through reviewLateOf), and the rules left on wall time.
// Made-up items; no word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildView } from '../../src/supervisor/view.mjs'
import { WATCH_RULES, reviewLateOf } from '../../src/supervisor/rules/watch.mjs'
import { ANOTHER_WAY } from '../../src/work/resultCheck.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const MIN = 60_000
const NOW = new Date(2026, 9, 26, 21, 12).getTime()
const ago = minutes => NOW - minutes * MIN
/** The PC slept from 5 h 30 min ago to 10 min ago; the history's gap line reaches back before any window. */
const SLEPT = [{ from: ago(330), to: ago(10) }]

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'working', isRunning: true, queue: [], compaction: null, task: null, model: 'claude-sonnet-5-5', effort: 'medium', ...more })
const view = (store, more = {}) => buildView({
  state: { chats: more.chats ?? [lane('Lead', { isMain: true }), lane('Picker')], advisor: { name: 'Partner' }, chatPrefix: '', today: [], gaps: more.gaps ?? [], limits: {}, pause: null, readyList: { ready: [], held: [] } },
  items: store, outbox: more.outbox ?? [], settings: {}, seen: null, now: NOW,
})
const run = (id, board) => WATCH_RULES.find(one => one.id === id).check(board, { seen: new Map(), observed: [] })

test('open-fix: made 5 h ago across a 5 h sleep, 10 min of running time: no case; the same without the gap line is one', () => {
  const fix = item(
    { Id: 'B659', Kind: 'step', Title: 'Fix: the outline', State: 'new', Since: stamp(ago(300)), 'Fix of': 'B654', Refined: 'open' },
    { 'What we build': [`- ${ANOTHER_WAY} (tried: B618, B636, B654)`], History: [`- ${stamp(ago(300))} Checker: made by the result check of B654`] },
  )
  const reviewed = (id, fixId, head = {}) => item(
    { Id: id, Kind: 'step', Title: `Step ${id}`, State: 'review', Owner: 'Picker', Since: stamp(ago(320)), ...head },
    { 'What we build': ['- a lamp'], History: [`- ${stamp(ago(320))} server: check passed: merged`, `- ${stamp(ago(310))} Checker: result check failed: 2 of 4 points pass; fix ${fixId} for Picker`] },
  )
  const store = () => items(reviewed('B636', 'B654'), reviewed('B654', 'B659', { 'Fix of': 'B636' }), fix)
  assert.deepEqual(run('open-fix', view(store(), { gaps: SLEPT })), [])
  assert.equal(run('open-fix', view(store())).length, 1)
  // the same fix 70 min old with the chat running: late, as before
  const later = () => items(...[...store().values()].map(one => (one.head.get('Id') === 'B659' ? item({ ...Object.fromEntries(one.head), Since: stamp(ago(70)) }, Object.fromEntries(one.sections)) : one)))
  assert.equal(run('open-fix', view(later(), { gaps: [{ from: ago(400), to: ago(300) }] })).length, 1)
})

test('effort-mismatch: taken 5 h ago across a 5 h sleep, 10 min of running time: still under way; 11 min of running time: a case', () => {
  const step = takenMinutesAgo => item(
    { Id: 'B568', Kind: 'step', Title: 'Step B568', State: 'in progress', Since: stamp(ago(takenMinutesAgo)), Owner: 'Picker' },
    { History: [`- ${stamp(ago(takenMinutesAgo))} Picker: taken → in progress`], Model: ['sonnet · a small fix'], Effort: ['low · a small fix'] },
  )
  const chats = [lane('Lead', { isMain: true }), lane('Picker', { effortRun: { level: 'low', model: 'sonnet', usual: 'medium', usualModel: 'sonnet', step: 'B568', why: 'x', modelWhy: 'x', isSet: false, asked: null, waitsFor: null } })]
  assert.deepEqual(run('effort-mismatch', view(items(step(300)), { chats, gaps: [{ from: ago(295), to: ago(5) }] })), [])
  assert.equal(run('effort-mismatch', view(items(step(300)), { chats })).length, 1)
  assert.equal(run('effort-mismatch', view(items(step(300)), { chats, gaps: [{ from: ago(295), to: ago(25) }] })).length, 1)
})

test('review-stuck and fix-dropped (reviewLateOf): a check asked or a fix dropped before a sleep counts only its running time', () => {
  const board = view(items(), { gaps: SLEPT })
  const plain = view(items())
  const check = { kind: 'check', since: ago(300) }
  const dropped = { kind: 'dropped', since: ago(300) }
  const step = item({ Id: 'B9', Kind: 'step', State: 'review' })
  // reviewMinutes default is long past at 300 min of wall time, not at 10 min of running time
  assert.equal(reviewLateOf(board, step, check).ms <= 11 * MIN, true)
  assert.equal(reviewLateOf(board, step, dropped).late, false)
  assert.equal(reviewLateOf(plain, step, dropped).late, true)
  assert.equal(reviewLateOf(plain, step, check).ms >= 299 * MIN, true)
})

test('report-check-twice: two failed checks 5 h ago across a 5 h sleep, the worker back for 10 min: not yet; with the chat running the whole time: a case', () => {
  const fails = [`- ${stamp(ago(300))} server: check failed: the report names no change`, `- ${stamp(ago(299))} server: check failed: the report names no change`]
  const store = () => items(item({ Id: 'B7', Kind: 'step', Title: 'Step B7', State: 'in progress', Since: stamp(ago(310)), Owner: 'Picker' }, { History: fails }))
  assert.deepEqual(run('report-check-twice', view(store(), { gaps: [{ from: ago(295), to: ago(5) }] })), [])
  assert.equal(run('report-check-twice', view(store())).length, 1)
  assert.equal(run('report-check-twice', view(store(), { gaps: [{ from: ago(295), to: ago(75) }] })).length, 1)
})
