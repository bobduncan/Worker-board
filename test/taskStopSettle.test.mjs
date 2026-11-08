// B1071 (X2 came back a 4th time, 2026-11-08 22:41): the person's Stop of Worker 1 on B1070 at 22:28:30 was the first stop the
// board carried out by code. It reached the worker within a minute (its stop checkpoint at 22:28:47 gave the step back), and its
// turn ended (idle from 22:34:48), but the word to the main chat (outbox c3429a0b005cdb29) stayed waiting, expired on the 10 min
// keep at 22:38:30 and rule 8 named it. Two causes: only a hand's call settled such a word, and through a settle that touches
// taken words only; and the keep was a plain word's 10 min, shorter than the 15 the hands are given. Now every refresh settles it
// as done at the event that gives the step back, it is kept STOP_HANDS_MS and a plain word's keep, and rule 8 waits STOP_HANDS_MS
// for it and names it once per stop. The real word's ids and times; made-up other chats.

import assert from 'node:assert/strict'
import test from 'node:test'

import { STOP_HANDS_MS, isTaskStopWord, stopSettleWhy } from '../src/hands.mjs'
import { isLimitStopWord } from '../src/say.mjs'
import { keepMs, memoryStore } from '../src/store.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { WATCH_RULES, undeliveredWords } from '../src/supervisor/rules/watch.mjs'
import { sweepOutbox, whyClosed } from '../src/work/outboxSweep.mjs'

const MIN = 60_000
const AT = 1794173310680 // 2026-11-08 22:28:30, the stop word
const CHECKPOINT = AT + 17_000 // 22:28:47, Worker 1's stop checkpoint gave B1070 back
const IDLE = 1794173688680 // 22:34:48, Worker 1's turn ended
const keep = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }

const STOP = Object.freeze({
  id: 'c3429a0b005cdb29', at: AT, to: 'Main', ask: null, step: null, title: null, version: null, verdict: null, command: 'stop', about: 'Worker 1',
  text: 'stop task\nName: Worker 1\nTask: B1070 "B1070 Fix: Look against the reference:"\nWhy: stopped with the button',
  taskStep: 'B1070', taskText: 'B1070 Fix: Look against the reference:', laneState: 'working', state: 'waiting', byCode: true,
})
const worker = report => ({ name: 'Worker 1', isMain: false, isLeftover: false, isRunning: true, state: report.state, report })
const working = worker({ state: 'working', since: AT - 5 * MIN })
const ended = worker({ state: 'idle', since: IDLE })
const board = lane => ({ restart: { main: 'Main' }, pause: { state: 'running', since: AT - 60 * MIN }, chats: [{ name: 'Main', isMain: true, isRunning: true, state: 'working' }, lane] })
const item = (id, state, owner) => [id, { head: new Map([['Id', id], ['State', state], ['Owner', owner]]) }]
const holds = new Map([item('B1070', 'in progress', 'Worker 1')])
const givenBack = new Map([item('B1070', 'refined', '-')])
const ctx = (lane, items, now) => ({ all: [STOP], items, runs: new Map(), goals: [], now, keep, closing: new Map(), lanes: [lane], prefix: '' })

test('one name per meaning: the person\'s stop and remove by code are task stop words, the limits\' are limit stop words', () => {
  assert.equal(isTaskStopWord(STOP), true)
  assert.equal(isLimitStopWord(STOP.command), false)
  assert.equal(isLimitStopWord('week-stop'), true)
  assert.equal(isTaskStopWord({ ...STOP, command: 'week-stop' }), false)
})

test('the keep of a task stop is STOP_HANDS_MS and a plain word\'s keep: the main chat may still take it after the hands\' 15 min', () => {
  assert.equal(keepMs(STOP, keep), STOP_HANDS_MS + keep.messageMs)
  assert.ok(keepMs(STOP, keep) > STOP_HANDS_MS)
})

test('X2: the stop checkpoint at 22:28:47 gave B1070 back: the word is settled as done, though the worker still works', () => {
  assert.deepEqual(whyClosed(STOP, ctx(working, givenBack, CHECKPOINT + 5_000)), { state: 'delivered', why: 'carried out by code: Worker 1 no longer holds B1070 (refined)' })
  // Still holding it, its turn running: the word waits.
  assert.equal(whyClosed(STOP, ctx(working, holds, CHECKPOINT + 5_000)), null)
})

