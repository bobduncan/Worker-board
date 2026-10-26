// B572 (the fix of X24: B522 sat in progress 2 h 36 min, its last checkpoint "report B522" at 19:07 never followed by a
// report, and neither the health summary nor a rule showed it). The health summary's Steps under way shows each step in
// progress with its last checkpoint (age, commit, next action), and marks it "!" when it is stale; the watch rule
// stale-checkpoint names a step in progress over `checkpointMinutes` with no checkpoint within them, or whose last
// checkpoint's next action is to report over `reportMinutes` ago. Made-up samples only; no word names a project.

import assert from 'node:assert/strict'
import test from 'node:test'

import { SUPERVISOR_DEFAULTS } from '../../src/config.mjs'
import { healthSummary } from '../../src/supervisor/health.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { stamp } from '../../src/work/migrate.mjs'

const MIN = 60_000
// X24: now 21:26; B522 in progress since 18:50, its checkpoint "report B522" at 19:07
const NOW = new Date(2026, 9, 24, 21, 26).getTime()
const at = (hours, minutes) => new Date(2026, 9, 24, hours, minutes).getTime()
const ago = minutes => NOW - minutes * MIN

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const step = (id, state, more = {}) => item({ Id: id, Kind: 'step', Title: `Step ${id} of the orchard`, State: state, Since: stamp(at(18, 50)), Owner: 'Picker', ...more })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const lane = (name, more = {}) => ({ name, isMain: false, isLeftover: false, state: 'working', isRunning: true, queue: [], compaction: null, task: null, ...more })
const checkpoint = (commit, next, ms) => `${commit} · ${next} · ${stamp(ms)}:00`

const view = (store, more = {}) => buildView({
  state: { chats: [lane('Lead', { isMain: true }), lane('Picker', more.lane ?? {})], chatPrefix: '', pause: more.pause ?? null, today: more.today ?? [], limits: more.limits ?? {} },
  items: store, settings: more.settings ?? {}, now: NOW,
})
const check = board => WATCH_RULES.find(one => one.id === 'stale-checkpoint').check(board, { seen: new Map(), observed: [] })
const lineOfStep = (text, id) => text.split('\n').find(one => one.startsWith(`- ${id} `) || one.startsWith(`- ! ${id} `)) ?? ''

const X24 = () => items(step('B522', 'in progress', { Checkpoint: checkpoint('36a6b6e', 'report B522', at(19, 7)) }))

test('the settings: a checkpoint is stale after 120 min, a "report" one after 30', () => {
  assert.equal(SUPERVISOR_DEFAULTS.checkpointMinutes, 120)
  assert.equal(SUPERVISOR_DEFAULTS.reportMinutes, 30)
})

test('X24: the summary shows B522\'s last checkpoint, its age, commit and next action, marked "!"', () => {
  const line = lineOfStep(healthSummary(view(X24()), NOW), 'B522')
  assert.match(line, /^- ! B522 in progress for 2 h 36 min, Picker/)
  assert.match(line, /last checkpoint 2 h 19 min ago \(36a6b6e\): report B522/)
})

test('X24: the rule names B522 to the main chat, once for that checkpoint', () => {
  const found = check(view(X24()))
  assert.deepEqual(found.map(one => [one.rule, one.subject]), [['stale-checkpoint', 'B522']])
  assert.equal(found[0].text, 'B522 in progress for 2 h 36 min (Picker); its last checkpoint, "report B522" at 19:07, was never followed by a report')
  assert.match(found[0].evidence, /checkpoint 36a6b6e · report B522 at 19:07/)
  // the same checkpoint keeps its key (one incident that counts up); a newer stale one is a new case
  const later = check(view(items(step('B522', 'in progress', { Checkpoint: checkpoint('36a6b6e', 'report B522', at(19, 7)) }))))
  assert.equal(later[0].key, found[0].key)
  const other = check(view(items(step('B522', 'in progress', { Checkpoint: checkpoint('77aa001', 'report B522', at(20, 30)) }))))
  assert.notEqual(other[0].key, found[0].key)
})

test('a checkpoint whose next action is to report is late after 30 min; one of 20 min, or one with work before the report, is quiet', () => {
  const report = (minutes, next = 'report B7') => check(view(items(step('B7', 'in progress', { Since: stamp(ago(60)), Checkpoint: checkpoint('abc1234', next, ago(minutes)) }))))
  assert.equal(report(31).length, 1)
  assert.equal(report(31, 'Work report B7 with the merge').length, 1)
  assert.deepEqual(report(20), [])
  assert.deepEqual(report(31, 'Merge, push, report B7'), [])
})

test('hours with no checkpoint: over 2 h in progress with none within 2 h trips, with none at all too', () => {
  const old = check(view(items(step('B8', 'in progress', { Since: stamp(ago(150)), Checkpoint: checkpoint('none', 'Write the tests', ago(130)) }))))
  assert.equal(old.length, 1)
  assert.equal(old[0].text, 'B8 in progress for 2 h 30 min (Picker) with no checkpoint for 2 h 10 min')
  const none = check(view(items(step('B8', 'in progress', { Since: stamp(ago(150)) }))))
  assert.equal(none[0].text, 'B8 in progress for 2 h 30 min (Picker) with no checkpoint')
  assert.match(lineOfStep(healthSummary(view(items(step('B8', 'in progress', { Since: stamp(ago(150)) }))), NOW), 'B8'), /^- ! B8 .*no checkpoint/)
})

