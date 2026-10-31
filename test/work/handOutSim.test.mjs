// Redesign Part 2 (spec 2026-10-24, "Order and delivery": tests with simulated chats): the board's state from the chats'
// reports (Part 1) and the server's pass, as at the board's refreshes: one more worker asked of the main chat, and the
// person's pause. (T8.5 step 6: the give itself is the hand-over's, test/work/handover*.test.mjs; the take-back, held-give
// and refused-give tests went with the old path.) Made-up samples only.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseConfig } from '../../src/config.mjs'
import { memoryStore } from '../../src/store.mjs'
import { buildState } from '../../src/state.mjs'
import { workApi } from '../../src/work/api.mjs'
import { deliverWork } from '../../src/work/deliver.mjs'
import { valueOf } from '../../src/work/item.mjs'
import { stamp } from '../../src/work/migrate.mjs'
import { readStore, writePause, writeStore } from '../../src/work/store.mjs'

const SEC = 1000
const MIN = 60 * SEC
const T0 = new Date(2026, 9, 25, 10, 0).getTime()
const PROJECT = 'C:\\garden'
const ROLES = { Lead: 'main', W1: 'worker', W2: 'worker', W3: 'worker' }

const item = (head, sections = {}) => ({ head: new Map(Object.entries(head)), sections: new Map(Object.entries(sections)), problem: null })
const task = (id, more = {}, sections = {}) => item({ Id: id, Kind: 'step', Title: `Task ${id}`, State: 'refined', Activity: 'Garden', Since: stamp(T0 - 60 * MIN), Refined: 'ready', ...more },
  { History: [`- ${stamp(T0 - 60 * MIN)} Partner: made`], ...sections })
const app = (name, more = {}) => JSON.stringify({ title: `Garden · ${name}`, sessionId: `local_${name}`, cliSessionId: `cli-${name}`, cwd: PROJECT, isArchived: false, createdAt: name.length, lastActivityAt: T0 - 5 * MIN, lastAssistantUuid: 'u-1', ...more })

/**
 * A garden on disk with `tasks`, and the chats Lead (main) and `workers`; `reports` sets each worker's report as its
 * Workers mod sends it (`{ state, since, at }`), `settings` the board's config.
 */
async function garden(tasks, { workers = ['W1', 'W2'], settings = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hand-out-sim-'))
  const items = new Map(tasks.map(one => [one.head.get('Id'), one]))
  await writeStore(dir, { items, activities: [{ name: 'Garden', isFocus: false, steps: [...items.keys()], notes: [], loose: [] }] }, undefined, { now: T0 - 60 * MIN })
  const config = { ...parseConfig(JSON.stringify({ handOutBeyondFocus: true, ...settings }), {}), project: PROJECT }
  const reports = new Map()
  /** A worker's report, as bridge.mjs `noteReport` keeps it. */
  const report = (name, state, since, at) => reports.set(name, { state, since, background: false, at, session: `cli-${name}`, mod: '0.19.0' })
  const outbox = memoryStore()
  const apps = (now, extra) => ['Lead', ...workers].map(name => app(name, extra?.[name] ?? {}))
  const build = async (now, { appMore = {} } = {}) => {
    const raw = {
      listText: '{"prefix":"Garden · ","main":"Lead"}', appChatTexts: apps(now, appMore), tails: {}, planLineTexts: {}, adviceText: null, folders: null, askTexts: [], pictureLists: {},
      work: { ok: true, dir, ...(await readStore(dir)) },
    }
    return buildState(raw, { lines: [], outbox: outbox.outbox(), runs: [], board: { startedAt: T0 - 60 * MIN, offSince: null }, seen: { shown: { Lead: now }, other: {} }, reports, now, config })
  }
  let n = 0
  const server = now => body => workApi(body, { dir, now, prefix: 'Garden · ', roleOf: chat => ROLES[chat] ?? null, as: 'server' })
  const deliver = (state, now, refuse = () => null) => deliverWork({ state, dir, outbox, apply: async body => refuse(body) ?? server(now)(body), now, maxChars: 2000, newId: () => `m${(n += 1)}` })
  const read = async id => (await readStore(dir)).items.get(id)
  const close = () => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  return { dir, report, build, deliver, read, outbox, close }
}
const ownerOf = async (one, id) => [valueOf(await one.read(id), 'State'), valueOf(await one.read(id), 'Owner')]

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
    // T13 part 3: a chat whose session ended is asleep now (it gets a task directly); off is one silent on no task.
    two.report('W3', 'busy', T0 - 30 * MIN, T0 - 30 * MIN)
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

test('B-max: a board whose settings name no maxWorkers runs on 5: a fifth worker is asked for, a sixth never', async () => {
  const busyTasks = names => names.map((name, at) => task(`B${at + 2}`, { State: 'in progress', Owner: name }))
  for (const [names, start] of [[['W1', 'W2', 'W3', 'W4'], { spawn: 1 }], [['W1', 'W2', 'W3', 'W4', 'W5'], null]]) {
    const one = await garden([task('B1'), ...busyTasks(names)], { workers: names })
    try {
      for (const name of names) one.report(name, 'busy', T0 - 60 * SEC, T0 - 2 * SEC)
      const state = await one.build(T0)
      assert.deepEqual(state.reconciled.start, start, `${names.length} busy workers`)
    } finally {
      await one.close()
    }
  }
})

test('while the person pauses, nothing is given and no worker is asked for', async () => {
  const one = await garden([task('B1'), task('B2')], { settings: { maxWorkers: 3 } })
  try {
    await writePause(one.dir, { state: 'pausing', since: T0 - MIN, by: 'person' })
    one.report('W1', 'idle', T0 - 60 * SEC, T0 - 2 * SEC)
    one.report('W2', 'busy', T0 - 60 * SEC, T0 - 2 * SEC)
    const state = await one.build(T0)
    assert.equal(state.reconciled.start, null)
    await one.deliver(state, T0)
    assert.deepEqual(await ownerOf(one, 'B1'), ['refined', null])
    assert.equal(one.outbox.outbox().length, 0)
  } finally {
    await one.close()
  }
})

test('gap 2: a task pinned to a worker whose chat is off has the main chat start that worker, beside an idle one; once per start window', async () => {
  const one = await garden([task('B590', { Pinned: 'W1', Priority: 'fix' })], { settings: { maxWorkers: 3 } })
  try {
    // T13 part 3: a chat whose session ended is asleep now (it gets its task directly); off is one silent on no task.
    one.report('W1', 'busy', T0 - 30 * MIN, T0 - 30 * MIN)
    one.report('W2', 'idle', T0 - 60 * SEC, T0 - 2 * SEC)
    const state = await one.build(T0)
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
