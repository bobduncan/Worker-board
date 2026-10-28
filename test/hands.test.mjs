// B753 (the person, 2026-10-28: "i want to slowly phase out the main ... replace more with code"): the board's hands in
// code. A running chat's Workers mod claims the start, wake and resume jobs and sends each with the app's own tool; a word
// it cannot send goes back to waiting for the main chat. Made-up names only.

import assert from 'node:assert/strict'
import test from 'node:test'

import { HAND_LINE, HANDS_FIRST_MS, RESUME_AGAIN_MS, handJobs, handResults, isForHandsYet, isHandWord, nextWorkerTitle, setOf, startTaskIds, workerNames } from '../src/hands.mjs'
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
  assert.deepEqual(handResults(null), { sent: [], failed: [], why: {}, texts: {} })
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

// B755: a chat's model and effort set by code. Made-up chats; the model ids are the app's form, as the settings name them.
const setWord = (id, about, more) => ({ ...word(id, 'worker-effort', about), effort: 'high', model: 'claude-opus-5-5', ...more })

test('B755: a set word is a hand\'s only for a chat that can set, and only with values code may set: never Fable', () => {
  assert.equal(isHandWord(setWord('a', 'Worker 1')), false)
  assert.equal(isHandWord(setWord('a', 'Worker 1'), { canSet: true }), true)
  assert.deepEqual(setOf(setWord('a', 'Worker 1')), { model: 'claude-opus-5-5', effort: 'high' })
  assert.deepEqual(setOf(setWord('b', 'Worker 1', { model: null })), { model: null, effort: 'high' })
  assert.deepEqual(setOf({ ...word('c', 'partner-effort', 'Advisor'), mode: 'high' }), { model: 'claude-opus-5-5', effort: 'max' })
  assert.deepEqual(setOf({ ...word('d', 'partner-effort', 'Advisor'), mode: 'usual' }), { model: 'claude-opus-5-5', effort: 'xhigh' })
  for (const bad of [
    { ...word('e', 'partner-effort', 'Advisor'), mode: 'fable' },
    setWord('f', 'Worker 1', { model: 'claude-fable-5-1' }),
    setWord('g', 'Worker 1', { model: 'gpt-5' }),
    setWord('h', 'Worker 1', { effort: 'ultra' }),
    setWord('i', 'Worker 1', { model: 'claude-opus-5-5; rm -rf' }),
  ]) {
    assert.equal(setOf(bad), null, bad.id)
    assert.equal(isHandWord(bad, { canSet: true }), false, bad.id)
  }
})

test('B755: a set job carries the target\'s app id and the values, no line; the caller\'s own chat goes back to the main chat', () => {
  const taken = [setWord('a', 'Worker 1'), { ...word('b', 'partner-effort', 'Advisor'), mode: 'high' }, setWord('c', 'Worker 2')]
  const { jobs, back } = handJobs({ caller: 'Supervisor', taken, lanes: LANES, now: 0 })
  assert.deepEqual(jobs, [
    { id: 'a', to: 'local_w1', chat: 'Worker 1', set: { model: 'claude-opus-5-5', effort: 'high' } },
    { id: 'b', to: 'local_adv', chat: 'Advisor', set: { model: 'claude-opus-5-5', effort: 'max' } },
  ])
  assert.deepEqual(back, ['c'])
  assert.deepEqual(handJobs({ caller: 'Worker 1', taken: [setWord('a', 'Worker 1')], lanes: LANES, now: 0 }).back, ['a'])
})

test('B755: a chat\'s own take leaves a hand\'s word to the hands for a minute, then takes it; other words go at once', async () => {
  const store = memoryStore()
  await store.say({ ...setWord('a', 'Worker 1'), at: 0 })
  await store.say({ ...word('b', 'start', 'Worker 2'), at: 0 })
  await store.say({ ...word('c', 'refine', 'Worker 1'), at: 0 })
  const only = now => message => !isForHandsYet(message, now)
  assert.deepEqual((await store.take('Main', HANDS_FIRST_MS - 1, keep, only(HANDS_FIRST_MS - 1))).map(one => one.id), ['c'])
  assert.deepEqual((await store.take('Main', HANDS_FIRST_MS, keep, only(HANDS_FIRST_MS))).map(one => one.id), ['a', 'b'])
})

