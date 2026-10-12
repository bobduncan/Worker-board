import assert from 'node:assert/strict'
import test from 'node:test'

import { bridgeNote, checkTake, messageText } from '../src/bridge.mjs'
import { foldOutbox, memoryStore, outboxNow } from '../src/store.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const clock = at => `16:0${at}`
const keep = { messageMs: 10 * MIN, answerMs: 48 * HOUR }

test('a line typed to the advisor arrives as it was typed, marked as coming from the board', () => {
  assert.equal(messageText({ at: 2, to: 'Advisor', ask: null, text: 'What is next?' }, clock), 'What is next?\n(typed on the worker board, 16:02)')
})

test('an approval names the step and says to tick it; a note of the person goes with it', () => {
  const approve = { at: 2, to: 'Units', ask: 'backlog:B14', step: 'B14', title: 'Say whether the mage is right', verdict: 'approve', text: '' }
  assert.equal(messageText(approve, clock), '(answered on the worker board, 16:02) B14 "Say whether the mage is right": approved. Tick this step in the backlog.')
  assert.equal(messageText({ ...approve, text: 'Lovely hat' }, clock), '(answered on the worker board, 16:02) B14 "Say whether the mage is right": approved. Note: Lovely hat\nTick this step in the backlog.')
})

test('a rejection carries the reason and asks for it to be picked up or queued', () => {
  const reject = { at: 2, to: 'Units', ask: 'backlog:B14', step: 'B14', title: 'The walk', verdict: 'reject', text: 'The feet slide' }
  assert.equal(messageText(reject, clock), '(answered on the worker board, 16:02) B14 "The walk": rejected. Reason: The feet slide\nPick this up: now if it belongs to what you are doing, else as a step in the queue.')
})

test('something the person did is reported as done; a decision carries their words', () => {
  assert.equal(messageText({ at: 2, ask: 'backlog:B52', step: 'B52', title: 'Quit the app once', verdict: 'done', text: '' }, clock),
    '(answered on the worker board, 16:02) B52 "Quit the app once": done. Tick this step in the backlog.')
  assert.equal(messageText({ at: 2, ask: 'backlog:B67', step: 'B67', title: 'Five choices', verdict: null, text: 'A: the mod' }, clock),
    '(answered on the worker board, 16:02) B67 "Five choices": A: the mod')
})

test('an answer to a request a chat filed itself names the request, and an approval closes it', () => {
  assert.equal(messageText({ at: 2, ask: 'walk-2', step: null, title: 'Check the walk', verdict: 'approve', text: '' }, clock),
    '(answered on the worker board, 16:02) "Check the walk": approved. Close this request.')
})

test('an answer to a chat that simply waits is the person\'s words, with the mark of the board', () => {
  assert.equal(messageText({ at: 2, ask: 'chat:Units:5', step: null, title: 'Needs your decision', verdict: null, text: 'Sheet B' }, clock),
    '(answered on the worker board, 16:02) Sheet B')
})

test('checkTake: the mod names the chat it takes for', () => {
  assert.deepEqual(checkTake({ chat: 'Levels / Environment' }), { ok: true, chat: 'Levels / Environment' })
  assert.equal(checkTake({ chat: '' }).ok, false)
  assert.equal(checkTake({ chat: 'x'.repeat(200) }).ok, false)
  assert.equal(checkTake({}).ok, false)
  assert.equal(checkTake(null).ok, false)
})

test('bridgeNote: where the board is, for the mod to find it', () => {
  assert.deepEqual(JSON.parse(bridgeNote({ port: 4311, key: 'k', at: 5 })), { url: 'http://127.0.0.1:4311', key: 'k', startedAt: 5 })
})

test('taking hands out what waits for one chat, once', async () => {
  const store = memoryStore()
  await store.say({ id: 'a', at: 0, to: 'Units', ask: 'backlog:B14', text: 'x', state: 'waiting' })
  await store.say({ id: 'b', at: 0, to: 'Main', ask: null, text: 'y', state: 'waiting' })
  const taken = await store.take('Units', 5 * MIN, keep)
  assert.deepEqual(taken.map(message => [message.id, message.state]), [['a', 'delivered']])
  assert.deepEqual(await store.take('Units', 6 * MIN, keep), [])
  assert.deepEqual(store.outbox().map(message => [message.id, message.state, message.deliveredAt ?? null]), [['a', 'delivered', 5 * MIN], ['b', 'waiting', null]])
})

test('taking never hands out what waited too long: a typed line after minutes, an answer after two days', async () => {
  const store = memoryStore()
  await store.say({ id: 'line', at: 0, to: 'Advisor', ask: null, text: 'x', state: 'waiting' })
  await store.say({ id: 'answer', at: 0, to: 'Advisor', ask: 'q1', text: 'y', state: 'waiting' })
  assert.deepEqual((await store.take('Advisor', 11 * MIN, keep)).map(message => message.id), ['answer'])
  const late = memoryStore()
  await late.say({ id: 'answer', at: 0, to: 'Units', ask: 'q1', text: 'y', state: 'waiting' })
  assert.deepEqual(await late.take('Units', 49 * HOUR, keep), [])
})

test('the log of the outbox remembers a delivery', () => {
  const log = ['{"id":"a","at":1,"to":"Units","text":"x","state":"waiting"}', '{"id":"a","state":"delivered","deliveredAt":9}'].join('\n')
  assert.deepEqual(foldOutbox(log), [{ id: 'a', at: 1, to: 'Units', text: 'x', state: 'delivered', deliveredAt: 9 }])
})

test('outboxNow: an answer waits long for its chat, and a delivered answer stays known; a delivered line does not', () => {
  const messages = [
    { id: 'line', at: 0, ask: null, text: 'x', state: 'waiting' },
    { id: 'answer', at: 0, ask: 'q1', text: 'y', state: 'waiting' },
    { id: 'done', at: 0, ask: 'q2', text: 'z', state: 'delivered' },
    { id: 'said', at: 0, ask: null, text: 'w', state: 'delivered' },
  ]
  assert.deepEqual(outboxNow(messages, 60 * MIN, keep).map(message => [message.id, message.state]), [['line', 'expired'], ['answer', 'waiting'], ['done', 'delivered']])
  assert.deepEqual(outboxNow(messages, 49 * HOUR, keep).map(message => [message.id, message.state]), [['done', 'delivered']])
})