test('a fresh checkpoint is quiet, in the rule and the summary', () => {
  const board = view(items(step('B9', 'in progress', { Since: stamp(ago(150)), Checkpoint: checkpoint('fed4321', 'Build the shelf', ago(40)) })))
  assert.deepEqual(check(board), [])
  const line = lineOfStep(healthSummary(board, NOW), 'B9')
  assert.match(line, /^- B9 in progress .*last checkpoint 40 min ago \(fed4321\): Build the shelf/)
  // a young step with no checkpoint yet is quiet too
  assert.deepEqual(check(view(items(step('B9', 'in progress', { Since: stamp(ago(90)) })))), [])
})

test('a step waiting on you is quiet, and so is any state but in progress', () => {
  for (const state of ['waiting on you', 'review', 'taken', 'queued']) {
    const board = view(items(step('B5', state, { Checkpoint: checkpoint('36a6b6e', 'report B5', at(19, 7)) })))
    assert.deepEqual(check(board), [], state)
    assert.doesNotMatch(lineOfStep(healthSummary(board, NOW), 'B5'), /checkpoint/, state)
  }
})

test('the person\'s pause stands the chats still: quiet meanwhile, and the time before its end does not count', () => {
  assert.deepEqual(check(view(X24(), { pause: { state: 'pausing', since: ago(200) } })), [])
  // resumed 20 min ago: the report checkpoint counts from then, under 30 min
  assert.deepEqual(check(view(X24(), { pause: { state: 'running', since: ago(20) } })), [])
})

test('a worker paused for the limit stands still on purpose: quiet, and so while a limit is full', () => {
  assert.deepEqual(check(view(X24(), { lane: { state: 'suspended', suspended: { by: 'note', limit: 'fiveHour', since: ago(120) } } })), [])
  assert.deepEqual(check(view(X24(), { limits: { fiveHour: { used: 100, level: 'full', at: ago(1) } } })), [])
})

test('the time its worker stood suspended for the limit does not count: back at work, it has time for its next checkpoint', () => {
  // a checkpoint 180 min ago, then suspended from 170 to 10 min ago: 20 min of work since
  const store = () => items(step('B6', 'in progress', { Since: stamp(ago(200)), Checkpoint: checkpoint('abc1234', 'Build the gate', ago(180)) }))
  const today = [{ chat: 'Picker', spans: [{ from: ago(200), to: ago(170), state: 'working' }, { from: ago(170), to: ago(10), state: 'suspended' }, { from: ago(10), to: NOW, state: 'working' }] }]
  assert.deepEqual(check(view(store(), { today })), [])
  assert.equal(check(view(store())).length, 1)
})

test('a checkpoint from before the step\'s stretch in progress (it waited on you since) counts as none: the stretch counts', () => {
  const back = since => check(view(items(step('B5', 'in progress', { Since: stamp(ago(since)), Checkpoint: checkpoint('abc1234', 'report B5', ago(200)) }))))
  assert.deepEqual(back(10), [])
  assert.equal(back(130)[0].text, 'B5 in progress for 2 h 10 min (Picker) with no checkpoint for 2 h 10 min')
})

test('a checkpoint of the old form, with no time, still shows in the summary', () => {
  const line = lineOfStep(healthSummary(view(items(step('B4', 'in progress', { Since: stamp(ago(30)), Checkpoint: 'Sort the crates' }))), NOW), 'B4')
  assert.match(line, /\[last checkpoint at a time not known \(none\): Sort the crates\]/)
})

test('X80: the hours the board did not run (a PC sleep) and the hours the chat was off do not count; a quiet stretch while it runs does', () => {
  // in progress 4 h 10 min ago, the PC slept from 4 h ago to 10 min ago: 10 min of running time since the take
  const store = () => items(step('B704', 'in progress', { Since: stamp(ago(250)) }))
  const slept = [{ chat: 'Picker', spans: [{ from: ago(250), to: ago(240), state: 'working' }, { from: ago(10), to: NOW, state: 'working' }] },
    { chat: 'Lead', spans: [{ from: ago(250), to: ago(240), state: 'working' }, { from: ago(10), to: NOW, state: 'working' }] }]
  assert.deepEqual(check(view(store(), { today: slept })), [])
  assert.equal(check(view(store())).length, 1)
  // quiet 2 h 10 min while its chat runs the whole time: late, as before
  const running = [{ chat: 'Picker', spans: [{ from: ago(250), to: NOW, state: 'working' }] }]
  assert.equal(check(view(store(), { today: running })).length, 1)
  // the chat off for 4 h of it (the board running): its own off time does not count either
  const off = [{ chat: 'Picker', spans: [{ from: ago(250), to: ago(240), state: 'working' }, { from: ago(240), to: ago(10), state: 'off' }, { from: ago(10), to: NOW, state: 'working' }] }]
  assert.deepEqual(check(view(store(), { today: off })), [])
})
