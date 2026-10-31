// B880 (the fix of X2, back after B813 with count 41): the board's word of 2026-10-31 12:22 that has a hand start the Product
// owner (outbox 20e17b272740a56f) was taken 7 s later by Worker 2's mod. Its call ran the routine (the Product owner's chat
// began at 12:23:12) but never answered; the hand held the word for half an hour, until the process lost its session at 12:52
// and the call failed ("$.tool.call is not available in this mode"). Meanwhile the Product owner was on the board (taking
// words from 12:36), yet rule 8 named the word. Now: a word a hand holds longer than HAND_HOLD_MS goes back, a start word for a
// chat on the board is closed as moot, and rule 8 says who holds a word it names. The real case's words are the outbox's own
// (data/outbox.jsonl); the rest are made-up samples.

import assert from 'node:assert/strict'
import test from 'node:test'

import { HAND_HOLD_MS, handResults, heldTooLong, isHandWord, isMootSpawn } from '../../src/hands.mjs'
import { memoryStore } from '../../src/store.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { sweepOutbox } from '../../src/work/outboxSweep.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const keep = { messageMs: 10 * MIN, answerMs: 48 * HOUR }
const NO_SESSION = 'workers: $.tool.call is not available in this mode: no session is bound in this process (the REPL has not mounted and no headless session is built); catch it and carry on'

// The real case: sent 12:22:37, taken by Worker 2's hand 12:22:44, failed 12:52:11.
const SENT = 1793445757837
const TAKEN = 1793445764459
const FAILED = 1793447531952
const spawn = () => ({
  id: '20e17b272740a56f', at: SENT, to: 'Main', ask: null, step: null, title: null, version: null, verdict: null, command: 'spawn', count: 1, why: 'owner', about: 'Product owner',
  routine: { role: 'owner', title: 'Lava Tactics - Product owner', tasks: ['my-project-product-owner', 'my-project-product-owner-2'] },
  text: 'start the Product owner\nIts chat "Lava Tactics - Product owner" is not on the board, and the person\'s talks wait for it.',
  state: 'waiting',
})
const taken = () => ({ ...spawn(), state: 'taken', takenAt: TAKEN, takenBy: 'Worker 2' })
const failed = () => ({ ...taken(), state: 'failed', failedAt: FAILED, tries: 1, why: NO_SESSION })

const LANES = [
  { name: 'Main', isMain: true, isLeftover: false, state: 'free', isRunning: true, queue: [] },
  { name: 'Worker 2', isMain: false, isLeftover: false, state: 'free', isRunning: true, queue: [] },
]
const OWNER = { name: 'Product owner', session: '6ddd17d1-5c7a-410e-ac4a-e9ae2691c233', appSession: 'local_owner', state: 'waiting', isRunning: true }
const stateOf = (owner = OWNER) => ({ chats: LANES, chatPrefix: 'Lava Tactics - ', restart: { main: 'Main' }, productOwner: owner })
const outboxOf = words => {
  const store = memoryStore()
  for (const one of words) store.outbox().push({ ...one })
  return store
}
const undelivered = (outbox, now, owner = OWNER) => WATCH_RULES.find(one => one.id === 'undelivered')
  .check(buildView({ state: stateOf(owner), items: new Map(), outbox: outbox.outbox(), keep, now }), { seen: new Map(), observed: [] })

test('a start word for a chat that is on the board is moot: the Product owner\'s routine once its chat is there; a worker\'s spawn names none', () => {
  assert.equal(isMootSpawn(spawn(), new Set(['Main', 'Product owner'])), true)
  assert.equal(isMootSpawn(spawn(), new Set(['Main', 'Worker 2'])), false)
  assert.equal(isMootSpawn({ ...spawn(), about: undefined, routine: undefined, text: 'spawn workers\nCount: 1' }, new Set(['Main', 'Product owner'])), false)
  assert.equal(isMootSpawn({ ...spawn(), command: 'start' }, new Set(['Product owner'])), false)
})

test('X2, the real case: the failed word is closed as moot by the next sweep, as the Product owner is on the board, and rule 8 is silent', async () => {
  const outbox = outboxOf([failed()])
  const now = FAILED + 5_000
  await sweepOutbox({ dir: null, outbox, state: stateOf(), now, keep })
  // Nothing of it waits or failed for good: the word itself, or the retry the outbox made of it, is closed with the reason.
  const open = outbox.outbox().filter(one => one.state === 'waiting' || (one.state === 'failed' && one.retriedAs === undefined))
  assert.deepEqual(open, [])
  assert.match(outbox.outbox().find(one => one.state === 'dropped').why, /^Product owner is on the board now$/)
  assert.deepEqual(undelivered(outbox, now + 11 * MIN), [])
})

