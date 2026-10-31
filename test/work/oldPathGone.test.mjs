// T8.5, step 6 (spec 2026-10-31, "The order to land it" step 6; brief 2026-10-31-handover-step6): the old timer path is
// gone for every worker. The reconciler's pass gives nothing, takes nothing back by a clock, delivers no line to a worker
// and tells a worker nothing of a failed check; no line waits for a clear, a setting or a restart; the resume lists no
// given task; the rules not-cleared and not-taking are gone. The setting `handover` stays as the escape hatch: "timers"
// hands out nothing new and the page says so in one line. A task given that no hand-over carries on goes back on the
// list (`strandedGives`). An old config.json with takeWithinMinutes and heldGiveMinutes loads without a word. Made-up
// samples only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { ASK_MS, GRACE_MS, IDLE_HOLD_MS, configProblem, parseConfig } from '../../src/config.mjs'
import { effortPlan } from '../../src/work/effort.mjs'
import { DEFAULT_FLOW } from '../../src/work/flow.mjs'
import { strandedGives } from '../../src/work/handOut.mjs'
import { NET_MS } from '../../src/work/handover.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { rolloutPlan } from '../../src/work/modRollout.mjs'
import { pauseAnswer, pauseFacts } from '../../src/work/pause.mjs'
import { HANDOVER_OFF, reconcile } from '../../src/work/reconcile.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'

const NOW = new Date(2026, 9, 31, 12, 0).getTime()
const MIN = 60_000
const TIMES = { graceMs: GRACE_MS, askMs: ASK_MS, idleMs: IDLE_HOLD_MS }

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const step = (id, state, more = {}, history = []) => file({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Since: stamp(NOW - 30 * MIN), ...(state === 'refined' ? { Refined: 'ready' } : {}), ...more }, history.length === 0 ? {} : { History: history })
const mapOf = items => new Map(items.map(item => [item.head.get('Id'), item]))
const lane = (name, onSequence, more = {}) => ({
  name, state: 'free', isMain: false, isLeftover: false, isRunning: true, lastActivityAt: NOW - 30 * MIN, task: null, onSequence, mod: onSequence ? '0.27.2' : '0.26.10',
  report: { state: 'idle', since: NOW - 20 * MIN, background: false, at: NOW - 2000 }, ...more,
})
const run = (items, lanes, { sent = [], settings = {} } = {}) => reconcile({ store: { items: mapOf(items), flow: DEFAULT_FLOW, problems: [] }, flow: DEFAULT_FLOW, lanes, now: NOW, times: TIMES, prefix: '', sent, settings: { handOutBeyondFocus: true, ...settings } })
const given = (who, at) => [`- ${stamp(at)} server: refined → queued (given by the board to ${who})`]

test('the pass gives nothing, takes nothing back by a clock and delivers no line to any worker, on the sequence or not', () => {
  for (const on of [true, false]) {
    const free = run([step('B1', 'refined')], [lane('W', on)])
    assert.equal(free.gives, undefined, 'no gives of the old pass')
    assert.equal(free.takeBacks, undefined, 'no take-backs of the old pass')
    // A free worker counts as free: no worker is started for the ready task.
    assert.equal(free.start, null)
    // A step queued for it, its line out 25 minutes ago and never taken: no delivery, no take-back, no stuck mark.
    const queued = run([step('B2', 'queued', { Owner: 'W' }, given('W', NOW - 30 * MIN))], [lane('W', on)],
      { sent: [{ id: 'w1', at: NOW - 25 * MIN, to: 'W', command: 'work', about: 'B2', state: 'delivered', text: 'work: B2 is yours; run work next' }] })
    assert.deepEqual(queued.deliveries, [])
    assert.deepEqual(queued.flags.filter(flag => flag.kind === 'not taking' || flag.kind === 'report again'), [])
  }
})

test('the main chat is still woken for a step queued for it', () => {
  const main = { ...lane('Lead', false), isMain: true }
  assert.deepEqual(run([step('B3', 'queued', { Owner: 'Lead' })], [main]).deliveries.map(one => [one.id, one.chat]), [['B3', 'Lead']])
})

test('a failed check: the lane is flagged, and the pass tells no worker (its hand-over does, once)', () => {
  const failed = name => step('B6', 'review', { Owner: name }, [`- ${stamp(NOW - 50 * MIN)} ${name}: in progress → review`, `- ${stamp(NOW - 49 * MIN)} server: check failed: the tests did not pass`])
  for (const on of [true, false]) {
    const done = run([failed('W')], [lane('W', on)])
    assert.deepEqual(done.flags.filter(flag => flag.id === 'B6').map(flag => [flag.kind, flag.chat]), [['check failed', 'W']])
    assert.deepEqual(done.flags.filter(flag => typeof flag.say === 'string'), [])
  }
})

test('the escape hatch: a "timers" board hands out nothing new, starts no worker, and says so in one line on top (mutant: "timers" handing out)', () => {
  const lanes = [lane('W', false, { state: 'working', report: { state: 'busy', since: NOW - MIN, background: false, at: NOW - 2000 } })]
  const timers = run([step('B1', 'refined'), step('B2', 'in progress', { Owner: 'W' })], lanes, { settings: { handover: 'timers', maxWorkers: 3 } })
  assert.deepEqual(timers.flags.filter(flag => flag.chat === null && flag.kind === 'handover off').map(flag => flag.text), [HANDOVER_OFF])
  assert.equal(HANDOVER_OFF, 'the hand-over is off: set handover to sequence')
  assert.equal(timers.start, null)
  // The same board on the sequence asks for one more worker, and says nothing of the hand-over.
  const sequence = run([step('B1', 'refined'), step('B2', 'in progress', { Owner: 'W' })], lanes, { settings: { handover: 'sequence', maxWorkers: 3 } })
  assert.deepEqual(sequence.start, { spawn: 1 })
  assert.deepEqual(sequence.flags.filter(flag => flag.kind === 'handover off'), [])
})

