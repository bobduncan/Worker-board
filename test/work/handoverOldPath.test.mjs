// T8.5, step 2 (spec 2026-10-31, part 4, "Old and new must never run for the same worker"): a worker on the sequence
// (`onSequence`) gets nothing from the old pass: no delivery, no give, no take-back, no stuck mark, no word of a failed
// check or of "report again", no line held for its clear, no resume entry for a task given to it; a worker on the timers
// beside it, in the same facts, still gets all of it (mutant: both paths for one worker). Made-up samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { ASK_MS, GRACE_MS, IDLE_HOLD_MS } from '../../src/config.mjs'
import { clearHolds } from '../../src/clearOwed.mjs'
import { DEFAULT_FLOW } from '../../src/work/flow.mjs'
import { HELD_WHY } from '../../src/work/handOut.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { pauseAnswer, pauseFacts } from '../../src/work/pause.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'

const NOW = new Date(2026, 9, 31, 12, 0).getTime()
const MIN = 60_000
const TIMES = { graceMs: GRACE_MS, askMs: ASK_MS, idleMs: IDLE_HOLD_MS }

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const step = (id, state, more = {}, history = []) => file({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: stamp(NOW - 30 * MIN), ...(state === 'refined' ? { Refined: 'ready' } : {}), ...more }, history.length === 0 ? {} : { History: history })
const mapOf = items => new Map(items.map(item => [item.head.get('Id'), item]))
const lane = (name, onSequence, more = {}) => ({
  name, state: 'free', isMain: false, isLeftover: false, isRunning: true, lastActivityAt: NOW - 30 * MIN, task: null, onSequence, mod: onSequence ? '0.27.0' : '0.26.10',
  report: { state: 'idle', since: NOW - 20 * MIN, background: false, at: NOW - 2000 }, ...more,
})
const run = (items, lanes, sent = []) => reconcile({ store: { items: mapOf(items), flow: DEFAULT_FLOW, problems: [] }, flow: DEFAULT_FLOW, lanes, now: NOW, times: TIMES, prefix: '', sent, settings: { handOutBeyondFocus: true } })
const given = (who, at) => [`- ${stamp(at)} server: refined → queued (given by the board to ${who})`]

/** The same facts for a worker on the sequence (Seq) and one on the timers (Old). */
function both(build) {
  return [true, false].map(onSequence => build(onSequence ? 'Seq' : 'Old', onSequence))
}

test('the give of the old pass: a free worker on the timers gets the ready task, one on the sequence gets none', () => {
  const [seq, old] = both((name, on) => run([step('B1', 'refined')], [lane(name, on)]))
  assert.deepEqual(seq.gives, [])
  assert.deepEqual(old.gives.map(one => [one.id, one.chat]), [['B1', 'Old']])
  // A free worker on the sequence still counts as free: no worker is started for the ready task.
  assert.equal(seq.start, null)
})

test('the delivery of a step queued for it: none for a worker on the sequence', () => {
  const [seq, old] = both((name, on) => run([step('B2', 'queued', { Owner: name })], [lane(name, on)]))
  assert.deepEqual(seq.deliveries, [])
  assert.deepEqual(old.deliveries.map(one => one.id), ['B2'])
})

test('the take-back clocks (not taken within, its line held) and the stuck mark: none for a worker on the sequence', () => {
  const [seq, old] = both((name, on) => run([step('B3', 'queued', { Owner: name, Since: stamp(NOW - 30 * MIN) }, given(name, NOW - 30 * MIN))], [lane(name, on)],
    [{ id: 'w1', at: NOW - 25 * MIN, to: name, command: 'work', about: 'B3', state: 'delivered', text: 'work: B3 is yours; run work next' }]))
  assert.deepEqual(seq.takeBacks, [])
  assert.deepEqual(old.takeBacks.map(one => [one.id, one.chat]), [['B3', 'Old']])
  const [seqHeld, oldHeld] = both((name, on) => run([step('B4', 'queued', { Owner: name, Since: stamp(NOW - 30 * MIN) }, given(name, NOW - 30 * MIN))], [lane(name, on)]))
  assert.deepEqual(seqHeld.takeBacks, [])
  assert.match(oldHeld.takeBacks[0].why, new RegExp(HELD_WHY))
  const stuckLine = name => [`- ${stamp(NOW - 5 * MIN)} server: queued → refined (taken back from ${name}: not taken within 2 min; stuck)`]
  const [seqStuck, oldStuck] = both((name, on) => run([step('B5', 'refined', {}, stuckLine(name))], [lane(name, on, { report: { state: 'idle', since: NOW - 20 * MIN, background: false, at: NOW } })]))
  assert.deepEqual(seqStuck.flags.filter(flag => flag.kind === 'not taking'), [])
  assert.deepEqual(oldStuck.flags.filter(flag => flag.kind === 'not taking').map(flag => flag.chat), ['Old'])
})

test('the words of a failed check and of "report again": none from the old pass for a worker on the sequence (its decision tells it once)', () => {
  const failed = name => step('B6', 'review', { Owner: name }, [`- ${stamp(NOW - 50 * MIN)} ${name}: in progress → review`, `- ${stamp(NOW - 49 * MIN)} server: check failed: the tests did not pass`])
  const [seq, old] = both((name, on) => run([failed(name)], [lane(name, on)]))
  assert.deepEqual(seq.flags.filter(flag => typeof flag.say === 'string'), [])
  assert.ok(old.flags.some(flag => typeof flag.say === 'string' && flag.chat === 'Old'))
})

test('the clear\'s hold of a line, the resume list\'s given task and the old rules: none for a worker on the sequence', () => {
  const owed = { step: 'B7', reportedAt: NOW - 10 * MIN, clearedAt: null, why: null, canClear: true }
  // state.mjs hands clearHolds the lanes not on the sequence; the hold stands for the old one only.
  const lanes = [lane('Seq', true, { clearOwed: owed }), lane('Old', false, { clearOwed: owed })]
  assert.deepEqual([...clearHolds({ lanes: lanes.filter(one => one.onSequence !== true), deliveries: [{ id: 'B8', chat: 'Seq' }, { id: 'B9', chat: 'Old' }] })], ['B9'])
  // B764: a task given and not taken is on the resume list for the old one only.
  const items = mapOf([step('B10', 'queued', { Owner: 'Seq' }, given('Seq', NOW - 5 * MIN)), step('B11', 'queued', { Owner: 'Old' }, given('Old', NOW - 5 * MIN))])
  const pause = { state: 'resuming', since: NOW - MIN, pausedSince: NOW - 10 * MIN }
  const answer = pauseAnswer({ pause, items, lanes: [...lanes, { name: 'Lead', isMain: true }], chat: 'Lead', role: 'main' })
  assert.deepEqual(answer.resumeList.map(one => one.step), ['B11'])
  assert.deepEqual(pauseFacts({ pause, items, lanes }).waiting.map(one => one.chat), ['Old'])
  // The old rules not-cleared and not-taking read no worker on the sequence.
  const view = buildView({ state: { chats: lanes.map(one => ({ ...one, flags: [{ kind: 'not taking', id: 'B12', text: 'Stuck' }] })), today: [], limits: {}, pause: null, chatPrefix: '', readyList: null }, items: new Map(), outbox: [], repairs: [], mods: null, settings: { notClearedMinutes: 1 }, now: NOW })
  const check = id => WATCH_RULES.find(one => one.id === id).check(view, { seen: new Map(), observed: [] }).map(one => one.subject)
  assert.deepEqual(check('not-taking'), ['Old'])
  assert.deepEqual(check('not-cleared'), ['Old'])
})