test('without the Product owner on the board the failed word still matters: rule 8 names it with whose mod failed it', () => {
  // Without the Product owner on the board the word still matters: named, now with the hand that held it.
  const named = undelivered(outboxOf([failed()]), FAILED + MIN, null)
  assert.deepEqual(named.map(one => [one.key, one.evidence]), [['undelivered Main', `12:22 spawn Product owner (failed by Worker 2's mod: ${NO_SESSION.slice(0, 119)}…)`]])
})

test('a word a hand holds longer than HAND_HOLD_MS goes back to waiting, for another hand or its addressee; a younger one stays', async () => {
  const outbox = outboxOf([taken(), { ...spawn(), id: 'young', state: 'taken', takenAt: SENT + 30 * MIN, takenBy: 'Worker 1' }, { ...spawn(), id: 'chat', state: 'taken', takenAt: TAKEN }])
  // 'chat' is a chat's own take (no hand): its mod reports its typing, the hands' rule is not its.
  assert.deepEqual(heldTooLong(outbox.outbox(), TAKEN + HAND_HOLD_MS - 1), [])
  assert.deepEqual(heldTooLong(outbox.outbox(), TAKEN + HAND_HOLD_MS), ['20e17b272740a56f'])
  assert.equal(await outbox.back(['20e17b272740a56f'], 'Worker 2'), 1)
  const word = outbox.outbox().find(one => one.id === '20e17b272740a56f')
  assert.equal(word.state, 'waiting')
  assert.equal(word.takenBy, null)
  assert.equal(word.backFrom, 'Worker 2')
  // Main takes it with its own take (the hands' minute is long over); its line names no hand any more.
  const [mine] = await outbox.take('Main', TAKEN + HAND_HOLD_MS + 5_000, keep, one => one.id === '20e17b272740a56f')
  assert.equal(mine.id, '20e17b272740a56f')
  assert.equal(outbox.outbox().find(one => one.id === '20e17b272740a56f').takenBy, null)
  assert.deepEqual(heldTooLong(outbox.outbox(), TAKEN + 2 * HAND_HOLD_MS), [])
})

test('a hand that gives a word back says so: back by id, not failed; a late answer after that is kept as delivered, never sent again', async () => {
  const read = handResults({ results: [{ id: 'a', ok: false, back: true, why: 'the app gave no answer within 2 minutes' }, { id: 'b', ok: false, why: 'x' }, { id: 'c', ok: true }] })
  assert.deepEqual([read.back, read.failed, read.sent], [['a'], ['b'], ['c']])
  const outbox = outboxOf([taken()])
  await outbox.back(['20e17b272740a56f'], 'Worker 2')
  // Another hand's late word changes nothing; the hand that gave it back says it went after all: delivered, and no hand takes it.
  assert.equal(await outbox.deliveredLate(['20e17b272740a56f'], 'Worker 1', TAKEN + 4 * MIN), 0)
  assert.equal(await outbox.deliveredLate(['20e17b272740a56f'], 'Worker 2', TAKEN + 4 * MIN), 1)
  assert.equal(outbox.outbox()[0].state, 'delivered')
  assert.deepEqual(await outbox.takeHands('Worker 1', TAKEN + 5 * MIN, keep, one => isHandWord(one, { canSpawn: true })), [])
})

test('a retried word starts with no hand: the copy of a failed word names none', async () => {
  const outbox = outboxOf([{ ...failed(), routine: undefined, about: 'Worker 6', failedAt: SENT + 5_000 }])
  await outbox.retryFailed(SENT + 70_000, keep)
  const copy = outbox.outbox().find(one => one.retryOf === '20e17b272740a56f')
  assert.equal(copy.state, 'waiting')
  assert.equal(copy.takenBy, undefined)
})

test('rule 8 names a word a hand still holds past the limit, and says whose mod holds it', () => {
  const held = undelivered(outboxOf([taken()]), TAKEN + 11 * MIN, null)
  assert.deepEqual(held.map(one => [one.key, one.evidence]), [['undelivered Main', '12:22 spawn Product owner (taken, held by Worker 2\'s mod)']])
  // A moot one is not named, held or not.
  assert.deepEqual(undelivered(outboxOf([taken()]), TAKEN + 11 * MIN), [])
})