// B766: a worker's restart for a new mod, and a new worker, by code. Made-up chats.
const restartWord = (id, about) => ({ ...word(id, 'mod-restart', about), version: '0.25.0' })
const spawnWord = id => ({ id, at: 0, to: 'Main', ask: null, command: 'spawn', count: 1, why: 'board', text: 'spawn workers', state: 'waiting' })
const STATE = { chats: [{ name: 'Main', isMain: true }, { name: 'Worker 1' }, { name: 'Worker 2' }, { name: 'Old', isLeftover: true }, { name: 'Advisor' }], advisor: { name: 'Advisor' }, supervisorChat: { name: 'Supervisor' } }

test('B766: the board\'s workers are its lanes that are no main chat, leftover, partner, helper or supervisor', () => {
  assert.deepEqual([...workerNames(STATE)], ['Worker 1', 'Worker 2'])
  assert.deepEqual([...workerNames(null)], [])
})

test('B766: a restart is a hand\'s only for a worker and a chat that may restart; a new worker only for one that may spawn', () => {
  const workers = workerNames(STATE)
  assert.equal(isHandWord(restartWord('a', 'Worker 1'), { canRestart: true, workers }), true)
  assert.equal(isHandWord(restartWord('a', 'Worker 1'), { workers }), false)
  // Never the main chat, the partner or the supervisor: on the work login a restarted chat starts an empty conversation.
  for (const chat of ['Main', 'Advisor', 'Supervisor', 'Nobody']) assert.equal(isHandWord(restartWord('b', chat), { canRestart: true, workers }), false, chat)
  assert.equal(isHandWord(spawnWord('c'), { canSpawn: true }), true)
  assert.equal(isHandWord(spawnWord('c'), { canRestart: true, canSet: true }), false)
  // The main chat's take leaves them to the hands for a minute, a restart only of a worker.
  assert.equal(isForHandsYet(restartWord('a', 'Worker 1'), 0, workers), true)
  assert.equal(isForHandsYet(restartWord('a', 'Main'), 0, workers), false)
  assert.equal(isForHandsYet(spawnWord('c'), HANDS_FIRST_MS - 1), true)
  assert.equal(isForHandsYet(spawnWord('c'), HANDS_FIRST_MS), false)
})

test('B766: the jobs: a restart names the board\'s chats to reopen; one new worker per claim, the next free title and the task ids', () => {
  const spawn = { title: nextWorkerTitle(['Main', 'Worker 1', 'Worker 2', 'Worker 4'], 'Studio · '), tasks: startTaskIds('my-project') }
  assert.deepEqual(spawn, { title: 'Studio · Worker 3', tasks: ['my-project-start-worker-2', 'my-project-start-worker'] })
  const taken = [restartWord('a', 'Worker 1'), spawnWord('b'), spawnWord('c')]
  const { jobs, back } = handJobs({ caller: 'Supervisor', taken, lanes: LANES, now: 0, spawn })
  assert.deepEqual(jobs, [
    { id: 'a', to: 'local_w1', chat: 'Worker 1', restart: { keep: ['local_main', 'local_w1', 'local_adv'] } },
    { id: 'b', chat: 'Studio · Worker 3', spawn: { title: 'Studio · Worker 3', tasks: ['my-project-start-worker-2', 'my-project-start-worker'] } },
  ])
  assert.deepEqual(back, ['c'])
  // A board that gives no spawn (no project, or the chat may not) puts the word back for the main chat.
  assert.deepEqual(handJobs({ caller: 'Supervisor', taken: [spawnWord('d')], lanes: LANES, now: 0 }).back, ['d'])
  // A chat never restarts itself.
  assert.deepEqual(handJobs({ caller: 'Worker 1', taken: [restartWord('e', 'Worker 1')], lanes: LANES, now: 0 }).back, ['e'])
  assert.deepEqual(startTaskIds(''), [])
})

test('B766: the server gives the restart and spawn words only by what the claiming chat may do', async () => {
  const { readFile } = await import('node:fs/promises')
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /isHandWord\(message, \{ canSet: can\.has\('set'\), canRestart: can\.has\('restart'\), canSpawn: can\.has\('spawn'\), workers \}\)/)
  assert.match(server, /title: nextWorkerTitle\(\(state\.chats \?\? \[\]\)\.map\(lane => lane\.name\), prefix\), tasks: startTaskIds\(basename\(config\.project\)\)/)
  assert.match(server, /!isForHandsYet\(message, now, workers\)/)
})

