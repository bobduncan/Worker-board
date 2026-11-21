// B1279 (X205), chat 1's core review of 2026-11-20: the start by the wake procedure through the server's own pass (buildState, the
// plan, deliverWork, the closed-worker rule), not through hand-made states. B415 is ready, Worker 5's chat has not run for a day, the
// main chat runs; the wake record is the board's (`wakes`). Made-up chats only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { answer, step, typed } from '../fixtures/lines.mjs'
import { parseConfig } from '../src/config.mjs'
import { memoryStore } from '../src/store.mjs'
import { findStuck } from '../src/supervisor/rules/repair.mjs'
import { claim, emptyWakes, failedToSend, pass as wakePass, sent, spellOf } from '../src/wake.mjs'
import { workApi } from '../src/work/api.mjs'
import { deliverWork } from '../src/work/deliver.mjs'
import { parseItem } from '../src/work/item.mjs'
import { stamp } from '../src/work/migrate.mjs'
import { START_BY_WAKE_WHY } from '../src/work/outboxSweep.mjs'
import { storeFromText } from '../src/work/read.mjs'
import { writeStore } from '../src/work/store.mjs'
import { buildState } from './withStore.mjs'

const MIN = 60_000
const NOW = new Date(2026, 10, 20, 22, 0).getTime()
const ago = minutes => NOW - minutes * MIN
const PROJECT = 'C:\\game'
const config = { ...parseConfig('{}', {}), project: PROJECT, maxWorkers: 3 }
const PATHS = ['message', 'launch']
const app = name => JSON.stringify({
  title: `Game - ${name}`, sessionId: `local_${name.replace(' ', '')}`, cliSessionId: `cli-${name.replace(' ', '')}`, cwd: PROJECT, isArchived: false,
  createdAt: name.length, lastActivityAt: ago(24 * 60), lastAssistantUuid: 'u-1',
})
const ended = at => ({ text: [typed(at - 10 * MIN, 'Go on.'), step(at - 5 * MIN, 'Build'), answer(at, 'Done.')].join('\n'), isCut: false, modifiedAt: at })

function work() {
  const store = storeFromText('## Work\n', { now: ago(120) })
  store.items.set('B415', parseItem(`Id: B415\nKind: step\nTitle: Step B415\nState: refined\nRefined: ready\nGoal: G15\nQueued by: person, 2026-11-20 21:50:00\nSince: ${stamp(ago(10))}\n`))
  store.activities[0].steps.push('B415')
  return store
}
const NAMES = ['Main', 'Worker 5']
/** The board's state at `at`, with the wake record `record` (null: a board without one, as before B1279). */
function state({ record = emptyWakes(), outbox = [], at = NOW } = {}) {
  const raw = {
    listText: '{"prefix":"Game - ","main":"Main"}', appChatTexts: NAMES.map(app),
    tails: Object.fromEntries(NAMES.map(name => [`cli-${name.replace(' ', '')}`, ended(ago(24 * 60))])), planLineTexts: {}, work: work(),
    adviceText: null, folders: null, askTexts: [], pictureLists: {}, appStartedAt: ago(30 * 60), shown: { Main: at - 5_000 },
  }
  return buildState(raw, {
    lines: [], outbox, runs: [], now: at, config, seen: { shown: { Main: at - 5_000 }, other: {} }, board: { startedAt: ago(5 * 60), offSince: null },
    ...(record === null ? {} : { wakes: { record, senderClaims: true, canLaunch: true } }),
  })
}
const lane = (built, name) => built.chats.find(chat => chat.name === name)
const spellOfWorker5 = () => spellOf(lane(state(), 'Worker 5'))

