// F5, chat 1's review of e18a62c0 (.claude/plans/2026-11-14-f5-review.md): rule 8 and the words for Main's model (1-4, 8, 13), the
// next check that already passed (5), overlap holds in none-ready and review-held (6, 7), and nits 9-12, 14, 15. The refusal's words and
// the B1149 overlap are the live ones; the garden is made up.

import assert from 'node:assert/strict'
import test from 'node:test'

import { partnerEffort } from '../../src/partnerEffort.mjs'
import { leftOutWhy } from '../../src/stepStatus.mjs'
import { WATCH_RULES, holdMoves, isUndelivered } from '../../src/supervisor/rules/watch.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { probeOf } from '../../src/work/effort.mjs'
import { readyList } from '../../src/work/handOut.mjs'
import { refusedWords } from '../../src/work/handover.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { whyClosed } from '../../src/work/outboxSweep.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 14, 10, 0).getTime()
const SONNET = 'claude-sonnet-5-5'
const OPUS = 'claude-opus-5-5'
const KEEP = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN, pause: null }
const REFUSAL = 'PreToolUse:mcp__ccd_session_mgmt__set_session_model hook error: Not run: in auto mode Claude Desktop doesn\'t run this tool when a plugin\'s own code calls it. Have Claude make the call.'
const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)), problem: null })
const step = (id, state, more = {}, sections = {}) => item({ Id: id, Kind: 'step', Title: `Task ${id}`, State: state, Activity: 'Garden', Since: stamp(NOW - 60 * MIN), ...more }, { History: [`- ${stamp(NOW - 60 * MIN)} Partner: made`], ...sections })
const LEAD = { name: 'Lead', isMain: true, isLeftover: false, state: 'working', isRunning: true }
const viewOf = ({ chats = [LEAD], outbox = [], items = new Map(), now = NOW, held = [] }) => buildView({ state: { chats, today: [], limits: {}, pause: null, chatPrefix: '', restart: { main: 'Lead' }, readyList: { ready: [], held } }, items, outbox, settings: {}, now })

test('review 1, 2: a partner switch Main carried out is never "not delivered", at 11 min nor hours later', () => {
  const word = { id: 'p1', to: 'Lead', command: 'partner-effort', about: 'Partner', mode: 'high', forModel: true, state: 'delivered', at: NOW, takenAt: NOW + 5000, deliveredAt: NOW + 6000, text: 'partner effort' }
  assert.equal(isUndelivered(viewOf({ outbox: [word], now: NOW + 11 * MIN }), word), false)
  assert.equal(isUndelivered(viewOf({ outbox: [word], now: NOW + 5 * 60 * MIN }), word), false)
})

test('review 3, 8: a worker set word for Main\'s model counts only while its step is still the worker\'s, and not for ever', () => {
  const word = { id: 'w1', to: 'Lead', command: 'worker-effort', about: 'Digger', model: OPUS, effort: 'high', forModel: true, forStep: 'B1163', envelope: 'e1', state: 'delivered', at: NOW - 11 * MIN, takenAt: NOW - 11 * MIN, deliveredAt: NOW - 11 * MIN, text: 'set model and effort' }
  const digger = { name: 'Digger', isMain: false, isLeftover: false, state: 'working', isRunning: true, model: SONNET, effort: 'low' }
  const held = new Map([['B1163', step('B1163', 'in progress', { Owner: 'Digger' })]])
  assert.equal(isUndelivered(viewOf({ chats: [LEAD, digger], outbox: [word], items: held }), word), true, 'its step is at work, the worker still not at it: named')
  const done = new Map([['B1163', step('B1163', 'done', { Owner: 'Digger' })]])
  assert.equal(isUndelivered(viewOf({ chats: [LEAD, digger], outbox: [word], items: done }), word), false, 'its step is done')
  assert.equal(isUndelivered(viewOf({ chats: [LEAD], outbox: [word], items: new Map() }), word), false, 'Digger is gone')
  const old = { ...word, at: NOW - 3 * 60 * MIN }
  assert.equal(isUndelivered(viewOf({ chats: [LEAD, digger], outbox: [old], items: held }), old), false, 'past UNDELIVERED_LOOK_MS')
})

test('review 4, 13: a Main word still waiting is closed once its hand-over went on without it', () => {
  const word = { id: 'w2', to: 'Lead', command: 'worker-effort', about: 'Digger', model: OPUS, effort: 'high', forModel: true, envelope: 'm2', state: 'waiting', at: NOW - 6 * MIN }
  const gone = { id: 'm2', command: 'handover', to: 'Digger', step: 'B1163', state: 'dropped', at: NOW - 6 * MIN }
  assert.deepEqual(whyClosed(word, { all: [word, gone], items: new Map(), now: NOW, keep: KEEP, lanes: [] }), { state: 'dropped', why: 'its hand-over went on without it' })
  const released = { ...gone, state: 'waiting', waitsFor: null }
  assert.equal(whyClosed(word, { all: [word, released], items: new Map(), now: NOW, keep: KEEP, lanes: [] }).state, 'dropped', 'released: no longer waits for it')
  const waits = { ...gone, state: 'waiting', waitsFor: 'w2' }
  assert.notEqual(whyClosed(word, { all: [word, waits], items: new Map(), now: NOW, keep: KEEP, lanes: [{ name: 'Digger', model: SONNET, effort: 'low' }] })?.why, 'its hand-over went on without it')
})

