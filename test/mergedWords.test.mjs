// Workers mod 0.31.0, Task 6 (the Advisor's case of 2026-11-04): the app dequeues the words the mod typed while its chat was busy
// all at once, MERGED into one prompt, and only the last submit resolves; a mod before 0.31.0 never says the earlier ones typed
// and they stayed `taken` for ever. The mod of 0.31.0 confirms them itself; this is the board's net for the rest: a word its own
// chat took, still taken 15 min after a turn start of that chat that came after the take, is closed `delivered`, unconfirmed.
// Made-up chats; the ids of the real batches (09:31:48, 10:06:48, 11:19:40), the times of the first.

import assert from 'node:assert/strict'
import test from 'node:test'

import { memoryStore } from '../src/store.mjs'
import { UNCONFIRMED_MS, UNCONFIRMED_WHY, sweepOutbox, unconfirmedOf } from '../src/work/outboxSweep.mjs'

const MIN = 60_000
const TAKE = new Date(2026, 10, 4, 9, 31, 40).getTime()
const TURN = new Date(2026, 10, 4, 9, 31, 48).getTime()
const keep = { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN }
/** Three hours on: a hand's word held that long is given back (B880's net, 3 min) in doubt for 5 min, the chat's own take comes after. */
const AFTER = TURN + 3 * 60 * MIN

/** The board's state as the sweep reads it: the chat, with the last turn its report names (none: a report without a turn, or no report). */
const board = (report = { state: 'idle', since: TURN + 5 * MIN, turn: TURN }) => ({ restart: { main: 'Main' }, chats: [
  { name: 'Main', isMain: true, isLeftover: false, report: null },
  { name: 'Advisor', isMain: false, isLeftover: false, ...(report === null ? { report: null } : { report }) },
] })
const sweep = (store, now, state = board()) => sweepOutbox({ dir: null, outbox: store, state, now, keep, fs: null })
/** A word to the Advisor, said and taken by its own chat at TAKE (or by a hand, `by`). */
async function taken(store, id, { by = null, command = null, to = 'Advisor' } = {}) {
  await store.say({ id, to, text: `(answered on the worker board, 09:31) ${id}`, at: TAKE - MIN, state: 'waiting', ...(command === null ? {} : { command }) })
  if (by === null) await store.take(to, TAKE, keep, message => message.id === id)
  else await store.takeHands(by, TAKE, keep, message => message.id === id)
}
const stateOf = (store, id) => store.outbox().find(one => one.id === id)

test('the real batch of 09:31:48: two words taken, a turn began after the take: still taken at 14 min, closed delivered at 15, at that turn\'s start', async () => {
  const store = memoryStore()
  await taken(store, '7a972772')
  await taken(store, 'cf04b25b')
  assert.equal(UNCONFIRMED_MS, 15 * MIN)
  assert.deepEqual(await sweep(store, TURN + 14 * MIN), [])
  assert.deepEqual(store.outbox().map(one => one.state), ['taken', 'taken'])
  const closed = await sweep(store, TURN + 15 * MIN)
  assert.deepEqual(closed.map(one => one.id), ['7a972772', 'cf04b25b'])
  for (const id of ['7a972772', 'cf04b25b']) {
    const word = stateOf(store, id)
    assert.equal(word.state, 'delivered')
    assert.equal(word.deliveredAt, TURN)
    assert.equal(word.why, 'delivered-unconfirmed: its chat ran a turn after it and never said')
    assert.equal(word.why, UNCONFIRMED_WHY)
  }
  // Closed once: a later look finds nothing to close.
  assert.deepEqual(await sweep(store, TURN + 60 * MIN), [])
})

test('mutant "no turn-after-the-take condition": a chat whose last turn began BEFORE the take leaves the word taken, however long after', async () => {
  const store = memoryStore()
  await taken(store, 'e2c84352')
  // The turn that runs while the word waits (it began a minute before the take): the word is queued behind it, not in it.
  const before = board({ state: 'busy', since: TAKE - MIN, turn: TAKE - MIN })
  assert.deepEqual(await sweep(store, TAKE + 3 * 60 * MIN, before), [])
  assert.equal(stateOf(store, 'e2c84352').state, 'taken')
  // A turn that began at the very moment of the take is not after it either.
  assert.deepEqual(await sweep(store, TAKE + 3 * 60 * MIN, board({ state: 'idle', since: TAKE + MIN, turn: TAKE })), [])
  assert.equal(stateOf(store, 'e2c84352').state, 'taken')
})

