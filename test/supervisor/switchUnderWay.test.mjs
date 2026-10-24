// B576 (the fix of X26: the sweep filed Worker 5 running sonnet medium while its step B568 wanted sonnet low, but Worker
// 5 had taken B568 0 min earlier: the board asks the main chat to switch the effort after a take, so the switch had not
// run yet). The health summary says beside "wants" how the switch stands (effortRun: "switch asked HH:MM" or
// "switched") and marks a mismatch "!" only `switchMinutes` after the take with no switch read back; the watch rule
// effort-mismatch names one that lasts to the main chat, once per step. Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { SUPERVISOR_DEFAULTS } from '../../src/config.mjs'
import { healthSummary } from '../../src/supervisor/health.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const MIN = 60_000
// X26: now 21:47; Picker took B568 at 21:47 and runs sonnet medium; B568 wants sonnet low
const NOW = new Date(2026, 9, 24, 21, 47).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const step = (id, takenMinutesAgo, sections = {}) => item(
  { Id: id, Kind: 'step', Title: `Step ${id} of the orchard`, State: 'in progress', Since: stamp(ago(takenMinutesAgo)), Owner: 'Picker' },
  {
    History: [`- ${stamp(ago(takenMinutesAgo + 5))} Lead: queued for Picker`, `- ${stamp(ago(takenMinutesAgo))} Picker: queued → taken`, `- ${stamp(ago(takenMinutesAgo))} Picker: taken → in progress`],
    Model: ['sonnet · a small fix'], Effort: ['low · a small fix'], ...sections,
  },
)
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const run = (more = {}) => ({ level: 'low', model: 'sonnet', usual: 'medium', usualModel: 'sonnet', step: 'B568', why: 'a small fix', modelWhy: 'a small fix', isSet: false, asked: null, waitsFor: null, ...more })
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'working', isRunning: true, queue: [], compaction: null, task: null, model: 'claude-sonnet-5-5', effort: 'medium', ...more })

const view = (store, more = {}) => buildView({
  state: { chats: [lane('Lead', { isMain: true }), lane('Picker', { effortRun: run(more.run), ...more.lane })], chatPrefix: '', pause: more.pause ?? null, today: [], limits: more.limits ?? {} },
  items: store, settings: more.settings ?? {}, now: NOW,
})
const check = board => WATCH_RULES.find(one => one.id === 'effort-mismatch').check(board, { seen: new Map(), observed: [] })
const chatLine = board => healthSummary(board, NOW).split('\n').find(one => one.includes('Picker (worker)')) ?? ''

test('the settings: a switch counts as under way for 10 min after the take', () => {
  assert.equal(SUPERVISOR_DEFAULTS.switchMinutes, 10)
})

test('X26: taken 0 min ago, medium beside low: no "!", no finding', () => {
  const board = view(items(step('B568', 0)))
  assert.match(chatLine(board), /^- Picker \(worker\): working; runs sonnet · medium; its step B568 wants sonnet · low; on B568/)
  assert.deepEqual(check(board), [])
})

test('X26 after 11 min with no switch read back: "!" and one finding for the main chat', () => {
  const board = view(items(step('B568', 11)))
  assert.match(chatLine(board), /^- ! Picker \(worker\): .*runs sonnet · medium; its step B568 wants sonnet · low \(no switch asked, 11 min after the take\)/)
  const found = check(board)
  assert.deepEqual(found.map(one => [one.rule, one.subject, one.key]), [['effort-mismatch', 'Picker', 'effort-mismatch Picker B568']])
  assert.equal(found[0].text, 'Picker runs sonnet · medium 11 min after it took B568, which wants sonnet · low')
  assert.match(found[0].evidence, /took B568 at 21:36; no switch asked/)
})

test('the switch\'s state stands beside "wants": asked at its time, or switched', () => {
  const asked = view(items(step('B568', 3)), { run: { asked: { at: ago(2), state: 'delivered' } } })
  assert.match(chatLine(asked), /^- Picker .*its step B568 wants sonnet · low \(switch asked 21:45\); on B568/)
  // asked and still not read back after 10 min: it lasts
  const late = view(items(step('B568', 12)), { run: { asked: { at: ago(11), state: 'delivered' } } })
  assert.match(chatLine(late), /^- ! Picker .*wants sonnet · low \(switch asked 21:36, not read back, 12 min after the take\)/)
  assert.equal(check(late).length, 1)
  assert.match(check(late)[0].evidence, /switch asked 21:36 \(delivered\)/)
  // read back: switched, quiet however long ago the take was
  const switched = view(items(step('B568', 40)), { run: { isSet: true }, lane: { effort: 'low' } })
  assert.match(chatLine(switched), /^- Picker .*its step B568 wants sonnet · low \(switched\); on B568/)
  assert.deepEqual(check(switched), [])
})

test('a chat that runs what its step wants is no case, and its line marks nothing', () => {
  const board = view(items(step('B568', 40)), { lane: { effort: 'low' } })
  assert.deepEqual(check(board), [])
  assert.doesNotMatch(chatLine(board), /switch|^- !/)
})

test('a model that differs counts as a mismatch too, where the board sets models', () => {
  const opus = () => step('B570', 15, { Model: ['opus · design'] })
  const found = check(view(items(opus()), { run: { step: 'B570', model: 'opus', level: 'low' }, lane: { effort: 'low' } }))
  assert.equal(found.length, 1)
  assert.equal(found[0].text, 'Picker runs sonnet · low 15 min after it took B570, which wants opus · low')
  // settings that name no model ids: the board switches the effort alone, so another model is no case
  assert.deepEqual(check(view(items(opus()), { run: { step: 'B570', model: null, level: 'low' }, lane: { effort: 'low' } })), [])
})

test('the person\'s pause, or a full limit, holds the switch: quiet, and the time before the pause\'s end does not count', () => {
  assert.deepEqual(check(view(items(step('B568', 30)), { pause: { state: 'pausing', since: ago(20) } })), [])
  assert.deepEqual(check(view(items(step('B568', 30)), { limits: { fiveHour: { used: 100, level: 'full', at: ago(1) } } })), [])
  assert.deepEqual(check(view(items(step('B568', 30)), { pause: { state: 'running', since: ago(5) } })), [])
  assert.doesNotMatch(chatLine(view(items(step('B568', 30)), { pause: { state: 'running', since: ago(5) } })), /^- !/)
})

test('a chat whose effort the board does not know is no case', () => {
  assert.deepEqual(check(view(items(step('B568', 30)), { lane: { effort: null } })), [])
})
