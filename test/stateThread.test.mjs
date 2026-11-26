// B1535 (X93, chat 1's way A): the state build in a thread of its own (src/stateThread.mjs). The loop runs on while a build
// holds its thread; the build gives the same state as one in the loop; and when the thread cannot start, throws, ends, cannot
// copy or hangs, the board builds in the loop as before and says so once.

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

import { parseConfig } from '../src/config.mjs'
import { buildState } from '../src/state.mjs'
import { holdBuild, LATE, MOST_FAILURES, stateThread } from '../src/stateThread.mjs'
import { answer } from '../src/stateWorker.mjs'

const NOW = Date.UTC(2026, 10, 25, 18, 50)
const PROJECT = join(tmpdir(), 'garden')
const app = name => ({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: NOW - 60_000, completedTurns: 3, isStub: false, effort: null, model: null, summary: null })
const RAW = {
  listText: '{"prefix":"Garden · ","main":"Lead"}', appChats: [app('Lead'), app('Digger')], tails: {}, planLineTexts: {}, adviceText: null,
  folders: null, askTexts: [], pictureLists: {},
}
const OPTIONS = { now: NOW, config: { ...parseConfig('{}', {}), project: PROJECT } }

/** A thread file of its own, made of `code`, in `dir`. */
async function threadFile(dir, name, code) {
  const path = join(dir, name)
  await writeFile(path, code)
  return pathToFileURL(path)
}

/** The longest gap of a 20 ms timer while `run` runs: how long the loop was held at a time. */
async function loopHeld(run) {
  let last = Date.now()
  let most = 0
  const timer = setInterval(() => {
    most = Math.max(most, Date.now() - last - 20)
    last = Date.now()
  }, 20)
  const answer = await run()
  clearInterval(timer)
  most = Math.max(most, Date.now() - last - 20)
  return { answer, most }
}

test('the thread builds the same state as the loop does, and an error of the build is the read\'s error with the thread still on', async t => {
  const failed = []
  const builder = stateThread({ inLoop: (raw, options) => buildState(raw, options), failed: error => failed.push(error) })
  t.after(() => builder.close())
  const built = await builder.build(RAW, OPTIONS)
  assert.deepEqual(built, buildState(RAW, OPTIONS))
  assert.deepEqual(built.chats.map(chat => chat.name), ['Lead', 'Digger'])
  // A raw the build throws on (no config): the read fails as it did in the loop; the thread stays on, nothing is said.
  await assert.rejects(builder.build(RAW, { now: NOW }), error => error instanceof Error && error.message !== '')
  assert.equal(builder.off(), null)
  assert.deepEqual(failed, [])
  assert.deepEqual(await builder.build(RAW, OPTIONS), built)
})

test('a raw with the chat files\' texts (an older read, the tests\') builds the same chats as one with them parsed', () => {
  const { appChats, ...rest } = RAW
  const fromTexts = buildState({ ...rest, appChatTexts: appChats.map(chat => JSON.stringify(chat)) }, OPTIONS)
  assert.deepEqual(fromTexts.chats, buildState(RAW, OPTIONS).chats)
})

