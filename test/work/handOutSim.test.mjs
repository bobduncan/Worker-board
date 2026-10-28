// Redesign Part 2 (spec 2026-10-24, "Order and delivery": tests with simulated chats): the board's state from the chats'
// reports (Part 1), the reconciler's hand-out and the server's delivery, as at the board's refreshes: two workers going
// idle at once, a report gone stale, a worker that does not take its task, one more worker asked of the main chat, the
// person's pause, and a task whose line waits for its model. Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseConfig } from '../../src/config.mjs'
import { memoryStore } from '../../src/store.mjs'
import { buildState } from '../../src/state.mjs'
import { workApi } from '../../src/work/api.mjs'
import { deliverWork, givesRefused, isTransient } from '../../src/work/deliver.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { readStore, writePause, writeStore } from '../../src/work/store.mjs'

const SEC = 1000
const MIN = 60 * SEC
const T0 = new Date(2026, 9, 25, 10, 0).getTime()
const PROJECT = 'C:\\garden'
const MODELS = { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' }
const ROLES = { Lead: 'main', W1: 'worker', W2: 'worker', W3: 'worker' }

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)), problem: null })
const task = (id, more = {}, sections = {}) => item({ Id: id, Kind: 'step', Title: `Task ${id}`, State: 'refined', Activity: 'Garden', Since: stamp(T0 - 60 * MIN), Refined: 'ready', ...more },
  { History: [`- ${stamp(T0 - 60 * MIN)} Partner: made`], ...sections })
const app = (name, more = {}) => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: T0 - 5 * MIN, lastAssistantUuid: 'u-1', ...more })

/**
 * A garden on disk with `tasks`, and the chats Lead (main) and `workers`; `reports` sets each worker's report as its
 * Workers mod sends it (`{ state, since, at }`), `settings` the board's config.
 */