async function deliver(t, built, outbox) {
  const dir = await mkdtemp(join(tmpdir(), 'start-by-wake-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  await writeStore(dir, work(), undefined, { now: ago(120) })
  const server = body => workApi(body, { dir, now: NOW, prefix: 'Game - ', roleOf: chat => ({ Main: 'main', 'Worker 5': 'worker' })[chat] ?? null, as: 'server' })
  let n = 0
  await deliverWork({ state: built, dir, outbox, apply: server, now: NOW, maxChars: 2000, newId: () => `m${++n}`, keep: { messageMs: 10 * MIN, answerMs: 48 * 60 * MIN } })
}
const OLD_START = { id: 'old1', command: 'start', to: 'Main', about: 'Worker 5', reported: 1, at: ago(5), state: 'waiting', text: 'start "Worker 5"' }
/** The same word as the live outbox keeps dozens of: two days old, delivered. */
const STALE_START = { ...OLD_START, at: ago(2 * 24 * 60), state: 'delivered' }

test('X205 through the pass: with the wake record the start is the wake procedure\'s: no start word, and an old one still waiting is closed', async t => {
  assert.ok(Number.isFinite(spellOfWorker5()), 'Worker 5 is off: it has a spell')
  // The live case at the landing: a start word of the hand-out still waits for Main (written before B1279).
  const built = state({ outbox: [OLD_START] })
  assert.equal(built.reconciled.startsByWake, true)
  assert.equal(built.reconciled.start, null, 'the waiting word counts as the start on its way')
  const outbox = memoryStore()
  await outbox.sayAll([OLD_START])
  await deliver(t, built, outbox)
  const [old] = outbox.outbox().filter(one => one.command === 'start')
  assert.equal(old.state, 'dropped')
  assert.match(JSON.stringify(old), new RegExp(START_BY_WAKE_WHY))
  // The next build: the start is the wake procedure's, a wake need of Worker 5, and no start word is written.
  const next = state({ outbox: outbox.outbox() })
  assert.deepEqual(next.reconciled.start, { start: 'Worker 5', byWake: true })
  assert.equal(lane(next, 'Worker 5').wake.need, true)
  await deliver(t, next, outbox)
  assert.deepEqual(outbox.outbox().filter(one => one.command === 'start').map(one => one.id), ['old1'])
})

test('X205 through the pass: without the wake record the start stays a word, as before', async t => {
  const built = state({ record: null })
  assert.deepEqual(built.reconciled.start, { start: 'Worker 5' })
  assert.equal(built.reconciled.startsByWake, false)
  const outbox = memoryStore()
  await deliver(t, built, outbox)
  assert.deepEqual(outbox.outbox().filter(one => one.command === 'start').map(one => [one.to, one.about]), [['Main', 'Worker 5']])
})

/** The closed-worker rule over the built lanes, with the outbox `words`. */
const closedFound = (built, words) => findStuck({ items: work().items, lanes: built.chats, prefix: 'Game - ', now: NOW, outbox: words, ready: [{ id: 'B415', rank: 2, keptFor: null }], limits: {}, pause: null, refused: [] })
  .filter(found => found.check === 'closed-worker')

test('X205 review 1: the closed-worker rule is quiet while the wake is on its way, and counts no start word from before the spell', () => {
  const spell = spellOfWorker5()
  const record = emptyWakes()
  claim(record, { chat: 'Worker 5', spell, path: 'message', by: 'Main', jobId: 'wake:w5', now: ago(1), paths: PATHS })
  sent(record, 'Worker 5', 'wake:w5', NOW - 30_000)
  const waking = state({ record })
  assert.equal(lane(waking, 'Worker 5').wake.state, 'sent')
  assert.deepEqual(closedFound(waking, [STALE_START]), [], 'the wake\'s message went 30 s ago')
  // No wake tried yet, but the start is a wake need of Worker 5: the procedure has it, the rule files nothing.
  const fresh = state()
  assert.equal(lane(fresh, 'Worker 5').wake.need, true)
  assert.deepEqual(closedFound(fresh, [STALE_START]), [])
  // Failed every way: the board's notice is the line (review 4), not this rule.
  const failed = emptyWakes()
  claim(failed, { chat: 'Worker 5', spell, path: 'message', by: 'Main', jobId: 'wake:w5', now: ago(20), paths: PATHS })
  sent(failed, 'Worker 5', 'wake:w5', ago(20) + 5_000)
  wakePass(failed, ago(16))
  claim(failed, { chat: 'Worker 5', spell, path: 'launch', by: 'board', jobId: 'launch:w5', now: ago(16), paths: PATHS })
  failedToSend(failed, 'Worker 5', 'launch:w5', 'the app did not start it', ago(14))
  assert.deepEqual(closedFound(state({ record: failed }), [STALE_START]), [])
  // A board without the wake record: the rule as before (a start word 12 minutes old: filed).
  assert.equal(closedFound(state({ record: null }), [{ ...STALE_START, at: ago(12) }]).length, 1)
})

test('X205 review 4: a worker whose wake failed every way while its task waits keeps the attention line, never "nothing waits for it"', () => {
  const spell = spellOfWorker5()
  const record = emptyWakes()
  claim(record, { chat: 'Worker 5', spell, path: 'message', by: 'Main', jobId: 'wake:w5', now: ago(20), paths: PATHS })
  sent(record, 'Worker 5', 'wake:w5', ago(20) + 5_000)
  wakePass(record, ago(16))
  claim(record, { chat: 'Worker 5', spell, path: 'launch', by: 'board', jobId: 'launch:w5', now: ago(16), paths: PATHS })
  failedToSend(record, 'Worker 5', 'launch:w5', 'the app did not start it', ago(14))
  const built = state({ record })
  assert.equal(lane(built, 'Worker 5').wake.final, true)
  assert.equal(built.reconciled.start, null, 'no start, no spawn beside a worker it cannot wake')
  assert.deepEqual(built.reconciled.passedOver, ['Worker 5'])
  assert.equal(built.wakeNotice?.tone, 'attention')
  assert.match(built.wakeNotice.text, /^could not wake Worker 5: .*; open its chat$/)
  assert.doesNotMatch(built.wakeNotice.text, /nothing waits/)
})

test('B1304 (B1279\'s point 2) through the pass: Worker 5 failed every way, but a later launch did start a chat: a new worker is asked for, and the notice still names Worker 5', async t => {
  const spell = spellOfWorker5()
  const record = emptyWakes()
  claim(record, { chat: 'Worker 5', spell, path: 'message', by: 'Main', jobId: 'wake:w5', now: ago(20), paths: PATHS })
  sent(record, 'Worker 5', 'wake:w5', ago(20) + 5_000)
  wakePass(record, ago(16))
  claim(record, { chat: 'Worker 5', spell, path: 'launch', by: 'board', jobId: 'launch:w5', now: ago(16), paths: PATHS })
  failedToSend(record, 'Worker 5', 'launch:w5', 'the app did not start it', ago(14))
  // Another chat's launch at 21:50 started it (its report with a new run).
  claim(record, { chat: 'Partner', spell: ago(60), path: 'launch', by: 'board', jobId: 'launch:p', now: ago(10), paths: ['launch'] })
  Object.assign(record.wakes.get('Partner').at(-1).attempts.at(-1), { verdict: 'woke', verdictAt: ago(9) })
  const built = state({ record })
  assert.deepEqual(built.reconciled.start, { spawn: 1 })
  assert.deepEqual(built.reconciled.passedOver, ['Worker 5'])
  assert.match(built.wakeNotice?.text ?? '', /^could not wake Worker 5: .*; open its chat$/)
  const outbox = memoryStore()
  await deliver(t, built, outbox)
  assert.deepEqual(outbox.outbox().filter(one => one.command === 'spawn').map(one => one.to), ['Main'], 'the new worker\'s word')
  assert.deepEqual(outbox.outbox().filter(one => one.command === 'start'), [], 'never a start word for Worker 5')
})
