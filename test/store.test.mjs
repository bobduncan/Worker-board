import assert from 'node:assert/strict'
import test from 'node:test'

import { foldOutbox, memoryStore, startGap, tick } from '../src/store.mjs'

const MIN = 60_000
const chats = (state, task = null) => [{ name: 'Units', isLeftover: false, state, task }, { name: 'Main (fork)', isLeftover: true, state: 'unknown', task: null }]

test('foldOutbox: one message per id, the last line about it wins', () => {
  const text = [
    JSON.stringify({ id: 'a', at: 1, text: 'First', state: 'waiting' }),
    '{ broken',
    JSON.stringify({ id: 'b', at: 2, text: 'Second', state: 'waiting' }),
    JSON.stringify({ id: 'a', state: 'delivered', deliveredAt: 3 }),
  ].join('\r\n')
  assert.deepEqual(foldOutbox(text), [
    { id: 'a', at: 1, text: 'First', state: 'delivered', deliveredAt: 3 },
    { id: 'b', at: 2, text: 'Second', state: 'waiting' },
  ])
  assert.deepEqual(foldOutbox(''), [])
})

test('startGap: a board that was off leaves a gap from the moment it was last alive', () => {
  const lines = [{ at: 10 * MIN, chat: 'Units', state: 'working' }]
  assert.deepEqual(startGap(lines, 12 * MIN, 60 * MIN), { at: 12 * MIN, gap: true })
  assert.deepEqual(startGap(lines, null, 60 * MIN), { at: 10 * MIN, gap: true })
  assert.equal(startGap(lines, 59 * MIN, 60 * MIN), null)
  assert.equal(startGap([], 12 * MIN, 60 * MIN), null)
  assert.equal(startGap([{ at: 12 * MIN, gap: true }], 12 * MIN, 60 * MIN), null)
})

test('tick: records a chat once, and again only when it changes; leftovers are not recorded', async () => {
  const store = memoryStore()
  await tick(store, { chats: chats('working') }, 1 * MIN)
  await tick(store, { chats: chats('working') }, 2 * MIN)
  await tick(store, { chats: chats('free') }, 3 * MIN)
  assert.deepEqual(store.lines().map(line => [line.at, line.chat, line.state]), [[1 * MIN, 'Units', 'working'], [3 * MIN, 'Units', 'free']])
  assert.equal(store.aliveAt(), 3 * MIN)
})

test('tick: after a sleep, the time asleep is a gap and every chat is recorded afresh', async () => {
  const store = memoryStore()
  await tick(store, { chats: chats('working') }, 1 * MIN)
  await tick(store, { chats: chats('working') }, 30 * MIN)
  assert.deepEqual(store.lines().map(line => [line.at, line.gap === true, line.state]), [
    [1 * MIN, false, 'working'],
    [1 * MIN, true, undefined],
    [30 * MIN, false, 'working'],
  ])
})

test('memoryStore keeps what was typed, newest last', async () => {
  const store = memoryStore()
  await store.say({ id: 'a', at: 1, text: 'Hello', state: 'waiting' })
  assert.deepEqual(store.outbox(), [{ id: 'a', at: 1, text: 'Hello', state: 'waiting' }])
})
