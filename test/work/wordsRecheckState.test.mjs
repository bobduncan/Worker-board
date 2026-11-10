// Rule 15, review round 2 (2026-11-10), points 3 and 4: an ask held for the person's words asks nobody, so no step state counts it: not the
// step's rest (a resting worker's step moves to "waiting on you" only for a plain open ask), not the rest guard and its way back, not the
// lane's "waiting"; and it stands on Needs your attention as one quiet line (kind `held`), goal-level asks too. Made-up chats and items.

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseConfig } from '../../src/config.mjs'
import { DEFAULT_FLOW, mayMove } from '../../src/work/flow.mjs'
import { HANDOVER_MOD, STATES, decide } from '../../src/work/handover.mjs'
import { checkpointLine } from '../../src/work/pause.mjs'
import { statusOf } from '../../src/chatStatus.mjs'
import { parseItem } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { openAskIds } from '../../src/work/parked.mjs'
import { reconcile } from '../../src/work/reconcile.mjs'
import { storeFromText } from '../../src/work/read.mjs'
import { buildState } from '../withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 9, 17, 0).getTime()
const ago = minutes => NOW - minutes * MIN
const TIMES = { graceMs: 10 * MIN, askMs: 60 * MIN, idleMs: 5 * MIN }
const PREFIX = 'Garden · '
const PROJECT = 'C:\\garden'
const config = { ...parseConfig('{}', {}), project: PROJECT }
const NAMES = ['Lead', 'Worker 4', 'Advisor']

