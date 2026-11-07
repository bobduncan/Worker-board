// Stop and rethink (docs/stop-and-rethink.md, section 6, chat 1's condition 2): `Waits for: the rethink of G<n> ...` is a hold the PERSON
// asked for, in every rule that reads holds. review-held does not count it (as the person's open ask); a step held for it is not on the
// ready list, so ready-while-free sees no task; a step in progress that was told to stop is no stale checkpoint. The case beside each:
// the same step held for another reason, which the rules still judge. Made-up items only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { SUPERVISOR_DEFAULTS } from '../../src/config.mjs'
import { healthSummary } from '../../src/supervisor/health.mjs'
import { WATCH_RULES, checkpointLate } from '../../src/supervisor/rules/watch.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { readyList } from '../../src/work/handOut.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { rethinkLine } from '../../src/work/rethink.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 7, 14, 0).getTime()
const ago = minutes => NOW - minutes * MIN
const LINE = rethinkLine('G60', 'Side stairs', '2026-11-07 12:00')
const HOLD = `waits for: ${LINE}`

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)) })
const items = (...all) => new Map(all.map(one => [one.head.get('Id'), one]))
const passed = minutes => `- ${stamp(ago(minutes))} server: check passed: merged`
const failed = (minutes, fix) => `- ${stamp(ago(minutes))} Checker: result check failed: 4 of 6 points pass; fix ${fix} for Painter`
const LEAD = { name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true }
const PAINTER = { name: 'Painter', isMain: false, isLeftover: false, state: 'working', isRunning: true, queue: [], compaction: null, task: null }

// B851 in review behind its fix B890, which the ready list holds with `why`.
const chain = (extra = {}) => items(
  item({ Id: 'B851', Kind: 'step', Title: 'Step B851', State: 'review', Owner: 'Painter', Since: stamp(ago(900)) }, { 'What we build': ['- a round pool'], History: [passed(900), failed(800, 'B890')] }),
  item({ Id: 'B890', Kind: 'step', Title: 'Fix: B851', State: 'refined', Refined: 'ready', 'Fix of': 'B851', Owner: 'Painter', Since: stamp(ago(700)), ...extra }),
)
const view = (store, why) => buildView({
  state: { chats: [LEAD, PAINTER], today: [], limits: {}, pause: null, chatPrefix: '', readyList: { ready: [], held: [{ id: 'B890', why }] }, recapWaits: [] },
  items: store, outbox: [], settings: {}, seen: null, now: NOW,
})
const reviewHeld = (board, key) => WATCH_RULES.find(one => one.id === 'review-held').check(board, { seen: new Map([[key, ago(300)]]), observed: [] })

test('review-held: a fix held for the rethink is the person\'s wait, however long; the same fix held for other words is judged', () => {
  const mine = `review-held B890 ${HOLD}`.slice(0, 80 + 'review-held B890 '.length)
  assert.deepEqual(reviewHeld(view(chain({ 'Waits for': LINE }), HOLD), mine), [])
  const other = 'waits for: the art from the person'
  const found = reviewHeld(view(chain({ 'Waits for': 'the art from the person' }), other), `review-held B890 ${other}`)
  assert.deepEqual(found.map(one => one.rule), ['review-held'])
  // Beside a wait for a step: the hold's why is still the rethink's words, so it is the person's too.
  assert.deepEqual(reviewHeld(view(chain({ 'Waits for': `B7; ${LINE}` }), HOLD), mine), [])
})

test('ready-while-free: a step held for the rethink is not on the ready list, so no worker is idle while "a ready task waits"', () => {
  const held = item({ Id: 'B890', Kind: 'step', Title: 'Fix', State: 'refined', Refined: 'ready', 'Waits for': LINE, Since: '2026-11-07 10:00' })
  const free = item({ Id: 'B891', Kind: 'step', Title: 'Other', State: 'refined', Refined: 'ready', Since: '2026-11-07 10:00' })
  const list = readyList(items(held, free), { now: NOW, focus: null, followUpMs: 0, standardHold: () => null, routingHeld: new Set(), prefix: '' })
  assert.deepEqual(list.ready.map(one => one.id), ['B891'])
  assert.deepEqual(list.held, [{ id: 'B890', why: HOLD }])
})

test('stale-checkpoint: a step in progress whose topic the person stopped is no case; the same step without the hold is', () => {
  const at = (hours, minutes) => new Date(2026, 10, 7, hours, minutes).getTime()
  const step = more => item({ Id: 'B522', Kind: 'step', Title: 'Step B522', State: 'in progress', Since: stamp(at(8, 50)), Owner: 'Painter', Checkpoint: `36a6b6e · report B522 · ${stamp(at(9, 7))}:00`, ...more })
  const board = store => buildView({ state: { chats: [LEAD, PAINTER], chatPrefix: '', pause: null, today: [], gaps: [], limits: {} }, items: store, settings: {}, now: NOW })
  const rule = store => WATCH_RULES.find(one => one.id === 'stale-checkpoint').check(board(store), { seen: new Map(), observed: [] })
  assert.equal(SUPERVISOR_DEFAULTS.checkpointMinutes, 120)
  assert.deepEqual(rule(items(step({}))).map(one => one.subject), ['B522'])
  assert.deepEqual(rule(items(step({ 'Waits for': LINE }))), [])
  assert.equal(checkpointLate(step({ 'Waits for': LINE }), board(items(step({ 'Waits for': LINE })))), null)
  // The health summary does not mark it odd either.
  const line = healthSummary(board(items(step({ 'Waits for': LINE }))), NOW).split('\n').find(one => /B522/.test(one) && /in progress/.test(one)) ?? ''
  assert.doesNotMatch(line, /^- ! B522/)
})
