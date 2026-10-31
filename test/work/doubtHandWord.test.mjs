// B891 (the result check of B880 by Worker 5: "a word is never typed twice" not held): a hand's call that gives no answer in time
// may still have acted (the real case's did: the Product owner's routine began 28 s after the take, its call never answered).
// B880 gave such a word back at once for the next hand, and its first hand's late "sent" was then ignored, so a worker's spawn,
// a restart or an archive went twice. Now a word given back after a call that gave no answer is in doubt (`doubtAt`): no hand and
// no chat takes it for DOUBT_MS, so its first hand's late answer still settles it, and the sweep closes it once what it asked shows
// on the board; only a word with no sign of it after DOUBT_MS is tried again. A word given back unsent (no session) is free at once.

import assert from 'node:assert/strict'
import test from 'node:test'

import { DOUBT_MS, handResults, isHandWord, isInDoubt } from '../../src/hands.mjs'
import { memoryStore } from '../../src/store.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { giveBackHeld, sweepOutbox } from '../../src/work/outboxSweep.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const keep = { messageMs: 10 * MIN, answerMs: 48 * HOUR }
const AT = 1793445757837
const TAKEN = AT + 7_000
const spawnWorker = () => ({ id: 'w', at: AT, to: 'Main', command: 'spawn', count: 1, text: 'spawn workers\nCount: 1', state: 'waiting' })
const LANES = [
  { name: 'Main', isMain: true, isLeftover: false, state: 'free', isRunning: true, queue: [] },
  { name: 'Worker 2', isMain: false, isLeftover: false, state: 'free', isRunning: true, queue: [] },
]
const stateOf = lanes => ({ chats: lanes, chatPrefix: 'Lava Tactics - ', restart: { main: 'Main' } })
const anySpawn = one => isHandWord(one, { canSpawn: true })
const outboxOf = words => {
  const store = memoryStore()
  for (const one of words) store.outbox().push({ ...one })
  return store
}

/** Worker 2's hand takes the worker's spawn, its job makes "Worker 3", and its call gives no answer within 2 minutes. */
async function hung() {
  const outbox = outboxOf([spawnWorker()])
  const [word] = await outbox.takeHands('Worker 2', TAKEN, keep, anySpawn)
  await outbox.handChats([[word.id, 'Worker 3']])
  const read = handResults({ results: [{ id: 'w', ok: false, back: true, doubt: true, why: 'the app gave no answer within 2 minutes' }] })
  assert.deepEqual([read.back, read.doubt], [['w'], ['w']])
  assert.equal(await outbox.back(read.back, 'Worker 2', TAKEN + 2 * MIN, read.doubt), 1)
  return outbox
}

test("Worker 5's probe: a spawn given back after a call with no answer is taken by no other hand, and the first hand's late send settles it: one spawn", async () => {
  const outbox = await hung()
  const word = outbox.outbox()[0]
  assert.equal(isInDoubt(word, TAKEN + 2 * MIN), true)
  assert.deepEqual(await outbox.takeHands('Worker 3', TAKEN + 2 * MIN + 20_000, keep, anySpawn), [])
  assert.deepEqual(await outbox.take('Main', TAKEN + 3 * MIN, keep), [])
  assert.equal(await outbox.deliveredLate(['w'], 'Worker 2', TAKEN + 4 * MIN), 1)
  assert.equal(outbox.outbox()[0].state, 'delivered')
})

test('a spawn in doubt whose worker shows on the board is closed by the sweep: it went; never started again', async () => {
  const outbox = await hung()
  const lanes = [...LANES, { name: 'Worker 3', isMain: false, isLeftover: false, state: 'free', isRunning: true, queue: [] }]
  await sweepOutbox({ dir: null, outbox, state: stateOf(lanes), now: TAKEN + 3 * MIN, keep })
  assert.deepEqual([outbox.outbox()[0].state, outbox.outbox()[0].why], ['dropped', 'Worker 3 is on the board now'])
  // Without it on the board the sweep leaves it in doubt.
  const other = await hung()
  await sweepOutbox({ dir: null, outbox: other, state: stateOf(LANES), now: TAKEN + 3 * MIN, keep })
  assert.equal(other.outbox()[0].state, 'waiting')
})

test('with no sign of it after DOUBT_MS the word is tried again, by the next hand; a late answer of the first then changes nothing', async () => {
  const outbox = await hung()
  const back = TAKEN + 2 * MIN
  assert.deepEqual(await outbox.takeHands('Worker 3', back + DOUBT_MS - 1, keep, anySpawn), [])
  const [again] = await outbox.takeHands('Worker 3', back + DOUBT_MS, keep, anySpawn)
  assert.equal(again.id, 'w')
  assert.equal(await outbox.deliveredLate(['w'], 'Worker 2', back + DOUBT_MS + MIN), 0)
})

test('a word given back unsent (the process has no session) is in no doubt: the next hand takes it at once', async () => {
  const outbox = outboxOf([spawnWorker()])
  await outbox.takeHands('Worker 2', TAKEN, keep, anySpawn)
  const read = handResults({ results: [{ id: 'w', ok: false, back: true, why: 'the process of this chat cannot call tools now (no session bound): given back for another hand' }] })
  assert.deepEqual(read.doubt, [])
  await outbox.back(read.back, 'Worker 2', TAKEN + 1_000, read.doubt)
  assert.equal(isInDoubt(outbox.outbox()[0], TAKEN + 2_000), false)
  assert.equal((await outbox.takeHands('Worker 3', TAKEN + 2_000, keep, anySpawn)).length, 1)
})

test("a mod of B880 says no doubt, but its no-answer why does: read as in doubt", () => {
  const read = handResults({ results: [{ id: 'w', ok: false, back: true, why: 'the app gave no answer within 2 minutes: given back for another hand' }] })
  assert.deepEqual(read.doubt, ['w'])
})

test('the doubt flag alone is enough, whatever the why says', () => {
  assert.deepEqual(handResults({ results: [{ id: 'w', ok: false, back: true, doubt: true, why: 'no reply' }, { id: 'x', ok: false, back: true }] }).doubt, ['w'])
})

test("the board's own give-back (a hand silent for 3 minutes) is in doubt too: its call may have acted", async () => {
  const outbox = outboxOf([spawnWorker()])
  await outbox.takeHands('Worker 2', TAKEN, keep, anySpawn)
  assert.equal(await giveBackHeld(outbox, TAKEN + 3 * MIN, () => {}), 1)
  assert.equal(isInDoubt(outbox.outbox()[0], TAKEN + 3 * MIN), true)
  assert.deepEqual(await outbox.takeHands('Worker 3', TAKEN + 4 * MIN, keep, anySpawn), [])
})

test('rule 8 names a word in doubt with the hand whose call gave no answer', async () => {
  const outbox = await hung()
  const found = WATCH_RULES.find(one => one.id === 'undelivered')
    .check(buildView({ state: stateOf(LANES), items: new Map(), outbox: outbox.outbox(), keep, now: TAKEN + 11 * MIN }), { seen: new Map(), observed: [] })
  assert.equal(found.length, 1)
  assert.match(found[0].evidence, /in doubt: Worker 2's mod gave no answer/)
})