test('review 5: a next check that already passed is never stated as a time', () => {
  assert.match(refusedWords({ model: SONNET, effort: 'medium' }, NOW - 60 * MIN, NOW), /\(the app no longer lets the board switch it; next check when a worker is free\)$/)
  assert.match(refusedWords({ model: SONNET, effort: 'medium' }, NOW + 60 * MIN, NOW), /next check 11:00\)$/)
})

test('review 6: a step held back by an overlap with a step at work is no cause for none-ready', () => {
  const items = new Map([['B1149', step('B1149', 'in progress', { Owner: 'Worker 3' })]])
  assert.equal(leftOutWhy({ id: 'B1150', kind: 'held', why: 'waits: same files as B1149, under way' }, { items, skip: new Map() }), 'its files\' step B1149 is at work')
})

test('review 7: review-held reads a fix held back by an overlap with a moving step as a wait', () => {
  const items = new Map([['B1149', step('B1149', 'in progress', { Owner: 'Worker 3' })]])
  const view = viewOf({ items })
  assert.equal(holdMoves(view, 'waits: same files as B1149, under way'), true)
  assert.equal(holdMoves(viewOf({ items: new Map([['B1149', step('B1149', 'refined')]]) }), 'waits: same files as B1149, under way'), false)
})

test('review 9: a failed partner word whose retry is still to come shows settling, not "flip the switch again"', () => {
  const first = { id: 'p1', command: 'partner-effort', about: 'Partner', mode: 'high', at: NOW - 30_000, state: 'failed', failedAt: NOW - 20_000, why: REFUSAL, tries: 1 }
  const effort = partnerEffort({ sent: [first], partner: 'Partner', entries: [{ type: 'assistant', isSidechain: false, model: OPUS, effort: 'xhigh', at: NOW - MIN }] })
  assert.deepEqual([effort.missed, effort.isSet, effort.mode], [null, false, 'high'])
})

test('review 10: a probe a hand gave back in doubt stays open until DOUBT_MS', () => {
  const probe = { id: 'pr', to: 'Lead', command: 'worker-effort', about: 'Mower', model: OPUS, effort: 'high', probe: true, state: 'waiting', at: NOW - 3 * MIN, doubtAt: NOW - MIN }
  assert.equal(whyClosed(probe, { all: [probe], items: new Map(), now: NOW, keep: KEEP, lanes: [] }), null)
  assert.equal(whyClosed(probe, { all: [probe], items: new Map(), now: NOW + 5 * MIN, keep: KEEP, lanes: [] }).state, 'dropped')
})

test('review 11, 12: overlap words say where the step stands; overlap-idle never gives each worker the board\'s span', () => {
  const items = new Map([
    ['B1149', step('B1149', 'waiting on you', { Owner: 'Worker 3' }, { Context: ['  Touches: public/units'] })],
    ['B1150', step('B1150', 'refined', { Refined: 'ready' }, { Context: ['  Touches: public/units/knight'] })],
  ])
  assert.equal(readyList(items, { now: NOW, beyondFocus: true }).held.find(one => one.id === 'B1150').why, 'waits: same files as B1149, which waits for you')
  const lanes = [LEAD, ...['Worker 1', 'Worker 2'].map(name => ({ name, isMain: false, isLeftover: false, state: 'free', isRunning: true, onSequence: true, handover: { state: 'free', why: null } }))]
  const held = [{ id: 'B1150', why: 'waits: same files as B1149, under way', overlap: 'B1149' }]
  const found = WATCH_RULES.find(one => one.id === 'overlap-idle').check(viewOf({ chats: lanes, held }), { seen: new Map([['overlap-idle board', NOW - 36 * MIN]]), observed: [] })
  assert.match(found[0].text, /^workers free behind Touches overlaps for 36 min \(Worker 1, Worker 2\)/)
  assert.doesNotMatch(found[0].text, /Worker 2 free for 36 min/)
})

test('review 15: the probe never picks a worker whose hand-over waits or that got a set word lately', () => {
  const refused = { id: 'r', command: 'worker-effort', about: 'X', at: NOW - 25 * 60 * MIN, state: 'failed', failedAt: NOW - 25 * 60 * MIN, why: REFUSAL }
  const lanes = [{ name: 'Digger', state: 'free', isRunning: true, model: SONNET, effort: 'low' }, { name: 'Mower', state: 'free', isRunning: true, model: OPUS, effort: 'high' }]
  const forDigger = { id: 'w', command: 'worker-effort', about: 'Digger', forModel: true, state: 'delivered', at: NOW - MIN }
  assert.equal(probeOf({ sent: [refused, forDigger], lanes, now: NOW, main: 'Lead' }).word.chat, 'Mower')
  const envelope = { id: 'e', command: 'handover', to: 'Mower', state: 'waiting', at: NOW - MIN }
  assert.equal(probeOf({ sent: [refused, forDigger, envelope], lanes, now: NOW, main: 'Lead' }).word, null)
})
