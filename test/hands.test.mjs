// B753 (the person, 2026-10-28: "i want to slowly phase out the main ... replace more with code"): the board's hands in
// code. A running chat's Workers mod claims the start, wake and resume jobs and sends each with the app's own tool; a word
// it cannot send goes back to waiting for the main chat. Made-up names only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { HAND_LINE, RESUME_AGAIN_MS, handJobs, handResults, isHandWord } from '../src/hands.mjs'
import { memoryStore } from '../src/store.mjs'
import { POST_ROUTES } from '../server.mjs'

const MIN = 60_000
const keep = { messageMs: 60 * MIN, answerMs: 24 * 60 * MIN }
const LANES = [
  { name: 'Main', isMain: true, appSession: 'local_main' },
  { name: 'Worker 1', appSession: 'local_w1' },
  { name: 'Worker 2', appSession: null },
  { name: 'Advisor', appSession: 'local_adv' },
]
const word = (id, command, about, to = 'Main') => ({ id, at: 0, to, ask: null, command, about, text: `${command} "${about}"`, state: 'waiting' })

test('a hand\'s words are the board\'s start and wake words, whoever they are addressed to', () => {
  assert.equal(isHandWord(word('a', 'start', 'Worker 1')), true)
  assert.equal(isHandWord(word('b', 'wake', 'Worker 1', 'Advisor')), true)
  for (const command of ['resume', 'work', 'evaluate', null]) assert.equal(isHandWord(word('c', command, 'Worker 1')), false, String(command))
})

test('the jobs: one per word with the target\'s app id and the one line; a chat with no app id, or the caller itself, goes back to the main chat', () => {
  const taken = [word('a', 'start', 'Worker 1'), word('b', 'wake', 'Worker 2'), word('c', 'start', 'Advisor'), word('d', 'wake', 'Nobody')]
  const { jobs, back } = handJobs({ caller: 'Advisor', taken, lanes: LANES, now: 0 })
  assert.deepEqual(jobs, [{ id: 'a', to: 'local_w1', chat: 'Worker 1', text: HAND_LINE }])
  assert.deepEqual(back, ['b', 'c', 'd'])
})

test('while resuming, a resume line to each chat that has not started and has an app id, and again only after a while', () => {
  const resumeList = [
    { chat: 'Worker 1', session: 'local_w1', step: 'B12', hasStarted: false },
    { chat: 'Worker 2', session: null, step: 'B14', hasStarted: false },
    { chat: 'Advisor', session: 'local_adv', step: 'B15', hasStarted: true },
    { chat: 'Main', session: 'local_main', step: 'B16', hasStarted: false },
  ]
  const first = handJobs({ caller: 'Main', resumeList, lanes: LANES, since: 100, now: 10 * MIN })
  assert.deepEqual(first.jobs, [{ id: 'resume:100:Worker 1', to: 'local_w1', chat: 'Worker 1', text: 'resume your step B12 from your checkpoint' }])
  const sentAt = new Map([['100:Worker 1', 10 * MIN]])
  assert.deepEqual(handJobs({ caller: 'Main', resumeList, lanes: LANES, since: 100, sentAt, now: 10 * MIN + RESUME_AGAIN_MS - 1 }).jobs, [])
  assert.equal(handJobs({ caller: 'Main', resumeList, lanes: LANES, since: 100, sentAt, now: 10 * MIN + RESUME_AGAIN_MS }).jobs.length, 1)
})

test('what a hand reports is read safely: sent and failed by id, each why kept short', () => {
  const read = handResults({ results: [{ id: 'a', ok: true }, { id: 'b', ok: false, why: 'x'.repeat(500) }, { id: 7, ok: true }, null, { id: 'c' }] })
  assert.deepEqual(read.sent, ['a'])
  assert.deepEqual(read.failed, ['b', 'c'])
  assert.equal(read.why.b.length, 300)
  assert.deepEqual(handResults(null), { sent: [], failed: [], why: {} })
})

test('the outbox: a hand takes each start and wake word once, whoever it is for; one put back waits again; a settle per addressee closes them', async () => {
  const store = memoryStore()
  await store.say(word('a', 'start', 'Worker 1'))
  await store.say(word('b', 'wake', 'Worker 2', 'Advisor'))
  await store.say({ ...word('c', null, 'Worker 1'), command: undefined })
  // Two hands at once: each word goes to one of them only.
  const [first, second] = await Promise.all([store.takeHands('Advisor', MIN, keep, isHandWord), store.takeHands('Supervisor', MIN, keep, isHandWord)])
  assert.deepEqual([first.map(one => one.id), second.map(one => one.id)], [['a', 'b'], []])
  assert.equal(store.outbox().find(one => one.id === 'a').takenBy, 'Advisor')
  // The main chat's own take no longer gets them; the plain word still waits for it.
  assert.deepEqual((await store.take('Main', 2 * MIN, keep)).map(one => one.id), ['c'])
  assert.equal(await store.back(['b']), 1)
  assert.equal(store.outbox().find(one => one.id === 'b').state, 'waiting')
  await store.settle('Main', { typed: ['a'] }, 3 * MIN)
  assert.equal(store.outbox().find(one => one.id === 'a').state, 'delivered')
})

test('the routes: a hand claims and reports through the bridge, behind the board\'s key and its lock', () => {
  assert.deepEqual(POST_ROUTES['/api/bridge/hands'], { kind: 'bridge', guard: 'lock' })
  assert.deepEqual(POST_ROUTES['/api/bridge/hands-done'], { kind: 'bridge', guard: 'lock' })
})