test('X2: the turn that ended at 22:34:48 settles it as done too, with or without the store', () => {
  assert.deepEqual(whyClosed(STOP, ctx(ended, holds, IDLE + 1_000)), { state: 'delivered', why: 'carried out by code: Worker 1\'s turn ended after it (22:34)' })
  assert.equal(whyClosed(STOP, ctx(ended, null, IDLE + 1_000)).state, 'delivered')
  // A turn that ended BEFORE the word is no sign it stopped: it waits.
  assert.equal(whyClosed(STOP, ctx(worker({ state: 'idle', since: AT - MIN }), holds, AT + MIN)), null)
})

test('never by a timer alone: a worker that holds its step and works on is not settled, also at 20 min; past its keep the word expires', () => {
  assert.equal(whyClosed(STOP, ctx(working, holds, AT + 20 * MIN)), null)
  assert.equal(whyClosed(STOP, ctx(working, holds, AT + STOP_HANDS_MS + keep.messageMs + 1)).state, 'expired')
})

test('a remove waits for a hand while its worker is on the board, also idle; it is settled once the worker left it', () => {
  const remove = { ...STOP, command: 'remove' }
  assert.equal(whyClosed(remove, ctx(ended, holds, IDLE + 1_000)), null)
  assert.equal(stopSettleWhy(remove, undefined), 'carried out by code: Worker 1 is not on the board')
  assert.equal(whyClosed(remove, ctx({ name: 'Main' }, holds, IDLE + 1_000)).state, 'delivered')
})

test('X2: the refresh after 22:34:48 closes the real word delivered, with its why and time, never expired', async () => {
  const store = memoryStore()
  store.outbox().push({ ...STOP })
  const closed = await sweepOutbox({ dir: null, outbox: store, state: board(ended), now: IDLE + 2_000, keep })
  assert.deepEqual(closed.map(one => [one.id, one.state]), [['c3429a0b005cdb29', 'delivered']])
  const [word] = store.outbox()
  assert.equal(word.state, 'delivered')
  assert.equal(word.deliveredAt, IDLE + 2_000)
  assert.match(word.why, /^carried out by code: Worker 1's turn ended after it/)
})

test('rule 8: the settled stop is never named; one not settled is named only after STOP_HANDS_MS, once per stop, with who holds it', () => {
  const rule = WATCH_RULES.find(one => one.id === 'undelivered')
  const findings = (lane, outbox, now) => rule.check(buildView({ state: board(lane), items: holds, outbox, keep, settings: {}, now }))
  // Settled: nothing at 22:41 (when X2 came back) nor later.
  assert.deepEqual(findings(ended, [{ ...STOP, state: 'delivered', deliveredAt: IDLE + 2_000 }], AT + 13 * MIN), [])
  // Still waiting before the next sweep closes it, but its worker stopped: settled already in the rule's eyes, never named.
  assert.deepEqual(findings(ended, [{ ...STOP }], AT + 16 * MIN), [])
  // The worker never stopped: 12 min is past the rule's 10 but within the hands' 15: nothing yet.
  assert.deepEqual(undeliveredWords(buildView({ state: board(working), items: holds, outbox: [{ ...STOP }], keep, settings: {}, now: AT + 12 * MIN })), [])
  // At 16 min one finding for this stop, keyed by its word, naming the main chat it waits for and the worker.
  const late = findings(working, [{ ...STOP }], AT + 16 * MIN)
  assert.equal(late.length, 1)
  assert.equal(late[0].key, 'undelivered stop Worker 1 c3429a0b005cdb29')
  assert.match(late[0].text, /^the person's stop of Worker 1 on B1070 \(22:28\) is not settled after 16 min$/)
  assert.match(late[0].evidence, /^the word c3429a0b005cdb29 waits for Main; Worker 1 is working since /)
  // A second stop of the same worker is a finding of its own, not the first one's again.
  const again = findings(working, [{ ...STOP }, { ...STOP, id: 'second', at: AT + MIN }], AT + 17 * MIN)
  assert.deepEqual(again.map(one => one.key), ['undelivered stop Worker 1 c3429a0b005cdb29', 'undelivered stop Worker 1 second'])
})
