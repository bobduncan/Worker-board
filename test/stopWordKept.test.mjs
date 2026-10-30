// B812 (X109): at 22:06 on 2026-10-30 the week reached 98% and the board queued the week's stop word for Worker 4 three
// times within 4 ms (three looks of the board ran side by side, each read the outbox before the others wrote); none was
// typed, and all three expired on the 10 min keep at 22:45 while Worker 4 still held B494. Now the stop words are checked
// and put in the outbox in one go, a stop word waits for its worker while it holds a step, and the sweep closes it with its
// reason once the worker holds none or the limit reset. Made-up chats; the times and ids of X109.

import assert from 'node:assert/strict'
import test from 'node:test'

import { sayStopWords } from '../src/say.mjs'
import { memoryStore } from '../src/store.mjs'
import { buildView } from '../src/supervisor/view.mjs'
import { undeliveredWords } from '../src/supervisor/rules/watch.mjs'
import { whyClosed } from '../src/work/outboxSweep.mjs'

const MIN = 60_000
const SAID = 1793394412408 // 2026-10-30 22:06, the first of X109's three words
const SWEPT = 1793396737535 // 22:45, when the sweep expired them
const RESETS = 1793455200000 // the week's reset the words named
const keep = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }

const lane = (name, steps) => ({ name, isMain: false, isLeftover: false, state: 'working', isRunning: true, storeSteps: steps })
/** The board at 22:06: the week at 98 with its reset known; Worker 4 works on B494 (in progress), Worker 3 on B1. */
const board = (more = {}) => ({
  restart: { main: 'Main' }, pause: { state: 'running', since: SAID - 60 * MIN },
  limits: { week: { level: 'full', used: 98, stopAt: 98, resetsAt: RESETS }, fiveHour: { level: 'ok', used: 40, stopAt: 95, resetsAt: null } },
  chats: [{ name: 'Main', isMain: true, state: 'working' }, lane('Worker 3', [{ id: 'B1', state: 'in progress' }]), lane('Worker 4', [{ id: 'B494', state: 'in progress' }])],
  ...more,
})
const item = (id, state, owner) => [id, { head: new Map([['Id', id], ['State', state], ['Owner', owner]]) }]

let next = 0
const newId = () => `w${(next += 1)}`

test('X109: three looks side by side at 22:06 say the stop word once to each worker', async () => {
  const store = memoryStore()
  const sent = () => store.outbox()
  // Three looks of the board run at once (their timers fired together): each checks and says before any write is done.
  await Promise.all([SAID, SAID + 3, SAID + 75].map(at => sayStopWords(board(), store, sent, at, newId)))
  assert.deepEqual(store.outbox().map(one => one.to), ['Worker 3', 'Worker 4'])
  assert.ok(store.outbox().every(one => one.command === 'week-stop' && one.weekResets === RESETS))
  // A later look says nothing again, whatever became of the words.
  assert.deepEqual(await sayStopWords(board(), store, sent, SAID + MIN, newId), [])
})

test('X109: the stop word to Worker 4, busy with B494 for 39 min, still waits at 22:45 and is typed at its next take, with its age', async () => {
  const store = memoryStore()
  await sayStopWords(board(), store, () => store.outbox(), SAID, newId)
  const items = new Map([item('B494', 'in progress', 'Worker 4'), item('B1', 'in progress', 'Worker 3')])
  const word = store.outbox().find(one => one.to === 'Worker 4')
  assert.equal(whyClosed(word, { all: store.outbox(), items, runs: new Map(), goals: [], now: SWEPT, keep, closing: new Map() }), null)
  const [taken] = await store.take('Worker 4', SWEPT, keep)
  assert.equal(taken.id, word.id)
  assert.equal(taken.lateMs, SWEPT - SAID)
})

test('a stop word is closed with its reason once its worker holds no step not yet reported, or its limit reset; one handed back still waits', async () => {
  const store = memoryStore()
  await sayStopWords(board(), store, () => store.outbox(), SAID, newId)
  // Worker 4 reported B494 (review); Worker 3 still works on B1.
  const items = new Map([item('B494', 'review', 'Worker 4'), item('B1', 'in progress', 'Worker 3')])
  const ctx = more => ({ all: store.outbox(), items, runs: new Map(), goals: [], now: SWEPT, keep, closing: new Map(), ...more })
  const [w3, w4] = store.outbox()
  assert.deepEqual(whyClosed(w4, ctx()), { state: 'dropped', why: 'Worker 4 holds no step not yet reported, so there is no work to stop' })
  assert.equal(whyClosed(w3, ctx()), null)
  // Its report failed the board's check: handed back, it holds B494 again.
  assert.equal(whyClosed(w4, ctx({ handedBack: ['Worker 4'] })), null)
  // After the week's reset neither matters.
  assert.equal(whyClosed(w3, ctx({ now: RESETS })).state, 'dropped')
  assert.match(whyClosed(w3, ctx({ now: RESETS })).why, /^the weekly limit reset at /)
  // Without a store the board cannot tell what the worker holds: the word waits, also hours later.
  assert.equal(whyClosed(w4, ctx({ items: null, now: SAID + 5 * 60 * MIN })), null)
})

test('rule undelivered: a stop word to a worker that holds no step is not named; one to a worker busy with its step past the limit is', async () => {
  const store = memoryStore()
  await sayStopWords(board(), store, () => store.outbox(), SAID, newId)
  const items = new Map([item('B494', 'review', 'Worker 4'), item('B1', 'in progress', 'Worker 3')])
  const view = buildView({ state: board(), items, outbox: store.outbox(), keep, settings: {}, now: SWEPT })
  const named = undeliveredWords(view).map(one => one.to)
  assert.ok(!named.includes('Worker 4'), 'Worker 4 holds no step: its word is closed, not named')
  assert.deepEqual(named, ['Worker 3'], 'Worker 3 still works on B1: its word waits, and 39 min is past the limit of the rule')
})