test('the 19:50 case: a build that holds its thread for 1.5 s leaves the loop free; the same build in the loop holds it', { timeout: 60_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'state-thread-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const slow = await threadFile(dir, 'slow.mjs', `import { parentPort } from 'node:worker_threads'
parentPort.on('message', ({ id }) => {
  for (const end = Date.now() + 1500; Date.now() < end;) {}
  parentPort.postMessage({ id, state: { built: 'in the thread' } })
})
`)
  const inLoop = () => {
    holdBuild(1500)
    return { built: 'in the loop' }
  }
  const builder = stateThread({ inLoop, file: slow })
  t.after(() => builder.close())
  // The thread's first start, out of the way of the measure.
  await builder.build({}, {})
  const threaded = await loopHeld(() => builder.build({}, {}))
  assert.deepEqual(threaded.answer, { built: 'in the thread' })
  assert.ok(threaded.most < 500, `the loop was held ${threaded.most} ms while the thread built`)
  // The same build once the thread is off (it cannot start): the loop is held as before B1535.
  const off = stateThread({ inLoop, start: () => { throw new Error('no thread here') } })
  const looped = await loopHeld(() => off.build({}, {}))
  assert.deepEqual(looped.answer, { built: 'in the loop' })
  assert.ok(looped.most >= 1400, `the loop was held only ${looped.most} ms by a build in it`)
})

test('the fallback: a thread that throws, ends or cannot send back is given up once, and every build is made in the loop', { timeout: 60_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'state-thread-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const inLoop = (raw, options) => ({ built: 'in the loop', raw, options })
  const cases = {
    // The thread throws as it starts.
    throws: await threadFile(dir, 'throws.mjs', 'throw new Error(\'the thread broke\')\n'),
    // The thread ends in the middle of a build.
    ends: await threadFile(dir, 'ends.mjs', 'import { parentPort } from \'node:worker_threads\'\nparentPort.on(\'message\', () => process.exit(3))\n'),
    // The thread's build cannot be sent back (stateWorker.mjs's own answer then).
    copy: await threadFile(dir, 'copy.mjs', 'import { parentPort } from \'node:worker_threads\'\nparentPort.on(\'message\', ({ id }) => parentPort.postMessage({ id, error: { message: \'could not be cloned\' }, copyFailed: true }))\n'),
  }
  for (const [kind, file] of Object.entries(cases)) {
    const failed = []
    const offs = []
    let starts = 0
    const builder = stateThread({ inLoop, file, failed: error => failed.push(error.message), offForGood: error => offs.push(error.message), limitMs: 1_000, start: url => { starts += 1; return new Worker(url) } })
    t.after(() => builder.close())
    const first = await builder.build({ a: 1 }, { b: 2 })
    assert.deepEqual(first, { built: 'in the loop', raw: { a: 1 }, options: { b: 2 } }, kind)
    assert.equal(builder.lastWay(), 'loop', kind)
    // A copy that cannot work is off for good at once; a thread that threw or ended is tried anew, MOST_FAILURES times in all.
    if (kind !== 'copy') {
      assert.equal(builder.off(), null, kind)
      for (let n = 2; n <= MOST_FAILURES; n += 1) assert.deepEqual(await builder.build({ a: n }, {}), { built: 'in the loop', raw: { a: n }, options: {} }, kind)
      assert.equal(starts, MOST_FAILURES, kind)
    }
    assert.notEqual(builder.off(), null, kind)
    // Every build after it in the loop too, with no thread started, and the spell is said once.
    const started = starts
    assert.deepEqual(await builder.build({ a: 9 }, { b: 4 }), { built: 'in the loop', raw: { a: 9 }, options: { b: 4 } }, kind)
    assert.equal(starts, started, kind)
    assert.equal(failed.length, 1, `${kind}: ${JSON.stringify(failed)}`)
    // Chat 1's core review: off for good is said once, on its own line.
    assert.equal(offs.length, 1, `${kind}: ${JSON.stringify(offs)}`)
  }
})

test('chat 1\'s check: a thread that hangs past its limit is ended, its old raw never built; the read anew is built in the loop; a hang never turns the thread off', { timeout: 60_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'state-thread-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const hangs = await threadFile(dir, 'hangs.mjs', 'import { parentPort } from \'node:worker_threads\'\nparentPort.on(\'message\', () => {})\n')
  const looped = []
  const said = []
  let starts = 0
  const builder = stateThread({
    inLoop: raw => { looped.push(raw); return { built: 'in the loop', raw } }, file: hangs, limitMs: 500, failed: () => said.push('failed'),
    start: url => { starts += 1; return new Worker(url) },
  })
  t.after(() => builder.close())
  await assert.rejects(builder.build({ old: true }, {}), error => error.code === LATE)
  // The old raw was never built; the read anew is made in the loop, the thread not off.
  assert.deepEqual([looped, builder.off(), said], [[], null, ['failed']])
  assert.deepEqual(await builder.build({ fresh: true }, {}), { built: 'in the loop', raw: { fresh: true } })
  assert.equal(starts, 1)
  // The build after it tries a new thread; hangs in a row never turn the thread off (only failures of the thread itself do).
  for (let n = 2; n <= MOST_FAILURES + 1; n += 1) {
    await assert.rejects(builder.build({ again: n }, {}), error => error.code === LATE)
    assert.deepEqual(await builder.build({ fresh: n }, {}), { built: 'in the loop', raw: { fresh: n } })
  }
  assert.deepEqual([starts, builder.off(), said], [MOST_FAILURES + 1, null, ['failed']])
})

test('chat 1\'s core review: while the folder holds a newer server, no new thread starts; one that runs builds on', { timeout: 60_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'state-thread-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const echo = await threadFile(dir, 'echo.mjs', 'import { parentPort } from \'node:worker_threads\'\nparentPort.on(\'message\', ({ id, raw }) => parentPort.postMessage({ id, state: raw }))\n')
  let newer = true
  let starts = 0
  const builder = stateThread({ inLoop: () => ({ built: 'in the loop' }), file: echo, mayStart: () => !newer, start: url => { starts += 1; return new Worker(url) } })
  t.after(() => builder.close())
  assert.deepEqual([await builder.build({ n: 1 }, {}), starts], [{ built: 'in the loop' }, 0])
  newer = false
  assert.deepEqual([await builder.build({ n: 2 }, {}), starts], [{ n: 2 }, 1])
  // A newer server lands while the thread runs: the thread that runs builds on (its code is the running server's).
  newer = true
  assert.deepEqual([await builder.build({ n: 3 }, {}), starts], [{ n: 3 }, 1])
})

test('chat 1\'s core review: the thread\'s own answer: a state it cannot send back is said as a copy failure, a build error as the read\'s', () => {
  const sent = []
  const cannot = Object.assign(new Error('() => 1 could not be cloned.'), { name: 'DataCloneError' })
  answer({ id: 7, raw: {}, options: {} }, { build: () => ({ fn: () => 1 }), hold: () => {}, post: one => { if (one.state !== undefined) throw cannot; sent.push(one) } })
  assert.deepEqual(sent.map(one => [one.id, one.copyFailed === true, one.error.message]), [[7, true, '() => 1 could not be cloned.']])
  sent.length = 0
  answer({ id: 8, raw: {}, options: {} }, { build: () => { throw new Error('no config') }, hold: () => {}, post: one => sent.push(one) })
  assert.deepEqual(sent.map(one => [one.id, one.copyFailed === true, one.error.message]), [[8, false, 'no config']])
  answer({ id: 9, raw: { a: 1 }, options: {} }, { build: raw => raw, hold: () => {}, post: one => sent.push(one) })
  assert.deepEqual(sent.at(-1), { id: 9, state: { a: 1 } })
})

test('lens 1: a thread that ended once is replaced, the board builds in its thread again and says the spell is over', { timeout: 60_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'state-thread-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  // The first thread ends at its first build (as one out of memory would); the next ones build.
  const flaky = await threadFile(dir, 'flaky.mjs', `import { parentPort, workerData } from 'node:worker_threads'
parentPort.on('message', ({ id, raw }) => {
  if (workerData.first) process.exit(1)
  parentPort.postMessage({ id, state: { built: 'in the thread', raw } })
})
`)
  const said = []
  let starts = 0
  const builder = stateThread({
    inLoop: raw => ({ built: 'in the loop', raw }), file: flaky, failed: () => said.push('failed'), recovered: () => said.push('recovered'),
    start: url => new Worker(url, { workerData: { first: (starts += 1) === 1 } }),
  })
  t.after(() => builder.close())
  assert.deepEqual(await builder.build({ n: 1 }, {}), { built: 'in the loop', raw: { n: 1 } })
  assert.deepEqual(await builder.build({ n: 2 }, {}), { built: 'in the thread', raw: { n: 2 } })
  assert.deepEqual([builder.off(), builder.lastWay(), starts, said], [null, 'thread', 2, ['failed', 'recovered']])
})

test('lens 1: an answer that waits when the build\'s time runs out (a PC that woke) is taken, the thread kept', async t => {
  const timers = []
  const handlers = {}
  const fake = { on: (name, fn) => { handlers[name] = fn }, postMessage: () => {}, unref: () => {}, removeAllListeners: () => {}, terminate: async () => {} }
  const said = []
  const builder = stateThread({
    inLoop: () => ({ built: 'in the loop' }), start: () => fake, failed: () => said.push('failed'),
    setTimer: fn => { timers.push(fn); return {} }, clearTimer: () => {}, soon: fn => { handlers.message({ id: 1, state: { built: 'in the thread' } }); fn() },
  })
  t.after(() => builder.close())
  const built = builder.build({}, {})
  await new Promise(done => setImmediate(done))
  // The time runs out; the thread's answer is read first.
  timers[0]()
  assert.deepEqual(await built, { built: 'in the thread' })
  assert.deepEqual([builder.off(), said], [null, []])
})

test('the verifier and chat 1: a build whose timer fires far past its time (the PC slept) is waited for again, at every sleep', async t => {
  const timers = []
  const handlers = {}
  const fake = { on: (name, fn) => { handlers[name] = fn }, postMessage: () => {}, unref: () => {}, removeAllListeners: () => {}, terminate: async () => {} }
  let wall = 0
  const said = []
  const builder = stateThread({
    inLoop: () => ({ built: 'in the loop' }), start: () => fake, failed: () => said.push('failed'), limitMs: 120_000, wall: () => wall,
    setTimer: fn => { timers.push(fn); return {} }, clearTimer: () => {}, soon: fn => fn(),
  })
  t.after(() => builder.close())
  const built = builder.build({}, {})
  await new Promise(done => setImmediate(done))
  // An hour's sleep: the timer fires at the wake, long past its time; it is set again. A second sleep in the same build: again.
  wall = 3_600_000
  timers[0]()
  wall = 7_200_000
  timers[1]()
  assert.equal(timers.length, 3)
  handlers.message({ id: 1, state: { built: 'in the thread' } })
  assert.deepEqual(await built, { built: 'in the thread' })
  assert.deepEqual([builder.off(), said], [null, []])
  // A build that hangs with the PC awake is ended at its time: it fails LATE (its old raw is never built), and is said.
  const hung = builder.build({}, {})
  await new Promise(done => setImmediate(done))
  wall += 120_000
  timers[3]()
  await assert.rejects(hung, error => error.code === LATE)
  assert.deepEqual(said, ['failed'])
})

test('a value the copy cannot take falls back to the loop for that build and the ones after it', async t => {
  const failed = []
  const builder = stateThread({ inLoop: () => ({ built: 'in the loop' }), failed: error => failed.push(error.name) })
  t.after(() => builder.close())
  assert.deepEqual(await builder.build({ cannot: () => 'a function' }, {}), { built: 'in the loop' })
  assert.deepEqual(failed, ['DataCloneError'])
  assert.deepEqual(await builder.build({}, {}), { built: 'in the loop' })
  assert.equal(failed.length, 1)
})

test('the builds of a thread are answered each to its own caller, in order', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'state-thread-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const echo = await threadFile(dir, 'echo.mjs', 'import { parentPort } from \'node:worker_threads\'\nparentPort.on(\'message\', ({ id, raw }) => parentPort.postMessage({ id, state: raw }))\n')
  const builder = stateThread({ inLoop: () => null, file: echo, start: url => new Worker(url) })
  t.after(() => builder.close())
  assert.deepEqual(await Promise.all([1, 2, 3].map(n => builder.build({ n }, {}))), [{ n: 1 }, { n: 2 }, { n: 3 }])
})