test('a task given that no hand-over carries on goes back: at once for a worker not on the sequence, after the net for a chat gone from the list', () => {
  const items = mapOf([
    step('B10', 'queued', { Owner: 'Seq', Since: stamp(NOW - 30 * MIN) }, given('Seq', NOW - 30 * MIN)),
    step('B11', 'queued', { Owner: 'Old', Since: stamp(NOW - MIN) }, given('Old', NOW - MIN)),
    step('B12', 'queued', { Owner: 'Gone', Since: stamp(NOW - NET_MS - MIN) }, given('Gone', NOW - NET_MS - MIN)),
    step('B13', 'queued', { Owner: 'Away', Since: stamp(NOW - MIN) }, given('Away', NOW - MIN)),
    // Queued otherwise than by the board's give: left alone.
    step('B14', 'queued', { Owner: 'Old' }, [`- ${stamp(NOW - 5 * MIN)} person: queued for Old`]),
  ])
  const backs = strandedGives({ items, lanes: [lane('Seq', true), lane('Old', false)], now: NOW, waitMs: NET_MS })
  assert.deepEqual(backs.map(one => [one.id, one.chat, one.why]), [['B11', 'Old', 'Old is not on the hand-over'], ['B12', 'Gone', 'Gone is no worker of the list']])
  // A board that reads no worker takes nothing back; the reconciler names them, not while the hand-out holds.
  assert.deepEqual(strandedGives({ items, lanes: [], now: NOW, waitMs: NET_MS }), [])
  const pass = run([step('B11', 'queued', { Owner: 'Old', Since: stamp(NOW - MIN) }, given('Old', NOW - MIN))], [lane('Old', false)])
  assert.deepEqual(pass.stranded.map(one => one.id), ['B11'])
})

test('no line waits for a setting or a restart: the effort plan and the rollout hold nothing, and the rollout asks for no worker', () => {
  const items = mapOf([step('B20', 'queued', { Owner: 'W', Model: 'opus' }, given('W', NOW - MIN))])
  const plan = effortPlan({ items, lanes: [lane('W', false, { model: 'claude-sonnet-5-5', effort: 'medium' })], sent: [], now: NOW, main: 'Lead', models: { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' } })
  assert.deepEqual(Object.keys(plan).sort(), ['runs', 'words'])
  const roll = rolloutPlan({ mods: { installed: '0.27.2', chats: { W: '0.26.10', Lead: '0.26.10' } }, chats: [{ name: 'W', role: 'worker', state: 'free', isRunning: true }, { name: 'Lead', role: 'main', state: 'free', isRunning: true }], items, sent: [], now: NOW, main: 'Lead', partner: 'Partner' })
  assert.deepEqual(Object.keys(roll).sort(), ['runs', 'words'])
  assert.deepEqual(roll.words.map(one => one.chat), ['Lead'])
  assert.equal(roll.runs.get('W').status, 'by-hand')
})

test('the resume lists no task given and not taken, for any worker', () => {
  const items = mapOf([step('B30', 'queued', { Owner: 'W' }, given('W', NOW - 5 * MIN)), step('B31', 'in progress', { Owner: 'V' })])
  const lanes = [lane('W', false), lane('V', true)]
  const pause = { state: 'resuming', since: NOW - MIN, pausedSince: NOW - 10 * MIN }
  const answer = pauseAnswer({ pause, items, lanes: [...lanes, { name: 'Lead', isMain: true }], chat: 'Lead', role: 'main' })
  assert.deepEqual(answer.resumeList.map(one => one.step), ['B31'])
  assert.deepEqual(pauseFacts({ pause, items, lanes }).waiting.map(one => one.chat), ['V'])
})

test('the rules not-cleared and not-taking are gone (mutant: the rule list not updated)', () => {
  const ids = WATCH_RULES.map(rule => rule.id)
  assert.ok(!ids.includes('not-cleared'))
  assert.ok(!ids.includes('not-taking'))
  assert.ok(ids.includes('handover-held') && ids.includes('handover-unanswered'))
})

test('an old config.json with takeWithinMinutes and heldGiveMinutes loads without a word; the two are ignored; handover defaults to "sequence"', () => {
  const text = JSON.stringify({ takeWithinMinutes: 2, heldGiveMinutes: 20, followUpMinutes: 0 })
  assert.equal(configProblem(text), null)
  const config = parseConfig(text, {})
  assert.equal(Object.hasOwn(config, 'takeWithinMinutes'), false)
  assert.equal(Object.hasOwn(config, 'heldGiveMinutes'), false)
  assert.equal(config.handover, 'sequence')
  assert.equal(parseConfig(JSON.stringify({ handover: 'timers' }), {}).handover, 'timers')
  assert.equal(parseConfig(JSON.stringify({ handover: 'clocks' }), {}).handover, 'sequence')
})
