import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { fileStore, foldOutbox, memoryStore, outboxNow, startGap, tick } from '../src/store.mjs'

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

test('tick: the gap a start has written is not written again by the first look after it', async () => {
  const before = [{ at: 1 * MIN, chat: 'Units', state: 'working', task: null }]
  const store = memoryStore([...before, startGap(before, 1 * MIN, 60 * MIN)])
  await store.alive(1 * MIN)
  await tick(store, { chats: chats('working') }, 60 * MIN)
  assert.deepEqual(store.lines().map(line => [line.at, line.gap === true]), [[1 * MIN, false], [1 * MIN, true], [60 * MIN, false]])
})

test('B529: reload reads alive.json again: the first look of a process that takes over writes no gap the holder did not have', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'board-store-'))
  try {
    // Two board processes on one data folder: `other` started first and only read since; `holder` looked every minute.
    const first = await fileStore(dir, 0)
    await tick(first, { chats: chats('working') }, 0)
    const other = await fileStore(dir, 1 * MIN)
    const holder = await fileStore(dir, 1 * MIN)
    for (const at of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) await tick(holder, { chats: chats('working') }, at * MIN)
    await other.reload()
    assert.equal(other.aliveAt(), 10 * MIN)
    await tick(other, { chats: chats('working') }, 11 * MIN)
    assert.deepEqual(other.lines().map(line => [line.at, line.gap === true, line.state]), [[0, false, 'working']])
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'alive.json'), 'utf8')), { at: 11 * MIN })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('outboxNow: a message that waited too long is expired, shown for a while, and then gone', () => {
  const typed = [
    { id: 'a', at: 0, text: 'Old', state: 'waiting' },
    { id: 'b', at: 55 * MIN, text: 'Fresh', state: 'waiting' },
    { id: 'c', at: 50 * MIN, text: 'Arrived', state: 'delivered' },
  ]
  const keep = { messageMs: 10 * MIN, answerMs: 10 * MIN }
  assert.deepEqual(outboxNow(typed, 60 * MIN, keep), [
    { id: 'a', at: 0, text: 'Old', state: 'expired' },
    { id: 'b', at: 55 * MIN, text: 'Fresh', state: 'waiting' },
  ])
  assert.deepEqual(outboxNow(typed, 13 * 60 * MIN, keep).map(message => message.id), [])
  assert.equal(typed[0].state, 'waiting')
})

test('memoryStore keeps what was typed, newest last', async () => {
  const store = memoryStore()
  await store.say({ id: 'a', at: 1, text: 'Hello', state: 'waiting' })
  assert.deepEqual(store.outbox(), [{ id: 'a', at: 1, text: 'Hello', state: 'waiting' }])
})