const file = (head, sections = {}) => parseItem(`${Object.entries(head).map(([key, value]) => `${key}: ${value}`).join('\n')}\n${Object.entries(sections).map(([name, lines]) => `\n## ${name}\n${lines.join('\n')}\n`).join('')}`)
const step = (id, state, more = {}) => file({ Id: id, Kind: 'step', Title: `Step ${id}`, State: state, Owner: 'Worker 4', Activity: 'Garden', Goal: 'G15', Since: stamp(ago(90)), ...more })
const HELD_LINE = 'held from person: your words at 16:20 may change this (chat 2)'
/** An open ask of Worker 4's; `held` writes what the person's words wrote (Route asker, the hold line and its History line). */
const ask = (id, of, { held = false, blocking = 'no', owner = 'Worker 4' } = {}) => file(
  { Id: id, Kind: 'ask', Title: `Ask ${id}`, State: 'open', Owner: owner, Since: stamp(ago(80)), Filed: String(ago(80)), Asks: 'decide', Blocking: blocking, Of: of, Route: held ? 'asker' : 'person' },
  held ? { Text: [`Ask ${id}`], Route: [HELD_LINE], History: [`- ${stamp(ago(80))} ${owner}: asked (decide)`, `- ${stamp(ago(30))} ${owner}: held: the person's words at 16:20 on G15 may change this`] } : { Text: [`Ask ${id}`] })
const store = items => ({ items: new Map(items.map(item => [item.head.get('Id'), item])), flow: DEFAULT_FLOW, problems: [] })
const lane = (name, more = {}) => ({ name, state: 'working', isMain: false, isLeftover: false, isRunning: true, lastActivityAt: ago(20), task: null, resting: { since: ago(20), at: ago(20), words: '' }, ...more })
const run = items => reconcile({ store: { ...store(items), pause: null }, flow: DEFAULT_FLOW, lanes: [lane('Worker 4')], now: NOW, times: TIMES, prefix: PREFIX })

test('review 4: a step whose only open ask is held reads as holding nothing: no rest move, no open ask ids, and the rest guard and its way back follow', () => {
  const plain = [step('B47', 'in progress'), ask('Q38', 'B47')]
  const held = [step('B47', 'in progress'), ask('Q38', 'B47', { held: true })]
  // The control: a plain open ask moves the resting worker's step to waiting on you; the held one does not.
  assert.deepEqual(run(plain).moves.map(move => [move.id, move.to]), [['B47', 'waiting on you']])
  assert.deepEqual(run(held).moves, [])
  assert.deepEqual([openAskIds(store(plain).items, 'B47'), openAskIds(store(held).items, 'B47')], [['Q38'], []])
  // The step moved to waiting on you before the hold goes back to in progress at once (its asks are answered); a blocking held ask is no blocker.
  const waiting = [step('B47', 'waiting on you'), ask('Q38', 'B47', { held: true, blocking: 'yes' })]
  const ctx = items => ({ store: store(items), freeChats: new Set(), now: NOW, overlaps: () => null, hasPartner: true, prefix: PREFIX })
  const back = items => mayMove(DEFAULT_FLOW, items[0], 'in progress', 'server', ctx(items))
  assert.equal(back(waiting).ok, false, 'round 3: the step stays waiting on you while its blocking ask is held (its chat re-checks the ask)')
  assert.equal(back([step('B47', 'waiting on you'), ask('Q38', 'B47', { blocking: 'yes' })]).ok, false, 'a plain blocking ask keeps it waiting')
  assert.equal(back([step('B47', 'waiting on you'), ask('Q38', 'B47', { held: true })]).ok, true, 'a held ask that blocks nothing goes')
  // The reconcile leaves it where it is: no move back to in progress (the resting worker would read interrupted, orange).
  assert.deepEqual(run(waiting).moves, [])
  assert.deepEqual(run([step('B47', 'waiting on you'), ask('Q38', 'B47', { held: true })]).moves.map(move => [move.id, move.to]), [['B47', 'in progress']])
})

/** The board at NOW: Worker 4 idle on B1081, waiting on you, with the asks given. */
function build(items) {
  const work = storeFromText('## Garden\n', { now: ago(300) })
  for (const item of items) {
    work.items.set(item.head.get('Id'), item)
    if (item.head.get('Kind') === 'step') work.activities[0].steps.push(item.head.get('Id'))
  }
  const app = name => JSON.stringify({ title: `${PREFIX}${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: ago(40), lastAssistantUuid: 'u-1' })
  const tail = { text: '', isCut: false, modifiedAt: ago(40) }
  const report = (name, since) => [name, { state: 'idle', since, background: false, run: 1, seq: 1, at: NOW - 5_000, session: `cli-${name}`, mod: '0.31.0', busyAt: null }]
  const raw = {
    listText: JSON.stringify({ prefix: PREFIX, main: 'Lead' }), appChatTexts: NAMES.map(app), tails: Object.fromEntries(NAMES.map(name => [`cli-${name}`, tail])), planLineTexts: {},
    work, adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: ago(300),
  }
  return buildState(raw, { lines: [], outbox: [], runs: [], now: NOW, config, seen: { shown: {}, other: {} }, board: { startedAt: ago(300), offSince: null }, reports: new Map([report('Lead', ago(60)), report('Worker 4', ago(40)), report('Advisor', ago(60))]) })
}
const laneOf = (state, name) => state.chats.find(one => one.name === name)

test('review 3 and 4: the lane does not wait and the step reads as holding nothing while its blocking ask is held; the held asks, goal-level too, are one quiet line each', () => {
  const plain = build([step('B1081', 'waiting on you'), ask('Q50', 'B1081', { blocking: 'yes' })])
  assert.equal(laneOf(plain, 'Worker 4').state, 'waiting', 'the control: a plain blocking ask makes the lane wait')
  assert.deepEqual(plain.forYou.filter(need => need.kind === 'held'), [])
  const held = build([step('B1081', 'waiting on you'), ask('Q50', 'B1081', { held: true, blocking: 'yes' }), ask('Q51', 'G15', { held: true, owner: 'Advisor' })])
  assert.notEqual(laneOf(held, 'Worker 4').state, 'waiting')
  const lines = held.forYou.filter(need => need.kind === 'held')
  assert.deepEqual(lines.map(need => [need.ask, need.title, need.tone, need.canAnswer, need.workId]), [
    ['Q50', 'Q50 held: Worker 4 re-checks it after your words at 16:20', 'quiet', false, undefined],
    ['Q51', 'Q51 held: Advisor re-checks it after your words at 16:20', 'quiet', false, undefined],
  ])
  assert.deepEqual(held.forYou.filter(need => need.workId !== undefined).map(need => need.workId), [], 'no card of the held asks')
})

const T0 = ago(60)
const checkpointed = more => file({ Id: 'B12', Kind: 'step', Title: 'Hang the gate', State: 'in progress', Owner: 'Worker 1', Since: stamp(T0 - 30 * MIN), Branch: 'b12-gate', Checkpoint: checkpointLine({ commit: 'abc1234', next: 'write the tests', now: T0 - 10 * MIN }), ...more }, { History: [`- ${stamp(T0 - 30 * MIN)} Worker 1: taken → in progress`] })
const stopped = now => ({ name: 'Worker 1', isMain: false, isLeftover: false, isRunning: true, state: 'interrupted', mod: HANDOVER_MOD, onSequence: true, report: { state: 'idle', since: T0, background: false, at: now } })

test('round 3, point 3a: the holder timers wait while a step has a held ask, blocking or not: no go-on at 5 minutes, no give-back at 20', () => {
  const decideAt = (minutes, asks) => decide({ worker: stopped(T0 + minutes * MIN), items: new Map([checkpointed(), ...asks].map(one => [one.head.get('Id'), one])), envelopes: [], now: T0 + minutes * MIN })
  const plain = decideAt(5, [ask('Q38', 'B12')])
  assert.notEqual(plain.envelope, null, 'the control: a plain non-blocking ask pauses nothing')
  for (const minutes of [5, 20, 40]) {
    const held = decideAt(minutes, [ask('Q38', 'B12', { held: true, owner: 'Worker 1' })])
    assert.deepEqual([held.envelope, held.giveBack, held.goOn], [null, null, null], `minute ${minutes}`)
    assert.equal(held.state, STATES.WORKING)
  }
})

test('round 3, point 3c: the lane of a worker whose step has a held ask reads quietly "waits for its re-check of Q50", never Stopped', () => {
  const held = build([step('B1081', 'in progress'), ask('Q50', 'B1081', { held: true })])
  const lane = laneOf(held, 'Worker 4')
  assert.equal(lane.status, 'Paused')
  assert.equal(lane.why, 'waits for its re-check of Q50')
  const plain = build([step('B1081', 'in progress'), ask('Q50', 'B1081')])
  assert.equal(laneOf(plain, 'Worker 4').status, 'Stopped', 'the control: without the hold the stopped worker reads Stopped')
  // The pure reading: only an interrupted lane with a held ask; a working one is working.
  const base = { state: 'interrupted', isRunning: true, report: { state: 'idle', since: NOW - MIN, at: NOW } }
  assert.deepEqual([statusOf({ lane: { ...base, heldAsk: 'Q50' }, now: NOW }).status, statusOf({ lane: { ...base, state: 'working', heldAsk: 'Q50' }, now: NOW }).status], ['Paused', 'Working'])
})