test('mutant "the net closes a hand\'s take": a word a hand took is never closed by the net: B880\'s own net gives it back, and it is the chat\'s only once the chat took it', async () => {
  const store = memoryStore()
  await taken(store, 'e747d01f', { by: 'Supervisor' })
  const hand = stateOf(store, 'e747d01f')
  assert.equal(hand.state, 'taken')
  assert.equal(unconfirmedOf(hand, board().chats[1], AFTER), null)
  // A replay (no give-back is made in it) names nothing: the word is a hand's, whatever turn the chat ran.
  const dry = await sweepOutbox({ dir: null, outbox: store, state: board(), now: AFTER, keep, fs: null, dry: true })
  assert.deepEqual(dry, [])
  // The real sweep: B880's net gives the word back after its 3 min (never delivered by this net).
  assert.deepEqual(await sweep(store, AFTER), [])
  assert.equal(stateOf(store, 'e747d01f').state, 'waiting')
  // The same word, after the doubt (5 min) taken by its own chat, is the chat's: the net counts it, from the turn after that take.
  const [again] = await store.take('Advisor', AFTER + 6 * MIN, { ...keep }, () => true)
  assert.equal(again.id, 'e747d01f')
  const later = board({ state: 'idle', since: AFTER + 10 * MIN, turn: AFTER + 8 * MIN })
  assert.deepEqual(await sweep(store, AFTER + 8 * MIN + 14 * MIN, later), [])
  assert.deepEqual((await sweep(store, AFTER + 8 * MIN + 15 * MIN, later)).map(one => one.id), ['e747d01f'])
})

test('a hand-over envelope, a chat with no report, a report that names no turn, and a word already told typed are left alone', async () => {
  const store = memoryStore()
  await taken(store, 'env1', { command: 'handover' })
  await taken(store, 'lone')
  // The chat's mod reports no turn (before 8c): the board does not guess it.
  assert.deepEqual(await sweep(store, AFTER, board({ state: 'idle', since: TURN })), [])
  // No report at all (a chat read from its transcript), and a lane that is not on the board.
  assert.deepEqual(await sweep(store, AFTER, board(null)), [])
  assert.deepEqual(await sweep(store, AFTER, { chats: [] }), [])
  assert.deepEqual(await sweep(store, AFTER, null), [])
  // With the turn named: the envelope stays taken (its outcome is its own), the plain word closes.
  assert.deepEqual((await sweep(store, AFTER)).map(one => one.id), ['lone'])
  assert.equal(stateOf(store, 'env1').state, 'taken')
  // A word the mod said typed is delivered already: its time stands, the net does not touch it.
  await taken(store, 'told')
  await store.settle('Advisor', { typed: ['told'] }, TAKE + 2000)
  const at = stateOf(store, 'told').deliveredAt
  assert.deepEqual(await sweep(store, TURN + 6 * 60 * MIN), [])
  assert.equal(stateOf(store, 'told').deliveredAt, at)
  assert.equal(stateOf(store, 'told').why, undefined)
})

test('unconfirmedOf: its conditions one by one, and a dry replay writes nothing', async () => {
  const store = memoryStore()
  await taken(store, 'w1')
  const word = stateOf(store, 'w1')
  const lane = { name: 'Advisor', report: { state: 'idle', since: TURN, turn: TURN } }
  assert.equal(unconfirmedOf(word, lane, TURN + 15 * MIN - 1), null)
  assert.deepEqual(unconfirmedOf(word, lane, TURN + 15 * MIN), { state: 'delivered', why: UNCONFIRMED_WHY, deliveredAt: TURN })
  assert.equal(unconfirmedOf({ ...word, state: 'waiting' }, lane, TURN + 15 * MIN), null)
  assert.equal(unconfirmedOf({ ...word, takenAt: undefined }, lane, TURN + 15 * MIN), null)
  assert.equal(unconfirmedOf(word, { ...lane, report: null }, TURN + 15 * MIN), null)
  assert.equal(unconfirmedOf(word, undefined, TURN + 15 * MIN), null)
  const dry = await sweepOutbox({ dir: null, outbox: store, state: board(), now: TURN + 15 * MIN, keep, fs: null, dry: true })
  assert.deepEqual(dry.map(one => one.id), ['w1'])
  assert.equal(stateOf(store, 'w1').state, 'taken')
})

test('a chat\'s own take sweeps only its own words, and the net is written to the log like any close', async () => {
  const store = memoryStore()
  await taken(store, 'mine')
  await taken(store, 'theirs', { to: 'Worker 3' })
  const state = { ...board(), chats: [...board().chats, { name: 'Worker 3', isMain: false, isLeftover: false, report: { state: 'idle', since: TURN, turn: TURN } }] }
  const closed = await sweepOutbox({ dir: null, outbox: store, state, now: TURN + 20 * MIN, keep, fs: null, to: 'Advisor' })
  assert.deepEqual(closed.map(one => one.id), ['mine'])
  assert.equal(stateOf(store, 'theirs').state, 'taken')
})