// B768: a lookup of the plan's limits by code when the board's newest reading is old.
test('B768: a lookup is due when the newest reading is ten minutes old, not again within two minutes of the last', async () => {
  const { USAGE_AGAIN_MS, USAGE_EVERY_MS, usageDue } = await import('../src/hands.mjs')
  assert.equal(usageDue({ readings: [], now: 0 }), true)
  assert.equal(usageDue({ readings: [{ at: 0 }, { at: 5 * MIN }], now: 5 * MIN + USAGE_EVERY_MS - 1 }), false)
  assert.equal(usageDue({ readings: [{ at: 0 }], now: USAGE_EVERY_MS }), true)
  assert.equal(usageDue({ readings: [{ at: 0 }], givenAt: USAGE_EVERY_MS, now: USAGE_EVERY_MS + USAGE_AGAIN_MS - 1 }), false)
  // The job goes to the claiming chat, after its other jobs; its answer comes back with the result, cut at 20000.
  const { jobs } = handJobs({ caller: 'Worker 1', taken: [], lanes: LANES, now: 7, usage: true })
  assert.deepEqual(jobs, [{ id: 'usage:7', chat: 'Worker 1', usage: true }])
  const read = handResults({ results: [{ id: 'usage:7', ok: true, text: 'x'.repeat(30_000) }, { id: 'a', ok: true, text: 'not kept' }] })
  assert.deepEqual([Object.keys(read.texts), read.texts['usage:7'].length], [['usage:7'], 20_000])
})

// B769: the person's Stop task and Remove worker, by code.
test('B769: a stop is settled once its worker\'s turn ended after it, or its chat is off; a remove then becomes a job', async () => {
  const { STOP_HANDS_MS, isStopWord, stopStep, stopTaskOf } = await import('../src/hands.mjs')
  const stop = { id: 's', at: 100, to: 'Main', command: 'stop', about: 'Worker 1', byCode: true, text: 'stop task\nName: Worker 1\nTask: B12 "Lava"\nWhy: stopped with the button', state: 'waiting' }
  const remove = { ...stop, id: 'r', command: 'remove', text: 'remove worker' }
  assert.equal(isStopWord(stop), true)
  assert.equal(isStopWord({ ...stop, byCode: undefined }), false)
  assert.equal(stopTaskOf(stop), 'B12 "Lava"')
  const working = { name: 'Worker 1', isRunning: true, report: { state: 'busy', since: 200 } }
  const ended = { name: 'Worker 1', isRunning: true, report: { state: 'idle', since: 200 } }
  const before = { name: 'Worker 1', isRunning: true, report: { state: 'idle', since: 50 } }
  assert.deepEqual([stopStep(stop, working), stopStep(stop, ended), stopStep(stop, before)], ['wait', 'settle', 'wait'])
  assert.deepEqual([stopStep(remove, ended), stopStep(remove, { name: 'Worker 1', isRunning: false })], ['remove', 'remove'])
  // A worker the board no longer shows: nothing more to do.
  assert.deepEqual([stopStep(stop, undefined), stopStep(remove, undefined)], ['settle', 'settle'])
  // The main chat's own take leaves it to code for a while, then takes it after all.
  assert.equal(isForHandsYet(stop, 100 + STOP_HANDS_MS - 1), true)
  assert.equal(isForHandsYet(stop, 100 + STOP_HANDS_MS), false)
})

test('B769: the server marks stop and remove for code, names the stop in the worker\'s take and gives the remove job', async () => {
  const { readFile } = await import('node:fs/promises')
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.match(server, /if \(isNew \|\| isOff\) message = \{ \.\.\.message, byCode: true \}/)
  assert.match(server, /\{ stop: \{ id: stopping\.id, kind: stopping\.command, task: stopTaskOf\(stopping\) \} \}/)
  assert.match(server, /else if \(step === 'remove' && can\.has\('restart'\)\) removing\.push\(message\.id\)/)
  assert.match(server, /chat: message\.about, remove: true \}\)/)
})

test('the routes: a hand claims and reports through the bridge, behind the board\'s key and its lock', () => {
  assert.deepEqual(POST_ROUTES['/api/bridge/hands'], { kind: 'bridge', guard: 'lock' })
  assert.deepEqual(POST_ROUTES['/api/bridge/hands-done'], { kind: 'bridge', guard: 'lock' })
})
