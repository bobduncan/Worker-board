// B813 (the fix of X2, back after B532 with count 25): the word of 2026-10-30 23:13 that set Worker 4 back to its usual
// setting failed once, "The app has not reported its model list yet; try again in a moment.", and the board was off from
// 23:13:29 to 23:41:40. Back on, the word was older than the outbox keeps a word that steers a chat, so it was not tried
// again, and the effort plan's half-hour dedupe held a new one: nothing went, and rule 8 named it until a newer word of
// 23:53 made it moot. The real case's words are the outbox's own (data/outbox.jsonl); the rest are made-up samples.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { memoryStore } from '../../src/store.mjs'
import { WATCH_RULES } from '../../src/supervisor/rules/watch.mjs'
import { buildView } from '../../src/supervisor/view.mjs'
import { deliverWork } from '../../src/work/deliver.mjs'
import { effortPlan, runSettings } from '../../src/work/effort.mjs'
import { sweepOutbox } from '../../src/work/outboxSweep.mjs'
import { passesBySelf } from '../../src/work/passing.mjs'

const MIN = 60_000
const HOUR = 60 * MIN
const keep = { messageMs: 10 * MIN, answerMs: 48 * HOUR }
const settings = runSettings({ models: { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' } })
const WHY = 'The app has not reported its model list yet; try again in a moment.'

// The board came back on at 23:41:40 (history.jsonl's first line after its gap).
const BACK = 1793400100197
// The word of 20:32 that set Worker 4 to low for its step: the board changed its setting, so it goes back to its usual one.
const low = () => ({ id: 'f93e059b3c79e87f', at: 1793398390260 - 100 * MIN, to: 'Main', ask: null, command: 'worker-effort', about: 'Worker 4', effort: 'low', model: 'claude-sonnet-5-5', usual: 'medium', usualModel: 'claude-sonnet-5-5', forStep: 'B770', text: 'set model and effort\nChat: Worker 4', state: 'delivered' })
// The real case: sent 23:13:10, taken by the Advisor's hand 23:13:18, failed 23:13:21 after one try.
const x2 = () => ({
  id: 'a104abf4066c82b9', at: 1793398390260, to: 'Main', ask: null, step: null, title: null, version: null, verdict: null, command: 'worker-effort', about: 'Worker 4',
  effort: 'medium', model: 'claude-sonnet-5-5', usual: 'medium', usualModel: 'claude-sonnet-5-5', forStep: null,
  text: 'set model and effort\nChat: Worker 4\nSession: local_800a5b00-5e5b-44a5-95e4-2be41cb04570\nModel: claude-sonnet-5-5\nEffort: medium\nWhy: Worker 4 holds no step now: back to its usual setting',
  state: 'failed', takenAt: 1793398398791, takenBy: 'Advisor', failedAt: 1793398401265, tries: 1, why: WHY,
})

const lanesAt = effort => [
  { name: 'Main', isMain: true, isLeftover: false, state: 'free', isRunning: true, queue: [], effort: 'medium', model: 'claude-opus-5-5' },
  { name: 'Worker 4', isMain: false, isLeftover: false, state: 'free', isRunning: true, queue: [], effort, model: 'claude-sonnet-5-5', appSession: 'local_800a5b00-5e5b-44a5-95e4-2be41cb04570' },
]
const outboxOf = words => {
  const store = memoryStore()
  for (const one of words) store.outbox().push({ ...one })
  return store
}
const plan = (outbox, now, effort = 'low') => effortPlan({ items: new Map(), lanes: lanesAt(effort), sent: outbox.outbox(), now, main: 'Main', ...settings })
const undelivered = (outbox, now, effort = 'low') => WATCH_RULES.find(one => one.id === 'undelivered')
  .check(buildView({ state: { chats: lanesAt(effort), chatPrefix: '' }, items: new Map(), outbox: outbox.outbox(), keep, now }), { seen: new Map(), observed: [] })

async function deliverAt(outbox, now, effort = 'low') {
  const dir = await mkdtemp(join(tmpdir(), 'passing-failure-'))
  try {
    const state = { chats: lanesAt(effort), chatPrefix: '', restart: { main: 'Main' }, reconciled: { efforts: plan(outbox, now, effort).words } }
    let n = 0
    return await deliverWork({ state, dir, outbox, apply: async () => ({ ok: true }), now, maxChars: 2000, newId: () => `w${(n += 1)}`, keep })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('which failures pass by themselves: the outbox\'s whys of the last week', () => {
  for (const why of [WHY, 'The server-side auto mode classifier gave no verdict for mcp__ccd_session_mgmt__send_message: the request timed out',
    'a hook dropped it: the prompt was removed from the queue before it ran', 'Scheduled task "x" is already running in session local_1. Follow it there.',
    'Session local_1 ("Lava Tactics - Worker 3") was not archived: it is still working (a turn in progress)', undefined]) assert.equal(passesBySelf(why), true, why)
  for (const why of ['Scheduled task "garden-start-worker-6" not found. Use list_scheduled_tasks to see available tasks.',
    "mcp__scheduled-tasks__update_scheduled_task needs a person's approval, and nobody has opened this scheduled run"]) assert.equal(passesBySelf(why), false, why)
})

test('X2, the real case: back on at 23:41, the word of 23:13 goes again and is delivered; the failed one is closed as superseded', async () => {
  const outbox = outboxOf([low(), x2()])
  // Too old for the outbox's own retry (it steers a chat: kept ten minutes), so the effort plan asks for it anew.
  assert.deepEqual(plan(outbox, BACK).words.map(one => [one.to, one.chat, one.level, one.model, one.step, one.why]),
    [['Main', 'Worker 4', 'medium', 'claude-sonnet-5-5', null, 'Worker 4 holds no step now: back to its usual setting']])
  const done = await deliverAt(outbox, BACK)
  assert.deepEqual(done.sent.map(one => [one.id, one.to, one.command, one.about, one.effort, one.at]), [['w1', 'Main', 'worker-effort', 'Worker 4', 'medium', BACK]])
  // The Advisor's hand takes it at once and sets it this time.
  const [taken] = await outbox.takeHands('Advisor', BACK + 5_000, keep, one => one.command === 'worker-effort')
  assert.equal(taken.id, 'w1')
  await outbox.settle('Main', { typed: ['w1'] }, BACK + 8_000)
  assert.equal(outbox.outbox().find(one => one.id === 'w1').state, 'delivered')
  // The next refresh: the failed word no longer matters, and rule 8 is silent, also before the chat's file shows medium.
  const closed = await sweepOutbox({ dir: null, outbox, state: { chats: lanesAt('low') }, now: BACK + MIN, keep })
  assert.deepEqual(closed, [{ id: 'a104abf4066c82b9', state: 'dropped', why: "superseded by a newer word for Worker 4's setting (2026-10-30 23:41)" }])
  assert.deepEqual(undelivered(outbox, BACK + 11 * MIN), [])
  // No third word: the one that went stands.
  assert.deepEqual(plan(outbox, BACK + 2 * MIN).words, [])
})

test('X2 before the fix: within the half hour the failed word held every new one, and rule 8 named it with its why', async () => {
  // A minute after it failed the outbox would have tried it again had the board been on; at 23:41 it no longer can.
  const outbox = outboxOf([low(), x2()])
  const view = undelivered(outbox, BACK)
  assert.deepEqual(view.map(one => [one.key, one.evidence]), [['undelivered Main', `23:13 worker-effort Worker 4 (failed: ${WHY})`]])
})

test('a moot effort word is closed by the sweep: a newer one for the same chat stands, or the chat runs at its setting', async () => {
  // The real newer word of 23:53, for B810 (high): the failed word of 23:13 is moot.
  const newer = { ...x2(), id: 'a641a62177fa0068', at: 1793400820206, effort: 'high', forStep: 'B810', state: 'delivered', failedAt: undefined, why: undefined, tries: undefined }
  const store = outboxOf([low(), x2(), newer])
  const closed = await sweepOutbox({ dir: null, outbox: store, state: { chats: lanesAt('low') }, now: 1793400820206 + MIN, keep })
  assert.deepEqual(closed, [{ id: 'a104abf4066c82b9', state: 'dropped', why: "superseded by a newer word for Worker 4's setting (2026-10-30 23:53)" }])
  // Worker 4 runs at medium on Sonnet already (set by hand, or by a word the board did not see arrive).
  const set = outboxOf([low(), x2()])
  assert.deepEqual(await sweepOutbox({ dir: null, outbox: set, state: { chats: lanesAt('medium') }, now: BACK, keep }),
    [{ id: 'a104abf4066c82b9', state: 'dropped', why: 'Worker 4 runs at sonnet · medium already' }])
  assert.deepEqual(undelivered(outboxOf([low(), x2()]), BACK, 'medium'), [])
})

test('a failure that passes, while the word is fresh: the outbox tries it again a minute on, up to three tries, then names it with its last why', async () => {
  const at = 1793398390260
  const fresh = { ...x2(), failedAt: at + 10_000 }
  const outbox = outboxOf([low(), fresh])
  // The same refresh plans a word from the outbox as it was; the sweep's retry goes first and stands for it: one word only.
  const done = await deliverAt(outbox, at + 75_000)
  assert.deepEqual(done.sent, [])
  const copies = outbox.outbox().filter(one => one.retryOf !== undefined)
  assert.deepEqual(copies.map(one => [one.retryOf, one.state, one.tries]), [['a104abf4066c82b9', 'waiting', 1]])
  // It fails twice more; then nothing goes again, and rule 8 names the last with its why.
  let last = copies[0]
  for (const [n, now] of [[2, at + 80_000], [3, at + 150_000]]) {
    await outbox.takeHands('Advisor', now, keep, one => one.id === last.id)
    await outbox.settle('Main', { failed: [last.id], why: { [last.id]: WHY } }, now)
    assert.equal(outbox.outbox().find(one => one.id === last.id).tries, n)
    await deliverAt(outbox, now + 65_000)
    last = outbox.outbox().at(-1)
  }
  assert.equal(last.state, 'failed')
  assert.equal(last.tries, 3)
  assert.deepEqual((await deliverAt(outbox, at + 300_000)).sent, [])
  assert.equal(outbox.outbox().filter(one => one.command === 'worker-effort').length, 4)
  const named = undelivered(outbox, at + 12 * MIN)
  assert.deepEqual(named.map(one => one.evidence), [`23:13 worker-effort Worker 4 (failed: ${WHY})`])
})

test('a failure that never passes is not tried again and is named once, with its why', async () => {
  const at = 1793398390260
  const why = 'Scheduled task "garden-start-worker-6" not found. Use list_scheduled_tasks to see available tasks.'
  const spawn = { id: 's1', at, to: 'Main', ask: null, command: 'spawn', about: 'Worker 6', text: 'spawn workers\nCount: 1', state: 'failed', failedAt: at + 5_000, tries: 1, why }
  const outbox = outboxOf([spawn])
  for (const now of [at + 2 * MIN, at + 4 * MIN, at + 8 * MIN]) await sweepOutbox({ dir: null, outbox, state: { chats: lanesAt('low') }, now, keep })
  assert.deepEqual(outbox.outbox().map(one => [one.id, one.state, one.retriedAs]), [['s1', 'failed', undefined]])
  assert.deepEqual(undelivered(outbox, at + 12 * MIN).map(one => one.evidence), [`23:13 spawn Worker 6 (failed: ${why})`])
})

test('the effort plan asks again after a passing failure only up to three failed words in a row for that setting', () => {
  const base = x2()
  const run = n => Array.from({ length: n }, (_, at) => ({ ...base, id: `f${at}`, at: base.at + at * 2 * MIN, failedAt: base.at + at * 2 * MIN + 5_000 }))
  assert.equal(plan(outboxOf([low(), ...run(2)]), base.at + 10 * MIN).words.length, 1)
  assert.deepEqual(plan(outboxOf([low(), ...run(3)]), base.at + 10 * MIN).words, [])
  // Within a minute of its failure the outbox's own retry has its turn: no new word yet.
  assert.deepEqual(plan(outboxOf([low(), base]), base.failedAt + 30_000).words, [])
})