async function garden(tasks, { workers = ['W1', 'W2'], settings = {}, models = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hand-out-sim-'))
  const items = new Map(tasks.map(one => [one.head.get('Id'), one]))
  await writeStore(dir, { items, activities: [{ name: 'Garden', isFocus: false, steps: [...items.keys()], notes: [], loose: [] }] }, undefined, { now: T0 - 60 * MIN })
  const config = { ...parseConfig(JSON.stringify({ handOutBeyondFocus: true, ...settings }), {}), project: PROJECT, ...(models === null ? {} : { models: MODELS }) }
  const reports = new Map()
  /** A worker's report, as bridge.mjs `noteReport` keeps it. */
  const report = (name, state, since, at) => reports.set(name, { state, since, background: false, at, session: `cli-${name}`, mod: '0.19.0' })
  const outbox = memoryStore()
  const apps = (now, extra) => ['Lead', ...workers].map(name => app(name, extra?.[name] ?? {}))
  const build = async (now, { appMore = {}, heldAt = null } = {}) => {
    const raw = {
      listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: apps(now, appMore), tails: {}, planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {},
      work: { ok: true, dir, ...(await readStore(dir)) },
    }
    return buildState(raw, { lines: [], outbox: outbox.outbox(), runs: [], board: { startedAt: T0 - 60 * MIN, offSince: null }, seen: { shown: { Lead: now }, other: {} }, reports, now, config, handOutHeldAt: heldAt, refusedGives: givesRefused(dir, now) })
  }
  let n = 0
  const server = now => body => workApi(body, { dir, now, prefix: 'Garden · ', roleOf: chat => ROLES[chat] ?? null, as: 'server' })
  const deliver = (state, now, refuse = () => null) => deliverWork({ state, dir, outbox, apply: async body => refuse(body) ?? server(now)(body), now, maxChars: 2000, newId: () => `m${(n += 1)}` })
  const read = async id => (await readStore(dir)).items.get(id)
  const close = () => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  return { dir, report, build, deliver, read, outbox, close }
}
const lines = outbox => outbox.outbox().filter(one => one.command === 'work').map(one => [one.to, one.about, one.state])
const ownerOf = async (one, id) => [valueOf(await one.read(id), 'State'), valueOf(await one.read(id), 'Owner')]

test('two workers report idle at once: one task each at the first pass, one line each at the next, nothing more at a third', async () => {
  const one = await garden([task('B1'), task('B2'), task('B3')])
  try {
    one.report('W1', 'idle', T0 - 10 * SEC, T0 - 2 * SEC)
    one.report('W2', 'idle', T0 - 9 * SEC, T0 - 2 * SEC)
    const first = await one.build(T0)
    assert.deepEqual(first.reconciled.gives.map(({ id, chat }) => [id, chat]), [['B1', 'W1'], ['B2', 'W2']])
    assert.deepEqual(first.readyList.ready.map(row => row.id), ['B1', 'B2', 'B3'])
    const done = await one.deliver(first, T0)
    assert.deepEqual(done.given, ['B1', 'B2'])
    assert.deepEqual([await ownerOf(one, 'B1'), await ownerOf(one, 'B2'), await ownerOf(one, 'B3')], [['queued', 'W1'], ['queued', 'W2'], ['refined', null]])
    const next = T0 + 5 * SEC
    await one.deliver(await one.build(next), next)
    assert.deepEqual(lines(one.outbox), [['W1', 'B1', 'waiting'], ['W2', 'B2', 'waiting']])
    // The same pass again: no second give (each worker holds one), no second line.
    const again = await one.deliver(await one.build(next), next)
    assert.deepEqual(again.given, [])
    assert.equal(lines(one.outbox).length, 2)
    assert.equal(await ownerOf(one, 'B3').then(pair => pair[0]), 'refined')
  } finally {
    await one.close()
  }
})

test('a report 31 seconds old is unknown: that worker gets nothing', async () => {
  const one = await garden([task('B1')])
  try {
    one.report('W1', 'idle', T0 - 60 * SEC, T0 - 31 * SEC)
    const state = await one.build(T0)
    assert.equal(state.chats.find(lane => lane.name === 'W1').state, 'unknown')
    assert.deepEqual(state.reconciled.gives, [])
  } finally {
    await one.close()
  }
})

test('a worker that does not take its task: back on the list after 2 minutes, it shows stuck, the other worker gets it; it reports anew and gets work again', async () => {
  const one = await garden([task('B1')])
  try {
    one.report('W1', 'idle', T0 - 60 * SEC, T0 - 2 * SEC)
    one.report('W2', 'busy', T0 - 60 * SEC, T0 - 2 * SEC)
    await one.deliver(await one.build(T0), T0)
    const T1 = T0 + 10 * SEC
    await one.deliver(await one.build(T1), T1)
    assert.deepEqual(lines(one.outbox), [['W1', 'B1', 'waiting']])
    // W1 sits idle; W2 went idle meanwhile. Two minutes and a second after the line: taken back, W1 stuck.
    const T2 = T1 + 2 * MIN + SEC
    one.report('W1', 'idle', T0 - 60 * SEC, T2 - 2 * SEC)
    one.report('W2', 'idle', T2 - 30 * SEC, T2 - 2 * SEC)
    const late = await one.build(T2)
    assert.deepEqual(late.reconciled.takeBacks, [{ id: 'B1', chat: 'W1', stuck: true, why: 'not taken within 2 min' }])
    await one.deliver(late, T2)
    assert.deepEqual(await ownerOf(one, 'B1'), ['refined', null])
    assert.match((await one.read('B1')).sections.get('History').at(-1), /server: queued → refined \(taken back from W1: not taken within 2 min; stuck\)$/)
    // Its line is withdrawn.
    assert.deepEqual(lines(one.outbox), [['W1', 'B1', 'dropped']])
    // The next pass: W1 has its flag and gets nothing; W2 gets B1.
    const after = await one.build(T2 + SEC)
    assert.deepEqual(after.chats.find(lane => lane.name === 'W1').flags, [{ kind: 'not taking', id: 'B1', text: 'Stuck: did not take B1 within 2 min; it went back on the list', button: null }])
    assert.deepEqual(after.reconciled.gives.map(({ id, chat }) => [id, chat]), [['B1', 'W2']])
    await one.deliver(after, T2 + SEC)
    // W1 runs a turn and ends it: no longer stuck, and the next ready task is its.
    const T3 = T2 + 2 * MIN
    one.report('W1', 'busy', T3 - 20 * SEC, T3 - 15 * SEC)
    one.report('W1', 'idle', T3 - 10 * SEC, T3 - 2 * SEC)
    one.report('W2', 'busy', T2 + 10 * SEC, T3 - 2 * SEC)
    await writeStore(one.dir, { items: new Map([...(await readStore(one.dir)).items, ['B4', task('B4')]]), activities: [{ name: 'Garden', isFocus: false, steps: ['B1', 'B4'], notes: [], loose: [] }] }, undefined, { now: T3 })
    const fresh = await one.build(T3)
    assert.deepEqual(fresh.chats.find(lane => lane.name === 'W1').flags, [])
    assert.deepEqual(fresh.reconciled.gives.map(({ id, chat }) => [id, chat]), [['B4', 'W1']])
  } finally {
    await one.close()
  }
})

test('ready tasks wait and no worker is free: the main chat is asked for one worker, once; with a worker off, to start it', async () => {
  const one = await garden([task('B1'), task('B2', { State: 'in progress', Owner: 'W1' }), task('B3', { State: 'in progress', Owner: 'W2' })], { settings: { maxWorkers: 3 } })
  try {
    one.report('W1', 'busy', T0 - 60 * SEC, T0 - 2 * SEC)
    one.report('W2', 'busy', T0 - 60 * SEC, T0 - 2 * SEC)
    const state = await one.build(T0)
    assert.deepEqual(state.reconciled.start, { spawn: 1 })
    await one.deliver(state, T0)
    await one.deliver(await one.build(T0 + SEC), T0 + SEC)
    const asks = one.outbox.outbox().filter(message => message.to === 'Lead')
    assert.deepEqual(asks.map(message => [message.command, message.text]), [['spawn', 'spawn workers\nCount: 1\nWhy: ready tasks wait and no worker is free']])
  } finally {
    await one.close()
  }
  // A worker of the list whose chat is off: the main chat starts it instead.
  const two = await garden([task('B1'), task('B2', { State: 'in progress', Owner: 'W1' }), task('B3', { State: 'in progress', Owner: 'W2' })], { workers: ['W1', 'W2', 'W3'], settings: { maxWorkers: 3 } })
  try {
    two.report('W1', 'busy', T0 - 60 * SEC, T0 - 2 * SEC)
    two.report('W2', 'busy', T0 - 60 * SEC, T0 - 2 * SEC)
    two.report('W3', 'ended', T0 - 30 * MIN, T0 - 30 * MIN)
    const state = await two.build(T0)
    assert.deepEqual(state.reconciled.start, { start: 'W3' })
    await two.deliver(state, T0)
    const asks = two.outbox.outbox().filter(message => message.to === 'Lead')
    assert.deepEqual(asks.map(message => message.command), ['start'])
    assert.match(asks[0].text, /^start "W3"\n/)
  } finally {
    await two.close()
  }
})

test('while the person pauses, nothing is given and no worker is asked for', async () => {
  const one = await garden([task('B1'), task('B2')], { settings: { maxWorkers: 3 } })
  try {
    await writePause(one.dir, { state: 'pausing', since: T0 - MIN, by: 'person' })
    one.report('W1', 'idle', T0 - 60 * SEC, T0 - 2 * SEC)
    one.report('W2', 'busy', T0 - 60 * SEC, T0 - 2 * SEC)
    const state = await one.build(T0)
    assert.deepEqual([state.reconciled.gives, state.reconciled.start], [[], null])
    await one.deliver(state, T0)
    assert.deepEqual(await ownerOf(one, 'B1'), ['refined', null])
    assert.equal(one.outbox.outbox().length, 0)
  } finally {
    await one.close()
  }
})

test('an opus task given to a worker on sonnet: its line waits for the model, and five minutes on it is still that worker\'s (Review Focus 1)', async () => {
  const one = await garden([task('B1', {}, { Model: ['opus: the board\'s core'] })], { workers: ['W1'], models: true })
  try {
    one.report('W1', 'idle', T0 - 60 * SEC, T0 - 2 * SEC)
    const sonnet = { W1: { model: MODELS.sonnet, effort: 'medium' } }
    await one.deliver(await one.build(T0, { appMore: sonnet }), T0)
    assert.deepEqual(await ownerOf(one, 'B1'), ['queued', 'W1'])
    const T1 = T0 + 10 * SEC
    const held = await one.build(T1, { appMore: sonnet })
    assert.ok(held.reconciled.held.includes('B1'))
    await one.deliver(held, T1)
    assert.deepEqual(lines(one.outbox), [])
    // The main chat is asked to set the model; five minutes on, the line still waits and nothing is taken back.
    assert.ok(one.outbox.outbox().some(message => message.to === 'Lead' && message.command === 'worker-effort'))
    const T2 = T0 + 5 * MIN
    one.report('W1', 'idle', T0 - 60 * SEC, T2 - 2 * SEC)
    const later = await one.build(T2, { appMore: sonnet })
    assert.deepEqual(later.reconciled.takeBacks, [])
    await one.deliver(later, T2)
    assert.deepEqual(await ownerOf(one, 'B1'), ['queued', 'W1'])
  } finally {
    await one.close()
  }
})

test('the review: after a full limit the take-back clock starts anew; a worker idle through the limit is not taken back at once', async () => {
  const one = await garden([task('B1')], { workers: ['W1'] })
  try {
    one.report('W1', 'idle', T0 - 60 * SEC, T0 - 2 * SEC)
    await one.deliver(await one.build(T0), T0)
    const T1 = T0 + 10 * SEC
    await one.deliver(await one.build(T1), T1)
    assert.deepEqual(lines(one.outbox), [['W1', 'B1', 'waiting']])
    // A limit was full until 30 s ago (the server's memory of when it last held the hand-out).
    const ended = T0 + 20 * MIN
    one.report('W1', 'idle', T0 - 60 * SEC, ended + 30 * SEC - 2 * SEC)
    assert.deepEqual((await one.build(ended + 30 * SEC, { heldAt: ended })).reconciled.takeBacks, [])
    one.report('W1', 'idle', T0 - 60 * SEC, ended + 2 * MIN)
    assert.deepEqual((await one.build(ended + 2 * MIN + SEC, { heldAt: ended })).reconciled.takeBacks, [{ id: 'B1', chat: 'W1', stuck: true, why: 'not taken within 2 min' }])
  } finally {
    await one.close()
  }
})

test('B764: after the pause of the person the take-back clock starts anew: a worker given a task before the pause is not taken back at once', async () => {
  const one = await garden([task('B1')], { workers: ['W1'] })
  try {
    one.report('W1', 'idle', T0 - 60 * SEC, T0 - 2 * SEC)
    await one.deliver(await one.build(T0), T0)
    const T1 = T0 + 10 * SEC
    await one.deliver(await one.build(T1), T1)
    assert.deepEqual(lines(one.outbox), [['W1', 'B1', 'waiting']])
    // The person paused at once and resumed 20 minutes on; the worker stopped before taking the task.
    const resumed = T0 + 20 * MIN
    await writePause(one.dir, { state: 'running', since: resumed + MIN, by: 'server', pausedSince: T0 + 15 * SEC, resumedSince: resumed })
    one.report('W1', 'idle', T0 - 60 * SEC, resumed + 30 * SEC)
    assert.deepEqual((await one.build(resumed + 30 * SEC)).reconciled.takeBacks, [])
    one.report('W1', 'idle', T0 - 60 * SEC, resumed + 2 * MIN + 30 * SEC)
    assert.deepEqual((await one.build(resumed + 2 * MIN + 30 * SEC)).reconciled.takeBacks, [{ id: 'B1', chat: 'W1', stuck: true, why: 'not taken within 2 min' }])
  } finally {
    await one.close()
  }
})

test('the review: a give the work API refuses is not tried again for that worker a while; the worker gets another task, the list says why', async () => {
  const one = await garden([task('B1'), task('B2')], { workers: ['W1'] })
  try {
    one.report('W1', 'idle', T0 - 60 * SEC, T0 - 2 * SEC)
    const refuse = body => (body.action === 'advance' && body.id === 'B1' && body.to === 'queued' ? { ok: false, status: 409, why: 'routing holds B1 for an Opus worker' } : null)
    const first = await one.build(T0)
    assert.deepEqual(first.reconciled.gives.map(({ id, chat }) => [id, chat]), [['B1', 'W1']])
    assert.deepEqual((await one.deliver(first, T0, refuse)).given, [])
    const next = await one.build(T0 + 5 * SEC)
    assert.deepEqual(next.reconciled.gives.map(({ id, chat }) => [id, chat]), [['B2', 'W1']])
    assert.deepEqual(next.readyList.ready.find(row => row.id === 'B1').refused, { chat: 'W1', why: 'routing holds B1 for an Opus worker' })
    // Fifteen minutes on it is tried again.
    one.report('W1', 'idle', T0 - 60 * SEC, T0 + 16 * MIN - 2 * SEC)
    assert.equal((await one.build(T0 + 16 * MIN)).reconciled.gives[0].id, 'B1')
  } finally {
    await one.close()
  }
})

test('the recheck: a refusal of a race or a conflict bars nothing; the board decides anew at the next pass', async () => {
  for (const why of ['B1: B1.md changed in the meantime; try again.', 'W1 holds B2 (queued): no second task.', 'B1: no move from queued to queued (flow.json)']) assert.equal(isTransient({ ok: false, status: 409, why }), true, why)
  assert.equal(isTransient(null), true)
  assert.equal(isTransient({ ok: false, status: 500, why: 'x' }), true)
  assert.equal(isTransient({ ok: false, status: 409, why: 'routing holds B1 for an Opus worker' }), false)
  const one = await garden([task('B1'), task('B2')], { workers: ['W1'] })
  try {
    one.report('W1', 'idle', T0 - 60 * SEC, T0 - 2 * SEC)
    const conflict = body => (body.action === 'advance' && body.id === 'B1' && body.to === 'queued' ? { ok: false, status: 409, why: 'B1: B1.md changed in the meantime; try again.' } : null)
    await one.deliver(await one.build(T0), T0, conflict)
    assert.deepEqual(givesRefused(one.dir, T0 + SEC), [])
    assert.deepEqual((await one.build(T0 + 5 * SEC)).reconciled.gives.map(({ id, chat }) => [id, chat]), [['B1', 'W1']])
  } finally {
    await one.close()
  }
})

test('the recheck: a task taken back twice because its line was held says so on the list, and once to the main chat', async () => {
  const held = minutes => `- ${stamp(T0 - minutes * MIN)} server: queued → refined (taken back from W1: its line was held 20 min)`
  const opus = task('B1', {}, { Model: ['opus: the board\'s core'], History: [`- ${stamp(T0 - 60 * MIN)} Partner: made`, held(50), held(25)] })
  const one = await garden([opus], { workers: ['W1'] })
  try {
    one.report('W1', 'busy', T0 - 60 * SEC, T0 - 2 * SEC)
    const state = await one.build(T0)
    assert.deepEqual(state.reconciled.heldTwice, [{ id: 'B1', text: 'B1 waits for a worker on Opus: the switch did not happen' }])
    assert.equal(state.readyList.ready[0].note, 'B1 waits for a worker on Opus: the switch did not happen')
    await one.deliver(state, T0)
    await one.deliver(await one.build(T0 + MIN), T0 + MIN)
    assert.deepEqual(one.outbox.outbox().filter(message => message.kind === 'held-twice').map(message => [message.to, message.text]), [['Lead', 'B1 waits for a worker on Opus: the switch did not happen']])
  } finally {
    await one.close()
  }
})

test('gap 2: a task pinned to a worker whose chat is off has the main chat start that worker, beside an idle one; once per start window', async () => {
  const one = await garden([task('B590', { Pinned: 'W1', Priority: 'fix' })], { settings: { maxWorkers: 3 } })
  try {
    one.report('W1', 'ended', T0 - 30 * MIN, T0 - 30 * MIN)
    one.report('W2', 'idle', T0 - 60 * SEC, T0 - 2 * SEC)
    const state = await one.build(T0)
    assert.deepEqual(state.reconciled.gives, [], 'it waits for its own worker')
    assert.deepEqual(state.reconciled.start, { start: 'W1', pinned: 'B590' })
    await one.deliver(state, T0)
    const starts = () => one.outbox.outbox().filter(message => message.to === 'Lead' && message.command === 'start')
    assert.deepEqual(starts().map(message => message.text.split('\n')[0]), ['start "W1"'])
    // A minute on: no second word. Eleven minutes on, still off: asked once more.
    one.report('W2', 'idle', T0 - 60 * SEC, T0 + MIN - 2 * SEC)
    await one.deliver(await one.build(T0 + MIN), T0 + MIN)
    assert.equal(starts().length, 1)
    const later = T0 + 11 * MIN
    one.report('W2', 'idle', T0 - 60 * SEC, later - 2 * SEC)
    await one.deliver(await one.build(later), later)
    assert.equal(starts().length, 2)
  } finally {
    await one.close()
  }
})
